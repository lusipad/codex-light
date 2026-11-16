import { useEffect, useRef, useState } from "react";
import { acquirePluginSettingsRuntime, type PluginSettingsRuntime } from "./pluginSettingsRuntime";
import { isPluginSettingValue, parsePluginSettingsDefinition, parsePluginSettingsUpdate,
  type PluginProvidedSettingsView, type PluginSettingValue, type PluginSettingsDefinition } from "./pluginProvidedSettings";

const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const failed = "无法加载或保存设置。请重试。";
export function usePluginProvidedSettingsView(view: PluginProvidedSettingsView, identity: string) {
  const scope = JSON.stringify([identity, view.hostId, view.server, view.pluginId, view.readTool, view.updateTool]);
  const current = useRef({ scope, mounted: false }); current.current.scope = scope;
  const epoch = useRef(0), sequence = useRef(0), busy = useRef(false), reading = useRef(false), runtime = useRef<PluginSettingsRuntime | null>(null);
  const [state, setState] = useState<{ scope: string; definition: PluginSettingsDefinition | null; loading: boolean;
    pending: { name: string; value: PluginSettingValue } | null; error: string | null } | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionResults, setActionResults] = useState<Record<string, { text?: string; error?: string }>>({});
  const renderEpoch = epoch.current;
  const valid = (generation: number) => current.current.mounted && current.current.scope === scope && epoch.current === generation;
  const readDefinition = async (session: PluginSettingsRuntime) => {
    const result = object(await session.call(view.readTool, {}));
    if (!result || result.isError) throw Error(failed);
    return parsePluginSettingsDefinition(result.structuredContent);
  };
  const reload = async () => {
    if (!current.current.mounted || current.current.scope !== scope || busy.current || reading.current || !runtime.current) return;
    const generation = epoch.current, ticket = ++sequence.current, session = runtime.current;
    reading.current = true;
    setState({ scope, definition: null, loading: true, pending: null, error: null });
    try {
      const definition = await readDefinition(session);
      if (valid(generation) && ticket === sequence.current) setState({ scope, definition, loading: false, pending: null, error: null });
    } catch {
      if (valid(generation) && ticket === sequence.current) setState({ scope, definition: null, loading: false, pending: null, error: failed });
    } finally { if (valid(generation) && ticket === sequence.current) reading.current = false; }
  };
  useEffect(() => {
    current.current.mounted = true; epoch.current++; busy.current = false; reading.current = false;
    setActionPending(null); setActionResults({});
    try { runtime.current = acquirePluginSettingsRuntime(identity, view); void reload(); }
    catch { setState({ scope, definition: null, loading: false, pending: null, error: failed }); }
    return () => { current.current.mounted = false; epoch.current++; sequence.current++; runtime.current?.dispose(); runtime.current = null; };
  }, [scope, view]);
  const visible = state?.scope === scope ? state : null;
  const updateUnavailable = !view.tools.some(tool => tool.name === view.updateTool);
  const change = async (name: string, value: PluginSettingValue) => {
    const definition = visible?.definition, session = runtime.current;
    if (!valid(renderEpoch) || busy.current || reading.current || !session || !definition || visible.loading || updateUnavailable ||
      !Object.hasOwn(definition.schema.properties, name) || !isPluginSettingValue(definition.schema.properties[name], value) || Object.is(definition.values[name], value)) return;
    const generation = epoch.current;
    sequence.current++; busy.current = true;
    setState({ scope, definition, loading: false, pending: { name, value }, error: null });
    let writeFailed = false;
    try {
      const result = object(await session.call(view.updateTool, { set: { [name]: value } }));
      if (!result || result.isError) throw Error(failed);
      parsePluginSettingsUpdate(result.structuredContent);
    } catch { writeFailed = true; }
    if (!valid(generation)) return;
    try {
      const actual = await readDefinition(session);
      if (valid(generation)) setState({ scope, definition: actual, loading: false, pending: null,
        error: writeFailed || !Object.is(actual.values[name], value) ? failed : null });
    } catch {
      if (valid(generation)) setState({ scope, definition: null, loading: false, pending: null, error: failed });
    } finally { if (valid(generation)) busy.current = false; }
  };
  const actionAvailable = (name: string) => {
    const tool = view.tools.find(tool => tool.name === name), schema = object(tool?.inputSchema), meta = object(tool?._meta);
    return !!tool && !!schema && !Object.hasOwn(meta ?? {}, "openai/fileParams") &&
      (schema.required === undefined || Array.isArray(schema.required) && schema.required.length === 0) &&
      object(meta?.ui)?.resourceUri == null && meta?.["openai/outputTemplate"] == null;
  };
  const runAction = async (name: string) => {
    const session = runtime.current;
    if (!valid(renderEpoch) || busy.current || reading.current || !session || !visible?.definition || visible.loading || !actionAvailable(name)) return;
    const generation = epoch.current; busy.current = true; sequence.current++; setActionPending(name);
    setActionResults(previous => ({ ...previous, [name]: {} }));
    try {
      const result = object(await session.call(name, {}));
      if (!result || result.isError) throw Error("无法完成此操作。请重试。");
      const text = Array.isArray(result.content) ? result.content.map(object).find(item => item?.type === "text" && typeof item.text === "string")?.text : null;
      if (valid(generation)) setActionResults(previous => ({ ...previous, [name]: { text: typeof text === "string" && text ? text : "已完成" } }));
    } catch {
      if (valid(generation)) setActionResults(previous => ({ ...previous, [name]: { error: "无法完成此操作。请重试。" } }));
    } finally { if (valid(generation)) { busy.current = false; setActionPending(null); } }
  };
  return { definition: visible?.definition ?? null, loading: !visible || visible.loading, pending: visible?.pending ?? null,
    error: visible?.error ?? null, updateUnavailable, reload, change, actionPending, actionResults, actionAvailable, runAction };
}

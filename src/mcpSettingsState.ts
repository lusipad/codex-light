import { useEffect, useRef, useState } from "react";
import { callAppServer, tauriListen } from "./bridge";
import { readMcpSettings, writeMcpServer, type McpSettingsSnapshot, type McpSettingsEntry, type McpSettingsAction } from "./mcpSettings";
import { readMcpServerStatus, describeMcpStatus, type McpStatus } from "./mcpStatus";

export interface McpPair { key: string; value: string }
export interface McpDraft {
  label: string; transport: "stdio" | "http"; command: string; args: string[]; env: McpPair[]; envVars: string[]; cwd: string;
  url: string; bearer: string; headers: McpPair[]; envHeaders: McpPair[];
  unknownMaps: { env: Record<string, unknown>; headers: Record<string, unknown>; envHeaders: Record<string, unknown> };
}
const text = (value: unknown) => typeof value === "string" ? value : "";
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const pairs = (value: unknown): McpPair[] => value && typeof value === "object" && !Array.isArray(value)
  ? Object.entries(value).filter(([, value]) => typeof value === "string").map(([key, value]) => ({ key, value: value as string })) : [];
const unknownMapValues = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).filter(([, value]) => typeof value !== "string")) : {};
export function mcpDraft(entry?: McpSettingsEntry): McpDraft {
  const raw = entry?.raw ?? {};
  return { label: entry?.name ?? "", transport: entry?.transport === "http" ? "http" : "stdio", command: text(raw.command), args: strings(raw.args),
    env: pairs(raw.env), envVars: strings(raw.env_vars), cwd: text(raw.cwd), url: text(raw.url), bearer: text(raw.bearer_token_env_var), headers: pairs(raw.http_headers), envHeaders: pairs(raw.env_http_headers),
    unknownMaps: { env: unknownMapValues(raw.env), headers: unknownMapValues(raw.http_headers), envHeaders: unknownMapValues(raw.env_http_headers) } };
}
export function serializeMcpDraft(draft: McpDraft): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (draft.transport === "stdio") {
    result.command = draft.command;
    if (draft.args.length) result.args = [...draft.args];
    const env = { ...draft.unknownMaps.env, ...Object.fromEntries(draft.env.filter(row => row.key.length > 0).map(row => [row.key, row.value])) };
    if (Object.keys(env).length) result.env = env;
    const envVars = draft.envVars.map(value => value.trim()).filter(Boolean);
    if (envVars.length) result.env_vars = envVars;
    if (draft.cwd.length) result.cwd = draft.cwd;
  } else {
    result.url = draft.url;
    if (draft.bearer.trim()) result.bearer_token_env_var = draft.bearer.trim();
    const headers = { ...draft.unknownMaps.headers, ...Object.fromEntries(draft.headers.filter(row => row.key.trim()).map(row => [row.key.trim(), row.value])) };
    if (Object.keys(headers).length) result.http_headers = headers;
    const envHeaders = { ...draft.unknownMaps.envHeaders, ...Object.fromEntries(draft.envHeaders.filter(row => row.key.trim() && row.value.trim()).map(row => [row.key.trim(), row.value.trim()])) };
    if (Object.keys(envHeaders).length) result.env_http_headers = envHeaders;
  }
  return result;
}
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const aa = Object.keys(a), bb = Object.keys(b);
  return aa.length === bb.length && aa.every(key => Object.prototype.hasOwnProperty.call(b, key) && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
export function mcpDraftChanges(initial: McpDraft, current: McpDraft) {
  const before = serializeMcpDraft(initial), after = serializeMcpDraft(current), changes: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) if (!equal(before[key], after[key])) changes[key] = after[key] ?? null;
  return changes;
}
export function generateMcpServerKey(label: string, existing: readonly string[]) {
  const base = label.trim().replace(/\s/g, "_").replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").toLowerCase() || "custom-server";
  let candidate = base, suffix = 2;
  while (existing.includes(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}
export async function readMcpSettingsStatuses(): Promise<McpStatus[]> {
  const rows: McpStatus[] = [], seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: { data: McpStatus[]; nextCursor?: string | null } = await callAppServer("mcpServerStatus/list", { cursor, limit: 100, detail: "toolsAndAuthOnly" });
    if (!Array.isArray(page?.data)) throw Error("MCP 状态响应格式无效");
    rows.push(...page.data); cursor = page.nextCursor ?? null;
    if (cursor !== null) { if (typeof cursor !== "string" || seen.has(cursor)) throw Error("MCP 状态分页无效"); seen.add(cursor); }
  } while (cursor !== null);
  return rows;
}
const restartTargets = new Set<string>();
function verified(snapshot: McpSettingsSnapshot, action: McpSettingsAction, filePath: string | undefined) {
  if (action.type === "remove") {
    if (!snapshot.userLayer || snapshot.userLayer.filePath !== filePath) return false;
    const servers = snapshot.userLayer.config.mcp_servers;
    return servers === undefined || (servers !== null && typeof servers === "object" && !Array.isArray(servers) && !Object.prototype.hasOwnProperty.call(servers, action.name));
  }
  const raw = snapshot.entries.find(entry => entry.name === action.name && entry.source === "user")?.userRaw;
  if (!raw) return false;
  const expected = action.type === "add" ? action.config : action.type === "update" ? action.changes : { enabled: action.enabled };
  return Object.entries(expected).every(([key, value]) => value === null ? raw[key] === undefined : equal(raw[key], value));
}
type Editor = { entry: McpSettingsEntry | null; snapshot: McpSettingsSnapshot; initial: McpDraft; draft: McpDraft };
export function useMcpSettingsState({ cwd, connectionIdentity, onConfigUpdated, onRestartAppServer }: {
  cwd?: string; connectionIdentity: string; onConfigUpdated: () => void | Promise<void>; onRestartAppServer: () => void | Promise<unknown>;
}) {
  const context = JSON.stringify([cwd, connectionIdentity]);
  const [data, setData] = useState<McpSettingsSnapshot | null>(null), [viewContext, setViewContext] = useState(context);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null), [pending, setPending] = useState(false), [externalChange, setExternalChange] = useState(false);
  const [requiresRestart, setRequiresRestart] = useState(false), [statuses, setStatuses] = useState<Record<string, McpStatus>>({});
  const [statusError, setStatusError] = useState<string | null>(null), [statusMessages, setStatusMessages] = useState<Record<string, string>>({});
  const currentContext = useRef(context); currentContext.current = context;
  const snapshot = useRef<McpSettingsSnapshot | null>(null), currentEditor = useRef<Editor | null>(null);
  const operation = useRef(false), restartOperation = useRef(false), generation = useRef(0), revision = useRef(0), lifecycle = useRef(0), mounted = useRef(false);
  const intent = useRef<{ action: McpSettingsAction; filePath: string | undefined } | null>(null), queued = useRef(false), external = useRef(false);
  const statusRequests = useRef(new Set<string>());
  const callbacks = useRef({ onConfigUpdated, onRestartAppServer }); callbacks.current = { onConfigUpdated, onRestartAppServer };
  const refresh = useRef<(replace?: boolean) => Promise<boolean>>(async () => false);
  const valid = (version: number, key: string) => mounted.current && generation.current === version && currentContext.current === key;
  const dirty = () => Boolean(currentEditor.current && !equal(currentEditor.current.initial, currentEditor.current.draft));
  const edit = (value: Editor | null) => { currentEditor.current = value; setEditor(value); };
  const receive = (value: McpSettingsSnapshot) => { snapshot.current = value; setData(value); setViewContext(currentContext.current); setRequiresRestart(Boolean(value.userLayer && restartTargets.has(value.userLayer.filePath))); };
  const reload = async (replace = false): Promise<boolean> => {
    if (operation.current) { queued.current = true; return false; }
    const version = generation.current, key = currentContext.current, request = ++revision.current;
    setLoading(true); if (!intent.current) setError(null);
    const [configResult, statusResult] = await Promise.allSettled([readMcpSettings(cwd), readMcpSettingsStatuses()]);
    if (!valid(version, key) || revision.current !== request) return false;
    if (statusResult.status === "fulfilled") { setStatuses(Object.fromEntries(statusResult.value.map(row => [row.name, row]))); setStatusError(null); }
    else setStatusError(`无法读取 MCP 状态：${String(statusResult.reason)}`);
    if (configResult.status === "fulfilled") {
      const next = configResult.value, previous = snapshot.current;
      if (next.userLayer && previous && !equal(previous.entries.map(entry => [entry.name, entry.userRaw]), next.entries.map(entry => [entry.name, entry.userRaw]))) restartTargets.add(next.userLayer.filePath);
      receive(next);
      if (intent.current && verified(next, intent.current.action, intent.current.filePath)) { intent.current = null; setPending(false); setError(null); edit(null); external.current = false; setExternalChange(false); }
      else if (currentEditor.current) {
        const old = currentEditor.current;
        const nextEntry = old.entry ? next.entries.find(entry => entry.name === old.entry!.name) : null;
        if (replace) { edit({ entry: nextEntry ?? null, snapshot: next, initial: mcpDraft(nextEntry ?? undefined), draft: mcpDraft(nextEntry ?? undefined) }); external.current = false; setExternalChange(false); }
        else if (previous && (!equal(old.snapshot.userLayer, next.userLayer) || old.entry && !equal(old.entry.raw, nextEntry?.raw))) { external.current = true; setExternalChange(true); }
      }
    } else setError(`MCP 服务器设置不可用：${String(configResult.reason)}`);
    setLoading(false);
    return configResult.status === "fulfilled" && statusResult.status === "fulfilled";
  };
  refresh.current = reload;
  const checkStatus = async (name: string) => {
    if (statusRequests.current.has(name)) return;
    statusRequests.current.add(name);
    const version = generation.current, key = currentContext.current;
    setStatusMessages(previous => ({ ...previous, [name]: "正在读取状态…" }));
    try {
      const result = await readMcpServerStatus(name);
      if (!valid(version, key)) return;
      setStatusMessages(previous => ({ ...previous, [name]: describeMcpStatus(result) }));
      if (result) setStatuses(previous => ({ ...previous, [name]: result }));
    } catch (cause) { if (valid(version, key)) setStatusMessages(previous => ({ ...previous, [name]: `状态读取失败：${String(cause)}` })); }
    finally { if (valid(version, key)) statusRequests.current.delete(name); }
  };
  const mutate = async (action: McpSettingsAction, source = snapshot.current): Promise<boolean> => {
    if (!source || operation.current || restartOperation.current || intent.current) return false;
    const version = generation.current, key = currentContext.current;
    operation.current = true; revision.current++; setLoading(false); setBusy(true); setError(null);
    try {
      const result = await writeMcpServer(source, action);
      if (!valid(version, key)) return false;
      if (result.requiresRestart && source.userLayer) { restartTargets.add(source.userLayer.filePath); setRequiresRestart(true); }
      if (result.snapshot) receive(result.snapshot);
      if (result.verification !== "confirmed") {
        if (result.verification === "pending") { intent.current = { action, filePath: source.userLayer?.filePath }; setPending(true); }
        setError(result.error || "无法保存 MCP 服务器"); return false;
      }
      edit(null); external.current = false; setExternalChange(false);
      try { await callbacks.current.onConfigUpdated(); } catch (cause) { if (valid(version, key)) setError(`配置已保存，但无法刷新应用：${String(cause)}`); }
      return true;
    } catch (cause) { if (valid(version, key)) setError(`无法保存 MCP 服务器：${String(cause)}`); return false; }
    finally {
      if (valid(version, key)) { operation.current = false; setBusy(false); if (queued.current) { queued.current = false; void refresh.current(); } }
    }
  };
  const save = async () => {
    const selected = currentEditor.current;
    if (!selected || !selected.draft.label.trim() || !dirty() || external.current) return;
    const draft = selected.draft;
    if (!(draft.transport === "stdio" ? draft.command.trim() : draft.url.trim())) return;
    const action: McpSettingsAction = selected.entry ? { type: "update", name: selected.entry.name, changes: mcpDraftChanges(selected.initial, draft) }
      : { type: "add", name: generateMcpServerKey(draft.label, selected.snapshot.entries.map(entry => entry.name)), config: { ...serializeMcpDraft(draft), enabled: true } };
    if (action.type === "update" && !Object.keys(action.changes).length) { edit(null); return; }
    await mutate(action, selected.snapshot);
  };
  const restart = async () => {
    const target = snapshot.current?.userLayer?.filePath, ticket = lifecycle.current;
    if (!target || operation.current || restartOperation.current || intent.current || dirty()) return;
    restartOperation.current = true; setRestarting(true); setError(null);
    try {
      await callbacks.current.onRestartAppServer();
      if (!mounted.current || lifecycle.current !== ticket) return;
      if (!await refresh.current()) throw Error("重启后无法读取 MCP 状态，请重试。");
      if (!mounted.current || lifecycle.current !== ticket || snapshot.current?.userLayer?.filePath !== target) return;
      restartTargets.delete(target); setRequiresRestart(false);
    } catch (cause) { if (mounted.current && lifecycle.current === ticket) setError(`重启失败：${String(cause)}`); }
    finally { if (mounted.current && lifecycle.current === ticket) { restartOperation.current = false; setRestarting(false); } }
  };
  useEffect(() => { mounted.current = true; lifecycle.current++; return () => { mounted.current = false; lifecycle.current++; }; }, []);
  useEffect(() => {
    generation.current++; revision.current++; statusRequests.current.clear(); operation.current = false; intent.current = null; queued.current = false;
    snapshot.current = null; edit(null); setData(null); setViewContext(context); setLoading(false); setBusy(false); setPending(false); setError(null); setStatusMessages({}); setStatuses({}); setStatusError(null); external.current = false; setExternalChange(false);
    let disposed = false, stop: (() => void) | undefined;
    void tauriListen("mcp-settings-changed", () => { if (!disposed) void refresh.current(); }).then(dispose => { if (disposed) dispose(); else stop = dispose; }).catch(cause => { if (!disposed) setError(`无法接收 MCP 配置变更：${String(cause)}`); });
    const focus = () => { if (!disposed) void refresh.current(); };
    window.addEventListener("focus", focus); void reload();
    return () => { disposed = true; generation.current++; revision.current++; statusRequests.current.clear(); stop?.(); window.removeEventListener("focus", focus); };
  }, [context]);
  const visible = context === viewContext;
  const entries = data?.entries ?? [];
  const statusOnly: McpSettingsEntry[] = Object.keys(statuses).filter(name => !entries.some(entry => entry.name === name)).map(name => ({ name, raw: {}, userRaw: null, transport: "unknown", enabled: null, source: "plugin", readOnlyReason: "来自插件" }));
  return { data: visible ? data : null, entries: visible ? [...entries, ...statusOnly].sort((a, b) => a.name.localeCompare(b.name)) : [], editor: visible ? editor : null,
    loading: visible && loading, busy: visible && busy, pending: visible && pending, error: visible ? error : null, statuses: visible ? statuses : {}, statusError: visible ? statusError : null,
    statusMessages: visible ? statusMessages : {}, requiresRestart, restarting, externalChange: visible && externalChange, dirty: visible && dirty(),
    isDirty: dirty, canNavigate: () => !operation.current && !restartOperation.current,
    open: (entry?: McpSettingsEntry) => {
      const current = snapshot.current;
      if (!current?.userLayer || operation.current || restartOperation.current || intent.current || entry && (entry.readOnlyReason || entry.transport === "unknown" || entry.source !== "user")) return;
      const initial = mcpDraft(entry); edit({ entry: entry ?? null, snapshot: current, initial, draft: initial }); setError(null); external.current = false; setExternalChange(false);
      if (entry) void checkStatus(entry.name);
    },
    change: (draft: McpDraft) => { const current = currentEditor.current; if (current && !operation.current && !intent.current) edit({ ...current, draft }); },
    discard: () => { if (!operation.current && !restartOperation.current) { edit(null); setError(null); external.current = false; setExternalChange(false); } },
    save, remove: () => { const current = currentEditor.current; return current?.entry ? mutate({ type: "remove", name: current.entry.name }, current.snapshot) : Promise.resolve(false); },
    toggle: (entry: McpSettingsEntry) => entry.source === "user" && !entry.readOnlyReason && entry.enabled !== null ? mutate({ type: "toggle", name: entry.name, enabled: !entry.enabled }) : Promise.resolve(false),
    reload, restart, checkStatus };
}

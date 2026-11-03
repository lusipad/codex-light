import { useEffect, useRef, useState } from "react";
import { tauriInvoke, tauriListen } from "./bridge";
import { getConfigValue, type ConfigReadResult } from "./config";

export interface MemoryPreferencesSnapshot {
  hostId: string; hostName: string; userFile: string | null; version: string | null;
  feature: { name: string; enabled: boolean; catalogEnabled?: boolean; [key: string]: unknown } | null;
  config: Record<string, unknown>; origins: ConfigReadResult["origins"]; requirements: Record<string, unknown> | null;
  status: { v2Ready: boolean; v2ConsolidatedThreads: number } | null; statusError?: string | null;
  chronicle: { available: false }; disabledReason: string | null;
  locks?: { enabled?: string | null; externalContext?: string | null; reset?: string | null };
  mutation?: { complete: boolean; errors: string[] };
}
export function memoryPreferenceValues(snapshot: MemoryPreferencesSnapshot | null) {
  const raw = (key: string) => getConfigValue(snapshot?.config, key);
  const generate = raw("memories.generate_memories"), use = raw("memories.use_memories");
  const canonical = raw("memories.disable_on_external_context");
  const external = canonical ?? raw("memories.no_memories_if_mcp_or_web_search");
  const invalid = (value: unknown) => value != null && typeof value !== "boolean";
  const managed = (keys: string[]) => keys.some(key => {
    const origin = snapshot?.origins[key] ?? snapshot?.origins[key.split(".")[0]];
    return ["mdm", "sessionFlags", "legacyManagedConfigTomlFromFile", "legacyManagedConfigTomlFromMdm"].includes(String(origin?.name?.type));
  });
  const global = snapshot?.disabledReason || (!snapshot?.feature ? "这台电脑不支持 Codex 记忆功能" : null);
  const policy = "该值由管理员策略管理。", unknown = "当前配置值不可在此处编辑。";
  const enabledReason = global || snapshot?.locks?.enabled ||
    (managed(["features.memories", "memories.generate_memories", "memories.use_memories"]) ? policy :
      (snapshot?.feature && typeof snapshot.feature.enabled !== "boolean") || invalid(raw("features.memories")) || invalid(generate) || invalid(use) ? unknown : null);
  const externalReason = global || snapshot?.locks?.externalContext ||
    (managed(["memories.disable_on_external_context", "memories.no_memories_if_mcp_or_web_search"]) ? policy : invalid(external) ? unknown : null);
  return {
    enabled: snapshot?.feature?.enabled === true && (generate ?? true) === true && (use ?? true) === true,
    allowExternal: (external ?? false) === false,
    enabledReason, externalReason, resetReason: global || snapshot?.locks?.reset || null,
  };
}

export function useMemoryPreferences({ active, accountIdentity, connectionIdentity }: {
  active: boolean; accountIdentity?: string; connectionIdentity?: string;
}) {
  const identity = JSON.stringify([accountIdentity, connectionIdentity]);
  const [data, setData] = useState<MemoryPreferencesSnapshot | null>(null);
  const [dataIdentity, setDataIdentity] = useState(identity);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<"enabled" | "external-context" | "reset" | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState(false);
  const current = useRef({ identity, active }); current.current = { identity, active };
  const snapshot = useRef<MemoryPreferencesSnapshot | null>(null);
  const generation = useRef(0);
  const operation = useRef<string | null>(null);
  const queued = useRef(false);
  const refresh = useRef<() => Promise<void>>(async () => {});
  const valid = (version: number, context: string) => generation.current === version && current.current.identity === context && current.current.active;
  const receive = (result: MemoryPreferencesSnapshot) => { snapshot.current = result; setData(result); setDataIdentity(current.current.identity); };
  const read = async () => {
    if (!current.current.active) return;
    if (operation.current) { queued.current = true; return; }
    const version = generation.current, context = current.current.identity;
    operation.current = "read"; setLoading(true); setLoadError(null);
    try {
      const result = await tauriInvoke<MemoryPreferencesSnapshot>("memory_preferences_read");
      if (valid(version, context)) receive(result);
    } catch (cause) {
      if (valid(version, context)) setLoadError(`无法加载 Codex 记忆设置：${String(cause)}`);
    } finally {
      if (valid(version, context)) {
        operation.current = null; setLoading(false);
        if (queued.current) { queued.current = false; void refresh.current(); }
      }
    }
  };
  refresh.current = read;
  const reload = async () => { setActionError(null); setResetDone(false); await read(); };
  const mutate = async (kind: "enabled" | "external-context" | "reset", value?: boolean): Promise<boolean> => {
    const initial = snapshot.current;
    if (operation.current || !current.current.active || dataIdentity !== current.current.identity || !initial) return false;
    const fields = memoryPreferenceValues(initial);
    if ((kind === "enabled" && fields.enabledReason) || (kind === "external-context" && (fields.externalReason || !initial.feature?.enabled)) || (kind === "reset" && fields.resetReason)) return false;
    const version = generation.current, context = current.current.identity;
    operation.current = kind; setPending(kind); setActionError(null); setResetDone(false);
    try {
      let updated: MemoryPreferencesSnapshot;
      if (kind === "reset") {
        const result = await tauriInvoke<{ snapshot: MemoryPreferencesSnapshot; reset: boolean; chronicleCleared: boolean }>("memory_preferences_reset", { expectedHostId: initial.hostId });
        if (!valid(version, context)) return false;
        if (result.reset !== true) throw Error("删除结果未获确认。请重新加载后核对。");
        updated = result.snapshot;
      } else {
        updated = await tauriInvoke<MemoryPreferencesSnapshot>("memory_preferences_write", {
          expectedHostId: initial.hostId, expectedVersion: initial.version, operation: kind, value,
        });
        if (!valid(version, context)) return false;
      }
      if (updated.hostId !== initial.hostId) throw Error("执行主机已更改。请重新加载后核对。");
      receive(updated);
      if (kind !== "reset") {
        if (updated.mutation?.complete === false) throw Error(updated.mutation.errors.join("；") || "部分记忆设置未能更新。请重新加载后核对。");
        const actual = memoryPreferenceValues(updated);
        const verified = kind === "enabled"
          ? updated.feature?.enabled === value && getConfigValue(updated.config, "memories.generate_memories") === value && getConfigValue(updated.config, "memories.use_memories") === value
          : actual.allowExternal === value;
        if (!verified) throw Error("保存后的记忆设置与提交值不一致，请重新加载后核对。");
      }
      if (kind === "reset") setResetDone(true);
      return true;
    } catch (cause) {
      if (valid(version, context)) setActionError(`${kind === "reset" ? "无法删除 Codex 记忆" : kind === "external-context" ? "无法保存是否从使用过工具的聊天中创建记忆的偏好设置" : "无法更新 Codex 记忆设置"}：${String(cause)}`);
      return false;
    } finally {
      if (valid(version, context)) {
        operation.current = null; setPending(null);
        if (queued.current) { queued.current = false; void refresh.current(); }
      }
    }
  };
  useEffect(() => {
    generation.current++; operation.current = null; queued.current = false; snapshot.current = null;
    setData(null); setDataIdentity(identity); setLoading(false); setPending(null);
    setLoadError(null); setActionError(null); setResetDone(false);
    if (!active) return;
    let disposed = false, unlisten: (() => void) | undefined;
    void read();
    void tauriListen<{ hostId: string }>("memory-preferences-changed", change => {
      if (!disposed && current.current.identity === identity && (!snapshot.current || change.hostId === snapshot.current.hostId)) void refresh.current();
    }).then(dispose => { if (disposed) dispose(); else unlisten = dispose; })
      .catch(cause => { if (!disposed && current.current.identity === identity) setLoadError(`无法接收记忆设置变更：${String(cause)}`); });
    const onFocus = () => { if (!disposed && current.current.identity === identity) void refresh.current(); };
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true; generation.current++; operation.current = null; queued.current = false;
      unlisten?.(); window.removeEventListener("focus", onFocus);
    };
  }, [active, identity]);
  const visible = active && dataIdentity === identity;
  return { data: visible ? data : null, loading: visible && loading, pending: visible ? pending : null,
    error: visible ? actionError || loadError : null, resetDone: visible && resetDone,
    canNavigate: () => operation.current === null || operation.current === "read",
    reload, change: (kind: "enabled" | "external-context", value: boolean) => mutate(kind, value), reset: () => mutate("reset") };
}

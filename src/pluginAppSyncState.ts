import { useEffect, useRef, useState } from "react";
import { serviceErrorMessage } from "./chatgptService";
import { disablePluginAppSync, loadPluginAppSync, type PluginAppSyncSnapshot as Snapshot, type PluginAppSyncStatus } from "./pluginAppSync";

export interface PluginAppSyncState {
  scope: string;
  snapshot: Snapshot | null;
  loading: boolean;
  pending: boolean;
  blocked: boolean;
  error: string | null;
  unavailable: boolean;
  uncertain: boolean;
}
const empty = (scope: string): PluginAppSyncState => ({ scope, snapshot: null, loading: true, pending: false, blocked: true, error: null, unavailable: false, uncertain: false });
const complete = (snapshot: Snapshot) => snapshot.details.links !== null;
const actualScope = (snapshot: Snapshot) => JSON.stringify([snapshot.identity.accountId, snapshot.identity.userId, snapshot.identity.generation, snapshot.appId]);

export function usePluginAppSync(connectionIdentity: string, pluginId: string, appId: string | null, selectedLinkId: string | null) {
  const scope = JSON.stringify([connectionIdentity, pluginId, appId, selectedLinkId]);
  const current = useRef({ scope, version: 0, mounted: false, locked: false, state: empty(scope) });
  const request = useRef<AbortController | null>(null), ticket = useRef(0);
  const [state, setState] = useState<{ version: number; value: PluginAppSyncState } | null>(null);
  if (current.current.scope !== scope) {
    current.current.scope = scope; current.current.version++; current.current.locked = false; current.current.state = empty(scope);
  }
  const version = current.current.version;
  const active = () => current.current.mounted && current.current.scope === scope && current.current.version === version;
  const publish = (value: PluginAppSyncState) => { current.current.state = value; setState({ version: current.current.version, value }); };
  const replaceActualScope = (snapshot: Snapshot) => {
    current.current.version++; ticket.current++; current.current.locked = false;
    publish({ ...empty(scope), snapshot, loading: false, blocked: !complete(snapshot),
      error: complete(snapshot) ? null : snapshot.details.linksError?.message ?? "无法读取关联账户，请重试。" });
  };
  const reload = async () => {
    if (!active() || current.current.locked) return;
    request.current?.abort();
    const controller = new AbortController(), generation = ++ticket.current;
    request.current = controller;
    const valid = () => active() && ticket.current === generation && !controller.signal.aborted;
    publish({ ...current.current.state, loading: true, error: null, unavailable: false });
    try {
      const snapshot = await loadPluginAppSync(pluginId, appId, selectedLinkId, controller.signal);
      if (!valid()) return;
      if (current.current.state.snapshot && actualScope(current.current.state.snapshot) !== actualScope(snapshot)) { replaceActualScope(snapshot); return; }
      const ready = complete(snapshot);
      publish({ ...current.current.state, snapshot, loading: false, blocked: !ready, uncertain: ready ? false : current.current.state.uncertain,
        error: ready ? null : snapshot.details.linksError?.message ?? "无法读取关联账户，请重试。" });
    } catch (error) {
      if (!valid()) return;
      const unavailable = (error as { code?: string } | null)?.code === "app_not_in_plugin";
      publish({ ...current.current.state, snapshot: unavailable ? null : current.current.state.snapshot, loading: false, blocked: true,
        unavailable, error: unavailable ? null : serviceErrorMessage(error) });
    }
  };
  useEffect(() => {
    current.current.mounted = true; void reload();
    return () => { current.current.mounted = false; ticket.current++; request.current?.abort(); };
  }, [scope]);
  const disable = async (status: PluginAppSyncStatus): Promise<boolean> => {
    const before = current.current.state;
    if (!active() || current.current.locked || before.loading || before.blocked || !before.snapshot || !complete(before.snapshot)) return false;
    current.current.locked = true; request.current?.abort();
    const controller = new AbortController(), generation = ++ticket.current;
    request.current = controller;
    const valid = () => active() && ticket.current === generation && !controller.signal.aborted;
    publish({ ...before, pending: true, error: null });
    try {
      const result = await disablePluginAppSync(before.snapshot, status, selectedLinkId, controller.signal);
      if (!valid()) return false;
      if (result.snapshot && actualScope(before.snapshot) !== actualScope(result.snapshot)) { replaceActualScope(result.snapshot); return false; }
      const confirmed = result.confirmed && result.snapshot !== null && complete(result.snapshot) && result.refreshError === null;
      publish({ ...before, snapshot: result.snapshot ?? before.snapshot, pending: false, blocked: !confirmed, uncertain: !confirmed,
        error: confirmed ? null : result.refreshError ?? "无法确认同步是否已禁用，请重新读取后核对。" });
      return confirmed;
    } catch (error) {
      if (!valid()) return false;
      const code = (error as { code?: string } | null)?.code ?? "";
      const unavailable = code === "app_not_in_plugin";
      const uncertain = ["unknown", "pending", "accepted", "cancelled", "account_changed", "sync_write_unknown"].includes(code);
      publish({ ...before, snapshot: unavailable ? null : before.snapshot, pending: false, blocked: unavailable || uncertain, uncertain,
        unavailable, error: unavailable ? null : serviceErrorMessage(error) });
      return false;
    } finally { if (valid()) current.current.locked = false; }
  };
  return { state: state?.version === version && state.value.scope === scope ? state.value : current.current.state, reload, disable };
}

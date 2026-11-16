import { useEffect, useRef, useState } from "react";
import { serviceErrorMessage } from "./chatgptService";
import { loadPluginAppLinkPermissions, pluginAppPermissionAccounts, savePluginAppLinkPermissions,
  type PluginAppLinkPermissionsSnapshot as Snapshot } from "./pluginAppLinkPermissions";
import type { PluginPermission } from "./pluginPermissions";

export interface PluginAppLinkPermissionsState {
  scope: string;
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
  unavailable: "plugin" | "detail" | null;
  pending: boolean;
  blocked: boolean;
  failedLinkIds: string[];
  pendingLinkIds: string[];
  refreshError: string | null;
}
const empty = (scope: string): PluginAppLinkPermissionsState => ({ scope, snapshot: null, loading: true, error: null, unavailable: null,
  pending: false, blocked: true, failedLinkIds: [], pendingLinkIds: [], refreshError: null });
const complete = (snapshot: Snapshot) => snapshot.access === "allowed" && snapshot.details.links !== null && snapshot.defaultValue !== null && snapshot.defaultError === null;
const keepDefault = (snapshot: Snapshot, before: Snapshot | null): Snapshot => snapshot.defaultError && before?.defaultValue && before.appId === snapshot.appId &&
  before.identity.accountId === snapshot.identity.accountId && before.identity.userId === snapshot.identity.userId && before.identity.generation === snapshot.identity.generation ?
  { ...snapshot, defaultValue: before.defaultValue } : snapshot;

export function usePluginAppLinkPermissions(connectionIdentity: string, pluginId: string, appId: string | null) {
  const scope = JSON.stringify([connectionIdentity, pluginId, appId]);
  const current = useRef({ scope, version: 0, mounted: false, locked: false, state: empty(scope), retry: null as { value: PluginPermission | null } | null });
  const request = useRef<AbortController | null>(null), ticket = useRef(0);
  const [state, setState] = useState<{ version: number; value: PluginAppLinkPermissionsState } | null>(null);
  if (current.current.scope !== scope) {
    current.current.scope = scope; current.current.version++; current.current.locked = false; current.current.state = empty(scope); current.current.retry = null;
  }
  const version = current.current.version;
  const active = () => current.current.mounted && current.current.scope === scope && current.current.version === version;
  const publish = (value: PluginAppLinkPermissionsState) => { current.current.state = value; setState({ version: current.current.version, value }); };
  const replaceResolvedApp = (snapshot: Snapshot) => {
    current.current.version++; ticket.current++; current.current.locked = false; current.current.retry = null;
    publish({ ...empty(scope), snapshot, loading: false, blocked: !complete(snapshot),
      unavailable: snapshot.access === "denied" ? "detail" : null,
      error: snapshot.access === "unavailable" ? snapshot.defaultError ?? snapshot.details.linksError?.message ?? "无法读取账户权限，请重试。" : null,
      refreshError: snapshot.defaultError ?? snapshot.details.linksError?.message ?? null });
  };
  const retryIds = (snapshot: Snapshot, ids: string[], value: PluginPermission | null) => {
    const selected = new Set(ids);
    return pluginAppPermissionAccounts(snapshot).filter(account => selected.has(account.linkId) && account.editable && account.permission !== value).map(account => account.linkId);
  };
  const reload = async () => {
    if (!active() || current.current.locked) return;
    request.current?.abort();
    const controller = new AbortController(), generation = ++ticket.current;
    request.current = controller;
    const valid = () => active() && ticket.current === generation && !controller.signal.aborted;
    publish({ ...current.current.state, loading: true, error: null, unavailable: null });
    try {
      const loaded = await loadPluginAppLinkPermissions(pluginId, appId, controller.signal);
      if (!valid()) return;
      if (current.current.state.snapshot && current.current.state.snapshot.appId !== loaded.appId) { replaceResolvedApp(loaded); return; }
      const snapshot = keepDefault(loaded, current.current.state.snapshot);
      const ready = complete(snapshot), previous = current.current.state;
      const failedLinkIds = ready && current.current.retry ? retryIds(snapshot, previous.failedLinkIds, current.current.retry.value) : previous.failedLinkIds;
      publish({ ...previous, snapshot, loading: false, pending: false, blocked: !ready, failedLinkIds,
        pendingLinkIds: ready ? [] : previous.pendingLinkIds, unavailable: snapshot.access === "denied" ? "detail" : null,
        error: snapshot.access === "unavailable" ? snapshot.defaultError ?? snapshot.details.linksError?.message ?? "无法读取账户权限，请重试。" : null,
        refreshError: ready ? null : snapshot.defaultError ?? snapshot.details.linksError?.message ?? previous.refreshError });
    } catch (error) {
      if (!valid()) return;
      const unavailable = (error as { code?: string } | null)?.code === "app_not_in_plugin";
      publish({ ...current.current.state, snapshot: unavailable ? null : current.current.state.snapshot, loading: false, pending: false, blocked: true,
        unavailable: unavailable ? "plugin" : null, error: unavailable ? null : serviceErrorMessage(error) });
    }
  };
  useEffect(() => {
    current.current.mounted = true; void reload();
    return () => { current.current.mounted = false; ticket.current++; request.current?.abort(); };
  }, [scope]);
  const change = async (linkIds: string[], value: PluginPermission | null): Promise<boolean> => {
    const before = current.current.state;
    if (!active() || current.current.locked || before.loading || before.blocked || !before.snapshot || !complete(before.snapshot)) return false;
    const ids = [...new Set(linkIds)];
    if (ids.length === 0) return false;
    current.current.locked = true; current.current.retry = { value };
    request.current?.abort();
    const controller = new AbortController(), generation = ++ticket.current;
    request.current = controller;
    const valid = () => active() && ticket.current === generation && !controller.signal.aborted;
    publish({ ...before, pending: true, error: null, refreshError: null, failedLinkIds: [], pendingLinkIds: [] });
    try {
      const result = await savePluginAppLinkPermissions(before.snapshot, ids, value, controller.signal);
      if (!valid()) return false;
      if (result.snapshot && result.snapshot.appId !== before.snapshot.appId) { replaceResolvedApp(result.snapshot); return false; }
      const actual = result.snapshot ? keepDefault(result.snapshot, before.snapshot) : before.snapshot;
      const ready = result.snapshot !== null && complete(actual) && result.pendingLinkIds.length === 0 && result.refreshError === null;
      publish({ ...before, snapshot: actual, pending: false, blocked: !ready, error: actual.access === "unavailable" ? "无法读取账户权限，请重试。" : null,
        unavailable: actual.access === "denied" ? "detail" : null, failedLinkIds: result.failedLinkIds, pendingLinkIds: result.pendingLinkIds,
        refreshError: result.refreshError ?? (result.pendingLinkIds.length > 0 ? "无法确认部分账户权限是否已保存，请重新读取后核对。" :
          complete(actual) ? null : actual.defaultError ?? actual.details.linksError?.message ?? "无法完整读取账户权限，请重新读取后核对。") });
      return ready && result.failedLinkIds.length === 0;
    } catch (error) {
      if (!valid()) return false;
      const unavailable = (error as { code?: string } | null)?.code === "app_not_in_plugin";
      publish({ ...before, snapshot: unavailable ? null : before.snapshot, pending: false, blocked: true, failedLinkIds: [], pendingLinkIds: unavailable ? [] : ids,
        unavailable: unavailable ? "plugin" : null, error: unavailable ? null : serviceErrorMessage(error), refreshError: null });
      return false;
    } finally { if (valid()) current.current.locked = false; }
  };
  const retryFailed = async (): Promise<boolean> => {
    const before = current.current.state, retry = current.current.retry;
    if (!active() || current.current.locked || before.loading || before.blocked || !before.snapshot || !retry) return false;
    const ids = retryIds(before.snapshot, before.failedLinkIds, retry.value);
    if (ids.length === 0) { await reload(); return false; }
    return change(ids, retry.value);
  };
  const clearErrors = () => {
    if (!active() || current.current.locked || current.current.state.loading || current.current.state.blocked || current.current.state.pendingLinkIds.length > 0) return;
    current.current.retry = null;
    publish({ ...current.current.state, error: null, refreshError: null, failedLinkIds: [], pendingLinkIds: [] });
  };
  return { state: state?.version === version && state.value.scope === scope ? state.value : current.current.state, reload, change, retryFailed, clearErrors };
}

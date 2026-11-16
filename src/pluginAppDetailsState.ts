import { useEffect, useRef, useState } from "react";
import { serviceErrorMessage } from "./chatgptService";
import { loadPluginAppDetails } from "./pluginAppDetails";
import { savePluginAppAccountName } from "./pluginAppAccounts";

type Snapshot = Awaited<ReturnType<typeof loadPluginAppDetails>>;
export interface PluginAppDetailsState {
  scope: string;
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
  unavailable: boolean;
  pendingLinkId: string | null;
  blocked: boolean;
  writeError: string | null;
}

export function usePluginAppDetails(connectionIdentity: string, pluginId: string, appId: string) {
  const scope = JSON.stringify([connectionIdentity, pluginId, appId]);
  const current = useRef({ scope, version: 0, mounted: false, snapshot: null as Snapshot | null, loading: true, blocked: false, locked: false });
  const ticket = useRef(0), request = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ version: number; value: PluginAppDetailsState } | null>(null);
  if (current.current.scope !== scope) {
    current.current.scope = scope; current.current.version++; current.current.snapshot = null;
    current.current.loading = true; current.current.blocked = false; current.current.locked = false;
  }
  const version = current.current.version;
  const reload = async () => {
    if (!current.current.mounted || current.current.scope !== scope || current.current.version !== version || current.current.locked) return;
    request.current?.abort();
    const controller = new AbortController(), generation = ++ticket.current;
    request.current = controller;
    current.current.loading = true;
    const valid = () => current.current.mounted && current.current.scope === scope && current.current.version === version &&
      ticket.current === generation && !controller.signal.aborted;
    setState({ version, value: { scope, snapshot: current.current.snapshot, loading: true, error: null, unavailable: false,
      pendingLinkId: null, blocked: current.current.blocked, writeError: null } });
    try {
      const snapshot = await loadPluginAppDetails(pluginId, appId, controller.signal);
      if (!valid()) return;
      current.current.snapshot = snapshot;
      current.current.loading = false; current.current.blocked = false;
      setState({ version, value: { scope, snapshot, loading: false, error: null, unavailable: false, pendingLinkId: null, blocked: false, writeError: null } });
    } catch (error) {
      if (valid()) {
        const unavailable = (error as { code?: string } | null)?.code === "app_not_in_plugin";
        if (unavailable) current.current.snapshot = null;
        current.current.loading = false; current.current.blocked = true;
        setState({ version, value: { scope, snapshot: current.current.snapshot, loading: false, error: unavailable ? null : serviceErrorMessage(error), unavailable,
          pendingLinkId: null, blocked: true, writeError: null } });
      }
    }
  };
  useEffect(() => {
    current.current.mounted = true;
    void reload();
    return () => { current.current.mounted = false; ticket.current++; request.current?.abort(); };
  }, [scope]);
  const rename = async (linkId: string, name: string): Promise<boolean> => {
    const before = current.current.snapshot;
    if (!current.current.mounted || current.current.scope !== scope || current.current.version !== version || current.current.locked ||
      current.current.loading || current.current.blocked || !before) return false;
    const link = before.details.links?.find(link => link.id === linkId);
    if (!link || link.name?.trim() === name.trim()) return false;
    current.current.locked = true;
    request.current?.abort();
    const controller = new AbortController(), generation = ++ticket.current;
    request.current = controller;
    const valid = () => current.current.mounted && current.current.scope === scope && current.current.version === version &&
      ticket.current === generation && !controller.signal.aborted;
    setState({ version, value: { scope, snapshot: before, loading: false, error: null, unavailable: false,
      pendingLinkId: linkId, blocked: false, writeError: null } });
    try {
      const result = await savePluginAppAccountName(before, appId, linkId, name, controller.signal);
      if (!valid()) return false;
      const confirmed = result.confirmed && result.snapshot !== null;
      current.current.snapshot = result.snapshot ?? before; current.current.blocked = !confirmed;
      setState({ version, value: { scope, snapshot: current.current.snapshot, loading: false, error: null, unavailable: false,
        pendingLinkId: null, blocked: !confirmed, writeError: confirmed ? null : "无法确认账户昵称是否已保存，请重新读取后核对。" } });
      return confirmed;
    } catch (error) {
      if (!valid()) return false;
      const code = (error as { code?: string } | null)?.code, unavailable = code === "app_not_in_plugin";
      const blocked = !["forbidden", "invalid_request", "not_found"].includes(code ?? "");
      if (unavailable) current.current.snapshot = null;
      current.current.blocked = blocked;
      setState({ version, value: { scope, snapshot: current.current.snapshot, loading: false, error: null, unavailable,
        pendingLinkId: null, blocked, writeError: unavailable ? null : serviceErrorMessage(error) } });
      return false;
    } finally { if (valid()) current.current.locked = false; }
  };
  const clearRenameError = () => {
    if (!current.current.mounted || current.current.scope !== scope || current.current.version !== version || current.current.locked || current.current.blocked) return;
    setState(previous => previous?.version === version && previous.value.scope === scope ? { version, value: { ...previous.value, writeError: null } } : previous);
  };
  return { state: state?.value.scope === scope && state.version === version ? state.value : { scope, snapshot: null, loading: true, error: null, unavailable: false,
    pendingLinkId: null, blocked: false, writeError: null }, reload, rename, clearRenameError };
}

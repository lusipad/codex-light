import { useEffect, useRef, useState } from "react";
import { serviceErrorMessage } from "./chatgptService";
import { loadPluginAppDetails } from "./pluginAppDetails";
import { disconnectPluginAppAccount, savePluginAppAccountName } from "./pluginAppAccounts";

type Snapshot = Awaited<ReturnType<typeof loadPluginAppDetails>>;
type AccountAction = "rename" | "disconnect";
const unconfirmed = (action: AccountAction) => action === "rename" ? "无法确认账户昵称是否已保存，请重新读取后核对。" : "无法确认账户是否已断开，请重新读取后核对。";
export interface PluginAppDetailsState {
  scope: string;
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
  unavailable: boolean;
  pendingLinkId: string | null;
  pendingAction: AccountAction | null;
  blocked: boolean;
  writeError: string | null;
}

export function usePluginAppDetails(connectionIdentity: string, pluginId: string, appId: string) {
  const scope = JSON.stringify([connectionIdentity, pluginId, appId]);
  const current = useRef({ scope, version: 0, mounted: false, snapshot: null as Snapshot | null, loading: true, blocked: false, locked: false,
    uncertainAction: null as AccountAction | null });
  const ticket = useRef(0), request = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ version: number; value: PluginAppDetailsState } | null>(null);
  if (current.current.scope !== scope) {
    current.current.scope = scope; current.current.version++; current.current.snapshot = null;
    current.current.loading = true; current.current.blocked = false; current.current.locked = false;
    current.current.uncertainAction = null;
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
      pendingLinkId: null, pendingAction: null, blocked: current.current.blocked,
      writeError: current.current.uncertainAction ? unconfirmed(current.current.uncertainAction) : null } });
    try {
      const snapshot = await loadPluginAppDetails(pluginId, appId, controller.signal);
      if (!valid()) return;
      current.current.snapshot = snapshot;
      const blocked = current.current.uncertainAction !== null && snapshot.details.links === null;
      current.current.loading = false; current.current.blocked = blocked;
      if (!blocked) current.current.uncertainAction = null;
      setState({ version, value: { scope, snapshot, loading: false, error: null, unavailable: false, pendingLinkId: null, pendingAction: null, blocked,
        writeError: current.current.uncertainAction ? unconfirmed(current.current.uncertainAction) : null } });
    } catch (error) {
      if (valid()) {
        const unavailable = (error as { code?: string } | null)?.code === "app_not_in_plugin";
        if (unavailable) current.current.snapshot = null;
        current.current.loading = false; current.current.blocked = true;
        setState({ version, value: { scope, snapshot: current.current.snapshot, loading: false, error: unavailable ? null : serviceErrorMessage(error), unavailable,
          pendingLinkId: null, pendingAction: null, blocked: true,
          writeError: current.current.uncertainAction ? unconfirmed(current.current.uncertainAction) : null } });
      }
    }
  };
  useEffect(() => {
    current.current.mounted = true;
    void reload();
    return () => { current.current.mounted = false; ticket.current++; request.current?.abort(); };
  }, [scope]);
  const changeAccount = async (action: AccountAction, linkId: string, name = ""): Promise<Snapshot | null> => {
    const before = current.current.snapshot;
    if (!current.current.mounted || current.current.scope !== scope || current.current.version !== version || current.current.locked ||
      current.current.loading || current.current.blocked || !before) return null;
    const link = before.details.links?.find(link => link.id === linkId);
    if (!link || action === "rename" && link.name?.trim() === name.trim()) return null;
    current.current.locked = true;
    request.current?.abort();
    const controller = new AbortController(), generation = ++ticket.current;
    request.current = controller;
    const valid = () => current.current.mounted && current.current.scope === scope && current.current.version === version &&
      ticket.current === generation && !controller.signal.aborted;
    setState({ version, value: { scope, snapshot: before, loading: false, error: null, unavailable: false,
      pendingLinkId: linkId, pendingAction: action, blocked: false, writeError: null } });
    try {
      const result = await (action === "rename" ? savePluginAppAccountName(before, appId, linkId, name, controller.signal) :
        disconnectPluginAppAccount(before, appId, linkId, controller.signal));
      if (!valid()) return null;
      const confirmed = result.confirmed && result.snapshot !== null && result.snapshot.details.links !== null;
      current.current.snapshot = result.snapshot ?? before; current.current.blocked = !confirmed;
      current.current.uncertainAction = confirmed ? null : action;
      setState({ version, value: { scope, snapshot: current.current.snapshot, loading: false, error: null, unavailable: false,
        pendingLinkId: null, pendingAction: null, blocked: !confirmed, writeError: confirmed ? null : unconfirmed(action) } });
      return confirmed ? result.snapshot : null;
    } catch (error) {
      if (!valid()) return null;
      const code = (error as { code?: string } | null)?.code, unavailable = code === "app_not_in_plugin";
      const blocked = !["forbidden", "invalid_request", "not_found"].includes(code ?? "");
      if (unavailable) current.current.snapshot = null;
      current.current.blocked = blocked;
      current.current.uncertainAction = blocked && !unavailable ? action : null;
      setState({ version, value: { scope, snapshot: current.current.snapshot, loading: false, error: null, unavailable,
        pendingLinkId: null, pendingAction: null, blocked, writeError: unavailable ? null :
          action === "disconnect" ? "无法断开账户连接" : serviceErrorMessage(error) } });
      return null;
    } finally { if (valid()) current.current.locked = false; }
  };
  const rename = async (linkId: string, name: string): Promise<boolean> => (await changeAccount("rename", linkId, name)) !== null;
  const disconnect = (linkId: string): Promise<Snapshot | null> => changeAccount("disconnect", linkId);
  const clearRenameError = () => {
    if (!current.current.mounted || current.current.scope !== scope || current.current.version !== version || current.current.locked || current.current.blocked) return;
    setState(previous => previous?.version === version && previous.value.scope === scope ? { version, value: { ...previous.value, writeError: null } } : previous);
  };
  return { state: state?.value.scope === scope && state.version === version ? state.value : { scope, snapshot: null, loading: true, error: null, unavailable: false,
    pendingLinkId: null, pendingAction: null, blocked: false, writeError: null }, reload, rename, disconnect, clearRenameError };
}

import { useEffect, useRef, useState } from "react";
import { serviceErrorMessage } from "./chatgptService";
import { loadPluginAppDetails } from "./pluginAppDetails";

type Snapshot = Awaited<ReturnType<typeof loadPluginAppDetails>>;
export interface PluginAppDetailsState {
  scope: string;
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
  unavailable: boolean;
}

export function usePluginAppDetails(connectionIdentity: string, pluginId: string, appId: string) {
  const scope = JSON.stringify([connectionIdentity, pluginId, appId]);
  const current = useRef({ scope, version: 0, mounted: false, snapshot: null as Snapshot | null });
  const ticket = useRef(0), request = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ version: number; value: PluginAppDetailsState } | null>(null);
  if (current.current.scope !== scope) {
    current.current.scope = scope; current.current.version++; current.current.snapshot = null;
  }
  const version = current.current.version;
  const reload = async () => {
    if (!current.current.mounted || current.current.scope !== scope || current.current.version !== version) return;
    request.current?.abort();
    const controller = new AbortController(), generation = ++ticket.current;
    request.current = controller;
    const valid = () => current.current.mounted && current.current.scope === scope && current.current.version === version &&
      ticket.current === generation && !controller.signal.aborted;
    setState({ version, value: { scope, snapshot: current.current.snapshot, loading: true, error: null, unavailable: false } });
    try {
      const snapshot = await loadPluginAppDetails(pluginId, appId, controller.signal);
      if (!valid()) return;
      current.current.snapshot = snapshot;
      setState({ version, value: { scope, snapshot, loading: false, error: null, unavailable: false } });
    } catch (error) {
      if (valid()) {
        const unavailable = (error as { code?: string } | null)?.code === "app_not_in_plugin";
        if (unavailable) current.current.snapshot = null;
        setState({ version, value: { scope, snapshot: current.current.snapshot, loading: false, error: unavailable ? null : serviceErrorMessage(error), unavailable } });
      }
    }
  };
  useEffect(() => {
    current.current.mounted = true;
    void reload();
    return () => { current.current.mounted = false; ticket.current++; request.current?.abort(); };
  }, [scope]);
  return { state: state?.value.scope === scope && state.version === version ? state.value : { scope, snapshot: null, loading: true, error: null, unavailable: false }, reload };
}

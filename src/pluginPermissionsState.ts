import { useEffect, useRef, useState } from "react";
import { loadPluginPermissions, savePluginPermission, type PluginPermissionsSnapshot } from "./pluginPermissions";

export function usePluginPermissions(scope: string) {
  const current = useRef({ scope, mounted: false }); current.current.scope = scope;
  const epoch = useRef(0), locked = useRef(false), request = useRef<AbortController | null>(null);
  const data = useRef<PluginPermissionsSnapshot | null>(null);
  const [state, setState] = useState<{ scope: string; snapshot: PluginPermissionsSnapshot | null; loading: boolean; pending: boolean; blocked: boolean; error: string | null } | null>(null);
  const renderEpoch = epoch.current;
  const valid = (generation: number) => current.current.mounted && current.current.scope === scope && epoch.current === generation;
  const reload = async () => {
    if (!current.current.mounted || current.current.scope !== scope || locked.current) return;
    const generation = epoch.current, controller = new AbortController();
    request.current?.abort(); request.current = controller;
    setState({ scope, snapshot: data.current, loading: true, pending: false, blocked: true, error: null });
    try {
      const snapshot = await loadPluginPermissions(controller.signal);
      if (!valid(generation) || controller.signal.aborted) return;
      data.current = snapshot;
      setState({ scope, snapshot, loading: false, pending: false, blocked: false, error: null });
    } catch {
      if (valid(generation) && !controller.signal.aborted) setState({ scope, snapshot: data.current, loading: false, pending: false, blocked: true, error: "无法加载权限。请重试。" });
    }
  };
  useEffect(() => {
    current.current.mounted = true; epoch.current++; locked.current = false; data.current = null;
    void reload();
    return () => { current.current.mounted = false; epoch.current++; request.current?.abort(); };
  }, [scope]);
  const change = async (value: string) => {
    const before = data.current;
    if (!current.current.mounted || current.current.scope !== scope || renderEpoch !== epoch.current || locked.current || !state || state.scope !== scope ||
      state.loading || state.blocked || !before || before.access !== "allowed" || before.value === value) return;
    const generation = epoch.current, controller = new AbortController();
    request.current?.abort(); request.current = controller; locked.current = true;
    setState({ ...state, pending: true, error: null });
    try {
      const result = await savePluginPermission(before, value, controller.signal);
      if (!valid(generation) || controller.signal.aborted) return;
      data.current = result.snapshot ?? before;
      setState({ scope, snapshot: data.current, loading: false, pending: false, blocked: !result.confirmed,
        error: result.confirmed ? null : "无法确认权限保存结果，请重新读取后核对。" });
    } catch {
      if (valid(generation) && !controller.signal.aborted) setState({ scope, snapshot: before, loading: false, pending: false, blocked: true, error: "无法保存权限。请重试" });
    } finally { if (valid(generation)) locked.current = false; }
  };
  return { state: state?.scope === scope ? state : null, reload, change };
}

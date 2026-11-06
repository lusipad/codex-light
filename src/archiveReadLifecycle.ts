import { useEffect, useRef, useState } from "react";
import { tauriListen } from "./bridge";

// Shared only by the two account archive readers; each owns its data and pagination.
export function useArchiveReadLifecycle({ enabled, scope, connected, onReset, onReady, onListenerError, onCleanup }: {
  enabled: boolean; scope: string; connected: boolean;
  onReset: (disconnected: boolean) => void; onReady: (epoch: number) => void;
  onListenerError: () => void; onCleanup: () => void;
}) {
  const [retry, setRetry] = useState(0);
  const current = useRef({ enabled, scope, connected }); current.current = { enabled, scope, connected };
  const callbacks = useRef({ onReset, onReady, onListenerError, onCleanup }); callbacks.current = { onReset, onReady, onListenerError, onCleanup };
  const epoch = useRef(0), live = useRef({ mounted: false, subscribed: false, eventConnected: connected });
  const valid = (version: number, captured: string) => epoch.current === version && live.current.mounted && live.current.subscribed && live.current.eventConnected &&
    current.current.enabled && current.current.connected && current.current.scope === captured;
  useEffect(() => {
    live.current.mounted = true; live.current.subscribed = false; live.current.eventConnected = connected;
    let disposed = false, failed = false; const stops: (() => void)[] = [];
    const cleanup = () => { for (const stop of stops.splice(0)) stop(); };
    const reset = () => { epoch.current++; callbacks.current.onReset(enabled && (!current.current.connected || !live.current.eventConnected)); };
    const refresh = () => {
      reset();
      if (valid(epoch.current, scope)) callbacks.current.onReady(epoch.current);
    };
    reset();
    if (enabled) {
      const listen = <T,>(event: string, handler: (payload: T) => void) => tauriListen<T>(event, payload => {
        if (!disposed && !failed && current.current.enabled && current.current.scope === scope) handler(payload);
      }).then(stop => { if (disposed || failed) stop(); else stops.push(stop); });
      void Promise.all([
        listen<{ method: string }>("app-server:notification", event => { if (event.method === "account/updated") refresh(); }),
        listen<{ connected: boolean }>("app-server:status", status => { live.current.eventConnected = status.connected; refresh(); }),
        listen("chatgpt-service:invalidated", refresh),
      ]).then(() => { if (!disposed && !failed) { live.current.subscribed = true; refresh(); } }).catch(() => {
        if (disposed) return;
        failed = true; live.current.subscribed = false; cleanup(); reset(); callbacks.current.onListenerError();
      });
    }
    return () => { disposed = true; live.current.mounted = false; live.current.subscribed = false; epoch.current++; callbacks.current.onCleanup(); cleanup(); };
  }, [enabled, scope, connected, retry]);
  return { epoch, valid, retryListeners: () => {
    if (live.current.subscribed) { if (valid(epoch.current, scope)) callbacks.current.onReady(epoch.current); }
    else setRetry(value => value + 1);
  } };
}

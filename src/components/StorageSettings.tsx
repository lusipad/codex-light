import React, { useEffect, useRef, useState } from "react";
import { tauriListen } from "../bridge";
import { serviceIdentity } from "../chatgptService";
import { formatStorageBytes, readStorageUsage, storageFullness, type StorageUsage } from "../storageUsage";

export function StorageSettings({ scope }: { scope: string }) {
  const [snapshot, setSnapshot] = useState<{ scope: string; usage: StorageUsage } | null>(null);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const epoch = useRef(0);
  const usage = snapshot?.scope === scope ? snapshot.usage : null;
  useEffect(() => {
    let alive = true;
    let identityInvalidated = false;
    let controller: AbortController | null = null;
    const stops: (() => void)[] = [];
    const load = async () => {
      if (!alive || identityInvalidated || currentScope.current !== scope) return;
      const ticket = ++epoch.current;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      const valid = () => alive && currentScope.current === scope && epoch.current === ticket && !signal.aborted;
      setSnapshot(null); setError(""); setLoading(true);
      try {
        const identity = await serviceIdentity(signal);
        if (!valid()) return;
        const next = await readStorageUsage(identity, signal);
        if (valid()) setSnapshot({ scope, usage: next });
      } catch (cause) {
        if (valid()) setError(String(cause));
      } finally { if (valid()) setLoading(false); }
    };
    const refreshIdentity = () => { identityInvalidated = false; void load(); };
    const register = async (name: string, handler: (payload: any) => void) => {
      try {
        const stop = await tauriListen(name, handler);
        if (alive) stops.push(stop); else stop();
      } catch (cause) {
        if (alive && currentScope.current === scope) setSyncError(`存储配额同步失败：${String(cause)}`);
      }
    };
    setSyncError("");
    void Promise.all([
      register("app-server:notification", payload => { if (payload?.method === "account/updated") refreshIdentity(); }),
      register("app-server:status", refreshIdentity),
      register("chatgpt-service:invalidated", () => {
        if (!alive || currentScope.current !== scope) return;
        identityInvalidated = true; ++epoch.current; controller?.abort();
        setSnapshot(null); setError("账号状态已变化，请重新读取存储配额。"); setLoading(false);
      }),
    ]).then(() => { if (alive) void load(); });
    return () => { alive = false; ++epoch.current; controller?.abort(); stops.forEach(stop => stop()); };
  }, [scope, retry]);
  const fullness = usage ? storageFullness(usage) : null;
  return <div className="settings-scroll-container" aria-busy={loading || (!usage && !error)}>
    {syncError && <p role="alert" className="error-banner">{syncError} <button type="button" className="secondary-btn-sm"
      onClick={() => setRetry(value => value + 1)}>重试同步</button></p>}
    {error && <p role="alert" className="error-banner">无法加载存储空间使用情况：{error} <button type="button" className="secondary-btn-sm"
      onClick={() => setRetry(value => value + 1)}>重试</button></p>}
    {!usage && !error && <p role="status">正在读取云端存储配额…</p>}
    {usage && <section className="card-section">
      <h3>存储空间</h3>
      <p>已使用 {formatStorageBytes(usage.usedBytes)} / {formatStorageBytes(usage.allowedBytes)}</p>
      <p>剩余 {formatStorageBytes(usage.remainingBytes)}</p>
      {usage.allowedBytes > 0 && <progress aria-label="云端存储空间已使用" max={usage.allowedBytes} value={Math.min(usage.usedBytes, usage.allowedBytes)} />}
      {fullness === "full" && <p role="status">云端存储空间已满。</p>}
      {fullness === "almostFull" && <p role="status">云端存储空间即将用完。</p>}
      <button type="button" className="secondary-btn" onClick={() => setRetry(value => value + 1)}>重新读取</button>
    </section>}
  </div>;
}

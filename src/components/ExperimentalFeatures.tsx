import React, { useEffect, useRef, useState } from "react";
import { loadBetaFeatures, saveBetaFeature } from "../experimentalFeatures";
import type { ExperimentalFeature } from "../config";

export function ExperimentalFeatures({ connected }: { connected: boolean }) {
  const [features, setFeatures] = useState<ExperimentalFeature[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const load = async () => {
    if (!connected || pending.current) return;
    pending.current = true;
    const version = generation.current;
    setBusy(true); setReady(false); setError(null);
    try {
      const result = await loadBetaFeatures();
      if (version !== generation.current) return;
      setFeatures(result); setReady(true);
    } catch (error) {
      if (version === generation.current) setError(`无法读取实验功能：${String(error)}`);
    } finally {
      if (version === generation.current) { pending.current = false; setBusy(false); }
    }
  };
  useEffect(() => {
    setReady(false); setFeatures([]); setBusy(false); setError(null);
    void load();
    return () => { generation.current += 1; pending.current = false; };
  }, [connected]);
  const toggle = async (feature: ExperimentalFeature) => {
    if (!connected || !ready || pending.current) return;
    pending.current = true;
    const version = generation.current;
    setBusy(true); setError(null);
    try {
      const result = await saveBetaFeature(feature.name, !feature.enabled);
      if (version !== generation.current) return;
      setFeatures(previous => previous.map(item => item.name === feature.name ? { ...item, enabled: result.enabled } : item));
      setNotice(result.overridden
        ? "已保存，但当前值被其他配置层覆盖。重启 Codex Light 以应用实验功能更改。"
        : "重启 Codex Light 以应用实验功能更改。");
    } catch (error) {
      if (version === generation.current) { setError(String(error)); setReady(false); }
    } finally {
      if (version === generation.current) { pending.current = false; setBusy(false); }
    }
  };
  return <div className="card-section">
    <h3>实验功能（Beta）</h3>
    {!connected && <p role="status">连接 App-Server 后读取实验功能。</p>}
    {busy && <p role="status">正在读取或保存实验功能…</p>}
    {error && <div className="error-banner" role="alert">{error}</div>}
    {notice && <p role="status">{notice}</p>}
    {ready && !features.length && <p>当前没有可用的 Beta 实验功能。</p>}
    {features.map(feature => <div className="settings-row" key={feature.name}>
      <div><strong>{feature.displayName || feature.name}</strong><p className="card-subtitle-desc">{feature.description}</p></div>
      <label className="switch-control">
        <input type="checkbox" aria-label={feature.displayName || feature.name} checked={feature.enabled}
          disabled={!connected || !ready || busy} onChange={() => toggle(feature)} />
        <span className="switch-slider" />
      </label>
    </div>)}
    <button type="button" className="secondary-btn" disabled={!connected || busy} onClick={load}>重新读取</button>
  </div>;
}

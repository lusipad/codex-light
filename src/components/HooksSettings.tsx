import React, { useEffect, useRef, useState } from "react";
import { listHooks, type HookInfo, type HooksListResult } from "../hooksClient";
import { writeHookState } from "../hookState";

export function HooksSettings({ activeWorkspaceRoot }: { activeWorkspaceRoot: string }) {
  const [data, setData] = useState<HooksListResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [event, setEvent] = useState("");
  const operation = useRef(false);
  const generation = useRef(0);
  const cwds = activeWorkspaceRoot ? [activeWorkspaceRoot] : [];

  const run = async (action: () => Promise<HooksListResult>, saved = false) => {
    if (operation.current) return;
    operation.current = true;
    const version = generation.current;
    setBusy(true); setError(null); setMessage(null);
    try {
      const updated = await action();
      if (version !== generation.current) return;
      setData(updated);
      if (saved) setMessage("已保存并读回核验。");
    } catch (error) {
      if (version === generation.current) { setError(String(error)); setData(null); }
    } finally {
      if (version === generation.current) { operation.current = false; setBusy(false); }
    }
  };
  useEffect(() => {
    void run(() => listHooks(cwds));
    return () => { generation.current += 1; operation.current = false; };
  }, []);

  const visible = (data?.hooks ?? []).filter(hook =>
    (!source || hook.source === source) && (!event || hook.event === event)
  );
  const needsTrust = (hook: HookInfo) => !hook.isManaged && !!hook.currentHash &&
    (hook.trustStatus === "untrusted" || hook.trustStatus === "modified");
  const review = visible.filter(needsTrust);
  const write = (hooks: HookInfo[], change: "trust" | boolean) =>
    run(() => writeHookState(cwds, hooks, change), true);
  return (
    <div className="settings-scroll-container">
      <div className="card-section">
        <h3>生命周期挂钩</h3>
        <p className="card-subtitle-desc">管理配置和已启用插件提供的 Hooks。信任前请审阅命令及来源；托管项由组织控制。</p>
        <button type="button" className="secondary-btn" disabled={busy} onClick={() => void run(() => listHooks(cwds))}>
          {busy ? "处理中…" : "重新读取"}
        </button>
        {error && <div role="alert" className="error-banner">{error}</div>}
        {message && <div role="status" className="success-banner">{message}</div>}
        <div className="form-grid-row">
          <label>来源
            <select aria-label="Hook 来源" value={source} disabled={busy} onChange={e => setSource(e.target.value)}>
              <option value="">全部来源</option>
              {[...new Set(data?.hooks.map(hook => hook.source).filter(Boolean))].map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>事件
            <select aria-label="Hook 事件" value={event} disabled={busy} onChange={e => setEvent(e.target.value)}>
              <option value="">全部事件</option>
              {[...new Set(data?.hooks.map(hook => hook.event))].map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>
        {source && review.length > 0 && <button type="button" className="secondary-btn" disabled={busy} onClick={() => void write(review, "trust")}>信任当前来源待审阅项（{review.length}）</button>}
        {data?.warnings.map((item, index) => <p key={`w${index}`} role="status">{item.cwd}: {item.message}</p>)}
        {data?.errors.map((item, index) => <p key={`e${index}`} role="alert">{item.path || item.cwd}: {item.message}</p>)}
        {data && !visible.length && <p>没有匹配的 Hooks。</p>}
        <div className="item-cards-list">
          {visible.map(hook => <div className="item-card" key={`${hook.cwd}:${hook.id}`}>
            <div className="item-card-main">
              <strong>{hook.name}</strong>
              <p>{hook.event} · {hook.source} · {hook.trustStatus}{hook.isManaged ? " · 托管" : ""}</p>
              <code style={{ overflowWrap: "anywhere" }}>{hook.command}</code>
              <p>{hook.sourcePath}</p>
              <p>工作目录：{hook.cwd} · 匹配：{hook.matcher || "全部"}</p>
              <label><input type="checkbox" aria-label={`启用 ${hook.name}`} checked={hook.enabled} disabled={busy || hook.isManaged || !hook.currentHash || !hook.raw?.key} onChange={e => void write([hook], e.target.checked)} />已启用</label>
              {needsTrust(hook) && <button type="button" className="secondary-btn" disabled={busy} onClick={() => void write([hook], "trust")}>信任此定义</button>}
            </div>
          </div>)}
        </div>
      </div>
    </div>
  );
}

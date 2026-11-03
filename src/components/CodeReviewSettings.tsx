import React, { useEffect, useRef } from "react";
import type { CodeReviewPreferencesState } from "../reviewPreferences";

export function CodeReviewSettings({ state }: { state: CodeReviewPreferencesState }) {
  const current = useRef(state);
  current.current = state;
  const dirty = state.draft !== state.preferences.localReviewInstructions;
  useEffect(() => {
    if (!dirty || !state.ready || state.busy || state.error) return;
    const timer = window.setTimeout(() => {
      void current.current.save({ localReviewInstructions: current.current.draft });
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [state.draft, state.ready, state.busy, state.error, dirty]);
  useEffect(() => () => {
    const latest = current.current;
    if (latest.ready && !latest.busy && !latest.error && latest.draft !== latest.preferences.localReviewInstructions) {
      void latest.save({ localReviewInstructions: latest.draft });
    }
  }, []);
  const target = state.preferences.githubLinkTarget;
  const unsupportedTarget = target !== "code-review-tab" && target !== "external-browser";
  return <div className="settings-scroll-container">
    {state.error && <p role="alert" className="error-banner">{state.error}</p>}
    <button type="button" className="secondary-btn" disabled={state.busy} onClick={() => {
      if (dirty && !window.confirm("放弃尚未保存的审查指令并重新读取？")) return;
      void state.load();
    }}>重新读取</button>
    <div className="card-section">
      <h3>应用偏好</h3>
      <label className="form-field"><span>审查链接打开位置</span>
        <select aria-label="审查链接打开位置" value={target} disabled={!state.ready || state.busy}
          onChange={event => void state.save({ githubLinkTarget: event.target.value })}>
          {unsupportedTarget && <option value={target} disabled>请选择打开位置（原值：{target}）</option>}
          <option value="code-review-tab">代码审查标签页</option>
          <option value="external-browser">默认浏览器</option>
        </select>
      </label>
    </div>
    <div className="card-section">
      <h3>审查指令</h3>
      <p className="card-subtitle-desc">添加到你从 Pull Request 入口发起的审查，适用于所有仓库。</p>
      <textarea aria-label="审查指令" rows={6} value={state.draft} disabled={!state.ready || state.busy}
        onChange={event => state.setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            if (dirty && !state.busy) void state.save({ localReviewInstructions: state.draft });
          }
        }} />
      {dirty && <button type="button" className="primary-btn" disabled={!state.ready || state.busy}
        onClick={() => void state.save({ localReviewInstructions: state.draft })}>{state.busy ? "正在保存…" : "保存"}</button>}
    </div>
  </div>;
}

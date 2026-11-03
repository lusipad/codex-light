import React from "react";
import type { GitPreferencesState } from "../gitPreferences";

export function GitSettings({ state }: { state: GitPreferencesState }) {
  return <div className="settings-scroll-container"><div className="card-section">
    <h3>Git</h3>
    {state.error && <p role="alert" className="error-banner">{state.error}</p>}
    <button type="button" className="secondary-btn" disabled={state.busy} onClick={() => void state.reload()}>重新读取</button>
    <fieldset disabled={state.busy || !state.ready} style={{ border: 0, padding: 0 }}>
      <label className="settings-toggle-row">
        <span className="settings-toggle-label"><span className="settings-toggle-title">禁用基于 Git 的差异</span><span className="settings-toggle-desc">Changes 仅显示本轮改动，停用未提交、已暂存、分支和提交历史差异。</span></span>
        <input type="checkbox" checked={state.preferences["git-review-mode"] === "last-turn-only"} onChange={e => void state.save("git-review-mode", e.target.checked ? "last-turn-only" : "full")} />
      </label>
      <label className="settings-toggle-row">
        <span className="settings-toggle-label"><span className="settings-toggle-title">始终强制推送</span><span className="settings-toggle-desc">执行推送时使用 --force-with-lease。</span></span>
        <input type="checkbox" checked={state.preferences["git-always-force-push"]} onChange={e => void state.save("git-always-force-push", e.target.checked)} />
      </label>
      <label className="settings-toggle-row">
        <span className="settings-toggle-label"><span className="settings-toggle-title">创建草稿 Pull Request</span><span className="settings-toggle-desc">新建 Pull Request 时默认选择草稿。</span></span>
        <input type="checkbox" checked={state.preferences["git-create-pull-request-as-draft"]} onChange={e => void state.save("git-create-pull-request-as-draft", e.target.checked)} />
      </label>
    </fieldset>
  </div></div>;
}

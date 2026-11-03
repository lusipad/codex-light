import React, { useEffect, useRef, useState } from "react";
import type { CodeReviewPreferencesState } from "../reviewPreferences";
import { ReviewProviderSettings } from "./ReviewProviderSettings";

export function CodeReviewSettings({ state, providerScope = "local" }: { state: CodeReviewPreferencesState; providerScope?: string }) {
  const current = useRef(state);
  current.current = state;
  const mounted = useRef(true);
  const revision = useRef(0);
  const pending = useRef<{ revision: number; promise: Promise<boolean> } | null>(null);
  const feedback = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const dirty = state.draft !== state.preferences.localReviewInstructions;
  const flush = (): Promise<boolean> => {
    const ticket = revision.current;
    if (pending.current?.revision === ticket) return pending.current.promise;
    const latest = current.current;
    if (!latest.ready) return Promise.resolve(false);
    if (!pending.current && latest.draft === latest.preferences.localReviewInstructions) return Promise.resolve(true);
    window.clearTimeout(feedback.current);
    if (mounted.current) setStatus("saving");
    const promise = latest.save({ localReviewInstructions: latest.draft }).then(ok => {
      if (!mounted.current || pending.current?.promise !== promise) return ok;
      if (revision.current !== ticket) { setStatus("dirty"); return ok; }
      setStatus(ok ? "saved" : "error");
      if (ok) feedback.current = window.setTimeout(() => {
        if (mounted.current && revision.current === ticket) setStatus("idle");
      }, 3000);
      return ok;
    }).finally(() => { if (pending.current?.promise === promise) pending.current = null; });
    pending.current = { revision: ticket, promise };
    return promise;
  };
  useEffect(() => {
    if (!dirty || !state.ready || status === "error") return;
    const timer = window.setTimeout(() => {
      void flush();
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [state.draft, state.ready, dirty, status === "error"]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(feedback.current);
      const latest = current.current;
      if (latest.ready && (pending.current || latest.draft !== latest.preferences.localReviewInstructions)) void flush();
    };
  }, []);
  const target = state.preferences.githubLinkTarget;
  const unsupportedTarget = target !== "code-review-tab" && target !== "github";
  return <div className="settings-scroll-container">
    {state.error && <p role="alert" className="error-banner">{state.error}</p>}
    {state.syncError && <p role="alert" className="error-banner">{state.syncError} <button type="button" className="secondary-btn-sm" onClick={state.retrySync}>重试同步</button></p>}
    {!state.ready && state.error && <button type="button" className="secondary-btn" disabled={state.busy}
      onClick={() => void state.load()}>重试</button>}
    <div className="card-section">
      <h3>应用偏好</h3>
      <label className="form-field"><span>审查链接打开位置</span>
        <select aria-label="审查链接打开位置" value={target} disabled={!state.ready || state.busy}
          onChange={event => void state.save({ githubLinkTarget: event.target.value })}>
          {unsupportedTarget && <option value={target} disabled>请选择打开位置（原值：{target}）</option>}
          <option value="code-review-tab">代码审查标签页</option>
          <option value="github">Follow Browser Settings</option>
        </select>
      </label>
      <ReviewProviderSettings scope={providerScope} />
    </div>
    <div className="card-section">
      <h3>审查指令</h3>
      <p className="card-subtitle-desc">添加到你从 Pull Request 入口发起的审查，适用于所有仓库。</p>
      <div className="form-field"><textarea aria-label="审查指令" rows={10} value={state.draft} disabled={!state.ready}
        onChange={event => {
          revision.current += 1;
          window.clearTimeout(feedback.current);
          setStatus(pending.current ? "saving" : "dirty");
          state.setDraft(event.target.value);
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            void flush();
          }
        }} /></div>
      {(dirty || status === "saving" || status === "error") && <button type="button" className="primary-btn" disabled={!state.ready || status === "saving"}
        onClick={() => void flush()}>{status === "saving" ? "正在保存…" : "保存"}</button>}
      {!dirty && status === "saved" && <span role="status" aria-live="polite">已保存</span>}
    </div>
  </div>;
}

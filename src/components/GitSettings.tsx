import React, { useEffect, useRef, useState } from "react";
import type { GitPreferencesState } from "../gitPreferences";
import "./GitSettings.css";

const instructions = [
  { key: "git-commit-instructions", title: "提交指令", subtitle: "将添加到提交信息生成提示中", placeholder: "添加提交信息指引…" },
  { key: "git-pr-instructions", title: "Pull Request 指令", subtitle: "将添加到 PR 标题/描述生成提示中", placeholder: "添加 Pull Request 指引…" },
] as const;
type InstructionKey = typeof instructions[number]["key"];

export function GitSettings({ state }: { state: GitPreferencesState }) {
  const [drafts, setDrafts] = useState<Record<InstructionKey, string | null>>({ "git-commit-instructions": null, "git-pr-instructions": null });
  const [status, setStatus] = useState<Partial<Record<InstructionKey, "saving" | "saved" | "error" | "dirty">>>({});
  const latest = useRef(state); latest.current = state;
  const draft = useRef(drafts); draft.current = drafts;
  const mounted = useRef(true), sequence = useRef<Record<InstructionKey, number>>({ "git-commit-instructions": 0, "git-pr-instructions": 0 });
  const timers = useRef<Partial<Record<InstructionKey, number>>>({}), feedback = useRef<Partial<Record<InstructionKey, number>>>({});
  const pending = useRef(new Map<InstructionKey, { value: string; promise: Promise<boolean> }>());
  const flush = (key: InstructionKey, showState = true): Promise<boolean> => {
    window.clearTimeout(timers.current[key]); delete timers.current[key];
    const value = draft.current[key] ?? latest.current.preferences[key], before = pending.current.get(key);
    if (before?.value === value) return before.promise;
    if (!latest.current.instructionsReady) return Promise.resolve(false);
    if (!before && value === latest.current.preferences[key]) {
      if (mounted.current && draft.current[key] !== null) {
        draft.current = { ...draft.current, [key]: null }; setDrafts(draft.current);
        setStatus(current => ({ ...current, [key]: undefined }));
      }
      return Promise.resolve(true);
    }
    const ticket = ++sequence.current[key];
    if (showState && mounted.current) setStatus(current => ({ ...current, [key]: "saving" }));
    const promise = latest.current.save(key, value).then(ok => {
      if (!mounted.current || sequence.current[key] !== ticket) return ok;
      if (!ok) { setStatus(current => ({ ...current, [key]: "error" })); return false; }
      if (draft.current[key] !== value) { setStatus(current => ({ ...current, [key]: "dirty" })); return true; }
      draft.current = { ...draft.current, [key]: null }; setDrafts(draft.current);
      setStatus(current => ({ ...current, [key]: "saved" }));
      feedback.current[key] = window.setTimeout(() => { if (mounted.current) setStatus(current => ({ ...current, [key]: undefined })); }, 3000);
      return true;
    }).finally(() => { if (pending.current.get(key)?.promise === promise) pending.current.delete(key); });
    pending.current.set(key, { value, promise });
    return promise;
  };
  const change = (key: InstructionKey, value: string) => {
    draft.current = { ...draft.current, [key]: value }; setDrafts(draft.current);
    window.clearTimeout(timers.current[key]); window.clearTimeout(feedback.current[key]);
    setStatus(current => ({ ...current, [key]: "dirty" }));
    timers.current[key] = window.setTimeout(() => { void flush(key); }, 3000);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const { key } of instructions) { window.clearTimeout(timers.current[key]); window.clearTimeout(feedback.current[key]); if (draft.current[key] !== null) void flush(key, false); }
    };
  }, []);
  useEffect(() => {
    if (!state.instructionsReady) return;
    for (const { key } of instructions) if (draft.current[key] !== null && !timers.current[key] && !pending.current.has(key) && status[key] !== "error") timers.current[key] = window.setTimeout(() => { void flush(key); }, 3000);
  }, [state.instructionsReady]);
  return <div className="settings-scroll-container"><div className="card-section">
    <h3>Git</h3>
    {state.error && <p role="alert" className="error-banner">{state.error}</p>}
    <button type="button" className="secondary-btn" disabled={state.busy} onClick={async () => {
      if (latest.current.instructionsReady && !(await Promise.all(instructions.map(item => flush(item.key)))).every(Boolean)) return;
      await latest.current.reload();
    }}>重新读取</button>
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
    {instructions.map(item => {
      const value = drafts[item.key] ?? state.preferences[item.key];
      const dirty = drafts[item.key] !== null && (value !== state.preferences[item.key] || pending.current.has(item.key));
      return <section className="git-instructions" data-git-instruction={item.title} key={item.key}>
        <div className="git-instructions-header"><div><h4>{item.title}</h4><p className="card-subtitle-desc">{item.subtitle}</p></div>
          {(dirty || status[item.key] === "saving" || status[item.key] === "error") && <button type="button" className="secondary-btn-sm" disabled={!state.instructionsReady || status[item.key] === "saving"} onClick={() => void flush(item.key)}>{status[item.key] === "saving" ? "保存中…" : "保存"}</button>}
          {!dirty && status[item.key] === "saved" && <span role="status">已保存</span>}
        </div>
        <textarea aria-label={item.title} rows={6} placeholder={item.placeholder} value={value} disabled={!state.instructionsReady}
          onChange={event => change(item.key, event.target.value)} onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void flush(item.key); }
          }} />
        {status[item.key] === "error" && <p role="alert">保存失败，草稿已保留，请重试。</p>}
      </section>;
    })}
  </div></div>;
}

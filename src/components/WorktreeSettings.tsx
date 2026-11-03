import React, { useEffect, useRef, useState } from "react";
import { tauriInvoke } from "../bridge";

export function WorktreeSettings() {
  const [saved, setSaved] = useState("");
  const [draft, setDraft] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const readRoot = async () => {
    const value = await tauriInvoke<unknown>("desktop_state_get", { key: "git-worktree-root" });
    if (value !== null && typeof value !== "string") throw Error("工作树目录配置不是字符串。");
    return value ?? "";
  };
  useEffect(() => {
    const version = ++generation.current;
    void readRoot().then(value => {
      if (version !== generation.current) return;
      setSaved(value); setDraft(value); setReady(true);
    }).catch(error => {
      if (version === generation.current) setError(`读取工作树目录失败：${String(error)}`);
    });
    return () => { generation.current += 1; };
  }, []);
  const save = async () => {
    if (pending.current || !ready || draft === saved) return;
    pending.current = true;
    const version = generation.current;
    const value = draft.trim();
    setBusy(true); setError(null); setNotice(null);
    try {
      await tauriInvoke("desktop_state_set", { key: "git-worktree-root", value });
      const readback = await readRoot();
      if (readback !== value) throw Error("保存后读回不一致，请核对目录。");
      if (version !== generation.current) return;
      setSaved(readback); setDraft(readback); setNotice("已保存工作树目录");
    } catch (error) {
      if (version === generation.current) setError(`保存工作树目录失败：${String(error)}`);
    } finally {
      if (version === generation.current) { pending.current = false; setBusy(false); }
    }
  };
  return <div className="settings-scroll-container"><div className="card-section">
    <h3>工作树</h3>
    {error && <p role="alert" className="error-banner">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <label className="form-field">
      <span>工作树目录</span>
      <input aria-label="工作树目录" value={draft} disabled={!ready || busy} onChange={event => { setDraft(event.target.value); setNotice(null); }} />
      <span className="card-subtitle-desc">创建托管工作树的目录。留空使用默认位置。更改后用于新工作树，现有工作树保留在原位置。</span>
    </label>
    <button type="button" className="primary-btn" disabled={!ready || busy || draft === saved} onClick={() => void save()}>保存</button>
  </div></div>;
}

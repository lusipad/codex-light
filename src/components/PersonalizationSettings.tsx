import React, { useEffect, useRef, useState } from "react";
import { tauriInvoke } from "../bridge";

interface PersonalInstructions {
  path: string;
  contents: string;
  hasOverride: boolean;
}

export function PersonalizationSettings({ active }: { active: boolean }) {
  const [editing, setEditing] = useState(false);
  const [snapshot, setSnapshot] = useState<PersonalInstructions | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const operation = useRef(false);
  const generation = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const dirty = snapshot !== null && draft !== snapshot.contents;

  useEffect(() => () => { generation.current += 1; operation.current = false; }, []);
  useEffect(() => {
    if (active && confirmDiscard) dialog.current?.showModal();
    else dialog.current?.close();
  }, [active, confirmDiscard]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const load = async () => {
    if (operation.current) return;
    operation.current = true;
    const version = generation.current;
    setBusy(true); setError(null); setSaved(false);
    try {
      const result = await tauriInvoke<PersonalInstructions>("personal_instructions_read");
      if (version !== generation.current) return;
      setSnapshot(result); setDraft(result.contents);
    } catch (error) {
      if (version === generation.current) setError(`无法加载 Codex 指令：${String(error)}`);
    } finally {
      if (version === generation.current) { operation.current = false; setBusy(false); }
    }
  };
  const openEditor = () => {
    setEditing(true); setSaved(false);
    void load();
  };
  const closeEditor = () => {
    if (operation.current) return;
    setDraft(snapshot?.contents || ""); setError(null); setConfirmDiscard(false); setEditing(false);
    requestAnimationFrame(() => backButton.current?.focus());
  };
  const save = async () => {
    if (operation.current || !snapshot || !dirty) return;
    operation.current = true;
    const version = generation.current;
    setBusy(true); setError(null); setSaved(false);
    try {
      const result = await tauriInvoke<PersonalInstructions>("personal_instructions_write", {
        contents: draft, expectedContents: snapshot.contents,
      });
      if (version !== generation.current) return;
      setSnapshot(result); setDraft(result.contents); setSaved(true); setEditing(false);
      requestAnimationFrame(() => backButton.current?.focus());
    } catch (error) {
      if (version === generation.current) setError(`无法保存 Codex 指令：${String(error)}`);
    } finally {
      if (version === generation.current) { operation.current = false; setBusy(false); }
    }
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || !(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === "s" || event.key === "Enter") {
      event.preventDefault();
      void save();
    }
  };

  // Stay mounted across settings sections so navigation never silently drops a draft.
  if (!active) return null;
  return (
    <div className="settings-scroll-container" onKeyDown={editing ? onKeyDown : undefined}>
      {saved && <div className="success-banner" role="status">Codex 自定义指令已更新</div>}
      {!editing ? (
        <div className="card-section">
          <h3>自定义指令</h3>
          <button ref={backButton} type="button" className="secondary-btn" onClick={openEditor}>编辑 Codex 自定义指令</button>
        </div>
      ) : (
        <div className="card-section">
          <div className="settings-section-bottom-bar">
            <button type="button" className="secondary-btn" disabled={busy}
              onClick={() => { if (dirty) setConfirmDiscard(true); else closeEditor(); }}>返回</button>
            <button type="button" className="secondary-btn" disabled={busy} onClick={closeEditor}>取消</button>
            <button type="button" className="primary-btn" disabled={busy || !dirty || !snapshot} onClick={save}>{busy ? "处理中…" : "保存"}</button>
          </div>
          <h3><label htmlFor="personal-agents-editor">Codex 自定义指令</label></h3>
          <p className="card-subtitle-desc">为 Codex 提供适用于所有聊天的额外指令和背景信息。代码仓库指令也可能适用。</p>
          {snapshot?.hasOverride && <p role="status">这些说明已被 AGENTS.override.md 覆盖</p>}
          {error && <div role="alert" className="error-banner">{error}</div>}
          {busy && !snapshot && <p role="status">正在加载 Codex 指令…</p>}
          {!snapshot && !busy ? (
            <button type="button" className="secondary-btn" onClick={load}>重试</button>
          ) : (
            <textarea id="personal-agents-editor" className="code-editor-textarea" rows={13} style={{ minHeight: 0 }} autoFocus
              aria-label="Codex 自定义指令" placeholder="添加自定义指令…" disabled={busy || !snapshot}
              value={draft} onChange={event => setDraft(event.target.value)} />
          )}
        </div>
      )}
      <dialog ref={dialog} className="codex-modal-dialog" style={{ display: confirmDiscard && active ? "block" : "none", width: 420, height: "auto", padding: 24 }} onCancel={event => { event.preventDefault(); setConfirmDiscard(false); }}>
        <h3>放弃未保存的更改？</h3>
        <p>返回将放弃当前指令草稿。</p>
        <button type="button" className="secondary-btn" autoFocus onClick={() => setConfirmDiscard(false)}>继续编辑</button>
        <button type="button" className="primary-btn" onClick={closeEditor}>放弃更改</button>
      </dialog>
    </div>
  );
}

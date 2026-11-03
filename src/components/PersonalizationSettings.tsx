import React, { useEffect, useRef, useState } from "react";
import { isTauriRuntime, tauriInvoke, tauriListen } from "../bridge";
import { ChevronRightIcon } from "./Icons";
import "./PersonalizationSettings.css";

interface PersonalInstructions {
  hostId: string;
  path: string;
  contents: string;
  hasOverride: boolean;
}
type NavigationGuard = (action: () => void) => boolean;
const GUIDANCE_URL = "https://developers.openai.com/codex/guides/agents-md/#create-global-guidance";

export function PersonalizationSettings({ active, accountIdentity, connectionIdentity, onNavigationGuardChange }: {
  active: boolean; accountIdentity?: string; connectionIdentity?: string;
  onNavigationGuardChange?: (guard: NavigationGuard | null) => void;
}) {
  const identity = JSON.stringify([accountIdentity, connectionIdentity]);
  const [viewIdentity, setViewIdentity] = useState(identity);
  const [editing, setEditing] = useState(false);
  const [snapshot, setSnapshot] = useState<PersonalInstructions | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [externalChange, setExternalChange] = useState(false);
  const [confirmation, setConfirmation] = useState<"discard" | "reload" | null>(null);
  const operation = useRef<"read" | "write" | null>(null);
  const generation = useRef(0);
  const currentIdentity = useRef(identity);
  const currentSnapshot = useRef<PersonalInstructions | null>(null);
  const currentDraft = useRef("");
  const currentEditing = useRef(false);
  const currentActive = useRef(active);
  const pendingNavigation = useRef<(() => void) | null>(null);
  const refreshQueued = useRef(false);
  const refresh = useRef<() => Promise<void>>(async () => {});
  const saveCurrent = useRef<() => Promise<void>>(async () => {});
  const dialog = useRef<HTMLDialogElement>(null);
  const entryButton = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  currentIdentity.current = identity;
  currentActive.current = active;
  const dirtyNow = () => currentSnapshot.current !== null && currentDraft.current !== currentSnapshot.current.contents;
  const dirty = viewIdentity === identity && snapshot !== null && draft !== snapshot.contents;
  const setDraftValue = (value: string) => { currentDraft.current = value; setDraft(value); };
  const setSnapshotValue = (value: PersonalInstructions | null) => { currentSnapshot.current = value; setSnapshot(value); };
  const isCurrent = (version: number, context: string) => version === generation.current && context === currentIdentity.current;
  const restoreFocus = (entry = false) => {
    const version = generation.current, context = currentIdentity.current;
    requestAnimationFrame(() => {
      if (isCurrent(version, context) && currentActive.current) (entry ? entryButton.current : editor.current)?.focus();
    });
  };
  const openGuidance = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isTauriRuntime()) return;
    event.preventDefault(); setLinkError(null);
    const version = generation.current, context = currentIdentity.current;
    try { await tauriInvoke("open_help_link", { target: "global-guidance" }); }
    catch (cause) { if (isCurrent(version, context)) setLinkError(`无法打开说明文档：${String(cause)}`); }
  };

  const load = async (replaceDraft = false) => {
    if (operation.current) { refreshQueued.current = true; return; }
    operation.current = "read";
    const version = generation.current, context = currentIdentity.current;
    setBusy(true); setError(null);
    try {
      const result = await tauriInvoke<PersonalInstructions>("personal_instructions_read");
      if (!isCurrent(version, context)) return;
      const previous = currentSnapshot.current;
      if (!replaceDraft && dirtyNow()) {
        if (previous?.contents !== result.contents || previous?.path !== result.path || previous?.hostId !== result.hostId) setExternalChange(true);
        else setSnapshotValue({ ...previous, hasOverride: result.hasOverride });
      } else {
        setSnapshotValue(result); setDraftValue(result.contents); setExternalChange(false);
        if (replaceDraft) restoreFocus();
      }
    } catch (cause) {
      if (isCurrent(version, context)) setError(`说明加载失败：${String(cause)}`);
    } finally {
      if (isCurrent(version, context)) {
        operation.current = null; setBusy(false);
        if (refreshQueued.current) {
          refreshQueued.current = false;
          if (currentEditing.current && currentActive.current) void refresh.current();
        }
      }
    }
  };
  refresh.current = () => load();
  const closeEditor = () => {
    if (operation.current) return;
    setDraftValue(currentSnapshot.current?.contents ?? "");
    currentEditing.current = false; setEditing(false); setError(null); setExternalChange(false);
    pendingNavigation.current = null; setConfirmation(null); restoreFocus(true);
  };
  const guard: NavigationGuard = action => {
    if (currentIdentity.current !== identity) return true;
    if (!currentActive.current || !currentEditing.current) return true;
    if (operation.current) return false;
    if (!dirtyNow()) return true;
    pendingNavigation.current = action; setConfirmation("discard"); return false;
  };
  const save = async () => {
    const initial = currentSnapshot.current;
    if (viewIdentity !== currentIdentity.current || operation.current || !currentEditing.current || !initial || !dirtyNow()) return;
    operation.current = "write";
    const contents = currentDraft.current, version = generation.current, context = currentIdentity.current;
    setBusy(true); setError(null); setSaved(false);
    try {
      const result = await tauriInvoke<PersonalInstructions>("personal_instructions_write", {
        contents, expectedContents: initial.contents, expectedPath: initial.path, expectedHostId: initial.hostId,
      });
      if (!isCurrent(version, context)) return;
      if (result.path !== initial.path || result.hostId !== initial.hostId || result.contents !== contents) throw Error("写入后的指令与提交内容不一致，请重新加载后核对。");
      setSnapshotValue(result); setDraftValue(result.contents); setSaved(true); setExternalChange(false);
      currentEditing.current = false; setEditing(false); restoreFocus(true);
    } catch (cause) {
      if (isCurrent(version, context)) setError(`说明保存失败：${String(cause)}`);
    } finally {
      if (isCurrent(version, context)) {
        operation.current = null; setBusy(false);
        if (refreshQueued.current) {
          refreshQueued.current = false;
          if (currentEditing.current && currentActive.current) void refresh.current();
        }
      }
    }
  };
  saveCurrent.current = save;

  useEffect(() => {
    generation.current++; operation.current = null; refreshQueued.current = false;
    currentSnapshot.current = null; currentDraft.current = ""; currentEditing.current = false;
    setSnapshot(null); setDraft(""); setEditing(false); setBusy(false); setError(null); setLinkError(null);
    setSaved(false); setExternalChange(false); setConfirmation(null); pendingNavigation.current = null;
    setViewIdentity(identity);
    let disposed = false, unlisten: (() => void) | undefined;
    const context = identity;
    const onExternalChange = (change: { hostId: string; path: string }) => {
      if (disposed || currentIdentity.current !== context || !currentEditing.current) return;
      const loaded = currentSnapshot.current;
      if (loaded && (change.hostId !== loaded.hostId || change.path !== loaded.path)) return;
      if (dirtyNow()) setExternalChange(true);
      else void refresh.current();
    };
    void tauriListen("personal-instructions-changed", onExternalChange).then(dispose => {
      if (disposed) dispose(); else unlisten = dispose;
    }).catch(cause => { if (!disposed && currentIdentity.current === context) setError(`无法接收指令变更：${String(cause)}`); });
    const onFocus = () => { if (currentIdentity.current === context && currentEditing.current && currentActive.current) void refresh.current(); };
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true; generation.current++; operation.current = null; refreshQueued.current = false;
      pendingNavigation.current = null; unlisten?.(); window.removeEventListener("focus", onFocus);
    };
  }, [identity]);
  useEffect(() => {
    onNavigationGuardChange?.(active ? guard : null);
    return () => onNavigationGuardChange?.(null);
  }, [active, identity, onNavigationGuardChange]);
  useEffect(() => {
    if (active && confirmation) dialog.current?.showModal(); else dialog.current?.close();
  }, [active, confirmation]);
  useEffect(() => {
    if (!dirty && operation.current !== "write") return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, busy]);
  useEffect(() => {
    if (!active || !editing || viewIdentity !== identity) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || event.altKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      if (operation.current || !dirtyNow()) return;
      event.preventDefault(); void saveCurrent.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, editing, viewIdentity, identity]);
  useEffect(() => { if (active && editing && snapshot) restoreFocus(); }, [active, editing, Boolean(snapshot)]);

  if (!active) return null;
  const visible = viewIdentity === identity;
  const cancelConfirmation = () => { setConfirmation(null); pendingNavigation.current = null; restoreFocus(); };
  return <div className="settings-scroll-container personalization-settings" onKeyDown={visible && editing ? event => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.nativeEvent.isComposing && event.keyCode !== 229 && !operation.current && dirtyNow()) {
      event.preventDefault(); void saveCurrent.current();
    }
  } : undefined}>
    {visible && saved && <div className="success-banner" role="status">说明更新成功</div>}
    {visible && linkError && <div role="alert" className="error-banner">{linkError}</div>}
    {!visible || !editing ? <div className="personalization-instructions-entry">
      <button type="button" ref={entryButton} className="personalization-entry-row" onClick={() => {
        currentEditing.current = true; setEditing(true); setSaved(false); void load();
      }}><span><span className="personalization-entry-title">Codex 指令</span>
        <span className="personalization-entry-description">编辑所选机器上的 AGENTS.md 文件。代码仓库的说明也可能适用。</span></span>
        <ChevronRightIcon /></button>
      <a href={GUIDANCE_URL} target="_blank" rel="noreferrer" onClick={openGuidance}>了解更多</a>
    </div> : <div className="personalization-editor">
      <div className="personalization-toolbar">
        <button type="button" className="secondary-btn" disabled={busy} onClick={() => { if (guard(closeEditor)) closeEditor(); }}>返回</button>
        <span className="personalization-toolbar-spacer" />
        <button type="button" className="secondary-btn" disabled={busy} onClick={closeEditor}>取消</button>
        <button type="button" className="primary-btn" disabled={busy || !dirty || !snapshot} onClick={save}>保存</button>
      </div>
      <h3><label htmlFor="personal-agents-editor">Codex 指令</label></h3>
      <p className="card-subtitle-desc">编辑所选机器上的 AGENTS.md 文件。代码仓库的说明也可能适用。 <a href={GUIDANCE_URL} target="_blank" rel="noreferrer" onClick={openGuidance}>了解更多</a></p>
      {snapshot?.hasOverride && <p role="status" className="personalization-notice">这些说明已被 AGENTS.override.md 覆盖</p>}
      {externalChange && <div role="status" className="personalization-notice">说明已在其他位置更改。你的草稿已保留。
        <button type="button" className="secondary-btn" disabled={busy} onClick={() => { if (dirtyNow()) setConfirmation("reload"); else void load(true); }}>重新加载</button>
      </div>}
      {error && <div role="alert" className="error-banner">{error}<button type="button" className="secondary-btn" disabled={busy} onClick={() => void load()}>重试</button></div>}
      {busy && !snapshot && <p role="status">说明加载中…</p>}
      {snapshot && <textarea ref={editor} id="personal-agents-editor" className="code-editor-textarea" rows={13}
        aria-label="Codex 指令" placeholder="添加自定义指令…" disabled={operation.current === "write"}
        value={draft} onChange={event => setDraftValue(event.target.value)} />}
    </div>}
    <dialog ref={dialog} className="codex-modal-dialog personalization-discard-dialog" onCancel={event => { event.preventDefault(); cancelConfirmation(); }}>
      <h3>放弃未保存的更改？</h3>
      <p>{confirmation === "reload" ? "重新加载将放弃当前指令草稿。" : "离开将放弃当前指令草稿。"}</p>
      <div className="personalization-dialog-actions">
        <button type="button" className="secondary-btn" autoFocus onClick={cancelConfirmation}>继续编辑</button>
        <button type="button" className="primary-btn" onClick={() => {
          if (operation.current) return;
          const action = pendingNavigation.current, reload = confirmation === "reload";
          pendingNavigation.current = null; setConfirmation(null);
          if (reload) { void load(true); return; }
          closeEditor(); action?.();
        }}>放弃更改</button>
      </div>
    </dialog>
  </div>;
}

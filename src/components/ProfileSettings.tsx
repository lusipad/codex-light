import React, { useEffect, useRef, useState } from "react";
import { tauriInvoke } from "../bridge";
import { usePublicProfileSettings } from "../publicProfileSettings";
import "./ProfileSettings.css";

function remoteUrl(value: string | null | undefined) {
  try { const url = new URL(value || ""); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export function ProfileSettings({ accountIdentity, connectionIdentity, onNavigationGuardChange }: {
  accountIdentity?: string; connectionIdentity?: string;
  onNavigationGuardChange?: (guard: ((action: () => void) => boolean) | null) => void;
} = {}) {
  const state = usePublicProfileSettings({ accountIdentity, connectionIdentity });
  const [confirmation, setConfirmation] = useState<"discard" | "reload" | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const editDialog = useRef<HTMLDialogElement>(null), discardDialog = useRef<HTMLDialogElement>(null);
  const editButton = useRef<HTMLButtonElement>(null), nameInput = useRef<HTMLInputElement>(null);
  const pendingAction = useRef<(() => void) | null>(null), epoch = useRef(0);
  const editorContext = JSON.stringify([accountIdentity, connectionIdentity, state.data?.identity?.accountId, state.data?.identity?.userId]);
  const previousEditor = useRef({ editing: false, context: editorContext });
  const latest = useRef(state); latest.current = state;
  const restoreFocus = (toEditor = false) => {
    const version = epoch.current;
    requestAnimationFrame(() => {
      if (version === epoch.current) (toEditor ? nameInput.current : editButton.current)?.focus();
    });
  };
  const guard = (action: () => void) => {
    if (!latest.current.canNavigate()) return false;
    if (!latest.current.isDirty()) return true;
    pendingAction.current = action; setConfirmation("discard"); return false;
  };
  useEffect(() => {
    epoch.current++; setConfirmation(null); setLinkError(null); pendingAction.current = null;
    return () => { epoch.current++; };
  }, [editorContext]);
  useEffect(() => {
    onNavigationGuardChange?.(guard);
    return () => onNavigationGuardChange?.(null);
  }, [accountIdentity, connectionIdentity, onNavigationGuardChange]);
  useEffect(() => {
    if (state.editing) { editDialog.current?.showModal(); nameInput.current?.focus(); }
    else { editDialog.current?.close(); if (previousEditor.current.editing && previousEditor.current.context === editorContext) restoreFocus(); }
    previousEditor.current = { editing: state.editing, context: editorContext };
  }, [state.editing, editorContext]);
  useEffect(() => { if (confirmation) discardDialog.current?.showModal(); else discardDialog.current?.close(); }, [confirmation]);
  useEffect(() => {
    if (!state.dirty && !state.saving) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.dirty, state.saving]);
  const reload = () => { if (state.isDirty() && !state.pending) setConfirmation("reload"); else void state.reload(); };
  const profile = state.profile, account = state.data?.account.account;
  const picture = remoteUrl(profile?.pictureUrl), url = remoteUrl(profile?.profileUrl);
  const readErrors = state.data ? [state.data.errors.profile, state.data.errors.page].filter(Boolean) : [];
  const invalid = !state.draft.displayName.trim() || state.draft.displayName.length > 64 || state.draft.bio.length > 140;
  return <div className="settings-scroll-container public-profile-settings" aria-busy={state.loading || state.saving}>
    {state.loading && !state.data && <p role="status">正在加载个人资料…</p>}
    {(state.error || readErrors.length > 0) && <div role="alert" className="error-banner">{state.error || readErrors.join("；")}
      <button type="button" className="secondary-btn" disabled={state.saving} onClick={reload}>重试</button></div>}
    {linkError && <p role="alert" className="error-banner">{linkError}</p>}
    {state.pending && <p role="status">已提交，等待个人资料同步。<button type="button" className="secondary-btn" disabled={state.loading || state.saving} onClick={() => void state.reload()}>重新读取</button></p>}
    {state.data && account?.type !== "chatgpt" && <p>{account?.type === "apiKey" ? "当前使用 API Key" : account?.type === "amazonBedrock" ? "当前使用 Amazon Bedrock" : account ? "当前账户不支持个人资料" : "未登录"}</p>}
    {state.data && account?.type === "chatgpt" && profile && <section className="public-profile-header">
      {picture && <img src={picture} alt="个人资料头像" referrerPolicy="no-referrer" className="public-profile-picture" />}
      <div className="public-profile-summary"><h3>{profile.displayName || "ChatGPT 用户"}</h3>
        {profile.username && <p className="public-profile-username">@{profile.username}</p>}
        {profile.bio && <p className="public-profile-bio">{profile.bio}</p>}
        {url && <a href={url} target="_blank" rel="noreferrer" onClick={event => {
          event.preventDefault(); const version = epoch.current; setLinkError(null);
          void tauriInvoke("review_link_open", { url }).catch(cause => { if (version === epoch.current) setLinkError(`无法打开个人资料：${String(cause)}`); });
        }}>查看个人资料</a>}
      </div>
      <button type="button" className="secondary-btn" ref={editButton} disabled={!state.canEdit || state.saving || state.pending} onClick={state.openEditor}>编辑个人资料</button>
    </section>}
    {state.data && account?.type === "chatgpt" && !profile && !readErrors.length && <p role="status">无法加载此个人资料</p>}
    {state.data?.page && !state.canEdit && <p role="status">当前个人资料不可编辑。</p>}
    <button type="button" className="secondary-btn public-profile-refresh" disabled={state.saving || state.loading} onClick={reload}>重新读取</button>
    <dialog ref={editDialog} className="codex-modal-dialog public-profile-edit-dialog" aria-labelledby="public-profile-edit-title"
      onCancel={event => { event.preventDefault(); if (guard(() => { state.discard(); restoreFocus(); })) { state.discard(); restoreFocus(); } }}
      onKeyDown={event => {
        if (event.key === "Escape" && (event.nativeEvent.isComposing || event.keyCode === 229)) { event.preventDefault(); event.stopPropagation(); }
      }}>
      <h3 id="public-profile-edit-title">编辑个人资料</h3>
      {state.error && <p role="alert" className="error-banner">{state.error}</p>}
      {state.pending && <p role="status">已提交，等待个人资料同步。<button type="button" className="secondary-btn" disabled={state.loading} onClick={() => void state.reload()}>重新读取</button></p>}
      {state.externalChange && <p role="status">个人资料已在其他位置更改。你的草稿已保留。<button type="button" className="secondary-btn" disabled={state.saving} onClick={() => setConfirmation("reload")}>重新加载</button></p>}
      <label htmlFor="public-profile-name">显示名称</label>
      <input id="public-profile-name" ref={nameInput} value={state.draft.displayName} maxLength={64} autoComplete="off" disabled={state.saving || state.pending || !state.canEdit}
        onChange={event => state.setField("displayName", event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void state.save(); } }} />
      <label htmlFor="public-profile-bio">简介</label>
      <textarea id="public-profile-bio" value={state.draft.bio} maxLength={140} rows={3} placeholder="关于你的简短介绍" disabled={state.saving || state.pending || !state.canEdit}
        onChange={event => state.setField("bio", event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) event.preventDefault(); }} />
      <div className="public-profile-edit-actions"><button type="button" className="secondary-btn" disabled={state.saving} onClick={() => { state.discard(); restoreFocus(); }}>取消</button>
        <button type="button" className="primary-btn" disabled={invalid || state.saving || state.pending || state.externalChange || !state.canEdit} onClick={() => void state.save()}>保存</button></div>
    </dialog>
    <dialog ref={discardDialog} className="codex-modal-dialog public-profile-discard-dialog" aria-labelledby="public-profile-discard-title"
      onCancel={event => { event.preventDefault(); setConfirmation(null); pendingAction.current = null; restoreFocus(true); }}>
      <h3 id="public-profile-discard-title">放弃未保存的更改？</h3>
      <p>{confirmation === "reload" ? "重新加载将放弃当前个人资料草稿。" : "离开将放弃当前个人资料草稿。"}</p>
      <div className="public-profile-edit-actions"><button type="button" className="secondary-btn" autoFocus onClick={() => { setConfirmation(null); pendingAction.current = null; restoreFocus(true); }}>继续编辑</button>
        <button type="button" className="primary-btn" onClick={() => {
          if (!state.canNavigate()) return;
          const action = pendingAction.current, replace = confirmation === "reload";
          pendingAction.current = null; setConfirmation(null);
          if (replace) { void state.reload(true).then(() => restoreFocus(true)); return; }
          state.discard(); action?.();
        }}>放弃更改</button></div>
    </dialog>
  </div>;
}

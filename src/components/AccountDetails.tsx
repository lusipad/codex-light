import React, { useEffect, useRef } from "react";
import { useAccountDetails } from "../accountDetails";
import { normalizeUsername, usernameValidationMessage } from "../accountProfile";
import "./AccountDetails.css";

export function AccountDetails({ accountIdentity, connectionIdentity, accountEmail, onNavigationGuardChange }: {
  accountIdentity?: string; connectionIdentity: string; accountEmail?: string | null;
  onNavigationGuardChange?: (guard: ((action: () => void) => boolean) | null) => void;
}) {
  const state = useAccountDetails({ accountIdentity, connectionIdentity, onNavigationGuardChange });
  const nameButton = useRef<HTMLButtonElement>(null), usernameButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null), confirmation = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const context = JSON.stringify([accountIdentity, connectionIdentity, state.snapshot?.identity?.accountId, state.snapshot?.identity?.userId]);
  const current = useRef({ context, mounted: true }); current.current.context = context;
  const previous = useRef<{ context: string; editing: "name" | "username" } | null>(null);
  useEffect(() => { current.current.mounted = true; return () => { current.current.mounted = false; }; }, []);
  useEffect(() => {
    if (state.editing) {
      previous.current = { context, editing: state.editing };
      if (!dialog.current?.open) dialog.current?.showModal();
      input.current?.focus();
    } else {
      dialog.current?.close();
      const old = previous.current; previous.current = null;
      if (old?.context === context) requestAnimationFrame(() => {
        if (current.current.mounted && current.current.context === old.context) (old.editing === "name" ? nameButton.current : usernameButton.current)?.focus();
      });
    }
  }, [state.editing, context]);
  useEffect(() => {
    if (state.confirmation && !confirmation.current?.open) confirmation.current?.showModal();
    else if (!state.confirmation) confirmation.current?.close();
  }, [state.confirmation]);
  const data = state.snapshot, username = data?.profile?.username?.trim();
  const syntax = state.editing === "username" ? usernameValidationMessage(state.draft) : null;
  const canSave = !state.busy && !state.pending && state.dirty && (state.editing === "name" ? Boolean(state.draft.trim() && data?.me) :
    !syntax && data?.profile?.canEditUsername === true && state.availability === "available");
  return <div className="account-details">
    {state.loading && !data && <p role="status">正在加载账户资料…</p>}
    {state.error && <p role="alert" className="error-banner">{state.error}</p>}
    <div className="account-settings-row"><span>姓名</span><button ref={nameButton} type="button" className="account-details-value" disabled={!data?.me || state.busy} onClick={() => state.open("name")}>{data?.me?.name || "未取得"}</button></div>
    {data?.errors.me && <p role="alert">{data.errors.me}</p>}
    <div className="account-settings-row"><span>用户名</span><button ref={usernameButton} type="button" className="account-details-value" disabled={data?.profile?.canEditUsername !== true || state.busy} onClick={() => state.open("username")}>{username ? `@${username}` : data?.profile ? "添加" : "未取得"}</button></div>
    {data?.errors.profile && <p role="alert">{data.errors.profile}</p>}
    <div className="account-settings-row"><span>电子邮箱</span><span className="account-settings-value">{data?.me?.email ?? accountEmail ?? "未取得"}</span></div>
    <button type="button" className="secondary-btn account-details-refresh" disabled={state.loading || state.busy} onClick={state.requestReload}>重新读取</button>
    <dialog ref={dialog} className="codex-modal-dialog account-details-dialog" onCancel={event => { event.preventDefault(); state.requestClose(); }}>
      <h3>{state.editing === "username" ? "编辑用户名" : "姓名"}</h3>
      <form onSubmit={event => { event.preventDefault(); if (canSave) void state.save(); }}>
        <label htmlFor="account-detail-input">{state.editing === "username" ? "用户名" : "姓名"}</label>
        <input id="account-detail-input" ref={input} value={state.draft} disabled={state.busy || state.pending} autoComplete="off" spellCheck={false}
          onChange={event => state.changeDraft(event.target.value)} onKeyDown={event => {
            if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
          }} />
        {state.editing === "username" && <p className="account-details-help">请使用 3-20 个小写字母、数字、句点、下划线或连字符</p>}
        {state.editing === "username" && syntax && <p role="alert">{syntax}</p>}
        {state.editing === "username" && !syntax && state.availability !== "idle" && <p role="status">{{ checking: "正在检查用户名是否可用…", available: "用户名可用", unavailable: "该用户名已被占用", error: "无法检查用户名是否可用。请重试" }[state.availability]}</p>}
        {state.availability === "error" && <button type="button" className="secondary-btn" onClick={state.retryCheck}>重试</button>}
        {state.externalChange && <p role="status">账户资料已在其他位置更改。重新读取会替换当前草稿。</p>}
        {state.editorError && <p role="alert">{state.editorError}</p>}
        {state.pending && <button type="button" className="secondary-btn" disabled={state.loading} onClick={state.requestReload}>重新读取核验</button>}
        <div className="account-details-actions"><button type="button" className="secondary-btn" disabled={state.busy} onClick={state.requestClose}>取消</button>
          <button type="submit" className="primary-btn" disabled={!canSave}>{state.editing === "username" ? "更改用户名" : "保存"}</button></div>
      </form>
    </dialog>
    <dialog ref={confirmation} className="codex-modal-dialog account-details-dialog" onCancel={event => { event.preventDefault(); state.keepEditing(); }}>
      <h3>{state.pending ? "关闭编辑？" : "放弃未保存的更改？"}</h3>
      <p>{state.pending ? "请求已提交或结果未知，关闭不会撤销更改。请稍后重新读取核验。" : state.confirmation === "reload" ? "重新读取将替换当前草稿。" : "离开将放弃当前未保存的草稿。"}</p>
      <div className="account-details-actions"><button type="button" className="secondary-btn" onClick={state.keepEditing}>继续编辑</button>
        <button type="button" className="primary-btn" onClick={state.confirmDiscard}>{state.pending ? "关闭编辑" : "放弃更改"}</button></div>
    </dialog>
  </div>;
}

import React, { useEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { tauriListen } from "../bridge";
import { serviceErrorMessage } from "../chatgptService";
import { readBoundCloudDraft } from "../cloudDraftBindings";
import { compareDraftMetadata, draftFieldChanges, draftFieldsMatch, draftFieldValues, draftMetadataChanges, draftMetadataValues,
  saveBoundDraftFields, saveBoundDraftMetadata } from "../cloudDraftFields";
import { readCloudEnvironmentAccess } from "../cloudEnvironmentAccess";
import { readCloudDraftHistory } from "../cloudDraftHistory";
import { prepareCloudDraftContext, restoreCloudDraftSession, type CloudDraftSession } from "../cloudDraftSession";
import type { CloudDetail } from "../cloudEnvironmentService";
import { extractTextFromItem } from "../threadText";
import type { TurnItem } from "../types";
import { renderCloudEnvironmentFields } from "./CloudEnvironmentsView";
import { CloudDraftNetworkFields } from "./CloudDraftNetworkFields";
import { MarkdownView } from "./MarkdownView";
import { UserMessageBubble } from "./UserMessageBubble";
import "./CloudDraftView.css";

type History = Awaited<ReturnType<typeof readCloudDraftHistory>>;
type Metadata = ReturnType<typeof draftMetadataValues>;
type SavePhase = "draft" | "metadata";
const historyLimits = { turnLimit: 5, itemLimit: 100 };

export function CloudDraftView({ session, persisted, onBack }: { session: CloudDraftSession; persisted: boolean; onBack: () => void }) {
  const [scope, setScope] = useState<AbortSignal | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [olderBusy, setOlderBusy] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const olderRequest = useRef<AbortController | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelAttempt, setPanelAttempt] = useState(0);
  const [detail, setDetail] = useState<CloudDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const panelRequest = useRef<AbortController | null>(null);
  const [editor, setEditor] = useState<{ base: NonNullable<CloudDetail["draft"]>; values: ReturnType<typeof draftFieldValues>;
    metadataBase: Metadata; metadata: Metadata } | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [nameBeforeEdit, setNameBeforeEdit] = useState<string | null>(null);
  const nameTrigger = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const savePending = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [checkRequired, setCheckRequired] = useState<SavePhase | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const editing = editor !== null;
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const panelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const lifetime = new AbortController();
    let stop: (() => void) | undefined;
    void tauriListen("chatgpt-service:invalidated", () => {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      olderRequest.current?.abort();
      setScope(null); setHistory(null); setDetail(null); setEditor(null); setSaveNotice(null);
      setScopeError("账号已更改，请返回环境列表。");
    }).then(unlisten => {
      if (lifetime.signal.aborted) unlisten();
      else { stop = unlisten; setScope(lifetime.signal); }
    }, cause => { if (!lifetime.signal.aborted) setScopeError(serviceErrorMessage(cause)); });
    return () => { lifetime.abort(); olderRequest.current?.abort(); stop?.(); };
  }, [session]);

  useEffect(() => {
    if (!scope || scope.aborted) return;
    const request = new AbortController();
    const cancel = () => request.abort();
    scope.addEventListener("abort", cancel, { once: true });
    setRestoreError(null); setHistory(null); setOlderError(null);
    void restoreCloudDraftSession(session, prepareCloudDraftContext, historyLimits, request.signal).then(result => {
      if (!request.signal.aborted) setHistory(result.history);
    }, cause => { if (!request.signal.aborted) setRestoreError(serviceErrorMessage(cause)); });
    return () => { cancel(); scope.removeEventListener("abort", cancel); };
  }, [scope, session, restoreAttempt]);

  useEffect(() => {
    if (!scope || scope.aborted || !panelOpen || editing) return;
    const request = new AbortController();
    panelRequest.current = request;
    const cancel = () => request.abort();
    scope.addEventListener("abort", cancel, { once: true });
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (request.signal.aborted || busy) return;
      clearTimeout(timer);
      busy = true;
      try {
        const current = await readBoundCloudDraft(session.binding, session.identity, request.signal);
        if (request.signal.aborted) return;
        setDetail(current); setDetailError(null);
        timer = setTimeout(refresh, 5000);
      } catch (cause) {
        if (!request.signal.aborted) { setDetail(null); setDetailError(serviceErrorMessage(cause)); }
      } finally { busy = false; }
    };
    setDetailError(null);
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      cancel(); clearTimeout(timer);
      if (panelRequest.current === request) panelRequest.current = null;
      scope.removeEventListener("abort", cancel);
      window.removeEventListener("focus", refresh);
    };
  }, [scope, session, panelOpen, panelAttempt, editing]);

  useEffect(() => { if (panelOpen) panelHeading.current?.focus(); else panelButton.current?.focus(); }, [panelOpen]);

  const loadEarlier = async () => {
    if (!scope || scope.aborted || !history?.olderCursor || olderRequest.current) return;
    const request = new AbortController();
    olderRequest.current = request;
    setOlderBusy(true); setOlderError(null);
    try {
      const page = await readCloudDraftHistory(session.threadId, session.identity, request.signal, { ...historyLimits, cursor: history.olderCursor });
      if (request.signal.aborted) return;
      const currentIds = new Set(history.turns.map(entry => entry.turn.id));
      setHistory({ turns: [...page.turns.filter(entry => !currentIds.has(entry.turn.id)), ...history.turns], olderCursor: page.olderCursor });
    } catch (cause) { if (!request.signal.aborted) setOlderError(serviceErrorMessage(cause)); }
    finally {
      if (olderRequest.current === request) olderRequest.current = null;
      if (!request.signal.aborted) setOlderBusy(false);
    }
  };

  const runSave = async (check: boolean) => {
    if (!scope || scope.aborted || !detail || !editor || savePending.current) return;
    savePending.current = true;
    setSaveBusy(true); setSaveError(null); setSaveNotice(null);
    let phase: SavePhase = checkRequired ?? "draft";
    const metadata = draftMetadataChanges(editor.metadataBase, editor.metadata);
    const metadataDirty = Object.keys(metadata).length > 0;
    const confirmed = (current: CloudDetail, message: string) => {
      setDetail(current); setEditor(null); setNameBeforeEdit(null); setCheckRequired(null); setSaveNotice(message);
    };
    try {
      if (check) {
        const current = await readBoundCloudDraft(session.binding, session.identity, scope);
        if (!current.draft) throw Error("服务端草稿已不可用。");
        const sameBase = current.draft.baseVersionId === editor.base.baseVersionId;
        const sameRevision = sameBase && current.draft.revision === editor.base.revision;
        if (phase === "metadata") {
          const state = compareDraftMetadata(editor.metadataBase, editor.metadata, draftMetadataValues(current));
          if (state === "applied") {
            confirmed(current, "已核对服务端环境设置。"); return;
          }
          if (state === "unchanged" && sameRevision) {
            setCheckRequired(null); setSaveNotice("服务端环境设置未变化，可以重试保存。"); return;
          }
        } else {
          if (sameBase && current.draft.revision > editor.base.revision
            && draftFieldsMatch(draftFieldValues(editor.base), editor.values, draftFieldValues(current.draft))) {
            if (metadataDirty) {
              setDetail(current); setEditor({ ...editor, base: current.draft, values: draftFieldValues(current.draft) });
              setCheckRequired(null); setSaveNotice("草稿字段已保存，环境设置仍待保存。");
            } else confirmed(current, "已核对服务端草稿。");
            return;
          }
          if (sameRevision) {
            setCheckRequired(null); setSaveNotice("服务端草稿版本未变化，可以重试保存。"); return;
          }
        }
        setSaveError("服务端环境已变更。当前输入已保留，取消编辑后可载入最新版本。");
        return;
      }
      if (checkRequired) return;
      if (!editor.metadata.name.trim()) {
        setSaveError("请输入环境名称。");
        if (nameBeforeEdit === null) setNameBeforeEdit(editor.metadataBase.name);
        else nameInput.current?.focus();
        return;
      }
      const access = await readCloudEnvironmentAccess(scope);
      const { identity } = session;
      if (!access.available || access.identity.accountId !== identity.accountId || access.identity.userId !== identity.userId
        || access.identity.generation !== identity.generation || (access.rbacEnabled !== false
          && (detail.shareSettings === "workspace" ? !access.canManage : detail.isOwner === false))) {
        throw Error("当前账号无权保存此环境草稿。");
      }
      if ((metadata.shareSettings === "workspace" && !access.canManage)
        || (metadata.shareSettings === "private" && detail.isOwner === false)) throw Error("当前账号无权修改共享设置。");
      let saved = detail;
      let base = editor.base;
      if (Object.keys(draftFieldChanges(draftFieldValues(base), editor.values)).length) {
        saved = await saveBoundDraftFields(session.binding, base, editor.values, identity, scope);
        base = saved.draft!;
        setDetail(saved);
        setEditor({ ...editor, base, values: draftFieldValues(base) });
        if (metadataDirty) setSaveNotice("草稿字段已保存，环境设置仍待保存。");
      }
      if (metadataDirty) {
        phase = "metadata";
        saved = await saveBoundDraftMetadata(session.binding, base, editor.metadataBase, editor.metadata, identity, scope);
      }
      confirmed(saved, metadata.shareSettings ? "共享设置已更新。" : "草稿已保存。");
    } catch (cause) {
      if (!scope.aborted) {
        const code = (cause as { code?: string } | null)?.code;
        if (code === "cloud_draft_save_unconfirmed" || code === "conflict") setCheckRequired(phase);
        setSaveError(serviceErrorMessage(cause));
      }
    } finally {
      savePending.current = false;
      if (!scope.aborted) setSaveBusy(false);
    }
  };
  const dirty = editor && (Object.keys(draftFieldChanges(draftFieldValues(editor.base), editor.values)).length > 0
    || Object.keys(draftMetadataChanges(editor.metadataBase, editor.metadata)).length > 0);
  const editLocked = saveBusy || checkRequired !== null;
  const environmentFields = detail && renderCloudEnvironmentFields({ detail, showScripts: !editing, showNetwork: !editing, showMetadata: !editing,
    repository: id => <span>{session.binding.repositoryNamesById[id] ?? "未知代码仓库"}</span> });

  return <div className="cloud-draft-view" data-chat-host="durable">
    <section className="cloud-draft-chat" aria-label="云端会话">
      <header className="cloud-draft-heading">
        <button type="button" className="back-to-app-pill" disabled={editing} onClick={onBack}>← 返回环境</button>
        <h1>编辑 {session.binding.name}</h1>
        <button type="button" className="back-to-app-pill" ref={panelButton} disabled={editing} aria-expanded={panelOpen} aria-controls="cloud-draft-environment" onClick={() => setPanelOpen(value => !value)}>环境</button>
      </header>
      <div className="timeline-scroll-pane cloud-draft-timeline">
        <div className="timeline-content-wrapper">
          {!persisted && <p role="status">草稿关联未保存，当前窗口仍可继续。</p>}
          {scopeError ? <p role="alert">{scopeError}</p> : restoreError ? <div role="alert">{restoreError} <button type="button" onClick={() => setRestoreAttempt(value => value + 1)}>重试恢复</button></div> : !history ? <p role="status">正在恢复云端会话…</p> : <>
            {history.olderCursor && <button type="button" className="turn-action-mini-btn" disabled={olderBusy} onClick={() => void loadEarlier()}>加载更早的轮次</button>}
            {olderError && <p role="alert">{olderError}</p>}
            {!history.turns.length && <p role="status">暂无历史消息</p>}
            {history.turns.map(({ turn }) => <div className="cloud-draft-turn" key={turn.id}>{turn.items.map(raw => {
              const item = raw as unknown as TurnItem;
              const text = extractTextFromItem(item);
              return text && (item.type === "userMessage" || item.type === "user"
                ? <div className="user-turn-block" key={item.id}><UserMessageBubble text={text} remoteContent="no-remote-images" /></div>
                : <div className="assistant-turn-block" key={item.id}><MarkdownView content={text} remoteContent="no-remote-images" /></div>);
            })}</div>)}
          </>}
        </div>
      </div>
    </section>
    {panelOpen && <aside id="cloud-draft-environment" className="cloud-draft-environment" aria-labelledby="cloud-draft-environment-heading" onKeyDown={event => {
      if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.stopPropagation(); if (!editing) setPanelOpen(false); }
    }}>
      <header className="cloud-draft-heading"><h2 id="cloud-draft-environment-heading" tabIndex={-1} ref={panelHeading}>环境</h2><button type="button" className="window-chrome-icon-btn" aria-label="关闭环境侧栏" disabled={editing} onClick={() => setPanelOpen(false)}><X size={16} aria-hidden="true" /></button></header>
      <div className="cloud-draft-fields">
        {scopeError ? <p role="alert">{scopeError}</p> : detailError ? <div role="alert">{detailError} <button type="button" onClick={() => setPanelAttempt(value => value + 1)}>重试</button></div> : detail ? <>
          {!editing && <><h3 className="cloud-draft-environment-name">{detail.name}</h3>{environmentFields}</>}
          {editor ? <form className="cloud-envs-config cloud-draft-script-form" aria-label="编辑草稿配置" onSubmit={event => { event.preventDefault(); if (dirty && !checkRequired) void runSave(false); }}>
            <div className="cloud-draft-name">
              {nameBeforeEdit === null ? <h3>{editor.metadata.name}</h3> : <input ref={nameInput} autoFocus aria-label="环境名称" maxLength={128}
                aria-invalid={!editor.metadata.name.trim()} readOnly={editLocked} value={editor.metadata.name}
                onChange={event => setEditor({ ...editor, metadata: { ...editor.metadata, name: event.target.value } })}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) {
                    if (event.key === "Escape" || event.key === "Enter") event.stopPropagation();
                    return;
                  }
                  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); nameTrigger.current?.click(); }
                }} />}
              {nameBeforeEdit !== null && <button type="submit" className="window-chrome-icon-btn" aria-label="保存环境设置" disabled={!dirty || editLocked}><Check size={14} /></button>}
              <button ref={nameTrigger} type="button" className="window-chrome-icon-btn" disabled={editLocked}
                aria-label={nameBeforeEdit === null ? "重命名环境" : "取消重命名"} onClick={() => {
                  if (nameBeforeEdit === null) setNameBeforeEdit(editor.metadata.name);
                  else { setEditor({ ...editor, metadata: { ...editor.metadata, name: nameBeforeEdit } }); setNameBeforeEdit(null); nameTrigger.current?.focus(); }
                }}>{nameBeforeEdit === null ? <Pencil size={14} /> : <X size={14} />}</button>
            </div>
            <label>Description<textarea className="cloud-draft-description" rows={2} placeholder="Describe when to use this environment" value={editor.metadata.description} readOnly={editLocked} onChange={event => {
              if (Array.from(event.target.value).length <= 512) setEditor({ ...editor, metadata: { ...editor.metadata, description: event.target.value } });
            }} /></label>
            {environmentFields}
            <section><h3>隐私</h3><label>谁可以使用<select value={editor.metadata.shareSettings} disabled={editLocked} onChange={event =>
              setEditor({ ...editor, metadata: { ...editor.metadata, shareSettings: event.target.value === "workspace" ? "workspace" : "private" } })}>
              <option value="private" disabled={detail.isOwner === false}>仅限我自己</option>
              {(canManage || editor.metadata.shareSettings === "workspace") && <option value="workspace" disabled={!canManage}>工作区</option>}
            </select></label></section>
            <label>安装脚本<textarea rows={6} value={editor.values.installScript} readOnly={editLocked} onChange={event => setEditor({ ...editor, values: { ...editor.values, installScript: event.target.value } })} /></label>
            <label>启动技能<input value={editor.values.startSkill} maxLength={2048} readOnly={editLocked} onChange={event => setEditor({ ...editor, values: { ...editor.values, startSkill: event.target.value } })} /></label>
            <CloudDraftNetworkFields network={editor.values.network} disabled={editLocked} onChange={network => setEditor({ ...editor, values: { ...editor.values, network } })} />
            {saveError && <p role="alert">{saveError}</p>}
            <footer className="cloud-envs-footer">
              <button type="button" disabled={saveBusy} onClick={() => { setDetail(null); setEditor(null); setNameBeforeEdit(null); setSaveError(null); setSaveNotice(null); }}>取消</button>
              {checkRequired ? <button key="check" type="button" disabled={saveBusy} onClick={event => { event.preventDefault(); void runSave(true); }}>核对服务端草稿</button> : <button key="save" type="submit" disabled={!dirty || saveBusy}>{saveBusy ? "正在保存…" : "保存草稿"}</button>}
            </footer>
          </form> : detail.draft && <button type="button" className="back-to-app-pill" onClick={() => {
            if (!detail.draft) return;
            panelRequest.current?.abort();
            setCheckRequired(null); setSaveError(null); setSaveNotice(null); setNameBeforeEdit(null); setCanManage(false);
            const metadata = draftMetadataValues(detail);
            setEditor({ base: detail.draft, values: draftFieldValues(detail.draft), metadataBase: metadata, metadata });
            if (scope && !scope.aborted) void readCloudEnvironmentAccess(scope).then(access => {
              const { identity } = session;
              if (!scope.aborted && access.available && access.identity.accountId === identity.accountId
                && access.identity.userId === identity.userId && access.identity.generation === identity.generation) setCanManage(access.canManage);
            }).catch(() => {});
          }}>编辑草稿配置</button>}
          {saveNotice && <p role="status">{saveNotice}</p>}
        </> : <p role="status">正在载入环境…</p>}
      </div>
    </aside>}
  </div>;
}

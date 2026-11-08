import React, { useEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { tauriListen } from "../bridge";
import { callCloudThread, serviceErrorMessage } from "../chatgptService";
import { readBoundCloudDraft } from "../cloudDraftBindings";
import { compareDraftMetadata, draftFieldChanges, draftFieldsMatch, draftFieldValues, draftMetadataChanges, draftMetadataValues,
  saveBoundDraftFields, saveBoundDraftMetadata } from "../cloudDraftFields";
import { readCloudEnvironmentAccess } from "../cloudEnvironmentAccess";
import { mergeCloudDraftHistory, readCloudDraftHistory, watchCloudDraftHistory } from "../cloudDraftHistory";
import { advanceRepositoryApply, pendingRepositoryApplySession, saveDraftWithRepositoryApply, type RepositoryApplyStatus } from "../cloudDraftRepositoryApply";
import { pendingCloudReplySession } from "../cloudEnvironmentReply";
import { advanceCloudPublication, canRetryCloudPublication, readCloudPublication, type CloudPublishReview } from "../cloudEnvironmentPublish";
import { sendCloudEnvironmentSetup } from "../cloudEnvironmentSetup";
import { verifyPublishedCloudTarget, type PublishedCloudTarget } from "../cloudPublishedChat";
import { prepareCloudDraftContext, restoreCloudDraftSession, type CloudDraftSession } from "../cloudDraftSession";
import type { CloudDetail } from "../cloudEnvironmentService";
import { extractTextFromItem } from "../threadText";
import type { TurnItem } from "../types";
import { renderCloudEnvironmentFields } from "./CloudEnvironmentsView";
import { CloudDraftNetworkFields } from "./CloudDraftNetworkFields";
import { CloudEnvironmentReply } from "./CloudEnvironmentReply";
import { CloudDraftRepositories, sameRepositorySelection, type RepositorySelection } from "./CloudDraftRepositories";
import { MarkdownView } from "./MarkdownView";
import { UserMessageBubble } from "./UserMessageBubble";
import "./CloudDraftView.css";

type History = Awaited<ReturnType<typeof readCloudDraftHistory>>;
type Metadata = ReturnType<typeof draftMetadataValues>;
type SavePhase = "draft" | "metadata";
const historyLimits = { turnLimit: 5, itemLimit: 100 };
const repositoryApplyMessages: Record<RepositoryApplyStatus, string> = {
  saving: "仓库保存结果尚未确认。",
  queued: "仓库已保存，应用消息等待会话空闲。",
  paused: "上一轮已中断，应用消息已暂停。",
  retry: "仓库已保存，应用消息发送失败。",
  unconfirmed: "应用消息的投递结果尚未确认。",
  sent: "仓库应用消息已发送。",
  obsolete: "仓库配置已更新，无需发送此前的应用消息。",
  superseded: "服务端草稿已变更，此前的仓库应用记录已结束。",
};

export function CloudDraftView({ session, persisted, title, onBack, onNewPublishedChat }: {
  session: CloudDraftSession; persisted: boolean; onBack: () => void;
  title?: string;
  onNewPublishedChat?: (target: PublishedCloudTarget) => void;
}) {
  const [scope, setScope] = useState<AbortSignal | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [historyRefreshError, setHistoryRefreshError] = useState<string | null>(null);
  const refreshHistory = useRef<(() => void) | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const olderRequest = useRef<AbortController | null>(null);
  const [panelOpen, setPanelOpen] = useState(!session.binding.conversation);
  const [panelAttempt, setPanelAttempt] = useState(0);
  const [detail, setDetail] = useState<CloudDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const panelRequest = useRef<AbortController | null>(null);
  const [editor, setEditor] = useState<{ base: NonNullable<CloudDetail["draft"]>; values: ReturnType<typeof draftFieldValues>;
    metadataBase: Metadata; metadata: Metadata; repositories?: RepositorySelection[] } | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [nameBeforeEdit, setNameBeforeEdit] = useState<string | null>(null);
  const nameTrigger = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const savePending = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [checkRequired, setCheckRequired] = useState<SavePhase | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [repositoryNames, setRepositoryNames] = useState(session.binding.repositoryNamesById);
  const [repositoryApply, setRepositoryApply] = useState<RepositoryApplyStatus | null>(null);
  const [repositoryApplyError, setRepositoryApplyError] = useState<string | null>(null);
  const [applyWake, wakeRepositoryApply] = useState(0);
  const [setupStatus, setSetupStatus] = useState<"waiting" | "unconfirmed" | "sent" | "no_pending" | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [publication, setPublication] = useState<ReturnType<typeof readCloudPublication>>(null);
  const [publicationError, setPublicationError] = useState<string | null>(null);
  const [publishReview, setPublishReview] = useState<CloudPublishReview | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [openingPublishedChat, setOpeningPublishedChat] = useState(false);
  const openingPublishedChatRef = useRef(false);
  const publishPending = useRef(false);
  const publicationLocked = publishing || (publication !== null && !publication.failed);
  const editing = editor !== null;
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const panelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setPublishReview(null);
    setPublishing(false);
    setPublicationError(null);
    try { setPublication(readCloudPublication(session)); }
    catch (cause) { setPublication(null); setPublicationError(serviceErrorMessage(cause)); }
  }, [session]);

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
    setRestoreError(null); setHistory(null); setOlderError(null); setHistoryRefreshError(null);
    void watchCloudDraftHistory(session.threadId, session.identity, request.signal,
      async () => (await restoreCloudDraftSession(session, prepareCloudDraftContext, historyLimits, request.signal)).history,
      historyLimits, {
        onInitial: setHistory,
        onRefresh: latest => {
          setHistory(current => current ? mergeCloudDraftHistory(current, latest) : latest);
          setHistoryRefreshError(null);
          wakeRepositoryApply(value => value + 1);
        },
        onRefreshError: cause => setHistoryRefreshError(serviceErrorMessage(cause)),
      }).then(refresh => {
      if (!request.signal.aborted) refreshHistory.current = refresh;
    }, cause => { if (!request.signal.aborted) setRestoreError(serviceErrorMessage(cause)); });
    return () => { cancel(); refreshHistory.current = null; scope.removeEventListener("abort", cancel); };
  }, [scope, session, restoreAttempt]);

  useEffect(() => {
    if (!session.setup || !scope || scope.aborted || !history || setupError || setupStatus === "sent" || setupStatus === "no_pending") return;
    void sendCloudEnvironmentSetup(session, history, scope).then(status => {
      if (scope.aborted) return;
      setSetupStatus(status ?? "no_pending");
      if (status === "sent") refreshHistory.current?.();
    }, cause => {
      if (!scope.aborted) setSetupError(serviceErrorMessage(cause));
    });
  }, [scope, session, history, applyWake, setupError, setupStatus]);

  useEffect(() => {
    if (!scope || scope.aborted || !history || saveBusy || publicationLocked) return;
    void advanceRepositoryApply(session, history, false, scope).then(status => {
      if (scope.aborted) return;
      if (status) setRepositoryApply(status);
      setRepositoryApplyError(null);
      if (status === "sent") refreshHistory.current?.();
    }, cause => {
      if (!scope.aborted) setRepositoryApplyError(serviceErrorMessage(cause));
    });
  }, [scope, session, history, saveBusy, applyWake, publicationLocked]);

  const retryRepositoryApply = async () => {
    if (!scope || scope.aborted || !history || saveBusy || publicationLocked) return;
    if (repositoryApply === "unconfirmed") { refreshHistory.current?.(); return; }
    try {
      const status = await advanceRepositoryApply(session, history, repositoryApply === "paused" || repositoryApply === "retry", scope);
      if (!scope.aborted && status) {
        setRepositoryApply(status); setRepositoryApplyError(null);
        if (status === "sent") refreshHistory.current?.();
      }
    } catch (cause) {
      if (!scope.aborted) setRepositoryApplyError(serviceErrorMessage(cause));
    }
  };

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
      setHistory(current => {
        if (!current || current.olderCursor !== history.olderCursor) return current;
        const currentIds = new Set(current.turns.map(entry => entry.turn.id));
        return { turns: [...page.turns.filter(entry => !currentIds.has(entry.turn.id)), ...current.turns], olderCursor: page.olderCursor };
      });
    } catch (cause) { if (!request.signal.aborted) setOlderError(serviceErrorMessage(cause)); }
    finally {
      if (olderRequest.current === request) olderRequest.current = null;
      if (!request.signal.aborted) setOlderBusy(false);
    }
  };

  const runSave = async (check: boolean) => {
    if (!scope || scope.aborted || !detail || !editor || savePending.current || publishPending.current || publicationLocked) return;
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
              setDetail(current); setEditor({ ...editor, base: current.draft, values: draftFieldValues(current.draft), repositories: undefined });
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
        if (editor.repositories) {
          const names = Object.fromEntries(editor.repositories.map(({ id, name }) => [id, name]));
          saved = await saveDraftWithRepositoryApply(session, base, editor.values, { ...repositoryNames, ...names }, scope);
          setRepositoryNames(current => ({ ...current, ...names }));
        } else saved = await saveBoundDraftFields(session.binding, base, editor.values, identity, scope);
        base = saved.draft!;
        setDetail(saved);
        setEditor({ ...editor, base, values: draftFieldValues(base), repositories: undefined });
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
  const latestTurn = history?.turns.at(-1)?.turn;
  const openPublishedChat = async () => {
    if (!scope || scope.aborted || !onNewPublishedChat || !publication?.confirmed || !publication.versionId
      || openingPublishedChatRef.current) return;
    openingPublishedChatRef.current = true;
    setOpeningPublishedChat(true); setPublicationError(null);
    try {
      const target = { session, versionId: publication.versionId };
      const turns = await callCloudThread({ kind: "turns", threadId: session.threadId, cursor: null, limit: 1 }, session.identity, scope) as {
        data?: { id?: string; status?: string }[];
      };
      if (turns.data?.[0]?.id !== publication.turnId || turns.data?.[0]?.status !== "completed")
        throw Error("已发布轮次已变更，请先核对环境。");
      const name = await verifyPublishedCloudTarget(target, scope);
      if (!scope.aborted) onNewPublishedChat({ ...target, session: { ...session, binding: { ...session.binding, name } } });
    } catch (cause) { if (!scope.aborted) setPublicationError(serviceErrorMessage(cause)); }
    finally {
      openingPublishedChatRef.current = false;
      if (!scope.aborted) setOpeningPublishedChat(false);
    }
  };
  const canReview = persisted && !!scope && !!detail?.draft && detail.draft.id === session.binding.draftId
    && detail.draft.baseVersionId === detail.versionId && latestTurn?.status === "completed"
    && (!session.setup || setupStatus === "sent" || setupStatus === "no_pending")
    && !editing && !saveBusy && !publication && !publishing;
  const runPublish = async (review: CloudPublishReview | null, retryFailedOperationId?: string) => {
    if (!scope || scope.aborted || publishPending.current || savePending.current || editing) return;
    publishPending.current = true;
    setPublishing(true); setPublicationError(null); setPublishReview(null);
    try {
      const { identity, binding, threadId } = session;
      const access = await readCloudEnvironmentAccess(scope);
      if (!access.available || access.identity.accountId !== identity.accountId || access.identity.userId !== identity.userId
        || access.identity.generation !== identity.generation) throw Error("当前账号无权发布此环境。");
      await advanceCloudPublication(session, review, scope, async expected => {
        const current = await readBoundCloudDraft(binding, identity, scope);
        if (current.shareSettings === "workspace" ? !access.canManage : current.isOwner === false)
          throw Error("当前账号无权发布此环境。");
        if (!current.draft || current.draft.baseVersionId !== expected.baseVersionId || current.versionId !== expected.baseVersionId
          || current.draft.revision !== expected.revision || current.draft.secrets.some(secret => !!secret.error))
          throw Error("草稿已变更或有待处理项，请重新审核。");
        const [{ thread }, turns] = await Promise.all([
          callCloudThread({ kind: "read", threadId }, identity, scope) as Promise<{ thread?: { id?: string; status?: { type?: string } } }>,
          callCloudThread({ kind: "turns", threadId, cursor: null, limit: 1 }, identity, scope) as Promise<{ data?: { id?: string; status?: string }[] }>,
        ]);
        if (thread?.id !== threadId || thread.status?.type !== "idle" || turns.data?.[0]?.id !== expected.turnId
          || turns.data?.[0]?.status !== "completed" || pendingCloudReplySession(binding.configId, identity)
          || pendingRepositoryApplySession(binding.configId, identity)) throw Error("会话仍有待处理变更，请完成后重新审核。");
      }, retryFailedOperationId);
    } catch (cause) { if (!scope.aborted) setPublicationError(serviceErrorMessage(cause)); }
    finally {
      publishPending.current = false;
      if (!scope.aborted) {
        setPublishing(false);
        try { setPublication(readCloudPublication(session)); }
        catch (cause) { setPublicationError(serviceErrorMessage(cause)); }
      }
    }
  };
  const editLocked = saveBusy || checkRequired !== null || publicationLocked;
  const originalRepositories = editor?.base.repositories.map(repo => ({ ...repo, name: repositoryNames[repo.id] ?? repo.id })) ?? [];
  const environmentFields = detail && renderCloudEnvironmentFields({ detail, showScripts: !editing, showNetwork: !editing, showMetadata: !editing,
    showRepositories: !editing || !scope,
    repository: id => <span>{repositoryNames[id] ?? "未知代码仓库"}</span> });

  return <div className="cloud-draft-view" data-chat-host="durable">
    <section className="cloud-draft-chat" aria-label="云端会话">
      <header className="cloud-draft-heading">
        <button type="button" className="back-to-app-pill" disabled={editing} onClick={onBack}>{title ? "← 返回" : "← 返回环境"}</button>
        <h1>{title ?? `${session.binding.conversation ? "云端聊天" : session.setup ? "设置" : "编辑"} ${session.binding.name}`}</h1>
        <button type="button" className="back-to-app-pill" ref={panelButton} disabled={editing} aria-expanded={panelOpen} aria-controls="cloud-draft-environment" onClick={() => setPanelOpen(value => !value)}>环境</button>
      </header>
      <div className="timeline-scroll-pane cloud-draft-timeline">
        <div className="timeline-content-wrapper">
          {!persisted && <p role="status">草稿关联未保存，当前窗口仍可继续。</p>}
          {scopeError ? <p role="alert">{scopeError}</p> : restoreError ? <div role="alert">{restoreError} <button type="button" onClick={() => setRestoreAttempt(value => value + 1)}>重试恢复</button></div> : !history ? <p role="status">正在恢复云端会话…</p> : <>
            {history.olderCursor && <button type="button" className="turn-action-mini-btn" disabled={olderBusy} onClick={() => void loadEarlier()}>加载更早的轮次</button>}
            {olderError && <p role="alert">{olderError}</p>}
            {historyRefreshError && <div role="alert">{historyRefreshError} <button type="button" onClick={() => refreshHistory.current?.()}>重试刷新</button></div>}
            {setupError && <div role="alert">{setupError} <button type="button" onClick={() => setSetupError(null)}>重试设置消息</button></div>}
            {session.setup && !setupError && setupStatus !== "sent" && setupStatus !== "no_pending" && <p role="status">
              {setupStatus === "unconfirmed" ? "设置消息的投递结果尚未确认。" : setupStatus === "waiting" ? "等待会话空闲后发送设置消息。" : "正在启动设置…"}
              {setupStatus && <button type="button" onClick={() => refreshHistory.current?.()}>核对会话</button>}
            </p>}
            {repositoryApply && <p role="status">{repositoryApplyMessages[repositoryApply]} {repositoryApply !== "sent" && repositoryApply !== "obsolete" && repositoryApply !== "superseded"
              && <button type="button" disabled={saveBusy} onClick={() => void retryRepositoryApply()}>{repositoryApply === "paused" ? "继续发送" : repositoryApply === "retry" ? "重试消息" : "核对状态"}</button>}</p>}
            {repositoryApplyError && <p role="alert">{repositoryApplyError} <button type="button" disabled={saveBusy} onClick={() => void retryRepositoryApply()}>重试核对</button></p>}
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
      {scope && history && (!session.setup || setupStatus === "sent" || setupStatus === "no_pending") &&
        <CloudEnvironmentReply session={session} history={history} scope={scope} revision={applyWake} refreshHistory={refreshHistory} disabled={publicationLocked} />}
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
            {scope && <CloudDraftRepositories original={originalRepositories} selection={editor.repositories ?? originalRepositories}
              disabled={editLocked} identity={session.identity} scope={scope} onChange={repositories => {
                const changed = !sameRepositorySelection(originalRepositories, repositories);
                setEditor({ ...editor, values: { ...editor.values, repositories: changed ? repositories : editor.base.repositories },
                  repositories: changed ? repositories : undefined });
              }} />}
            {editor.repositories && <p role="status">仓库变更已暂存。 <button type="button" disabled={editLocked}
              onClick={() => setEditor({ ...editor, values: { ...editor.values, repositories: editor.base.repositories }, repositories: undefined })}>撤销仓库变更</button></p>}
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
          </form> : session.binding.draftId && detail.draft && <button type="button" className="back-to-app-pill" disabled={publicationLocked} onClick={() => {
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
        {session.binding.draftId && scope && !scope.aborted && !editing && <>
          {publishing ? <p role="status">正在发布…</p>
            : publication?.confirmed ? <>
              <p role="status">已发布</p>
              {onNewPublishedChat && <button type="button" className="back-to-app-pill" disabled={openingPublishedChat}
                onClick={() => void openPublishedChat()}>{openingPublishedChat ? "正在打开…" : "开始新聊天"}</button>}
            </>
            : publication?.failed ? <>
              <p role="alert">无法发布环境</p>
              {canRetryCloudPublication(publication.failureCode) ? <>
                <p>你的设置已保存。请尝试重新发布。</p>
                <button type="button" className="back-to-app-pill" onClick={() => void runPublish(null, publication.operationId)}>重试发布</button>
              </> : publication.failureCode === undefined && <button type="button" className="back-to-app-pill" onClick={() => void runPublish(null)}>核对发布状态</button>}
            </>
            : publication ? <button type="button" className="back-to-app-pill" onClick={() => void runPublish(null)}>核对发布状态</button>
            : publishReview && canReview && detail?.draft && latestTurn?.id === publishReview.turnId
              && detail.draft.baseVersionId === publishReview.baseVersionId && detail.draft.revision === publishReview.revision ? <>
                <p>发布已审核的草稿修订 {publishReview.revision}？</p>
                <button type="button" onClick={() => setPublishReview(null)}>取消</button>
                <button type="button" className="back-to-app-pill" onClick={() => void runPublish(publishReview)}>发布</button>
              </> : canReview && detail?.draft && latestTurn && <button type="button" className="back-to-app-pill"
                onClick={() => setPublishReview({ baseVersionId: detail.draft!.baseVersionId, revision: detail.draft!.revision, turnId: latestTurn.id })}>审核发布</button>}
          {publicationError && <p role="alert">{publicationError}</p>}
        </>}
      </div>
    </aside>}
  </div>;
}

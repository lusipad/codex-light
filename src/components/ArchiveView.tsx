import React, { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ListFilter, Cloud, Folder, LoaderCircle, Trash2 } from "lucide-react";
import { callAppServer } from "../bridge";
import { ArchiveDeleteResult, SidebarProjectMembership, ThreadSummary, WorkspaceRootItem } from "../types";
import { accountRead } from "../config";
import { serviceIdentity, unarchiveCloudItem, deleteCloudArchiveItem, type ArchiveCloudSource, type ServiceIdentity } from "../chatgptService";
import type { ArchivedConversationsState } from "../archiveConversations";
import type { ArchivedCloudTasksState } from "../archiveCloudTasks";
import { createPortal } from "react-dom";
import { buildSidebarProjectGroups } from "../sidebarProjects";
import { GeneralPreferenceSelect } from "./GeneralPreferenceSelect";
import "./RenameThreadDialog.css";
import "./ArchiveView.css";

export interface ArchiveViewProps {
  refreshToken?: number | string | null;
  surface?: "global" | "settings";
  cloudArchive?: ArchivedCloudTasksState;
  conversationArchive?: ArchivedConversationsState;
  workspaces?: WorkspaceRootItem[];
  projectMembership?: SidebarProjectMembership;
  workspaceHints?: Record<string, string>;
  onSelectThread: (threadId: string) => void;
  onUnarchive: (thread: ThreadSummary) => Promise<void> | void;
  onDelete: (thread: ThreadSummary) => Promise<ArchiveDeleteResult>;
  onDeleteAll: () => Promise<ArchiveDeleteResult>;
  onShowToast?: (message: string, type?: "info" | "success" | "error", action?: { label: string; onClick: () => void }) => void;
}

interface ArchivedThread extends ThreadSummary {
  archiveSource?: "cloud-task" | "chatgpt-conversation";
  gizmoId?: string | null;
  environmentLabel?: string | null;
  displayTime?: number | string | null;
  cwd?: string | null;
  updatedAt?: number;
  createdAt?: number;
}

function formatRelative(seconds?: number): string {
  if (!seconds) return "—";
  const ms = seconds > 1e12 ? seconds : seconds * 1000;
  const diff = Date.now() - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(ms).toLocaleDateString();
}

type ArchiveSortKey = "updated" | "created" | "alphabetical";
type ArchiveKindFilter = "all" | "local" | "cloud";
const EMPTY_MEMBERSHIP: SidebarProjectMembership = { threadProjectAssignments: {}, projectlessThreadIds: [], workspaceProjectAssignments: {} };
const EMPTY_WORKSPACES: WorkspaceRootItem[] = [];
const EMPTY_HINTS: Record<string, string> = {};
const archiveTitle = (thread: ArchivedThread) => thread.name?.trim() || thread.preview?.trim() || "无标题聊天";
const archiveTime = (value?: number, fallback?: number) => Number.isFinite(value) ? value! : Number.isFinite(fallback) ? fallback! : 0;
const archivePath = (value?: string | null) => (value || "").replace(/\\/g, "/").replace(/\/+$/, "");
const archiveRepo = (value?: string | null) => archivePath(value).split("/").at(-1)?.split(/\s+/).slice(0, 3).join(" ") || "";

// Official archive identity uses EY/Pa; display paths keep their original case.
function archiveProjectPath(value?: string | null): string {
  let path = value || "";
  if (/^\\\\\?\\(?:UNC\\|[a-z]:[\\/])/i.test(path)) path = path.slice(4).replace(/^UNC\\/i, "\\\\");
  path = path.replace(/\\/g, "/").toLowerCase();
  const wsl = path.match(/^\/\/(?:wsl\$|wsl\.localhost)\/[^/]+(?:\/(.*))?$/);
  if (wsl) return `/${wsl[1] || ""}`.replace(/\/+$/, "");
  const drive = path.match(/^\/?([a-z]):(?:\/(.*))?$/);
  if (drive) path = `/mnt/${drive[1]}${drive[2] ? `/${drive[2]}` : ""}`;
  return path.replace(/\/+$/, "");
}

interface CloudRecovery {
  source: ArchiveCloudSource; id: string; identity: ServiceIdentity; title: string; token: object; kind?: "unarchive" | "delete";
  status: "pending" | "accepted" | "unknown" | "failed"; detail?: string; readAfterVersion?: number;
}
const sameArchiveIdentity = (a?: ServiceIdentity | null, b?: ServiceIdentity | null) => Boolean(a && b
  && a.accountId === b.accountId && a.userId === b.userId && a.generation === b.generation);

function ArchiveFilterMenu({ kindFilter, sortKey, onKindFilterChange, onSortKeyChange }: {
  kindFilter: ArchiveKindFilter; sortKey: ArchiveSortKey;
  onKindFilterChange: (value: ArchiveKindFilter) => void; onSortKeyChange: (value: ArchiveSortKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 320 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialFocus = useRef(0);
  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (rect.bottom < 0 || rect.top > window.innerHeight) { setOpen(false); return; }
      const width = menuRef.current?.offsetWidth || 220, height = menuRef.current?.offsetHeight || 320;
      const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12;
      const upward = below < height && above > below, maxHeight = Math.max(32, Math.min(320, upward ? above : below));
      setPosition({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        top: upward ? Math.max(8, rect.top - Math.min(height, maxHeight) - 4) : rect.bottom + 4, maxHeight });
    };
    const outside = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    update();
    menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]")[initialFocus.current]?.focus();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open]);
  const kinds: { value: ArchiveKindFilter; label: string }[] = [{ value: "all", label: "全部聊天" }, { value: "local", label: "本地" }, { value: "cloud", label: "云端" }];
  const sorts: { value: ArchiveSortKey; label: string }[] = [{ value: "updated", label: "更新时间" }, { value: "created", label: "创建时间" }, { value: "alphabetical", label: "按字母顺序" }];
  const blur = (event: React.FocusEvent<HTMLElement>) => {
    if (!triggerRef.current?.contains(event.relatedTarget) && !menuRef.current?.contains(event.relatedTarget)) setOpen(false);
  };
  return <div className="general-preference-select archive-kind-filter" onBlur={blur}>
    <button type="button" ref={triggerRef} className="general-preference-trigger" aria-label="筛选已归档聊天"
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? "archive-kind-menu" : undefined}
      onClick={() => { if (open) close(); else { initialFocus.current = kinds.findIndex(item => item.value === kindFilter); setOpen(true); } }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); initialFocus.current = event.key === "ArrowUp" ? 5 : 0; setOpen(true); }
      }}><ListFilter size={14} aria-hidden="true" /><span>{kinds.find(item => item.value === kindFilter)?.label}</span><ChevronDown size={12} aria-hidden="true" /></button>
    {open && createPortal(<div id="archive-kind-menu" role="menu" aria-label="筛选已归档聊天" ref={menuRef}
      className="general-preference-menu archive-filter-menu" style={position} onBlur={blur}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") || []);
        const index = items.indexOf(event.target as HTMLButtonElement);
        items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }}>
      <div role="group" aria-label="类型"><div className="archive-menu-label">类型</div>
        {kinds.map(item => <button key={item.value} type="button" role="menuitemradio" aria-checked={kindFilter === item.value}
          onClick={() => { close(); onKindFilterChange(item.value); }}><span>{item.label}</span>{kindFilter === item.value && <Check size={14} aria-hidden="true" />}</button>)}
      </div><div role="separator" className="archive-menu-separator" />
      <div role="group" aria-label="排序方式"><div className="archive-menu-label">排序方式</div>
        {sorts.map(item => <button key={item.value} type="button" role="menuitemradio" aria-checked={sortKey === item.value}
          onClick={() => { close(); onSortKeyChange(item.value); }}><span>{item.label}</span>{sortKey === item.value && <Check size={14} aria-hidden="true" />}</button>)}
      </div>
    </div>, document.body)}
  </div>;
}

function ArchiveDeleteDialog({ all, onDecision, fallbackRef }: {
  all: boolean;
  onDecision: (confirmed: boolean) => void;
  fallbackRef: React.RefObject<HTMLDivElement | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const decidedRef = useRef(false);
  const confirmedRef = useRef(false);
  const composingRef = useRef(false);
  const decide = (confirmed: boolean) => {
    if (decidedRef.current) return;
    decidedRef.current = true;
    confirmedRef.current = confirmed;
    onDecision(confirmed);
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog?.close();
      if (!confirmedRef.current && previous?.isConnected && !previous.matches(":disabled, [inert]")) previous.focus({ preventScroll: true });
      else fallbackRef.current?.focus({ preventScroll: true });
    };
  }, [fallbackRef]);
  return <dialog ref={dialogRef} className="rename-thread-dialog archive-delete-dialog"
    aria-labelledby="archive-delete-title" aria-describedby="archive-delete-description"
    onCancel={event => { event.preventDefault(); if (!composingRef.current) decide(false); }}
    onCompositionStart={() => { composingRef.current = true; }}
    onCompositionEnd={() => { composingRef.current = false; }}
    onKeyDown={event => {
      event.stopPropagation();
      if ((composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229)
        && (event.key === "Enter" || event.key === "Escape")) event.preventDefault();
    }}>
    <form onSubmit={event => { event.preventDefault(); if (!composingRef.current) decide(true); }}>
      <header>
        <h2 id="archive-delete-title">{all ? "删除所有已归档本地聊天？" : "删除已归档的聊天？"}</h2>
        <p id="archive-delete-description">{all ? "这将永久删除所有本地已归档聊天记录" : "这将永久删除已归档的聊天"}</p>
      </header>
      <footer>
        <button ref={cancelRef} type="button" onClick={() => decide(false)}>取消</button>
        <button type="submit" className="archive-delete-confirm">删除</button>
      </footer>
    </form>
  </dialog>;
}

interface CloudDeleteTarget {
  thread: ArchivedThread; reader: ArchivedCloudTasksState | ArchivedConversationsState;
  identity: ServiceIdentity; dialogToken: object;
}

function CloudArchiveDeleteDialog({ title, busy, blocked, unknown, onConfirm, onCancel, onRefresh, fallbackRef }: {
  title: string; busy: boolean; blocked: boolean; unknown: boolean; onConfirm: () => Promise<void>;
  onCancel: () => void; onRefresh: () => void; fallbackRef: React.RefObject<HTMLDivElement | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null), cancelRef = useRef<HTMLButtonElement>(null);
  const composing = useRef(false), submitting = useRef(false);
  const dismiss = () => { if (!busy && !submitting.current && !composing.current) onCancel(); };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.showModal(); cancelRef.current?.focus();
    return () => {
      dialogRef.current?.close();
      if (previous?.isConnected && !previous.matches(":disabled, [inert]")) previous.focus({ preventScroll: true });
      else fallbackRef.current?.focus({ preventScroll: true });
    };
  }, [fallbackRef]);
  useEffect(() => { if (busy) dialogRef.current?.focus({ preventScroll: true }); }, [busy]);
  return <dialog ref={dialogRef} className="rename-thread-dialog cloud-archive-delete-dialog"
    aria-labelledby="cloud-archive-delete-title" aria-describedby="cloud-archive-delete-description" aria-busy={busy}
    onCancel={event => { event.preventDefault(); dismiss(); }}
    onMouseDown={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss();
    }}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Tab") {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const first = controls[0], last = controls.at(-1), active = event.currentTarget.ownerDocument.activeElement;
        if (!first) event.preventDefault();
        else if (event.shiftKey && (active === first || active === event.currentTarget)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (active === last || active === event.currentTarget)) { event.preventDefault(); first.focus(); }
      }
      if ((composing.current || event.nativeEvent.isComposing || event.keyCode === 229) && (event.key === "Enter" || event.key === "Escape")) event.preventDefault();
    }}>
    <form onSubmit={async event => {
      event.preventDefault();
      if (busy || blocked || composing.current || submitting.current) return;
      submitting.current = true;
      try { await onConfirm(); } finally { submitting.current = false; }
    }}>
      <header><h2 id="cloud-archive-delete-title">删除聊天？</h2><p id="cloud-archive-delete-description">这将永久删除“{title}”。此操作无法撤销。</p></header>
      {unknown && <p role="status">删除结果尚未确认，请刷新查看。 <button type="button" onClick={onRefresh}>刷新列表</button></p>}
      <footer><button ref={cancelRef} type="button" disabled={busy} onClick={dismiss}>取消</button>
        <button type="submit" className="archive-action danger archive-recovery-button" disabled={busy || blocked} aria-busy={busy}>
          {busy && <LoaderCircle size={13} className="archive-recovery-spinner" aria-hidden="true" />}删除聊天
        </button></footer>
    </form>
  </dialog>;
}

export const ArchiveView: React.FC<ArchiveViewProps> = ({
  refreshToken,
  surface = "global",
  cloudArchive,
  conversationArchive,
  workspaces = EMPTY_WORKSPACES,
  projectMembership = EMPTY_MEMBERSHIP,
  workspaceHints = EMPTY_HINTS,
  onSelectThread,
  onUnarchive,
  onDelete,
  onDeleteAll,
  onShowToast,
}) => {
  const [cloudDeleteTarget, setCloudDeleteTarget] = useState<CloudDeleteTarget | null>(null);
  const cloudDeleteTargetRef = useRef(cloudDeleteTarget);
  cloudDeleteTargetRef.current = cloudDeleteTarget;
  const [cloudRecoveries, setCloudRecoveries] = useState<Record<string, CloudRecovery>>({});
  const cloudOperationsRef = useRef(new Map<string, { controller: AbortController; identity: ServiceIdentity; sent: boolean; token: object; result: CloudRecovery["status"] }>());
  const cloudReadersRef = useRef({ cloudArchive, conversationArchive, surface });
  cloudReadersRef.current = { cloudArchive, conversationArchive, surface };
  const [kindFilter, setKindFilter] = useState<ArchiveKindFilter>("all");
  const [sortKey, setSortKey] = useState<ArchiveSortKey>("updated");
  const [projectFilter, setProjectFilter] = useState("all");
  const [threads, setThreads] = useState<ArchivedThread[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [restoredThread, setRestoredThread] = useState<ArchivedThread | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ArchivedThread | "all" | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const mutationPendingRef = useRef(false);

  const load = useCallback(async (afterMutation = false, deletionExecuted = false) => {
    if (mutationPendingRef.current && !afterMutation) return false;
    const seq = ++requestSeqRef.current;
    const isCurrent = () => mountedRef.current && seq === requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const list: ArchivedThread[] = [];
      const cursors = new Set<string>();
      let cursor: string | null = null;
      do {
        const res: { data: ArchivedThread[]; nextCursor?: string | null } = await callAppServer("thread/list", {
          archived: true, limit: 100, sortKey: "updated_at", sortDirection: "desc", cursor, useStateDbOnly: true,
        });
        if (!isCurrent()) return;
        if (!Array.isArray(res?.data)) throw new Error("归档列表响应无效");
        list.push(...res.data);
        cursor = res.nextCursor ?? null;
        if (cursor !== null && cursors.has(cursor)) throw new Error("归档列表返回重复分页游标");
        if (cursor !== null) cursors.add(cursor);
      } while (cursor !== null);
      setThreads(list);
      return true;
    } catch (e: any) {
      if (!isCurrent()) return;
      setError(`${deletionExecuted ? "删除已执行，刷新失败：" : ""}${e?.message || e}`);
      return false;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; ++requestSeqRef.current; for (const operation of cloudOperationsRef.current.values()) operation.controller.abort(); cloudOperationsRef.current.clear(); };
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const cloudReader = (source: ArchiveCloudSource) => source === "cloud-task" ? cloudReadersRef.current.cloudArchive : cloudReadersRef.current.conversationArchive;
  useEffect(() => {
    for (const [key, operation] of cloudOperationsRef.current) {
      const source = key.startsWith("cloud-task:") ? "cloud-task" : "chatgpt-conversation";
      const reader = cloudReader(source);
      if (surface !== "settings" || !reader?.isCurrentIdentity?.(operation.identity)) operation.controller.abort();
      if (surface !== "settings" || !sameArchiveIdentity(reader?.identity, operation.identity)) cloudOperationsRef.current.delete(key);
    }
    setCloudDeleteTarget(current => current && (surface !== "settings" || !current.reader.isCurrentIdentity?.(current.identity)
      || !sameArchiveIdentity(cloudReader(current.thread.archiveSource!)?.identity, current.identity)) ? null : current);
    const freshRead = (recovery: CloudRecovery) => {
      const reader = cloudReader(recovery.source);
      return recovery.readAfterVersion !== undefined && reader?.status === "ready" && reader.readVersion > recovery.readAfterVersion
        && reader.isCurrentIdentity?.(recovery.identity) && !("httpEmptyStatus" in reader && reader.httpEmptyStatus !== null);
    };
    const refreshedArchived = new Set(Object.entries(cloudRecoveries).filter(([, recovery]) => recovery.status === "unknown" && freshRead(recovery)
      && cloudReader(recovery.source)?.items.some(item => item.id === recovery.id)).map(([key]) => key));
    for (const key of refreshedArchived) if (cloudOperationsRef.current.get(key)?.result === "unknown" && cloudOperationsRef.current.get(key)?.token === cloudRecoveries[key]?.token) cloudOperationsRef.current.delete(key);
    setCloudRecoveries(current => {
      let changed = false;
      const entries = Object.entries(current).flatMap(([key, recovery]) => {
        if (surface !== "settings" || !sameArchiveIdentity(cloudReader(recovery.source)?.identity, recovery.identity)
          || refreshedArchived.has(key) && recovery === cloudRecoveries[key]) { changed = true; return []; }
        if (recovery.status === "accepted" && recovery.detail && freshRead(recovery)) {
          changed = true; return [[key, { ...recovery, detail: undefined, readAfterVersion: undefined }] as const];
        }
        return [[key, recovery] as const];
      });
      return changed ? Object.fromEntries(entries) : current;
    });
  }, [cloudArchive, conversationArchive, surface, cloudRecoveries]);

  const recoverCloud = async (thread: ArchivedThread, renderedReader?: ArchivedCloudTasksState | ArchivedConversationsState) => {
    const source = thread.archiveSource;
    if (!source || surface !== "settings" || cloudReadersRef.current.surface !== "settings") return;
    const key = `${source}:${thread.id}`, reader = cloudReader(source), identity = renderedReader?.identity;
    if (!identity || !renderedReader?.canUnarchive?.(thread.id, identity) || !sameArchiveIdentity(reader?.identity, identity) || reader?.status !== "ready" || typeof reader.canUnarchive !== "function" || !reader.canUnarchive(thread.id, identity)
      || cloudOperationsRef.current.has(key) || ["pending", "unknown", "accepted"].includes(cloudRecoveries[key]?.status)) return;
    const operation = { controller: new AbortController(), identity, sent: false, token: {}, result: "pending" as CloudRecovery["status"] };
    cloudOperationsRef.current.set(key, operation);
    const base = { source, id: thread.id, identity, title: archiveTitle(thread), token: operation.token, kind: "unarchive" as const };
    setCloudRecoveries(current => ({ ...current, [key]: { ...base, status: "pending" } }));
    const active = () => mountedRef.current && cloudReadersRef.current.surface === "settings" && cloudOperationsRef.current.get(key) === operation
      && !operation.controller.signal.aborted && Boolean(cloudReader(source)?.isCurrentIdentity?.(identity))
      && (operation.sent || Boolean(cloudReader(source)?.canUnarchive?.(thread.id, identity)));
    const updateRecovery = (recovery: CloudRecovery) => setCloudRecoveries(current => current[key]?.token === operation.token ? { ...current, [key]: recovery } : current);
    let accepted = false, changed = false, refreshed = false;
    try {
      const before = await accountRead();
      if (!active()) return;
      if (before.account?.type !== "chatgpt" || before.workspaceRouting?.chatgptAccountId && before.workspaceRouting.chatgptAccountId !== identity.accountId
        || !sameArchiveIdentity(await serviceIdentity(operation.controller.signal), identity)) throw Object.assign(Error("Account changed before write"), { code: "account_changed" });
      if (!active()) return;
      operation.sent = true;
      await unarchiveCloudItem(source, thread.id, identity, operation.controller.signal);
      accepted = true;
      if (!active()) return;
      const after = await accountRead();
      if (!active()) return;
      if (JSON.stringify(before) !== JSON.stringify(after) || !sameArchiveIdentity(await serviceIdentity(operation.controller.signal), identity)) {
        changed = true; if (cloudOperationsRef.current.get(key) === operation && cloudReader(source)?.isCurrentIdentity?.(identity)) { cloudReader(source)?.reload(); refreshed = true; } return;
      }
      if (!active() || !cloudReader(source)?.forgetAccepted(thread.id, identity)) return;
      operation.result = "accepted";
      updateRecovery({ ...base, status: "accepted" });
      onShowToast?.("聊天已取消归档", "info");
      if (source === "chatgpt-conversation") cloudReader(source)?.reload();
    } catch (cause) {
      if (cloudOperationsRef.current.get(key) !== operation || !mountedRef.current || !sameArchiveIdentity(cloudReader(source)?.identity, identity) || !cloudReader(source)?.isCurrentIdentity?.(identity) || cloudReadersRef.current.surface !== "settings") return;
      const code = (cause as { code?: string })?.code;
      const detail = typeof (cause as { message?: unknown })?.message === "string" ? (cause as { message: string }).message : String(cause);
      const unknown = code === "archive_write_unknown" || operation.sent && operation.controller.signal.aborted;
      operation.result = accepted ? "accepted" : unknown ? "unknown" : "failed";
      updateRecovery({ ...base, status: operation.result, detail, readAfterVersion: accepted ? cloudReader(source)?.readVersion : undefined });
      if (accepted) { onShowToast?.("聊天已取消归档", "info"); if (source === "chatgpt-conversation") cloudReader(source)?.reload(); }
      else onShowToast?.(unknown ? "取消归档结果尚未确认，请刷新查看。" : "无法取消归档聊天", "error");
      if (!accepted && (code === "account_changed" || code === "archive_identity_changed" || code === "invalid_auth" || code?.startsWith("auth_"))) { cloudReader(source)?.reload(); refreshed = true; }
    } finally {
      const ownsOperation = cloudOperationsRef.current.get(key) === operation;
      const sameContext = ownsOperation && mountedRef.current && cloudReadersRef.current.surface === "settings" && Boolean(cloudReader(source)?.isCurrentIdentity?.(identity));
      if (!changed && sameContext && operation.result === "pending" && operation.sent) {
        operation.result = accepted ? "accepted" : "unknown";
        updateRecovery({ ...base, status: operation.result, detail: "列表读取状态已变化，请刷新查看。" });
      }
      if (cloudOperationsRef.current.get(key) === operation && (changed || !sameContext || !["accepted", "unknown"].includes(operation.result))) cloudOperationsRef.current.delete(key);
      if (mountedRef.current) setCloudRecoveries(current => {
        if (current[key]?.token !== operation.token) return current;
        if (changed || current[key]?.status === "pending" && operation.result === "pending") { const next = { ...current }; delete next[key]; return next; }
        return current;
      });
      if (ownsOperation && !refreshed && source === "cloud-task" && operation.sent && !changed && mountedRef.current && cloudReader(source)?.isCurrentIdentity?.(identity)) cloudReader(source)?.reload();
    }
  };

  const closeCloudDelete = (target: CloudDeleteTarget) => {
    if (cloudDeleteTargetRef.current?.dialogToken === target.dialogToken) cloudDeleteTargetRef.current = null;
    setCloudDeleteTarget(current => current?.dialogToken === target.dialogToken ? null : current);
  };
  const requestCloudDelete = (thread: ArchivedThread, renderedReader?: ArchivedCloudTasksState | ArchivedConversationsState) => {
    const source = thread.archiveSource, identity = renderedReader?.identity;
    if (!source || !identity || surface !== "settings" || cloudReadersRef.current.surface !== "settings" || cloudOperationsRef.current.has(`${source}:${thread.id}`)
      || !renderedReader?.canUnarchive?.(thread.id, identity) || !cloudReader(source)?.canUnarchive?.(thread.id, identity)) return;
    const target = { thread, reader: renderedReader, identity, dialogToken: {} };
    cloudDeleteTargetRef.current = target; setCloudDeleteTarget(target);
  };
  const deleteCloud = async (target: CloudDeleteTarget, retry = false) => {
    const { thread, reader: renderedReader, identity } = target, source = thread.archiveSource!;
    const key = `${source}:${thread.id}`;
    if ((retry ? cloudDeleteTargetRef.current !== null : cloudDeleteTargetRef.current?.dialogToken !== target.dialogToken)
      || surface !== "settings" || cloudReadersRef.current.surface !== "settings" || cloudOperationsRef.current.has(key)
      || !renderedReader.canUnarchive?.(thread.id, identity) || !sameArchiveIdentity(cloudReader(source)?.identity, identity)
      || !cloudReader(source)?.canUnarchive?.(thread.id, identity)) return;
    const operation = { controller: new AbortController(), identity, sent: false, token: {}, result: "pending" as CloudRecovery["status"] };
    cloudOperationsRef.current.set(key, operation);
    const base: CloudRecovery = { source, id: thread.id, identity, title: archiveTitle(thread), token: operation.token, kind: "delete", status: "pending" };
    setCloudRecoveries(current => ({ ...current, [key]: base }));
    if (source === "cloud-task") closeCloudDelete(target);
    const currentOperation = () => mountedRef.current && cloudReadersRef.current.surface === "settings" && cloudOperationsRef.current.get(key) === operation
      && !operation.controller.signal.aborted && Boolean(cloudReader(source)?.isCurrentIdentity?.(identity));
    const update = (value: CloudRecovery) => setCloudRecoveries(current => current[key]?.token === operation.token ? { ...current, [key]: value } : current);
    let accepted = false;
    try {
      const before = await accountRead();
      if (!currentOperation()) return;
      if (before.account?.type !== "chatgpt" || before.workspaceRouting?.chatgptAccountId && before.workspaceRouting.chatgptAccountId !== identity.accountId
        || !sameArchiveIdentity(await serviceIdentity(operation.controller.signal), identity)) throw Object.assign(Error("Account changed before delete"), { code: "account_changed" });
      if (!currentOperation() || !cloudReader(source)?.canUnarchive?.(thread.id, identity)) return;
      operation.sent = true;
      await deleteCloudArchiveItem(source, thread.id, identity, operation.controller.signal);
      accepted = true;
      if (!currentOperation()) return;
      const after = await accountRead();
      if (!currentOperation()) return;
      if (JSON.stringify(before) !== JSON.stringify(after) || !sameArchiveIdentity(await serviceIdentity(operation.controller.signal), identity)) {
        operation.result = "accepted";
        update({ ...base, status: "accepted", detail: "读取失败", readAfterVersion: cloudReader(source)?.readVersion });
        closeCloudDelete(target); cloudReader(source)?.reload(); return;
      }
      if (!currentOperation() || !cloudReader(source)?.forgetAccepted(thread.id, identity)) return;
      operation.result = "accepted"; update({ ...base, status: "accepted" }); closeCloudDelete(target); cloudReader(source)?.reload();
    } catch (cause) {
      if (!currentOperation()) return;
      const code = (cause as { code?: string })?.code;
      const unknown = code === "archive_write_unknown" || operation.sent && operation.controller.signal.aborted;
      operation.result = accepted ? "accepted" : unknown ? "unknown" : "failed";
      update({ ...base, status: operation.result, detail: accepted ? "读取失败" : undefined,
        readAfterVersion: accepted ? cloudReader(source)?.readVersion : undefined });
      if (accepted) { closeCloudDelete(target); cloudReader(source)?.reload(); }
      else if (unknown) onShowToast?.("删除结果尚未确认，请刷新查看。", "error");
      else if (source === "cloud-task") onShowToast?.("无法删除聊天。请重试。", "error", { label: "Retry", onClick: () => { void deleteCloud(target, true); } });
      else onShowToast?.("无法删除已归档的聊天", "error");
      if (!accepted && (code === "account_changed" || code === "archive_identity_changed" || code === "invalid_auth" || code?.startsWith("auth_"))) cloudReader(source)?.reload();
    } finally {
      if (cloudOperationsRef.current.get(key) !== operation) return;
      const live = mountedRef.current && cloudReadersRef.current.surface === "settings" && cloudReader(source)?.isCurrentIdentity?.(identity);
      if (live && operation.result === "pending" && operation.sent) {
        operation.result = accepted ? "accepted" : "unknown";
        update({ ...base, status: operation.result, detail: accepted ? "列表读取状态已变化" : undefined });
      }
      if (!live || !["accepted", "unknown"].includes(operation.result)) cloudOperationsRef.current.delete(key);
      if (mountedRef.current) setCloudRecoveries(current => current[key]?.token === operation.token && current[key].status === "pending" && operation.result === "pending"
        ? Object.fromEntries(Object.entries(current).filter(([entry]) => entry !== key)) : current);
    }
  };

  const refreshCloudSource = (source: ArchiveCloudSource, retryListeners = false) => {
    const reader = cloudReader(source);
    if (!reader) return;
    const version = reader.readVersion;
    if (typeof version === "number") setCloudRecoveries(current => Object.fromEntries(Object.entries(current).map(([key, recovery]) => [key,
      recovery.source === source && ["unknown", "accepted"].includes(recovery.status) && sameArchiveIdentity(reader.identity, recovery.identity)
        ? { ...recovery, readAfterVersion: version } : recovery])));
    if (retryListeners) reader.retryListeners(); else reader.reload();
  };

  const mutate = useCallback(
    async (thread: ArchivedThread | null, action: "restore" | "delete") => {
      if (mutationPendingRef.current) return;
      mutationPendingRef.current = true;
      ++requestSeqRef.current;
      setLoading(false);
      setBusyId(thread?.id ?? "all");
      try {
        if (action === "restore" && thread) {
          await onUnarchive(thread);
          if (!mountedRef.current) return;
          setThreads(current => current.filter(item => item.id !== thread.id));
          setRestoredThread(thread);
          onShowToast?.("聊天已取消归档", "success");
          await load(true);
        } else {
          const result = thread ? await onDelete(thread) : await onDeleteAll();
          if (!mountedRef.current) return;
          const deleted = new Set(result.deletedThreadIds);
          setThreads(current => current.filter(item => !deleted.has(item.id)));
          if (restoredThread && deleted.has(restoredThread.id)) setRestoredThread(null);
          if (result.error) onShowToast?.(`${deleted.size ? `已永久删除 ${deleted.size} 个归档聊天；` : ""}删除失败：${result.error}`, "error");
          else onShowToast?.(deleted.size ? `已永久删除 ${deleted.size} 个归档聊天` : "没有删除聊天，归档状态可能已更改", deleted.size ? "success" : "info");
          const refreshed = await load(true, deleted.size > 0);
          if (mountedRef.current && !refreshed && deleted.size > 0) onShowToast?.("删除已执行，刷新失败，请重试刷新列表", "error");
        }
      } catch (e: any) {
        if (mountedRef.current) {
          onShowToast?.(`${action === "restore" ? "恢复失败" : "删除结果未确认"}：${e?.message || e}`, "error");
          if (action === "delete") await load(true);
        }
      } finally {
        mutationPendingRef.current = false;
        if (mountedRef.current) setBusyId(null);
      }
    },
    [onUnarchive, onDelete, onDeleteAll, onShowToast, load, restoredThread]
  );

  const handleUnarchive = useCallback(
    async (thread: ArchivedThread) => { await mutate(thread, "restore"); },
    [mutate]
  );

  const handleDelete = useCallback(
    (thread: ArchivedThread) => {
      if (mutationPendingRef.current || loading) return;
      setDeleteTarget(thread);
    },
    [loading]
  );

  const handleDeleteDecision = useCallback(async (confirmed: boolean) => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!confirmed || !target || mutationPendingRef.current || loading) return;
    if (target === "all" && (error || threads.length === 0)) return;
    await mutate(target === "all" ? null : target, "delete");
  }, [deleteTarget, loading, error, threads.length, mutate]);

  const query = useDeferredValue(search.trim().toLocaleLowerCase());
  const visible = useMemo(() => threads.filter((thread) =>
    !query || (thread.name || thread.preview || thread.id).toLocaleLowerCase().includes(query)
  ), [threads, query]);

  const settings = surface === "settings";
  const projects = useMemo(() => settings ? buildSidebarProjectGroups(workspaces, projectMembership) : [], [settings, workspaces, projectMembership]);
  const projectOptions = useMemo(() => [
    { value: "all", label: "所有项目" },
    ...projects.map(project => ({ value: `project:local::${project.id}`, label: project.label,
      title: projects.filter(item => item.label === project.label).length > 1 ? project.rootPaths.join("\n") : undefined })),
    { value: "special:none", label: "聊天" }, { value: "special:automations", label: "定时任务" },
  ], [projects]);
  const activeProjectFilter = projectOptions.some(option => option.value === projectFilter) ? projectFilter : "all";
  const settingsGroups = useMemo(() => {
    if (activeProjectFilter === "special:automations") return [];
    const cloudItems: ArchivedThread[] = kindFilter !== "local" && cloudArchive?.identity
      && ["ready", "loading", "error"].includes(cloudArchive.status)
      ? cloudArchive.items.map(task => ({ id: task.id, name: task.title, createdAt: task.createdAt ?? undefined,
        updatedAt: task.updatedAt ?? undefined, archiveSource: "cloud-task", environmentLabel: task.environmentLabel, displayTime: task.displayTime })) : [];
    const conversations: ArchivedThread[] = kindFilter !== "local" && conversationArchive?.identity
      && ["ready", "loading", "error"].includes(conversationArchive.status)
      ? conversationArchive.items.map(item => ({ id: item.id, name: item.title, createdAt: item.createdAt ?? undefined,
        updatedAt: item.updatedAt ?? undefined, archiveSource: "chatgpt-conversation", gizmoId: item.gizmoId, displayTime: item.displayTime })) : [];
    const entries = [...(kindFilter === "cloud" ? [] : threads), ...cloudItems, ...conversations].map(thread => {
      let project: typeof projects[number] | undefined;
      if (thread.archiveSource === "chatgpt-conversation") project = projects.find(item => item.entity?.id === thread.gizmoId);
      const hasWorkspaceOverride = !thread.archiveSource && Object.prototype.hasOwnProperty.call(projectMembership.workspaceProjectAssignments, thread.id);
      const workspaceOverride = projectMembership.workspaceProjectAssignments[thread.id];
      if (thread.archiveSource !== "chatgpt-conversation" && !projectMembership.projectlessThreadIds.includes(thread.id) && !(hasWorkspaceOverride && workspaceOverride == null)) {
        const assignment = hasWorkspaceOverride ? workspaceOverride : projectMembership.threadProjectAssignments[thread.id];
        if (assignment?.projectKind === "local") project = projects.find(item => item.id === assignment.projectId || item.serverProjectId === assignment.projectId);
        if (!project && thread.archiveSource !== "cloud-task") for (const path of [workspaceHints[thread.id], thread.cwd]) {
          if (!path?.trim()) continue;
          const normalized = archiveProjectPath(path);
          const matches = projects.filter(item => item.rootPaths.some(root => archiveProjectPath(root) === normalized));
          if (matches.length === 1) { project = matches[0]; break; }
        }
      }
      return { thread, groupId: project ? `project:local::${project.id}` : "special:none", label: project?.label ?? "" };
    }).filter(entry => (activeProjectFilter === "all" || entry.groupId === activeProjectFilter)
      && (!query || [archiveTitle(entry.thread), entry.label, archiveRepo(entry.thread.cwd), entry.thread.environmentLabel || ""].some(value => value.toLocaleLowerCase().includes(query))));
    const groups = new Map<string, { id: string; label: string; threads: ArchivedThread[] }>();
    for (const entry of entries) {
      const id = activeProjectFilter === "all" ? entry.groupId : "all";
      if (!groups.has(id)) groups.set(id, { id, label: entry.label, threads: [] });
      groups.get(id)!.threads.push(entry.thread);
    }
    const time = (thread: ArchivedThread) => sortKey === "created" ? archiveTime(thread.createdAt, thread.updatedAt) : archiveTime(thread.updatedAt, thread.createdAt);
    const compare = (a: ArchivedThread, b: ArchivedThread) => sortKey === "alphabetical"
      ? archiveTitle(a).localeCompare(archiveTitle(b)) || archiveTime(b.updatedAt, b.createdAt) - archiveTime(a.updatedAt, a.createdAt)
      : time(b) - time(a) || archiveTitle(a).localeCompare(archiveTitle(b));
    const result = [...groups.values()];
    for (const group of result) group.threads.sort(compare);
    return result.sort((a, b) => (sortKey === "alphabetical" ? 0 : Math.max(0, ...b.threads.map(time)) - Math.max(0, ...a.threads.map(time)))
      || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  }, [threads, projects, projectMembership, workspaceHints, activeProjectFilter, kindFilter, sortKey, query, cloudArchive, conversationArchive]);
  const displayedGroups = settings ? settingsGroups : [{ id: "global", label: "", threads: visible }];
  const displayedCount = displayedGroups.reduce((count, group) => count + group.threads.length, 0);
  const cloudVisible = settings && kindFilter !== "local";
  const cloudReady = Boolean(cloudArchive || conversationArchive) && (!cloudArchive || cloudArchive.status === "ready")
    && (!conversationArchive || conversationArchive.status === "ready");
  const unavailableSource = settings && (activeProjectFilter === "special:automations" || (kindFilter === "cloud" && !cloudReady));
  const localSourceVisible = !settings || kindFilter !== "cloud";
  const emptyReady = (!localSourceVisible || (!error && !loading)) && !unavailableSource && (!cloudVisible || (!cloudArchive && !conversationArchive) || cloudReady);
  const refreshSources = () => { if (localSourceVisible) void load(); if (cloudVisible) { refreshCloudSource("cloud-task"); refreshCloudSource("chatgpt-conversation"); } };

  return (
    <div className={`archive-view${settings ? " archive-settings" : ""}`} ref={viewRef} tabIndex={-1}>
      <header className="archive-header">
        {!settings && <div>
          <h2 className="archive-title">归档</h2>
          <p className="archive-subtitle">
            归档的会话不会出现在侧边栏；可随时恢复或在需要时彻底删除。
          </p>
        </div>}
        <div className="archive-header-actions">
          {!loading && !error && threads.length > 0 && (
            <button type="button" className="archive-action danger" disabled={busyId !== null} aria-label="删除所有本地已归档聊天"
              onClick={() => { if (!mutationPendingRef.current) setDeleteTarget("all"); }}>{settings && kindFilter === "cloud" ? "删除全部本地归档" : "全部删除"}</button>
          )}
          {!settings && <input
            className="archive-search"
            type="text"
            aria-label="搜索已归档的聊天"
            placeholder="搜索已归档的聊天"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />}
          <button
            type="button"
            className="archive-refresh"
            onClick={refreshSources}
            disabled={(localSourceVisible && loading) || busyId !== null || (cloudVisible && (cloudArchive?.status === "loading" || conversationArchive?.status === "loading"))}
          >
            {loading ? "刷新中…" : "刷新"}
          </button>
        </div>
      </header>

      {settings && <>
        <div className="archive-settings-toolbar">
          <input className="archive-search" type="search" aria-label="搜索已归档的聊天" placeholder="搜索已归档的聊天" value={search} onChange={event => setSearch(event.target.value)} />
          <div className="archive-settings-filters">
            <ArchiveFilterMenu kindFilter={kindFilter} sortKey={sortKey} onKindFilterChange={setKindFilter} onSortKeyChange={setSortKey} />
            <GeneralPreferenceSelect id="archive-project-filter" label="按项目筛选已归档的聊天" value={activeProjectFilter} options={projectOptions} onChange={setProjectFilter} />
          </div>
        </div>
        {kindFilter === "all" && !cloudArchive && !conversationArchive && <div className="archive-source-notice" role="status">当前仅列出本地归档，云端归档尚未接入，全部聊天的来源不完整。</div>}
        {cloudVisible && cloudArchive && !conversationArchive && <div className="archive-source-notice" role="status">云端任务归档；ChatGPT 会话归档尚未接入，当前结果不代表完整云端归档。</div>}
        {cloudVisible && conversationArchive && <div className="archive-source-notice" role="status">按当前账号资格读取归档来源。ChatGPT 会话页面尚未接入；当前列表仅包含已读取的页。</div>}
        {cloudVisible && conversationArchive && !cloudArchive && <div className="archive-source-notice" role="status">云端任务来源尚未接入，当前结果不代表完整云端归档。</div>}
        {kindFilter === "cloud" && !cloudArchive && !conversationArchive && <div className="archive-source-notice" role="status">云端归档尚未实现，无法读取云端结果。</div>}
        {cloudVisible && cloudArchive && <div className="archive-cloud-status" role="status">
          {cloudArchive.status === "signed_out" && <span>请登录 ChatGPT 账号以读取云端任务归档。</span>}
          {cloudArchive.status === "unsupported_auth" && <span>当前登录方式不支持云端任务归档，请使用 ChatGPT 账号。</span>}
          {cloudArchive.status === "loading" && <span>正在读取云端任务归档…</span>}
          {cloudArchive.status === "error" && <><span>无法读取云端任务归档：{cloudArchive.error}</span><button type="button" className="archive-action" onClick={() => refreshCloudSource("cloud-task", true)}>重试云端归档</button></>}
          {cloudArchive.httpEmptyStatus !== null && <span>云端任务来源返回 HTTP {cloudArchive.httpEmptyStatus}，按该来源规则无可显示任务；这不是完整云端归档结论。</span>}
          {cloudArchive.pageError && <><span>云端任务后续页读取失败：{cloudArchive.pageError}</span><button type="button" className="archive-action" disabled={cloudArchive.loadingMore} onClick={cloudArchive.loadMore}>重试加载云端任务</button></>}
          {!cloudArchive.pageError && cloudArchive.status === "ready" && cloudArchive.nextCursor !== null && <button type="button" className="archive-action" disabled={cloudArchive.loadingMore} onClick={cloudArchive.loadMore}>{cloudArchive.loadingMore ? "正在加载云端任务…" : "加载更多云端任务"}</button>}
        </div>}
        {cloudVisible && conversationArchive && <div className="archive-cloud-status" role="status">
          {conversationArchive.status === "signed_out" && <span>请登录 ChatGPT 账号以读取 ChatGPT 会话归档。</span>}
          {conversationArchive.status === "unsupported_auth" && <span>当前登录方式不支持 ChatGPT 会话归档。</span>}
          {conversationArchive.status === "denied" && <span>当前账号无权读取 ChatGPT 会话归档。</span>}
          {conversationArchive.status === "loading" && <span>正在读取 ChatGPT 会话归档…</span>}
          {conversationArchive.status === "error" && <><span>无法读取 ChatGPT 会话归档：{conversationArchive.error}</span><button type="button" className="archive-action" onClick={() => refreshCloudSource("chatgpt-conversation", true)}>重试 ChatGPT 会话归档</button></>}
          {conversationArchive.pageError && <><span>ChatGPT 会话后续页读取失败：{conversationArchive.pageError}</span><button type="button" className="archive-action" disabled={conversationArchive.loadingMore} onClick={conversationArchive.loadMore}>重试加载 ChatGPT 会话</button></>}
          {!conversationArchive.pageError && conversationArchive.status === "ready" && conversationArchive.nextOffset !== null && <button type="button" className="archive-action" disabled={conversationArchive.loadingMore} onClick={conversationArchive.loadMore}>{conversationArchive.loadingMore ? "正在加载 ChatGPT 会话…" : "加载更多 ChatGPT 会话"}</button>}
        </div>}
        {activeProjectFilter === "special:automations" && kindFilter !== "cloud" && <div className="archive-source-notice" role="status">计划任务归档的身份映射尚未接入，无法确认结果。</div>}
      </>}

      {settings && Object.entries(cloudRecoveries).map(([key, recovery]) => {
        const reader = cloudReader(recovery.source);
        if (!sameArchiveIdentity(reader?.identity, recovery.identity)) return null;
        const needsRead = recovery.status === "unknown" || recovery.status === "accepted" && (reader?.status === "error" || recovery.detail);
        if (!needsRead) return null;
        return <div key={key} className="archive-source-notice" role="status">
          {recovery.title}：{recovery.status === "unknown" ? (recovery.kind === "delete" ? "删除结果尚未确认，请刷新查看。" : "取消归档结果尚未确认，请刷新查看。") : recovery.kind === "delete" ? "聊天已删除，但列表刷新失败。" : "聊天已取消归档，但列表刷新失败。"}
          <button type="button" className="archive-action" onClick={() => refreshCloudSource(recovery.source)}>刷新列表</button>
        </div>;
      })}

      {restoredThread && (
        <div className="archive-footer" role="status">
          聊天已取消归档
          <button type="button" className="archive-action" onClick={() => onSelectThread(restoredThread.id)}>查看</button>
        </div>
      )}

      {error && localSourceVisible && (
        <div className="archive-error">
          <span>无法读取归档会话：{error}</span>
          <button type="button" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}

      {emptyReady && displayedCount === 0 && (
        <div className="archive-empty">
          <div className="archive-empty-title">{settings && (cloudArchive || conversationArchive) && kindFilter !== "local" ? (query ? "当前已读取的聊天中未找到匹配项" : "当前已读取的来源中没有归档聊天") : query ? "未找到匹配的归档聊天" : "暂无已归档的聊天"}</div>
        </div>
      )}

      {displayedCount > 0 && displayedGroups.map(group => (
        <section key={group.id} className="archive-group">
          {settings && activeProjectFilter === "all" && <header className="archive-group-header"><Folder size={14} aria-hidden="true" /><h3>{group.label || "无项目"}</h3><span>{group.threads.length} 个聊天</span></header>}
        <div className="archive-list">
          {group.threads.map((thread) => (
            <div key={settings ? `${thread.archiveSource || "local"}:${thread.id}` : thread.id} className={`archive-row${thread.archiveSource ? " archive-cloud-row" : ""}${thread.archiveSource === "chatgpt-conversation" ? " archive-conversation-row" : ""}`} >
              {thread.archiveSource && <Cloud size={14} aria-label={thread.archiveSource === "cloud-task" ? "云端任务" : "ChatGPT 会话"} className="archive-cloud-icon" />}
              <div className="archive-row-main">
                <span className="archive-row-title" title={thread.archiveSource === "chatgpt-conversation" ? "应用内 ChatGPT 会话页面尚未实现" : undefined}>
                  {settings ? archiveTitle(thread) : thread.name || thread.preview || thread.id}
                </span>
                <span className="archive-row-meta">
                  {settings ? <span>{(() => {
                    const updated = new Date((thread.updatedAt ?? NaN) * 1000), created = new Date((thread.createdAt ?? NaN) * 1000);
                    const date = thread.archiveSource
                      ? new Date(typeof thread.displayTime === "number" ? thread.displayTime * 1000 : thread.displayTime ?? NaN)
                      : Number.isFinite(updated.getTime()) ? updated : created;
                    if (!Number.isFinite(date.getTime())) return null;
                    const dateText = date.toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" });
                    const timeText = date.toLocaleTimeString("zh-CN", { hour: "numeric", minute: "2-digit" });
                    if (thread.archiveSource === "cloud-task" && activeProjectFilter !== "all" && thread.environmentLabel?.trim()) return `${dateText} ${timeText} • ${thread.environmentLabel.trim()}`;
                    const label = `${dateText}，${timeText}`;
                    return activeProjectFilter !== "all" && thread.cwd ? `${label} • ${archiveRepo(thread.cwd)}` : label;
                  })()}</span> : <span className="mono">{formatRelative(thread.updatedAt || thread.createdAt)}</span>}
                  {!settings && thread.cwd && (
                    <span className="mono archive-row-cwd" title={thread.cwd}>
                      {thread.cwd}
                    </span>
                  )}
                </span>
              </div>
              <div className="archive-row-actions">
                {thread.archiveSource ? <><button type="button" className="archive-action archive-recovery-button" aria-label="取消归档" aria-busy={cloudRecoveries[`${thread.archiveSource}:${thread.id}`]?.status === "pending" && cloudRecoveries[`${thread.archiveSource}:${thread.id}`]?.kind !== "delete"}
                  disabled={!cloudReader(thread.archiveSource)?.identity || cloudReader(thread.archiveSource)?.status !== "ready"
                    || typeof cloudReader(thread.archiveSource)?.canUnarchive !== "function" || !cloudReader(thread.archiveSource)?.canUnarchive(thread.id, cloudReader(thread.archiveSource)!.identity!)
                    || ["pending", "unknown", "accepted"].includes(cloudRecoveries[`${thread.archiveSource}:${thread.id}`]?.status)}
                  onClick={() => void recoverCloud(thread, thread.archiveSource === "cloud-task" ? cloudArchive : conversationArchive)}>{cloudRecoveries[`${thread.archiveSource}:${thread.id}`]?.status === "pending" && cloudRecoveries[`${thread.archiveSource}:${thread.id}`]?.kind !== "delete" && <LoaderCircle size={13} className="archive-recovery-spinner" aria-hidden="true" />}取消归档</button><button type="button" className="archive-action danger archive-recovery-button" aria-label={`删除已归档的聊天 ${archiveTitle(thread)}`}
                  aria-busy={cloudRecoveries[`${thread.archiveSource}:${thread.id}`]?.status === "pending" && cloudRecoveries[`${thread.archiveSource}:${thread.id}`]?.kind === "delete"}
                  disabled={!cloudReader(thread.archiveSource)?.identity || !cloudReader(thread.archiveSource)?.canUnarchive?.(thread.id, cloudReader(thread.archiveSource)!.identity!)
                    || ["pending", "unknown", "accepted"].includes(cloudRecoveries[`${thread.archiveSource}:${thread.id}`]?.status)}
                  onClick={() => requestCloudDelete(thread, thread.archiveSource === "cloud-task" ? cloudArchive : conversationArchive)}>
                  {cloudRecoveries[`${thread.archiveSource}:${thread.id}`]?.status === "pending" && cloudRecoveries[`${thread.archiveSource}:${thread.id}`]?.kind === "delete" && <LoaderCircle size={13} className="archive-recovery-spinner" aria-hidden="true" />}删除</button></> : <>
                <button
                  type="button"
                  className="archive-action danger"
                  disabled={loading || busyId !== null}
                  onClick={() => void handleDelete(thread)}
                  title="永久删除"
                  aria-label="删除已归档的聊天"
                >
                  <Trash2 size={13} />
                </button>
                <button
                  type="button"
                  className="archive-action"
                  disabled={busyId !== null}
                  onClick={() => void handleUnarchive(thread)}
                >
                  取消归档
                </button>
                </>}
              </div>
            </div>
          ))}
        </div>
        </section>
      ))}

      {!unavailableSource && !(cloudVisible && (cloudArchive || conversationArchive) && !cloudReady && displayedCount === 0) && <footer className="archive-footer">
        {settings && (cloudArchive || conversationArchive) && kindFilter !== "local" ? `已显示 ${displayedCount} 个聊天（仅当前账号已读取的来源与页）` : <>共 {displayedCount} 个{settings ? "本地归档聊天" : "归档会话"}{loading ? "（加载中…）" : ""}</>}
      </footer>}
      {cloudDeleteTarget && <CloudArchiveDeleteDialog title={archiveTitle(cloudDeleteTarget.thread)} fallbackRef={viewRef}
        busy={cloudRecoveries[`${cloudDeleteTarget.thread.archiveSource}:${cloudDeleteTarget.thread.id}`]?.kind === "delete" && cloudRecoveries[`${cloudDeleteTarget.thread.archiveSource}:${cloudDeleteTarget.thread.id}`]?.status === "pending"}
        blocked={![undefined, "failed"].includes(cloudRecoveries[`${cloudDeleteTarget.thread.archiveSource}:${cloudDeleteTarget.thread.id}`]?.status)
          || !cloudReader(cloudDeleteTarget.thread.archiveSource!)?.canUnarchive?.(cloudDeleteTarget.thread.id, cloudDeleteTarget.identity)}
        unknown={cloudRecoveries[`${cloudDeleteTarget.thread.archiveSource}:${cloudDeleteTarget.thread.id}`]?.status === "unknown"}
        onCancel={() => closeCloudDelete(cloudDeleteTarget)} onConfirm={() => deleteCloud(cloudDeleteTarget)} onRefresh={() => refreshCloudSource(cloudDeleteTarget.thread.archiveSource!)} />}
      {deleteTarget && <ArchiveDeleteDialog all={deleteTarget === "all"} onDecision={handleDeleteDecision} fallbackRef={viewRef} />}
    </div>
  );
};

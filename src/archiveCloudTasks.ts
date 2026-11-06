import { useRef, useState } from "react";
import { useArchiveReadLifecycle } from "./archiveReadLifecycle";
import { accountRead } from "./config";
import { readArchiveCloudTasksPage, serviceErrorMessage, serviceIdentity, type ServiceIdentity } from "./chatgptService";

export interface ArchivedCloudTask {
  source: "cloud-task"; id: string; title: string;
  createdAt: number | null; updatedAt: number | null; environmentLabel: string | null;
  displayTime: number | string | null;
}
export interface ArchivedCloudTasksPage { items: ArchivedCloudTask[]; nextCursor: string | null }
type Status = "signed_out" | "unsupported_auth" | "loading" | "ready" | "error";
interface State {
  items: ArchivedCloudTask[]; identity: ServiceIdentity | null; status: Status; error: string | null;
  loadingMore: boolean; pageError: string | null; nextCursor: string | null; httpEmptyStatus: 401 | 403 | 404 | null;
}
export interface ArchivedCloudTasksState extends State {
  reload: () => void; loadMore: () => void; retryListeners: () => void;
  readVersion: number; isCurrentIdentity: (identity: ServiceIdentity) => boolean;
  canUnarchive: (id: string, identity: ServiceIdentity) => boolean;
  forgetAccepted: (id: string, identity: ServiceIdentity) => boolean;
}
const empty = (): State => ({ items: [], identity: null, status: "signed_out", error: null,
  loadingMore: false, pageError: null, nextCursor: null, httpEmptyStatus: null });
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const sameIdentity = (a: ServiceIdentity | null, b: ServiceIdentity | null) => Boolean(a && b && a.accountId === b.accountId && a.userId === b.userId && a.generation === b.generation);
const changed = () => Object.assign(Error("读取期间账号发生变化，请重新读取。"), { code: "archive_identity_changed" });
function checkedCursor(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  // Local request bound, matching the host; not an observed upstream cursor limit.
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value) || new TextEncoder().encode(value).length > 2048) throw Error("归档分页游标无效。");
  return value;
}
export function decodeArchivedCloudTasksPage(value: unknown): ArchivedCloudTasksPage {
  const body = record(value);
  if (!body || !Array.isArray(body.items)) throw Error("云端归档响应格式无效。");
  const ids = new Set<string>(), items: ArchivedCloudTask[] = [];
  const timestamp = (value: unknown): number | string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) throw Error("云端归档时间无效。");
    return value;
  };
  for (const value of body.items) {
    const item = record(value);
    if (!item || typeof item.id !== "string" || !item.id.trim() || item.title != null && typeof item.title !== "string") throw Error("云端归档条目无效。");
    const display = record(item.task_status_display);
    if (item.task_status_display != null && !display || display?.environment_label != null && typeof display.environment_label !== "string") throw Error("云端归档环境信息无效。");
    const created = timestamp(item.created_at), updated = timestamp(item.updated_at);
    const task: ArchivedCloudTask = { source: "cloud-task", id: item.id, title: item.title as string ?? "",
      createdAt: typeof created === "number" ? created : null, updatedAt: typeof updated === "number" ? updated : null,
      displayTime: updated ?? created, environmentLabel: display?.environment_label as string ?? null };
    if (!ids.has(task.id)) { ids.add(task.id); items.push(task); }
  }
  return { items, nextCursor: checkedCursor(body.cursor) };
}

async function readPage(cursor: string | null, expected: ServiceIdentity | null, signal: AbortSignal) {
  checkedCursor(cursor);
  if (signal.aborted) throw Error("请求已取消");
  const before = await accountRead();
  if (signal.aborted) throw Error("请求已取消");
  if (!before.account) return { state: "signed_out" as const };
  if (before.account.type !== "chatgpt") return { state: "unsupported_auth" as const };
  const identity = await serviceIdentity(signal);
  if (signal.aborted) throw Error("请求已取消");
  if (expected && !sameIdentity(expected, identity) || before.workspaceRouting?.chatgptAccountId && before.workspaceRouting.chatgptAccountId !== identity.accountId) throw changed();
  const result = await readArchiveCloudTasksPage(cursor, identity, signal);
  if (signal.aborted) throw Error("请求已取消");
  const after = await accountRead();
  if (signal.aborted) throw Error("请求已取消");
  // The account may have signed out before identity resolution itself can complete.
  if (JSON.stringify(before) !== JSON.stringify(after)) throw changed();
  const current = await serviceIdentity(signal);
  if (signal.aborted) throw Error("请求已取消");
  if (!sameIdentity(identity, current)) throw changed();
  if ([401, 403, 404].includes(result.status)) {
    if (result.body !== null) throw Error("云端归档状态响应无效。");
    return { state: "ready" as const, identity, page: { items: [], nextCursor: null }, httpEmptyStatus: result.status as 401 | 403 | 404 };
  }
  if (result.status < 200 || result.status >= 300) throw Error(`无法读取云端归档（HTTP ${result.status}）。`);
  return { state: "ready" as const, identity, page: decodeArchivedCloudTasksPage(result.body), httpEmptyStatus: null };
}

export function useArchivedCloudTasks({ enabled, scope, connected }: { enabled: boolean; scope: string; connected: boolean }): ArchivedCloudTasksState {
  const [state, setState] = useState<State>(empty);
  const [viewScope, setViewScope] = useState(scope);
  const readVersion = useRef(0);
  const data = useRef(state), request = useRef<AbortController | null>(null), seen = useRef(new Set<string>());
  const latestRead = useRef<(more: boolean, capturedEpoch: number) => Promise<void>>(async () => {});
  const publish = (next: State) => { data.current = next; setState(next); setViewScope(scope); };
  const abort = () => { request.current?.abort(); request.current = null; seen.current.clear(); };
  const { epoch, valid, retryListeners } = useArchiveReadLifecycle({ enabled, scope, connected,
    onReset: disconnected => { abort(); publish({ ...empty(), status: !enabled ? "signed_out" : disconnected ? "error" : "loading",
      error: disconnected ? "连接已断开，请重新连接后重试。" : null }); },
    onReady: version => void latestRead.current(false, version),
    onListenerError: () => publish({ ...empty(), status: "error", error: "无法监听账户更新，请重试以恢复连接。" }), onCleanup: abort,
  });
  const renderEpoch = epoch.current;
  const read = async (more: boolean, capturedEpoch = renderEpoch) => {
    if (!valid(capturedEpoch, scope) || request.current) return;
    const previous = data.current, cursor = more ? previous.nextCursor : null;
    if (more && (previous.status !== "ready" || cursor === null || !previous.identity)) return;
    const controller = new AbortController(), version = epoch.current; request.current = controller;
    publish({ ...previous, status: more ? previous.status : "loading", error: null, loadingMore: more, pageError: null });
    try {
      const result = await readPage(cursor, previous.identity, controller.signal);
      if (!valid(version, scope) || controller.signal.aborted) return;
      if (result.state !== "ready") { seen.current.clear(); publish({ ...empty(), status: result.state }); return; }
      const next = result.page.nextCursor;
      if (next !== null && (next === cursor || more && seen.current.has(next))) throw Error("云端归档分页游标重复，无法继续读取。");
      if (!more) seen.current.clear();
      if (cursor !== null) seen.current.add(cursor);
      const ids = new Set<string>();
      const items = [...(more ? previous.items : []), ...result.page.items].filter(item => { if (ids.has(item.id)) return false; ids.add(item.id); return true; });
      if (!more && result.httpEmptyStatus === null) readVersion.current++;
      publish({ items, identity: result.identity, status: "ready", error: null, loadingMore: false, pageError: null, nextCursor: next, httpEmptyStatus: result.httpEmptyStatus });
    } catch (cause) {
      if (valid(version, scope) && !controller.signal.aborted) {
        const code = (cause as { code?: string })?.code;
        if (code === "archive_identity_changed" || code === "account_changed" || code === "invalid_auth" || code?.startsWith("auth_")) {
          seen.current.clear(); publish({ ...empty(), status: "error", error: serviceErrorMessage(cause) });
        }
        else publish({ ...previous, status: more ? previous.status : "error", loadingMore: false,
          error: more ? previous.error : serviceErrorMessage(cause), pageError: more ? serviceErrorMessage(cause) : null });
      }
    } finally { if (request.current === controller) request.current = null; }
  };
  latestRead.current = read;
  const visible = !enabled ? empty() : !connected ? { ...empty(), status: "error" as const, error: "连接已断开，请重新连接后重试。" }
    : viewScope === scope ? state : { ...empty(), status: "loading" as const };
  const isCurrentIdentity = (identity: ServiceIdentity) => valid(renderEpoch, scope) && sameIdentity(data.current.identity, identity);
  const canUnarchive = (id: string, identity: ServiceIdentity) => isCurrentIdentity(identity) && data.current.status === "ready"
    && data.current.items.some(item => item.id === id);
  const forgetAccepted = (id: string, identity: ServiceIdentity) => {
    if (!isCurrentIdentity(identity)) return false;
    abort();
    publish({ ...data.current, items: data.current.items.filter(item => item.id !== id), loadingMore: false, pageError: null });
    return true;
  };
  return { ...visible, readVersion: readVersion.current, isCurrentIdentity, canUnarchive, forgetAccepted, reload: () => void read(false), loadMore: () => void read(true),
    retryListeners };
}

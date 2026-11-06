import { useEffect, useRef, useState } from "react";
import { tauriListen } from "./bridge";
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
  const [viewScope, setViewScope] = useState(scope), [listenerRetry, setListenerRetry] = useState(0);
  const current = useRef({ enabled, scope, connected }); current.current = { enabled, scope, connected };
  const live = useRef({ mounted: false, subscribed: false, eventConnected: connected });
  const data = useRef(state), epoch = useRef(0), request = useRef<AbortController | null>(null), seen = useRef(new Set<string>());
  const publish = (next: State) => { data.current = next; setState(next); setViewScope(scope); };
  const valid = (version: number, captured: string) => epoch.current === version && live.current.mounted && live.current.subscribed && live.current.eventConnected &&
    current.current.enabled && current.current.connected && current.current.scope === captured;
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
  const latestRead = useRef(read); latestRead.current = read;
  useEffect(() => {
    live.current.mounted = true; live.current.subscribed = false; live.current.eventConnected = connected;
    let disposed = false, failed = false; const stops: (() => void)[] = [];
    const cleanup = () => { for (const stop of stops.splice(0)) stop(); };
    const reset = () => {
      epoch.current++; request.current?.abort(); request.current = null; seen.current.clear();
      const disconnected = enabled && (!current.current.connected || !live.current.eventConnected);
      publish({ ...empty(), status: !enabled ? "signed_out" : disconnected ? "error" : "loading",
        error: disconnected ? "连接已断开，请重新连接后重试。" : null });
    };
    const refresh = () => {
      reset();
      if (live.current.subscribed && live.current.eventConnected && current.current.connected && current.current.enabled && current.current.scope === scope) {
        void latestRead.current(false, epoch.current);
      }
    };
    reset();
    if (enabled) {
      const listen = <T,>(event: string, handler: (payload: T) => void) => tauriListen<T>(event, payload => {
        if (!disposed && !failed && current.current.enabled && current.current.scope === scope) handler(payload);
      }).then(stop => { if (disposed || failed) stop(); else stops.push(stop); });
      void Promise.all([
        listen<{ method: string }>("app-server:notification", event => { if (event.method === "account/updated") refresh(); }),
        listen<{ connected: boolean }>("app-server:status", status => { live.current.eventConnected = status.connected; refresh(); }),
        listen("chatgpt-service:invalidated", refresh),
      ]).then(() => { if (!disposed && !failed) { live.current.subscribed = true; refresh(); } }).catch(() => {
        if (disposed) return;
        failed = true; live.current.subscribed = false; cleanup(); reset();
        publish({ ...empty(), status: "error", error: "无法监听账户更新，请重试以恢复连接。" });
      });
    }
    return () => { disposed = true; live.current.mounted = false; live.current.subscribed = false; epoch.current++; request.current?.abort(); request.current = null; cleanup(); };
  }, [enabled, scope, connected, listenerRetry]);
  const visible = !enabled ? empty() : !connected ? { ...empty(), status: "error" as const, error: "连接已断开，请重新连接后重试。" }
    : viewScope === scope ? state : { ...empty(), status: "loading" as const };
  return { ...visible, reload: () => void read(false), loadMore: () => void read(true),
    retryListeners: () => { if (live.current.subscribed) void read(false); else setListenerRetry(value => value + 1); } };
}

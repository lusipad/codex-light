import { useRef, useState } from "react";
import { accountRead } from "./config";
import { readArchiveConversationsPage, serviceErrorMessage, serviceIdentity, type ServiceIdentity } from "./chatgptService";
import { useArchiveReadLifecycle } from "./archiveReadLifecycle";

export interface ArchivedConversation {
  source: "chatgpt-conversation"; id: string; title: string;
  createdAt: number | null; updatedAt: number | null; displayTime: number | string | null; gizmoId: string | null;
}
export interface ArchivedConversationsPage { items: ArchivedConversation[]; nextOffset: number | null }
interface State {
  items: ArchivedConversation[]; identity: ServiceIdentity | null;
  status: "signed_out" | "unsupported_auth" | "denied" | "loading" | "ready" | "error";
  error: string | null; loadingMore: boolean; pageError: string | null; nextOffset: number | null; includeWorkCloud: boolean | null;
}
export interface ArchivedConversationsState extends State { reload: () => void; loadMore: () => void; retryListeners: () => void;
  readVersion: number; isCurrentIdentity: (identity: ServiceIdentity) => boolean;
  canUnarchive: (id: string, identity: ServiceIdentity) => boolean; forgetAccepted: (id: string, identity: ServiceIdentity) => boolean }
const empty = (): State => ({ items: [], identity: null, status: "signed_out", error: null, loadingMore: false, pageError: null, nextOffset: null, includeWorkCloud: null });
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const sameIdentity = (a: ServiceIdentity | null, b: ServiceIdentity | null) => Boolean(a && b && a.accountId === b.accountId && a.userId === b.userId && a.generation === b.generation);
const changed = () => Object.assign(Error("读取期间账号发生变化，请重新读取。"), { code: "archive_identity_changed" });
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function decodeArchivedConversationsPage(value: unknown, expectedOffset?: number): ArchivedConversationsPage {
  const body = record(value);
  if (!body || !integer(body.offset) || !integer(body.limit) || body.limit === 0 || !integer(body.total) ||
    !Number.isSafeInteger(body.offset + body.limit) || expectedOffset !== undefined && body.offset !== expectedOffset ||
    body.items != null && !Array.isArray(body.items)) throw Error("ChatGPT 归档分页响应无效。");
  const ids = new Set<string>(), items: ArchivedConversation[] = [];
  const time = (value: unknown): string | number | null => {
    if (value == null) return null;
    if (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) throw Error("ChatGPT 归档时间无效。");
    return value;
  };
  const seconds = (value: string | number | null): number | null => {
    // _Dn uses Date.parse even for numeric input; only displayTime treats numbers as seconds.
    const parsed = Date.parse(value as string) / 1000;
    return Number.isFinite(parsed) ? parsed : null;
  };
  for (const value of body.items as unknown[] ?? []) {
    const item = record(value);
    if (!item || typeof item.id !== "string") continue; // Official PAr filters solely by string id.
    if (item.title != null && typeof item.title !== "string" || item.gizmo_id != null && typeof item.gizmo_id !== "string") throw Error("ChatGPT 归档条目无效。");
    const created = time(item.create_time), updated = time(item.update_time);
    if (!ids.has(item.id)) {
      ids.add(item.id); items.push({ source: "chatgpt-conversation", id: item.id, title: item.title as string ?? "",
        createdAt: seconds(created), updatedAt: seconds(updated), displayTime: updated ?? created, gizmoId: item.gizmo_id as string ?? null });
    }
  }
  const next = body.offset + body.limit;
  return { items, nextOffset: next < body.total ? next : null };
}

async function readPage(offset: number, expected: ServiceIdentity | null, signal: AbortSignal, expectedScope: boolean | null) {
  if (!integer(offset)) throw Error("ChatGPT 归档分页偏移无效。");
  if (signal.aborted) throw Error("请求已取消");
  const before = await accountRead();
  if (signal.aborted) throw Error("请求已取消");
  if (!before.account) return { state: "signed_out" as const };
  if (before.account.type !== "chatgpt") return { state: "unsupported_auth" as const };
  const identity = await serviceIdentity(signal);
  if (signal.aborted) throw Error("请求已取消");
  if (expected && !sameIdentity(expected, identity) || before.workspaceRouting?.chatgptAccountId && before.workspaceRouting.chatgptAccountId !== identity.accountId) throw changed();
  const result = await readArchiveConversationsPage(offset, identity, signal);
  if (signal.aborted) throw Error("请求已取消");
  const after = await accountRead();
  if (signal.aborted) throw Error("请求已取消");
  if (JSON.stringify(before) !== JSON.stringify(after)) throw changed();
  const current = await serviceIdentity(signal);
  if (signal.aborted) throw Error("请求已取消");
  if (!sameIdentity(identity, current)) throw changed();
  if (result.access.status === "denied") {
    if (result.access.includeWorkCloud !== null || result.body !== null) throw Error("ChatGPT 归档资格响应无效。");
    return { state: "denied" as const, identity };
  }
  if (result.access.status !== "allowed" || typeof result.access.includeWorkCloud !== "boolean") throw Error("ChatGPT 归档资格响应无效。");
  if (expectedScope !== null && expectedScope !== result.access.includeWorkCloud) {
    throw Object.assign(Error("归档读取范围已变化，请从首页重新读取。"), { code: "archive_scope_changed" });
  }
  return { state: "ready" as const, identity, includeWorkCloud: result.access.includeWorkCloud, page: decodeArchivedConversationsPage(result.body, offset) };
}

export function useArchivedConversations({ enabled, scope, connected }: { enabled: boolean; scope: string; connected: boolean }): ArchivedConversationsState {
  const [state, setState] = useState<State>(empty), [viewScope, setViewScope] = useState(scope);
  const readVersion = useRef(0);
  const data = useRef(state), request = useRef<AbortController | null>(null);
  const latestRead = useRef<(more: boolean, capturedEpoch: number) => Promise<void>>(async () => {});
  const publish = (next: State) => { data.current = next; setState(next); setViewScope(scope); };
  const abort = () => { request.current?.abort(); request.current = null; };
  const { epoch, valid, retryListeners } = useArchiveReadLifecycle({ enabled, scope, connected,
    onReset: disconnected => { abort(); publish({ ...empty(), status: !enabled ? "signed_out" : disconnected ? "error" : "loading",
      error: disconnected ? "连接已断开，请重新连接后重试。" : null }); },
    onReady: version => void latestRead.current(false, version),
    onListenerError: () => publish({ ...empty(), status: "error", error: "无法监听账户更新，请重试以恢复连接。" }), onCleanup: abort,
  });
  const renderEpoch = epoch.current;
  const read = async (more: boolean, capturedEpoch = renderEpoch) => {
    if (!valid(capturedEpoch, scope) || request.current) return;
    const previous = data.current, offset = more ? previous.nextOffset : 0;
    if (offset === null || more && (previous.status !== "ready" || !previous.identity)) return;
    const controller = new AbortController(), version = epoch.current; request.current = controller;
    publish({ ...previous, status: more ? previous.status : "loading", error: null, loadingMore: more, pageError: null });
    try {
      const result = await readPage(offset, previous.identity, controller.signal, previous.includeWorkCloud);
      if (!valid(version, scope) || controller.signal.aborted) return;
      if (result.state !== "ready") { publish({ ...empty(), status: result.state, identity: result.state === "denied" ? result.identity : null }); return; }
      const ids = new Set<string>();
      const items = [...(more ? previous.items : []), ...result.page.items].filter(item => { if (ids.has(item.id)) return false; ids.add(item.id); return true; });
      if (!more) readVersion.current++;
      publish({ items, identity: result.identity, status: "ready", error: null, loadingMore: false, pageError: null,
        nextOffset: result.page.nextOffset, includeWorkCloud: result.includeWorkCloud });
    } catch (cause) {
      if (valid(version, scope) && !controller.signal.aborted) {
        const code = (cause as { code?: string })?.code;
        if (code === "archive_scope_changed" || code === "archive_identity_changed" || code === "account_changed" || code === "invalid_auth" || code?.startsWith("auth_")) publish({ ...empty(), status: "error", error: serviceErrorMessage(cause) });
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
  return { ...visible, readVersion: readVersion.current, isCurrentIdentity, canUnarchive, forgetAccepted, reload: () => void read(false), loadMore: () => void read(true), retryListeners };
}

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { ServiceIdentity } from "./chatgptService";
import { readChatgptConversations } from "./chatgptTextClient";

export interface ChatgptConversationListItem {
  id: string;
  raw: Record<string, unknown>;
  title: string;
  updatedAt: number | null;
  preview: string | null;
  /** Raw service gizmo metadata, not a verified project-directory membership. */
  gizmoId: string | null;
}
export interface ChatgptConversationPage {
  raw: Record<string, unknown>;
  offset: number;
  limit: number;
  total: number;
  items: ChatgptConversationListItem[];
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
/** H13/H16 projection. Paging metadata validation is this adapter's boundary,
 * not a claim that the official producer validates a complete DTO schema. */
export function decodeChatgptConversationPage(value: unknown): ChatgptConversationPage {
  if (!record(value) || !['offset', 'limit', 'total'].every(key => typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && (value[key] as number) >= 0)) {
    throw new Error('ChatGPT 聊天列表的分页信息无效。');
  }
  if (value.items != null && !Array.isArray(value.items)) throw new Error('ChatGPT 聊天列表格式无效。');
  const items: ChatgptConversationListItem[] = [];
  for (const raw of value.items ?? []) {
    if (!record(raw) || typeof raw.id !== 'string') continue;
    if (raw.title != null && typeof raw.title !== 'string' || raw.snippet != null && typeof raw.snippet !== 'string') throw new Error('ChatGPT 聊天列表的文本信息无效。');
    const parsedTime = raw.update_time == null ? NaN : Date.parse(raw.update_time as string);
    items.push({ id: raw.id, raw, title: (raw.title as string | null | undefined)?.trim() || raw.id,
      updatedAt: Number.isFinite(parsedTime) ? parsedTime / 1000 : null,
      preview: (raw.snippet as string | null | undefined)?.trim() || null,
      gizmoId: typeof raw.gizmo_id === 'string' ? raw.gizmo_id : null });
  }
  return { raw: value, offset: value.offset as number, limit: value.limit as number, total: value.total as number, items };
}
export function getNextChatgptConversationOffset(pages: readonly ChatgptConversationPage[]): number | null {
  const last = pages.at(-1);
  return last && last.offset + last.limit < last.total ? 20 * pages.length : null;
}
export interface ChatgptConversationListOptions {
  identity: ServiceIdentity | null;
  ownerKey: string;
  includeProjectConversations: boolean;
}
export interface ChatgptConversationListState {
  pages: ChatgptConversationPage[];
  items: ChatgptConversationListItem[];
  loaded: boolean;
  loading: 'initial' | 'more' | 'refresh' | null;
  error: string | null;
  failedAction: 'initial' | 'more' | 'refresh' | null;
  nextOffset: number | null;
}
const scopeKey = (options: ChatgptConversationListOptions) => JSON.stringify([options.ownerKey, options.identity?.accountId,
  options.identity?.userId, options.identity?.generation, options.includeProjectConversations]);
const errorText = (error: unknown) => record(error) && typeof error.message === 'string' ? error.message
  : typeof error === 'string' ? error : 'ChatGPT 聊天列表读取失败。';
export function createChatgptConversationListController(getOptions: () => ChatgptConversationListOptions) {
  const empty: ChatgptConversationListState = { pages: [], items: [], loaded: false, loading: null, error: null, failedAction: null, nextOffset: null };
  let state = empty, scope = scopeKey(getOptions());
  interface Operation { scope: string; abort: AbortController; kind: 'initial' | 'more' | 'refresh'; promise: Promise<boolean> }
  let operation: Operation | null = null;
  const listeners = new Set<() => void>();
  const publish = (value: ChatgptConversationListState) => { state = value; for (const listener of listeners) listener(); };
  const reset = () => { const retired = operation; operation = null; retired?.abort.abort(); scope = scopeKey(getOptions()); publish(empty); };
  const syncScope = () => { if (scopeKey(getOptions()) !== scope) reset(); };
  const current = (request: Operation) => operation === request && scope === request.scope && scopeKey(getOptions()) === request.scope && !request.abort.signal.aborted;
  const run = (kind: Operation['kind'], offset: number): Promise<boolean> => {
    syncScope();
    if (operation) return operation.promise;
    const options = getOptions(); if (!options.identity) return Promise.resolve(false);
    const identity = { ...options.identity }, includeProjects = options.includeProjectConversations;
    const previousPages = state.pages;
    const request: Operation = { scope, kind, abort: new AbortController(), promise: Promise.resolve(false) };
    operation = request; publish({ ...state, loading: kind, error: null, failedAction: null });
    request.promise = (async () => {
      try {
        if (!current(request)) return false;
        let pages = kind === 'more' ? [...previousPages] : [];
        const count = kind === 'refresh' ? Math.max(1, previousPages.length) : 1;
        for (let index = 0; index < count; ++index) {
          const pageOffset = index === 0 ? offset : getNextChatgptConversationOffset(pages);
          if (pageOffset === null) break;
          const response = await readChatgptConversations(identity, pageOffset, includeProjects, request.abort.signal);
          if (!current(request)) return false;
          pages = [...pages, decodeChatgptConversationPage(response)];
        }
        publish({ pages, items: pages.flatMap(value => value.items), loaded: true, loading: null, error: null, failedAction: null,
          nextOffset: getNextChatgptConversationOffset(pages) });
        return true;
      } catch (error) {
        if (!current(request)) return false;
        publish({ ...state, loading: null, error: errorText(error), failedAction: kind }); return false;
      } finally { if (operation === request) operation = null; }
    })();
    return request.promise;
  };
  const loadInitial = (): Promise<boolean> => { syncScope(); return state.loaded ? Promise.resolve(true) : run('initial', 0); };
  const loadMore = (): Promise<boolean> => {
    syncScope(); if (!state.loaded) return loadInitial();
    return state.nextOffset === null ? Promise.resolve(false) : run('more', state.nextOffset);
  };
  const refresh = () => run('refresh', 0);
  return { getSnapshot: () => scope === scopeKey(getOptions()) ? state : empty,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    syncScope, reset, loadInitial, loadMore, refresh,
    retry: () => {
      syncScope(); if (operation) return operation.promise;
      return state.failedAction === 'initial' ? loadInitial() : state.failedAction === 'more' ? loadMore()
        : state.failedAction === 'refresh' ? refresh() : Promise.resolve(false);
    },
  };
}
export function useChatgptConversationList(options: ChatgptConversationListOptions) {
  const latest = useRef(options); latest.current = options;
  const controller = useRef<ReturnType<typeof createChatgptConversationListController> | null>(null);
  if (!controller.current) controller.current = createChatgptConversationListController(() => latest.current);
  const owner = controller.current;
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  useLayoutEffect(() => {
    owner.syncScope(); if (options.identity) void owner.loadInitial();
  }, [owner, options.ownerKey, options.identity?.accountId, options.identity?.userId, options.identity?.generation, options.includeProjectConversations]);
  useLayoutEffect(() => () => owner.reset(), [owner]);
  return { ...snapshot, loadInitial: owner.loadInitial, loadMore: owner.loadMore, refresh: owner.refresh, retry: owner.retry, reset: owner.reset };
}

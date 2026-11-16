import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { PluginDirectoryListing } from "../pluginDirectory";
import type { PluginDirectoryEntry } from "../pluginDirectoryEntries";
import {
  loadPluginDirectoryAccount, loadPluginDirectoryPersonalSummary, mergePluginDirectoryOriginPages,
  readPluginDirectoryCreatedPage, readPluginDirectoryOriginPage,
  type PluginDirectoryAccount, type PluginDirectoryCreatedCursor,
} from "../pluginDirectoryOrigins";
import "./PluginDirectoryOriginsView.css";

export type PluginDirectoryTab = "openai" | "workspace" | "personal" | "teams";
export interface PluginDirectoryLocalGroup { id: string; title: string; content: ReactNode; summaryContent?: ReactNode; count: number }
interface Props {
  tab: PluginDirectoryTab;
  onTabChange: (tab: PluginDirectoryTab) => void;
  contextKey: string;
  enabled: boolean;
  category?: string | null;
  onCategory: (category: string | null) => void;
  renderListing: (listing: PluginDirectoryListing) => ReactNode;
  children: ReactNode;
  localGroups?: PluginDirectoryLocalGroup[];
  localLoading?: boolean;
  localError?: string | null;
  onRetryLocal?: () => void;
}
const CREATED = "plugins-created-by-you", SHARED = "plugins-shared-with-you";
type ReadyAccount = Extract<PluginDirectoryAccount, { kind: "ready" }>;
type Summary = Awaited<ReturnType<typeof loadPluginDirectoryPersonalSummary>>;
type Cursor = string | PluginDirectoryCreatedCursor | null;
interface PageState { scope: string; pages: PluginDirectoryEntry[][]; cursor: Cursor; loading: boolean; error: string | null }

export function PluginDirectoryOriginsView({ tab, onTabChange, contextKey, enabled, category = null, onCategory,
  renderListing, children, localGroups = [], localLoading = false, localError = null, onRetryLocal }: Props) {
  const [retry, setRetry] = useState(0);
  const [accountState, setAccountState] = useState<{ key: string; account: PluginDirectoryAccount | null; error: string | null } | null>(null);
  const [summaryState, setSummaryState] = useState<{ key: string; value: Summary | null; error: string | null } | null>(null);
  const [page, setPage] = useState<PageState | null>(null);
  const request = useRef<{ scope: string; controller: AbortController; busy: boolean; seen: Set<string> } | null>(null);
  const key = `${contextKey}:${retry}`;
  const account = accountState?.key === key ? accountState.account : null;
  const accountError = accountState?.key === key ? accountState.error : null;
  const summary = summaryState?.key === key ? summaryState : null;
  const mode = category === CREATED ? "created" : category === SHARED ? "shared" : !category && tab === "workspace" ? "workspace" : null;
  const scope = `${key}:${mode}:${category ?? ""}`;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void loadPluginDirectoryAccount(controller.signal).then(value => {
      if (!controller.signal.aborted) setAccountState({ key, account: value, error: null });
    }, error => {
      if (!controller.signal.aborted) setAccountState({ key, account: null, error: String(error) });
    });
    return () => controller.abort();
  }, [key, enabled]);

  useEffect(() => {
    if (!enabled || !account) return;
    if (account.kind !== "ready") {
      setSummaryState({ key, value: { created: [], shared: null }, error: null });
      return;
    }
    const controller = new AbortController();
    void loadPluginDirectoryPersonalSummary(account, controller.signal).then(value => {
      if (!controller.signal.aborted) setSummaryState({ key, value, error: null });
    }, error => {
      if (!controller.signal.aborted) setSummaryState({ key, value: null, error: String(error) });
    });
    return () => controller.abort();
  }, [key, account, enabled]);

  async function fetchPage(active: NonNullable<typeof request.current>, ready: ReadyAccount, cursor: Cursor, first: boolean) {
    if (active.busy) return;
    const token = JSON.stringify(cursor);
    if (active.seen.has(token)) {
      setPage(previous => previous?.scope === active.scope ? { ...previous, loading: false, error: "插件目录返回了重复分页标记。" } : previous);
      return;
    }
    active.busy = true;
    setPage(previous => ({ scope: active.scope, pages: first ? [] : previous?.scope === active.scope ? previous.pages : [], cursor, loading: true, error: null }));
    try {
      const result = mode === "created"
        ? await readPluginDirectoryCreatedPage(ready, cursor as PluginDirectoryCreatedCursor | null, active.controller.signal)
        : await readPluginDirectoryOriginPage(ready, mode === "shared" ? "shared" : "workspace", cursor as string | null, active.controller.signal);
      if (active.controller.signal.aborted || request.current !== active) return;
      active.seen.add(token);
      setPage(previous => ({ scope: active.scope, pages: [...(first ? [] : previous?.scope === active.scope ? previous.pages : []), result.entries], cursor: result.nextCursor, loading: false, error: null }));
    } catch (error) {
      if (!active.controller.signal.aborted && request.current === active) setPage(previous => ({ scope: active.scope,
        pages: previous?.scope === active.scope ? previous.pages : [], cursor, loading: false, error: String(error) }));
    } finally { active.busy = false; }
  }

  useEffect(() => {
    if (!enabled || !mode || account?.kind !== "ready" || (mode !== "created" && account.structure !== "workspace")) return;
    const active = { scope, controller: new AbortController(), busy: false, seen: new Set<string>() };
    request.current = active;
    void fetchPage(active, account, null, true);
    return () => { active.controller.abort(); if (request.current === active) request.current = null; };
  }, [enabled, scope, account]);

  const localCount = localGroups.reduce((sum, group) => sum + group.count, 0);
  const personalKnownEmpty = summary?.value !== null && summary?.value !== undefined &&
    !summary.value.created.length && !summary.value.shared?.entries.length && !summary.value.shared?.nextCursor &&
    !localCount && !localLoading && !localError;
  const tabs: { id: PluginDirectoryTab; title: string }[] = [{ id: "openai", title: "公开" },
    ...(account?.kind === "ready" && account.structure === "workspace" ? [{ id: "workspace" as const, title: account.name || "工作空间" }] : []),
    ...(!personalKnownEmpty || tab === "personal" ? [{ id: "personal" as const, title: "个人" }] : [])];
  const selected = tabs.some(item => item.id === tab) ? tab : "openai";
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const elements = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const index = elements.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault(); event.stopPropagation();
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const step = (event.key === "ArrowRight" ? 1 : -1) * (rtl ? -1 : 1);
    const next = event.key === "Home" ? 0 : event.key === "End" ? elements.length - 1 : (index + step + elements.length) % elements.length;
    elements[next].focus(); elements[next].scrollIntoView({ block: "nearest", inline: "nearest" });
    if (tabs[next].id !== selected) onTabChange(tabs[next].id);
  }
  const retryButton = <button type="button" className="pm-catalog-action" onClick={() => setRetry(value => value + 1)}>重试</button>;
  const errorRow = (error: string) => <div role="alert">{error}{retryButton}</div>;
  const currentPage = page?.scope === scope ? page : null;
  const remoteRows = currentPage ? mergePluginDirectoryOriginPages(currentPage.pages, mode === "workspace" ? "workspace" : mode === "shared" ? "shared" : "personal") : [];
  function section(id: string, title: string, rows: PluginDirectoryEntry[], hasMore = false) {
    const local = localGroups.find(group => group.id === id);
    if (!rows.length && !local?.count && !hasMore) return null;
    return <section className="pm-catalog-section" key={id}><header><h3>{title}</h3>
      {(rows.length + (local?.count ?? 0) > 6 || hasMore) && <button type="button" className="pm-catalog-action" onClick={() => onCategory(id)}>查看更多</button>}</header>
      <div className="pm-catalog-grid">{local?.summaryContent ?? local?.content}{rows.slice(0, Math.max(0, 6 - (local?.count ?? 0))).map(entry => renderListing(entry.listing))}</div></section>;
  }
  const localStatus = localError ? <div role="alert">{localError}{onRetryLocal &&
    <button type="button" className="pm-catalog-action" onClick={onRetryLocal}>重试</button>}</div>
    : localLoading ? <p role="status">正在加载本地插件…</p> : null;
  const accountStatus = accountError ? errorRow(accountError) : !account ? <p role="status">正在加载插件来源…</p> : null;
  const specialCategory = category === CREATED || category === SHARED || category?.startsWith("plugins-marketplace-");
  if (!enabled) return children;
  return <div className="pdo-view">
    {!category && <div className="pdo-tabs" role="tablist" tabIndex={-1} aria-label="插件目录" onKeyDown={keyDown}
      onWheel={event => { event.currentTarget.scrollLeft += event.deltaX || event.deltaY; }}>
      {tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={selected === item.id} tabIndex={selected === item.id ? 0 : -1}
        onClick={() => { if (item.id !== selected) onTabChange(item.id); }}>{item.title}</button>)}
    </div>}
    {specialCategory && <button type="button" className="pm-catalog-back" onClick={() => onCategory(null)}>全部插件</button>}
    {tab === "teams" ? <p role="status">尚未确认当前账号的团队插件访问条件。</p> : category && !mode ?
      category.startsWith("plugins-marketplace-") ? <>{localStatus}{!localError && !localLoading &&
        <div className="pm-catalog-grid">{localGroups.find(group => group.id === category)?.content ?? <p>未找到插件</p>}</div>}</> : children : !category && selected === "openai" ? children : mode ? <>
        {category === CREATED && localStatus}
        <div className="pm-catalog-grid">{category === CREATED && localGroups.find(group => group.id === CREATED)?.content}{remoteRows.map(entry => renderListing(entry.listing))}</div>
        {accountStatus}
        {category === CREATED && account?.kind === "unauthenticated" && !localLoading && !localError &&
          !localGroups.some(group => group.id === CREATED && group.count) && <p>未找到插件</p>}
        {account && (account.kind !== "ready" || (mode !== "created" && account.structure !== "workspace")) && category !== CREATED && <p role="status">当前账号无法访问此插件来源。</p>}
        {account?.kind === "ready" && (mode === "created" || account.structure === "workspace") && <>
          {currentPage?.error && <div role="alert">{currentPage.error}<button type="button" className="pm-catalog-action" onClick={() => {
            if (request.current?.scope === scope) void fetchPage(request.current, account, currentPage.cursor, currentPage.pages.length === 0);
          }}>重试</button></div>}
          {(!currentPage || currentPage.loading) && <p role="status">正在加载插件…</p>}
          {currentPage && !currentPage.loading && !currentPage.error && !remoteRows.length && !(category === CREATED && (localLoading || localError || localGroups.some(group => group.id === CREATED && group.count))) && <p>未找到插件</p>}
          {currentPage && !currentPage.loading && currentPage.cursor !== null && !currentPage.error && <button type="button" className="pm-catalog-action" onClick={() => {
            if (request.current?.scope === scope) void fetchPage(request.current, account, currentPage.cursor, false);
          }}>加载更多</button>}
        </>}
      </> : <>
        {accountStatus}
        {localStatus}
        {summary?.error && errorRow(summary.error)}
        {account?.kind === "ready" && !summary && <p role="status">正在加载插件…</p>}
        {section(CREATED, "由你创建", summary?.value?.created ?? [])}
        {section(SHARED, "与你共享", summary?.value?.shared?.entries ?? [], !!summary?.value?.shared?.nextCursor)}
        {localGroups.filter(group => group.id !== CREATED && group.id !== SHARED).map(group => section(group.id, group.title, []))}
        {personalKnownEmpty && <p>未找到插件</p>}
      </>}
  </div>;
}

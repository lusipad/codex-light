import { useEffect, useRef, useState } from "react";
import { serviceErrorMessage } from "./chatgptService";
import { buildGithubSyncRepositories, githubSyncScope, loadPluginGithubSync, savePluginGithubSync, searchPluginGithubSync,
  type GithubSyncRepository as Repository, type PluginGithubSyncSnapshot as Snapshot } from "./pluginGithubSync";
import type { PluginAppSyncSnapshot, PluginAppSyncStatus } from "./pluginAppSync";

export interface PluginGithubSyncState {
  scope: string;
  snapshot: Snapshot | null;
  repositories: Repository[];
  selectedIds: number[];
  dirty: boolean;
  loading: boolean;
  searching: boolean;
  loadingMore: boolean;
  pending: boolean;
  blocked: boolean;
  uncertain: boolean;
  error: string | null;
  saveError: string | null;
  pageError: string | null;
  query: string;
  nextToken: string | null;
}
const empty = (scope: string): PluginGithubSyncState => ({ scope, snapshot: null, repositories: [], selectedIds: [], dirty: false, loading: true,
  searching: false, loadingMore: false, pending: false, blocked: true, uncertain: false, error: null, saveError: null, pageError: null, query: "", nextToken: null });
const same = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every(id => b.has(id));
const unconfirmed = "无法确认代码仓库是否已保存，请重新读取后核对。";
const initial = (scope: string) => ({ scope, version: 0, mounted: false, locked: false, baselineValid: false, state: empty(scope), draft: null as Set<number> | null,
  desired: null as Set<number> | null, registry: new Map<number, Repository>(), pages: [] as Repository[][], tokens: new Set<string | null>() });

export function usePluginGithubSync(connectionIdentity: string, parent: PluginAppSyncSnapshot, status: PluginAppSyncStatus) {
  const actualScope = githubSyncScope(parent, status), scope = JSON.stringify([connectionIdentity, actualScope]);
  const current = useRef(initial(scope)), request = useRef<AbortController | null>(null), ticket = useRef(0);
  const [state, setState] = useState<{ version: number; value: PluginGithubSyncState } | null>(null);
  if (current.current.scope !== scope) {
    const version = current.current.version + 1;
    current.current = { ...initial(scope), version, mounted: current.current.mounted };
  }
  const version = current.current.version;
  const active = () => current.current.mounted && current.current.scope === scope && current.current.version === version;
  const publish = (value: PluginGithubSyncState) => {
    const baseline = new Set(value.snapshot?.repositories.map(repo => repo.id) ?? []), selected = current.current.draft ?? baseline;
    value = { ...value, repositories: value.snapshot ? buildGithubSyncRepositories(value.snapshot.repositories, current.current.pages, value.query) : [],
      selectedIds: [...selected], dirty: current.current.desired !== null || !same(selected, baseline) };
    current.current.state = value; setState({ version, value });
  };
  const register = (repositories: Repository[]) => { for (const repo of repositories) current.current.registry.set(repo.id, repo); };
  const checkScope = (snapshot: Snapshot) => {
    if (githubSyncScope(snapshot.parent, snapshot.status) !== actualScope) throw Object.assign(Error("同步账户已变化，请重新读取。"), { code: "github_sync_scope_changed" });
  };
  const reload = async () => {
    if (!active() || current.current.locked) return;
    request.current?.abort();
    const controller = new AbortController(), generation = ++ticket.current, query = current.current.state.query;
    request.current = controller;
    const valid = () => active() && ticket.current === generation && !controller.signal.aborted;
    publish({ ...current.current.state, loading: true, searching: false, loadingMore: false, error: null, pageError: null });
    try {
      const [snapshot, page] = await Promise.all([loadPluginGithubSync(parent, status, controller.signal), searchPluginGithubSync(parent, status, query, null, controller.signal)]);
      if (!valid()) return;
      checkScope(snapshot); current.current.baselineValid = true;
      current.current.pages = [page.repositories]; current.current.tokens = new Set([null]); register(snapshot.repositories); register(page.repositories);
      const uncertain = current.current.desired !== null && !same(current.current.desired, new Set(snapshot.repositories.map(repo => repo.id)));
      if (!uncertain && current.current.desired !== null) { current.current.desired = null; current.current.draft = null; }
      publish({ ...current.current.state, snapshot, loading: false, blocked: uncertain, uncertain, nextToken: page.nextToken,
        error: null, saveError: uncertain ? unconfirmed : null, pageError: null });
    } catch (error) {
      if (!valid()) return;
      controller.abort(); current.current.baselineValid = false;
      publish({ ...current.current.state, loading: false, blocked: true, error: serviceErrorMessage(error) });
    }
  };
  useEffect(() => {
    current.current.mounted = true; void reload();
    return () => { current.current.mounted = false; ticket.current++; request.current?.abort(); };
  }, [scope]);
  const submitQuery = async (input: string) => {
    const before = current.current.state;
    if (!active() || current.current.locked || before.loading || before.uncertain || !before.snapshot || !current.current.baselineValid) return;
    const query = input.trim();
    if (query === before.query && before.error === null) return;
    request.current?.abort();
    const controller = new AbortController(), generation = ++ticket.current;
    request.current = controller; current.current.pages = []; current.current.tokens = new Set();
    const valid = () => active() && ticket.current === generation && !controller.signal.aborted;
    publish({ ...before, query, searching: true, loadingMore: false, error: null, pageError: null, nextToken: null });
    try {
      const page = await searchPluginGithubSync(parent, status, query, null, controller.signal);
      if (!valid()) return;
      current.current.pages = [page.repositories]; current.current.tokens = new Set([null]); register(page.repositories);
      publish({ ...current.current.state, searching: false, blocked: false, nextToken: page.nextToken });
    } catch (error) {
      if (valid()) publish({ ...current.current.state, searching: false, blocked: true, error: serviceErrorMessage(error) });
    }
  };
  const loadMore = async () => {
    const before = current.current.state, token = before.nextToken;
    if (!active() || current.current.locked || before.loading || before.searching || before.loadingMore || before.blocked || token === null) return;
    if (current.current.tokens.has(token)) { publish({ ...before, pageError: "分页标记重复，请重新加载代码仓库。" }); return; }
    request.current?.abort();
    const controller = new AbortController(), generation = ++ticket.current;
    request.current = controller;
    const valid = () => active() && ticket.current === generation && !controller.signal.aborted;
    publish({ ...before, loadingMore: true, pageError: null });
    try {
      const page = await searchPluginGithubSync(parent, status, before.query, token, controller.signal);
      if (!valid()) return;
      current.current.tokens.add(token); current.current.pages.push(page.repositories); register(page.repositories);
      const repeated = page.nextToken !== null && current.current.tokens.has(page.nextToken);
      publish({ ...current.current.state, loadingMore: false, nextToken: page.nextToken, pageError: repeated ? "分页标记重复，请重新加载代码仓库。" : null });
    } catch (error) {
      if (valid()) publish({ ...current.current.state, loadingMore: false, pageError: serviceErrorMessage(error) });
    }
  };
  const toggle = (id: number) => {
    const before = current.current.state;
    if (!active() || current.current.locked || before.loading || before.searching || before.loadingMore || before.blocked || !before.snapshot || !current.current.registry.has(id)) return;
    const selected = new Set(before.selectedIds);
    if (selected.has(id)) selected.delete(id); else if (selected.size < 5) selected.add(id); else return;
    current.current.draft = selected; publish({ ...before, saveError: null });
  };
  const cancel = () => {
    if (!active() || current.current.locked || current.current.state.uncertain) return;
    current.current.draft = null; publish({ ...current.current.state, saveError: null });
  };
  const save = async (): Promise<boolean> => {
    const before = current.current.state;
    if (!active() || current.current.locked || before.loading || before.searching || before.loadingMore || before.blocked || !before.snapshot || !before.dirty ||
      before.selectedIds.length === 0 || before.selectedIds.length > 5) return false;
    const baseline = new Set(before.snapshot.repositories.map(repo => repo.id)), selection: Repository[] = [];
    for (const id of before.selectedIds) {
      const repo = current.current.registry.get(id);
      if (!repo || !baseline.has(id) && !repo.proof) { publish({ ...before, saveError: "无法确认所选代码仓库的来源，请重新搜索。" }); return false; }
      selection.push(repo);
    }
    current.current.locked = true; request.current?.abort();
    const controller = new AbortController(), generation = ++ticket.current;
    request.current = controller;
    const valid = () => active() && ticket.current === generation && !controller.signal.aborted;
    publish({ ...before, pending: true, saveError: null });
    try {
      const result = await savePluginGithubSync(before.snapshot, selection, controller.signal);
      if (!valid()) return false;
      if (result.snapshot) checkScope(result.snapshot);
      const desired = new Set(before.selectedIds), confirmed = result.confirmed && result.snapshot !== null && result.refreshError === null &&
        same(desired, new Set(result.snapshot.repositories.map(repo => repo.id)));
      current.current.desired = confirmed ? null : desired;
      if (confirmed) current.current.draft = null;
      if (result.snapshot) register(result.snapshot.repositories);
      publish({ ...before, snapshot: result.snapshot ?? before.snapshot, pending: false, blocked: !confirmed, uncertain: !confirmed,
        saveError: confirmed ? null : result.refreshError ?? unconfirmed });
      return confirmed;
    } catch (error) {
      if (!valid()) return false;
      const code = (error as { code?: string } | null)?.code;
      const uncertain = code === "cancelled" || code === "account_changed" || code === "github_sync_scope_changed";
      current.current.desired = uncertain ? new Set(before.selectedIds) : null;
      publish({ ...before, pending: false, blocked: uncertain, uncertain, saveError: serviceErrorMessage(error) });
      return false;
    } finally { if (valid()) current.current.locked = false; }
  };
  return { state: state?.version === version && state.value.scope === scope ? state.value : current.current.state, reload, submitQuery, loadMore, toggle, cancel, save };
}

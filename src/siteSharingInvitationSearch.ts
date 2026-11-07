import { searchSiteSharingUsers, searchSiteSharingGroups, readSiteSharingTeams } from "./sitesSharingInvitationsClient";
import { filterSiteSharingInviteCandidates, type SiteSharingInviteCandidate } from "./siteSharingInvitationData";
import type { SiteSharingState } from "./siteSharingState";
export type { SiteSharingInviteCandidate } from "./siteSharingInvitationData";
type Directory = "users" | "groups" | "teams";

export class SiteSharingInvitationSearch {
  query = ""; focused = false;
  loading = { users: false, groups: false, teams: false };
  errors: Record<Directory, string | null> = { users: null, groups: null, teams: null };
  private results: Record<Directory, SiteSharingInviteCandidate[]> = { users: [], groups: [], teams: [] };
  private requests = new Map<Directory, AbortController>();
  private cache = new Map<string, { at: number; items: SiteSharingInviteCandidate[] }>();
  private listeners = new Set<() => void>(); private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setTimeout>; private mounted = false; private selecting = false; private authorization = "";
  constructor(readonly state: SiteSharingState) {}
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { if (this.mounted && !this.state.scope.aborted) this.listeners.forEach(listener => listener()); }
  get open() { return Boolean(this.mounted && this.focused && this.state.canInvite && (this.query.trim() || this.state.context?.teamsAllowed)); }
  get candidates(): SiteSharingInviteCandidate[] {
    const { context, participantPolicy: policy } = this.state; if (!this.mounted || !this.state.canInvite || !context || !policy) return [];
    return filterSiteSharingInviteCandidates(policy, context, this.query, this.results);
  }
  attach() {
    if (this.mounted) return; this.mounted = true; this.authorization = "";
    this.unsubscribe = this.state.subscribe(() => this.sync()); this.state.scope.addEventListener("abort", this.abort);
    if (typeof window !== "undefined") window.addEventListener("online", this.online);
    this.sync();
  }
  dispose() {
    this.mounted = false; this.unsubscribe?.(); this.unsubscribe = undefined; this.state.scope.removeEventListener("abort", this.abort);
    if (typeof window !== "undefined") window.removeEventListener("online", this.online); this.cancel();
  }
  private abort = () => { this.cancel(); this.emit(); };
  private online = () => { if (this.mounted && this.state.canInvite) { this.schedule(); if (this.state.context?.teamsAllowed) void this.read("teams", true); } };
  private sync() {
    const c = this.state.context, key = JSON.stringify([this.state.canInvite, c?.workspace, c?.workspaceGroupsAllowed, c?.teamsAllowed]);
    if (key !== this.authorization) {
      this.authorization = key; this.cancel();
      if (!this.state.canInvite) this.errors = { users: null, groups: null, teams: null };
      else {
        if (!c?.workspace) { this.errors.users = null; this.results.users = []; }
        if (!c?.workspaceGroupsAllowed) { this.errors.groups = null; this.results.groups = []; }
        if (!c?.teamsAllowed) { this.errors.teams = null; this.results.teams = []; }
      }
      if (this.state.canInvite) { this.schedule(); if (c?.teamsAllowed) void this.read("teams"); }
      else this.results = { users: [], groups: [], teams: [] };
    }
    this.emit();
  }
  private cancel(kind?: Directory) {
    if (!kind) { clearTimeout(this.timer); this.timer = undefined; }
    for (const [name, request] of this.requests) if (!kind || name === kind) { request.abort(); this.requests.delete(name); }
    if (kind) this.loading[kind] = false; else this.loading = { users: false, groups: false, teams: false };
  }
  setFocused(focused: boolean) { this.focused = focused; this.emit(); }
  setQuery(raw: string) {
    const previous = this.query.trim(); this.query = raw;
    if (previous !== raw.trim()) { this.cancel("users"); this.cancel("groups"); this.results.users = []; this.results.groups = []; this.errors.users = null; this.errors.groups = null; this.schedule(); }
    this.emit();
  }
  close() { this.setQuery(""); this.focused = false; this.emit(); }
  private schedule() {
    clearTimeout(this.timer); this.timer = undefined;
    const c = this.state.context;
    if (!this.mounted || !this.state.canInvite || !this.query.trim() || !c?.workspace) return;
    this.loading.users = true; this.loading.groups = c.workspaceGroupsAllowed;
    this.timer = setTimeout(() => { this.timer = undefined; void this.read("users"); if (this.state.context?.workspaceGroupsAllowed) void this.read("groups"); }, 150);
  }
  retry(kind: Directory) { if (this.mounted && this.state.canInvite) void this.read(kind, true); }
  private async read(kind: Directory, force = false) {
    const context = this.state.context, query = this.query.trim();
    if (!this.mounted || !this.state.canInvite || !context || this.requests.has(kind)
      || (kind === "teams" ? !context.teamsAllowed : !context.workspace || !query || kind === "groups" && !context.workspaceGroupsAllowed)) return;
    const key = `${kind}:${kind === "teams" ? "" : query}`, cached = this.cache.get(key);
    if (!force && cached && Date.now() - cached.at < 60000) { this.results[kind] = cached.items; this.loading[kind] = false; this.errors[kind] = null; this.emit(); return; }
    const source = new AbortController(); this.requests.set(kind, source); this.loading[kind] = true; this.errors[kind] = null; this.emit();
    try {
      const items = await (kind === "users" ? searchSiteSharingUsers(this.state.access, context, query, source.signal) : kind === "groups"
        ? searchSiteSharingGroups(this.state.access, context, query, source.signal) : readSiteSharingTeams(this.state.access, context, source.signal));
      if (!this.mounted || source.signal.aborted || this.state.scope.aborted || !this.state.canInvite || kind !== "teams" && query !== this.query.trim()) return;
      this.cache.set(key, { at: Date.now(), items }); this.results[kind] = items;
    } catch (error) {
      if (this.mounted && !source.signal.aborted && !this.state.scope.aborted) this.errors[kind] = error instanceof Error ? error.message : "目录读取失败";
    } finally {
      if (this.requests.get(kind) === source) { this.requests.delete(kind); this.loading[kind] = false; this.emit(); }
    }
  }
  async select(candidate: SiteSharingInviteCandidate): Promise<boolean> {
    if (!this.mounted || this.selecting || !this.state.canInvite || !this.candidates.some(item => item.source === candidate.source && JSON.stringify(item.target) === JSON.stringify(candidate.target))) return false;
    this.selecting = true; this.setQuery("");
    try { return await this.state.invite(candidate); } finally { this.selecting = false; this.emit(); }
  }
}

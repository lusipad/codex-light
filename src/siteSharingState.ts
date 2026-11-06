import { readSiteSharingContext, readSiteSharingPolicy, readSiteSharingUrl, writeSiteSharingMode, writeSiteSharingMember, type SiteSharingContext } from "./sitesSharingClient";
import { isSiteSharingOwner, siteSharingModeOptions, siteSharingMemberActions, type SiteSharingMemberTarget, type SiteSharingMode, type SiteSharingPolicy } from "./siteSharingData";
import type { SiteSharingWriteResult } from "./chatgptService";
import { trackRequest } from "./siteSettingsState";
import type { SitesClientAccess } from "./sitesClient";

export class SiteSharingState {
  open = false; context: SiteSharingContext | null = null; policy: SiteSharingPolicy | null = null;
  url: string | null | undefined; lastReadPolicy: SiteSharingPolicy | null = null; draft: SiteSharingMode | null = null; loading = false; saving = false; urlLoading = false;
  policyError = false; contextError = false; urlError = false; error: string | null = null; unknown = false; pendingMode: SiteSharingMode | null = null;
  memberUnknown: { target: SiteSharingMemberTarget; role: "viewer" | "editor" | null } | null = null; lastMemberAck: SiteSharingWriteResult | undefined;
  private mounted = false; private generation = 0; private policyTime = -Infinity; private contextTime = -Infinity; private urlTime = -Infinity; private changed = false;
  private reads = new Set<AbortController>(); private writeSource: AbortController | null = null; private listeners = new Set<() => void>();
  private abort = () => { this.reads.forEach(source => source.abort()); this.writeSource?.abort(); this.emit(); };
  constructor(readonly access: SitesClientAccess, readonly siteId: string, readonly scope: AbortSignal,
    public onPolicy: (policy: SiteSharingPolicy | null) => void | Promise<void>, public onError?: (message: string) => void) {}
  attach() { if (this.mounted) return; this.mounted = true; this.generation++; this.scope.addEventListener("abort", this.abort); if (this.scope.aborted) this.abort(); else if (this.open) void this.load(); }
  dispose() { this.mounted = false; this.generation++; this.loading = false; this.urlLoading = false; this.reads.forEach(source => source.abort()); if (!this.saving) this.scope.removeEventListener("abort", this.abort); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { if (this.mounted && !this.scope.aborted) this.listeners.forEach(listener => listener()); }
  private alive(generation: number) { return this.mounted && generation === this.generation && !this.scope.aborted; }
  get owner() { return Boolean(this.policy && this.context && !this.contextError && isSiteSharingOwner(this.policy, this.context.memberId, this.context.email)); }
  get selected() { return this.draft ?? this.policy?.accessMode ?? null; }
  get dirty() { return Boolean(this.policy && this.draft && this.draft !== this.policy.accessMode); }
  get options() { return this.policy ? siteSharingModeOptions(this.policy, this.context?.workspace ?? false) : []; }
  get canSave() { return this.owner && this.dirty && !this.saving && !this.loading && !this.policyError && !this.unknown && !this.memberUnknown && !this.scope.aborted && this.draft !== "admins_only" && this.options.some(option => option.value === this.draft && !option.disabled); }
  setOpen(open: boolean) {
    if (open === this.open) { if (open && !this.loading && !this.saving) void this.load(); return; }
    this.open = open;
    if (open) void this.load();
    else { this.generation++; this.reads.forEach(source => source.abort()); this.loading = false; this.urlLoading = false; this.draft = null; this.error = null; }
    this.emit();
  }
  change(mode: SiteSharingMode) { if (!this.owner || this.saving || this.unknown || this.memberUnknown || !this.options.some(option => option.value === mode && !option.disabled)) return; this.draft = mode === this.policy?.accessMode ? null : mode; this.error = null; this.emit(); }
  reset() { if (this.saving) return; this.draft = null; this.error = null; this.emit(); }
  async load(force = false) {
    if (!this.open || !this.mounted || this.scope.aborted || this.loading || this.saving) return;
    const generation = this.generation, source = new AbortController(); this.reads.add(source); this.loading = true; this.emit();
    const policyNeeded = force || Date.now() - this.policyTime >= 60000, contextNeeded = force || Date.now() - this.contextTime >= 60000;
    const context = contextNeeded ? (async () => {
      try { const result = await readSiteSharingContext(this.access, source.signal); if (this.alive(generation) && !source.signal.aborted) { this.context = result; this.contextError = false; this.contextTime = Date.now(); } }
      catch { if (this.alive(generation) && !source.signal.aborted) { this.contextError = true; this.contextTime = -Infinity; } }
    })() : Promise.resolve();
    const policy = policyNeeded ? (async () => {
      try { const result = await readSiteSharingPolicy(this.access, this.siteId, source.signal); if (this.alive(generation) && !source.signal.aborted) this.accept(result, force || this.changed); }
      catch (error) { if (this.alive(generation) && !source.signal.aborted) this.readError(error); }
    })() : Promise.resolve();
    if (force || Date.now() - this.urlTime >= 60000) void this.loadUrl(force);
    await Promise.all([context, policy]); this.reads.delete(source);
    if (this.alive(generation) && !source.signal.aborted) { this.loading = false; this.emit(); }
  }
  async loadUrl(force = true) {
    if (!this.mounted || !this.open || this.scope.aborted || this.urlLoading || (!force && Date.now() - this.urlTime < 60000)) return;
    const generation = this.generation, source = new AbortController(); this.reads.add(source); this.urlLoading = true;
    try { const url = await readSiteSharingUrl(this.access, this.siteId, source.signal); if (this.alive(generation) && !source.signal.aborted) { this.url = url; this.urlError = false; this.urlTime = Date.now(); } }
    catch { if (this.alive(generation) && !source.signal.aborted) { this.urlError = true; this.urlTime = -Infinity; } }
    finally { this.reads.delete(source); if (this.alive(generation)) this.urlLoading = false; this.emit(); }
  }
  private notify(policy: SiteSharingPolicy | null) {
    const generation = this.generation, failed = () => { if (this.alive(generation) && this.open) this.onError?.("无法读取站点最新信息"); };
    try { void Promise.resolve(this.onPolicy(policy)).catch(failed); } catch { failed(); }
  }
  private accept(policy: SiteSharingPolicy | null, notify = true) { this.lastReadPolicy = policy; this.policy = policy; this.policyError = policy === null; this.policyTime = policy ? Date.now() : -Infinity; if (notify) { this.changed = false; this.notify(policy); } }
  private readError(error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 403 || status === 404) { this.policy = null; this.notify(null); }
    this.policyError = true; this.policyTime = -Infinity;
  }
  private async converge(source: AbortController, generation: number, pendingMode: SiteSharingMode | null = null) {
    const timer = setTimeout(() => source.abort(), 10000);
    try {
      const policy = await readSiteSharingPolicy(this.access, this.siteId, source.signal);
      if (!this.alive(generation) || source.signal.aborted) return false;
      const effective = pendingMode === "workspace_all" && policy?.accessMode === "workspace_all" ? { ...policy, accessMode: "custom" as const } : policy;
      this.accept(effective); this.lastReadPolicy = policy; return policy !== null;
    } catch (error) { if (this.alive(generation) && !source.signal.aborted) this.readError(error); return false; }
    finally { clearTimeout(timer); }
  }
  async save() {
    if (!this.canSave || !this.draft) return;
    const mode = this.draft, generation = this.generation, source = new AbortController(); this.writeSource = source; this.saving = true; this.error = null; this.policyTime = -Infinity; this.changed = true; this.emit();
    await trackRequest(this.scope, (async () => {
      try {
        const result = await writeSiteSharingMode(this.access, this.siteId, mode, source.signal); if (!this.alive(generation)) return;
        this.pendingMode = result?.status === "pending" ? mode : null;
        const confirmed = await this.converge(source, generation, this.pendingMode);
        if (confirmed && (this.pendingMode || this.policy?.accessMode === mode)) { this.draft = null; this.unknown = false; }
        else if (this.alive(generation)) { this.unknown = true; this.error = "无法保存共享设置"; this.onError?.(this.error); }
      } catch (error) {
        if (!this.alive(generation)) return;
        this.unknown = (error as { code?: string })?.code === "site_sharing_unconfirmed";
        await this.converge(source, generation);
        if (this.alive(generation)) { this.draft = mode; this.error = "无法保存共享设置"; if (this.open) this.onError?.(this.error); }
      } finally { this.saving = false; if (this.writeSource === source) this.writeSource = null; if (!this.mounted) this.scope.removeEventListener("abort", this.abort); else if (this.open && generation !== this.generation && !this.scope.aborted) void this.load(); this.emit(); }
    })());
  }
  async recover() {
    if (!this.unknown || this.saving || !this.mounted || !this.open || this.scope.aborted) return;
    const generation = this.generation, source = new AbortController(); this.writeSource = source; this.saving = true; this.emit();
    await trackRequest(this.scope, (async () => {
      try { if (await this.converge(source, generation)) { this.unknown = false; this.error = null; if (this.draft === this.policy?.accessMode) this.draft = null; } }
      finally { this.saving = false; if (this.writeSource === source) this.writeSource = null; if (!this.mounted) this.scope.removeEventListener("abort", this.abort); this.emit(); }
    })());
  }
  memberActions(target: SiteSharingMemberTarget, busy = this.saving || this.loading || this.unknown || Boolean(this.memberUnknown)) {
    if (!this.policy || !this.context || this.contextError || this.scope.aborted) return { canRemove: false, canMakeEditor: false, canMakeViewer: false, role: null };
    return siteSharingMemberActions(this.policy, this.context, this.selected, busy, target);
  }
  private memberConfirmed(target: SiteSharingMemberTarget, role: "viewer" | "editor" | null) {
    if (!this.policy) return false;
    const entry = target.kind === "group" ? this.policy.groups.find(group => group.id === target.id)
      : this.policy.users.find(user => target.kind === "user" ? user.account_user_id === target.id : user.email?.trim().toLowerCase() === target.email.trim().toLowerCase());
    return role === null ? !entry : Boolean(entry && entry.role === role && !entry.pending);
  }
  async changeMember(target: SiteSharingMemberTarget, role: "viewer" | "editor" | null, expected?: { label: string; role: string | null }): Promise<boolean> {
    if (!this.mounted || !this.open || this.scope.aborted || this.saving || this.loading || this.unknown || this.memberUnknown) return false;
    const generation = this.generation, source = new AbortController(), stale = this.policyError || Date.now() - this.policyTime >= 60000;
    this.writeSource = source; this.saving = true; this.error = null; this.emit();
    return trackRequest(this.scope, (async () => {
      let acknowledged = false;
      try {
        if (stale && !await this.converge(source, generation)) { if (this.alive(generation)) this.error = "无法加载共享设置"; return false; }
        if (!this.alive(generation) || source.signal.aborted) return false;
        const actions = this.memberActions(target, false), permitted = role === null ? actions.canRemove : role === "editor" ? actions.canMakeEditor : actions.canMakeViewer;
        if (expected) {
          const entry = target.kind === "group" ? this.policy?.groups.find(group => group.id === target.id) : this.policy?.users.find(user => target.kind === "user" ? user.account_user_id === target.id : user.account_user_id == null && user.email === target.email);
          const label = entry?.name ?? (target.kind === "group" ? "群组" : entry?.email ?? entry?.account_user_id ?? "");
          if (!entry || label !== expected.label || actions.role !== expected.role) { this.error = "当前访问权限已变化，请刷新权限后重试。"; return false; }
        }
        if (!permitted || this.policy?.accessMode === "admins_only") { this.error = "当前访问权限已变化，请刷新权限后重试。"; return false; }
        this.policyTime = -Infinity; this.changed = true;
        this.lastMemberAck = await writeSiteSharingMember(this.access, this.siteId, target, role, source.signal); acknowledged = true;
        if (!this.alive(generation)) return false;
        if (await this.converge(source, generation) && this.memberConfirmed(target, role)) { this.memberUnknown = null; return true; }
        if (this.alive(generation)) { this.memberUnknown = { target, role }; this.error = "访问权限变更尚未确认，请重新读取共享设置。"; }
        return false;
      } catch (error) {
        if (!this.alive(generation)) return false;
        if (acknowledged || (error as { code?: string })?.code === "site_sharing_unconfirmed") this.memberUnknown = { target, role };
        await this.converge(source, generation);
        if (this.alive(generation)) { this.error = "无法保存共享设置"; if (this.open) this.onError?.(this.error); }
        return false;
      } finally { this.saving = false; if (this.writeSource === source) this.writeSource = null; if (!this.mounted) this.scope.removeEventListener("abort", this.abort); else if (this.open && generation !== this.generation && !this.scope.aborted) void this.load(); this.emit(); }
    })());
  }
  async recoverMember(): Promise<boolean> {
    if (!this.memberUnknown || this.saving || !this.mounted || !this.open || this.scope.aborted) return false;
    const operation = this.memberUnknown, generation = this.generation, source = new AbortController(); this.writeSource = source; this.saving = true; this.emit();
    return trackRequest(this.scope, (async () => {
      try {
        if (await this.converge(source, generation) && this.memberConfirmed(operation.target, operation.role)) { this.memberUnknown = null; this.error = null; return true; }
        if (this.alive(generation)) this.error = "访问权限变更尚未确认，请重新读取共享设置。";
        return false;
      } finally { this.saving = false; if (this.writeSource === source) this.writeSource = null; if (!this.mounted) this.scope.removeEventListener("abort", this.abort); this.emit(); }
    })());
  }
}

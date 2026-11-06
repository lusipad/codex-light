import { readSiteDetail, readSiteEnvironmentSnapshot, saveSiteTitle, saveSiteEnvironment, type SitesClientAccess } from "./sitesClient";
import type { SiteRecord, SiteEnvironmentSnapshot } from "./sitesService";
import type { SiteAssetRef } from "./chatgptService";

export const STORED_SECRET = "<REDACTED>";
export interface EnvironmentDraft { rowId: string; key: string; value: string; secret: boolean; previousKey?: string; storedSecret?: boolean }
type Status = "idle" | "saving" | "saved" | "error";
type UpdatedSite = { site: SiteRecord; assets: SiteAssetRef[] };
let nextRow = 0;
export const newEnvironmentDraft = (secret = false): EnvironmentDraft => ({ rowId: `site-env-${++nextRow}`, key: "", value: "", secret });
export const environmentDraft = (snapshot: SiteEnvironmentSnapshot): EnvironmentDraft[] => snapshot.entries.map(entry => ({ ...newEnvironmentDraft(entry.secret), key: entry.key,
  value: entry.secret ? STORED_SECRET : entry.value ?? "", secret: entry.secret, previousKey: entry.key, ...(entry.secret ? { storedSecret: true } : {}) }));
export const unchangedSecret = (entry: EnvironmentDraft) => entry.secret && entry.storedSecret && entry.previousKey !== undefined && [STORED_SECRET, ""].includes(entry.value);
export function environmentValidation(entries: EnvironmentDraft[]): string | null {
  if (entries.some(entry => !entry.key.trim())) return "请为每个环境变量输入键名，或移除空行";
  if (new Set(entries.map(entry => entry.key)).size !== entries.length) return "环境变量键必须唯一";
  if (entries.some(entry => !entry.secret && entry.storedSecret && [STORED_SECRET, ""].includes(entry.value))) return "在将已存储的机密设为公开前，请输入新值";
  return null;
}
export function environmentPatch(base: SiteEnvironmentSnapshot, entries: EnvironmentDraft[]) {
  const retained = new Set(entries.map(entry => unchangedSecret(entry) ? entry.previousKey! : entry.key));
  return { remove: base.entries.filter(entry => !retained.has(entry.key)).map(entry => entry.key), set_values: entries.filter(entry => {
    if (unchangedSecret(entry)) return false;
    const old = base.entries.find(value => value.key === entry.key);
    return !old || old.secret !== entry.secret || old.value !== entry.value;
  }).map(entry => ({ key: entry.key, type: "envvar" as const, is_secret: entry.secret, value: entry.value })) };
}
/** Source Ln: preserve edits made after the sent draft; adopt unrelated fresh server entries. */
export function rebaseEnvironment(current: EnvironmentDraft[], sent: EnvironmentDraft[], fresh: SiteEnvironmentSnapshot, uncertain = new Set<string>()): EnvironmentDraft[] {
  const incoming = environmentDraft(fresh);
  return [...current.flatMap(entry => {
    const old = sent.find(value => entry.previousKey === undefined ? value.key === entry.key : value.previousKey === entry.previousKey);
    const next = incoming.find(value => value.key === old?.key);
    if (!uncertain.has(entry.previousKey ?? entry.key) && old && entry.key === old.key && entry.value === old.value && entry.secret === old.secret) return next ? [{ ...next, rowId: entry.rowId }] : [];
    return [{ ...entry, previousKey: next?.key ?? entry.previousKey }];
  }), ...incoming.filter(entry => !uncertain.has(entry.key) && !sent.some(value => value.key === entry.key) && !current.some(value => value.key === entry.key))];
}
const stores = new Map<string, SiteSettingsState>();
const requests = new Map<AbortSignal, Set<Promise<unknown>>>();
function trackRequest<T>(scope: AbortSignal, request: Promise<T>): Promise<T> {
  let active = requests.get(scope); if (!active) { active = new Set(); requests.set(scope, active); }
  const tracked = request.finally(() => { active!.delete(tracked); if (!active!.size) requests.delete(scope); });
  active.add(tracked); return tracked;
}
/** Parent cleanup runs before child flush. Retain the existing identity listener through that work. */
export async function waitForSiteSettingsWrites(scope: AbortSignal) {
  await Promise.resolve();
  while (requests.get(scope)?.size) { await Promise.allSettled([...requests.get(scope)!]); await Promise.resolve(); }
}
export function siteSettingsState(access: SitesClientAccess, site: SiteRecord, snapshot: SiteEnvironmentSnapshot | null, scope: AbortSignal, onSite: (result: UpdatedSite) => void, onError?: (message: string) => void) {
  const key = JSON.stringify([access.identity.accountId, access.identity.userId, site.id]);
  let state = stores.get(key);
  if (!state || state.scope !== scope || state.scope.aborted) { state = new SiteSettingsState(access, site, snapshot, scope, onSite, state, onError); stores.set(key, state); }
  else { state.onSite = onSite; state.onError = onError; state.hydrate(site, snapshot); }
  return state;
}
export class SiteSettingsState {
  titleDraft: string | null = null;
  titleStatus: Status = "idle"; titleError: string | null = null; titleUnknown = false; titleComposing = false;
  environmentStatus: Status = "idle"; environmentError: string | null = null; environmentUnknown = false;
  entries: EnvironmentDraft[] | null; validation: string | null = null;
  private titleRequested = false; private environmentRequested = false; private titleTimer: ReturnType<typeof setTimeout> | undefined;
  private uncertain = new Set<string>(); private listeners = new Set<() => void>(); private titleFailed = false;
  private environmentDirty = false;
  private inputSite: SiteRecord;
  private inputEnvironment: SiteEnvironmentSnapshot | null;
  private rebindEnvironment: SiteEnvironmentSnapshot | null = null;
  constructor(readonly access: SitesClientAccess, public site: SiteRecord, public environment: SiteEnvironmentSnapshot | null, readonly scope: AbortSignal,
    public onSite: (result: UpdatedSite) => void, previous?: SiteSettingsState, public onError?: (message: string) => void) {
    this.inputSite = site; this.inputEnvironment = environment; this.entries = environment ? environmentDraft(environment) : null;
    if (previous) {
      this.titleDraft = previous.titleDraft; this.titleUnknown = previous.titleUnknown || previous.titleStatus === "saving";
      this.titleError = previous.titleError; this.titleFailed = previous.titleFailed;
      if (this.titleUnknown) { this.titleStatus = "error"; this.titleError = "无法确认网站名称，修改仍然保留。"; }
      if (previous.environmentDirty && previous.entries) { this.entries = previous.entries.map(entry => ({ ...entry })); this.environmentDirty = true; this.rebindEnvironment = previous.environment;
        this.uncertain = new Set(previous.uncertain); this.environmentUnknown = previous.environmentUnknown || previous.environmentStatus === "saving"; this.environmentError = previous.environmentError; }
    }
    if (this.rebindEnvironment && environment && this.entries) { this.entries = rebaseEnvironment(this.entries, environmentDraft(this.rebindEnvironment), environment, this.uncertain); this.rebindEnvironment = null; this.environmentUnknown = false; this.environmentError = null; }
    scope.addEventListener("abort", () => { clearTimeout(this.titleTimer); this.titleRequested = false; this.environmentRequested = false; }, { once: true });
  }
  hydrate(site: SiteRecord, snapshot: SiteEnvironmentSnapshot | null) {
    if (site !== this.inputSite) { this.inputSite = site; if (Date.parse(site.updatedAt) >= Date.parse(this.site.updatedAt)) this.site = site; }
    if (!snapshot || snapshot === this.inputEnvironment) return;
    this.inputEnvironment = snapshot;
    if (this.rebindEnvironment && this.entries) {
      this.entries = rebaseEnvironment(this.entries, environmentDraft(this.rebindEnvironment), snapshot, this.uncertain);
      this.rebindEnvironment = null; this.environment = snapshot; this.environmentUnknown = false; this.environmentError = null;
    } else if (!this.environmentDirty && this.environmentStatus !== "saving") { this.environment = snapshot; this.entries = environmentDraft(snapshot); }
    else if (!this.environment) this.environment = snapshot;
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { if (!this.scope.aborted) this.listeners.forEach(listener => listener()); }
  get title() { return this.titleDraft ?? this.site.title; }
  get pending() { return this.titleDraft !== null || this.environmentDirty; }
  changeTitle(value: string) { this.titleDraft = value; clearTimeout(this.titleTimer); this.emit(); if (!this.titleComposing) this.titleTimer = setTimeout(() => void this.commitTitle(), 900); }
  composeTitle(active: boolean) { this.titleComposing = active; clearTimeout(this.titleTimer); if (!active) this.titleTimer = setTimeout(() => void this.commitTitle(), 900); }
  async commitTitle() {
    clearTimeout(this.titleTimer);
    if (this.scope.aborted || this.titleComposing || this.titleUnknown) return;
    this.titleRequested = true; if (this.titleStatus === "saving") return;
    while (this.titleRequested && !this.scope.aborted) {
      this.titleRequested = false; const draft = this.titleDraft, title = draft?.trim();
      if (draft === null) return;
      if (!title) { this.titleError = "必须填写站点标题"; this.titleStatus = "error"; this.emit(); return; }
      if (title === this.site.title && !this.titleFailed) { this.titleDraft = null; this.titleStatus = "idle"; this.titleError = null; this.emit(); return; }
      this.titleStatus = "saving"; this.titleError = null; this.emit();
      try {
        const result = await trackRequest(this.scope, saveSiteTitle(this.access, this.site.id, title, this.scope)); if (this.scope.aborted) return;
        if (Date.parse(result.site.updatedAt) >= Date.parse(this.site.updatedAt)) { this.site = result.site; this.onSite(result); }
        if (this.titleDraft === draft) this.titleDraft = null;
        this.titleFailed = false; this.titleStatus = this.titleDraft === null ? "saved" : "idle";
      } catch (error) {
        if (this.scope.aborted) return;
        this.titleFailed = true; this.titleUnknown = (error as { code?: string })?.code === "site_title_unconfirmed";
        this.titleStatus = "error"; this.titleError = "网站名称未能保存。你的修改仍然保留，请选择“重试”再次保存。"; this.titleRequested = false;
        this.onError?.(this.titleError);
      }
      this.emit();
    }
  }
  async recoverTitle() {
    if (this.scope.aborted || this.titleStatus === "saving") return;
    this.titleStatus = "saving"; this.emit();
    try {
      const result = await trackRequest(this.scope, readSiteDetail(this.access, this.site.id, this.scope)); if (this.scope.aborted) return;
      if (Date.parse(result.site.updatedAt) >= Date.parse(this.site.updatedAt)) { this.site = result.site; this.onSite(result); }
      this.titleUnknown = false; this.titleFailed = false; this.titleError = "当前名称已重新读取，仍有未保存的修改。请选择重试保存。"; this.titleStatus = "error";
      if (this.titleDraft?.trim() === this.site.title) { this.titleDraft = null; this.titleStatus = "saved"; this.titleError = null; }
    } catch { if (!this.scope.aborted) { this.titleStatus = "error"; this.titleError = "无法确认网站名称，修改仍然保留。"; } }
    this.emit();
  }
  editEnvironment(entries: EnvironmentDraft[], showValidation = false) { this.entries = entries; this.environmentDirty = true; this.validation = showValidation ? environmentValidation(entries) : null; this.emit(); }
  async commitEnvironment() {
    if (this.scope.aborted || !this.environment || !this.entries || !this.environmentDirty || this.environmentError) return;
    this.validation = environmentValidation(this.entries); if (this.validation) { this.emit(); return; }
    this.environmentRequested = true; if (this.environmentStatus === "saving") return;
    while (this.environmentRequested && !this.scope.aborted && this.entries) {
      this.validation = environmentValidation(this.entries); if (this.validation) { this.environmentStatus = "idle"; this.environmentRequested = false; this.emit(); return; }
      this.environmentRequested = false; const sent = this.entries.map(entry => ({ ...entry })); const base: SiteEnvironmentSnapshot = this.environment;
      const patch = environmentPatch(base, sent);
      if (!patch.remove.length && !patch.set_values.length) { this.environmentDirty = false; this.environmentStatus = "idle"; this.emit(); return; }
      this.uncertain = new Set([...patch.remove, ...patch.set_values.map(entry => entry.key)]); this.environmentStatus = "saving"; this.emit();
      try {
        const result: SiteEnvironmentSnapshot = await trackRequest(this.scope, saveSiteEnvironment(this.access, this.site.id, patch, this.scope, base)); if (this.scope.aborted) return;
        this.entries = rebaseEnvironment(this.entries, sent, result); this.environment = result; this.uncertain.clear();
        const remaining = environmentPatch(result, this.entries); this.environmentDirty = Boolean(remaining.remove.length || remaining.set_values.length);
        this.environmentStatus = this.environmentDirty ? "idle" : "saved";
      } catch (error) {
        if (this.scope.aborted) return;
        this.environmentUnknown = (error as { code?: string })?.code === "site_environment_unconfirmed";
        const code = (error as { cause?: { code?: string } })?.cause?.code;
        this.environmentError = code === "environment_requires_secrets" ? "由于地域限制，此网站不支持环境变量。请为每个值启用“密钥”选项，然后重试。"
          : code === "invalid_secret_name" ? "密钥名称必须为 1–100 个字符，以 A–Z、a–z 或 _ 开头，且只能包含 A–Z、a–z、0–9 或 _。请选择有效的名称，并更新应用中的相关引用。"
          : code === "regional_environment_unavailable" ? "请使用 Sites 智能体添加、更新或移除此网站的密钥"
          : "环境变量未能保存。你的修改仍然保留，请选择“重试”再次保存。";
        this.environmentStatus = "error"; this.environmentRequested = false;
        this.onError?.(this.environmentError);
      }
      this.emit();
    }
  }
  async recoverEnvironment() {
    if (this.scope.aborted || this.environmentStatus === "saving" || !this.environment || !this.entries) return;
    this.environmentStatus = "saving"; this.emit();
    try {
      const fresh = await trackRequest(this.scope, readSiteEnvironmentSnapshot(this.access, this.site.id, this.scope)); if (this.scope.aborted) return;
      this.entries = rebaseEnvironment(this.entries, environmentDraft(this.environment), fresh, this.uncertain); this.environment = fresh;
      this.uncertain.clear(); this.environmentUnknown = false; this.environmentError = null; this.environmentStatus = "idle";
      this.emit(); await this.commitEnvironment();
    } catch { if (!this.scope.aborted) { this.environmentStatus = "error"; this.environmentError = "无法确认环境变量，修改仍然保留。"; this.emit(); } }
  }
  needsDeleteConfirmation(entry: EnvironmentDraft) { return entry.previousKey !== undefined || this.uncertain.has(entry.key); }
  flush() { if (!this.scope.aborted) { void this.commitTitle(); void this.commitEnvironment(); } }
}

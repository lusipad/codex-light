import { checkSiteSlug, changeSiteSlug, readSiteDetail, type SitesClientAccess } from "./sitesClient";
import { trackRequest } from "./siteSettingsState";
import type { SiteRecord } from "./sitesService";
import type { SiteAssetRef } from "./chatgptService";

type Result = { site: SiteRecord; assets: SiteAssetRef[] };
interface Pending { requestedSlug: string; expiresAt: number; observers: number; gc?: ReturnType<typeof setTimeout> }
const pendingChanges = new Map<string, Pending>();
const observers = new Map<string, Set<SiteSlugState>>();
export const normalizedSiteSlug = (raw: string) => raw.trim().toLowerCase();
export const validSiteSlug = (slug: string) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug);
export class SiteSlugState {
  open = false; raw: string; checking = false; available: { slug: string; value: boolean } | null = null;
  checkError = false; busy = false; unknown = false; error: string | null = null; pending: Pending | null;
  private key: string; private mounted = false; private visible = true; private sequence = 0;
  private checkingSource: AbortController | null = null; private pollSource: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined; private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>(); private writeSource = new AbortController();
  private abort: () => void;
  constructor(readonly access: SitesClientAccess, public site: SiteRecord, readonly scope: AbortSignal,
    public onSite: (value: Result) => void, public onError?: (message: string) => void) {
    this.raw = site.slug; this.key = JSON.stringify([access.identity.accountId, access.identity.userId, site.id]);
    this.pending = pendingChanges.get(this.key) ?? null;
    this.abort = () => { this.writeSource.abort(); this.cancelRead(); this.pausePolling(); };
  }
  attach() {
    if (this.mounted) return; this.mounted = true; this.pending = pendingChanges.get(this.key) ?? null;
    let mounted = observers.get(this.key); if (!mounted) { mounted = new Set(); observers.set(this.key, mounted); } mounted.add(this);
    if (this.pending) { this.pending.observers++; clearTimeout(this.pending.gc); }
    this.scope.addEventListener("abort", this.abort, { once: true }); if (this.scope.aborted) this.abort(); this.emit();
  }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { if (this.mounted && !this.scope.aborted) this.listeners.forEach(fn => fn()); }
  get normalized() { return normalizedSiteSlug(this.raw); }
  get canSubmit() { return this.open && !this.scope.aborted && !this.busy && !this.checking && !this.unknown && !this.pending && this.normalized !== this.site.slug && this.available?.slug === this.normalized && this.available.value; }
  hydrate(site: SiteRecord) {
    if (site !== this.site && Date.parse(site.updatedAt) >= Date.parse(this.site.updatedAt)) { this.site = site; this.emit(); }
    if (this.pending?.requestedSlug === this.site.slug) this.clearPending(this.pending);
  }
  show() { if (this.busy || this.scope.aborted) return; this.open = true; if (!this.unknown) this.change(this.site.slug); this.emit(); }
  close() { if (this.busy) return; this.open = false; this.cancelRead(); this.emit(); }
  private cancelRead() { clearTimeout(this.timer); this.checkingSource?.abort(); this.sequence++; this.checking = false; }
  change(raw: string) {
    if (this.busy || this.scope.aborted) return;
    this.cancelRead(); this.raw = raw; this.available = null; this.checkError = false; this.error = null;
    if (!this.unknown && !this.pending && validSiteSlug(this.normalized) && this.normalized !== this.site.slug) this.timer = setTimeout(() => void this.check(), 400);
    this.emit();
  }
  async check() {
    if (this.scope.aborted || !this.mounted || !this.open || this.busy || this.unknown || this.pending || !validSiteSlug(this.normalized) || this.normalized === this.site.slug) return;
    const slug = this.normalized, request = ++this.sequence, controller = new AbortController(); this.checkingSource?.abort(); this.checkingSource = controller;
    const abort = () => controller.abort(); this.scope.addEventListener("abort", abort, { once: true }); this.checking = true; this.checkError = false; this.emit();
    try {
      const result = await checkSiteSlug(this.access, this.site.id, this.raw, controller.signal);
      if (!controller.signal.aborted && this.mounted && request === this.sequence && this.normalized === slug && result.slug === slug) this.available = { slug, value: result.available };
    } catch { if (!controller.signal.aborted && this.mounted && request === this.sequence) this.checkError = true; }
    finally { this.scope.removeEventListener("abort", abort); if (!controller.signal.aborted && this.mounted && request === this.sequence) { this.checking = false; this.emit(); } }
  }
  async submit() {
    if (!this.canSubmit || this.scope.aborted) return;
    const requested = this.normalized; let acknowledged = false; this.busy = true; this.error = null; this.emit();
    try {
      const response = await trackRequest(this.scope, changeSiteSlug(this.access, this.site.id, this.raw, this.writeSource.signal));
      if (this.scope.aborted) return;
      acknowledged = true;
      if (response.status === "pending") {
        this.open = false; this.publishPending({ requestedSlug: response.requestedSlug, expiresAt: Date.now() + 600000, observers: 0 });
      } else {
        const previous = pendingChanges.get(this.key); if (previous) this.clearPending(previous);
        const result = await trackRequest(this.scope, readSiteDetail(this.access, this.site.id, this.writeSource.signal)); if (this.scope.aborted) return;
        if (result.site.slug === requested && this.accept(result)) this.open = false;
        else { this.unknown = true; this.error = "无法确认站点 URL 更改"; }
      }
    } catch (error) {
      if (this.scope.aborted) return;
      this.unknown = acknowledged || (error as { code?: string })?.code === "site_slug_unconfirmed";
      this.error = "无法更改站点 URL"; this.onError?.(this.error);
    } finally { if (!this.scope.aborted) { this.busy = false; this.emit(); } if (!this.mounted) this.scope.removeEventListener("abort", this.abort); }
  }
  async recover() {
    if (this.busy || this.scope.aborted || !this.unknown) return;
    const wanted = this.normalized; this.busy = true; this.emit();
    try {
      const result = await trackRequest(this.scope, readSiteDetail(this.access, this.site.id, this.writeSource.signal)); if (this.scope.aborted) return;
      if (result.site.slug === wanted && this.accept(result)) { this.unknown = false; this.error = null; this.open = false; }
      else {
        this.error = "无法确认站点 URL 更改";
        if (Date.parse(result.site.updatedAt) < Date.parse(this.site.updatedAt)) return;
        const availability = await trackRequest(this.scope, checkSiteSlug(this.access, this.site.id, this.raw, this.writeSource.signal));
        if (this.scope.aborted || this.normalized !== wanted || availability.slug !== wanted) return;
        this.available = { slug: wanted, value: availability.available };
        if (availability.available) this.unknown = false;
      }
    } catch { if (!this.scope.aborted) this.error = "无法确认站点 URL 更改"; }
    finally { if (!this.scope.aborted) { this.busy = false; this.emit(); } if (!this.mounted) this.scope.removeEventListener("abort", this.abort); }
  }
  private accept(result: Result) { if (Date.parse(result.site.updatedAt) < Date.parse(this.site.updatedAt)) return false; this.site = result.site; if (this.mounted) this.onSite(result); return true; }
  private clearPending(expected: Pending) {
    if (pendingChanges.get(this.key) !== expected) return;
    clearTimeout(expected.gc);
    pendingChanges.delete(this.key); expected.observers = 0;
    for (const observer of observers.get(this.key) ?? []) if (observer.pending === expected) { observer.pending = null; observer.pausePolling(); observer.emit(); }
    if (this.pending === expected) this.pending = null;
  }
  private publishPending(value: Pending) {
    const previous = pendingChanges.get(this.key); if (previous) { clearTimeout(previous.gc); previous.observers = 0; }
    pendingChanges.set(this.key, value); this.pending = value;
    for (const observer of observers.get(this.key) ?? []) {
      observer.pausePolling(); observer.pending = value; value.observers++; observer.emit(); if (observer.visible) void observer.poll();
    }
    if (!value.observers) this.scheduleCollection(value);
  }
  private scheduleCollection(expected: Pending) {
    clearTimeout(expected.gc);
    expected.gc = setTimeout(() => { if (expected.observers === 0 && pendingChanges.get(this.key) === expected) pendingChanges.delete(this.key); }, 660000);
  }
  async poll() {
    clearTimeout(this.pollTimer);
    const expected = this.pending; if (!expected || !this.mounted || !this.visible || this.scope.aborted || this.pollSource) return;
    const controller = new AbortController(); this.pollSource = controller;
    const abort = () => controller.abort(); this.scope.addEventListener("abort", abort, { once: true });
    try {
      const result = await trackRequest(this.scope, readSiteDetail(this.access, this.site.id, controller.signal));
      if (controller.signal.aborted || !this.mounted || this.scope.aborted || pendingChanges.get(this.key) !== expected) return;
      if (result.site.slug === expected.requestedSlug && this.accept(result)) this.clearPending(expected);
      else if (Date.now() >= expected.expiresAt) { this.clearPending(expected); this.onError?.("站点 URL 更改所需时间比预期更长"); }
      else if (this.visible) this.pollTimer = setTimeout(() => void this.poll(), 1000);
    } catch {
      if (!controller.signal.aborted && this.mounted && !this.scope.aborted && pendingChanges.get(this.key) === expected) { this.clearPending(expected); this.onError?.("无法确认站点 URL 更改"); }
    } finally { this.scope.removeEventListener("abort", abort); if (this.pollSource === controller) this.pollSource = null; this.emit(); }
  }
  pausePolling() { clearTimeout(this.pollTimer); this.pollSource?.abort(); this.pollSource = null; }
  setVisible(visible: boolean) { this.visible = visible; if (visible) void this.poll(); else this.pausePolling(); }
  dispose() { if (!this.mounted) return; this.mounted = false; const mounted = observers.get(this.key); mounted?.delete(this); if (!mounted?.size) observers.delete(this.key); this.cancelRead(); this.pausePolling(); this.listeners.clear(); if (this.pending) { this.pending.observers--; if (!this.pending.observers) this.scheduleCollection(this.pending); } if (!this.busy) this.scope.removeEventListener("abort", this.abort); }
}

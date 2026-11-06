import { readSiteDetail, readSiteDomains, refreshSiteDomain, removeSiteDomain, type SitesClientAccess } from "./sitesClient";
import { trackRequest } from "./siteSettingsState";
import type { SiteDomain, SiteRecord } from "./sitesService";
import type { SiteAssetRef } from "./chatgptService";

type Operation = { kind: "refresh" | "remove"; domain: SiteDomain; metadata: boolean };
export class SiteDomainState {
  domains: SiteDomain[]; selected: SiteDomain | null = null; busy = false; refreshing: string | null = null;
  unknown: Operation | null = null; error: string | null = null; metadataError = false;
  private mounted = false; private lifecycle = 0; private listeners = new Set<() => void>();
  private input: SiteDomain[]; private pendingInput: SiteDomain[] | null = null; private staleInputs = new WeakSet<SiteDomain[]>(); private source: AbortController | null = null;
  private abort = () => { this.source?.abort(); this.emit(); };
  constructor(readonly access: SitesClientAccess, readonly siteId: string, domains: SiteDomain[], readonly scope: AbortSignal,
    public onDomains: (domains: SiteDomain[]) => void, public onSite: (value: { site: SiteRecord; assets: SiteAssetRef[] }) => void,
    public onError?: (message: string) => void) { this.domains = domains; this.input = domains; }
  attach() { if (this.mounted) return; this.mounted = true; this.lifecycle++; this.scope.addEventListener("abort", this.abort); if (this.scope.aborted) this.abort(); }
  dispose() { this.mounted = false; this.lifecycle++; if (!this.busy) this.scope.removeEventListener("abort", this.abort); }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { if (this.mounted && !this.scope.aborted) this.listeners.forEach(fn => fn()); }
  hydrate(domains: SiteDomain[]) {
    if (this.staleInputs.has(domains)) return;
    if (this.busy || this.unknown) { this.pendingInput = domains; return; }
    if (domains === this.input) return; this.input = domains;
    this.domains = domains; this.emit();
  }
  private settleInput(adopt: boolean) {
    if (!this.pendingInput) return;
    this.input = this.pendingInput; this.pendingInput = null;
    if (!adopt) this.staleInputs.add(this.input);
    if (adopt) {
      this.domains = this.input;
      if (this.selected) this.selected = this.domains.find(domain => domain.id === this.selected!.id && domain.hostname === this.selected!.hostname) ?? null;
    }
  }
  select(domain: SiteDomain) { if (this.busy || this.unknown || this.scope.aborted) return; this.selected = this.domains.find(d => d.id === domain.id) ?? null; this.error = null; this.emit(); }
  close() { if (this.busy) return; this.selected = null; this.emit(); }
  refresh(domain: SiteDomain) { return this.run({ kind: "refresh", domain, metadata: false }); }
  remove() { return this.selected ? this.run({ kind: "remove", domain: this.selected, metadata: this.selected.status === "active" }) : Promise.resolve(); }
  private alive(lifecycle: number) { return this.mounted && this.lifecycle === lifecycle && !this.scope.aborted; }
  private async run(operation: Operation) {
    if (this.busy || this.unknown || !this.mounted || this.scope.aborted) return;
    const current = this.domains.find(d => d.id === operation.domain.id); if (!current || current.hostname !== operation.domain.hostname) return;
    operation.domain = current; operation.metadata = operation.kind === "remove" && current.status === "active";
    this.busy = true; this.refreshing = operation.kind === "refresh" ? current.id : null; this.error = null; this.metadataError = false; this.emit();
    const source = new AbortController(), lifecycle = this.lifecycle; this.source = source;
    const job = (async () => {
      let acknowledged = false, confirmed = false;
      try {
        const result = await (operation.kind === "refresh" ? refreshSiteDomain : removeSiteDomain)(this.access, this.siteId, current.id, source.signal);
        acknowledged = true; if (operation.kind === "refresh") operation.metadata = result.status === "active";
        if (!this.alive(lifecycle)) return;
        await this.confirm(operation, source.signal, lifecycle); confirmed = this.alive(lifecycle);
      } catch (error) {
        if (!this.alive(lifecycle)) return;
        if (acknowledged || (error as { code?: string })?.code === "site_domain_unconfirmed") this.unknown = operation;
        else this.settleInput(true);
        this.error = operation.kind === "remove" ? "无法移除域名" : "无法刷新域名状态";
        this.onError?.(this.error);
      } finally { if (confirmed) this.settleInput(false); this.busy = false; this.refreshing = null; if (this.source === source) this.source = null; if (!this.mounted) this.scope.removeEventListener("abort", this.abort); this.emit(); }
    })();
    await trackRequest(this.scope, job);
  }
  private async confirm(operation: Operation, signal: AbortSignal, lifecycle: number) {
    const domains = await readSiteDomains(this.access, this.siteId, signal); if (!this.alive(lifecycle)) return;
    const target = domains.find(d => d.id === operation.domain.id);
    this.staleInputs.add(this.input); this.settleInput(false); this.input = domains; this.domains = domains; this.onDomains(this.domains);
    this.unknown = null; this.error = null;
    if (operation.kind === "remove") {
      if (target) { this.error = "域名仍存在，请确认后再次移除。"; this.selected = this.domains.find(d => d.id === target.id) ?? target; }
      else this.selected = null;
    } else if (!target) this.error = "当前域名已不在站点列表中。";
    this.emit();
    if ((operation.metadata || (operation.kind === "refresh" && target?.status === "active")) && (operation.kind === "refresh" || !target)) await this.readMetadata(signal, lifecycle);
  }
  private async readMetadata(signal: AbortSignal, lifecycle: number) {
    try { const result = await readSiteDetail(this.access, this.siteId, signal); if (this.alive(lifecycle)) { this.metadataError = false; this.onSite(result); } }
    catch { if (this.alive(lifecycle)) { this.metadataError = true; this.onError?.("无法读取站点最新信息"); } }
  }
  async recover() {
    if (!this.unknown || this.busy || !this.mounted || this.scope.aborted) return;
    const operation = this.unknown, lifecycle = this.lifecycle, source = new AbortController(); this.source = source; this.busy = true; this.emit();
    await trackRequest(this.scope, (async () => {
      let confirmed = false;
      try { await this.confirm(operation, source.signal, lifecycle); confirmed = this.alive(lifecycle); }
      catch { if (this.alive(lifecycle)) { this.error = "无法读取当前域名，请重试。"; this.onError?.(this.error); } }
      finally { if (confirmed) this.settleInput(false); this.busy = false; if (this.source === source) this.source = null; if (!this.mounted) this.scope.removeEventListener("abort", this.abort); this.emit(); }
    })());
  }
  async retryMetadata() {
    if (this.busy || !this.metadataError || !this.mounted || this.scope.aborted) return;
    const lifecycle = this.lifecycle, source = new AbortController(); this.source = source; this.busy = true; this.emit();
    await trackRequest(this.scope, this.readMetadata(source.signal, lifecycle)); if (this.alive(lifecycle)) this.settleInput(true); this.busy = false; if (this.source === source) this.source = null;
    if (!this.mounted) this.scope.removeEventListener("abort", this.abort); this.emit();
  }
}

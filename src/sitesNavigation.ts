export interface SitesNavigation {
  canGoBack: boolean;
  canGoForward: boolean;
  back: () => void;
  forward: () => void;
}

export interface SitesLocation {
  view: "owned" | "shared" | "pinned" | "all";
  siteId: string | null;
  search: string;
}

export function parseSitesLocation(value: string | URL, collection = false): SitesLocation | null {
  const url = new URL(value, "http://localhost");
  const match = /^\/sites(?:\/([^/]+)\/settings)?\/?$/.exec(url.pathname);
  if (!match) return null;
  let siteId: string | null = null;
  if (match[1]) {
    try { siteId = decodeURIComponent(match[1]); } catch { return null; }
    if (!siteId || /[/\\\u0000-\u001f]/.test(siteId)) return null;
  }
  const view = url.searchParams.get("view");
  return {
    view: view === "shared" || view === "pinned" || (collection && view === "all") ? view : "owned",
    siteId,
    search: collection ? url.searchParams.get("search") ?? "" : "",
  };
}

export function sitesLocationUrl(current: string | URL, location: SitesLocation, collection = false): string {
  const url = new URL(current, "http://localhost");
  url.pathname = location.siteId ? `/sites/${encodeURIComponent(location.siteId)}/settings` : "/sites";
  if (location.view === "owned" || (!collection && location.view === "all")) url.searchParams.delete("view");
  else url.searchParams.set("view", location.view);
  if (collection) {
    if (location.search) url.searchParams.set("search", location.search);
    else url.searchParams.delete("search");
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export interface PluginDirectoryLocation {
  pluginId: string | null;
  pluginName: string | null;
  marketplacePath: string | null;
  remoteMarketplaceName: string | null;
  search: string;
  directoryTab: string | null;
  category: string | null;
  hostId: string | null;
  mode: string | null;
  breadcrumb: "settings" | null;
}

function directoryUrl(input: string | URL): URL | null {
  try {
    if (typeof input === "string" && !input.startsWith("/") && !/^[a-z][a-z\d+.-]*:\/\//i.test(input)) return null;
    if (typeof input === "string" && input.startsWith("//")) return null;
    if (typeof input === "string") {
      const pathname = input.replace(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i, "").split(/[?#]/, 1)[0];
      if (!/^\/plugins(?:\/[^/\\]+)?$/.test(pathname)) return null;
    }
    const url = new URL(String(input), "https://codex.invalid");
    if (!/^\/plugins(?:\/[^/]+)?$/.test(url.pathname)) return null;
    decodeURIComponent(url.pathname);
    decodeURIComponent(url.search.replaceAll("+", " "));
    return url;
  } catch {
    return null;
  }
}

export function parsePluginDirectoryLocation(input: string | URL): PluginDirectoryLocation | null {
  const url = directoryUrl(input);
  if (!url) return null;
  const pluginId = url.pathname === "/plugins" ? null : decodeURIComponent(url.pathname.slice("/plugins/".length));
  if (pluginId !== null && !pluginId.trim()) return null;
  const query = url.searchParams;
  return {
    pluginId,
    pluginName: query.get("pluginName"),
    marketplacePath: query.get("marketplacePath"),
    remoteMarketplaceName: query.get("remoteMarketplaceName"),
    search: query.get("search") ?? "",
    directoryTab: query.get("directoryTab"),
    category: query.get("category"),
    hostId: query.get("hostId"),
    mode: query.get("mode"),
    breadcrumb: query.get("breadcrumb") === "settings" ? "settings" : null,
  };
}

function browseQuery(base: string | URL): URLSearchParams {
  const url = directoryUrl(base);
  if (!url || !parsePluginDirectoryLocation(url)) throw new Error("Invalid plugin directory location");
  const query = new URLSearchParams();
  for (const key of ["directoryTab", "category", "search", "hostId"]) {
    const value = url.searchParams.get(key);
    if (value !== null) query.set(key, value);
  }
  return query;
}

function relativeUrl(pathname: string, query: URLSearchParams): string {
  const search = query.toString();
  return search ? `${pathname}?${search}` : pathname;
}

export function pluginDirectoryBrowseUrl(base: string | URL, patch: {
  search?: string;
  category?: string | null;
  directoryTab?: string | null;
  hostId?: string | null;
} = {}): string {
  const query = browseQuery(base);
  for (const key of ["search", "category", "directoryTab", "hostId"] as const) {
    if (patch[key] === undefined) continue;
    const value = patch[key];
    if (value === null || value === "") query.delete(key);
    else query.set(key, value);
  }
  return relativeUrl("/plugins", query);
}

export function pluginDirectoryDetailUrl(base: string | URL, params: {
  pluginId: string;
  pluginName?: string | null;
  marketplacePath?: string | null;
  remoteMarketplaceName?: string | null;
  hostId?: string | null;
  mode?: string | null;
  breadcrumb?: "settings" | null;
}): string {
  if (!params.pluginId.trim()) throw new Error("Plugin ID is required");
  const query = browseQuery(base);
  query.delete("hostId");
  for (const key of ["hostId", "marketplacePath", "remoteMarketplaceName", "pluginName", "mode"] as const) {
    const value = params[key];
    if (value != null) query.set(key, value);
  }
  const breadcrumb = params.breadcrumb === undefined ? parsePluginDirectoryLocation(base)?.breadcrumb : params.breadcrumb;
  if (breadcrumb === "settings") query.set("breadcrumb", breadcrumb);
  const id = encodeURIComponent(params.pluginId).replaceAll("%40", "@");
  return relativeUrl(`/plugins/${id}`, query);
}

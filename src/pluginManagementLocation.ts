const managementRoot = "/settings/plugins-settings";

export interface PluginManagementLocation {
  kind: "root" | "plugin" | "permissions" | "app";
  section: "detail" | "permissions" | "sync";
  pluginId: string | null;
  hostId: string | null;
  appId: string | null;
  skillName: string | null;
  pluginName: string | null;
  marketplacePath: string | null;
  remoteMarketplaceName: string | null;
  requestedTab: "mcps" | null;
}

function validSegment(value: string): boolean {
  return value.trim().length > 0 && value !== "." && value !== ".." && !/[\u0000-\u001f\u007f]/.test(value);
}

function managementUrl(input: string | URL): URL | null {
  try {
    const raw = String(input);
    if (!raw.startsWith("/") && !/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) return null;
    if (raw.startsWith("//")) return null;
    const pathname = raw.replace(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i, "").split(/[?#]/, 1)[0];
    if (pathname !== managementRoot && !pathname.startsWith(`${managementRoot}/`)) return null;
    if (pathname.includes("\\")) return null;
    // Check before URL normalization can erase literal or encoded dot segments.
    if (pathname.split("/").slice(1).some(segment => !validSegment(decodeURIComponent(segment)))) return null;
    const url = new URL(raw, "https://codex.invalid");
    decodeURIComponent(url.search.replaceAll("+", " "));
    return url;
  } catch {
    return null;
  }
}

/** Only the route tree present in the fixed official management chunk is accepted. */
export function parsePluginManagementLocation(input: string | URL): PluginManagementLocation | null {
  const url = managementUrl(input);
  if (!url) return null;
  const parts = url.pathname === managementRoot ? [] : url.pathname.slice(managementRoot.length + 1).split("/").map(decodeURIComponent);
  const query = url.searchParams;
  const location: PluginManagementLocation = {
    kind: "root", section: "detail", pluginId: null, appId: null, skillName: null,
    hostId: query.get("hostId"), pluginName: query.get("pluginName"), marketplacePath: query.get("marketplacePath"),
    remoteMarketplaceName: query.get("remoteMarketplaceName"), requestedTab: query.get("tab") === "mcps" ? "mcps" : null,
  };
  if (parts.length === 0) return location;
  if (parts.length === 4 && parts[0] === "hosts" && parts[2] === "plugins") {
    return { ...location, kind: "plugin", hostId: parts[1], pluginId: parts[3] };
  }
  if (parts.length === 1 && parts[0] === "permissions") return { ...location, kind: "permissions", section: "permissions" };
  if (parts.length === 2 && parts[0] === "apps") return { ...location, kind: "app", appId: parts[1] };
  if (parts.length === 1) return { ...location, kind: "plugin", pluginId: parts[0] };
  if (parts.length === 2 && (parts[1] === "permissions" || parts[1] === "sync")) {
    return { ...location, kind: "plugin", pluginId: parts[0], section: parts[1] };
  }
  if (parts.length === 3 && parts[1] === "skills") return { ...location, kind: "plugin", pluginId: parts[0], skillName: parts[2] };
  if ((parts.length === 3 || parts.length === 4) && parts[1] === "apps") {
    if (parts.length === 4 && parts[3] !== "permissions" && parts[3] !== "sync") return null;
    return { ...location, kind: "plugin", pluginId: parts[0], appId: parts[2], section: parts.length === 4 ? parts[3] as "permissions" | "sync" : "detail" };
  }
  return null;
}

function checkedBase(base: string | URL): PluginManagementLocation {
  const location = parsePluginManagementLocation(base);
  if (!location) throw new Error("Invalid plugin management location");
  return location;
}

function encodedSegment(value: string): string {
  if (!validSegment(value)) throw new Error("Invalid plugin management path segment");
  return encodeURIComponent(value);
}

export function pluginManagementRootUrl(base: string | URL, params: { hostId?: string | null } = {}): string {
  const location = checkedBase(base);
  const hostId = params.hostId === undefined ? location.hostId : params.hostId;
  return hostId == null ? managementRoot : `${managementRoot}?${new URLSearchParams({ hostId }).toString()}`;
}

/** CV1W.i4: app routes use real IDs and do not inherit a host/market query. */
export function pluginManagementAppUrl(base: string | URL, params: { pluginId?: string | null; appId: string }): string {
  checkedBase(base);
  return `${managementRoot}/${params.pluginId == null ? "" : `${encodedSegment(params.pluginId)}/`}apps/${encodedSegment(params.appId)}`;
}

/** Account selection replaces only linkId; it never creates a host-app route. */
export function pluginManagementAppSelectionUrl(base: string | URL, linkId: string | null): string {
  const location = checkedBase(base);
  if (location.kind !== "plugin" || location.appId === null || location.section !== "detail" || location.hostId !== null) throw new Error("Invalid plugin app selection location");
  const url = managementUrl(base)!;
  if (linkId === null) url.searchParams.delete("linkId");
  else { encodedSegment(linkId); url.searchParams.set("linkId", linkId); }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function pluginManagementPermissionSelectionUrl(base: string | URL, linkId: string | null): string {
  const location = checkedBase(base);
  if (location.kind !== "plugin" || location.section !== "permissions" || location.hostId !== null) throw new Error("Invalid plugin permission selection location");
  const url = managementUrl(base)!;
  if (linkId === null) url.searchParams.delete("linkId");
  else { encodedSegment(linkId); url.searchParams.set("linkId", linkId); }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** jEyg.$W: remote service IDs are direct only on local/durable; SSH retains CLI identity. */
export function pluginManagementDetailUrl(base: string | URL, params: {
  pluginId: string;
  hostId: string;
  sourceType: string;
  remotePluginId?: string | null;
  pluginName?: string | null;
  marketplacePath?: string | null;
  remoteMarketplaceName?: string | null;
}): string {
  checkedBase(base);
  const pluginId = encodedSegment(params.pluginId);
  const hostId = encodedSegment(params.hostId);
  if (params.sourceType === "remote" && (params.hostId === "local" || params.hostId === "durable") && params.remotePluginId != null) {
    return `${managementRoot}/${encodedSegment(params.remotePluginId)}`;
  }
  if (params.marketplacePath != null && params.remoteMarketplaceName != null) throw new Error("Invalid plugin marketplace source");
  const query = new URLSearchParams();
  for (const key of ["marketplacePath", "remoteMarketplaceName", "pluginName", "hostId"] as const) {
    const value = params[key];
    if (value != null) query.set(key, value);
  }
  return `${managementRoot}/hosts/${hostId}/plugins/${pluginId}?${query.toString()}`;
}

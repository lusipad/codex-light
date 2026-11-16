import type { ExperimentalFeature } from "./config";
import type { PluginDetail, PluginInstalledResponse, PluginListResponse, PluginRef, PluginSummary } from "./plugins";

export interface PluginDirectoryListing {
  id: string;
  displayName: string;
  description: string | null;
  iconUrl: string | null;
  iconUrlDark: string | null;
  keywords: string[];
  requiresLocalExecutor: boolean | undefined;
  isTemplate: boolean;
  installationPolicy: string | undefined;
  status: string | null;
  disabledReason: string | null;
}

export interface PluginDirectorySection {
  id: string | null;
  title: string | null;
  slug: string | null;
  plugins: PluginDirectoryListing[];
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const nullableString = (value: unknown): value is string | null | undefined => value == null || typeof value === "string";

/** Missing host features and an unresolved Statsig fallback are unknown, not disabled. */
export function remotePluginDirectoryEnabled(features: ExperimentalFeature[] | null, fallback?: boolean): boolean | undefined {
  if (features === null) return undefined;
  const feature = features.find(item => item.name === "remote_plugin");
  return feature ? feature.enabled : fallback;
}

/** The home endpoint returns flat listings, unlike the full installed-plugin inventory. */
export function parsePluginDirectorySections(value: unknown): PluginDirectorySection[] {
  if (!Array.isArray(value)) throw Error("无法识别插件目录栏目，请重新读取。");
  const sections = new Map<string, PluginDirectorySection>();
  for (const entry of value) {
    const section = object(entry);
    if (!section || ![section.id, section.title, section.url_slug].every(nullableString) ||
        !Array.isArray(section.plugins)) throw Error("无法识别插件目录栏目，请重新读取。");
    const id = typeof section.id === "string" && section.id.trim() ? section.id : null;
    const slug = typeof section.url_slug === "string" && section.url_slug.trim() ? section.url_slug : null;
    if (!id && !slug) throw Error("插件目录栏目缺少身份，请重新读取。");
    const plugins = section.plugins.map(value => {
      const row = object(value);
      if (!row || typeof row.id !== "string" || !row.id.trim() ||
          typeof row.display_name !== "string" || !row.display_name.trim() ||
          ![row.short_description, row.icon_url, row.icon_url_dark, row.installation_policy, row.status, row.disabled_reason].every(nullableString) ||
          (row.keywords != null && (!Array.isArray(row.keywords) || row.keywords.some(item => typeof item !== "string"))) ||
          (row.requires_local_executor != null && typeof row.requires_local_executor !== "boolean") ||
          (row.is_template != null && typeof row.is_template !== "boolean")) throw Error("无法识别插件目录条目，请重新读取。");
      return {
        id: row.id, displayName: row.display_name,
        description: row.short_description as string | null | undefined ?? null,
        iconUrl: row.icon_url as string | null | undefined ?? null,
        iconUrlDark: row.icon_url_dark as string | null | undefined ?? null,
        keywords: row.keywords as string[] | null | undefined ?? [],
        requiresLocalExecutor: row.requires_local_executor as boolean | null | undefined ?? undefined,
        isTemplate: row.is_template === true,
        installationPolicy: row.installation_policy as string | null | undefined ?? undefined,
        status: row.status as string | null | undefined ?? null,
        disabledReason: row.disabled_reason as string | null | undefined ?? null,
      };
    });
    const key = id ? `id:${id}` : `slug:${slug}`;
    const previous = sections.get(key);
    if (previous) previous.plugins.push(...plugins);
    else sections.set(key, { id, slug, title: section.title as string | null | undefined ?? null, plugins });
  }
  return [...sections.values()];
}

export function directoryPluginInstallation(
  id: string, installed: PluginInstalledResponse | null, local: PluginListResponse | null = null,
): { installed: boolean | undefined; plugin: PluginSummary | null } {
  const matches = (plugin: PluginSummary) => plugin.id === id || plugin.remotePluginId === id ||
    object(plugin.shareContext)?.remotePluginId === id;
  const known = installed?.marketplaces.flatMap(market => market.plugins).find(matches) ??
    local?.marketplaces.flatMap(market => market.plugins).find(matches);
  return { installed: known ? known.installed : installed === null ? undefined : false, plugin: known ?? null };
}

// Lexical aliases only: short names, symlinks and parent traversal require filesystem evidence.
export function marketplacePathIdentity(path: string): string {
  const slashes = path.replace(/\\/g, "/");
  const normalized = slashes.replace(/^\/\/\?\/UNC\//i, "//").replace(/^\/\/\?\/(?=[a-z]:\/)/i, "");
  return /^[a-z]:\//i.test(normalized) || /^\/\/[^/]+\/[^/]+/.test(normalized) ? normalized.toLowerCase() : path;
}

/** A matching plugin ID alone does not establish the requested marketplace/name provenance. */
export function pluginDetailMatchesReference(detail: PluginDetail, reference: PluginRef): boolean {
  const hasPath = reference.marketplacePath != null, hasRemote = reference.remoteMarketplaceName != null;
  if (hasPath === hasRemote || !reference.pluginName.trim()) return false;
  if (hasPath) {
    return !!reference.marketplacePath?.trim() && !!detail.marketplacePath?.trim() &&
      marketplacePathIdentity(detail.marketplacePath) === marketplacePathIdentity(reference.marketplacePath) &&
      detail.summary.name === reference.pluginName;
  }
  return !!reference.remoteMarketplaceName?.trim() && detail.marketplaceName === reference.remoteMarketplaceName &&
    (detail.summary.name === reference.pluginName || !!directoryPluginInstallation(reference.pluginName, {
      marketplaces: [{ name: detail.marketplaceName, plugins: [detail.summary] }],
    }).plugin);
}

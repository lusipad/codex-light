import type { PluginMarketplaceEntry, PluginSummary } from "./plugins";

export interface PluginDirectoryLocalItem {
  plugin: PluginSummary;
  marketplace: PluginMarketplaceEntry;
}

export interface PluginDirectoryLocalGroups {
  created: PluginDirectoryLocalItem[];
  marketplaces: { id: string; title: string; items: PluginDirectoryLocalItem[] }[];
}

// Mirrors the directory's string comparison, not filesystem canonicalization.
function displayPath(path: string): string {
  return path.replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\(?=[a-z]:[\\/])/i, "")
    .replace(/\\/g, "/");
}

const directoryPath = (path: string): string => displayPath(path).toLowerCase();
const marketplaceIdentity = (marketplace: PluginMarketplaceEntry): string =>
  marketplace.path ?? `remote:${marketplace.name}`;
const officialLabels = new Set([
  "codex-official", "openai-bundled", "openai-curated", "openai-curated-remote", "openai-primary-runtime",
]);
const labelPriority = (label: string): number => {
  switch (label.trim().toLowerCase().replace(/[_-]+/g, " ")) {
    case "built by openai": return 0;
    case "chatgpt official": return 1;
    default: return 2;
  }
};

function uniqueSuffixes(sources: string[]): string[] {
  const parts = sources.map(source => displayPath(source).replace(/\/+$/, "").split("/").filter(Boolean));
  const maxDepth = Math.max(1, ...parts.map(path => path.length));
  for (let depth = 1; depth <= maxDepth; depth++) {
    const suffixes = parts.map(path => {
      const suffix = path.slice(-depth).join("/");
      return suffix.length === 0 ? "" : depth === 1 || path.length <= depth ? suffix : `.../${suffix}`;
    });
    if (new Set(suffixes).size === suffixes.length) return suffixes;
  }
  return sources.map(displayPath);
}

function marketplaceLabel(marketplace: PluginMarketplaceEntry): string {
  const label = marketplace.interface?.displayName?.trim() || marketplace.name;
  const normalized = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return officialLabels.has(normalized) ? "Built by OpenAI" : label;
}

function marketplaceLabelSource(marketplace: PluginMarketplaceEntry): string {
  if (marketplace.path == null) return marketplace.name;
  const path = displayPath(marketplace.path).replace(/\/+$/, "");
  for (const suffix of ["/.agents/plugins/marketplace.json", "/marketplace.json"]) {
    if (path.endsWith(suffix)) return path.slice(0, -suffix.length);
  }
  return path;
}

export function groupPluginDirectoryLocal(
  marketplaces: PluginMarketplaceEntry[], homeDirectory: string,
): PluginDirectoryLocalGroups {
  const expectedPath = `${directoryPath(homeDirectory).replace(/\/+$/, "")}/.agents/plugins/marketplace.json`;
  const homeMarketplace = marketplaces.find(marketplace =>
    marketplace.path != null && directoryPath(marketplace.path) === expectedPath);
  const homeIdentity = homeMarketplace ? marketplaceIdentity(homeMarketplace) : null;
  const created: PluginDirectoryLocalItem[] = [];
  const groups = new Map<string, PluginDirectoryLocalGroups["marketplaces"][number]>();
  for (const marketplace of marketplaces) {
    const identity = marketplaceIdentity(marketplace);
    const items = marketplace.plugins.map(plugin => ({ plugin, marketplace }));
    if (identity === homeIdentity) {
      created.push(...items);
      continue;
    }
    const title = marketplaceLabel(marketplace);
    if (title.trim().length === 0) continue;
    const existing = groups.get(identity);
    if (existing) existing.items.push(...items);
    else if (items.length > 0) groups.set(identity, {
      id: `plugins-marketplace-${encodeURIComponent(identity)}`,
      title,
      items,
    });
  }
  const visibleGroups = [...groups.values()].filter(group => group.title.trim().length > 0);
  const duplicates = new Map<string, typeof visibleGroups>();
  for (const group of visibleGroups) {
    const sameLabel = duplicates.get(group.title) ?? [];
    sameLabel.push(group);
    duplicates.set(group.title, sameLabel);
  }
  const suffixes = new Map<string, string>();
  for (const sameLabel of duplicates.values()) {
    if (sameLabel.length < 2) continue;
    const labels = uniqueSuffixes(sameLabel.map(group => marketplaceLabelSource(group.items[0].marketplace)));
    sameLabel.forEach((group, index) => suffixes.set(group.id, labels[index]));
  }
  visibleGroups.sort((left, right) => labelPriority(left.title) - labelPriority(right.title) ||
    left.title.localeCompare(right.title) || (suffixes.get(left.id) ?? "").localeCompare(suffixes.get(right.id) ?? ""));
  return { created, marketplaces: visibleGroups.map(group => ({ ...group,
    title: suffixes.has(group.id) ? `${group.title} · ${suffixes.get(group.id)}` : group.title,
  })) };
}

import type { PluginDirectoryListing } from "./pluginDirectory";

export type PluginDirectoryEntrySource = "workspace" | "user" | "workspace-created" | "workspace-shared";

/** Directory metadata never establishes installation or permission to manage a plugin. */
export interface PluginDirectoryEntry {
  listing: PluginDirectoryListing;
  rawId: string;
  name: string;
  scope: string | null;
  isTemplate: boolean;
  templatePluginId: string | null;
  teams: { id: string; name: string }[];
  source: PluginDirectoryEntrySource;
  sources: PluginDirectoryEntrySource[];
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const optionalString = (value: unknown): value is string | null | undefined => value == null || typeof value === "string";
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const fail = (): never => { throw Error("无法识别插件来源目录，请重新读取。"); };

/** Workspace and personal listings have a full release, unlike flat Public home rows. */
export function parsePluginDirectoryEntries(value: unknown, source: PluginDirectoryEntrySource): PluginDirectoryEntry[] {
  if (!Array.isArray(value)) return fail();
  return value.map(value => {
    const raw = object(value), release = object(raw?.release), ui = object(release?.interface);
    if (!raw || !release || !ui || !nonempty(raw.id) || !nonempty(raw.name) || !nonempty(release.display_name) ||
        ![raw.scope, raw.template_plugin_id, raw.installation_policy, raw.status, raw.disabled_reason,
          release.description, ui.short_description, ui.logo_url, ui.logo_url_dark].every(optionalString) ||
        (raw.is_template != null && typeof raw.is_template !== "boolean") ||
        (release.requires_local_executor != null && typeof release.requires_local_executor !== "boolean") ||
        (ui.capabilities != null && (!Array.isArray(ui.capabilities) || ui.capabilities.some(item => typeof item !== "string"))) ||
        (raw.teams != null && !Array.isArray(raw.teams))) return fail();
    const teams = (raw.teams as unknown[] | null | undefined ?? []).map(value => {
      const team = object(value);
      if (!team || !nonempty(team.id) || !nonempty(team.name)) return fail();
      return { id: team.id, name: team.name };
    });
    const isTemplate = raw.is_template === true;
    return {
      rawId: raw.id, name: raw.name, scope: raw.scope as string | null | undefined ?? null,
      isTemplate, templatePluginId: raw.template_plugin_id as string | null | undefined ?? null,
      teams, source, sources: [source],
      listing: {
        id: raw.id, displayName: release.display_name,
        description: ui.short_description as string | null | undefined ?? release.description as string | null | undefined ?? null,
        iconUrl: ui.logo_url as string | null | undefined ?? null,
        iconUrlDark: ui.logo_url_dark as string | null | undefined ?? null,
        keywords: [...ui.capabilities as string[] | null | undefined ?? []],
        requiresLocalExecutor: release.requires_local_executor as boolean | null | undefined ?? undefined,
        isTemplate, installationPolicy: raw.installation_policy as string | null | undefined ?? undefined,
        status: raw.status as string | null | undefined ?? null,
        disabledReason: raw.disabled_reason as string | null | undefined ?? null,
      },
    };
  });
}

export function parsePluginDirectoryEntriesPage(value: unknown, source: PluginDirectoryEntrySource): {
  entries: PluginDirectoryEntry[]; nextPageToken: string | null;
} {
  const page = object(value), pagination = object(page?.pagination);
  if (!page || !pagination || !optionalString(pagination.next_page_token)) return fail();
  return {
    entries: parsePluginDirectoryEntries(page.plugins, source),
    nextPageToken: pagination.next_page_token as string | null | undefined ?? null,
  };
}

/** Merge all successful pages before template filtering, so later instances hide earlier templates. */
export function mergePluginDirectoryEntries(
  pages: readonly (readonly PluginDirectoryEntry[])[],
  options: { hideReferencedTemplates?: boolean } = {},
): PluginDirectoryEntry[] {
  const referencedTemplates = new Set(pages.flatMap(page => page.flatMap(entry => entry.templatePluginId === null ? [] : [entry.templatePluginId])));
  const merged = new Map<string, PluginDirectoryEntry>();
  for (const page of pages) for (const entry of page) {
    if (options.hideReferencedTemplates && entry.isTemplate && referencedTemplates.has(entry.rawId)) continue;
    const previous = merged.get(entry.rawId);
    if (previous) previous.sources = [...new Set([...previous.sources, ...entry.sources])];
    else merged.set(entry.rawId, { ...entry, sources: [...entry.sources] });
  }
  return [...merged.values()];
}

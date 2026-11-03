import type { HookGroup, HookInfo, HooksListResult, HookWarningItem } from "./hooksClient";

export type HookSourceId = "plugin" | "user" | "admin" | "project" | "sessionFlags" | "unknown";
export interface HookSourceEntry {
  key: string; source: HookSourceId; cwd: string; pluginId?: string | null;
  hooks: HookInfo[]; warnings: string[]; errors: HookWarningItem[];
  installed: number; active: number; needsReview: number;
}
export interface HookSourceSection { id: HookSourceId; entry: HookSourceEntry | null; entries: HookSourceEntry[] }

const sourceOrder: HookSourceId[] = ["plugin", "user", "admin", "project", "sessionFlags", "unknown"];
export function mergeHookRoots(hostRoots: string[], selectedProjectRoots: string[]): string[] {
  const selected = [...new Set(selectedProjectRoots)];
  return [...selected, ...[...new Set(hostRoots)].filter(root => !selected.includes(root)).sort((a, b) => a.localeCompare(b))];
}
function sourceId(source: HookInfo["source"]): HookSourceId | null {
  switch (source) {
    case "plugin": case "user": case "project": case "sessionFlags": case "unknown": return source;
    case "system": case "mdm": case "cloudRequirements": case "cloudManagedConfig":
    case "legacyManagedConfigFile": case "legacyManagedConfigMdm": return "admin";
    default: return null;
  }
}
export const isHookActive = (hook: HookInfo) => hook.trustStatus === "managed" || hook.enabled && hook.trustStatus === "trusted";
export const hookNeedsReview = (hook: HookInfo) => hook.trustStatus === "untrusted" || hook.trustStatus === "modified";
const counts = (hooks: HookInfo[]) => ({ installed: hooks.length, active: hooks.filter(isHookActive).length, needsReview: hooks.filter(hookNeedsReview).length });

function entry(source: HookSourceId, groups: HookGroup[], input: HookInfo[], cwd = "", pluginId?: string | null): HookSourceEntry {
  const unique = new Map<string, HookInfo>();
  for (const hook of input) if (!unique.has(hook.id)) unique.set(hook.id, hook);
  const hooks = [...unique.values()], keys = new Set(unique.keys());
  const relevant = groups.filter(group => group.hooks.some(hook => keys.has(hook.id)) ||
    source === "unknown" && group.hooks.length === 0 && (group.warnings.length > 0 || group.errors.length > 0));
  const errors = new Map<string, HookWarningItem>();
  for (const error of relevant.flatMap(group => group.errors)) errors.set(`${error.path}:${error.message}`, error);
  return { key: JSON.stringify([source, cwd, pluginId]), source, cwd, pluginId, hooks,
    warnings: [...new Set(relevant.flatMap(group => group.warnings))], errors: [...errors.values()], ...counts(hooks) };
}

export function buildHookSourceSections(data: HooksListResult): HookSourceSection[] {
  const groups = data.groups, all = groups.flatMap(group => group.hooks);
  return sourceOrder.flatMap<HookSourceSection>(source => {
    const hooks = all.filter(hook => sourceId(hook.source) === source);
    if (source === "project") {
      const entries = groups.filter(group => group.hooks.some(hook => sourceId(hook.source) === source))
        .map(group => entry(source, [group], group.hooks.filter(hook => sourceId(hook.source) === source), group.cwd));
      return entries.length ? [{ id: source, entry: null, entries }] : [];
    }
    const diagnostics = source === "unknown" && groups.some(group => !group.hooks.length && (group.warnings.length || group.errors.length));
    if (!hooks.length && !diagnostics) return [];
    const combined = entry(source, groups, hooks);
    const entries = source === "plugin" ? [...new Set(hooks.map(hook => hook.pluginId ?? null))]
      .sort((a, b) => a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b))
      .map(id => entry(source, groups, hooks.filter(hook => (hook.pluginId ?? null) === id), "", id)) : [];
    return [{ id: source, entry: combined, entries }];
  });
}

export function groupHookEvents(source: HookSourceEntry) {
  return [...new Set(source.hooks.map(hook => hook.event))].map(event => {
    const hooks = source.hooks.filter(hook => hook.event === event)
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    return { event, hooks, ...counts(hooks) };
  });
}

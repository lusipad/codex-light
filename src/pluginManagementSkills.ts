import type { SkillMetadata } from "./plugins";
import { matchRecommendedSkill, recommendedSkillDisplayName, type RecommendedSkill } from "./recommendedSkills";

function isPluginSkillPath(path: string): boolean {
  const parts = path.trim().replace(/^\.\/+/, "").replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    const directory = parts[index].toLowerCase();
    if ((directory !== ".codex" && directory !== ".agents") || parts[index + 1]?.toLowerCase() !== "skills") continue;
    const scope = parts[index + 2]?.toLowerCase();
    const firstSkill = index + (scope === "_import" || scope === ".system" ? 3 : 2);
    const skill = parts.at(-1)?.toLowerCase() === "skill.md" && parts.length - 2 >= firstSkill ? parts.length - 2 : firstSkill;
    if (parts[skill]) return false;
  }
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index].toLowerCase() !== "plugins") continue;
    const cached = parts[index + 1]?.toLowerCase() === "cache";
    const plugin = index + (cached ? 3 : 1);
    if (!parts[plugin]) continue;
    const root = plugin + Number(cached);
    const skills = parts.findIndex((part, position) => position > root && part.toLowerCase() === "skills");
    if (skills >= 0 ? Boolean(parts[skills + 1]) : parts.length === root + 2 && parts.at(-1)?.toLowerCase() === "skill.md") return true;
  }
  return false;
}

export function filterManagedSkills(skills: SkillMetadata[], recommended: RecommendedSkill[] | null): SkillMetadata[] {
  if (recommended === null) return [];
  const byName = new Map<string, SkillMetadata>();
  for (const skill of skills) {
    if (skill.scope !== "user" || isPluginSkillPath(skill.path)) continue;
    const previous = byName.get(skill.name);
    if (!previous || skill.path.localeCompare(previous.path) < 0) byName.set(skill.name, skill);
  }
  return [...byName.values()].filter(skill => !recommended.some(item => matchRecommendedSkill(item, [{
    key: skill.path, name: skill.name, path: skill.path, scope: skill.scope, displayName: skill.interface?.displayName ?? undefined,
  }]))).sort((left, right) => (left.interface?.displayName?.trim() || recommendedSkillDisplayName(left.name))
    .localeCompare(right.interface?.displayName?.trim() || recommendedSkillDisplayName(right.name)) || left.name.localeCompare(right.name));
}

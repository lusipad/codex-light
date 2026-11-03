import { tauriInvoke } from "./bridge";
import { flattenSkills, listSkills } from "./plugins";
import type { SkillInfoItem } from "./types";

export interface RecommendedSkill {
  id: string;
  name: string;
  description: string;
  repoPath: string;
}

export interface RecommendedSkillsResponse {
  skills: RecommendedSkill[];
  repoRoot: string;
  source: string;
  fetchedAt: number | null;
  error: string | null;
}

export interface RecommendedSkillInstallResult {
  destination: string;
  skill: SkillInfoItem;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, allowEmpty = false): value is string {
  return typeof value === "string" && (allowEmpty || value.trim().length > 0);
}

function skillItem(value: unknown): value is RecommendedSkill {
  return record(value) && text(value.id) && /^[a-zA-Z0-9_.-]+$/.test(value.id) && value.id !== "." && value.id !== ".."
    && text(value.name) && text(value.description, true) && text(value.repoPath)
    && /^skills\/(?:\.curated|\.experimental)\/[a-zA-Z0-9_.-]+$/.test(value.repoPath)
    && value.repoPath.split("/").at(-1) === value.id;
}

// Compare complete paths, preserving POSIX case while normalizing Windows case.
function normalizedPath(value: string): string {
  let path = value.replace(/\\/g, "/");
  if (path.startsWith("//?/UNC/")) path = `//${path.slice(8)}`;
  else if (path.startsWith("//?/")) path = path.slice(4);
  const windows = /^[a-z]:\//i.test(path) || path.startsWith("//");
  const prefix = path.startsWith("//") ? "//" : path.startsWith("/") ? "/" : "";
  const parts: string[] = [];
  for (const part of path.slice(prefix.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  path = prefix + parts.join("/");
  return windows ? path.toLowerCase() : path;
}

function absolutePath(value: unknown): value is string {
  return text(value) && !value.includes("\0")
    && (/^[a-z]:[\\/]/i.test(value) || value.startsWith("/") || /^\\\\/.test(value));
}

export async function readRecommendedSkills(refresh: boolean): Promise<RecommendedSkillsResponse> {
  const value = await tauriInvoke<unknown>("recommended_skills_list", { refresh });
  if (!record(value) || !Array.isArray(value.skills) || !value.skills.every(skillItem)
    || !absolutePath(value.repoRoot) || !text(value.source)
    || !(value.fetchedAt === null || (typeof value.fetchedAt === "number" && Number.isFinite(value.fetchedAt) && value.fetchedAt >= 0))
    || !(value.error === null || text(value.error))) {
    throw new Error("推荐技能目录响应格式无效，无法确认推荐列表");
  }
  if (new Set(value.skills.map(skill => skill.id)).size !== value.skills.length) {
    throw new Error("推荐技能目录包含重复身份");
  }
  return value as unknown as RecommendedSkillsResponse;
}

export async function installRecommendedSkill(
  item: RecommendedSkill,
  installRoot: string | null,
): Promise<RecommendedSkillInstallResult> {
  if (!skillItem(item) || (installRoot !== null && !absolutePath(installRoot))) {
    throw new Error("推荐技能或安装目录无效");
  }
  const value = await tauriInvoke<unknown>("recommended_skill_install", {
    skillId: item.id, repoPath: item.repoPath, installRoot,
  });
  if (!record(value) || !absolutePath(value.destination) || !record(value.skill)) {
    throw new Error("技能安装响应格式无效，安装结果尚未确认");
  }
  const skill = value.skill;
  const destination = normalizedPath(value.destination);
  const validSkill = skill.id === item.id && text(skill.name) && text(skill.description, true)
    && absolutePath(skill.path) && absolutePath(skill.dirPath) && text(skill.content, true)
    && skill.installed === true;
  if (!validSkill || normalizedPath(skill.path as string) !== normalizedPath(`${value.destination}/SKILL.md`)
    || normalizedPath(skill.dirPath as string) !== destination
    || destination.split("/").at(-1) !== (/^[a-z]:|^\/\//i.test(destination) ? item.id.toLowerCase() : item.id)
    || (installRoot !== null && destination !== normalizedPath(`${installRoot}/.codex/skills/${item.id}`))) {
    throw new Error("技能安装返回的目标身份不一致，安装结果尚未确认");
  }
  return value as unknown as RecommendedSkillInstallResult;
}

export async function verifyRecommendedSkillDiscovery(
  destination: string,
  workspaceRoot: string | null,
): Promise<{ found: boolean; errors: string[] }> {
  if (!absolutePath(destination) || (workspaceRoot !== null && !absolutePath(workspaceRoot))) {
    return { found: false, errors: ["技能发现检查的目录无效"] };
  }
  try {
    const response = await listSkills(workspaceRoot ? [workspaceRoot] : undefined, true);
    if (!record(response) || !Array.isArray(response.data)
      || !response.data.every(entry => record(entry) && Array.isArray(entry.skills) && Array.isArray(entry.errors))) {
      throw new Error("技能列表响应格式无效");
    }
    const { skills, errors } = flattenSkills(response);
    const target = normalizedPath(`${destination}/SKILL.md`);
    const found = skills.some(skill => absolutePath(skill.path) && normalizedPath(skill.path) === target);
    const messages = errors.map(error => text(error?.message) ? error.message : "技能读取返回未知错误");
    if (!found) messages.push("技能文件已安装，但 app-server 尚未发现该路径；安装文件状态未被撤销");
    return { found, errors: messages };
  } catch (error) {
    return { found: false, errors: [`技能发现读取失败，无法确认发现状态（不代表文件未安装）：${String(error)}`] };
  }
}

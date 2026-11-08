/**
 * 「项目」实体协议封装 —— `project/*`。
 *
 * 对应的 app-server（codex 0.159.0）协议形状（见 `.ref/audit/schema/v2/Project*`）：
 * - `project/list`   { cursor?, limit?, sortKey?: "position" | "recencyAt", sortDirection?: "asc" | "desc" }
 *                    → { data: Project[], nextCursor: string | null }
 * - `project/read`   { projectId } → { project }
 * - `project/create` { idempotencyKey, name, roots: [{ path }], metadata? } → { project }
 * - `project/update` { projectId, name?, roots?, metadata? } → { project }
 * - `project/delete` { projectId } → {}
 * - `project/move`   { projectId, beforeProjectId: string | null } → {}
 *
 * 所有函数在协议不可用时都会抛错，由调用方回退到本地 workspace 视图。
 */

import { callAppServer } from "./bridge";

export type ProjectSortKey = "position" | "recencyAt";
export type SortDirection = "asc" | "desc";

export interface ProjectRoot {
  path: string;
}

export interface Project {
  id: string;
  name: string;
  roots: ProjectRoot[];
  metadata: Record<string, string>;
  position: number;
  createdAt: number;
  updatedAt: number;
  recencyAt?: number | null;
}

export interface ProjectPatch {
  name?: string;
  roots?: ProjectRoot[];
  metadata?: Record<string, string> | null;
}

/** `project/create` / `project/update` 的 roots 入参：允许直接传路径字符串。 */
export type ProjectRootInput = string | ProjectRoot;

export interface ListProjectsOptions {
  limit?: number;
  sortKey?: ProjectSortKey;
  sortDirection?: SortDirection;
}

/** 生成 `project/create` 所需的幂等键。 */
export function createIdempotencyKey(): string {
  try {
    const cryptoObj = globalThis.crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
      return cryptoObj.randomUUID();
    }
  } catch {
    // 忽略：回退到时间戳 + 随机数
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function normalizeRoot(raw: any): ProjectRoot | null {
  if (typeof raw === "string") {
    const path = raw.trim();
    return path ? { path } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const path = raw.path ?? raw.root ?? raw.cwd;
  if (typeof path !== "string" || !path.trim()) return null;
  return { path: path.trim() };
}

function normalizeRoots(raw: any): ProjectRoot[] {
  if (!Array.isArray(raw)) return [];
  const roots = raw
    .map(normalizeRoot)
    .filter((root): root is ProjectRoot => root !== null);
  // 去重（不区分大小写、统一斜杠方向），保持顺序
  const seen = new Set<string>();
  const out: ProjectRoot[] = [];
  for (const root of roots) {
    const key = root.path.replace(/\\/g, "/").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(root);
  }
  return out;
}

function toNumber(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeProject(raw: any): Project | null {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.id ?? raw.projectId ?? raw.project_id;
  const name = raw.name ?? raw.title;
  if (typeof id !== "string" || !id.trim()) return null;
  if (typeof name !== "string" || !name.trim()) return null;

  const metadata =
    raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
      ? Object.fromEntries(
          Object.entries(raw.metadata as Record<string, unknown>).map(([key, value]) => [
            key,
            value == null ? "" : String(value),
          ])
        )
      : {};

  const createdAt = toNumber(raw.createdAt ?? raw.created_at, 0);
  return {
    id,
    name: name.trim(),
    roots: normalizeRoots(raw.roots ?? raw.workspaceRoots),
    metadata,
    position: toNumber(raw.position, 0),
    createdAt,
    updatedAt: toNumber(raw.updatedAt ?? raw.updated_at, createdAt),
    recencyAt:
      raw.recencyAt == null ? null : toNumber(raw.recencyAt, 0),
  };
}

function extractProjectList(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.projects)) return res.projects;
  if (res?.data && typeof res.data === "object") {
    if (Array.isArray(res.data.projects)) return res.data.projects;
    if (Array.isArray(res.data.data)) return res.data.data;
  }
  if (Array.isArray(res?.result)) return res.result;
  return [];
}

function extractProject(res: any): Project | null {
  const candidates = [
    res?.project,
    res?.data?.project,
    res?.data,
    res?.result?.project,
    res?.result,
    res,
  ];
  for (const candidate of candidates) {
    const project = normalizeProject(candidate);
    if (project) return project;
  }
  return null;
}

function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.name.localeCompare(b.name);
  });
}

/**
 * 拉取全部项目（自动跟随 nextCursor，最多 10 页），按 position 升序返回。
 * 失败抛错，调用方应回退到本地 workspace 视图。
 */
export async function listProjects(
  options: ListProjectsOptions = {}
): Promise<Project[]> {
  const limit = options.limit && options.limit > 0 ? options.limit : 100;
  const baseParams: Record<string, unknown> = {
    limit,
    sortKey: options.sortKey ?? "position",
    sortDirection: options.sortDirection ?? "asc",
  };

  const collected: Project[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 10; page += 1) {
    const res: any = await callAppServer<any>(
      "project/list",
      cursor ? { ...baseParams, cursor } : baseParams
    );
    collected.push(
      ...extractProjectList(res)
        .map(normalizeProject)
        .filter((project): project is Project => project !== null)
    );

    const nextCursor: string | null =
      typeof res?.nextCursor === "string" && res.nextCursor.length > 0
        ? res.nextCursor
        : null;
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  // 去重后按 position 排序（服务端已排序时保持稳定）
  const seen = new Set<string>();
  return sortProjects(
    collected.filter((project) => {
      if (seen.has(project.id)) return false;
      seen.add(project.id);
      return true;
    })
  );
}

/** 读取单个项目。失败抛错。 */
export async function readProject(projectId: string): Promise<Project> {
  if (!projectId) throw new Error("projectId 不能为空");
  const res = await callAppServer<any>("project/read", { projectId });
  const project = extractProject(res);
  if (!project) throw new Error("project/read 未返回可识别的项目数据");
  return project;
}

/**
 * 新建项目。首个 root 为主目录。
 * 失败抛错；`idempotencyKey` 可显式传入以支持重试去重。
 */
export async function createProject(
  name: string,
  roots: ProjectRootInput[],
  idempotencyKey?: string
): Promise<Project> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("项目名称不能为空");
  const normalizedRoots = normalizeRoots(roots);
  if (normalizedRoots.length === 0) throw new Error("至少需要一个项目根目录");

  const res = await callAppServer<any>("project/create", {
    idempotencyKey: idempotencyKey || createIdempotencyKey(),
    name: trimmedName,
    roots: normalizedRoots,
  });
  return (
    extractProject(res) ?? {
      id: "",
      name: trimmedName,
      roots: normalizedRoots,
      metadata: {},
      position: 0,
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
      recencyAt: null,
    }
  );
}

/** 更新项目（重命名 / 替换根目录 / 更新 metadata）。失败抛错。 */
export async function updateProject(
  projectId: string,
  patch: ProjectPatch
): Promise<Project> {
  if (!projectId) throw new Error("projectId 不能为空");
  const params: Record<string, unknown> = { projectId };
  if (patch.name !== undefined) {
    const trimmedName = patch.name.trim();
    if (!trimmedName) throw new Error("项目名称不能为空");
    params.name = trimmedName;
  }
  if (patch.roots !== undefined) {
    const normalizedRoots = normalizeRoots(patch.roots);
    if (patch.roots.length > 0 && normalizedRoots.length === 0) throw new Error("项目根目录无效");
    params.roots = normalizedRoots;
  }
  if (patch.metadata !== undefined) {
    params.metadata = patch.metadata;
  }

  const res = await callAppServer<any>("project/update", params);
  const project = extractProject(res);
  if (project) return project;
  // update 成功即已生效；返回形状异常时重新读取权威数据。
  return readProject(projectId);
}

/** 删除项目。失败抛错。 */
export async function deleteProject(projectId: string): Promise<void> {
  if (!projectId) throw new Error("projectId 不能为空");
  await callAppServer<any>("project/delete", { projectId });
}

/**
 * 调整项目顺序：把 projectId 移动到 beforeProjectId 之前。
 * beforeProjectId 为 null 表示移动到列表末尾。失败抛错。
 */
export async function moveProject(
  projectId: string,
  beforeProjectId: string | null
): Promise<void> {
  if (!projectId) throw new Error("projectId 不能为空");
  if (beforeProjectId === projectId) return;
  await callAppServer<any>("project/move", {
    projectId,
    beforeProjectId: beforeProjectId ?? null,
  });
}

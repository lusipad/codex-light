import type { SidebarLocalProject, SidebarProjectMembership, ThreadProjectAssignment, ThreadSummary, WorkspaceRootItem } from "./types";

export interface SidebarProjectGroup {
  id: string;
  key: string;
  path: string;
  label: string;
  rootPaths: string[];
  scopeRoots: string[];
  serverProjectId?: string | null;
  entity?: SidebarLocalProject;
}

const norm = (path?: string | null) => (path || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

export function buildSidebarProjectGroups(workspaces: WorkspaceRootItem[], metadata: SidebarProjectMembership): SidebarProjectGroup[] {
  const entities: SidebarProjectGroup[] = (metadata.localProjects || []).map(project => ({
    id: project.id, key: `entity:${project.id}`, path: project.rootPaths[0] || "", label: project.name,
    rootPaths: [...project.rootPaths], scopeRoots: [], serverProjectId: project.serverProjectId, entity: project,
  }));
  const owner = new Map<string, SidebarProjectGroup>();
  for (const group of entities) {
    for (const path of group.rootPaths) {
      const key = norm(path); if (!key) continue;
      const previous = owner.get(key);
      let prefer = !previous;
      if (previous) {
        const single = group.rootPaths.length === 1, previousSingle = previous.rootPaths.length === 1;
        const primary = norm(group.rootPaths[0]) === key, previousPrimary = norm(previous.rootPaths[0]) === key;
        prefer = single !== previousSingle ? single : primary !== previousPrimary ? primary :
          group.entity!.createdAt !== previous.entity!.createdAt ? group.entity!.createdAt < previous.entity!.createdAt :
          group.id.localeCompare(previous.id) > 0;
      }
      if (prefer) owner.set(key, group);
    }
  }
  for (const group of entities) group.scopeRoots = group.rootPaths.filter(path => owner.get(norm(path)) === group);
  const covered = new Set(entities.flatMap(group => group.rootPaths.map(norm)));
  const legacy = workspaces.filter(workspace => !covered.has(norm(workspace.path))).map(workspace => ({
    id: workspace.id, key: norm(workspace.path), path: workspace.path, label: workspace.label,
    rootPaths: [workspace.path], scopeRoots: [workspace.path], serverProjectId: workspace.serverProjectId,
  }));
  return [...entities, ...legacy];
}

export function sidebarThreadProjects(thread: Pick<ThreadSummary, "id" | "cwd" | "projectId">, groups: SidebarProjectGroup[], metadata: SidebarProjectMembership, hints: Record<string, string>): SidebarProjectGroup[] {
  let assignment: ThreadProjectAssignment | null = metadata.threadProjectAssignments[thread.id] ?? null;
  let projectless = metadata.projectlessThreadIds.includes(thread.id);
  if (Object.prototype.hasOwnProperty.call(metadata.workspaceProjectAssignments, thread.id)) {
    assignment = metadata.workspaceProjectAssignments[thread.id];
    projectless = assignment == null;
  }
  if (assignment) return assignment.projectKind === "local"
    ? groups.filter(group => group.id === assignment.projectId || group.serverProjectId === assignment.projectId)
    : [];
  if (projectless) return [];
  if (thread.projectId != null) return groups.filter(group => group.serverProjectId === thread.projectId || group.entity?.id === thread.projectId);
  const cwd = norm(thread.cwd), hint = norm(hints[thread.id]);
  const entities = groups.filter(group => group.entity && group.scopeRoots.some(path => {
    const root = norm(path);
    return root && (cwd === root || cwd.startsWith(root + "/") || hint === root);
  }));
  if (entities.length) return entities;
  const legacyPath = cwd || hint;
  const legacy = legacyPath ? groups.find(group => !group.entity && group.scopeRoots.some(path => {
    const root = norm(path); return root && (legacyPath === root || legacyPath.startsWith(root + "/"));
  })) : undefined;
  return legacy ? [legacy] : [];
}

export function resolveNewThreadProject(
  pending: SidebarLocalProject | null,
  metadata: SidebarProjectMembership,
  workspacePath?: string,
): SidebarLocalProject | null {
  if (pending) return pending;
  const selected = metadata.localProjects?.find(project => project.id === metadata.selectedProjectId);
  return selected && norm(workspacePath) === norm(selected.rootPaths[0]) ? selected : null;
}

export function threadStartProjectParams(project?: SidebarLocalProject | null, cwd?: string) {
  if (!project) return {};
  if (!project.serverProjectId || project.rootPaths.length === 0) throw new Error("暂时无法在此项目中新建聊天，请重试。");
  return { projectId: project.serverProjectId, runtimeWorkspaceRoots: [cwd || project.rootPaths[0], ...project.rootPaths.slice(1)] };
}

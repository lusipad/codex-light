import { readChatgptService, type ServiceIdentity } from "./chatgptService";
import type { WorkProjectUnavailableReason } from "./workRunLocation";

export interface WorkSelectedProject { type: string; projectId: string }
export interface WorkProject {
  gizmo: { id: string; display: { name: string }; sharing?: { subjects: unknown[] } | null;
    share_recipient?: unknown; memory_scope?: unknown; gizmo_snorlax_type?: unknown; first_party_project_type?: unknown; [key: string]: unknown };
  files: unknown[]; hasSharingSubjects?: unknown; isCachedSidebarProject?: unknown; [key: string]: unknown;
}
export type WorkProjectAtom = { status: "missing" } | { status: "invalid" | "value"; value: unknown };
export type WorkProvisionPermission = "allowed" | "loading" | "unavailable" | "disabled_by_admin";
export interface WorkProjectAccessInput {
  identity: ServiceIdentity; gate288: boolean | null; routeProjectId: string | null | undefined;
  selectedChatGptProjectId: string | null | undefined; selectedWorkProject: WorkSelectedProject | null | undefined;
  localProjects: WorkProjectAtom | undefined; pendingBackingCount: number | null; activeLockedProjectId: string | null | undefined;
  cachedSelectedProject: WorkProject | null | undefined; provisioningHostAvailable: boolean;
  provisionPermission: WorkProvisionPermission | null;
}
export interface WorkProjectAccessResult {
  project: { cloudUnavailableReason: WorkProjectUnavailableReason | null; locked: boolean } | null;
  missingInputs: string[]; backingProjectId: string | null; queryProjectId: string | null; queryError: string | null;
}
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const projectId = (value: string) => value.startsWith("g-p-");
export function parseWorkSelectedProject(value: unknown): WorkSelectedProject | null {
  if (value === null || value === undefined) return null;
  const item = record(value);
  if (!item || typeof item.type !== "string" || typeof item.projectId !== "string" || !item.projectId) throw Error("选中项目状态格式无效");
  return { type: item.type, projectId: item.projectId };
}
export function parseWorkProject(value: unknown): WorkProject {
  const item = record(value), gizmo = record(item?.gizmo), display = record(gizmo?.display), sharing = gizmo?.sharing;
  if (!item || !gizmo || typeof gizmo.id !== "string" || !display || typeof display.name !== "string" || !Array.isArray(item.files)
    || sharing != null && !Array.isArray(record(sharing)?.subjects)) throw Error("ChatGPT 项目响应格式无效");
  return value as WorkProject;
}
export function isCompatibleWorkProject(value: WorkProject | null | undefined): boolean {
  return value != null && projectId(value.gizmo.id) && value.gizmo.first_party_project_type == null && value.gizmo.gizmo_snorlax_type == null
    && value.gizmo.share_recipient === "private" && value.hasSharingSubjects !== true && (value.gizmo.sharing?.subjects.length ?? 0) === 0;
}
function memoryScope(value: WorkProject | null | undefined): "project-only" | "open-default" | undefined {
  return value && "memory_scope" in value.gizmo ? value.gizmo.memory_scope === "project_v2" ? "project-only" : "open-default" : undefined;
}
export function workProjectUnavailableReason(value: WorkProject | null | undefined): WorkProjectUnavailableReason {
  if (!value) return "project-incompatible";
  const gizmo = value.gizmo, shared = value.hasSharingSubjects === true || (gizmo.sharing?.subjects.length ?? 0) > 0 || gizmo.share_recipient != null && gizmo.share_recipient !== "private";
  if ((gizmo.share_recipient != null || value.hasSharingSubjects === true) && projectId(gizmo.id) && shared) return "shared-project";
  if (gizmo.gizmo_snorlax_type != null || gizmo.first_party_project_type != null) return "unsupported-project-type";
  return value.isCachedSidebarProject !== true && memoryScope(value) === "project-only" ? "project-only-memory" : "project-incompatible";
}
export function projectProvisionPermission(input: {
  isCurrentAccountLoading: boolean; isWorkspaceAccount: boolean | undefined; isWorkspaceSettingsError: boolean;
  isWorkspaceSettingsLoading: boolean; shouldCheckWorkspaceSettings: boolean; workspacePermissions: readonly string[] | null | undefined;
}): WorkProvisionPermission {
  return input.isCurrentAccountLoading ? "loading" : input.isWorkspaceAccount !== false || input.shouldCheckWorkspaceSettings
    ? input.isWorkspaceSettingsLoading ? "loading" : input.isWorkspaceSettingsError || input.workspacePermissions === undefined ? "unavailable"
      : input.workspacePermissions === null || input.workspacePermissions.includes("chatgpt.workspace.project.crud") ? "allowed" : "disabled_by_admin" : "allowed";
}
function localRecords(atom: WorkProjectAtom | undefined): Record<string, Record<string, unknown>> | null {
  if (atom?.status === "missing" || atom?.status === "value" && atom.value === null) return {};
  if (atom?.status !== "value") return null;
  const records = record(atom.value); if (!records) return null;
  for (const item of Object.values(records)) {
    const project = record(item); if (!project || typeof project.id !== "string") return null;
    for (const key of ["chatGptBacking", "chatGptBackingCreation"]) {
      if (project[key] == null) continue;
      const backing = record(project[key]);
      if (!backing || typeof backing.accountId !== "string" || typeof backing.userId !== "string" || key === "chatGptBacking" && typeof backing.projectId !== "string") return null;
    }
  }
  return records as Record<string, Record<string, unknown>>;
}
export function uniqueWorkBacking(localProjectId: string, records: Record<string, Record<string, unknown>>, owner: Pick<ServiceIdentity, "accountId" | "userId">): string | null {
  const bindings = Object.values(records).flatMap(project => {
    const backing = record(project.chatGptBacking);
    return !projectId(String(project.id)) && backing?.accountId === owner.accountId && backing?.userId === owner.userId ? [{ id: project.id, projectId: String(backing.projectId) }] : [];
  });
  return bindings.find(binding => binding.id === localProjectId && bindings.filter(other => other.projectId === binding.projectId).length === 1)?.projectId ?? null;
}
export async function readWorkProjectAccess(input: WorkProjectAccessInput, signal: AbortSignal): Promise<WorkProjectAccessResult> {
  signal.throwIfAborted();
  const result: WorkProjectAccessResult = { project: null, missingInputs: [], backingProjectId: null, queryProjectId: null, queryError: null };
  const missing = (...names: string[]) => { result.missingInputs.push(...names); return result; };
  const selected = input.selectedWorkProject, route = input.routeProjectId, chatProject = input.selectedChatGptProjectId;
  if (selected === undefined || route === undefined || chatProject === undefined) return missing("project-selection");
  // Actual absent selection is sufficient; unrelated backing/cache/gate inputs are not required.
  if (selected === null && route === null && chatProject === null) { result.project = { cloudUnavailableReason: null, locked: false }; return result; }
  if (input.gate288 === null) return missing("gate288");
  const owner = input.gate288 ? input.identity : null;
  let records: Record<string, Record<string, unknown>> | null = null;
  if (owner && selected?.type === "local" && !projectId(selected.projectId)) {
    records = localRecords(input.localProjects); if (!records) return missing("local-projects");
    result.backingProjectId = uniqueWorkBacking(selected.projectId, records, owner);
  }
  const backing = result.backingProjectId !== null && (chatProject === null || result.backingProjectId === chatProject) ? result.backingProjectId : null;
  const effectiveProject = input.gate288 ? route ?? backing : backing;
  const queryProject = route ?? backing; result.queryProjectId = queryProject;
  let current: WorkProject | undefined;
  if (queryProject !== null) {
    try { current = parseWorkProject(await readChatgptService("work_project", { projectId: queryProject }, input.identity, signal)); }
    catch (error) { signal.throwIfAborted(); result.queryError = String(error); }
  }
  signal.throwIfAborted();
  const locked = current?.gizmo.gizmo_snorlax_type === "locked_chats";
  if (locked && input.activeLockedProjectId === undefined) return missing("locked-project-access");
  const lockedAllowed = locked && input.activeLockedProjectId === current?.gizmo.id;
  if (locked && !lockedAllowed) { result.project = { cloudUnavailableReason: workProjectUnavailableReason(current), locked: true }; return result; }
  const pending = owner && selected?.type === "local" ? input.pendingBackingCount : 0;
  if (pending !== null && (!Number.isInteger(pending) || pending < 0)) return missing("pending-backing");
  if (pending !== null && pending > 0) { result.project = { cloudUnavailableReason: null, locked }; return result; }
  let cached: WorkProject | undefined;
  if (backing === null && chatProject !== null && current === undefined) {
    if (input.cachedSelectedProject === undefined) return missing("selected-project-cache");
    cached = input.cachedSelectedProject?.gizmo.id === chatProject && isCompatibleWorkProject(input.cachedSelectedProject) ? input.cachedSelectedProject : undefined;
  }
  let provisionable: boolean | null = false;
  if (selected?.type === "local" && !projectId(selected.projectId) && owner && input.provisioningHostAvailable) {
    records ??= localRecords(input.localProjects); if (!records) return missing("local-projects");
    const local = records[selected.projectId], creation = record(local?.chatGptBackingCreation);
    if (local && local.chatGptBacking == null && local.retiredChatGptBacking == null && !local.chatGptBackingRecoveryPending
      && (creation === null || creation.accountId === owner.accountId && creation.userId === owner.userId)) {
      provisionable = input.provisionPermission === null ? null : input.provisionPermission === "allowed";
    }
  }
  const projectCondition = selected === null || projectId(selected.projectId) || backing !== null ? true : provisionable;
  const scopeCondition = chatProject === null && effectiveProject === null || lockedAllowed || memoryScope(current ?? cached) === "open-default";
  const fetchedCondition = effectiveProject === null || result.queryError === null && current?.gizmo.id === effectiveProject && (lockedAllowed || isCompatibleWorkProject(current));
  const base = !scopeCondition || !fetchedCondition ? false : projectCondition;
  const allowed = pending !== null && pending > 0 || base === true;
  if (!allowed && pending === null) return missing("pending-backing");
  if (!allowed && base === null) return missing("provision-permission");
  result.project = { cloudUnavailableReason: allowed ? null : workProjectUnavailableReason(current ?? cached), locked };
  return result;
}

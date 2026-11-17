export type WorkAgentMode = "read-only" | "auto" | "granular" | "guardian-approvals" | "full-access" | "custom";
export interface WorkPermissionRequirements {
  autoReview?: { requiredOnModels?: readonly string[] | null } | null;
  allowedPermissionProfiles?: Record<string, boolean> | null;
  allowedSandboxModes?: readonly string[] | null;
  allowedApprovalPolicies?: readonly unknown[] | null;
  allowedApprovalsReviewers?: readonly string[] | null;
}
export interface WorkModelPermissionInput {
  isConfigDataPending: boolean;
  requirements: WorkPermissionRequirements | null | undefined;
  resolvedConfig: Record<string, unknown> | null | undefined;
  current: { model: string | null; reasoningEffort: string | null; agentMode: WorkAgentMode | null; permissionProfileId: string | null | undefined };
  candidate: { model: string; reasoningEffort: string | null };
  /** jMec.B.guardian_approval, not the config's separately evaluated feature. */
  statsigGuardianEnabled: boolean | null;
  hasAuthoritativeGuardianApprovalDefault: boolean | null;
}
export interface WorkModelPermissionDecision {
  status: "allowed" | "needs-guardian" | "needs-full-access" | "not-ready";
  reason?: "required-model" | "cyber-daybreak" | "ultra-full-access";
  missingInputs: string[];
  guardianAvailable: boolean | null;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const autoReviewer = (value: unknown) => value === "auto_review" || value === "guardian_subagent";
const granular = { granular: { sandbox_approval: false, rules: false, skill_approval: false, request_permissions: true, mcp_elicitations: true } };
const builtin: { mode: WorkAgentMode; profile: string; sandbox: string; approval: unknown; reviewer: string }[] = [
  { mode: "read-only", profile: ":read-only", sandbox: "read-only", approval: "on-request", reviewer: "user" },
  { mode: "auto", profile: ":workspace", sandbox: "workspace-write", approval: "on-request", reviewer: "user" },
  { mode: "granular", profile: ":workspace", sandbox: "workspace-write", approval: granular, reviewer: "user" },
  { mode: "guardian-approvals", profile: ":workspace", sandbox: "workspace-write", approval: "on-request", reviewer: "guardian_subagent" },
  { mode: "full-access", profile: ":danger-full-access", sandbox: "danger-full-access", approval: "never", reviewer: "user" },
];
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => equal(value, b[index]));
  if (!object(a) || !object(b)) return false;
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}
function requiredModels(requirements: WorkPermissionRequirements | null | undefined): readonly string[] {
  if (requirements === undefined || requirements !== null && !object(requirements)) throw Error("requirements");
  const review = requirements?.autoReview;
  if (review == null) return [];
  if (!object(review) || review.requiredOnModels != null && (!Array.isArray(review.requiredOnModels) || review.requiredOnModels.some(value => typeof value !== "string"))) throw Error("requirements-auto-review");
  return review.requiredOnModels ?? [];
}
/** Fixed Z3c strips exactly one syntactically valid provider prefix. */
export function isWorkModelAutoReviewRequired(requirements: WorkPermissionRequirements | null | undefined, model: string | null): boolean {
  const required = requiredModels(requirements); if (model === null) return false;
  const slash = model.indexOf("/");
  if (slash === -1) return required.includes(model);
  const provider = model.slice(0, slash), remainder = model.slice(slash + 1);
  return /^[A-Za-z0-9_-]+$/.test(provider) && !remainder.includes("/") && required.includes(remainder);
}
function guardianConfig(config: Record<string, unknown> | null): boolean | undefined {
  const flat = config?.["features.guardian_approval"]; if (typeof flat === "boolean") return flat;
  const features = config?.features; if (!object(features)) return;
  const nested = Object.getOwnPropertyDescriptor(features, "guardian_approval")?.value;
  return typeof nested === "boolean" ? nested : undefined;
}
function policyShape(value: unknown): boolean {
  if (typeof value === "string") return true;
  if (!object(value) || Object.keys(value).length !== 1 || !object(value.granular)) return false;
  const fields = value.granular;
  return ["sandbox_approval", "rules", "mcp_elicitations"].every(key => typeof fields[key] === "boolean")
    && Object.entries(fields).every(([key, item]) => ["sandbox_approval", "rules", "mcp_elicitations", "skill_approval", "request_permissions"].includes(key) && typeof item === "boolean");
}
function requirementsValid(requirements: WorkPermissionRequirements | null): boolean {
  if (requirements === null) return true;
  for (const key of ["allowedSandboxModes", "allowedApprovalsReviewers"] as const) {
    const value = requirements[key]; if (value != null && (!Array.isArray(value) || value.some(item => typeof item !== "string"))) return false;
  }
  const profiles = requirements.allowedPermissionProfiles, approvals = requirements.allowedApprovalPolicies;
  return (profiles == null || object(profiles) && Object.values(profiles).every(value => typeof value === "boolean"))
    && (approvals == null || Array.isArray(approvals) && approvals.every(policyShape));
}
function permitted(requirements: WorkPermissionRequirements | null, sandbox: string, approval: unknown, reviewer: string): boolean {
  if (requirements === null) return true;
  if (requirements.allowedSandboxModes != null && !requirements.allowedSandboxModes.includes(sandbox)) return false;
  if (requirements.allowedApprovalPolicies != null && !requirements.allowedApprovalPolicies.some(value => equal(value, approval))) return false;
  const reviewers = requirements.allowedApprovalsReviewers;
  return reviewers == null || reviewers.includes(reviewer) || autoReviewer(reviewer) && reviewers.some(autoReviewer);
}
function permittedModes(requirements: WorkPermissionRequirements | null, config: Record<string, unknown> | null): WorkAgentMode[] {
  if (!requirementsValid(requirements)) throw Error("requirements-permissions");
  const result = builtin.filter(mode => (requirements?.allowedPermissionProfiles == null || requirements.allowedPermissionProfiles[mode.profile] === true)
    && permitted(requirements, mode.sandbox, mode.approval, mode.reviewer)).map(mode => mode.mode);
  if (requirements?.allowedPermissionProfiles != null || !config?.approval_policy && !config?.sandbox_mode) return result;
  const sandbox = config.sandbox_mode ?? "read-only";
  if (sandbox !== "read-only" && sandbox !== "workspace-write" && sandbox !== "danger-full-access") throw Error("config-permissions");
  const approval = config.approval_policy ?? (sandbox === "danger-full-access" ? "never" : "on-request");
  if (!policyShape(approval)) throw Error("config-permissions");
  const raw = config.approvals_reviewer;
  const reviewer = raw !== "user" && raw !== "auto_review" && raw !== "guardian_subagent" || raw === "guardian_subagent" && guardianConfig(config) === false ? "user" : raw;
  if (permitted(requirements, sandbox, approval, reviewer)) result.push("custom");
  return result;
}
export function projectWorkGuardianAvailability(input: WorkModelPermissionInput): { guardianAvailable: boolean | null; availableAgentModes: WorkAgentMode[] | null; missingInputs: string[] } {
  const missing = (...missingInputs: string[]) => ({ guardianAvailable: null, availableAgentModes: null, missingInputs });
  if (input.isConfigDataPending !== false) return missing("config-pending");
  if (input.resolvedConfig === undefined || input.resolvedConfig !== null && !object(input.resolvedConfig)) return missing("resolved-config");
  try {
    const requiredCurrent = isWorkModelAutoReviewRequired(input.requirements, input.current.model);
    const modes = permittedModes(input.requirements!, input.resolvedConfig);
    if (!modes.includes("guardian-approvals")) return { guardianAvailable: false, availableAgentModes: modes, missingInputs: [] };
    if (modes.length === 1) return { guardianAvailable: true, availableAgentModes: modes, missingInputs: [] };
    const without = modes.filter(mode => mode !== "guardian-approvals");
    if (guardianConfig(input.resolvedConfig) === false) return { guardianAvailable: false, availableAgentModes: without, missingInputs: [] };
    if (requiredCurrent || input.statsigGuardianEnabled === true || input.hasAuthoritativeGuardianApprovalDefault === true) return { guardianAvailable: true, availableAgentModes: modes, missingInputs: [] };
    const unknown: string[] = [];
    if (typeof input.statsigGuardianEnabled !== "boolean") unknown.push("guardian-assignment");
    if (typeof input.hasAuthoritativeGuardianApprovalDefault !== "boolean") unknown.push("guardian-authority");
    return unknown.length ? missing(...unknown) : { guardianAvailable: false, availableAgentModes: without, missingInputs: [] };
  } catch (error) { return missing(error instanceof Error ? error.message : "permissions"); }
}

/** Classification only. No permission mutation, dialog result or model ACK is
 * manufactured here; the native selection consumer owns those separate steps. */
export function decideWorkModelPermissions(input: WorkModelPermissionInput): WorkModelPermissionDecision {
  const result = (status: WorkModelPermissionDecision["status"], guardianAvailable: boolean | null = null,
    reason?: WorkModelPermissionDecision["reason"], missingInputs: string[] = []): WorkModelPermissionDecision => ({ status, guardianAvailable, ...(reason ? { reason } : {}), missingInputs });
  if (input.isConfigDataPending !== false) return result("not-ready", null, undefined, ["config-pending"]);
  if (typeof input.candidate.model !== "string" || !input.candidate.model || input.current.model !== null && typeof input.current.model !== "string") return result("not-ready", null, undefined, ["model-selection"]);
  const changed = input.candidate.model !== input.current.model;
  if (changed) {
    let required: boolean;
    try { required = isWorkModelAutoReviewRequired(input.requirements, input.candidate.model); }
    catch (error) { return result("not-ready", null, undefined, [error instanceof Error ? error.message : "requirements"]); }
    if (required) return result("needs-guardian", projectWorkGuardianAvailability(input).guardianAvailable, "required-model");
    const lower = input.candidate.model.toLowerCase();
    if ((lower.includes("cyber") || lower.includes("daybreak")) && input.current.agentMode !== "guardian-approvals") {
      const availability = projectWorkGuardianAvailability(input);
      if (availability.guardianAvailable === null) return result("not-ready", null, undefined, availability.missingInputs);
      if (availability.guardianAvailable) {
        if (input.current.agentMode === null) return result("not-ready", true, undefined, ["current-agent-mode"]);
        return result("needs-guardian", true, "cyber-daybreak");
      }
    }
  }
  if (input.candidate.reasoningEffort === "ultra" && input.current.reasoningEffort !== "ultra") {
    if (input.current.agentMode === null) return result("not-ready", null, undefined, ["current-agent-mode"]);
    if (input.current.agentMode === "full-access") {
      const profile = input.current.permissionProfileId;
      if (profile === undefined) return result("not-ready", null, undefined, ["permission-profile"]);
      if (profile === null || profile.startsWith(":")) return result("needs-full-access", null, "ultra-full-access");
    }
  }
  return result("allowed");
}

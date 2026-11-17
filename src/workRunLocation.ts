import type { WorkDecision } from "./workAccess";

// Fixed 26.1111 chkj.C4: work-run-location-contract.md / RL01–RL05.
// This is a pure projection, not an HTTP reader, executor, model selector or
// the additional iRBf localWorkDraftKey override.
export type WorkRunLocation = "local" | "cloud";
export type WorkProjectUnavailableReason = "project-incompatible" | "shared-project" | "unsupported-project-type" | "project-only-memory";
type WorkAccessReason = Extract<WorkDecision, { status: "denied" }>["reason"] | "loading" | "error";
export interface WorkRunLocationState {
  canChooseLocation: boolean;
  effectiveLocation: WorkRunLocation | null;
  unavailableReasons: { cloud: WorkAccessReason | WorkProjectUnavailableReason | null; local: WorkAccessReason | WorkProjectUnavailableReason | null };
}
export interface WorkRunLocationCoreInput {
  applyRolloutRules: boolean;
  cloudAccess: WorkDecision;
  localAccess: WorkDecision;
  enforceAccess: boolean;
  cloudProjectUnavailableReason: WorkProjectUnavailableReason | null;
  isEnterprise: boolean;
  isM2SyncEnabled: boolean;
  preferredLocation: WorkRunLocation;
  lockedProject: boolean;
}
function accessReason(access: WorkDecision): WorkAccessReason | null {
  switch (access.status) {
    case "allowed": return null;
    case "loading": return "loading";
    case "error": return "error";
    case "denied": return access.reason;
  }
}
export function projectWorkRunLocationCore(input: WorkRunLocationCoreInput): WorkRunLocationState {
  const unavailableReasons: WorkRunLocationState["unavailableReasons"] = {
    cloud: (input.enforceAccess ? accessReason(input.cloudAccess) : null) ?? input.cloudProjectUnavailableReason,
    local: input.enforceAccess ? accessReason(input.localAccess) : null,
  };
  const candidate = !input.applyRolloutRules || input.isEnterprise || input.isM2SyncEnabled ? input.preferredLocation : "local";
  let effectiveLocation: WorkRunLocation | null = candidate;
  if (unavailableReasons[candidate] !== null) {
    const other = candidate === "cloud" ? "local" : "cloud";
    effectiveLocation = unavailableReasons[other] === null ? other : null;
  }
  if (input.lockedProject) return { canChooseLocation: false, effectiveLocation: unavailableReasons.cloud === null ? "cloud" : null,
    unavailableReasons: { ...unavailableReasons, local: "unsupported-project-type" } };
  return { canChooseLocation: !input.applyRolloutRules || (input.isEnterprise || input.isM2SyncEnabled)
    && (!input.enforceAccess || input.cloudAccess.status === "allowed" && input.localAccess.status === "allowed"),
  effectiveLocation, unavailableReasons };
}

export interface WorkRunLocationEvidence {
  homeComposerMode: "chat" | "work" | null;
  gate246: boolean | null;
  gate355: boolean | null;
  plan: string | null;
  orchestrationCapable: boolean | null;
  lockdownState: "disabled" | "enabled" | "loading" | null;
  workCloud: WorkDecision | null;
  workLocal: WorkDecision | null;
  // null = actually read missing/cleared preference; undefined = not read.
  // Unsupported persisted strings are retained as unknown, never rewritten.
  persistedLocation: string | null | undefined;
  // Real no-project evidence is {cloudUnavailableReason:null,locked:false}.
  // null means the reader has not established this project state.
  project: { cloudUnavailableReason: WorkProjectUnavailableReason | null; locked: boolean } | null;
}
const enterprisePlans = new Set(["business", "enterprise", "enterprise_cbp_usage_based", "enterprise_cbp_automation", "enterprise_cbp_trial",
  "enterprise_cbp_view_only", "deprecated_enterprise", "hc", "hc_consumption", "finserv", "law", "ent26", "education", "edu_plus", "edu_pro",
  "edu", "deprecated_edu", "k12", "quorum"]);

/** Complete-evidence adapter for the real home enforceAccess=true caller.
 * Insufficient evidence is our null state, not an official unavailable reason.
 * Deliberately requires the full reader envelope; it never substitutes N.allowed,
 * Windows, or an unread capability with a guessed local/default decision. */
export function projectWorkRunLocation(input: WorkRunLocationEvidence): { state: WorkRunLocationState | null; missingInputs: (keyof WorkRunLocationEvidence)[] } {
  const missingInputs: (keyof WorkRunLocationEvidence)[] = [];
  if (input.homeComposerMode !== "chat" && input.homeComposerMode !== "work") missingInputs.push("homeComposerMode");
  if (typeof input.gate246 !== "boolean") missingInputs.push("gate246");
  if (typeof input.gate355 !== "boolean") missingInputs.push("gate355");
  if (typeof input.plan !== "string") missingInputs.push("plan");
  if (typeof input.orchestrationCapable !== "boolean") missingInputs.push("orchestrationCapable");
  if (input.lockdownState !== "disabled" && input.lockdownState !== "enabled" && input.lockdownState !== "loading") missingInputs.push("lockdownState");
  if (input.workCloud == null) missingInputs.push("workCloud");
  if (input.workLocal == null) missingInputs.push("workLocal");
  if (input.persistedLocation !== null && input.persistedLocation !== "local" && input.persistedLocation !== "cloud") missingInputs.push("persistedLocation");
  if (input.project == null || input.project.cloudUnavailableReason === undefined || typeof input.project.locked !== "boolean") missingInputs.push("project");
  if (missingInputs.length) return { state: null, missingInputs };
  const isM2SyncEnabled = input.homeComposerMode === "work" && input.orchestrationCapable === true
    && input.workCloud!.status === "allowed" && input.lockdownState === "disabled";
  return { state: projectWorkRunLocationCore({
    applyRolloutRules: input.gate246!, cloudAccess: input.workCloud!, localAccess: input.workLocal!, enforceAccess: true,
    cloudProjectUnavailableReason: input.project!.cloudUnavailableReason, lockedProject: input.project!.locked,
    isEnterprise: enterprisePlans.has(input.plan!), isM2SyncEnabled,
    preferredLocation: input.persistedLocation === "local" || input.persistedLocation === "cloud" ? input.persistedLocation
      : isM2SyncEnabled && input.gate355 ? "cloud" : "local",
  }), missingInputs };
}

export type ApprovalPolicy = "on-request" | "on-failure" | "untrusted" | "never" | {
  granular: Record<string, boolean>;
};
export type ApprovalsReviewer = "user" | "auto_review" | "guardian_subagent";
export type SandboxPolicy =
  | { type: "readOnly"; networkAccess: boolean }
  | { type: "dangerFullAccess" }
  | { type: "workspaceWrite"; writableRoots: string[]; networkAccess: boolean; excludeSlashTmp: boolean; excludeTmpdirEnvVar: boolean };
export interface ExecutionPolicy {
  approvalPolicy: ApprovalPolicy;
  approvalsReviewer: ApprovalsReviewer;
  sandboxPolicy: SandboxPolicy;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
}

/** thread/start accepts config overrides, whereas turn/start accepts sandboxPolicy. */
export function executionThreadConfig(policy: ExecutionPolicy, config?: Record<string, unknown>, workspaceRoots: string[] = []): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of ["web_search", "model_verbosity", "model_reasoning_summary"]) {
    if (config?.[key] != null) result[key] = config[key];
  }
  if (policy.sandboxPolicy.type === "workspaceWrite") {
    const sandbox = policy.sandboxPolicy;
    result.sandbox_workspace_write = {
      writable_roots: sandbox.writableRoots.filter(root => !workspaceRoots.includes(root)), network_access: sandbox.networkAccess,
      exclude_slash_tmp: sandbox.excludeSlashTmp, exclude_tmpdir_env_var: sandbox.excludeTmpdirEnvVar,
    };
  }
  return result;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function approval(value: unknown, fallback?: ApprovalPolicy): ApprovalPolicy {
  if (value == null && fallback !== undefined) return fallback;
  if (value === "on-request" || value === "on-failure" || value === "untrusted" || value === "never") return value;
  if (object(value) && Object.keys(value).length === 1 && object(value.granular)) {
    const granular = value.granular;
    const keys = ["sandbox_approval", "rules", "mcp_elicitations", "skill_approval", "request_permissions"];
    if (["sandbox_approval", "rules", "mcp_elicitations"].every(key => typeof granular[key] === "boolean")
      && Object.entries(granular).every(([key, entry]) => keys.includes(key) && typeof entry === "boolean")) {
      return { granular: { ...granular } as Record<string, boolean> };
    }
  }
  throw new Error("无法识别批准策略，请检查配置后重试");
}

function reviewer(value: unknown, fallback?: ApprovalsReviewer): ApprovalsReviewer {
  if (value == null && fallback !== undefined) return fallback;
  if (value === "user" || value === "auto_review" || value === "guardian_subagent") return value;
  throw new Error("无法识别审批审核方，请检查配置后重试");
}

function boolean(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  throw new Error("沙盒权限必须是布尔值");
}

function roots(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every(entry => typeof entry === "string" && entry.trim() !== "")) {
    throw new Error("沙盒可写目录无效");
  }
  return [...value];
}

function policy(approvalPolicy: ApprovalPolicy, approvalsReviewer: ApprovalsReviewer, sandboxPolicy: SandboxPolicy): ExecutionPolicy {
  return { approvalPolicy, approvalsReviewer, sandboxPolicy, sandbox: sandboxPolicy.type === "workspaceWrite"
    ? "workspace-write" : sandboxPolicy.type === "dangerFullAccess" ? "danger-full-access" : "read-only" };
}

/** Fixed official ytt/KJ semantics; malformed explicit permissions fail instead of broadening. */
export function resolveConfiguredExecutionPolicy(config: Record<string, unknown>, workspaceRoots: string[]): ExecutionPolicy {
  const mode = config.sandbox_mode ?? "read-only";
  const approvalPolicy = approval(config.approval_policy, mode === "danger-full-access" ? "never" : "on-request");
  let approvalsReviewer = reviewer(config.approvals_reviewer, "user");
  const flatGuardian = config["features.guardian_approval"];
  const guardian = typeof flatGuardian === "boolean" ? flatGuardian
    : object(config.features) ? config.features.guardian_approval : undefined;
  if (approvalsReviewer === "guardian_subagent" && guardian === false) approvalsReviewer = "user";
  if (mode === "read-only") return policy(approvalPolicy, approvalsReviewer, { type: "readOnly", networkAccess: false });
  if (mode === "danger-full-access") return policy(approvalPolicy, approvalsReviewer, { type: "dangerFullAccess" });
  if (mode !== "workspace-write") throw new Error("无法识别沙盒模式，请检查配置后重试");
  const configured = config.sandbox_workspace_write;
  if (configured != null && !object(configured)) throw new Error("工作空间沙盒配置无效");
  const workspace = configured ?? {};
  return policy(approvalPolicy, approvalsReviewer, {
    type: "workspaceWrite",
    writableRoots: [...roots(workspaceRoots), ...roots(workspace.writable_roots ?? [])],
    networkAccess: boolean(workspace.network_access),
    excludeSlashTmp: boolean(workspace.exclude_slash_tmp),
    excludeTmpdirEnvVar: boolean(workspace.exclude_tmpdir_env_var),
  });
}

/** Explicit existing app presets deliberately override configured defaults. */
export function resolvePresetExecutionPolicy(mode: "ask" | "auto" | "full", workspaceRoots: string[], networkAccess = false): ExecutionPolicy {
  if (mode !== "ask" && mode !== "auto" && mode !== "full") throw new Error("无法识别权限预设");
  return resolveConfiguredExecutionPolicy({
    sandbox_mode: mode === "full" ? "danger-full-access" : "workspace-write",
    approval_policy: mode === "full" ? "never" : "on-request",
    approvals_reviewer: mode === "auto" ? "auto_review" : "user",
    sandbox_workspace_write: { network_access: networkAccess },
  }, workspaceRoots);
}

/** start/resume returns sandbox; settings/updated returns threadSettings.sandboxPolicy. */
export function readThreadExecutionPolicy(response: unknown): ExecutionPolicy | undefined {
  if (!object(response)) return undefined;
  const settings = object(response.threadSettings) ? response.threadSettings : response;
  const sandbox = settings.sandboxPolicy ?? settings.sandbox;
  if (!object(sandbox)) return undefined;
  try {
    const approvalPolicy = approval(settings.approvalPolicy);
    const approvalsReviewer = reviewer(settings.approvalsReviewer);
    if (sandbox.type === "dangerFullAccess") return policy(approvalPolicy, approvalsReviewer, { type: "dangerFullAccess" });
    if (sandbox.type === "readOnly") return policy(approvalPolicy, approvalsReviewer, { type: "readOnly", networkAccess: boolean(sandbox.networkAccess) });
    if (sandbox.type !== "workspaceWrite") return undefined;
    return policy(approvalPolicy, approvalsReviewer, {
      type: "workspaceWrite", writableRoots: roots(sandbox.writableRoots ?? []), networkAccess: boolean(sandbox.networkAccess),
      excludeSlashTmp: boolean(sandbox.excludeSlashTmp), excludeTmpdirEnvVar: boolean(sandbox.excludeTmpdirEnvVar),
    });
  } catch {
    return undefined;
  }
}

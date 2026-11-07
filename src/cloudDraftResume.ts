interface PreparedCloudResume {
  modelProvider?: string | null;
  serviceTier?: string | null;
  cwd?: string | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  personality?: string | null;
  config?: Readonly<Record<string, unknown>> | null;
}

const permissionKeys = [
  "approval_policy", "approvals_reviewer", "sandbox_mode", "sandbox_workspace_write",
  "permissions", "default_permissions", "profile", "profiles", "network_requirements", "auto_review",
  "features.guardian_approval", "features.guardianv2", "features.request_permissions_tool",
];
const preservesServerPermissions = (key: string) => !permissionKeys.some(permission => key === permission || key.startsWith(`${permission}.`));

// Serialize the ordinary durable F04 branch after metadata and preferences are prepared.
export function cloudDraftResumeParams({ threadId, path, prepared, includeServiceTier, reuseRunningThread }: {
  threadId: string;
  path: string | null | undefined;
  prepared: PreparedCloudResume;
  includeServiceTier: boolean;
  reuseRunningThread: boolean;
}) {
  const entries: [string, unknown][] = [];
  if (!reuseRunningThread) {
    for (const [key, value] of Object.entries(prepared.config ?? {})) {
      if (!preservesServerPermissions(key)) continue;
      if (key === "features" && value && typeof value === "object" && !Array.isArray(value)) {
        const features = Object.entries(value).filter(([name]) => preservesServerPermissions(`features.${name}`));
        if (features.length) entries.push([key, Object.fromEntries(features)]);
      } else entries.push([key, value]);
    }
  }
  return {
    threadId, history: null, path, model: null,
    modelProvider: prepared.modelProvider,
    ...(includeServiceTier ? { serviceTier: prepared.serviceTier } : {}),
    cwd: prepared.cwd,
    ...(reuseRunningThread ? {} : {
      baseInstructions: prepared.baseInstructions ?? undefined,
      developerInstructions: prepared.developerInstructions ?? undefined,
    }),
    personality: prepared.personality,
    excludeTurns: true,
    ...(entries.some(([, value]) => value != null) ? { config: Object.fromEntries(entries) } : {}),
  };
}

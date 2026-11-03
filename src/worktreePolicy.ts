export interface WorktreePolicyRecord {
  path: string;
  ownerThreadId: string | null;
  createdAtMs: number | null;
}

export interface WorktreeThreadMetadata {
  updatedAtMs: number | null;
  isInProgress: boolean;
}

export interface WorktreeCleanupInput {
  records: WorktreePolicyRecord[];
  keepCount: number;
  threadMetadataById: Record<string, WorktreeThreadMetadata | null>;
  pinnedThreadIds: string[];
  protectedWorktreeDirs: string[];
  nowMs: number;
  protectPreMigrationOwnerlessWorktrees: boolean;
}

const PRE_MIGRATION_MS = Date.parse("2026-02-21T00:00:00.000Z");

/** Candidate planning only; callers must revalidate protections before deleting. */
export function planWorktreeCleanup(input: WorktreeCleanupInput): {
  candidates: WorktreePolicyRecord[];
  eligibleCount: number;
} {
  const { records, keepCount, threadMetadataById, nowMs } = input;
  const protectedDirs = new Set(input.protectedWorktreeDirs);
  const pinnedIds = new Set(input.pinnedThreadIds);
  for (const record of records) {
    if (record.ownerThreadId != null) {
      if (pinnedIds.has(record.ownerThreadId)
        || threadMetadataById[record.ownerThreadId]?.isInProgress === true) {
        protectedDirs.add(record.path);
      }
    } else if (record.createdAtMs != null
      && (nowMs - record.createdAtMs < 3_600_000
        || (input.protectPreMigrationOwnerlessWorktrees
          && record.createdAtMs < PRE_MIGRATION_MS))) {
      protectedDirs.add(record.path);
    }
  }
  const ownerless = records.filter(record => record.ownerThreadId == null
    && !protectedDirs.has(record.path));
  const owned = records.filter(record => record.ownerThreadId != null
    && !protectedDirs.has(record.path));
  ownerless.sort((left, right) => left.createdAtMs !== right.createdAtMs
    ? (left.createdAtMs ?? Number.MAX_SAFE_INTEGER)
      - (right.createdAtMs ?? Number.MAX_SAFE_INTEGER)
    : left.path.localeCompare(right.path));
  owned.sort((left, right) => {
    const leftUpdated = threadMetadataById[left.ownerThreadId!]?.updatedAtMs ?? 0;
    const rightUpdated = threadMetadataById[right.ownerThreadId!]?.updatedAtMs ?? 0;
    return leftUpdated !== rightUpdated
      ? leftUpdated - rightUpdated
      : left.path.localeCompare(right.path);
  });
  const eligible = [...ownerless, ...owned];
  return {
    candidates: records.length <= keepCount
      ? []
      : eligible.slice(0, Math.max(0, eligible.length - keepCount)),
    eligibleCount: eligible.length,
  };
}

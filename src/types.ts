export interface AppServerStatus {
  connected: boolean;
  connecting: boolean;
  binaryPath: string;
  appServerVersion: string | null;
  userAgent: string | null;
  lastError: string | null;
}

export interface ArchiveDeleteResult {
  deletedThreadIds: string[];
  error: string | null;
}

export interface PendingServerRequest {
  id: string | number;
  method: string;
  params: any;
  generation: number;
  responseDeliveryUnknown: boolean;
  notificationNonce?: string;
}

export interface WorkspaceRootItem {
  id: string;
  path: string;
  label: string;
  active: boolean;
  hasAgentsMd: boolean;
  /** Explicit legacy-id mapping for this local host and CODEX_HOME, never inferred from cwd. */
  serverProjectId?: string | null;
}

export interface DirectoryEntryItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
}

export interface ThreadProjectAssignment {
  projectKind: "local" | "remote";
  projectId: string;
  hostId?: string;
  projectOrigin?: string;
}

export interface SidebarProjectMembership {
  threadProjectAssignments: Record<string, ThreadProjectAssignment>;
  projectlessThreadIds: string[];
  workspaceProjectAssignments: Record<string, ThreadProjectAssignment | null>;
  localProjects?: SidebarLocalProject[];
  selectedProjectId?: string | null;
}

export interface SidebarLocalProject {
  id: string;
  name: string;
  rootPaths: string[];
  createdAt: number;
  serverProjectId?: string | null;
}

export interface FilePreviewResult {
  path: string;
  isBinary: boolean;
  isImage: boolean;
  content: string | null;
  base64DataUrl: string | null;
  sizeBytes: number;
  mtimeMs: number;
}

export interface GitFileEntry {
  status: string;
  path: string;
  previousPath?: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export interface GitStatusInfo {
  isGitRepo: boolean;
  root: string | null;
  branch: string | null;
  defaultBranch: string | null;
  upstreamRef: string | null;
  commitsAhead: number;
  clean: boolean;
  additions: number;
  deletions: number;
  filesChanged: number;
  entries: GitFileEntry[];
}

export interface GitWorktreeInfo {
  path: string;
  isPrimary: boolean;
  gitDir: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  isCodexManaged: boolean;
  ownerThreadId: string | null;
  hasUncommittedChanges: boolean;
}

export interface ModelReasoningOption {
  reasoningEffort: string;
  description?: string;
}

export interface ModelConfiguration {
  model: string;
  reasoningEffort: string | null;
  serviceTier: string | null;
}

export interface ModelServiceTier {
  id: string;
  name?: string;
  description?: string;
}

export interface ModelInfo {
  id: string;
  model?: string;
  displayName?: string;
  description?: string;
  hidden?: boolean;
  tags?: string[];
  contextWindow?: number;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<ModelReasoningOption | string>;
  additionalSpeedTiers?: string[];
  serviceTiers?: ModelServiceTier[];
  defaultServiceTier?: string | null;
  availableAccessPrograms?: { cyber?: string[] } | null;
  isDefault?: boolean;
}

export interface ThreadReadState {
  revision: string;
  firstUnread?: { type: "threadStart" } | { type: "turn"; turnId: string } | null;
}

export interface ThreadSummary {
  id: string;
  name?: string | null;
  preview?: string | null;
  cwd?: string | null;
  createdAt?: number;
  updatedAt?: number;
  recencyAt?: number | null;
  model?: string | null;
  status?: { type: string; activeFlags?: string[] } | string;
  /** 会话所属自定义分区（`thread/list` 的 `section` 对象），null 表示未分组。 */
  section?: string | { id: string; name?: string; appearance?: unknown } | null;
  /** 会话所属项目实体 id（`thread/list` 的 `projectId` 字段），null 表示未关联项目。 */
  projectId?: string | null;
  /** Durable local receipt from thread/list.readStates; absent means unsupported/ineligible. */
  readState?: ThreadReadState | null;
}

export interface TurnItem {
  id?: string;
  type: string;
  text?: string;
  content?: any;
  summary?: any;
  command?: string | string[];
  cwd?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  aggregatedOutput?: string;
  status?: string;
  changes?: any[];
  toolName?: string;
  serverName?: string;
  arguments?: any;
  result?: any;
  durationMs?: number;
  [key: string]: any;
}

export interface TurnData {
  id: string;
  status?: string;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
  error?: any;
  items: TurnItem[];
}

export interface ModelProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  envKey?: string | null;
  wireApi?: string | null;
}

export interface McpServerConfigItem {
  id: string;
  command?: string | null;
  args: string[];
  url?: string | null;
  env: Record<string, string>;
  enabled: boolean;
}

export interface CodexConfigOverview {
  configPath: string;
  rawToml: string;
  model: string | null;
  modelProvider: string | null;
  modelReasoningEffort: string | null;
  approvalPolicy: string | null;
  sandboxMode: string | null;
  modelCatalogJson: string | null;
  temperature?: number | null;
  topP?: number | null;
  maxOutputTokens?: number | null;
  contextWindow?: number | null;
  webSearchMode?: string | null;
  allowNetwork?: boolean | null;
  maxParallelTools?: number | null;
  subagentConcurrency?: number | null;
  outputVerbosity?: string | null;
  instructions?: string | null;
  providers: ModelProviderConfig[];
  mcpServers: McpServerConfigItem[];
}

export interface SessionModelParameters {
  model?: string;
  reasoningEffort?: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  contextWindow?: number;
  webSearchMode?: "disabled" | "cached" | "live";
  allowNetwork?: boolean;
  sandboxMode?: "dangerously-skip" | "workspace-write" | "read-only";
  approvalPolicy?: "untrusted" | "on-demand" | "never";
  maxParallelTools?: number;
  subagentConcurrency?: number;
  outputVerbosity?: "low" | "medium" | "high";
}

export interface SkillInfoItem {
  id: string;
  name: string;
  description: string;
  path: string;
  dirPath: string;
  installed: boolean;
  content: string;
}

export interface AutomationItem {
  id: string;
  kind: string;
  name: string;
  prompt: string;
  status: string;
  rrule: string;
  cwds: string[];
  executionEnvironment: string;
  model: string | null;
  reasoningEffort: string | null;
  targetThreadId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceFileHit {
  name: string;
  relPath: string;
  relDir: string;
  absPath: string;
  isDirectory: boolean;
}

export interface AttachedFileItem {
  id: string;
  name: string;
  path: string;
  kind: "file" | "image" | "mention";
  attachmentType?: "file" | "image";
  persisted?: boolean;
  createdAt?: number;
}

export interface ShellExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  success: boolean;
}

export interface GoalStepItem {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed";
}

export interface ActiveGoalSession {
  id: string;
  threadId: string;
  objective: string;
  status: "running" | "paused" | "completed" | "aborted";
  currentTurn: number;
  maxTurns: number;
  autoVerifyCommand: string;
  verificationStatus: "idle" | "running" | "passed" | "failed";
  verificationOutput?: string;
  steps: GoalStepItem[];
  autoContinue: boolean;
  countdownRemaining: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface InboxNotificationItem {
  id: string;
  title: string;
  subtitle: string;
  kind: "automation" | "approval" | "thread_done" | "mention" | "goal" | "activity";
  threadId?: string;
  createdAt: number;
  read: boolean;
}

export type MainViewRoute =
  | "home"
  | "thread"
  | "projects"
  | "inbox"
  | "scheduled"
  | "plugins"
  | "skills"
  | "worktrees"
  | "review"
  | "code-review"
  | "archive"
  | "settings"
  | "images"
  | "gpts"
  | "sites"
  | "library"
  | "library-file"
  | "cloud-draft"
  | "cloud-environments"
  | "cloud-create"
  | "cloud-new-chat";

export type TurnCompletionPolicy = "always" | "unfocused" | "off";

export type NotificationSoundTheme =
  | "default"
  | "basso"
  | "classic"
  | "glass"
  | "ping"
  | "pop"
  | "purr"
  | "tink"
  | "none";

export type SettingsSectionSlug =
  | "general-settings"
  | "import"
  | "appearance"
  | "archived-chats"
  | "voice"
  | "storage"
  | "agent"
  | "personalization"
  | "pets"
  | "keyboard-shortcuts"
  | "notifications"
  | "plugins-settings"
  | "hooks-settings"
  | "connections"
  | "git-settings"
  | "local-environments"
  | "worktrees"
  | "providers-models"
  | "experimental"
  | "account"
  | "usage"
  | "code-review"
  | "computer-use"
  | "appshots"
  | "browser-use"
  | "cloud-settings"
  | "codex-cloud"
  | "profile";

export type ActiveNavTab =
  | "chat"
  | "worktrees"
  | "automations"
  | "skills"
  | "settings";

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  relativeTime: string;
}

export interface StorageStatsOverview {
  codexHome: string;
  totalBytes: number;
  sessionsBytes: number;
  worktreesBytes: number;
  skillsBytes: number;
  automationsBytes: number;
  configBytes: number;
  worktreeCount: number;
  skillCount: number;
  automationCount: number;
}

export interface QueuedFollowupPrompt {
  id: string;
  clientUserMessageId: string;
  input: any[];
  text: string;
  mode: "queue" | "steer";
  createdAt: number;
}

export interface ProjectScriptCommands {
  runCommand: string;
  testCommand: string;
  buildCommand: string;
  projectType: string;
}

export type PetSpeciesId = string;

export interface InstalledPetItem {
  id: string;
  displayName: string;
  description: string | null;
  spriteVersionNumber: number;
  spritesheetPath: string;
  spritesheetDataUrl: string | null;
}

export const PET_SPECIES_LIST: Array<{
  id: PetSpeciesId;
  name: string;
  emoji: string;
  desc: string;
}> = [
  { id: "codex", name: "Codex", emoji: "✨", desc: "本地表情回退" },
  { id: "rocky", name: "Rocky", emoji: "🪨", desc: "本地表情回退" },
];



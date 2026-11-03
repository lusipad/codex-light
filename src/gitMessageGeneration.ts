import { tauriInvoke } from "./bridge";

export interface GitGenerationContext {
  unifiedDiff: string; filesChanged: number; linesAdded: number; linesRemoved: number;
  filePaths: string[]; headBranch: string | null; baseBranch: string | null;
}
export interface GitMessageResult { operationId: string; message?: string; title?: string; body?: string }
export type GitGenerationMode = "commit" | "pull_request";
const testingNote = "Testing note: If you mention tests, include unit tests or UI testing frameworks only. Skip lint/tsc since CI runs those.";
const untrackedNote = "Untracked changes are not included.";

export function buildCommitContext(context: GitGenerationContext, instructions: string, draftMessage: string): string {
  const sections: string[] = [];
  if (instructions.trim()) sections.push(`Custom commit instructions (follow these for commit message content and formatting):\n${instructions.trim()}`);
  if (draftMessage.trim()) sections.push(`Draft message:\n${draftMessage.trim()}`);
  let files = 0, added = 0, removed = 0, hunk = false;
  for (const line of context.unifiedDiff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) { files++; hunk = false; }
    else if (line.startsWith("@@")) hunk = true;
    else if (hunk && line.startsWith("+")) added++;
    else if (hunk && line.startsWith("-")) removed++;
  }
  const change = added + removed > 1000
    ? ["Changes:", "Diff too large to include inline.", `Summary: ${files} changed files, +${added}/-${removed} lines.`, "", untrackedNote].join("\n")
    : context.unifiedDiff.trim() ? ["Changes:", context.unifiedDiff, untrackedNote].join("\n") : null;
  if (change) sections.push(change);
  if (draftMessage.trim() || change) sections.push(testingNote);
  return sections.join("\n\n");
}

export function buildPullRequestContext(context: GitGenerationContext, instructions: string): string {
  const sections: string[] = [];
  if (context.headBranch || context.baseBranch) sections.push(["Branches:", `- Head: ${context.headBranch ?? "-"}`, `- Base: ${context.baseBranch ?? "-"}`].join("\n"));
  if (instructions.trim()) {
    let guidance = instructions.trim();
    if ((guidance.match(/```/g)?.length ?? 0) % 2) guidance += "\n```";
    sections.push(`Pull request instructions (apply these to the title/body content only):\n${guidance}`);
  }
  const diff = context.unifiedDiff.trim();
  const paths = context.filePaths.slice(0, 100).map(path => `- ${path}`);
  if (context.filePaths.length > 100) paths.push(`…and ${context.filePaths.length - 100} more`);
  sections.push("Changes:\n" + (diff && diff.split(/\r?\n/).length <= 1000 ? diff : paths.join("\n") || "- (no files listed)"));
  return sections.join("\n\n");
}

export async function generateGitMessage(
  cwd: string, mode: GitGenerationMode, options: { includeUnstaged?: boolean; baseBranch?: string | null; draftMessage?: string }, signal: AbortSignal,
): Promise<GitMessageResult> {
  const check = () => { if (signal.aborted) throw Error("生成已取消"); };
  check();
  const [context, instructions] = await Promise.all([
    tauriInvoke<GitGenerationContext>("git_message_context", { cwd, mode, includeUnstaged: options.includeUnstaged ?? true, baseBranch: options.baseBranch ?? null }),
    tauriInvoke<unknown>("desktop_state_get", { key: mode === "commit" ? "git-commit-instructions" : "git-pr-instructions" }),
  ]);
  check();
  if (!context || typeof context.unifiedDiff !== "string" || !Array.isArray(context.filePaths) || context.filePaths.some(path => typeof path !== "string") ||
    (instructions !== null && typeof instructions !== "string")) throw Error("无法读取 Git 生成上下文或指令，请重新读取。");
  if (!context.unifiedDiff.trim() && !context.filePaths.length && !(mode === "commit" && options.draftMessage?.trim())) throw Error("没有可用于生成消息的改动。");
  const prompt = mode === "commit" ? buildCommitContext(context, instructions ?? "", options.draftMessage ?? "") : buildPullRequestContext(context, instructions ?? "");
  const operationId = crypto.randomUUID();
  const cancel = () => { void tauriInvoke("git_message_generation_cancel", { operationId }).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const result = await tauriInvoke<GitMessageResult>("git_message_generate", { request: { operationId, cwd, mode, prompt } });
    check();
    if (result?.operationId !== operationId || (mode === "commit" ? typeof result.message !== "string" || result.message.length < 8 || result.message.length > 4000 || result.message.split(/\r?\n/)[0].length > 72
      : typeof result.title !== "string" || result.title.length < 8 || result.title.length > 120 || /[\r\n]/.test(result.title) || typeof result.body !== "string" || result.body.length < 12 || result.body.length > 30000)) {
      throw Error("生成结果格式不符合要求，请重试。");
    }
    return result;
  } finally { signal.removeEventListener("abort", cancel); }
}

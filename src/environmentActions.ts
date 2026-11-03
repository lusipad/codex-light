import { tauriInvoke } from "./bridge";
import type { EnvironmentAction, EnvironmentList, EnvironmentPlatform, EnvironmentSelection, EnvironmentSnapshot } from "./localEnvironments";

export interface EnvironmentRuntime { list: EnvironmentList; selection: EnvironmentSelection; selected: EnvironmentSnapshot | null; isWorktree: boolean; platform: EnvironmentPlatform }
export interface EnvironmentActionItem { action: EnvironmentAction; index: number; ordinal: number }
export interface EnvironmentActionRunRequest { id: string; sessionId: string; workspaceCwd: string; cwd: string; configPath: string; expectedContent: string; index: number; title: string }
export const getEnvironmentRuntime = (cwd: string) => tauriInvoke<EnvironmentRuntime>("local_environment_runtime", { cwd });
export const selectEnvironmentRuntime = (cwd: string, configPath: string | null) => tauriInvoke<EnvironmentRuntime>("local_environment_runtime_select", { cwd, configPath });
export const getRecentEnvironmentActions = (cwd: string, configPath: string) => tauriInvoke<string[]>("local_environment_recent_actions_get", { cwd, configPath });
export const recordEnvironmentAction = (cwd: string, snapshot: EnvironmentSnapshot, index: number) => tauriInvoke<string[]>("local_environment_record_action", { cwd, configPath: snapshot.path, expectedContent: snapshot.content, index });
export function environmentActionItems(snapshot: EnvironmentSnapshot | null, platform: EnvironmentPlatform): EnvironmentActionItem[] {
  return (snapshot?.environment?.actions ?? []).map((action, index) => ({ action, index })).filter(({ action }) => !action.platform || action.platform === platform).map((item, ordinal) => ({ ...item, ordinal }));
}
export function sortEnvironmentActions(items: EnvironmentActionItem[], recent: string[]) {
  const rank = (name: string) => { const index = recent.indexOf(name); return index < 0 ? Infinity : index; };
  return [...items].sort((left, right) => rank(left.action.name) - rank(right.action.name) || left.ordinal - right.ordinal);
}
export function environmentActionRequest(conversationId: string, workspaceCwd: string, snapshot: EnvironmentSnapshot, item: EnvironmentActionItem): EnvironmentActionRunRequest {
  const runId = `environmentAction${item.ordinal + 1}`;
  return { id: crypto.randomUUID(), sessionId: `environment-action:${encodeURIComponent(conversationId)}:${encodeURIComponent(snapshot.cwd)}:${runId}`, workspaceCwd, cwd: snapshot.cwd, configPath: snapshot.path, expectedContent: snapshot.content, index: item.index, title: item.action.name };
}

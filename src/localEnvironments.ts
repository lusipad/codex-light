import { tauriInvoke } from "./bridge";

export type EnvironmentPlatform = "darwin" | "linux" | "win32";
export type EnvironmentIcon = "tool" | "run" | "debug" | "test";
export interface LifecycleScript { script: string; darwin: { script: string } | null; linux: { script: string } | null; win32: { script: string } | null }
export interface EnvironmentAction { name: string; command: string; icon: EnvironmentIcon | null; platform: EnvironmentPlatform | null }
export interface Environment { version: number; name: string; setup: LifecycleScript; cleanup: LifecycleScript | null; actions: EnvironmentAction[] }
export interface EnvironmentSnapshot {
  path: string; fileName: string; files: string[]; exists: boolean; content: string; expectedContent: string | null;
  schemaError: string | null; environment: Environment | null; cwd: string; workspaceRoot: string; inherited: boolean;
}
export interface EnvironmentList { environments: EnvironmentSnapshot[]; nextFileName: string; defaultPath: string | null }
export interface EnvironmentSelection { configPath: string | null; explicit: boolean }
export interface EnvironmentDraft extends Omit<Environment, "cleanup" | "actions"> { cleanup: LifecycleScript; actions: (EnvironmentAction & { id: string })[] }
export const environmentPlatforms = ["darwin", "linux", "win32"] as const;
export const emptyLifecycle = (): LifecycleScript => ({ script: "", darwin: null, linux: null, win32: null });
const cloneLifecycle = (value?: LifecycleScript | null): LifecycleScript => ({ script: value?.script ?? "", darwin: value?.darwin ? { ...value.darwin } : null, linux: value?.linux ? { ...value.linux } : null, win32: value?.win32 ? { ...value.win32 } : null });
export function environmentDraft(environment?: Environment | null): EnvironmentDraft {
  return { version: environment?.version ?? 1, name: environment?.name ?? "本地", setup: cloneLifecycle(environment?.setup), cleanup: cloneLifecycle(environment?.cleanup), actions: (environment?.actions ?? []).map((action, index) => ({ ...action, id: `existing-${index}` })) };
}
export function environmentDraftError(draft: EnvironmentDraft): string | null {
  if (!draft.name.trim()) return "输入环境名称";
  if (!Number.isInteger(draft.version) || draft.version < 1) return "环境版本必须大于零";
  for (const action of draft.actions) {
    if (Boolean(action.name.trim()) !== Boolean(action.command.trim())) return "请为每个操作添加名字和命令";
    if (action.icon !== null && !["tool", "run", "debug", "test"].includes(action.icon)) return "操作图标无效";
    if (action.platform !== null && !environmentPlatforms.includes(action.platform)) return "操作平台无效";
  }
  return null;
}
export function environmentFromDraft(draft: EnvironmentDraft): Environment {
  const error = environmentDraftError(draft); if (error) throw Error(error);
  const lifecycle = (value: LifecycleScript): LifecycleScript => ({ script: value.script, darwin: value.darwin?.script.length ? { ...value.darwin } : null, linux: value.linux?.script.length ? { ...value.linux } : null, win32: value.win32?.script.length ? { ...value.win32 } : null });
  const cleanup = lifecycle(draft.cleanup);
  return { version: draft.version, name: draft.name.trim(), setup: lifecycle(draft.setup), cleanup: cleanup.script.length || environmentPlatforms.some(platform => cleanup[platform]) ? cleanup : null,
    actions: draft.actions.filter(action => action.name.trim() && action.command.trim()).map(({ name, command, icon, platform }) => ({ name: name.trim(), command, icon, platform })) };
}
export function lifecyclePreview(script: LifecycleScript | null, platform: "default" | EnvironmentPlatform) {
  return platform === "default" ? script?.script ?? "" : script?.[platform]?.script || script?.script || "";
}
export const listLocalEnvironments = (cwd: string) => tauriInvoke<EnvironmentList>("local_environments_list", { cwd });
export const readLocalEnvironment = (cwd: string, configPath: string) => tauriInvoke<EnvironmentSnapshot>("local_environment_read_config", { cwd, configPath });
export const saveLocalEnvironment = (cwd: string, configPath: string | null, environment: Environment, expectedContent: string | null) => tauriInvoke<EnvironmentSnapshot>("local_environment_save_config", { cwd, configPath, environment, expectedContent });
export const getLocalEnvironmentSelection = (cwd: string) => tauriInvoke<EnvironmentSelection>("local_environment_selection_get", { cwd });
export async function selectLocalEnvironment(cwd: string, configPath: string | null) {
  await tauriInvoke<EnvironmentSelection>("local_environment_select", { cwd, configPath });
  const selected = await getLocalEnvironmentSelection(cwd);
  if (!selected.explicit || selected.configPath !== configPath) throw Error("环境选择读回不一致，请重试");
  return selected;
}
export const localEnvironmentAction = (cwd: string, configPath: string, expectedContent: string, index: number) => tauriInvoke<string>("local_environment_action_config", { cwd, configPath, expectedContent, index });

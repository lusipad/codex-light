import { tauriInvoke } from "./bridge";
import { configRead, configBatchWrite, type ConfigReadResult } from "./config";
import { serviceIdentity, type ServiceIdentity } from "./chatgptService";

export type AppshotsHotkey = "DoubleAlt" | "DoubleShift" | null;
export type AppshotsDestination = "automatic" | "last-chat" | "new-chat";
export interface AppshotsSettingsSnapshot {
  identity: ServiceIdentity;
  configuredHotkey: string | null;
  configuredHotkeyDefaulted: boolean;
  eligible: boolean | null;
  ownerState: "active" | "unavailable";
  supported: boolean | null;
  registration: "none" | "pending" | "ready";
}
export interface AppshotsDestinationSnapshot extends AppshotsSettingsSnapshot {
  destination: string;
  destinationDefaulted: boolean;
}
export interface AppshotsDestinationWriteResult {
  saved: AppshotsDestination;
  effective: AppshotsDestinationSnapshot;
  status: "ok" | "okOverridden";
  overridden: boolean;
  runtimeApplied: boolean;
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const destinations = ["automatic", "last-chat", "new-chat"];
const same = (left: ServiceIdentity, right: ServiceIdentity) => left.accountId === right.accountId && left.userId === right.userId && left.generation === right.generation;
const failure = (code: string, message: string, cause?: unknown) => Object.assign(new Error(message), { code, ...(cause === undefined ? {} : { cause }) });
const invalid = () => failure("invalid_response", "应用快照设置响应无效。");
function validIdentity(identity: ServiceIdentity) {
  if (typeof identity?.accountId !== "string" || !identity.accountId || typeof identity.userId !== "string" || !identity.userId
    || !Number.isSafeInteger(identity.generation) || identity.generation < 0) throw failure("invalid_identity", "无法确认当前应用快照账号。");
}
async function current(identity: ServiceIdentity, signal: AbortSignal) {
  signal.throwIfAborted(); validIdentity(identity);
  const actual = await serviceIdentity(signal);
  signal.throwIfAborted();
  if (!same(identity, actual)) throw failure("account_changed", "读取期间账号或服务路由发生变化。");
}
async function checked<T>(identity: ServiceIdentity, signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  await current(identity, signal);
  let result: T;
  try { result = await action(); }
  catch (error) { await current(identity, signal); throw error; }
  await current(identity, signal);
  return result;
}
function snapshot(value: unknown, identity: ServiceIdentity): AppshotsSettingsSnapshot {
  if (!object(value) || !object(value.identity) || !same(identity, value.identity as unknown as ServiceIdentity)
    || !(value.configuredHotkey === null || typeof value.configuredHotkey === "string")
    || typeof value.configuredHotkeyDefaulted !== "boolean"
    || !(value.eligible === null || typeof value.eligible === "boolean")
    || !(value.supported === null || typeof value.supported === "boolean")
    || !["active", "unavailable"].includes(value.ownerState as string)
    || !["none", "pending", "ready"].includes(value.registration as string)) throw invalid();
  return { identity: { ...identity }, configuredHotkey: value.configuredHotkey, configuredHotkeyDefaulted: value.configuredHotkeyDefaulted,
    eligible: value.eligible, supported: value.supported, ownerState: value.ownerState as AppshotsSettingsSnapshot["ownerState"],
    registration: value.registration as AppshotsSettingsSnapshot["registration"] };
}
function destination(config: unknown): { destination: string; destinationDefaulted: boolean } {
  if (!object(config)) throw invalid();
  // CLI 0.165 represents an unset desktop section as null, including user layers.
  if (config.desktop != null && !object(config.desktop)) throw invalid();
  const desktop = config.desktop as Record<string, unknown> | undefined;
  if (!desktop || !Object.hasOwn(desktop, "appshotDestination")) return { destination: "automatic", destinationDefaulted: true };
  // The official settingsStore filters enum-invalid fields before applying the
  // in-memory registry default. Preserve the raw config by never writing here.
  return typeof desktop.appshotDestination === "string" && destinations.includes(desktop.appshotDestination)
    ? { destination: desktop.appshotDestination, destinationDefaulted: false }
    : { destination: "automatic", destinationDefaulted: true };
}
function userLayer(config: ConfigReadResult): { file: string; version: string; config: Record<string, unknown> } {
  if (!Array.isArray(config.layers)) throw invalid();
  const users = config.layers.filter(value => object(value) && object(value.name) && value.name.type === "user" && value.name.profile == null && value.disabledReason == null);
  if (users.length !== 1) throw failure("user_layer_unavailable", "无法确认唯一的用户配置层。");
  const layer = users[0] as Record<string, unknown>, name = layer.name as Record<string, unknown>;
  if (typeof name.file !== "string" || !name.file || typeof layer.version !== "string" || !layer.version || !object(layer.config)) throw failure("user_layer_unavailable", "用户配置层路径、版本或原始内容未确认。");
  return { file: name.file, version: layer.version, config: layer.config };
}
async function refreshDestination(identity: ServiceIdentity, signal: AbortSignal, config: ConfigReadResult): Promise<AppshotsDestinationSnapshot> {
  const effective = destination(config.config);
  const raw = await checked(identity, signal, () => tauriInvoke("appshots_destination_refresh", { request: { identity } }));
  const state = snapshot(raw, identity);
  if (!object(raw) || typeof raw.destination !== "string" || raw.destination !== effective.destination
    || (raw.destinationDefaulted !== undefined && (typeof raw.destinationDefaulted !== "boolean" || raw.destinationDefaulted !== effective.destinationDefaulted))) throw invalid();
  return { ...state, ...effective };
}

export async function readAppshotsSettings(identity: ServiceIdentity, signal: AbortSignal): Promise<AppshotsSettingsSnapshot> {
  return snapshot(await checked(identity, signal, () => tauriInvoke("appshots_settings_read", { request: { identity } })), identity);
}
export async function setAppshotsHotkey(identity: ServiceIdentity, value: AppshotsHotkey, signal: AbortSignal): Promise<AppshotsSettingsSnapshot> {
  if (value !== null && value !== "DoubleAlt" && value !== "DoubleShift") throw failure("invalid_input", "应用快照快捷键不在当前支持的选项中。");
  // Registration, rollback and persistence are one backend transaction. Never replay it.
  return snapshot(await checked(identity, signal, () => tauriInvoke("appshots_hotkey_set", { request: { identity, hotkey: value } })), identity);
}
export async function readAppshotsDestination(identity: ServiceIdentity, signal: AbortSignal): Promise<AppshotsDestinationSnapshot> {
  const config = await checked(identity, signal, () => configRead(undefined, true));
  return refreshDestination(identity, signal, config);
}
export async function writeAppshotsDestination(identity: ServiceIdentity, value: AppshotsDestination, signal: AbortSignal): Promise<AppshotsDestinationWriteResult> {
  if (!destinations.includes(value)) throw failure("invalid_input", "应用快照目标不在当前支持的选项中。");
  const before = await checked(identity, signal, () => configRead(undefined, true));
  destination(before.config);
  const user = userLayer(before);
  let receipt;
  try {
    receipt = await checked(identity, signal, () => configBatchWrite([{ keyPath: "desktop.appshotDestination", value, mergeStrategy: "replace" }],
      { filePath: user.file, expectedVersion: user.version, reloadUserConfig: true }));
  } catch (cause) {
    if ((cause as { code?: string })?.code === "account_changed" || signal.aborted) throw cause;
    throw failure("ambiguous", "应用快照目标写入结果未确认。", cause);
  }
  if (receipt?.status !== "ok" && receipt?.status !== "okOverridden") throw failure("ambiguous", "服务未确认应用快照目标写入。", receipt);
  try {
    const after = await checked(identity, signal, () => configRead(undefined, true));
    const persisted = userLayer(after), saved = destination(persisted.config);
    if (persisted.file !== user.file || saved.destinationDefaulted || saved.destination !== value) throw invalid();
    const effective = await refreshDestination(identity, signal, after);
    return { saved: value, effective, status: receipt.status, overridden: receipt.status === "okOverridden" || effective.destination !== value,
      runtimeApplied: effective.ownerState === "active" };
  } catch (cause) {
    if ((cause as { code?: string })?.code === "account_changed" || signal.aborted) throw cause;
    throw failure("write_readback", "应用快照目标已获写入回执，但保存或生效结果未确认。", cause);
  }
}

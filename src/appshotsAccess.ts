import { callAppServer } from "./bridge";
import { serviceIdentity, shareAccessBootstrap, type ServiceIdentity } from "./chatgptService";

export type AppshotsQualification = boolean | null;
export interface AppshotsAccess {
  hostId: "local";
  identity: ServiceIdentity;
  platform: string;
  generalGate: AppshotsQualification;
  windowsGate: AppshotsQualification;
  requirementsAllowed: AppshotsQualification;
  enabled: AppshotsQualification;
  miniFeature: AppshotsQualification;
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const and = (...values: AppshotsQualification[]): AppshotsQualification => values.includes(false) ? false : values.every(value => value === true) ? true : null;
const sameIdentity = (left: ServiceIdentity, right: ServiceIdentity) => left.accountId === right.accountId && left.userId === right.userId && left.generation === right.generation;

function gates(bootstrap: unknown, identity: ServiceIdentity): [AppshotsQualification, AppshotsQualification, AppshotsQualification] {
  if (!object(bootstrap) || typeof bootstrap.statsigPayload !== "string") return [null, null, null];
  let payload: unknown;
  try { payload = JSON.parse(bootstrap.statsigPayload); } catch { return [null, null, null]; }
  // This adapter supports explicit full snapshots, not Statsig live/delta evaluation.
  if (!object(payload) || !object(payload.user) || !object(payload.user.customIDs)
    || payload.user.userID !== identity.userId || payload.user.customIDs.account_id !== identity.accountId
    || !object(payload.feature_gates) || payload.has_updates !== true || payload.is_delta === true || payload.isDelta === true
    || payload.live_overlay != null || ![undefined, "init-v1", "init-v2"].includes(payload.response_format as string | undefined)) return [null, null, null];
  const entries = payload.feature_gates;
  const gate = (key: string): AppshotsQualification => {
    let hash = 0; for (let index = 0; index < key.length; ++index) hash = (Math.imul(hash, 31) + key.charCodeAt(index)) >>> 0;
    const entry = entries[key] ?? entries[String(hash)];
    const value = object(entry) ? entry[payload.response_format === "init-v2" ? "v" : "value"] : undefined;
    return typeof value === "boolean" ? value : null;
  };
  return [gate("1304276663"), gate("2124127696"), gate("1532120159")];
}

function requirementsAllowed(response: unknown): AppshotsQualification {
  if (!object(response) || !Object.hasOwn(response, "requirements")) return null;
  if (response.requirements === null) return true;
  if (!object(response.requirements)) return null;
  const value = response.requirements.allowAppshots;
  return value == null ? true : typeof value === "boolean" ? value : null;
}

export function decodeAppshotsAccess(bootstrap: unknown, requirementsResponse: unknown, identity: ServiceIdentity, platform: string): AppshotsAccess {
  const [generalGate, windowsGate, miniFeature] = gates(bootstrap, identity);
  const allowed = requirementsAllowed(requirementsResponse);
  const supportedPlatform = platform === "windows" || platform === "macOS";
  return { hostId: "local", identity: { ...identity }, platform, generalGate, windowsGate, requirementsAllowed: allowed,
    enabled: supportedPlatform ? and(generalGate, platform === "windows" ? windowsGate : true, allowed) : false, miniFeature };
}

/** Pass the actual host state; a helper file or configured shortcut is not support. */
export function evaluateAppshotsAvailability(access: AppshotsAccess, supported: AppshotsQualification): AppshotsQualification {
  return access.platform === "windows" ? and(access.enabled, supported) : access.platform === "macOS" ? access.enabled : false;
}

/** Current app_server_call has local scope only; never reuse this result for a remote host. */
export async function readLocalAppshotsAccess(signal: AbortSignal, platform: string): Promise<AppshotsAccess> {
  signal.throwIfAborted();
  const identity = await serviceIdentity(signal);
  if (!identity.accountId || !identity.userId || !Number.isSafeInteger(identity.generation) || identity.generation < 0) throw Error("无法确认 Appshots 账号身份。");
  signal.throwIfAborted();
  const [bootstrap, requirements] = await Promise.all([
    shareAccessBootstrap(identity, signal), callAppServer("configRequirements/read", {}),
  ]);
  signal.throwIfAborted();
  const current = await serviceIdentity(signal);
  signal.throwIfAborted();
  if (!sameIdentity(identity, current)) throw Object.assign(Error("读取期间账号或服务路由发生变化，请重试。"), { code: "account_changed" });
  return decodeAppshotsAccess(bootstrap, requirements, identity, platform);
}

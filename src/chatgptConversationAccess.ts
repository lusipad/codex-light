import { callAppServer, tauriInvoke } from "./bridge";
import { experimentalFeatureListAll } from "./config";
import { readChatgptService, serviceIdentity, shareAccessBootstrap, type ServiceIdentity } from "./chatgptService";

export interface ChatgptConversationAccess {
  identity: ServiceIdentity | null;
  status: "enabled" | "disabled";
  reason?: string;
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
// CL07 + CL15 Adt, distinct from the conditional CL08 workspace permission table.
const supportedPlans = new Set(["free", "go", "plus", "pro", "promax", "prolite", "free_workspace", "team", "self_serve_business_prolite", "sci", "rosalind_academic", "business", "enterprise_cbp_trial", "enterprise_cbp_view_only", "finserv", "law", "ent26", "education", "edu_plus", "edu_pro", "quorum", "enterprise", "hc", "hc_consumption", "deprecated_enterprise", "edu", "deprecated_edu", "k12"]);
const permissionPlans = new Set(["business", "enterprise", "enterprise_cbp_usage_based", "enterprise_cbp_automation", "enterprise_cbp_trial", "enterprise_cbp_view_only", "deprecated_enterprise", "hc", "hc_consumption", "finserv", "law", "ent26", "education", "edu_plus", "edu_pro", "edu", "deprecated_edu", "k12", "quorum"]);

async function strictAuth(signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  let value: unknown;
  try { value = await tauriInvoke("chatgpt_auth_method", {}); }
  catch { throw Error("无法确认 Chat 账号认证状态，请重试。"); }
  signal.throwIfAborted();
  if (value !== null && typeof value !== "string") throw Error("Chat 认证状态不完整，请重试。");
  return value === "chatgpt";
}

function validIdentity(value: ServiceIdentity): void {
  if (!value || typeof value.accountId !== "string" || !value.accountId || typeof value.userId !== "string" || !value.userId
    || !Number.isSafeInteger(value.generation) || value.generation < 0) throw Error("Chat 账号身份不完整，请重试。");
}
async function confirmRouting(identity: ServiceIdentity, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let value: unknown;
  try { value = await callAppServer("account/read", { refreshToken: false }); }
  catch { throw Error("无法确认 Chat 工作空间，请重试。"); }
  signal.throwIfAborted();
  if (!object(value) || !object(value.account) || value.account.type !== "chatgpt" || !object(value.workspaceRouting)
    || value.workspaceRouting.chatgptAccountId !== identity.accountId) throw Error("读取 Chat 权限期间账号发生变化或路由尚未确认，请重试。");
}
async function confirmIdentity(identity: ServiceIdentity, signal: AbortSignal): Promise<void> {
  if (!await strictAuth(signal)) throw Error("读取 Chat 权限期间认证方式发生变化，请重试。");
  await confirmRouting(identity, signal);
  const after = await serviceIdentity(signal);
  signal.throwIfAborted(); validIdentity(after);
  if (identity.accountId !== after.accountId || identity.userId !== after.userId || identity.generation !== after.generation)
    throw Error("读取 Chat 权限期间账号发生变化，请重试。");
}

function selectedPlan(body: unknown, identity: ServiceIdentity): string | null {
  if (!object(body) || !object(body.accounts) || !Array.isArray(body.account_ordering)
    || body.account_ordering.some(key => typeof key !== "string")) throw Error("Chat 账号清单不完整，请重试。");
  // Gy follows ordering keys; they need not equal account_id. Member role,
  // is_zdr and account_user_id are not inputs to this capability policy.
  for (const key of body.account_ordering) {
    const entry: unknown = body.accounts[key];
    if (!object(entry) || !object(entry.account) || entry.account.account_id !== identity.accountId
      || entry.can_access_with_session === false || entry.account.is_deactivated) continue;
    if (typeof entry.account.plan_type !== "string" || !entry.account.plan_type) throw Error("Chat 账号计划尚未确认，请重试。");
    return entry.account.plan_type;
  }
  return null;
}
function permissionGate(bootstrap: unknown, identity: ServiceIdentity): boolean {
  let payload: unknown;
  try { payload = object(bootstrap) && typeof bootstrap.statsigPayload === "string" ? JSON.parse(bootstrap.statsigPayload) : null; }
  catch { throw Error("Chat 权限快照格式无效，请重试。"); }
  // This adapter supports verified full snapshots, not Statsig delta/live
  // evaluation; has_updates is a support boundary, not an official gate rule.
  if (!object(payload) || !object(payload.user) || !object(payload.user.customIDs)
    || payload.user.userID !== identity.userId || payload.user.customIDs.account_id !== identity.accountId
    || !object(payload.feature_gates) || payload.has_updates !== true || payload.live_overlay != null
    || ![undefined, "init-v1", "init-v2"].includes(payload.response_format as string | undefined)
    || [payload.is_delta, payload.isDelta].some(value => value != null && value !== false)) throw Error("Chat 权限快照不完整或与当前账号不符，请重试。");
  const key = "770071981";
  let hash = 0; for (let index = 0; index < key.length; index++) hash = (Math.imul(hash, 31) + key.charCodeAt(index)) >>> 0;
  const entry = payload.feature_gates[key] ?? payload.feature_gates[String(hash)];
  const enabled = object(entry) ? entry[payload.response_format === "init-v2" ? "v" : "value"] : undefined;
  if (typeof enabled !== "boolean") throw Error("Chat 访问资格尚未确认，请重试。");
  return enabled;
}

export async function readChatgptConversationAccess(signal: AbortSignal): Promise<ChatgptConversationAccess> {
  if (!await strictAuth(signal)) return { identity: null, status: "disabled", reason: "not-chatgpt-auth" };
  const identity = await serviceIdentity(signal);
  signal.throwIfAborted(); validIdentity(identity);
  await confirmRouting(identity, signal);
  const [accounts, features] = await Promise.all([
    readChatgptService("share_accounts", {}, identity, signal), experimentalFeatureListAll(),
  ]);
  signal.throwIfAborted();
  const plan = selectedPlan(accounts, identity);
  let reason = plan === null ? "missing-account" : !supportedPlans.has(plan) ? "unsupported-plan" : undefined;
  if (!reason) {
    const bootstrap = await shareAccessBootstrap(identity, signal);
    signal.throwIfAborted();
    const requirePermission = permissionGate(bootstrap, identity);
    if (requirePermission && permissionPlans.has(plan!)) {
      const settings = await readChatgptService("gpts_workspace_settings", {}, identity, signal);
      signal.throwIfAborted();
      if (!object(settings) || (settings.permissions != null && (!Array.isArray(settings.permissions)
        || settings.permissions.some(permission => typeof permission !== "string")))) throw Error("Chat 工作空间权限格式无效，请重试。");
      if (!Array.isArray(settings.permissions) || !settings.permissions.includes("chatgpt.workspace.feature.desktop-app-chat.access")) reason = "workspace-permission-denied";
    }
  }
  // CL05 uses find, not some: absence is enabled only after every page loaded.
  if (!reason && features.find(feature => feature.name === "in_app_chat")?.enabled === false) reason = "experimental-disabled";
  await confirmIdentity(identity, signal);
  return reason ? { identity, status: "disabled", reason } : { identity, status: "enabled" };
}

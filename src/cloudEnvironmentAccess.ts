import { callAppServer } from "./bridge";
import { readChatgptService, serviceIdentity, shareAccessBootstrap, type ServiceIdentity } from "./chatgptService";
import { selectedServiceAccount } from "./serviceAccounts";

export interface CloudEnvironmentAccess {
  identity: ServiceIdentity;
  available: boolean;
  canManage: boolean;
  rbacEnabled: boolean;
  gateEvidence: string;
  canCreate: boolean;
  directCreate: boolean;
}
const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
const personalPlans = new Set(["free", "go", "plus", "prolite", "pro", "promax"]);

/** New cloud settings uses svt/Tv; legacy onboarding and GPT access are separate contracts. */
export async function readCloudEnvironmentAccess(signal: AbortSignal): Promise<CloudEnvironmentAccess> {
  const identity = await serviceIdentity(signal);
  const [auth, accounts, bootstrap] = await Promise.all([
    callAppServer("account/read", { refreshToken: false }),
    readChatgptService("share_accounts", {}, identity, signal),
    shareAccessBootstrap(identity, signal),
  ]);
  signal.throwIfAborted();
  if (!object(auth) || auth.account?.type !== "chatgpt" || auth.workspaceRouting?.chatgptAccountId !== identity.accountId)
    throw Error("无法确认当前云端环境账号。");
  const entry = selectedServiceAccount(accounts, identity.accountId), account = entry.account;
  if (entry.can_access_with_session === false || account.is_deactivated === true) throw Error("当前云端环境账号不可用。");
  if (!object(bootstrap) || typeof bootstrap.statsigPayload !== "string") throw Error("无法读取云端环境访问权限。");
  const payload = JSON.parse(bootstrap.statsigPayload);
  // Explicit full-snapshot adapter boundary; does not claim official mandatory has_updates semantics.
  if (!object(payload) || payload.user?.userID !== identity.userId || payload.user?.customIDs?.account_id !== identity.accountId
    || !object(payload.feature_gates) || payload.has_updates !== true || payload.is_delta === true || payload.isDelta === true
    || payload.live_overlay != null || ![undefined, "init-v1", "init-v2"].includes(payload.response_format))
    throw Error("云端环境权限快照不完整或与当前账号不符。");
  const gateValue = (key: string): unknown => {
    let hash = 0; for (let i = 0; i < key.length; ++i) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0;
    const item = payload.feature_gates[key] ?? payload.feature_gates[String(hash)];
    return item?.[payload.response_format === "init-v2" ? "v" : "value"];
  };
  const gate = (key: string): boolean => {
    const value = gateValue(key);
    if (typeof value !== "boolean") throw Error("云端环境访问资格尚未确认。");
    return value;
  };
  const rbacEnabled = gate("3769444934"), personal = personalPlans.has(account.plan_type);
  let available = true, canManage = !personal, gateEvidence = "cloud-rollout-disabled";
  if (rbacEnabled) {
    canManage = false; gateEvidence = "personal-plan-branch";
    if (!personal) {
      const permissionsEnabled = gate("1355972088");
      const settings = await readChatgptService("cloud_workspace_settings", {}, identity, signal);
      if (!object(settings)) throw Error("云端环境工作空间设置格式无效。");
      if (permissionsEnabled) {
        if (!Array.isArray(settings.permissions) || !settings.permissions.every((value: unknown) => typeof value === "string"))
          throw Error("无法确认云端环境工作空间权限。");
        available = settings.permissions.includes("chatgpt.workspace.feature.allow-codex-access.access");
        canManage = available && settings.permissions.includes("chatgpt.workspace.feature.codex-manage-workspace-environments.access");
        gateEvidence = "workspace-permissions";
      } else {
        if (!object(settings.beta_settings) || typeof settings.beta_settings.wham_access !== "boolean")
          throw Error("无法确认云端环境工作空间开关。");
        available = settings.beta_settings.wham_access; canManage = available;
        gateEvidence = "workspace-wham-access";
      }
    }
  }
  signal.throwIfAborted();
  const after = await serviceIdentity(signal);
  if (identity.accountId !== after.accountId || identity.userId !== after.userId || identity.generation !== after.generation)
    throw Error("读取期间账号发生变化，请重试。");
  return { identity, available, canManage, rbacEnabled, gateEvidence,
    canCreate: available && gateValue("375130565") === true,
    directCreate: gateValue("3620782482") === true,
  };
}

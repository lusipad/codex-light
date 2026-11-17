import { callAppServer } from "./bridge";
import { readChatgptService, readWorkAccountInfo, serviceIdentity, shareAccessBootstrap, type ServiceIdentity } from "./chatgptService";

export type WorkDecision = { status: "allowed"; accountId: string | null }
  | { status: "loading" }
  | { status: "error"; source: "account-info" | "workspace-settings" }
  | { status: "denied"; reason: "unsupported-surface" | "missing-account" | "free-plan" | "go-plan" | "workspace-disabled" | "unsupported-auth" | "rollout-disabled" };
export interface WorkAccessInput {
  accountId: string | null; plan: string | null; authMethod: string | null;
  authLoading: boolean; accountInfoLoading: boolean; accountInfoError: boolean;
  supportedSurface: boolean; workCloudSupportedSurface?: boolean | null;
}
type WorkspaceField = "whamAccess" | "whamLocalAccess" | "adminWorkModeEnabled" | "adminWorkLocalEnabled";
export interface WorkWorkspaceQuery {
  isLoading: boolean; isError: boolean;
  whamAccess?: boolean | null; whamLocalAccess?: boolean | null;
  adminWorkModeEnabled?: boolean | null; adminWorkLocalEnabled?: boolean | null;
  invalidFields?: readonly WorkspaceField[];
}
export interface WorkGates { gate146: boolean | null; gate162: boolean | null }
export interface WorkAccessProjection {
  base: { cloud: WorkDecision; local: WorkDecision; workCloud: WorkDecision; workLocal: WorkDecision };
  // null is this adapter's insufficient evidence, not a fifth official status.
  workCloud: WorkDecision | null; workLocal: WorkDecision | null; combined: WorkDecision | null;
  missingGates: ("1463309241" | "1625797156")[];
}
export interface LocalWorkAccess extends WorkAccessProjection { identity: ServiceIdentity }
export interface WorkSurfaces { supportedSurface: boolean; workCloudSupportedSurface: boolean }
const personal = (plan: string | null) => plan !== null && ["free", "go", "plus", "prolite", "pro", "promax"].includes(plan);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const denied = (reason: Extract<WorkDecision, { status: "denied" }>["reason"]): WorkDecision => ({ status: "denied", reason });

function baseAccess(input: WorkAccessInput, query: WorkWorkspaceQuery | null, field: WorkspaceField, freeGo: boolean): WorkDecision {
  if (!input.supportedSurface) return denied("unsupported-surface");
  if (input.authLoading && input.authMethod === null) return { status: "loading" };
  if (input.authMethod !== "chatgpt" && input.authMethod !== "chatgptAuthTokens") return { status: "allowed", accountId: null };
  if (input.accountInfoError) return { status: "error", source: "account-info" };
  if (input.accountInfoLoading && (input.accountId === null || input.plan === null)) return { status: "loading" };
  if (input.accountId === null || input.plan === null) return denied("missing-account");
  if (!freeGo && (input.plan === "free" || input.plan === "go")) return denied(input.plan === "free" ? "free-plan" : "go-plan");
  if (personal(input.plan)) return { status: "allowed", accountId: input.accountId };
  if (query === null || query.isLoading) return { status: "loading" };
  if (query.isError || query.invalidFields?.includes(field)) return { status: "error", source: "workspace-settings" };
  return query[field] === true ? { status: "allowed", accountId: input.accountId } : denied("workspace-disabled");
}
export function needsWorkWorkspace(input: WorkAccessInput): boolean {
  return (input.supportedSurface || input.workCloudSupportedSurface === true)
    && ["chatgpt", "chatgptAuthTokens"].includes(input.authMethod ?? "") && !input.accountInfoError && !input.accountInfoLoading
    && input.accountId !== null && input.plan !== null && !personal(input.plan);
}
export function projectWorkBase(input: WorkAccessInput, workspace: WorkWorkspaceQuery | null): WorkAccessProjection["base"] {
  const query = needsWorkWorkspace(input) ? workspace : null;
  const cloudInput = { ...input, supportedSurface: input.workCloudSupportedSurface ?? input.supportedSurface };
  const cloud = (field: WorkspaceField, freeGo: boolean): WorkDecision => {
    const decision = baseAccess(cloudInput, query, field, freeGo);
    return input.authMethod !== "chatgpt" && decision.status === "allowed" ? denied("unsupported-auth") : decision;
  };
  const workLocal = baseAccess(input, query, "adminWorkLocalEnabled", true);
  return { cloud: cloud("whamAccess", true), local: baseAccess(input, query, "whamLocalAccess", true),
    workCloud: cloud("adminWorkModeEnabled", false),
    workLocal: input.authMethod === "copilot" && workLocal.status === "allowed" ? denied("unsupported-auth") : workLocal };
}
export function mergeWorkAccess(left: WorkDecision | null, right: WorkDecision | null): WorkDecision | null {
  if (left?.status === "allowed") return left;
  if (right?.status === "allowed") return right;
  if (left === null || right === null) return null;
  if (left.status === "loading" || right.status === "loading") return { status: "loading" };
  if (left.status === "error") return left;
  return right.status === "error" ? right : left;
}
export function projectWorkAccess(input: WorkAccessInput, workspace: WorkWorkspaceQuery | null, gates: WorkGates): WorkAccessProjection {
  const base = projectWorkBase(input, workspace), missing = new Set<"1463309241" | "1625797156">();
  const gate = (id: "1463309241" | "1625797156", value: boolean | null) => { if (typeof value !== "boolean") { missing.add(id); return null; } return value; };
  // Official rollout-disabled atom is fixed false; no debug override is exposed.
  const cloud = (): WorkDecision | null => {
    if (input.authMethod !== "chatgpt") return base.workCloud;
    if (personal(input.plan)) {
      if (base.workCloud.status !== "allowed") return base.workCloud;
      const rollout = gate("1625797156", gates.gate162);
      if (rollout === null) return null;
      if (!rollout) return denied("rollout-disabled");
    }
    if (!input.supportedSurface) return base.workCloud;
    const rollout = gate("1463309241", gates.gate146);
    return rollout === null ? null : rollout ? base.workCloud : base.local;
  };
  const local = (): WorkDecision | null => {
    if (input.authMethod !== "chatgpt" || input.plan === "free" || input.plan === "go") return base.workLocal;
    const rollout = gate("1463309241", gates.gate146);
    return rollout === null ? null : rollout ? base.workLocal : base.local;
  };
  const workCloud = cloud(), workLocal = local();
  return { base, workCloud, workLocal, combined: mergeWorkAccess(workCloud, workLocal), missingGates: [...missing] };
}

function workspaceQuery(body: unknown): WorkWorkspaceQuery {
  if (!object(body)) return { isLoading: false, isError: true };
  const invalidFields: WorkspaceField[] = [];
  const field = (key: WorkspaceField, value: unknown): boolean | null | undefined => {
    if (value === undefined || value === null || typeof value === "boolean") return value;
    invalidFields.push(key); return undefined;
  };
  const beta = body.beta_settings;
  if (beta != null && !object(beta)) invalidFields.push("whamAccess", "whamLocalAccess");
  const betaValue = (name: string) => object(beta) ? beta[name] : undefined;
  return { isLoading: false, isError: false, invalidFields,
    adminWorkModeEnabled: field("adminWorkModeEnabled", body.admin_work_mode_enabled),
    adminWorkLocalEnabled: field("adminWorkLocalEnabled", body.admin_work_local_enabled),
    whamAccess: field("whamAccess", betaValue("wham_access")), whamLocalAccess: field("whamLocalAccess", betaValue("wham_local_access")) };
}
function bootstrapGates(bootstrap: unknown, identity: ServiceIdentity): WorkGates {
  const unknown: WorkGates = { gate146: null, gate162: null };
  if (!object(bootstrap) || typeof bootstrap.statsigPayload !== "string") return unknown;
  let payload: unknown; try { payload = JSON.parse(bootstrap.statsigPayload); } catch { return unknown; }
  // Full-snapshot adapter boundary, not an official mandatory has_updates rule.
  if (!object(payload) || !object(payload.user) || !object(payload.user.customIDs)
    || payload.user.userID !== identity.userId || payload.user.customIDs.account_id !== identity.accountId
    || !object(payload.feature_gates) || payload.has_updates !== true || payload.is_delta === true || payload.isDelta === true
    || payload.live_overlay != null || ![undefined, "init-v1", "init-v2"].includes(payload.response_format as string | undefined)) return unknown;
  const entries = payload.feature_gates, format = payload.response_format;
  const gate = (key: string): boolean | null => {
    let hash = 0; for (let i = 0; i < key.length; i++) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0;
    const entry = entries[key] ?? entries[String(hash)], value = object(entry) ? entry[format === "init-v2" ? "v" : "value"] : undefined;
    return typeof value === "boolean" ? value : null;
  };
  return { gate146: gate("1463309241"), gate162: gate("1625797156") };
}
const changed = () => Object.assign(Error("读取期间 Work 账号、套餐或服务路由发生变化。"), { code: "account_changed" });
function accountInput(raw: unknown): { accountId: string } {
  if (!object(raw) || !object(raw.account) || raw.account.type !== "chatgpt") throw Object.assign(Error("当前 Work 服务适配器不支持此认证方式。"), { code: "unsupported_auth" });
  if (!object(raw.workspaceRouting)
    || typeof raw.workspaceRouting.chatgptAccountId !== "string" || !raw.workspaceRouting.chatgptAccountId) throw Error("Work 账号或路由数据未确认。");
  return { accountId: raw.workspaceRouting.chatgptAccountId };
}
export async function readLocalWorkAccess(signal: AbortSignal, surfaces: WorkSurfaces): Promise<LocalWorkAccess> {
  signal.throwIfAborted();
  if (typeof surfaces?.supportedSurface !== "boolean" || typeof surfaces.workCloudSupportedSurface !== "boolean") throw Error("尚未确认本地主窗 Work surface。");
  const confirmedSurfaces = { ...surfaces };
  const before = accountInput(await callAppServer("account/read", { refreshToken: false })); signal.throwIfAborted();
  const identity = await serviceIdentity(signal); signal.throwIfAborted();
  if (typeof identity?.userId !== "string" || !identity.userId || identity.accountId !== before.accountId
    || !Number.isSafeInteger(identity.generation) || identity.generation < 0) throw changed();
  const current = async () => {
    signal.throwIfAborted(); const actual = await serviceIdentity(signal); signal.throwIfAborted();
    if (actual.accountId !== identity.accountId || actual.userId !== identity.userId || actual.generation !== identity.generation) throw changed();
  };
  const info = await readWorkAccountInfo(identity, signal); await current();
  const input: WorkAccessInput = { ...confirmedSurfaces, accountId: identity.accountId, plan: info.plan, authMethod: info.authMethod,
    authLoading: false, accountInfoError: false, accountInfoLoading: false };
  let workspace: WorkWorkspaceQuery | null = null;
  if (needsWorkWorkspace(input)) {
    try { workspace = workspaceQuery(await readChatgptService("cloud_workspace_settings", {}, identity, signal)); }
    catch { workspace = { isLoading: false, isError: true }; }
    await current();
  }
  let gates: WorkGates = { gate146: null, gate162: null };
  if (projectWorkAccess(input, workspace, gates).missingGates.length) {
    try { gates = bootstrapGates(await shareAccessBootstrap(identity, signal), identity); } catch { /* Unsupported snapshot remains unknown. */ }
    await current();
  }
  const afterRaw = await callAppServer("account/read", { refreshToken: false }); await current();
  if (!object(afterRaw) || !object(afterRaw.account) || afterRaw.account.type !== "chatgpt") throw changed();
  const after = accountInput(afterRaw);
  if (after.accountId !== before.accountId) throw changed();
  const afterInfo = await readWorkAccountInfo(identity, signal); await current();
  if (afterInfo.plan !== info.plan || afterInfo.authMethod !== info.authMethod) throw changed();
  return { identity: { ...identity }, ...projectWorkAccess(input, workspace, gates) };
}

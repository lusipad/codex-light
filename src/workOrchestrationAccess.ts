import { callAppServer } from "./bridge";
import { readChatgptService, readWorkAccountInfo, serviceIdentity, shareAccessBootstrap, type ServiceIdentity, type WorkAccountInfo } from "./chatgptService";
import { isWorkEnterprisePlan } from "./workRunLocation";

export interface CapabilityFlags { isLoading: boolean; isError: boolean; isCapable: boolean }
export interface WorkCapabilityQuery { data: unknown; isLoading: boolean; isError: boolean }
export interface WorkCapabilityAccount {
  authLoading: boolean; authMethod: string | null; accountLoading: boolean; accountInfoError: boolean;
  accountId: string | null; authenticatedAccountId: string | null; plan: string | null;
}
export interface WorkOrchestrationCapabilityInput {
  account: WorkCapabilityAccount; gate306: boolean | null; gate131: boolean | null; gate131Loading: boolean;
  gate368: boolean | null; workspace: WorkCapabilityQuery; config: WorkCapabilityQuery;
}
export interface WorkLockdown { state: "disabled" | "loading" | "enabled"; loaded: boolean; error: boolean }
export interface LocalWorkOrchestration {
  identity: ServiceIdentity; accountInfo: WorkAccountInfo; capability: CapabilityFlags | null;
  lockdown: WorkLockdown; gates: { gate246: boolean | null; gate355: boolean | null }; missingInputs: string[];
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const flags = (isCapable: boolean, isLoading = false, isError = false): CapabilityFlags => ({ isLoading, isError, isCapable });
const permission = "chatgpt.workspace.feature.cloud-orchestration.access";

export function projectWorkOrchestrationPolicy(account: WorkCapabilityAccount, workspace: WorkCapabilityQuery): CapabilityFlags {
  if (account.authLoading && account.authMethod === null || account.authMethod === "chatgpt" && account.accountLoading) return flags(false, true);
  if (account.authMethod !== "chatgpt") return flags(true);
  if (account.accountInfoError) return flags(false, false, true);
  if (account.accountId === null || account.accountId !== account.authenticatedAccountId || account.plan === null) return flags(false);
  if (!isWorkEnterprisePlan(account.plan)) return flags(true);
  const loading = workspace.isLoading || !workspace.isError && workspace.data == null;
  let error = workspace.isError;
  let allowed = false;
  if (workspace.data != null) {
    if (!object(workspace.data)) error = true;
    else {
      const permissions = workspace.data.permissions;
      if (permissions != null && (!Array.isArray(permissions) || permissions.some(item => typeof item !== "string"))) error = true;
      else allowed = Array.isArray(permissions) && permissions.includes(permission);
    }
  }
  return flags(!loading && !error && allowed, loading, error);
}
export function projectWorkFirstParty(config: WorkCapabilityQuery): CapabilityFlags {
  const loading = !config.isError && config.data == null;
  if (config.isError || loading) return flags(false, loading, config.isError);
  if (!object(config.data) || !object(config.data.config)) return flags(false, false, true);
  const raw = config.data.config;
  const profiles = object(raw.profiles) ? raw.profiles : null;
  const profile = typeof raw.profile === "string" && profiles ? profiles[raw.profile] : null;
  const merged = { ...raw };
  if (object(profile)) for (const [key, value] of Object.entries(profile)) if (value != null) merged[key] = value;
  return flags((merged.model_provider ?? "openai") === "openai");
}
export function projectWorkOrchestrationCapability(input: WorkOrchestrationCapabilityInput): { capability: CapabilityFlags | null; missingInputs: string[] } {
  const missingInputs: string[] = [];
  const blocks: CapabilityFlags[] = [];
  if (typeof input.gate306 !== "boolean") missingInputs.push("gate306");
  else blocks.push(input.gate306 ? projectWorkOrchestrationPolicy(input.account, input.workspace) : flags(true));
  if (input.gate131Loading) blocks.push(flags(false, true));
  else if (typeof input.gate131 !== "boolean") missingInputs.push("gate131");
  else blocks.push(flags(input.gate131));
  if (typeof input.gate368 !== "boolean") missingInputs.push("gate368");
  else if (input.gate368) blocks.push(projectWorkFirstParty(input.config));
  return { capability: missingInputs.length ? null : {
    isLoading: blocks.some(block => block.isLoading), isError: blocks.some(block => block.isError), isCapable: blocks.every(block => block.isCapable),
  }, missingInputs };
}
export function projectWorkLockdown(query: WorkCapabilityQuery): WorkLockdown {
  const body = query.data;
  let loaded = false, enabled: boolean | undefined;
  if (object(body) && (body.settings === undefined || object(body.settings))) {
    const value = object(body.settings) ? body.settings.lockdown_mode_enabled : undefined;
    if (value === undefined || typeof value === "boolean") { loaded = true; enabled = value === true; }
  }
  return { state: loaded && enabled === false ? "disabled" : enabled !== true && query.isLoading ? "loading" : "enabled",
    loaded, error: query.isError || !loaded && !query.isLoading };
}

type Gates = { gate306: boolean | null; gate131: boolean | null; gate368: boolean | null; gate246: boolean | null; gate355: boolean | null };
const unknownGates = (): Gates => ({ gate306: null, gate131: null, gate368: null, gate246: null, gate355: null });
function decodeGates(bootstrap: unknown, identity: ServiceIdentity): Gates {
  if (!object(bootstrap) || typeof bootstrap.statsigPayload !== "string") return unknownGates();
  let payload: unknown; try { payload = JSON.parse(bootstrap.statsigPayload); } catch { return unknownGates(); }
  // Supports complete identity-bound snapshots, not live dx subscriptions or delta merging.
  if (!object(payload) || !object(payload.user) || !object(payload.user.customIDs)
    || payload.user.userID !== identity.userId || payload.user.customIDs.account_id !== identity.accountId
    || !object(payload.feature_gates) || payload.has_updates !== true || payload.is_delta === true || payload.isDelta === true
    || payload.live_overlay != null || ![undefined, "init-v1", "init-v2"].includes(payload.response_format as string | undefined)) return unknownGates();
  const entries = payload.feature_gates, format = payload.response_format;
  const gate = (key: string): boolean | null => {
    let hash = 0; for (let i = 0; i < key.length; i++) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0;
    const entry = entries[key] ?? entries[String(hash)], value = object(entry) ? entry[format === "init-v2" ? "v" : "value"] : undefined;
    return typeof value === "boolean" ? value : null;
  };
  return { gate306: gate("3063076119"), gate131: gate("1315865107"), gate368: gate("3683713372"), gate246: gate("2465577016"), gate355: gate("3559027740") };
}
const changed = () => Object.assign(Error("读取期间 Work 能力账号、认证或套餐发生变化。"), { code: "account_changed" });
function accountRoute(raw: unknown): string {
  if (!object(raw) || !object(raw.account) || raw.account.type !== "chatgpt") throw Object.assign(Error("当前能力读取不支持此认证方式。"), { code: "unsupported_auth" });
  if (!object(raw.workspaceRouting) || typeof raw.workspaceRouting.chatgptAccountId !== "string" || !raw.workspaceRouting.chatgptAccountId) throw changed();
  return raw.workspaceRouting.chatgptAccountId;
}
const unread = (): WorkCapabilityQuery => ({ data: undefined, isLoading: false, isError: false });
export async function readLocalWorkOrchestration(signal: AbortSignal): Promise<LocalWorkOrchestration> {
  signal.throwIfAborted();
  const route = accountRoute(await callAppServer("account/read", { refreshToken: false })); signal.throwIfAborted();
  const identity = await serviceIdentity(signal); signal.throwIfAborted();
  if (typeof identity?.userId !== "string" || !identity.userId || identity.accountId !== route || !Number.isSafeInteger(identity.generation) || identity.generation < 0) throw changed();
  const current = async () => {
    signal.throwIfAborted(); const actual = await serviceIdentity(signal); signal.throwIfAborted();
    if (actual.accountId !== identity.accountId || actual.userId !== identity.userId || actual.generation !== identity.generation) throw changed();
  };
  const accountInfo = await readWorkAccountInfo(identity, signal); await current();
  let gates = unknownGates();
  try { gates = decodeGates(await shareAccessBootstrap(identity, signal), identity); } catch { /* Missing snapshot is not false permission. */ }
  await current();
  const account: WorkCapabilityAccount = { authLoading: false, authMethod: accountInfo.authMethod, accountLoading: false, accountInfoError: false,
    accountId: identity.accountId, authenticatedAccountId: identity.accountId, plan: accountInfo.plan };
  let workspace = unread(), config = unread(), lockdown = unread();
  if (gates.gate306 === true && accountInfo.authMethod === "chatgpt" && isWorkEnterprisePlan(accountInfo.plan)) {
    try { workspace = { data: await readChatgptService("cloud_workspace_settings", {}, identity, signal), isLoading: false, isError: false }; }
    catch { workspace = { data: undefined, isLoading: false, isError: true }; }
    await current();
  }
  if (gates.gate368 === true) {
    try {
      const raw = await callAppServer("config/read", { includeLayers: true, cwd: null });
      config = { data: raw, isLoading: false, isError: !object(raw) || !object(raw.config) };
    } catch { config = { data: undefined, isLoading: false, isError: true }; }
    await current();
  }
  try { lockdown = { data: await readChatgptService("library_settings", {}, identity, signal), isLoading: false, isError: false }; }
  catch { lockdown = { data: undefined, isLoading: false, isError: true }; }
  await current();
  const afterRaw = await callAppServer("account/read", { refreshToken: false }); await current();
  if (!object(afterRaw) || !object(afterRaw.account) || afterRaw.account.type !== "chatgpt" || accountRoute(afterRaw) !== route) throw changed();
  const after = await readWorkAccountInfo(identity, signal); await current();
  if (after.plan !== accountInfo.plan || after.authMethod !== accountInfo.authMethod) throw changed();
  const projected = projectWorkOrchestrationCapability({ account, ...gates, gate131Loading: false, workspace, config });
  const missingInputs = [...projected.missingInputs];
  if (gates.gate246 === null) missingInputs.push("gate246");
  if (gates.gate355 === null) missingInputs.push("gate355");
  const state = projectWorkLockdown(lockdown);
  if (!state.loaded) missingInputs.push("lockdown");
  return { identity: { ...identity }, accountInfo, capability: projected.capability, lockdown: state,
    gates: { gate246: gates.gate246, gate355: gates.gate355 }, missingInputs };
}

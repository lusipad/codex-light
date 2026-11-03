import { configBatchWrite, configRead } from "./config";
import type { ConfigReadResult } from "./config";
import { errorDetail, listInstalledPlugins, listSkills, removeMarketplace, uninstallPlugin } from "./plugins";
import type { PluginMarketplaceEntry, PluginSummary } from "./plugins";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : null;
// Fixed Store aJn/iJn mapper; this metadata is computed, not a plugin/installed RPC field.
const builtInMarketplaces = new Set(["codex-official", "openai-bundled", "openai-curated", "openai-curated-remote", "openai-primary-runtime"]);
export function isBuiltInMarketplaceName(name: string): boolean {
  return builtInMarketplaces.has(name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
}
export interface PluginManagementContext { cwd?: string; hostId?: string; isCurrent?: () => boolean; expectedFilePath?: string }
export interface PluginEnabledResult {
  plugin: PluginSummary | null;
  verification: "confirmed" | "pending" | "rejected";
  refreshError: string | null;
  error: string | null;
  stale: boolean;
  configFilePath: string | null;
}
export interface ConfiguredMarketplace {
  marketplace: PluginMarketplaceEntry;
  sourceType: string | null;
  sourceIdentity: string;
  canUpgrade: boolean;
  readOnlyReason: string | null;
}
export interface MarketplaceRemovalPlan {
  marketplace: PluginMarketplaceEntry;
  sourceIdentity: string;
  plugins: PluginSummary[];
  completedIds: string[];
  removePending: boolean;
  pendingPluginId: string | null;
  removed: boolean;
  error: string | null;
}
export interface MarketplaceRemovalOptions {
  cwds?: string[];
  isCurrent?: () => boolean;
  onProgress?: (plan: MarketplaceRemovalPlan) => void;
}
function userLayer(snapshot: ConfigReadResult) {
  return (snapshot.layers ?? []).map(object).filter((layer): layer is ObjectValue => {
    const name = object(layer?.name);
    return !!layer && name?.type === "user" && !name.profile && !layer.disabledReason && typeof name.file === "string" && typeof layer.version === "string" && !!object(layer.config);
  }).at(-1);
}
function foreignOrigin(snapshot: ConfigReadResult, root: string, name: string): boolean {
  const names = [...new Set([...Object.keys(object(snapshot.config[root]) ?? {}), name])].sort((left, right) => right.length - left.length);
  return Object.entries(snapshot.origins).some(([key, origin]) => {
    const owner = names.find(candidate => key === `${root}.${candidate}` || key.startsWith(`${root}.${candidate}.`));
    return (key === root || owner === name) && origin.name.type !== "user";
  });
}
const current = (context: { isCurrent?: () => boolean }) => context.isCurrent?.() !== false;
const cwds = (cwd?: string) => cwd ? [cwd] : undefined;
function knownConfigRejection(error: unknown): boolean {
  const raw = object(error);
  if (raw?.cause && knownConfigRejection(raw.cause)) return true;
  const message = errorDetail(error);
  return message === "Configuration was modified since last read. Fetch latest version and retry." || message === "Only writes to the user config are allowed";
}
export async function setPluginEnabled(plugin: PluginSummary, enabled: boolean, context: PluginManagementContext = {}): Promise<PluginEnabledResult> {
  const result: PluginEnabledResult = { plugin: null, verification: "rejected", refreshError: null, error: null, stale: false, configFilePath: null };
  const stale = () => ({ ...result, stale: true, error: "操作上下文已改变，请重新读取插件状态" });
  if ((context.hostId && context.hostId !== "local") || plugin.source.type === "remote") return { ...result, error: "远程插件需要对应服务启禁，本地配置不能替代远程操作" };
  if (!plugin.installed) return { ...result, error: "插件尚未安装" };
  if (plugin.availability === "DISABLED_BY_ADMIN") return { ...result, error: "管理员已禁用此插件" };
  let before: ConfigReadResult;
  try { before = await configRead(context.cwd, true); }
  catch (error) { return { ...result, error: errorDetail(error) }; }
  if (!current(context)) return stale();
  const user = userLayer(before);
  if (!user || foreignOrigin(before, "plugins", plugin.id)) return { ...result, error: "插件配置不属于可写的用户配置层" };
  result.configFilePath = object(user.name)!.file as string;
  let writeError: unknown = null;
  try {
    await configBatchWrite([{ keyPath: `plugins.${JSON.stringify(plugin.id)}.enabled`, value: enabled, mergeStrategy: "upsert" }], {
      filePath: object(user.name)!.file as string, expectedVersion: user.version as string, reloadUserConfig: true,
    });
  } catch (error) { writeError = error; }
  result.verification = "pending";
  if (!current(context)) return stale();
  const verified = await verifyPluginEnabled(plugin, enabled, { ...context, expectedFilePath: result.configFilePath });
  if (writeError && knownConfigRejection(writeError)) return { ...verified, verification: "rejected", error: errorDetail(writeError) };
  if (writeError && verified.verification === "pending") verified.error = `${verified.error ?? "插件启禁结果未确认"}：${errorDetail(writeError)}`;
  return verified;
}
/** Read-only recovery after uncertain delivery; this function never submits a config mutation. */
export async function verifyPluginEnabled(plugin: PluginSummary, enabled: boolean, context: PluginManagementContext = {}): Promise<PluginEnabledResult> {
  const result: PluginEnabledResult = { plugin: null, verification: "pending", refreshError: null, error: null, stale: false, configFilePath: context.expectedFilePath ?? null };
  const stale = () => ({ ...result, stale: true, error: "操作上下文已改变，请重新读取插件状态" });
  if ((context.hostId && context.hostId !== "local") || plugin.source.type === "remote") return { ...result, error: "远程插件需要对应服务确认，本地配置不能替代远程结果" };
  if (!current(context)) return stale();
  try {
    const [after, installed] = await Promise.all([configRead(context.cwd, true), listInstalledPlugins(cwds(context.cwd))]);
    if (!current(context)) return stale();
    result.plugin = installed.marketplaces.flatMap(market => market.plugins).find(item => item.id === plugin.id) ?? null;
    const layer = userLayer(after);
    const filePath = object(layer?.name)?.file;
    if (!layer || (context.expectedFilePath && filePath !== context.expectedFilePath)) return { ...result, error: "用户配置层已经改变，无法确认原写入目标" };
    result.configFilePath = filePath as string;
    const local = object(layer.config);
    const localEnabled = object(object(local?.plugins)?.[plugin.id])?.enabled;
    const effectiveEnabled = object(object(after.config.plugins)?.[plugin.id])?.enabled;
    if (localEnabled !== enabled || effectiveEnabled !== enabled || result.plugin?.enabled !== enabled || !result.plugin.installed || foreignOrigin(after, "plugins", plugin.id)) {
      result.error = "插件启禁结果未确认或被其他来源覆盖，请先刷新状态"; return result;
    }
    result.verification = "confirmed";
    try {
      const skills = await listSkills(cwds(context.cwd), true);
      if (!current(context)) return stale();
      const errors = skills.data.flatMap(entry => entry.errors);
      if (errors.length) result.refreshError = "插件已改变，但技能刷新存在错误；请重新加载技能";
    } catch (error) { result.refreshError = `插件已改变，但技能无法刷新：${errorDetail(error)}`; }
    return current(context) ? result : stale();
  } catch (error) { return { ...result, error: `无法确认插件启禁结果：${errorDetail(error)}` }; }
}

export async function readConfiguredMarketplaces(roots?: string[]): Promise<ConfiguredMarketplace[]> {
  const [snapshot, installed] = await Promise.all([configRead(roots?.[0], true), listInstalledPlugins(roots)]);
  const configured = object(snapshot.config.marketplaces) ?? {};
  return Object.keys(configured).map(name => {
    const marketplace = installed.marketplaces.find(market => market.name === name) ?? { name, plugins: [] };
    const definition = object(configured[name]);
    const sourceType = typeof definition?.source_type === "string" ? definition.source_type : null;
    const loadError = installed.marketplaceLoadErrors?.find(error => error.marketplacePath === marketplace.path);
    let readOnlyReason: string | null = null;
    if (isBuiltInMarketplaceName(marketplace.name)) readOnlyReason = "内置市场不能移除";
    else if (!userLayer(snapshot)) readOnlyReason = "未找到可写的用户配置层";
    else if (foreignOrigin(snapshot, "marketplaces", name)) readOnlyReason = "此市场来自非用户配置，请在原始来源修改";
    else if (loadError) readOnlyReason = `市场读取失败：${loadError.message}`;
    else if (!marketplace.path) readOnlyReason = "尚未确认本地市场路径，请刷新目录";
    return { marketplace, sourceType, sourceIdentity: JSON.stringify([definition?.source_type ?? null, definition?.source ?? null]), canUpgrade: !readOnlyReason && sourceType === "git" && typeof definition?.source === "string" && definition.source.length > 0, readOnlyReason };
  }).filter(item => !isBuiltInMarketplaceName(item.marketplace.name));
}
function marketPlugins(response: Awaited<ReturnType<typeof listInstalledPlugins>>, market: PluginMarketplaceEntry): PluginSummary[] {
  const errors = response.marketplaceLoadErrors ?? [];
  // Without a matching market entry, an unassigned load error cannot safely be treated as empty.
  const matches = response.marketplaces.filter(item => item.name === market.name);
  if (matches.some(item => item.path !== market.path)) throw Error("同名市场的来源路径已经改变，请重新检查");
  const paths = new Set([market.path, ...matches.map(item => item.path)].filter(Boolean));
  const error = errors.find(item => paths.has(item.marketplacePath)) ?? (!matches.length ? errors[0] : undefined);
  if (error) throw Error(`无法完整读取市场插件：${error.message}`);
  return [...new Map(matches.flatMap(item => item.plugins).filter(plugin => plugin.installed).map(plugin => [plugin.id, plugin])).values()];
}
function checkUninstallPolicy(plugins: PluginSummary[]) {
  const blocked = plugins.find(plugin => plugin.source.type === "remote");
  if (blocked) throw Error(`无法移除此市场：${blocked.name} ${blocked.installed && blocked.installPolicy === "INSTALLED_BY_DEFAULT" ? "受远程管理员默认安装策略保护" : "需要远程服务卸载"}`);
}
export async function prepareMarketplaceRemoval(market: PluginMarketplaceEntry, roots?: string[]): Promise<MarketplaceRemovalPlan> {
  const configured = await readConfiguredMarketplaces(roots);
  const target = configured.find(item => item.marketplace.name === market.name);
  if (!target || target.readOnlyReason) throw Error(target?.readOnlyReason ?? "市场不是可移除的已配置本地来源");
  const plugins = marketPlugins(await listInstalledPlugins(roots), target.marketplace);
  checkUninstallPolicy(plugins);
  return { marketplace: target.marketplace, sourceIdentity: target.sourceIdentity, plugins, completedIds: [], removePending: false, pendingPluginId: null, removed: false, error: null };
}
function sameMarketplace(target: ConfiguredMarketplace, plan: MarketplaceRemovalPlan): boolean {
  return target.marketplace.name === plan.marketplace.name && target.marketplace.path === plan.marketplace.path && target.sourceIdentity === plan.sourceIdentity;
}
export async function runMarketplaceRemoval(before: MarketplaceRemovalPlan, options: MarketplaceRemovalOptions = {}): Promise<MarketplaceRemovalPlan> {
  const plan: MarketplaceRemovalPlan = { ...before, plugins: [...before.plugins], completedIds: [...before.completedIds], error: null };
  const progress = () => { options.onProgress?.({ ...plan, plugins: [...plan.plugins], completedIds: [...plan.completedIds] }); };
  try {
    if (!current(options) || plan.removed) return plan;
    const sources = await readConfiguredMarketplaces(options.cwds);
    if (!current(options)) return plan;
    const source = sources.find(item => item.marketplace.name === plan.marketplace.name);
    if (source && !sameMarketplace(source, plan)) throw Error("同名市场的配置来源已经改变，请重新检查");
    if (!source && !plan.removePending) throw Error("市场配置已经改变，请刷新确认");
    const state = await listInstalledPlugins(options.cwds);
    if (!current(options)) return plan;
    const remaining = marketPlugins(state, plan.marketplace);
    checkUninstallPolicy(remaining);
    const remainingIds = new Set(remaining.map(plugin => plugin.id));
    plan.completedIds = plan.completedIds.filter(id => !remainingIds.has(id));
    for (const plugin of plan.plugins) if (!remainingIds.has(plugin.id) && !plan.completedIds.includes(plugin.id)) plan.completedIds.push(plugin.id);
    if (plan.pendingPluginId && remainingIds.has(plan.pendingPluginId)) throw Error("上次卸载送达状态未知，请先刷新确认；不会自动重复卸载");
    plan.pendingPluginId = null;
    if (plan.removePending) {
      const configured = await readConfiguredMarketplaces(options.cwds);
      if (!current(options)) return plan;
      if (!configured.some(item => item.marketplace.name === plan.marketplace.name) && !remaining.length) { plan.removed = true; progress(); return plan; }
      throw Error("上次市场移除结果尚未确认，请刷新核对；不会自动重复移除");
    }
    // Include newly discovered plugins in a retried plan, with policy checked before any mutation.
    plan.plugins = [...new Map([...plan.plugins, ...remaining].map(plugin => [plugin.id, plugin])).values()];
    progress();
    for (const plugin of remaining) {
      if (!current(options)) return plan;
      const liveSource = (await readConfiguredMarketplaces(options.cwds)).find(item => item.marketplace.name === plan.marketplace.name);
      if (!current(options)) return plan;
      if (!liveSource || !sameMarketplace(liveSource, plan) || liveSource.readOnlyReason) throw Error("市场配置来源或权限已经改变，请重新检查");
      let failure: unknown = null;
      try { await uninstallPlugin(plugin.id); } catch (error) { failure = error; }
      // Even after close, record delivery uncertainty; the next explicit attempt only reads it.
      plan.pendingPluginId = plugin.id;
      if (!current(options)) { progress(); return plan; }
      const readback = marketPlugins(await listInstalledPlugins(options.cwds), plan.marketplace);
      if (!current(options)) { progress(); return plan; }
      if (readback.some(item => item.id === plugin.id)) {
        if (failure && ["forbidden", "invalid-request"].includes(String(object(failure)?.kind))) plan.pendingPluginId = null;
        throw Error(failure ? errorDetail(failure) : "卸载已返回，但插件仍在已安装列表，请刷新确认");
      }
      plan.pendingPluginId = null;
      if (!plan.completedIds.includes(plugin.id)) plan.completedIds.push(plugin.id);
      progress();
    }
    if (!current(options)) return plan;
    const finalPlugins = marketPlugins(await listInstalledPlugins(options.cwds), plan.marketplace);
    if (!current(options)) return plan;
    if (finalPlugins.length) throw Error("市场出现新的已安装插件，请重新检查后重试移除");
    const configured = await readConfiguredMarketplaces(options.cwds);
    if (!current(options)) return plan;
    const target = configured.find(item => item.marketplace.name === plan.marketplace.name);
    if (!target || target.readOnlyReason) throw Error(target?.readOnlyReason ?? "市场配置已经改变，请刷新确认");
    if (!sameMarketplace(target, plan)) throw Error("同名市场的配置来源已经改变，请重新检查");
    if (target.marketplace.plugins.some(plugin => plugin.installed)) throw Error("最新市场库存出现已安装插件，请重新检查后重试移除");
    plan.removePending = true;
    let removeError: unknown = null;
    try { await removeMarketplace(plan.marketplace.name); } catch (error) { removeError = error; }
    if (!current(options)) { progress(); return plan; }
    const [after, installed] = await Promise.all([readConfiguredMarketplaces(options.cwds), listInstalledPlugins(options.cwds)]);
    if (!current(options)) { progress(); return plan; }
    if (after.some(item => item.marketplace.name === plan.marketplace.name) || marketPlugins(installed, plan.marketplace).length) {
      if (removeError && ["forbidden", "invalid-request"].includes(String(object(removeError)?.kind))) plan.removePending = false;
      throw Error(removeError ? errorDetail(removeError) : "市场移除结果未确认，请刷新核对");
    }
    plan.removed = true; plan.removePending = false; progress();
  } catch (error) { plan.error = errorDetail(error); progress(); }
  return plan;
}

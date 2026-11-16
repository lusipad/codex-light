import type { ServiceIdentity } from "./chatgptService";
import { pluginRefFor, type PluginAuthPolicy, type PluginInstallResponse, type PluginInstalledResponse, type PluginRef, type PluginSummary } from "./plugins";

export interface PluginPreparationFlow {
  requestId: string;
  reference: PluginRef;
  pluginId: string;
  hostId: string;
  connectionIdentity: string;
  workspace: string;
  context: number;
  detailRequest: number;
  view: object;
  identity: ServiceIdentity | null;
  result: PluginInstallResponse;
  prompt: string | null;
  confirmed: boolean;
  browserPreparationRequired: boolean;
  completed: boolean;
  consumed: boolean;
  controller: AbortController;
  checking: Promise<string> | null;
}

export function isBrowserPreparationCandidate(plugin: PluginSummary, policy: PluginAuthPolicy): boolean {
  return policy === "ON_INSTALL" && ["browser", "chrome", "chrome-dev", "chrome-internal"].includes(plugin.name) &&
    plugin.id.startsWith(`${plugin.name}@`);
}

export function pluginRequiresBrowserPreparation(plugin: PluginSummary, policy: PluginAuthPolicy): boolean {
  return plugin.source.type === "local" && isBrowserPreparationCandidate(plugin, policy);
}

export function preparationMatchesReference(flow: PluginPreparationFlow, reference: PluginRef): boolean {
  return reference.pluginName === flow.reference.pluginName &&
    reference.marketplacePath === flow.reference.marketplacePath &&
    reference.remoteMarketplaceName === flow.reference.remoteMarketplaceName;
}

export function preparationInstalledPlugin(flow: PluginPreparationFlow, inventory: PluginInstalledResponse): PluginSummary | null {
  if (inventory.marketplaceLoadErrors?.length) return null;
  for (const marketplace of inventory.marketplaces) for (const plugin of marketplace.plugins) {
    if (plugin.id !== flow.pluginId || !plugin.installed) continue;
    const reference = pluginRefFor(plugin, marketplace);
    if (preparationMatchesReference(flow, reference)) return plugin;
  }
  return null;
}

// Explicit manual verification of the installation ACK's required apps. This does
// not replace original install options or claim native OAuth callback ownership.
export function finishPluginPreparation(flow: PluginPreparationFlow, dependencies: {
  isCurrent: () => boolean;
  readRequiredApp: (id: string, identity: ServiceIdentity, signal: AbortSignal) => Promise<{ kind: "ready" | "needsAuth" | "unavailable" }>;
  readInventory: () => Promise<PluginInstalledResponse | undefined>;
  readIdentity: (signal: AbortSignal) => Promise<ServiceIdentity>;
  deliver?: (plugin: PluginSummary, prompt: string, guard: { isCurrent: () => boolean }) => boolean | Promise<boolean>;
}): Promise<string> {
  if (flow.checking) return flow.checking;
  const current = () => !flow.controller.signal.aborted && dependencies.isCurrent();
  const operation = (async () => {
    if (!current()) throw new Error("原安装请求已失效，请从当前插件重新操作。");
    if (flow.consumed) return "原插件草稿已恢复。";
    flow.completed = false;
    if (!flow.confirmed) throw new Error("安装结果尚未确认，请先刷新安装状态。");
    if (!flow.identity) throw new Error("无法确认安装时的原账号，连接准备仍未完成。请从当前插件重新操作。");
    const readCurrentPlugin = async () => {
      const inventory = await dependencies.readInventory();
      if (!current()) throw new Error("原安装请求已失效，请从当前插件重新操作。");
      const plugin = inventory && preparationInstalledPlugin(flow, inventory);
      if (!plugin?.enabled || plugin.availability === "DISABLED_BY_ADMIN" || plugin.installPolicy === "NOT_AVAILABLE") {
        throw new Error(`原来源插件的安装或启用状态未确认。${flow.prompt ? "原草稿已保留。" : ""}`);
      }
      flow.browserPreparationRequired = pluginRequiresBrowserPreparation(plugin, flow.result.authPolicy);
      if (flow.browserPreparationRequired) throw new Error("此插件还需要浏览器扩展准备，当前尚未确认。");
      return plugin;
    };
    await readCurrentPlugin();
    for (const app of flow.result.appsNeedingAuth) {
      const result = await dependencies.readRequiredApp(app.id, flow.identity, flow.controller.signal);
      if (!current()) throw new Error("原安装请求已失效，请从当前插件重新操作。");
      if (result.kind === "needsAuth") return `${app.name} 仍需连接。${flow.prompt ? "原草稿已保留。" : ""}`;
      if (result.kind !== "ready") throw new Error("未能完成连接设置。请重试");
    }
    const plugin = await readCurrentPlugin();
    const identity = await dependencies.readIdentity(flow.controller.signal);
    if (!current() || identity.accountId !== flow.identity.accountId || identity.userId !== flow.identity.userId || identity.generation !== flow.identity.generation) {
      throw new Error("安装账号已变化，未恢复原草稿。");
    }
    if (flow.prompt) {
      if (!dependencies.deliver) throw new Error("此入口无法恢复原插件草稿。");
      let handoffActive = true;
      let accepted: boolean;
      try { accepted = await dependencies.deliver(plugin, flow.prompt, { isCurrent: () => handoffActive && current() }); }
      finally { handoffActive = false; }
      // The accepted handoff navigates away and may unmount the origin page.
      if (!accepted) return "原插件草稿已保留，请完成当前页面的操作后重试。";
      flow.consumed = true;
    }
    flow.completed = true;
    return flow.consumed ? "连接已确认，原插件草稿已恢复。" : "连接已确认。";
  })();
  flow.checking = operation;
  void operation.finally(() => { if (flow.checking === operation) flow.checking = null; }).catch(() => {});
  return operation;
}

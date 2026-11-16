import { accountRead, experimentalFeatureListAll } from "./config";
import { readRemotePluginDirectoryHome, readRemotePluginDirectoryCategory, serviceIdentity, type ServiceIdentity } from "./chatgptService";
import { directoryPluginInstallation, parsePluginDirectorySections, remotePluginDirectoryEnabled, type PluginDirectorySection } from "./pluginDirectory";
import { readPlugin, type PluginDetail } from "./plugins";

export type PluginDirectorySource =
  | { kind: "local" | "unresolved" | "requires-chatgpt" }
  | { kind: "remote"; identity: ServiceIdentity; sections: PluginDirectorySection[] };

export async function loadPluginDirectorySource(signal: AbortSignal): Promise<PluginDirectorySource> {
  const current = () => { if (signal.aborted) throw Error("请求已取消"); };
  current();
  const enabled = remotePluginDirectoryEnabled(await experimentalFeatureListAll());
  current();
  if (enabled === undefined) return { kind: "unresolved" };
  if (!enabled) return { kind: "local" };
  const account = await accountRead();
  current();
  if (account.account?.type !== "chatgpt") return { kind: "requires-chatgpt" };
  const identity = await serviceIdentity(signal);
  current();
  if (account.workspaceRouting?.chatgptAccountId && account.workspaceRouting.chatgptAccountId !== identity.accountId) {
    throw Error("读取期间账号发生变化，请重新刷新。");
  }
  const sections = parsePluginDirectorySections(await readRemotePluginDirectoryHome(identity, signal));
  current();
  const [after, actual] = await Promise.all([accountRead(), serviceIdentity(signal)]);
  current();
  if (after.account?.type !== "chatgpt" || identity.accountId !== actual.accountId ||
      identity.userId !== actual.userId || identity.generation !== actual.generation ||
      (after.workspaceRouting?.chatgptAccountId && after.workspaceRouting.chatgptAccountId !== actual.accountId)) {
    throw Error("读取期间账号发生变化，请重新刷新。");
  }
  return { kind: "remote", identity, sections };
}

export async function readLocalDirectoryListing(pluginId: string): Promise<PluginDetail> {
  if (!pluginId.trim()) throw Error("插件缺少远端身份，请重新读取。");
  const detail = await readPlugin({ pluginName: pluginId, remoteMarketplaceName: "chatgpt-workspace" });
  const summary = detail.summary;
  if (!summary || typeof detail.marketplaceName !== "string" || !detail.marketplaceName.trim() ||
      (detail.marketplacePath != null && typeof detail.marketplacePath !== "string") ||
      typeof summary.id !== "string" || typeof summary.name !== "string" || !summary.name.trim() ||
      typeof summary.installed !== "boolean" || !["NOT_AVAILABLE", "AVAILABLE", "INSTALLED_BY_DEFAULT"].includes(summary.installPolicy)) {
    throw Error("无法确认插件详情和安装来源，请重新读取。");
  }
  const match = directoryPluginInstallation(pluginId, { marketplaces: [{ name: detail.marketplaceName, plugins: [summary] }] });
  if (!match.plugin) throw Error("插件详情身份与目录不一致，请重新读取。");
  return detail;
}

export async function loadPluginDirectoryCategory(
  identity: ServiceIdentity, slug: string, query: string, cursor: string | null, signal: AbortSignal,
) {
  const page = await readRemotePluginDirectoryCategory(identity, slug, query, cursor, signal);
  const plugins = parsePluginDirectorySections([{ id: slug, plugins: page.plugins }])[0].plugins;
  return { plugins, nextCursor: page.nextCursor };
}

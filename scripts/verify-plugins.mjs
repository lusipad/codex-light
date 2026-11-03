import assert from "node:assert/strict";
import fs from "node:fs";

// 1. 检查 plugins.ts
const pluginsSource = fs.readFileSync(
  new URL("../src/plugins.ts", import.meta.url),
  "utf8"
);

// 2. 检查 SkillsMcpView.tsx
const viewSource = fs.readFileSync(
  new URL("../src/components/SkillsMcpView.tsx", import.meta.url),
  "utf8"
);

// P01: 浏览目录不强制裁掉远程能力；协议形状另由生产封装回归覆盖。
const supportsServerCatalog = pluginsSource.includes('export async function listMarketplacePlugins') &&
  !pluginsSource.includes('marketplaceKinds: ["local"]');

// P02: 检查核心协议封装
const hasPluginMethods =
  pluginsSource.includes('"plugin/installed"') &&
  pluginsSource.includes('"plugin/list"') &&
  pluginsSource.includes('"plugin/read"') &&
  pluginsSource.includes('"plugin/install"') &&
  pluginsSource.includes('"plugin/uninstall"') &&
  pluginsSource.includes('"marketplace/add"') &&
  pluginsSource.includes('"marketplace/remove"') &&
  pluginsSource.includes('"marketplace/upgrade"');

// P03: 检查 SkillsMcpView 是否支持打开本地插件所在目录 (reveal_path_in_explorer)
const hasRevealPluginPath =
  viewSource.includes("reveal_path_in_explorer") &&
  viewSource.includes("pluginSourceDetail");

assert.ok(
  supportsServerCatalog,
  "plugins.ts: Browse must preserve server-enabled remote catalog capabilities"
);
assert.ok(
  hasPluginMethods,
  "plugins.ts: Must export complete plugin and marketplace protocol RPCs"
);
assert.ok(
  hasRevealPluginPath,
  "SkillsMcpView.tsx: Must provide reveal_path_in_explorer for local plugins"
);

console.log("ALL PLUGINS VERIFICATIONS PASSED!");

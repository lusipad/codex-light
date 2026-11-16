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

// P03: 当前官方管理详情将真实来源放在 About；不要求旧列表额外的“目录”按钮。
// 执行真实展示组件回归，核对 local/git/npm/remote 来源、缺失字段及链接边界。
await import("./verify-plugin-management-detail-surface.mjs");

assert.ok(
  supportsServerCatalog,
  "plugins.ts: Browse must preserve server-enabled remote catalog capabilities"
);
assert.ok(
  hasPluginMethods,
  "plugins.ts: Must export complete plugin and marketplace protocol RPCs"
);
assert.ok(
  viewSource.includes("<PluginManagementDetail"),
  "SkillsMcpView.tsx: management must use the source-backed detail surface"
);

console.log("ALL PLUGINS VERIFICATIONS PASSED!");

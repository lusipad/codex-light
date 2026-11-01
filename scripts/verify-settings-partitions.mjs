import assert from "node:assert/strict";
import fs from "node:fs";

// 1. 检查 types.ts
const typesSource = fs.readFileSync(
  new URL("../src/types.ts", import.meta.url),
  "utf8"
);

// 2. 检查 SettingsView.tsx
const viewSource = fs.readFileSync(
  new URL("../src/components/SettingsView.tsx", import.meta.url),
  "utf8"
);

// 3. 检查 config.ts
const configSource = fs.readFileSync(
  new URL("../src/config.ts", import.meta.url),
  "utf8"
);

const EXPECTED_26_SLUGS = [
  "general-settings",
  "import",
  "appearance",
  "archived-chats",
  "voice",
  "storage",
  "agent",
  "personalization",
  "pets",
  "keyboard-shortcuts",
  "notifications",
  "plugins-settings",
  "hooks-settings",
  "connections",
  "git-settings",
  "local-environments",
  "worktrees",
  "providers-models",
  "experimental",
  "account",
  "code-review",
  "computer-use",
  "appshots",
  "browser-use",
  "cloud-settings",
  "profile",
];

// ST01: 检查 types.ts 包含全部 26 个分区 slug
for (const slug of EXPECTED_26_SLUGS) {
  assert.ok(
    typesSource.includes(`"${slug}"`),
    `types.ts SettingsSectionSlug must include "${slug}"`
  );
}

// ST02: 检查 SettingsView.tsx 侧边导航完整定义了全部 26 个分区
for (const slug of EXPECTED_26_SLUGS) {
  assert.ok(
    viewSource.includes(`slug: "${slug}"`),
    `SettingsView.tsx SETTINGS_NAV_GROUPS must define slug: "${slug}"`
  );
}

// ST03: 检查 config.ts 中的核心协议 RPC 封装
assert.ok(
  configSource.includes('"config/read"') &&
    configSource.includes('"config/batchWrite"') &&
    configSource.includes('"configRequirements/read"') &&
    configSource.includes('"experimentalFeature/list"') &&
    configSource.includes('"experimentalFeature/enablement/set"'),
  "config.ts: Must export complete config/* and experimentalFeature/* RPC clients"
);

// ST04: 检查 SettingsView.tsx 接线与本地持久化
assert.ok(
  viewSource.includes("configRead") &&
    viewSource.includes("experimentalFeatureList") &&
    viewSource.includes("desktop_state_get") &&
    viewSource.includes("desktop_state_set"),
  "SettingsView.tsx: Must wire configRead, experimentalFeatureList, and desktop_state_set"
);

console.log(`ALL 26 SETTINGS PARTITIONS VERIFICATIONS PASSED!`);

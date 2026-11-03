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
  "usage",
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

// ST02: 旧 providers-models 仅保留路由别名，不应继续显示无官方依据的导航入口
for (const slug of EXPECTED_26_SLUGS.filter(slug => slug !== "providers-models" && slug !== "experimental")) {
  assert.ok(
    viewSource.includes(`slug: "${slug}"`),
    `SettingsView.tsx SETTINGS_NAV_GROUPS must define slug: "${slug}"`
  );
}

assert.ok(!viewSource.includes('slug: "providers-models"'), 'unsupported providers page must not be in navigation');
assert.ok(viewSource.includes('initialSection === "providers-models" ? "agent" : initialSection'), 'legacy entry routes to agent');

// ST03: 检查 config.ts 中的核心协议 RPC 封装
assert.ok(
  configSource.includes('"config/read"') &&
    configSource.includes('"config/batchWrite"') &&
    configSource.includes('"configRequirements/read"') &&
    configSource.includes('"experimentalFeature/list"') &&
    configSource.includes('"experimentalFeature/enablement/set"'),
  "config.ts: Must export complete config/* and experimentalFeature/* RPC clients"
);

// ST04: Dedicated settings own persistence; the wrapper must not batch-write unrelated config.
assert.ok(
  viewSource.includes("<AgentSettings") &&
    viewSource.includes('<ExperimentalFeatures connected={appServerStatus.connected} />') &&
    !viewSource.includes("handleSaveVisual") && !viewSource.includes("desktopPreferences"),
  "SettingsView delegates config and desktop persistence to the real dedicated consumers"
);

console.log(`PASS settings route compatibility, ${EXPECTED_26_SLUGS.filter(slug => slug !== "providers-models" && slug !== "experimental").length} current navigation entries and protocol wiring (not full page acceptance)`);

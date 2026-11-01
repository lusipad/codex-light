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

// SK01: 检查技能列表读取与启停协议
const hasSkillsList = pluginsSource.includes('"skills/list"');
const hasSkillConfigWrite = pluginsSource.includes('"skills/config/write"');

// SK02: 检查 SkillsMcpView 技能启停开关
const hasSkillToggle =
  viewSource.includes("writeSkillEnabled") &&
  viewSource.includes("handleToggleSkill");

// SK03: 检查 SkillsMcpView 技能目录打开 (reveal_path_in_explorer + 打开目录)
const hasSkillRevealDir =
  viewSource.includes("reveal_path_in_explorer") &&
  viewSource.includes("打开目录");

// SK04: 检查技能创建与保存
const hasSkillSave =
  viewSource.includes("skill_save_or_install") &&
  viewSource.includes("handleSaveSkill");

assert.ok(
  hasSkillsList && hasSkillConfigWrite,
  "plugins.ts: Must support 'skills/list' and 'skills/config/write'"
);
assert.ok(
  hasSkillToggle,
  "SkillsMcpView.tsx: Must provide handleToggleSkill via writeSkillEnabled"
);
assert.ok(
  hasSkillRevealDir,
  "SkillsMcpView.tsx: Must provide folder open button (reveal_path_in_explorer) for skills"
);
assert.ok(
  hasSkillSave,
  "SkillsMcpView.tsx: Must support creating and saving custom skills"
);

console.log("ALL SKILLS VERIFICATIONS PASSED!");

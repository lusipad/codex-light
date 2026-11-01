import assert from "node:assert/strict";
import fs from "node:fs";

// 1. 检查 App.tsx
const appSource = fs.readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8"
);

// 2. 检查 CodeReviewView.tsx
const viewSource = fs.readFileSync(
  new URL("../src/components/CodeReviewView.tsx", import.meta.url),
  "utf8"
);

// 3. 检查 shortcuts.ts
const shortcutsSource = fs.readFileSync(
  new URL("../src/shortcuts.ts", import.meta.url),
  "utf8"
);

// CR01: 检查 App.tsx 协议参数形状
const hasUncommittedTarget = appSource.includes('type: "uncommittedChanges"');
const hasBaseBranchTarget = appSource.includes('type: "baseBranch"');
const hasCommitTarget = appSource.includes('type: "commit"');
const hasCustomTarget = appSource.includes('type: "custom"');
const hasReviewStartCall = appSource.includes('"review/start"');

// CR02: 检查 CodeReviewView 界面支持 4 类 Target
const has4Targets =
  viewSource.includes('"uncommitted"') &&
  viewSource.includes('"branch"') &&
  viewSource.includes('"commit"') &&
  viewSource.includes('"custom"');

// CR03: 检查快捷键映射
const hasShortcutAction =
  shortcutsSource.includes('"code-review"') ||
  shortcutsSource.includes('"open-review"');

assert.ok(
  hasReviewStartCall &&
    hasUncommittedTarget &&
    hasBaseBranchTarget &&
    hasCommitTarget &&
    hasCustomTarget,
  "App.tsx: handleStartCodeReview must support all 4 review/start target shapes"
);
assert.ok(
  has4Targets,
  "CodeReviewView.tsx: Must provide targets for uncommitted, branch, commit, and custom"
);
assert.ok(
  hasShortcutAction,
  "shortcuts.ts: Must register code-review shortcut action"
);

console.log("ALL CODE REVIEW VERIFICATIONS PASSED!");

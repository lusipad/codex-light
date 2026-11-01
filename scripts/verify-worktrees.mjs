import assert from "node:assert/strict";
import fs from "node:fs";

// 1. 检查 WorktreesView.tsx
const viewSource = fs.readFileSync(
  new URL("../src/components/WorktreesView.tsx", import.meta.url),
  "utf8"
);

// 2. 检查 App.tsx
const appSource = fs.readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8"
);

// W01: WorktreesViewProps 必须包含 onSelectThread
const hasOnSelectThreadProp =
  viewSource.includes("onSelectThread?: (threadId: string) => void") ||
  viewSource.includes("onSelectThread: (threadId: string) => void");

// W02: App.tsx 必须向 WorktreesView 传入 onSelectThread
const appRendersWithOnSelectThread =
  appSource.includes("<WorktreesView") &&
  appSource.includes("onSelectThread=");

// W03: WorktreesView 必须包含 busy 状态防护
const hasActionBusyState =
  viewSource.includes("actionBusy") ||
  viewSource.includes("busyPath") ||
  viewSource.includes("operatingPath");

// W04: WorktreesView 绑定会话必须可点击跳转
const hasOwnerThreadJump =
  viewSource.includes("ownerThreadId") &&
  viewSource.includes("onSelectThread") &&
  viewSource.includes("onClick");

assert.ok(
  hasOnSelectThreadProp,
  "WorktreesView.tsx: WorktreesViewProps must declare onSelectThread callback"
);
assert.ok(
  appRendersWithOnSelectThread,
  "App.tsx: Must pass onSelectThread to WorktreesView"
);
assert.ok(
  hasActionBusyState,
  "WorktreesView.tsx: Must track busy state for worktree actions"
);
assert.ok(
  hasOwnerThreadJump,
  "WorktreesView.tsx: Must render clickable button to jump to ownerThreadId"
);

console.log("ALL WORKTREES VERIFICATIONS PASSED!");

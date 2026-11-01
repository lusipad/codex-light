import assert from "node:assert/strict";
import fs from "node:fs";

// 1. 检查 AutomationsView.tsx
const viewSource = fs.readFileSync(
  new URL("../src/components/AutomationsView.tsx", import.meta.url),
  "utf8"
);

// 2. 检查 App.tsx
const appSource = fs.readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8"
);

// S01 断言：AutomationsViewProps 必须声明 onSelectThread
const hasPropOnSelectThread =
  viewSource.includes("onSelectThread?: (threadId: string) => void") ||
  viewSource.includes("onSelectThread: (threadId: string) => void");

// S01 App 接线断言：App.tsx 渲染 AutomationsView 时传入 onSelectThread
const appRendersWithOnSelectThread =
  appSource.includes("<AutomationsView") &&
  appSource.includes("onSelectThread=");

// S02 断言：AutomationsView.tsx 运行历史或卡片上的 threadId 支持跳转
const hasThreadJumpAction =
  viewSource.includes("onSelectThread") &&
  viewSource.includes("record.threadId") &&
  viewSource.includes("onClick");

// S03 断言：AutomationsView.tsx 支持任务编辑 (editingItem 或 handleEdit)
const hasEditSupport =
  viewSource.includes("editingItem") ||
  viewSource.includes("handleEdit") ||
  viewSource.includes("editingId");

assert.ok(
  hasPropOnSelectThread,
  "AutomationsView.tsx: AutomationsViewProps must declare onSelectThread callback"
);
assert.ok(
  appRendersWithOnSelectThread,
  "App.tsx: Must pass onSelectThread to AutomationsView"
);
assert.ok(
  hasThreadJumpAction,
  "AutomationsView.tsx: Run history must provide clickable jump to threadId using onSelectThread"
);
assert.ok(
  hasEditSupport,
  "AutomationsView.tsx: Must support editing existing automation items"
);

console.log("ALL SCHEDULED & AUTOMATIONS VERIFICATIONS PASSED!");

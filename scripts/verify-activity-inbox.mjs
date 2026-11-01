import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

// 1. 检查 CodexSidebar.tsx
const sidebarSource = fs.readFileSync(
  new URL("../src/components/CodexSidebar.tsx", import.meta.url),
  "utf8"
);
const sidebarAst = ts.createSourceFile(
  "CodexSidebar.tsx",
  sidebarSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

let hasInboxBannerLink = false;
let hasBellContextMenu = false;

function visitSidebar(node) {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const text = node.getText(sidebarAst);
    if (text.includes("sidebar-activity-banner") && (text.includes('"inbox"') || text.includes("'inbox'"))) {
      hasInboxBannerLink = true;
    }
    if (text.includes("title=\"查看活动") && (text.includes("onContextMenu") || text.includes('"inbox"'))) {
      hasBellContextMenu = true;
    }
  }
  ts.forEachChild(node, visitSidebar);
}
visitSidebar(sidebarAst);

// 2. 检查 App.tsx 中的持久化
const appSource = fs.readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8"
);
const hasInboxPersistence =
  appSource.includes("desktop_state_get") &&
  appSource.includes("inboxItems") &&
  appSource.includes("desktop_state_set");

// 3. 检查 InboxView.tsx 存在且支持过滤
const inboxViewSource = fs.readFileSync(
  new URL("../src/components/InboxView.tsx", import.meta.url),
  "utf8"
);
const hasInboxFiltering =
  inboxViewSource.includes("onSelectNotification") &&
  inboxViewSource.includes("onMarkAllRead") &&
  inboxViewSource.includes('"unread"');

// 断言
assert.ok(
  hasInboxPersistence,
  "App.tsx must persist inboxItems using desktop_state_get / desktop_state_set"
);
assert.ok(
  hasInboxFiltering,
  "InboxView.tsx must support notification selection and unread filtering"
);
assert.ok(
  hasInboxBannerLink,
  "CodexSidebar.tsx sidebar-activity-banner must provide a button navigating to 'inbox'"
);
assert.ok(
  hasBellContextMenu,
  "CodexSidebar.tsx activity bell button must provide right-click shortcut navigating to 'inbox'"
);

console.log("ALL ACTIVITY & INBOX VERIFICATIONS PASSED!");

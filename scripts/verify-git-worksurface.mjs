import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const diffDrawerSource = fs.readFileSync(
  new URL("../src/components/DiffDrawer.tsx", import.meta.url),
  "utf8"
);
const ast = ts.createSourceFile(
  "DiffDrawer.tsx",
  diffDrawerSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

let hasDiscardAllFn = false;
let hasDiscardAllConfirm = false;
let hasDiscardAllBtn = false;
let hasAutoStageInCommit = false;
let hasAutoStageInCommitAndPush = false;
let hasRefreshGitBtn = false;

function visit(node) {
  // 1. 检查 handleDiscardAll 函数定义与 confirm
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleDiscardAll") {
    hasDiscardAllFn = true;
    const fnText = node.initializer?.getText(ast) || "";
    if (fnText.includes("confirm(") && fnText.includes("git_discard")) {
      hasDiscardAllConfirm = true;
    }
  }

  // 2. 检查 handleCommit 中的自动全暂存联动
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleCommit") {
    const fnText = node.initializer?.getText(ast) || "";
    if (fnText.includes("git_stage") && (fnText.includes("hasStaged") || fnText.includes("staged"))) {
      hasAutoStageInCommit = true;
    }
  }

  // 3. 检查 handleCommitAndPush 中的自动全暂存联动
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleCommitAndPush") {
    const fnText = node.initializer?.getText(ast) || "";
    if (fnText.includes("git_stage") && (fnText.includes("hasStaged") || fnText.includes("staged"))) {
      hasAutoStageInCommitAndPush = true;
    }
  }

  // 4. 检查 JSX 中全放弃按钮与 Git 刷新按钮
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const text = node.getText(ast);
    if (text.includes("diff-file-bulk-actions") && (text.includes("全放弃") || text.includes("handleDiscardAll"))) {
      hasDiscardAllBtn = true;
    }
    if (text.includes("diff-layout-switch") && text.includes("onRefreshGit")) {
      hasRefreshGitBtn = true;
    }
  }

  ts.forEachChild(node, visit);
}
visit(ast);

// 断言
assert.ok(
  hasDiscardAllFn && hasDiscardAllConfirm,
  "DiffDrawer.tsx must implement handleDiscardAll with confirmation guard before invoking git_discard"
);
assert.ok(
  hasDiscardAllBtn,
  "DiffDrawer.tsx diff-file-bulk-actions must render a '全放弃' button wired to handleDiscardAll"
);
assert.ok(
  hasAutoStageInCommit,
  "DiffDrawer.tsx handleCommit must auto-stage all changes before committing if nothing is currently staged"
);
assert.ok(
  hasAutoStageInCommitAndPush,
  "DiffDrawer.tsx handleCommitAndPush must auto-stage all changes before committing and pushing"
);
assert.ok(
  hasRefreshGitBtn,
  "DiffDrawer.tsx diff-layout-switch must include a button to call onRefreshGit()"
);

console.log("ALL GIT WORKSURFACE VERIFICATIONS PASSED!");

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

let hasCtrlSSave = false;
let hasTabIndent = false;
let hasClosePreviewBtn = false;
let hasClosePreviewHandler = false;
let hasDirErrorState = false;
let hasDirErrorUI = false;
let hasLiveFileRefreshWithoutDirty = false;

function visit(node) {
  // 1. 检查 textarea 及其 onKeyDown
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const text = node.getText(ast);
    if (text.includes("file-editor-textarea")) {
      if (text.includes("ctrlKey") && (text.includes('"s"') || text.includes("'s'"))) {
        hasCtrlSSave = true;
      }
      if (text.includes('"Tab"') || text.includes("'Tab'")) {
        hasTabIndent = true;
      }
    }

    // 2. 检查关闭文件预览按钮
    if (
      text.includes("file-editor-header") &&
      text.includes('title="关闭预览"') &&
      text.includes("closeFilePreview()")
    ) {
      hasClosePreviewBtn = true;
    }

    // 3. 检查目录失效与恢复 UI
    if (text.includes("fe-dir-error") && (text.includes("返回工作区根目录") || text.includes("setCurrentDir(cwd)"))) {
      hasDirErrorUI = true;
    }
  }

  // 4. 检查 dirError 状态
  if (ts.isVariableDeclaration(node)) {
    const name = node.name.getText(ast);
    if (name === "dirError" || name.includes("dirError")) {
      hasDirErrorState = true;
    }
    if (name === "closeFilePreview" &&
      node.initializer?.getText(ast).includes("setFilePreview(null)")) {
      hasClosePreviewHandler = true;
    }
  }

  // 5. 检查 fsWatchPath 中对当前文件的自动刷新
  if (ts.isCallExpression(node)) {
    const fnName = node.expression.getText(ast);
    if (fnName === "fsWatchPath" || fnName.includes("fsWatchPath")) {
      const callText = node.getText(ast);
      if (
        callText.includes("isDirty") &&
        (callText.includes("openFilePreview") || callText.includes("readTextPreviewViaProtocol"))
      ) {
        hasLiveFileRefreshWithoutDirty = true;
      }
    }
  }

  ts.forEachChild(node, visit);
}
visit(ast);

// 断言
assert.ok(
  hasCtrlSSave,
  "DiffDrawer.tsx file-editor-textarea must handle Ctrl+S / Cmd+S onKeyDown to save file"
);
assert.ok(
  hasTabIndent,
  "DiffDrawer.tsx file-editor-textarea must handle Tab onKeyDown for code indentation"
);
assert.ok(
  hasClosePreviewBtn && hasClosePreviewHandler,
  "DiffDrawer.tsx file-editor-header must provide a close button to clear preview"
);
assert.ok(
  hasDirErrorState && hasDirErrorUI,
  "DiffDrawer.tsx must maintain dirError state and render fe-dir-error with recovery button"
);
assert.ok(
  hasLiveFileRefreshWithoutDirty,
  "DiffDrawer.tsx fsWatchPath callback must refresh current preview when !isDirty"
);

console.log("ALL FILES WORKSURFACE VERIFICATIONS PASSED!");

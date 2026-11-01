import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

// 1. 检查 TerminalDock.tsx AST
const dockSource = fs.readFileSync(
  new URL("../src/components/TerminalDock.tsx", import.meta.url),
  "utf8"
);
const ast = ts.createSourceFile(
  "TerminalDock.tsx",
  dockSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

let hasDockHeightState = false;
let hasResizerElement = false;
let hasInterruptTerminal = false;
let hasCloseSessionInvocation = false;

function visit(node) {
  // 检查状态声明
  if (ts.isVariableDeclaration(node)) {
    const name = node.name.getText(ast);
    if (name === "dockHeight" || name.includes("dockHeight")) {
      hasDockHeightState = true;
    }
    if (name === "interruptActiveTerminal" || name.includes("interrupt")) {
      const fnText = node.initializer?.getText(ast) || "";
      if (fnText.includes('"\\x03"') || fnText.includes("'\\x03'")) {
        hasInterruptTerminal = true;
      }
    }
  }

  // 检查 JSX 元素
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const text = node.getText(ast);
    if (text.includes("terminal-dock-resizer")) {
      hasResizerElement = true;
    }
  }

  // 检查 terminal_close 调用
  if (ts.isCallExpression(node)) {
    const text = node.getText(ast);
    if (text.includes('"terminal_close"') || text.includes("'terminal_close'")) {
      hasCloseSessionInvocation = true;
    }
  }

  ts.forEachChild(node, visit);
}
visit(ast);

// 2. 检查 styles.css 中的 resizer 样式
const stylesSource = fs.readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8"
);
const hasResizerStyle =
  stylesSource.includes(".terminal-dock-resizer") &&
  (stylesSource.includes("row-resize") || stylesSource.includes("ns-resize"));

// 3. 检查 shortcuts.ts 中的快捷键注册
const shortcutsSource = fs.readFileSync(
  new URL("../src/shortcuts.ts", import.meta.url),
  "utf8"
);
const hasTerminalShortcut = shortcutsSource.includes("toggle-terminal");

// 断言
assert.ok(
  hasCloseSessionInvocation,
  "TerminalDock.tsx must invoke terminal_close when closing a session tab"
);
assert.ok(
  hasTerminalShortcut,
  "shortcuts.ts must register toggle-terminal shortcut"
);
assert.ok(
  hasDockHeightState && hasResizerElement,
  "TerminalDock.tsx must maintain dockHeight state and render terminal-dock-resizer handle"
);
assert.ok(
  hasInterruptTerminal,
  "TerminalDock.tsx must provide an interruptActiveTerminal action sending \\x03"
);
assert.ok(
  hasResizerStyle,
  "styles.css must declare .terminal-dock-resizer style with row-resize or ns-resize cursor"
);

console.log("ALL TERMINAL & LAYOUT VERIFICATIONS PASSED!");

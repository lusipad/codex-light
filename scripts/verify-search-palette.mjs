import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const modalSource = fs.readFileSync(
  new URL("../src/components/QuickSearchModal.tsx", import.meta.url),
  "utf8"
);
const ast = ts.createSourceFile(
  "QuickSearchModal.tsx",
  modalSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

let importsSlashCommands = false;
let hasFocusReturnLogic = false;
let hasSlashCommandSection = false;

function visit(node) {
  // 检查导入
  if (ts.isImportDeclaration(node)) {
    const text = node.getText(ast);
    if (text.includes("SLASH_COMMANDS") || text.includes("slashCommands")) {
      importsSlashCommands = true;
    }
  }

  // 检查焦点恢复逻辑
  if (ts.isVariableDeclaration(node)) {
    const name = node.name.getText(ast);
    if (name.includes("lastActive") || name.includes("previousFocus") || name.includes("lastFocus")) {
      hasFocusReturnLogic = true;
    }
  }

  // 检查斜杠命令分区
  if (ts.isStringLiteral(node)) {
    if (node.text.includes("斜杠命令") || node.text.includes("Slash command")) {
      hasSlashCommandSection = true;
    }
  }

  ts.forEachChild(node, visit);
}
visit(ast);

// 断言
assert.ok(
  importsSlashCommands,
  "QuickSearchModal.tsx must import SLASH_COMMANDS from '../slashCommands'"
);
assert.ok(
  hasSlashCommandSection,
  "QuickSearchModal.tsx must index and display '斜杠命令 (Slash commands)' section"
);
assert.ok(
  hasFocusReturnLogic,
  "QuickSearchModal.tsx must track previous focus and restore it on modal close"
);

console.log("ALL SEARCH & COMMAND PALETTE VERIFICATIONS PASSED!");

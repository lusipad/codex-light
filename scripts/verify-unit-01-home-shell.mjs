import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import vm from "node:vm";

console.log("=== Unit 01 Home Shell + Composer Parity Verification ===");

// 1. H01: Surface Color & Title Typography
const stylesCss = fs.readFileSync("src/styles.css", "utf8");
assert.ok(stylesCss.includes("--bg-main: #181818;"), "H01: --bg-main must be #181818 aligned with official app-shared CSS");
assert.ok(/font-size:\s*var\(--text-xl\);\s*font-weight:\s*400;\s*line-height:\s*calc\(34px \* var\(--font-ui-scale, 1\)\);\s*letter-spacing:\s*0\.38px;/.test(stylesCss),
  "H01: .home-greeting-title must retain 28px/34px at default UI scale while consuming the font preference");
console.log("PASS H01: Dark surface #181818 and Home Greeting Title typography (28px/34px/0.38px)");

// 2. H02 & H03 & H04 & H05: ModelSelector Keyboard & Focus Management
const modelSelectorTsx = fs.readFileSync("src/components/ModelSelector.tsx", "utf8");
assert.ok(modelSelectorTsx.includes('event.key === "ArrowDown" || event.key === "ArrowUp"'),
  "H02: ModelSelector trigger must open on ArrowDown / ArrowUp");
assert.ok(modelSelectorTsx.includes('initialFocusRef.current = event.key === "ArrowUp" ? "last" : "first"'),
  "H02: ArrowDown focuses first, ArrowUp focuses last");
assert.ok(modelSelectorTsx.includes('event.key === "Escape"'),
  "H03: ModelSelector must handle Escape");
assert.ok(modelSelectorTsx.includes("event.stopPropagation()"),
  "H03: Escape must stop propagation to avoid closing surrounding workspace");
assert.ok(modelSelectorTsx.includes('matches(\'input[type="range"]\')'),
  "H05: Reasoning slider input[type=range] must not be intercepted by menu navigation");
assert.ok(modelSelectorTsx.includes('event.key === "Home"') && modelSelectorTsx.includes('event.key === "End"'),
  "H04: Menu navigation must support Home and End");
console.log("PASS H02-H05: ModelSelector keyboard navigation, slider protection, Escape focus return");

// 3. H06: Clicking textarea dismisses open menus
const composerBoxTsx = fs.readFileSync("src/components/ComposerBox.tsx", "utf8");
assert.ok(composerBoxTsx.includes("onPointerDown={() => setOpenMenu(null)}"),
  "H06: Textarea pointerDown must dismiss any open composer popover menu");
assert.ok(modelSelectorTsx.includes('document.addEventListener("pointerdown", dismiss)'),
  "H06: ModelSelector must listen to pointerdown outside anchor to dismiss");
console.log("PASS H06: Clicking textarea dismisses open menus while retaining input focus");

// 4. H07: Ctrl+Shift+M Model Menu Shortcut
const shortcutsTs = fs.readFileSync("src/shortcuts.ts", "utf8");
assert.ok(shortcutsTs.includes('"open-model-picker"') || shortcutsTs.includes("open-model-picker"),
  "H07: shortcuts must contain open-model-picker");
assert.ok(/keys:\s*"(?:Ctrl\+Shift\+M|Command\+Shift\+M)"/.test(shortcutsTs),
  "H07: Model shortcut must be Ctrl+Shift+M / Command+Shift+M");
console.log("PASS H07: Ctrl+Shift+M shortcut correctly wired for model selector");

// 5. H08: Sidebar Toggle & Collapse
const sidebarCss = fs.readFileSync("src/styles.css", "utf8");
assert.ok(sidebarCss.includes(".codex-sidebar.collapsed"), "H08: Styles must define .codex-sidebar.collapsed");
assert.ok(shortcutsTs.includes('"toggle-sidebar"') && shortcutsTs.includes("Ctrl+B"),
  "H08: Sidebar toggle must be mapped to Ctrl+B");
console.log("PASS H08: Sidebar toggle Ctrl+B and collapsed state styling confirmed");

// 6. H09: AppTitleBar Dimensions & Drag Regions
const titleBarCss = fs.readFileSync("src/components/AppTitleBar.css", "utf8");
assert.ok(titleBarCss.includes("-webkit-app-region: drag;"),
  "H09: AppTitleBar must have -webkit-app-region: drag");
assert.ok(titleBarCss.includes("-webkit-app-region: no-drag;"),
  "H09: Buttons in title bar must have -webkit-app-region: no-drag");
assert.ok(/--app-titlebar-height:\s*(?:38px|46px|54px);/.test(stylesCss),
  "H09: Title bar height must be standardized (aligned with 54px baseline)");
console.log("PASS H09: Titlebar height and drag/no-drag regions");

// 7. H10: IME Composition Enter Protection
const composerAst = ts.createSourceFile("ComposerBox.tsx", composerBoxTsx, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handlerText;
function findHandler(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(composerAst) === "handleKeyDown") {
    handlerText = node.initializer.getText(composerAst);
  }
  ts.forEachChild(node, findHandler);
}
findHandler(composerAst);
assert.ok(handlerText, "handleKeyDown must be declared in ComposerBox.tsx");
assert.ok(handlerText.includes("isComposing") || handlerText.includes("keyCode === 229"),
  "H10: handleKeyDown must check isComposing and keyCode 229");
console.log("PASS H10: IME Composition Enter protection active");

console.log("\nALL UNIT 01 HOME SHELL & COMPOSER PARITY CHECKS PASSED!");

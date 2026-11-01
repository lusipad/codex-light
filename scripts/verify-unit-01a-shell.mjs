import assert from "node:assert/strict";
import fs from "node:fs";

console.log("=== Unit 01A Public Shell Structure & Behavioral Rules Check (L1 Static + Logic) ===");
console.log("NOTE: This script validates source declarations & event logic. It DOES NOT prove rendered DOM dimensions, pixel alignment, or native drag behavior without a live native run.\n");

const stylesCss = fs.readFileSync("src/styles.css", "utf8");
const titleBarCss = fs.readFileSync("src/components/AppTitleBar.css", "utf8");
const shortcutsTs = fs.readFileSync("src/shortcuts.ts", "utf8");
const appTsx = fs.readFileSync("src/App.tsx", "utf8");

// 1. DIFF-01A-01: Titlebar height CSS declaration
const titlebarHeightMatch = stylesCss.match(/--app-titlebar-height:\s*([0-9]+px);/);
assert.ok(titlebarHeightMatch, "DIFF-01A-01: styles.css must define --app-titlebar-height");
assert.strictEqual(
  titlebarHeightMatch[1],
  "54px",
  `DIFF-01A-01: --app-titlebar-height must be 54px in CSS token (currently: ${titlebarHeightMatch[1]})`
);
console.log("PASS DIFF-01A-01: --app-titlebar-height token declared as 54px");

// 2. DIFF-01A-02: Window controls CSS height and alignment rules
assert.ok(
  titleBarCss.includes(".app-window-controls"),
  "DIFF-01A-02: AppTitleBar.css must define .app-window-controls"
);
assert.ok(
  !titleBarCss.match(/\.app-window-controls\s*\{[^}]*height:\s*36px;/),
  "DIFF-01A-02: .app-window-controls must not declare fixed 36px height"
);
assert.ok(
  !titleBarCss.match(/\.app-window-controls\s*\{[^}]*align-self:\s*center;/),
  "DIFF-01A-02: .app-window-controls must not declare align-self: center"
);
assert.ok(
  titleBarCss.match(/\.app-window-controls\s*\{[^}]*height:\s*100%;/),
  "DIFF-01A-02: .app-window-controls must declare height: 100%"
);
console.log("PASS DIFF-01A-02: Window controls CSS rule declared height: 100% and removed align-self: center (L1 static check only)");

// 3. DIFF-01A-03: Navigation rail width CSS declaration
const railWidthMatch = stylesCss.match(/--nav-rail-width:\s*([0-9]+px);/);
assert.ok(railWidthMatch, "DIFF-01A-03: styles.css must define --nav-rail-width");
assert.strictEqual(
  railWidthMatch[1],
  "60px",
  `DIFF-01A-03: --nav-rail-width must be 60px in CSS token (currently: ${railWidthMatch[1]})`
);
console.log("PASS DIFF-01A-03: --nav-rail-width token declared as 60px");

// 4. DIFF-01A-04: Palette tokens declaration
assert.ok(
  stylesCss.includes("--bg-titlebar"),
  "DIFF-01A-04: styles.css must declare --bg-titlebar token"
);
assert.ok(
  stylesCss.includes("--bg-nav-rail"),
  "DIFF-01A-04: styles.css must declare --bg-nav-rail token"
);
assert.ok(
  titleBarCss.includes("background: var(--bg-titlebar"),
  "DIFF-01A-04: AppTitleBar must reference --bg-titlebar"
);
assert.ok(
  stylesCss.includes("background: var(--bg-nav-rail"),
  "DIFF-01A-04: .codex-nav-rail must reference --bg-nav-rail"
);
console.log("PASS DIFF-01A-04: Palette tokens declared and referenced in CSS");

// 5. DIFF-01A-05: Titlebar drag and no-drag region isolation
assert.ok(
  titleBarCss.includes("-webkit-app-region: drag;"),
  "DIFF-01A-05: .app-titlebar must declare -webkit-app-region: drag"
);
assert.ok(
  titleBarCss.includes(".app-titlebar button,") && titleBarCss.includes("-webkit-app-region: no-drag;"),
  "DIFF-01A-05: All buttons and interactive elements in titlebar must declare -webkit-app-region: no-drag"
);
console.log("PASS DIFF-01A-05: Drag/no-drag isolation rules declared in CSS");

// 6. DIFF-01A-06: Sidebar toggle shortcut mapping & key repeat filtering
assert.ok(
  shortcutsTs.includes('"toggle-sidebar"') &&
  shortcutsTs.includes("Ctrl+B / Ctrl+Shift+S") &&
  shortcutsTs.includes('key(e) === "b"') &&
  shortcutsTs.includes('key(e) === "s"'),
  "DIFF-01A-06: shortcuts.ts must map toggle-sidebar to both Ctrl+B and Ctrl+Shift+S"
);
assert.ok(
  appTsx.includes('shortcutId === "toggle-sidebar" && e.repeat'),
  "DIFF-01A-06: App.tsx must ignore e.repeat for toggle-sidebar (aligned with official electron:9026914)"
);
console.log("PASS DIFF-01A-06: Dual shortcuts (Ctrl+B / Ctrl+Shift+S) and key repeat filtering confirmed");

// 7. DIFF-01A-07: 960px responsive auto-collapse
assert.ok(
  appTsx.includes("window.innerWidth <= 960"),
  "DIFF-01A-07: App.tsx must check responsive breakpoint window.innerWidth <= 960 (aligned with official app-initial:1351772 zIt)"
);
assert.ok(
  appTsx.includes('window.addEventListener("resize", handleResize)'),
  "DIFF-01A-07: App.tsx must register resize listener to auto-toggle sidebar around 960px boundary"
);
console.log("PASS DIFF-01A-07: 960px responsive auto-collapse logic confirmed");

console.log("\nALL 01A PUBLIC SHELL STATIC & LOGIC RULES PASSED (L1 ONLY).");

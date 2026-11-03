import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/shortcuts.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
});
const { matchShortcut, matchRecentThreadIndex } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const event = (key, options = {}) => ({
  key, code: "", ctrlKey: false, metaKey: false, altKey: false,
  shiftKey: false, isComposing: false, defaultPrevented: false, ...options,
});
const ctrl = { ctrlKey: true };
const shift = { ...ctrl, shiftKey: true };
const alt = { ...ctrl, altKey: true };
const cases = [
  [event("n", ctrl), "new-chat"],
  [event("O", shift), "new-chat"],
  [event("b", ctrl), "toggle-sidebar"],
  [event("S", shift), "toggle-sidebar"],
  [event("j", ctrl), "toggle-bottom-panel"],
  [event("`", { ...ctrl, code: "Backquote" }), "toggle-terminal"],
  [event("M", shift), "open-model-picker"],
  [event("m", ctrl), null],
  [event("p", alt), "pin-thread"],
  [event("P", { ...alt, shiftKey: true }), null],
  [event("o", alt), "new-standalone-chat"],
  [event("O", { ...alt, shiftKey: true }), null],
  [event("b", alt), "toggle-changes"],
  [event("B", { ...alt, shiftKey: true }), null],
  [event("k", ctrl), "command-palette"],
  [event("K", shift), null],
  [event("n", { ...ctrl, isComposing: true }), null],
  [event("n", { ...ctrl, keyCode: 229 }), null],
  [event("Escape", { defaultPrevented: true }), null],
];
for (const [input, expected] of cases) {
  assert.equal(matchShortcut(input), expected, JSON.stringify(input));
}
for (let digit = 1; digit <= 9; digit++) {
  assert.equal(matchRecentThreadIndex(event(String(digit), alt)), digit <= 6 ? digit - 1 : null);
  assert.equal(matchRecentThreadIndex(event(String(digit), { altKey: true })), null);
}
assert.equal(matchRecentThreadIndex(event("1", { ...alt, isComposing: true })), null);
assert.equal(matchRecentThreadIndex(event("1", { ...alt, shiftKey: true })), null);
console.log("Shortcut regression: 39 assertions passed");

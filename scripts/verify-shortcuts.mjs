import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/shortcuts.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
});
const { matchShortcut, matchRecentThreadIndex, commandId, defaultBindings, effectiveBindings, createShortcutMatcher,
  shortcutAllowsSequence, shortcutAllowsAppend, shortcutSharesBinding, shortcutEventAllowed, migrateKeyBindings, normalizeAccelerator, SHORTCUTS } = await import(
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
assert.equal(commandId("delete-chat"), "deleteChat");
assert.equal(commandId("composer-submit"), "composer.submit");
assert.equal(SHORTCUTS.find(item => item.id === "open-model-picker").label, "选择推理强度");
assert.equal(SHORTCUTS.find(item => item.id === "composer-toggle-fast-mode").description, "循环切换可用速度：标准、快速和超快");
assert.deepEqual(defaultBindings("composer-submit"), [], "submit defaults depend on composer mode, not a fabricated global Enter");
assert.deepEqual(defaultBindings("sidebar-thread-9"), ["Alt+9"]);
assert.deepEqual(defaultBindings("sidebar-thread-9", "sidebar"), ["CmdOrCtrl+9"]);
assert.equal(matchShortcut(event("9", { altKey: true })), "sidebar-thread-9");
assert.equal(matchShortcut(event("9", ctrl)), "focus-tab-9", "tabs have a separate workbench consumer");
assert.equal(matchShortcut(event("9", ctrl), [], "sidebar"), "sidebar-thread-9");
assert.equal(matchShortcut(event("ArrowRight", alt)), "next-thread");
assert.equal(shortcutAllowsSequence("new-chat"), true);
assert.equal(shortcutAllowsSequence("command-palette"), false);
assert.equal(shortcutAllowsSequence("rename-thread"), false);
assert.equal(shortcutAllowsSequence("composer-submit"), false);
assert.equal(shortcutAllowsSequence("composer-clear"), true);
assert.equal(shortcutAllowsAppend("command-palette"), true);
assert.equal(shortcutAllowsAppend("escape"), false);
assert.equal(shortcutSharesBinding("closeTab", "closeWindow"), true);
assert.equal(shortcutSharesBinding("file.goToDefinition", "navigateForward"), true);
assert.equal(shortcutSharesBinding("composer-submit", "approval-approve", "Enter"), true);
assert.equal(shortcutSharesBinding("composer-submit", "approval-approve", "Ctrl+E"), false);
assert.equal(normalizeAccelerator('Ctrl+Plus'), normalizeAccelerator('Ctrl+Shift+Equal'));
assert.equal(normalizeAccelerator('Ctrl+Shift+1'), normalizeAccelerator('Control+Shift+!'));
assert.deepEqual(effectiveBindings("next-thread", [{ command: "composer.clear", key: "Ctrl+Alt+]" }]), ["Ctrl+Alt+Right"]);
assert.equal(matchShortcut(event("]", alt), [{ command: "composer.clear", key: "Ctrl+Alt+]" }]), "composer-clear", "official dynamic occupied defaults yield to custom bindings");
const matcher = createShortcutMatcher(() => [{ command: "newTask", key: "G H" }], id => id === "new-chat");
assert.equal(matcher(event("g")).pending, true);
assert.equal(matcher(event("h")).id, "new-chat");
const hostMatcher = createShortcutMatcher(() => [{ command: "openCommandMenu", key: "G H" }]);
assert.equal(hostMatcher(event("g")).pending, false, "host commands cannot execute unsupported sequences");
const textarea = { selectionStart: 0, selectionEnd: 0, closest: selector => selector === '.xterm' ? null : selector === '.codex-two-tier-composer' ? {} : textarea };
const typingEvent = event("b", { ...ctrl, target: textarea });
assert.equal(shortcutEventAllowed(typingEvent, []), true);
textarea.selectionStart = textarea.selectionEnd = 1;
assert.equal(shortcutEventAllowed(typingEvent, []), false, "default Ctrl+B yields to bold away from start");
textarea.selectionStart = 0;
assert.equal(shortcutEventAllowed(typingEvent, []), false, "selected text yields to bold");
assert.equal(shortcutEventAllowed(typingEvent, [{ command: 'toggleSidebar', key: 'Ctrl+B' }]), true, "explicit custom binding has no default-only bold exemption");
const terminalTarget = { closest: selector => selector === '.xterm' ? {} : null };
assert.equal(shortcutEventAllowed(event('n', { ...ctrl, target: terminalTarget }), []), false);
assert.equal(shortcutEventAllowed(event('`', { ...ctrl, code: 'Backquote', target: terminalTarget }), []), true);
assert.equal(shortcutEventAllowed(event('g', { target: { closest: () => ({}) } }), []), false);
const migrate = input => JSON.parse(JSON.stringify(migrateKeyBindings(input)));
assert.deepEqual(migrate([{ command: 'closeTabOrWindow', key: 'Ctrl+W', future: 4 }]), [
  { command: 'closeTab', key: 'Ctrl+W', future: 4 }, { command: 'closeWindow', key: 'Ctrl+W', future: 4 },
]);
assert.deepEqual(migrate([{ command: 'newThread', key: 'Ctrl+N' }]), [{ command: 'newTask', key: 'Ctrl+N' }]);
assert.deepEqual(effectiveBindings('new-chat', [{ command: 'newThread', key: 'Ctrl+E' }]), ['Ctrl+E']);
assert.deepEqual(migrate([{ command: 'globalDictationToggle', key: 'Ctrl+D' }]), [{ command: 'globalDictationHold', key: 'Ctrl+D' }]);
assert.deepEqual(migrate([{ command: 'globalDictationHold', key: 'Ctrl+D' }, { command: 'globalDictationToggle', key: 'Ctrl+D' }]), [
  { command: 'globalDictationHold', key: 'Ctrl+D' }, { command: 'globalDictationSingleTap', key: null },
]);
assert.deepEqual(migrate([{ command: 'composer.startDictation', key: 'Ctrl+D' }]), []);
assert.deepEqual(migrate([{ command: 'nextRecentThread', key: 'Ctrl+Tab' }]), []);
assert.deepEqual(migrate([{ command: 'nextRecentThread', key: 'Ctrl+J' }]), [
  { command: 'openCommandMenu', key: 'CmdOrCtrl+K' }, { command: 'openCommandMenu', key: 'CmdOrCtrl+Shift+P' }, { command: 'openCommandMenu', key: 'Ctrl+J' },
]);
const oldTab = [{ command: 'nextTab', key: 'Ctrl+Tab' }, { command: 'nextTab', key: 'Ctrl+PageDown' }];
assert.deepEqual(migrate(oldTab), [{ command: 'nextTab', key: 'Ctrl+PageDown' }]);
assert.deepEqual(migrate(oldTab.map(record => ({ ...record, version: 1 }))), oldTab.map(record => ({ ...record, version: 1 })));
assert.deepEqual(migrate([{ command: 'nextTab', key: 'G H', version: 1 }, { command: 'nextThread', key: 'G' }]), [
  { command: 'nextThread', key: 'G' }, { command: 'nextTab', key: null },
]);
const future = [{ command: 'newThread', key: 'Ctrl+E', version: 2, future: { retained: true } }];
assert.deepEqual(migrate(future), future);
assert.deepEqual(effectiveBindings('new-chat', future), defaultBindings('new-chat'));
assert.deepEqual(oldTab, [{ command: 'nextTab', key: 'Ctrl+Tab' }, { command: 'nextTab', key: 'Ctrl+PageDown' }], 'read-time migration never mutates source');
console.log("Shortcut registry, official eligibility, numbering, migration, sequences and input-scope regression passed");

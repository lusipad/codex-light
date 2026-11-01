import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const transpile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const all = node => node && typeof node === "object" ? [node, ...node.children.flatMap(all)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "string" ? node : "";

function mount(sourcePath, props, requires = {}) {
  const hooks = [], effects = [], dom = new Map(), calls = [], frames = [];
  let cursor = 0, tree, active;
  const document = { get activeElement() { return active; }, getElementById: id => dom.get(id) };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useId: () => "help-test",
    useRef: initial => { const i = cursor++; return hooks[i] ??= { current: initial }; },
    useState: initial => {
      const i = cursor++; if (!(i in hooks)) hooks[i] = initial;
      return [hooks[i], value => { hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }];
    },
    useEffect: (fn, deps) => {
      const i = cursor++;
      if (!hooks[i] || deps.some((d, j) => d !== hooks[i][j])) { hooks[i] = deps; effects.push(fn); }
    },
  };
  const element = node => {
    const id = node.props.id ?? node.props["aria-label"] ?? (node.type === "button" ? text(node) : null);
    if (!id) return null;
    if (!dom.has(id)) dom.set(id, {
      opened: false, focus() { active = this; },
      matches(selector) { return selector === ":popover-open" && this.opened; },
      showPopover() { this.opened = true; }, hidePopover() { this.opened = false; },
      showModal() { this.opened = true; }, close() { this.opened = false; },
      getBoundingClientRect: () => ({ left: 290, right: 530, top: 500, bottom: 534, width: 240, height: 34 }),
    });
    const el = dom.get(id); el.node = node;
    el.contains = target => el === target || all(node).some(n => element(n) === target);
    el.getAttribute = key => node.props[key] ?? null;
    el.querySelectorAll = selector => {
      const buttons = selector.includes("input") ? all(node).filter(n => ["button", "input"].includes(n.type)) : selector.startsWith(":scope") ? node.children.filter(n => n?.type === "button") : all(node).filter(n => n.type === "button");
      return buttons.filter(n => !n.props.disabled).map(element);
    };
    el.querySelector = selector => el.querySelectorAll(selector)[0];
    return el;
  };
  const module = { exports: {} };
  vm.runInNewContext(transpile(fs.readFileSync(sourcePath, "utf8")), {
    exports: module.exports, require: name => name === "react" ? react : requires[name] ?? {},
    document, window: { innerHeight: 640, innerWidth: 960 },
    requestAnimationFrame: fn => frames.push(fn),
  });
  const render = () => {
    cursor = 0; tree = Object.values(module.exports)[0](props);
    for (const n of all(tree)) {
      const el = element(n);
      if (n.props.ref && el) typeof n.props.ref === "function" ? n.props.ref(el) : n.props.ref.current = el;
    }
    for (const fn of effects.splice(0)) fn();
    return tree;
  };
  const find = predicate => all(render()).find(predicate);
  const key = (node, key, extra = {}) => {
    let prevented = false, stopped = false;
    node.props.onKeyDown({ key, nativeEvent: {}, currentTarget: element(node), target: active, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; }, ...extra });
    render(); return { prevented, stopped };
  };
  render();
  return { render, find, key, dom, calls, props, element, document,
    flush: () => { for (const fn of frames.splice(0)) fn(); },
    focus: node => { active = element(node); }, get active() { return active; } };
}

const actions = [];
const rail = mount("src/components/NavigationRail.tsx", {
  activeRoute: "home", unreadInboxCount: 0, appServerConnected: true,
  onNavigate() {}, onOpenUsage() {}, onCommand: command => actions.push(command),
});
const help = () => rail.find(n => n.type === "button" && text(n) === "帮助");
assert.ok(help(), "profile must contain a Help submenu trigger instead of a documentation action");
assert.equal(help().props["aria-haspopup"], "menu");
const submenu = () => rail.find(n => n.props.role === "menu" && n.props["aria-label"] === "帮助");
const profile = () => rail.find(n => n.props.role === "menu" && n.props["aria-label"] === "个人资料菜单");
const popover = rail.element(profile());
popover.showPopover();
help().props.onClick({ currentTarget: rail.element(help()), detail: 0 });
assert.deepEqual(actions, [], "opening Help must not navigate");
assert.equal(rail.element(submenu()).opened, true);
rail.focus(help()); rail.key(profile(), "ArrowRight"); rail.flush();
assert.equal(rail.active.node.type, "button");
assert.equal(text(rail.active.node), "新功能");
rail.key(submenu(), "End");
assert.equal(text(rail.active.node), "用户指南");
rail.key(submenu(), "ArrowLeft");
assert.equal(rail.element(submenu()).opened, false);
assert.equal(popover.opened, true, "Left closes only the submenu");
assert.equal(text(rail.active.node), "帮助");
rail.key(profile(), "ArrowDown");
assert.ok(text(rail.active.node).startsWith("设置"), "parent navigation must skip the nested submenu items");
rail.focus(help()); rail.key(profile(), "ArrowRight"); rail.flush();
rail.key(submenu(), "Escape");
assert.equal(popover.opened, true, "first Escape must preserve the profile menu");
assert.equal(text(rail.active.node), "帮助");
for (const [label, command] of [["新功能", "changelog"], ["键盘快捷键", "show-keyboard-shortcuts"], ["用户指南", "user-guide"]]) {
  popover.showPopover(); help().props.onClick({ currentTarget: rail.element(help()), detail: 0 });
  const item = rail.find(n => n.type === "button" && text(n).startsWith(label));
  item.props.onClick({ currentTarget: rail.element(item) });
  assert.equal(actions.at(-1), command);
  assert.equal(rail.element(submenu()).opened, false);
  assert.equal(popover.opened, false, "select closes both menus");
}
assert.deepEqual(actions, ["changelog", "show-keyboard-shortcuts", "user-guide"]);
popover.showPopover(); help().props.onClick({ currentTarget: rail.element(help()), detail: 0 });
rail.key(submenu(), "Tab");
assert.equal(popover.opened, false);
console.log("PASS actual Help submenu: nesting, keyboard return, no premature navigation and single action dispatch (L2)");

const shortcutModule = { exports: {} };
vm.runInNewContext(transpile(fs.readFileSync("src/shortcuts.ts", "utf8")), { exports: shortcutModule.exports });
const shortcut = shortcutModule.exports;
assert.equal(shortcut.matchShortcut({ key: "/", ctrlKey: true }), "show-keyboard-shortcuts");
assert.equal(shortcut.matchShortcut({ key: "/", ctrlKey: true, altKey: true }), null);
assert.equal(shortcut.matchShortcut({ key: "?", ctrlKey: true, shiftKey: true }), null);
let closed = 0;
const dialog = mount("src/components/KeyboardShortcutsDialog.tsx", {
  onClose: () => { closed++; }, hasActiveThread: false, hasWorkspace: false,
}, { "../shortcuts": shortcut });
const input = () => dialog.find(n => n.type === "input");
assert.equal(dialog.active, dialog.element(input()), "dialog must focus search");
assert.ok(text(dialog.render()).includes("Ctrl+N"), "show active local bindings");
assert.ok(!text(dialog.render()).includes("重命名当前会话"), "hide thread-only shortcuts on Home");
assert.ok(!text(dialog.render()).includes("复制当前工作目录"), "hide workspace-only shortcuts without a workspace");
input().props.onChange({ target: { value: "模型" } });
assert.ok(text(dialog.render()).includes("模型"));
assert.ok(!text(dialog.render()).includes("Ctrl+N"), "query must filter unrelated bindings");
input().props.onChange({ target: { value: "CTRL+N" } });
assert.ok(text(dialog.render()).includes("Ctrl+N"), "search must be case-insensitive");
input().props.onChange({ target: { value: "NO-PARITY-MATCH" } });
assert.ok(text(dialog.render()).includes("没有匹配的快捷键"));
const dialogNode = () => dialog.find(n => n.type === "dialog");
dialog.key(dialogNode(), "Escape", { nativeEvent: { isComposing: true } });
assert.equal(input().props.value, "NO-PARITY-MATCH", "IME Escape must not clear search or close the dialog");
dialog.key(dialogNode(), "Escape");
assert.equal(closed, 0, "nonempty Escape clears search only");
assert.equal(input().props.value, "");
dialog.key(dialogNode(), "Escape");
assert.equal(closed, 1);
const event = dialog.key(dialogNode(), "n");
assert.equal(event.stopped, true, "dialog must stop global business shortcuts while searching");
const threadDialog = mount("src/components/KeyboardShortcutsDialog.tsx", {
  onClose() {}, hasActiveThread: true, hasWorkspace: false,
}, { "../shortcuts": shortcut });
assert.ok(text(threadDialog.render()).includes("重命名当前会话"), "show thread-only shortcuts for an active thread");
assert.ok(text(threadDialog.render()).includes("归档当前会话"));
assert.ok(!text(threadDialog.render()).includes("复制当前工作目录"), "workspace shortcut still requires workspace context");
assert.deepEqual(
  shortcut.availableShortcuts({ hasActiveThread: false, hasWorkspace: false }).map(item => item.id),
  shortcut.SHORTCUTS.filter(item => !["find-in-chat", "rename-thread", "pin-thread", "archive-thread", "fork-thread", "copy-last-code-block", "copy-working-dir"].includes(item.id)).map(item => item.id),
  "Home without workspace omits only context-dependent entries",
);
console.log("PASS actual searchable keyboard dialog and registered Ctrl+/ (L2)");

const app = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let commandHandler, keyboardHandler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === "handleAppCommand") commandHandler = node.initializer.arguments[0].getText(app);
  if (ts.isPropertyAssignment(node) && node.name.getText(app) === '"show-keyboard-shortcuts"') keyboardHandler = node.initializer.getText(app);
  ts.forEachChild(node, visit);
}
visit(app);
const invokes = [], toasts = [], dialogs = [];
let rejectOpen = false;
const context = vm.createContext({
  shortcutHandlersRef: { current: {} }, setShowKeyboardShortcuts: fn => dialogs.push(fn),
  keyboardShortcutsOpenRef: { current: false },
  tauriInvoke: async (command, args) => { invokes.push([command, args]); if (rejectOpen) throw Error("isolated browser failure"); },
  showAppToast: (...args) => toasts.push(args),
});
vm.runInContext(transpile(`var handler = ${commandHandler}; shortcutHandlersRef.current["show-keyboard-shortcuts"] = ${keyboardHandler};`), context);
await context.handler("user-guide"); await context.handler("changelog");
assert.equal(invokes[0][0], "open_help_link");
assert.equal(invokes[0][1].target, "guide");
assert.equal(invokes[1][1].target, "changelog");
rejectOpen = true; await context.handler("user-guide");
assert.ok(toasts.some(args => args[1] === "error"), "browser failure must remain visible");
await context.handler("show-keyboard-shortcuts");
assert.equal(dialogs.length, 1);
let newChats = 0;
context.shortcutHandlersRef.current["new-chat"] = () => { newChats++; };
context.keyboardShortcutsOpenRef.current = true;
await context.handler("new-chat");
assert.equal(newChats, 0, "native accelerator must not change the chat while the dialog is open");
await context.handler("show-keyboard-shortcuts");
assert.equal(dialogs.length, 2, "the dialog toggle must remain active");
context.keyboardShortcutsOpenRef.current = false;
await context.handler("new-chat");
assert.equal(newChats, 1);
console.log("PASS production Help command callbacks: native targets, error feedback and keyboard dialog (L2)");

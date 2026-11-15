import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(fs.readFileSync("src/components/ComposerBox.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const all = node => node && typeof node === "object" ? [node, ...node.children.flatMap(all)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "string" ? node : "";
function mount(variant = "thread") {
  const hooks = [], effects = [], elements = new Map(), frames = [], calls = [];
  let cursor = 0, tree, active;
  const doc = {
    get activeElement() { return active; },
    hasFocus: () => true,
    addEventListener() {}, removeEventListener() {},
  };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState(initial) {
      const i = cursor++; if (!(i in hooks)) hooks[i] = initial;
      return [hooks[i], value => { hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }];
    },
    useMemo(fn) { cursor++; return fn(); },
    useRef(initial) { const i = cursor++; return hooks[i] ??= { current: initial }; },
    useLayoutEffect() { cursor++; },
    useEffect(fn, deps) {
      const i = cursor++, previous = hooks[i];
      if (!previous || deps.some((d, index) => previous.deps[index] !== d)) {
        previous?.cleanup?.();
        hooks[i] = { deps };
        effects.push(() => { hooks[i].cleanup = fn(); });
      }
    },
  };
  const props = {
    composerEnterBehavior: "enter", variant, promptInput: "", isStreaming: false,
    activeWorkspace: { label: "Alpha", path: "D:/alpha" },
    workspaces: [{ label: "Alpha", path: "D:/alpha" }, { label: "Beta", path: "D:/beta" }],
    gitStatus: { isGitRepo: true, branch: "main" }, gitBranches: ["main", "feature"],
    useWorktree: false, permissionMode: "ask", attachedFiles: [], models: [], skills: [],
    workspaceFiles: [], workspaceFileHits: [],
  };
  for (const name of ["onSelectWorkspace", "onPickNewFolder", "onSetUseWorktree", "onAttachFiles",
    "onCreateBranch", "onSwitchBranch", "onPromptInputChange", "onTogglePlanMode", "onSelectPermissionMode", "onSendMessage"]) {
    props[name] = (...args) => calls.push([name, ...args]);
  }
  const mod = { exports: {} };
  vm.runInNewContext(code, {
    exports: mod.exports, document: doc, console,
    window: { innerWidth: 960, addEventListener() {}, removeEventListener() {} },
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
    cancelAnimationFrame() {},
    require: name => name === "react" ? react :
      name === "../bridge" ? { isTauriRuntime: () => false } :
      name === "../fsClient" ? { baseNameFsPath: path => path.split("/").pop() } :
      name === "./Icons" ? new Proxy({}, { get: (_, key) => String(key) }) : {},
  });
  const element = node => {
    if (!node || typeof node !== "object") return null;
    const id = node.props.id ?? `${node.type}:${node.props.title ?? node.props["aria-label"] ?? text(node)}`;
    if (!elements.has(id)) elements.set(id, {
      focus() { active = this; }, scrollIntoView() {},
      style: {},
      getBoundingClientRect: () => ({ top: 500, left: 100, right: 440 }),
    });
    const el = elements.get(id); el.node = node;
    el.matches = selector => selector.includes("input") && node.type === "input";
    el.querySelectorAll = () => all(node).filter(n => ["button", "input"].includes(n.type) && !n.props.disabled).map(element);
    el.contains = target => el === target || all(node).some(n => n !== node && element(n) === target);
    return el;
  };
  const render = () => {
    cursor = 0; tree = mod.exports.ComposerBox(props);
    for (const node of all(tree)) {
      if (node.props.ref) {
        const el = element(node);
        typeof node.props.ref === "function" ? node.props.ref(el) : node.props.ref.current = el;
      }
    }
    for (const fn of effects.splice(0)) fn();
    for (const fn of frames.splice(0)) fn();
    return tree;
  };
  const find = predicate => all(tree).find(predicate);
  const trigger = title => find(n => n.type === "button" && n.props.title?.includes(title));
  const key = (node, key, extra = {}) => {
    const event = {
      key, nativeEvent: {}, currentTarget: element(node), target: active ?? element(node),
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra,
    };
    node.props.onKeyDown(event); render(); return event;
  };
  render();
  return { render, find, trigger, element, key, calls, props, get active() { return active; } };
}
{
  const view = mount("home");
  view.props.onSetUseWorktree = value => {
    view.calls.push(["onSetUseWorktree", value]);
    view.props.useWorktree = value;
  };
  for (const next of [true, false]) {
    assert.equal(view.find(n => n.type === "input" && n.props.type === "checkbox"), undefined,
      "the local/worktree picker layout must not mix in the alternate utility-bar checkbox");
    const trigger = view.trigger("选择聊天的运行位置");
    assert.equal(text(trigger), view.props.useWorktree ? "新工作树" : "本地");
    view.key(trigger, "ArrowDown");
    assert.ok(view.find(n => n.props.className === "popover-section-label" && text(n) === "工作位置"));
    const option = view.find(n => n.props.role === "menuitemradio" && text(n) === (next ? "新建本地工作树" : "本地"));
    assert.ok(option);
    assert.equal(option.props["aria-checked"], false);
    option.props.onClick(); view.render();
    assert.equal(view.find(n => n.props.role === "menu"), undefined);
    assert.equal(text(view.trigger("选择聊天的运行位置")), next ? "新工作树" : "本地");
  }
  assert.deepEqual(view.calls, [["onSetUseWorktree", true], ["onSetUseWorktree", false]],
    "the remaining execution-location picker must switch once per selection");
}
console.log("PASS home execution location: coherent picker layout, official labels, local/worktree round-trip and close");

for (const patch of [{ activeWorkspace: null, gitStatus: null }, { gitStatus: { isGitRepo: false, branch: null } }, { gitStatus: { isGitRepo: true, branch: null } }]) {
  const view = mount();
  Object.assign(view.props, patch); view.render();
  assert.equal(view.trigger("切换或新建 Git 分支"), undefined,
    "failed projectless draft, plain directory and unknown branch must not invent main or offer a branch target");
}
{
  const view = mount();
  view.props.gitStatus.branch = "HEAD (abc123)"; view.render();
  assert.match(text(view.trigger("切换或新建 Git 分支")), /HEAD \(abc123\)/, "real detached state retains its reported identity");
}

for (const variant of ["home", "thread"]) {
  const view = mount(variant);
  view.props.promptInput = "preserved draft";
  view.props.submissionDisabled = true;
  view.render();
  assert.equal(view.find(n => n.props.className === "send-action-btn").props.disabled, true,
    "the send button must reflect the same unavailable state as keyboard submission");
  view.props.submissionDisabled = false; view.render();
  assert.equal(view.find(n => n.props.className === "send-action-btn").props.disabled, false);
}

for (const variant of ["home", "thread"]) {
  const view = mount(variant);
  assert.equal(view.find(n => n.type === "button" && n.props["aria-label"] === "计划"), undefined);
  view.props.planMode = true;
  view.props.fastMode = true;
  view.props.onTogglePlanMode = () => { view.calls.push(["onTogglePlanMode"]); view.props.planMode = false; };
  view.render();
  const indicator = view.find(n => n.type === "button" && n.props["aria-label"] === "计划");
  assert.ok(indicator, `${variant}: active plan must be a keyboard-accessible footer button`);
  assert.equal(indicator.props.type, "button", "Enter/Space use native button semantics, never form submit");
  assert.equal(indicator.props.title, "创建计划");
  assert.equal(text(indicator), "计划");
  const footer = view.find(n => n.props.className === "composer-bottom-left");
  assert.ok(all(footer).includes(indicator), "plan indicator belongs in the composer footer");
  const top = view.find(n => n.props.className === "composer-context-right");
  assert.doesNotMatch(text(top), /计划模式|🗺️/);
  assert.match(text(top), /Fast/, "unresearched Fast indicator remains unchanged");
  indicator.props.onClick(); view.render();
  assert.deepEqual(view.calls, [["onTogglePlanMode"]], "one click exits plan without sending or changing work location");
  assert.equal(view.find(n => n.type === "button" && n.props["aria-label"] === "计划"), undefined);
}
console.log("PASS active plan footer: home/thread visibility, button/label/tooltip, footer placement and single exit action");

for (const title of ["当前项目", "选择聊天的运行位置", "切换或新建", "添加文件", "更改权限"]) {
  const view = mount();
  let trigger = view.trigger(title);
  assert.equal(trigger.props["aria-haspopup"], "menu", `${title} needs a real keyboard/menu entry`);
  view.key(trigger, "ArrowDown");
  let menu = view.find(n => n.props.role === "menu");
  assert.ok(menu, `${title}: ArrowDown must open`);
  const controls = view.element(menu).querySelectorAll();
  assert.equal(view.active, controls[0]);
  if (controls[0].node.type === "input") {
    const end = view.key(menu, "End");
    assert.equal(end.prevented, undefined, "Home/End in search must remain text editing");
    view.key(menu, "ArrowDown");
  }
  view.key(menu, "End");
  assert.equal(view.active, controls.at(-1));
  view.key(menu, "ArrowDown");
  assert.equal(view.active, controls[0]);
  const escape = view.key(menu, "Escape");
  assert.equal(escape.prevented, true);
  assert.equal(escape.stopped, true);
  assert.equal(view.find(n => n.props.role === "menu"), undefined);
  assert.equal(view.active, view.element(view.trigger(title)));
  view.key(view.trigger(title), "ArrowUp");
  menu = view.find(n => n.props.role === "menu");
  assert.equal(view.active, view.element(menu).querySelectorAll().at(-1));
  view.key(menu, "Escape", { nativeEvent: { isComposing: true } });
  assert.ok(view.find(n => n.props.role === "menu"), "IME Escape must not close");
  const tab = view.key(view.find(n => n.props.role === "menu"), "Tab");
  assert.equal(tab.prevented, undefined, "Tab must retain browser focus traversal");
  assert.equal(view.find(n => n.props.role === "menu"), undefined);
  assert.deepEqual(view.calls, [], "menu navigation must not perform business actions");
}
{
  const view = mount();
  view.key(view.trigger("当前项目"), "ArrowDown");
  const input = view.find(n => n.type === "input" && n.props.placeholder === "搜索项目");
  assert.ok(input, "official project picker has a search input");
  input.props.onChange({ target: { value: "BETA" } }); view.render();
  assert.equal(view.find(n => n.props.role === "menuitemradio" && text(n).includes("Alpha")), undefined);
  const beta = view.find(n => n.props.role === "menuitemradio" && text(n).includes("Beta"));
  beta.props.onClick(); view.render();
  assert.deepEqual(view.calls, [["onSelectWorkspace", "D:/beta"]]);
}
{
  const view = mount();
  view.key(view.trigger("切换或新建"), "ArrowDown");
  const input = view.find(n => n.type === "input" && n.props.placeholder?.includes("新建分支"));
  input.props.onChange({ target: { value: "new-branch" } }); view.render();
  const current = view.find(n => n.type === "input" && n.props.placeholder?.includes("新建分支"));
  view.key(current, "Enter", { nativeEvent: { isComposing: true } });
  assert.deepEqual(view.calls, [], "IME Enter cannot create a branch");
}
console.log("PASS production Composer menus: five keyboard entries, focus cycling, Escape/Tab/IME, project search and single selection (CK01-CK07, L2)");

const modelAst = ts.createSourceFile("ModelSelector.tsx", fs.readFileSync("src/components/ModelSelector.tsx", "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let modelKeys, modelListOpen;
function visitModel(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(modelAst) === "handleMenuKeys") modelKeys = node.initializer;
  if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute =>
    attribute.name?.getText(modelAst) === "className" && attribute.initializer?.text === "model-compact-current")) {
    modelListOpen = node.openingElement.attributes.properties.find(attribute => attribute.name?.getText(modelAst) === "onClick").initializer.expression;
  }
  ts.forEachChild(node, visitModel);
}
visitModel(modelAst);
assert.ok(modelKeys);
let modelClosed = 0;
const handleModelKeys = vm.runInNewContext(ts.transpileModule(`(${modelKeys.getText(modelAst)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText, { open: true, closeMenu: () => modelClosed++ });
for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }]) {
  handleModelKeys({ key: "Escape", nativeEvent, preventDefault() {}, stopPropagation() {} });
  assert.equal(modelClosed, 0, "model menu must not consume IME Escape");
}
let modelPrevented = false;
handleModelKeys({
  key: "ArrowRight", nativeEvent: {},
  target: { matches: selector => selector === 'input[type="range"]' },
  preventDefault() { modelPrevented = true; },
});
assert.equal(modelPrevented, false, "reasoning slider keeps its native arrow keys");
handleModelKeys({ key: "Escape", nativeEvent: {}, preventDefault() {}, stopPropagation() {} });
assert.equal(modelClosed, 1);
{
  const document = { activeElement: null };
  const items = [0, 1, 2].map(index => ({ index, focus() { document.activeElement = this; } }));
  const menuRef = { current: { contains: () => true, querySelectorAll: () => items } };
  const keys = vm.runInNewContext(ts.transpileModule(`(${modelKeys.getText(modelAst)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { open: true, closeMenu() { throw Error("Tab must not dismiss the official DropdownMenu"); }, menuRef, document });
  for (const [start, shiftKey, expected] of [[2, false, 0], [0, true, 2], [0, false, 1]]) {
    document.activeElement = items[start];
    const event = { key: "Tab", shiftKey, nativeEvent: {},
      target: { closest: () => items[start], matches: () => false },
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    keys(event);
    assert.equal(event.prevented, true, "official model DropdownMenu prevents Tab from leaving its content");
    assert.equal(document.activeElement, items[expected], "Tab/Shift+Tab loop through interactive menuitems");
  }
  document.activeElement = "slider";
  const slider = { key: "Tab", nativeEvent: {}, target: { closest: () => null, matches: () => true },
    preventDefault() { this.prevented = true; }, stopPropagation() {} };
  keys(slider);
  assert.equal(slider.prevented, true);
  assert.equal(document.activeElement, "slider", "slider Tab is blocked without changing its value or focus");
  const composing = { ...slider, prevented: false, nativeEvent: { isComposing: true } };
  keys(composing);
  assert.equal(composing.prevented, false, "IME Tab remains an input-method key");
}
console.log("PASS production model menu: IME Escape guard, ordinary Escape and native reasoning slider keys (CK08, L2)");
for (const available of [true, false]) {
  let focused = "current";
  const enabled = { focus() { focused = "enabled"; } }, disabled = { focus() {} };
  const menu = { focus() { focused = "menu"; }, querySelector(selector) {
    return selector.includes(":not(:disabled)") ? available ? enabled : null : disabled;
  } };
  const openList = vm.runInNewContext(ts.transpileModule(`(${modelListOpen.getText(modelAst)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { setView() { focused = "body"; }, requestAnimationFrame: frame => frame(), menuRef: { current: menu } });
  openList();
  assert.equal(focused, available ? "enabled" : "menu", "model list skips disabled choices and keeps an empty/loading list keyboard reachable");
}

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const matcher = { exports: {} };
vm.runInNewContext(compile("src/chatSearchMatch.ts"), { exports: matcher.exports });
const source = compile("src/components/WorkspacePopover.tsx");
const nodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "string" ? node : "";
function assertControlledOption(tree) {
  const search = nodes(tree).find(node => node.props.role === "combobox");
  const activeId = search.props["aria-activedescendant"];
  if (!activeId) return;
  const list = nodes(tree).find(node => node.props.role === "listbox" && node.props.id === search.props["aria-controls"]);
  const active = nodes(list).find(node => node.props.id === activeId);
  assert.ok(active, "active descendant must belong to the combobox's controlled listbox, including footer actions");
  assert.equal(active.props.role, "option");
  assert.equal(active.props["aria-selected"], true);
}
const projects = [
  { id: "alpha", path: "D:/alpha", label: "Alpha Project", active: false },
  { id: "beta", path: "D:/beta", label: "Beta Work", active: true },
  { id: "other", path: "D:/other", label: "Alpha Project", active: false },
];

function mount({ activeWorkspacePath = "D:/beta", activeProjectId, workspaces = projects,
  triggerRect = { left: 300, top: 300, bottom: 330, width: 150 },
  popoverRect = { width: 260, height: 160 } } = {}) {
  const slots = [], effects = [], listeners = new Map(), calls = [], dom = new Map(), frames = [];
  const windowListeners = new Map();
  let cursor = 0, tree, appFocused = true, resizeCallback, disconnected = false;
  const document = { activeElement: null,
    body: {}, hasFocus: () => appFocused,
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: type => listeners.delete(type),
  };
  const element = (id, inside = true) => {
    if (!dom.has(id)) dom.set(id, { id, inside, isConnected: true, style: {},
      getBoundingClientRect: () => id === "trigger" ? triggerRect : popoverRect,
      focus() { document.activeElement = this; this.node?.props.onFocus?.(); }, scrollIntoView() {},
      contains(target) { return target === this || target?.inside === true; }, querySelector() { return null; } });
    return dom.get(id);
  };
  const trigger = element("trigger", false), composer = element("composer", false);
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
    useId: () => "home-project-test",
    useMemo: callback => callback(),
    useEffect: (callback, deps) => {
      const i = cursor++;
      if (!slots[i] || deps.some((value, index) => value !== slots[i].deps[index])) {
        const previous = slots[i]; slots[i] = { deps, cleanup: previous?.cleanup };
        effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = callback(); });
      }
    },
  };
  const module = { exports: {} };
  react.useLayoutEffect = react.useEffect;
  const window = { innerWidth: 800, innerHeight: 600,
    addEventListener: (type, handler) => windowListeners.set(type, handler),
    removeEventListener: type => windowListeners.delete(type),
  };
  vm.runInNewContext(source, {
    exports: module.exports,
    require: name => name === "react" ? react : name === "react-dom" ? { createPortal: node => node }
      : name === "../chatSearchMatch" ? matcher.exports : {},
    document, window, requestAnimationFrame: callback => frames.push(callback),
    ResizeObserver: class { constructor(callback) { resizeCallback = callback; } observe() {} disconnect() { disconnected = true; } },
  });
  const props = { workspaces, activeWorkspacePath, activeProjectId, triggerRef: { current: trigger }, composerRef: { current: composer },
    onSelectWorkspace: (path, projectId) => calls.push(["select", path, projectId]), onCreateProject: () => calls.push(["create"]),
    onClearProject: () => calls.push(["clear"]), onClose: () => calls.push(["close"]),
  };
  const render = () => {
    cursor = 0; tree = module.exports.WorkspacePopover(props);
    for (const [index, node] of nodes(tree).entries()) {
      if (!node.props.ref) continue;
      const refElement = element(node.props.id ?? (node.props.role === "combobox" ? "search" : node.type === "button" ? text(node) : `element-${index}`));
      refElement.node = node;
      node.props.ref.current = refElement;
    }
    for (const effect of effects.splice(0)) effect();
    return tree;
  };
  const find = predicate => nodes(render()).find(predicate);
  const input = () => find(node => node.props.role === "combobox");
  const options = () => nodes(render()).filter(node => node.type === "div" && node.props.role === "option");
  const root = () => render();
  const key = (key, extra = {}) => {
    const event = { key, nativeEvent: {}, target: document.activeElement, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
    root().props.onKeyDown(event);
    render(); assertControlledOption(tree); return event;
  };
  render();
  return { calls, props, document, dom, trigger, composer, input, options, key, find, root,
    query: value => { input().props.onChange({ target: { value } }); render(); assertControlledOption(tree); },
    dispatch: (type, target) => listeners.get(type)?.({ target }),
    focus: label => { const node = find(node => node.type === "button" && text(node) === label); node.props.ref.current.focus(); },
    frames: () => { for (const callback of frames.splice(0)) callback(); },
    unmount: () => { for (const slot of slots) slot?.cleanup?.(); },
    listenerCount: () => listeners.size,
    windowListenerCount: () => windowListeners.size, disconnected: () => disconnected,
    appFocus: value => { appFocused = value; },
    resize: (width, height) => { window.innerWidth = width; window.innerHeight = height; windowListeners.get("resize")?.(); },
    scroll: () => windowListeners.get("scroll")?.(), observer: () => resizeCallback?.(),
  };
}

const initial = mount();
assert.ok(initial.input(), "title project picker must expose the sourced search combobox");
assert.equal(initial.root().props.id, "home-project-picker");
assert.equal(initial.root().props.role, "dialog");
assert.equal(initial.document.activeElement, initial.input().props.ref.current);
assert.equal(initial.input().props.placeholder, "搜索项目");
assert.equal(initial.find(node => node.props.role === "listbox").props.id, initial.input().props["aria-controls"]);
assert.equal(initial.options().length, 3);
assert.equal(initial.options()[0].props["aria-selected"], true, "first result receives keyboard highlight independently of current project");
assertControlledOption(initial.root());
assert.equal(initial.options()[1].props["data-current"], true);
assert.equal(initial.options()[0].props.tabIndex, undefined, "project options do not consume Tab stops");
assert.equal(initial.options()[0].props.title, "D:/alpha", "duplicate labels have path tooltips");
assert.equal(text(initial.options()[0]).includes("D:/alpha"), false, "full paths are not permanently rendered");
initial.key("ArrowUp");
assert.equal(initial.options()[0].props["aria-selected"], true);
initial.key("End");
assert.equal(initial.key("ArrowDown").prevented, true);
initial.key("Home"); initial.key("ArrowDown"); initial.key("Enter"); initial.frames();
assert.deepEqual(initial.calls, [["select", "D:/beta", "beta"], ["close"]]);
assert.equal(initial.document.activeElement, initial.composer);
initial.unmount();

const filter = mount();
filter.query("AP");
assert.equal(filter.options().length, 2, "production fuzzy matcher supports separated project initials");
assert.deepEqual(filter.options().map(node => node.props.key), ["alpha", "other"], "equal match scores retain source ordering");
filter.query("D:/beta");
assert.equal(filter.options().length, 1, "project path is searchable even when hidden");
filter.query("does-not-exist");
assert.equal(filter.options().length, 0);
assert.ok(text(filter.root()).includes("未找到项目"));
filter.key("Enter");
assert.equal(filter.calls.length, 0, "empty search must not activate a footer without explicit navigation");
filter.key("ArrowDown"); filter.key("Enter");
assert.deepEqual(filter.calls, [["close"], ["create"]]);
filter.unmount();

const ime = mount();
ime.key("End", { nativeEvent: { isComposing: true } });
ime.key("ArrowDown", { nativeEvent: { keyCode: 229 } });
ime.key("Enter", { nativeEvent: { isComposing: true } });
ime.key("Escape", { nativeEvent: { isComposing: true } });
assert.equal(ime.options()[0].props["aria-selected"], true);
assert.equal(ime.calls.length, 0);
ime.key("Tab", { shiftKey: true });
assert.equal(ime.document.activeElement, ime.find(node => node.type === "button" && text(node) === "不在项目中工作").props.ref.current);
ime.key("Tab");
assert.equal(ime.document.activeElement, ime.input().props.ref.current);
ime.key("Tab");
assert.equal(ime.document.activeElement, ime.find(node => node.type === "button" && text(node) === "新建项目").props.ref.current);
ime.key("Escape");
assert.deepEqual(ime.calls, [["close"]]);
assert.equal(ime.document.activeElement, ime.trigger);
ime.unmount();
assert.equal(ime.listenerCount(), 0);

const clear = mount();
clear.find(node => node.type === "button" && text(node) === "不在项目中工作").props.onClick(); clear.frames();
assert.deepEqual(clear.calls, [["clear"], ["close"]]);
assert.equal(clear.document.activeElement, clear.composer);
clear.unmount();
const footerNavigation = mount();
footerNavigation.focus("新建项目");
footerNavigation.key("ArrowUp");
footerNavigation.key("Enter");
assert.deepEqual(footerNavigation.calls, [["select", "D:/other", "other"], ["close"]], "direction keys from a Tab-focused footer change the Enter target");
footerNavigation.unmount();
const projectless = mount({ activeWorkspacePath: "" });
assert.equal(projectless.find(node => node.type === "button" && text(node) === "不在项目中工作"), undefined);
projectless.unmount();
for (const event of ["mousedown", "focusin"]) {
  const outside = mount();
  const target = { inside: false, focus() {} };
  outside.document.activeElement = target;
  outside.dispatch(event, target); outside.frames();
  assert.deepEqual(outside.calls, [["close"]]);
  assert.equal(outside.document.activeElement, target, "outside interaction keeps its legitimate focus target");
  outside.unmount();
}
const retrigger = mount();
retrigger.dispatch("mousedown", retrigger.trigger);
retrigger.dispatch("focusin", retrigger.trigger);
assert.deepEqual(retrigger.calls, [], "the trigger's own toggle closes once, outside handlers must not close then reopen it");
retrigger.unmount();

for (const operation of ["escape", "select"]) {
  const inactive = mount();
  inactive.appFocus(false);
  const before = inactive.document.activeElement;
  inactive.key(operation === "escape" ? "Escape" : "Enter"); inactive.frames();
  assert.equal(inactive.document.activeElement, before, "closing cannot steal focus after the application loses focus");
  inactive.unmount();
  const detached = mount();
  detached.trigger.isConnected = false;
  detached.composer.isConnected = false;
  const previous = detached.document.activeElement;
  detached.key(operation === "escape" ? "Escape" : "Enter"); detached.frames();
  assert.equal(detached.document.activeElement, previous, "detached targets never receive focus");
  detached.unmount();
}
const positioned = mount();
assert.equal(positioned.root().props.ref.current.style.position, "fixed");
assert.equal(positioned.root().props.ref.current.style.top, "135px", "prefer top with the sourced five-pixel offset");
assert.equal(positioned.root().props.ref.current.style.left, "245px", "center on the title trigger");
positioned.resize(280, 600);
assert.equal(positioned.root().props.ref.current.style.left, "14px", "shift inside six-pixel viewport padding");
positioned.scroll(); positioned.observer();
positioned.unmount();
assert.equal(positioned.windowListenerCount(), 0);
assert.equal(positioned.disconnected(), true);
const flipped = mount({ triggerRect: { left: 20, top: 40, bottom: 70, width: 100 } });
assert.equal(flipped.root().props.ref.current.style.top, "75px", "insufficient top space flips below the trigger");
flipped.unmount();
const delayedFocus = mount();
const focusedBeforeClose = delayedFocus.document.activeElement;
delayedFocus.key("Enter");
delayedFocus.appFocus(false); delayedFocus.frames();
assert.equal(delayedFocus.document.activeElement, focusedBeforeClose, "check application focus at animation-frame time");
delayedFocus.unmount();
const movableAnchor = { left: 300, top: 300, bottom: 330, width: 150 };
const scrolled = mount({ triggerRect: movableAnchor });
movableAnchor.top = 40; movableAnchor.bottom = 70;
scrolled.scroll();
assert.equal(scrolled.root().props.ref.current.style.top, "75px", "scroll updates the actual anchor position");
scrolled.unmount();
const constrained = mount({ popoverRect: { width: 260, height: 500 } });
assert.equal(constrained.root().props.ref.current.style.maxHeight, "289px", "maximum height respects actual available space");
constrained.unmount();
const sharedRoot = [
  { id: "local-one", path: "D:/shared", label: "One", active: true },
  { id: "local-two", path: "D:/shared", label: "Two", active: true },
];
for (const index of [0, 1]) {
  const entities = mount({ workspaces: sharedRoot, activeWorkspacePath: "D:/shared", activeProjectId: "local-two" });
  assert.equal(entities.options().length, 2);
  assert.equal(entities.options()[0].props["data-current"], undefined);
  assert.equal(entities.options()[1].props["data-current"], true);
  assert.deepEqual(entities.options().map(node => node.props.key), ["local-one", "local-two"]);
  entities.options()[index].props.onClick();
  assert.deepEqual(entities.calls, [["select", "D:/shared", sharedRoot[index].id], ["close"]], "same-root projects must select their distinct entity IDs");
  entities.unmount();
}
const sorted = mount({ workspaces: [
  { id: "lower", path: "D:/long", label: "Alpha Project" },
  { id: "higher", path: "D:/exact", label: "AP" },
] });
sorted.query("AP");
assert.deepEqual(sorted.options().map(node => node.props.key), ["higher", "lower"], "query results sort by match quality instead of source order");
sorted.unmount();
const pathScore = mount({ workspaces: [
  { id: "label-match", path: "D:/unrelated", label: `${"Z".repeat(80)} AP` },
  { id: "path-match", path: "D:/AP", label: "Unrelated" },
] });
pathScore.query("AP");
assert.deepEqual(pathScore.options().map(node => node.props.key), ["path-match", "label-match"], "ranking uses the best available field score");
pathScore.unmount();
for (const [label, query] of [["Café", "Cafe\u0301"], ["Cafe\u0301", "Café"]]) {
  const normalized = mount({ workspaces: [{ id: "normalized", path: "D:/unicode", label }] });
  normalized.query(query);
  assert.equal(normalized.options().length, 1, "canonical Unicode spellings match through NFC fallback");
  normalized.unmount();
}
console.log("PASS homepage project picker: production fuzzy scoring/NFC fallback, distinct same-root project IDs, independent current selection, bounded navigation, Tab loop, IME, footer contracts, positioning, focus restoration and dismissal");

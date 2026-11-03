import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const all = node => node && typeof node === "object" ? [node, ...(node.children || []).flatMap(all)] : [];
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
function mount(name, initial) {
  const hooks = [], effects = [], cache = new Map(), listeners = new Set(), frames = [];
  let cursor = 0, tree, active = null;
  const props = { ...initial };
  const react = {
    Fragment: "fragment",
    createElement: (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat(Infinity) }),
    useState(value) { const i = cursor++; if (!(i in hooks)) hooks[i] = value; return [hooks[i], value => { hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }]; },
    useRef(value) { const i = cursor++; return hooks[i] ??= { current: value }; },
    useMemo(fn) { cursor++; return fn(); }, useId() { cursor++; return "test-menu"; },
    useLayoutEffect() { cursor++; },
    useEffect(fn, deps) { const i = cursor++, prev = hooks[i]; if (!prev || deps?.some((v, j) => v !== prev.deps[j])) { prev?.cleanup?.(); hooks[i] = { deps }; effects.push(() => { hooks[i].cleanup = fn(); }); } },
  };
  const document = { get activeElement() { return active; }, hasFocus: () => true, addEventListener() {}, removeEventListener() {} };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { exports, document, console, Promise,
      requestAnimationFrame(fn) { frames.push(fn); return frames.length; }, cancelAnimationFrame() {},
      window: { addEventListener(type, fn) { if (type === "codex:keyboard-command") listeners.add(fn); }, removeEventListener(type, fn) { listeners.delete(fn); } },
      require: id => id === "react" ? react : id.endsWith(".css") || id.endsWith("Icons") ? {} :
        id.includes("ComposerAutocomplete") ? { getAutocompleteItems: () => [{ id: "model", type: "slash", action: "open_model_picker", insertText: "" }] } :
        id.includes("ModelSelector") || id.includes("AttachmentChip") ? {} :
        id.endsWith("/bridge") ? { isTauriRuntime: () => false } : id.endsWith("/fsClient") ? { baseNameFsPath: p => p.split("/").at(-1) } :
        load(path.resolve(path.dirname(file), id + ".ts")),
    }, { filename: file });
    return exports;
  }
  const Component = load(path.resolve("src/components", name + ".tsx"))[name];
  const elements = new Map();
  function element(node) {
    if (!elements.has(node)) elements.set(node, { node, focus() { active = this; },
      matches(selector) { return node.tag === "input" && selector.includes(`input[type="${node.props.type}"]`); },
      contains(target) { return all(node).some(n => element(n) === target); },
      closest(selector) { return selector.includes("menu") && node.props.role === "menu" ? this : null; },
      querySelectorAll() { return all(node).filter(n => ["button", "input"].includes(n.tag) && !n.props.disabled).map(element); },
      querySelector(selector) { const n = all(node).find(n => n.props.className?.split(" ").includes(selector.slice(1))); return n ? element(n) : null; },
    });
    return elements.get(node);
  }
  function render() {
    cursor = 0; tree = Component(props);
    for (const node of all(tree)) if (node.props.ref) node.props.ref.current = element(node);
    effects.splice(0).forEach(fn => fn()); frames.splice(0).forEach(fn => fn());
  }
  render();
  return { props, render, all: () => all(tree), find: predicate => all(tree).find(predicate),
    focus(predicate) { const node = all(tree).find(predicate); assert.ok(node); active = element(node); },
    active: () => active?.node,
    command(id) { const event = { detail: { id }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; for (const fn of listeners) fn(event); return event.defaultPrevented; },
    key(key, composing = false) { const event = { key, target: active || { matches: () => false }, nativeEvent: { isComposing: composing }, preventDefault() {}, stopPropagation() {} }; tree.props.onKeyDown(event); frames.splice(0).forEach(fn => fn()); },
  };
}
const models = [
  { id: "a-id", model: "a-wire", displayName: "Model A", isDefault: true, defaultReasoningEffort: "low", supportedReasoningEfforts: ["low", "high"], serviceTiers: [{ id: "swift", name: "fast" }] },
  { id: "b-id", model: "b-wire", displayName: "Model B", defaultReasoningEffort: "medium", supportedReasoningEfforts: ["medium"] },
];
const chosen = [];
const picker = mount("ModelSelector", { models, selectedModelId: "a-wire", reasoningEffort: "high", serviceTier: "swift", serviceTierAccess: { fast: true, ultrafast: false },
  fastMode: true, defaultModelSelected: false, open: true, recentOpen: false, onOpenChange(value) { picker.props.open = value; },
  onSelectModel() {}, onSelectReasoningEffort() {}, onToggleFastMode() {}, onSelectConfiguration: config => chosen.push(config),
});
const swift = picker.find(n => n.props.role === "menuitemradio" && text(n).includes("fast"));
assert.ok(swift); assert.equal(swift.props["aria-checked"], true); swift.props.onClick();
assert.equal(chosen.at(-1).serviceTier, "swift", "real tier id must survive selection");
picker.props.serviceTierAccess = null; picker.render();
assert.equal(picker.find(n => n.props.role === "menuitemradio" && text(n).includes("fast")).props.disabled, true);
picker.props.selectionPending = true; picker.props.selectionError = "write rejected"; picker.render();
assert.ok(picker.find(n => n.props.role === "alert" && text(n).includes("write rejected")));
assert.equal(picker.find(n => n.tag === "input" && n.props.type === "range").props.disabled, true);
console.log("PASS MC-B04/11 JSX: real custom fast id, unknown account access disabled, pending controls and visible save error");

picker.props.selectionPending = false; picker.props.selectionError = null; picker.props.serviceTierAccess = { fast: true, ultrafast: false };
picker.props.recentOpen = true;
picker.props.recentModelConfigurations = [
  { model: "missing", reasoningEffort: "high", serviceTier: null },
  { model: "b-wire", reasoningEffort: "ultra", serviceTier: null },
  { model: "a-wire", reasoningEffort: "low", serviceTier: null },
  { model: "a-wire", reasoningEffort: "low", serviceTier: null },
];
picker.render();
let recent = picker.all().filter(n => n.props.role === "menuitem");
assert.equal(recent.length, 3, "history + current + valid catalog defaults, de-duplicated and capped at three");
assert.equal(text(recent[0]), "Model A低"); assert.equal(text(recent[1]), "Model A高 · fast");
recent[0].props.onClick(); assert.equal(chosen.at(-1).model, "a-wire"); assert.equal(chosen.at(-1).reasoningEffort, "low");
assert.equal(picker.props.recentModelConfigurations.length, 4, "picker must not mutate history");
picker.props.open = true; picker.render();
picker.find(n => n.tag === "input" && n.props.type === "search").props.onChange({ target: { value: "Model B" } }); picker.render();
assert.ok(picker.find(n => text(n) === "匹配的模型"));
assert.ok(picker.all().filter(n => n.props.role === "menuitem").every(n => text(n).includes("Model B")));
const matchingB = picker.all().find(n => n.props.role === "menuitem" && text(n) === "Model B");
assert.equal(matchingB.props.disabled, false, "new model remains selectable when old custom tier no longer exists");
matchingB.props.onClick(); assert.equal(chosen.at(-1).reasoningEffort, "medium"); assert.equal(chosen.at(-1).serviceTier, null);
picker.props.open = true; picker.render();
picker.focus(n => n.tag === "input" && n.props.type === "search"); picker.key("Escape", true); assert.equal(picker.props.open, true);
picker.key("ArrowDown"); assert.equal(picker.active().props.role, "menuitem");
picker.key("Escape"); assert.equal(picker.props.open, false); assert.equal(picker.active().props["aria-haspopup"], "menu");
picker.props.selectionError = "late rejection"; picker.render();
assert.ok(picker.find(n => n.props.role === "alert" && text(n).includes("late rejection")), "closed picker still exposes async failure");
picker.props.selectionError = null; picker.props.open = true; picker.props.recentOpen = false; picker.render();
picker.find(n => n.props.className === "model-compact-current").props.onClick(); picker.render();
const modelB = picker.find(n => n.props.role === "menuitemradio" && text(n) === "Model B"); modelB.props.onClick();
assert.equal(chosen.at(-1).model, "b-wire"); assert.equal(chosen.at(-1).reasoningEffort, "medium");
picker.props.models = []; picker.props.open = true; picker.render();
assert.ok(picker.find(n => n.props.role === "status" && text(n).includes("暂无可用模型")));
assert.equal(picker.all().filter(n => n.props.role === "menuitemradio").length, 0);
console.log("PASS MC-B07/08/11 JSX: recent distinct view, invalid effort/model exclusion, triple selection, search, no history writes, IME and Escape focus");

const composer = mount("ComposerBox", { dictationSessionKey: "chat", composerEnterBehavior: "enter", variant: "thread", promptInput: "/model", isStreaming: false,
  activeWorkspace: null, workspaces: [], gitStatus: null, gitBranches: [], useWorktree: false, permissionMode: "ask", attachedFiles: [], models,
  selectedModelId: "a-wire", reasoningEffort: "high", skills: [], workspaceFiles: [], workspaceFileHits: [], onPromptInputChange() {},
});
composer.focus(n => n.tag === "textarea"); assert.equal(composer.command("composer-open-recent-models"), true); composer.render();
assert.ok(composer.find(n => n.props.recentOpen === true && n.props.open === true), "command must enter the recent submenu, not ordinary picker");
composer.props.selectionPending = true; composer.render(); composer.focus(n => n.tag === "textarea");
assert.equal(composer.command("composer-open-recent-models"), false, "pending refuses repeated command");
composer.props.selectionPending = false; composer.render(); composer.focus(n => n.tag === "textarea");
composer.find(n => n.tag === "textarea").props.onChange({ target: { value: "/model" } }); composer.render();
const autocomplete = composer.find(n => n.props.items?.[0]?.action === "open_model_picker"); assert.ok(autocomplete);
autocomplete.props.onSelect(autocomplete.props.items[0]); composer.render();
assert.ok(composer.find(n => n.props.recentOpen === true && n.props.open === true));
console.log("PASS MC-B07/11 Composer: /model and focused keyboard command open independent recent model view; pending entry blocked");

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Execute the production JSX and pure projection, without React DOM, IPC or HTTP.
const cache = new Map();
function load(file, dependencies = {}) {
  const absolute = path.resolve(file);
  if (cache.has(absolute) && !Object.keys(dependencies).length) return cache.get(absolute);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(absolute, "utf8"), { fileName: absolute, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  const require = name => {
    if (name in dependencies) return dependencies[name];
    if (name.endsWith(".css")) return {};
    if (name.includes("chatgptService")) return {};
    if (name.startsWith(".")) {
      const stem = path.resolve(path.dirname(absolute), name);
      return load([`${stem}.ts`, `${stem}.tsx`].find(fs.existsSync));
    }
    throw Error(`Unexpected dependency ${name}`);
  };
  vm.runInNewContext(code, { module, exports: module.exports, require, ...dependencies.globals }, { filename: absolute });
  if (!Object.keys(dependencies).length) cache.set(absolute, module.exports);
  return module.exports;
}
const { parseWorkModelCatalog } = load("src/workModelCatalog.ts");
const catalog = parseWorkModelCatalog({ default_model_slug: "work-a", models: [
  { slug: "work-a", title: "源模型 A", is_work_mode_model: true, default_thinking_effort: "standard",
    thinking_efforts: [{ thinking_effort: "standard", full_label: "标准" }, { thinking_effort: "extended", full_label: "深入" }] },
  { slug: "work-b", title: "源模型 B", is_work_mode_model: true },
  { slug: "work-old", title: "源旧模型", is_work_mode_model: true },
], categories: [], internal_groups: [], slider_settings: [
  { model_slug: "work-a", thinking_effort: "standard" }, { model_slug: "work-a", thinking_effort: "extended" },
], versions: [
  { id: "latest", display_text: "当前版本", slugs: ["work-a", "work-b"], intelligence_presets: [
    { model_slug: "work-a", thinking_effort: "standard", title: "标准", preset_type: "available" },
    { model_slug: "work-a", thinking_effort: "extended", title: "深入", preset_type: "available" },
    { model_slug: "work-b", thinking_effort: "standard", title: "第二模型", preset_type: "available" },
  ] },
  { id: "old", display_text: "旧版本", picker_group: "older", slugs: ["work-old"], intelligence_presets: [
    { model_slug: "work-old", thinking_effort: "standard", title: "旧模型档", preset_type: "available" },
  ] },
] });
const flatten = node => node && typeof node === "object" ? [node, ...node.children.flatMap(flatten)] : [];
const content = node => node && typeof node === "object" ? node.children.map(content).join("") : typeof node === "string" ? node : "";
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function mount(extra = {}) {
  const slots = [], effects = [], layouts = [], nodes = new Map(), listeners = new Map(), calls = [];
  let cursor = 0, tree, dirty = false, active = null, mounted = true;
  const props = { catalog, selection: { slug: "work-a", thinkingEffort: "standard", versionId: "latest" },
    loading: false, pending: false, open: false, contextKey: "owner-A", refresh: () => calls.push(["refresh"]),
    onOpenChange: value => { props.open = value; dirty = true; },
    onCommit: async value => { calls.push(["commit", value]); return true; }, ...extra };
  const hookEffect = (queue, fn, deps) => {
    const index = cursor++, before = slots[index];
    if (!before || !deps || deps.some((value, i) => value !== before.deps?.[i])) {
      const cell = { deps, cleanup: before?.cleanup }; slots[index] = cell;
      queue.push(() => { cell.cleanup?.(); cell.cleanup = fn(); });
    }
  };
  const react = { createElement: (type, properties, ...children) => ({ type, props: properties ?? {}, children: children.flat(Infinity) }),
    useId: () => { const i = cursor++; return slots[i] ??= `picker-${i}`; },
    useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo: fn => { cursor++; return fn(); },
    useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], value => { assert.equal(mounted, true, "No state writes after unmount"); const next = typeof value === "function" ? value(slots[i]) : value;
        if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useLayoutEffect: (fn, deps) => hookEffect(layouts, fn, deps), useEffect: (fn, deps) => hookEffect(effects, fn, deps) };
  const doc = { body: {}, hasFocus: () => true, get activeElement() { return active; },
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); } };
  const win = { innerWidth: 960, innerHeight: 720, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  const Component = load("src/components/WorkModelPicker.tsx", { react, "react-dom": { createPortal: node => node },
    "lucide-react": { Check: "check-icon", ChevronDown: "down-icon", ChevronRight: "right-icon" }, globals: { document: doc, window: win } }).WorkModelPicker;
  const matches = (node, query) => {
    if (query.includes(":not(:disabled)") && node.props.disabled) return false;
    if (query.includes('aria-checked="true"') && node.props["aria-checked"] !== true) return false;
    if (query.includes('[role^="menuitem"]')) return String(node.props.role ?? "").startsWith("menuitem");
    if (query.includes('[role="menuitemradio"]')) return node.props.role === "menuitemradio";
    if (query === "[data-work-older]") return "data-work-older" in node.props;
    if (query.startsWith(".")) return node.props.className?.split(" ").includes(query.slice(1));
    return false;
  };
  const element = (node, parent = null) => {
    if (!node || typeof node !== "object") return null;
    const identity = node.props.id ?? `${node.type}:${node.props.role ?? ""}:${node.props["aria-label"] ?? ""}:${content(node)}`;
    let dom = nodes.get(identity);
    if (!dom) { dom = { style: {}, offsetWidth: 254, offsetHeight: 180, focus() { active = this; }, scrollTo() {},
      getBoundingClientRect: () => ({ left: 320, right: 460, top: 570, bottom: 600 }),
      querySelectorAll(query) { return flatten(this.node).filter(n => n !== this.node && matches(n, query)).map(n => element(n)); },
      querySelector(query) { return this.querySelectorAll(query)[0] ?? null; },
      contains(target) { return target === this || flatten(this.node).some(n => element(n) === target); },
      closest(query) { let current = this; while (current) { if (query === "[inert]" && current.node.props.inert || query === "[data-work-older]" && "data-work-older" in current.node.props) return current; current = current.parent; } return null; } };
      nodes.set(identity, dom); }
    dom.node = node; if (parent) dom.parent = parent;
    if (node.props.ref) node.props.ref.current = dom;
    for (const child of node.children) element(child, dom);
    return dom;
  };
  const render = () => { let loops = 0; do { assert.ok(++loops < 20, "render settles"); dirty = false; cursor = 0; tree = Component(props); element(tree);
      while (layouts.length) layouts.shift()(); while (effects.length) effects.shift()(); } while (dirty); };
  const find = predicate => flatten(tree).find(predicate);
  const trigger = () => find(node => node.type === "button" && node.props["aria-label"] === "选择 ChatGPT 模型");
  const act = fn => { fn(); render(); };
  const keyboard = (key, target = active, shiftKey = false) => { const e = { key, shiftKey, target, nativeEvent: {}, preventDefault() {}, stopPropagation() {} };
    act(() => find(n => n.props.role === "menu" && n.props.id)?.props.onKeyDown(e)); };
  const open = () => act(() => trigger().props.onClick());
  const flush = async () => { for (let i = 0; i < 5; i++) { await Promise.resolve(); if (dirty) render(); } };
  const unmount = () => { for (const slot of slots) slot?.cleanup?.(); mounted = false; };
  render(); return { props, calls, find, trigger, act, render, open, keyboard, flush, unmount, listeners, element, get active() { return active; } };
}

{
  const h = mount(); assert.equal(h.trigger().props["aria-expanded"], false); h.open();
  assert.equal(h.find(n => n.type === "input")?.props.type, "range"); assert.equal(h.active.node.type, "input");
  assert.equal(h.find(n => n.type === "input" && n.props.type === "search"), undefined);
  h.unmount(); console.log("PASS actual JSX opens simple slider with focus and no search");
}
{
  const task = deferred(), h = mount({ onCommit: async value => { h.calls.push(["commit", value]); return task.promise; } }); h.open();
  h.act(() => h.find(n => n.type === "input").props.onChange({ target: { value: "1" } }));
  assert.equal(h.calls.length, 0, "slider stages until close"); h.keyboard("Escape"); await h.flush();
  assert.equal(h.calls.length, 1); assert.notEqual(h.calls[0][1].thinkingEffort, "standard"); h.open(); assert.equal(h.props.open, false, "single-flight blocks reopening");
  task.resolve(false); await h.flush(); assert.equal(h.props.selection.thinkingEffort, "standard"); assert.ok(h.find(n => n.props.role === "alert"));
  h.open(); h.keyboard("Escape"); await h.flush(); assert.equal(h.calls.length, 2, "failed draft remains retryable"); h.unmount();
  console.log("PASS close commits once, failure preserves confirmed model and permits retry");
}
{
  const h = mount(); h.open(); const input = () => h.find(n => n.type === "input");
  h.act(() => input().props.onPointerDown()); h.act(() => input().props.onChange({ target: { value: "1" } }));
  h.act(() => input().props.onPointerCancel()); h.keyboard("Escape"); await h.flush(); assert.equal(h.calls.length, 0);
  h.unmount(); console.log("PASS pointer cancellation restores the pre-drag selection");
}
{
  const h = mount(); h.open(); h.act(() => h.find(n => n.props.className === "work-model-picker-model").props.onClick());
  const list = h.find(n => n.props.className === "work-model-picker-list"); assert.ok(list); assert.equal(h.active.node.props.role, "menuitemradio");
  const before = h.active; h.keyboard("Tab"); assert.notEqual(h.active, before); h.keyboard("Tab", h.active, true); assert.equal(h.active, before);
  const older = h.find(n => n.type === "button" && content(n) === "旧版模型"); assert.ok(older, "real catalog group exposes older flyout");
  h.act(() => older.props.onClick()); assert.equal(h.active.node.props.role, "menuitemradio"); h.keyboard("Escape"); assert.equal(h.props.open, true);
  h.keyboard("Escape"); await h.flush(); assert.equal(h.calls.length, 0); h.unmount();
  console.log("PASS advanced selected-row focus, Tab cycling and older-submenu Escape");
}
{
  const h = mount(); h.open(); h.act(() => h.find(n => n.type === "input").props.onChange({ target: { value: "1" } }));
  h.keyboard("Escape"); h.props.contextKey = "owner-B"; h.render(); await h.flush(); assert.equal(h.calls.length, 0, "retired callback never starts a write"); h.unmount();
  const u = mount(); u.open(); u.act(() => u.find(n => n.type === "input").props.onChange({ target: { value: "1" } }));
  u.keyboard("Escape"); u.unmount(); await u.flush(); assert.equal(u.calls.length, 0); assert.equal(u.listeners.size, 0);
  console.log("PASS context replacement and unmount fence pending delivery and remove listeners");
}
{
  const h = mount({ catalog: null, selection: null, loading: false, error: "加载失败" }); assert.equal(h.trigger().props.disabled, true);
  h.act(() => h.find(n => n.props.className === "work-model-picker-retry").props.onClick()); assert.deepEqual(h.calls, [["refresh"]]);
  h.unmount(); console.log("PASS real load error exposes read-only retry without synthetic models");
}
function openOldVersion(h) {
  h.open(); h.act(() => h.find(n => n.props.className === "work-model-picker-model").props.onClick());
  h.act(() => h.find(n => n.type === "button" && content(n) === "旧版模型").props.onClick());
  h.act(() => h.find(n => n.type === "button" && content(n).includes("旧版本")).props.onClick());
}
{
  const h = mount({ onVersionPreference: async value => { h.calls.push(["version", value]); return true; } });
  h.open(); h.act(() => h.find(n => n.props.className === "work-model-picker-model").props.onClick());
  const selected = h.find(n => n.type === "button" && n.props.role === "menuitemradio" && n.props["aria-checked"] === true);
  assert.ok(selected); h.act(() => selected.props.onClick()); await h.flush();
  assert.equal(h.props.open, false); assert.equal(h.calls.length, 0); h.unmount();
  console.log("PASS selected-row confirmation issues no duplicate model or version write");
}
{
  const task = deferred(), h = mount({ onVersionPreference: async value => { h.calls.push(["version", value]); return task.promise; } });
  openOldVersion(h); assert.equal(h.calls[0][0], "version"); assert.equal(h.calls[0][1].versionId, "old");
  assert.equal(h.calls[0][1].selectionMode, "model"); assert.equal(h.calls.filter(c => c[0] === "commit").length, 0);
  task.resolve(false); await h.flush(); assert.ok(h.find(n => n.props.role === "alert"));
  h.keyboard("Escape"); await h.flush(); assert.equal(h.calls.filter(c => c[0] === "commit").length, 0);
  h.unmount(); console.log("PASS version save precedes draft staging and failure cannot fake model success");
}
{
  const h = mount({ onVersionPreference: async value => { h.calls.push(["version", value]); h.props.versionPreference = value; return true; },
    onCommit: async value => { h.calls.push(["commit", value]); return false; } });
  openOldVersion(h); await h.flush(); h.keyboard("Escape"); await h.flush();
  assert.deepEqual(h.calls.map(c => c[0]), ["version", "commit"]); assert.equal(h.props.versionPreference.versionId, "old");
  assert.equal(h.props.selection.slug, "work-a"); h.unmount();
  const task = deferred(), late = mount({ onVersionPreference: async () => task.promise }); openOldVersion(late);
  late.keyboard("Escape"); late.keyboard("Escape"); assert.equal(late.props.open, false); task.resolve(true); await late.flush();
  assert.equal(late.calls.filter(c => c[0] === "commit").length, 0); late.unmount();
  console.log("PASS model failure never rolls back confirmed version, close during version write never stages late model");
}
console.log("Work model picker UI: 9 production JSX groups passed (offline DOM harness only)");

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync("src/components/AddPluginMarketplaceDialog.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(add = async () => {}) {
  let cursor = 0, dirty = true, effects = [], tree, focused = "", restored = 0, updates = 0;
  const slots = [], added = [], changes = [], links = [];
  let props = { open: true, contextKey: "first", onOpenChange: value => changes.push(value), onAdd: input => { added.push(input); return add(input); } };
  const modal = { opened: false, showModal() { this.opened = true; }, close() { this.opened = false; }, getBoundingClientRect: () => ({ left: 100, top: 100, right: 600, bottom: 600 }) };
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], next => { const value = typeof next === "function" ? next(slots[i]) : next; if (!Object.is(slots[i], value)) { slots[i] = value; dirty = true; updates++; } }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useEffect(run, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((value, index) => value !== old.deps[index])) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: run() }; }); },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, Error, document: { activeElement: { isConnected: true, focus: () => restored++ } },
    require(name) {
      if (name === "react") return react;
      if (name === "lucide-react") return { Loader2: "Loader2" };
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === "../bridge") return { isTauriRuntime: () => true, tauriInvoke: async (...args) => { links.push(args); } };
      if (name === "./Icons") return { CloseIcon: "CloseIcon" };
      return {};
    },
  });
  function render() {
    for (let turn = 0; dirty; turn++) {
      assert.ok(turn < 20); cursor = 0; dirty = false; tree = exports.AddPluginMarketplaceDialog(props);
      for (const node of nodes(tree)) if (node.props.ref) node.props.ref.current = node.type === "dialog" ? modal : { focus: () => focused = node.props.id };
      const pending = effects; effects = []; pending.forEach(run => run());
    } return tree;
  }
  return { exports, added, changes, links, modal, get focused() { return focused; }, get restored() { return restored; }, get updates() { return updates; }, get tree() { return render(); },
    update(patch) { props = { ...props, ...patch }; dirty = true; return render(); },
    field(id) { return nodes(render()).find(node => node.props.id === id); },
    change(id, value) { this.field(id).props.onChange({ target: { value } }); render(); },
    submit() { return nodes(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); },
    cancel() { render().props.onCancel({ preventDefault() {} }); render(); },
    backdrop() { render().props.onClick({ target: modal, currentTarget: modal, clientX: 20, clientY: 20 }); render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
{
  const f = fixture(), parse = f.exports.parseAddPluginMarketplaceInput;
  assert.equal(parse({ source: " ", refName: "main", sparsePaths: "a" }), null);
  assert.deepEqual(JSON.parse(JSON.stringify(parse({ source: "  openai/plugins  ", refName: " main ", sparsePaths: " a/b,\n c/d , a/b\n\n" }))),
    { source: "openai/plugins", refName: "main", sparsePaths: ["a/b", "c/d", "a/b"] });
  assert.deepEqual(JSON.parse(JSON.stringify(parse({ source: "C:/local", refName: "  ", sparsePaths: ",\n  " }))), { source: "C:/local", refName: null, sparsePaths: null });
}
{
  const f = fixture(); assert.equal(f.tree.type, "dialog"); assert.equal(f.modal.opened, true); assert.equal(f.focused, "plugin-marketplace-source");
  const fields = nodes(f.tree).filter(node => node.type === "input" || node.type === "textarea");
  assert.equal(fields.length, 3); assert.ok(fields.every(node => node.props.value === "" && !node.props.disabled));
  assert.equal(fields[0].props.placeholder, "openai/plugins 或 git@github.com:org/repo.git"); assert.equal(fields[1].props.placeholder, "主分支"); assert.equal(fields[2].props.placeholder, "plugins/codex");
  assert.equal(nodes(f.tree).some(node => node.props.role === "tablist"), false, "first marketplace dialog has no category or existing-market dependency");
  await f.submit(); assert.equal(f.added.length, 0); assert.equal(f.field("plugin-marketplace-source").props["aria-invalid"], true);
  f.tree.props.onCompositionStart(); f.cancel(); assert.equal(f.changes.length, 0); f.tree.props.onCompositionEnd();
  const help = nodes(f.tree).find(node => node.type === "a"); let prevented = 0; help.props.onClick({ preventDefault: () => prevented++ });
  assert.equal(prevented, 1); assert.equal(f.links[0][0], "review_link_open"); assert.equal(f.links[0][1].url, "https://developers.openai.com/codex/plugins/build");
  f.change("plugin-marketplace-source", "draft"); f.cancel(); assert.deepEqual(f.changes, [false]);
  f.update({ open: false }); assert.equal(f.modal.opened, false); assert.equal(f.restored, 1);
  f.update({ open: true }); assert.equal(f.field("plugin-marketplace-source").props.value, ""); f.backdrop(); assert.deepEqual(f.changes, [false, false]); f.unmount();
}
{
  const request = deferred(), f = fixture(() => request.promise); f.tree; f.change("plugin-marketplace-source", " market ");
  const pending = f.submit(); const duplicate = f.submit(); assert.equal(f.added.length, 1);
  assert.ok(nodes(f.tree).some(node => node.type === "Loader2" && node.props["aria-hidden"] === "true"), "pending has a visible loading glyph without changing the button name");
  assert.ok(nodes(f.tree).filter(node => ["input", "textarea", "button"].includes(node.type)).every(node => node.props.disabled));
  assert.ok(!nodes(f.tree).some(node => node.props["aria-label"] === "关闭"));
  f.cancel(); f.backdrop(); assert.equal(f.changes.length, 0); f.change("plugin-marketplace-source", "tampered"); assert.equal(f.field("plugin-marketplace-source").props.value, " market ");
  request.resolve(); await pending; await duplicate; assert.deepEqual(f.changes, [false]); assert.equal(f.field("plugin-marketplace-source").props.value, ""); f.unmount();
}
{
  let reject; const f = fixture(() => new Promise((_, fail) => { reject = fail; })); f.tree; f.change("plugin-marketplace-source", "market");
  const pending = f.submit(); reject(new Error("actual failure")); await pending;
  assert.equal(f.field("plugin-marketplace-source").props.value, "market"); assert.equal(nodes(f.tree).find(node => node.props.role === "alert").props.children, "actual failure");
  f.change("plugin-marketplace-source", " market  "); assert.ok(nodes(f.tree).some(node => node.props.role === "alert"), "equivalent parsed params retain failure");
  f.change("plugin-marketplace-ref", "next"); assert.ok(!nodes(f.tree).some(node => node.props.role === "alert"));
  f.change("plugin-marketplace-ref", ""); assert.ok(nodes(f.tree).some(node => node.props.role === "alert")); f.cancel(); f.unmount();
}
{
  const request = deferred(), f = fixture(() => request.promise); f.tree; f.change("plugin-marketplace-source", "old"); const pending = f.submit();
  f.update({ contextKey: "new" }); f.change("plugin-marketplace-source", "new draft"); request.resolve(); await pending;
  assert.equal(f.changes.length, 0); assert.equal(f.field("plugin-marketplace-source").props.value, "new draft"); f.unmount();
}
{
  const request = deferred(), f = fixture(() => request.promise); f.tree; f.change("plugin-marketplace-source", "old-session"); const pending = f.submit();
  f.update({ open: false }); f.update({ open: true }); f.change("plugin-marketplace-source", "reopened"); request.reject("service failed"); await pending;
  assert.equal(f.changes.length, 0); assert.equal(f.field("plugin-marketplace-source").props.value, "reopened");
  assert.ok(!nodes(f.tree).some(node => node.props.role === "alert"), "late old request cannot contaminate reopened form in same context"); f.unmount();
}
{
  const request = deferred(), f = fixture(() => request.promise); f.tree; f.change("plugin-marketplace-source", "unmount"); const pending = f.submit(); f.unmount();
  const before = f.updates; request.reject(new Error("late")); await pending; assert.equal(f.updates, before); assert.equal(f.changes.length, 0);
}
console.log("Add plugin marketplace dialog: current NFyQ/LI65 defaults, parsed parameters, single flight, pending protection, truthful failure matching, close/reset and scope/unmount isolation passed.");

{
  const f = fixture(); f.tree;
  let focused = null, prevented = 0;
  const first = { tabIndex: 0, matches: () => false, getClientRects: () => [{}], focus: () => { focused = first; } };
  const middle = { tabIndex: 0, matches: () => false, getClientRects: () => [{}], focus: () => { focused = middle; } };
  const last = { tabIndex: 0, matches: () => false, getClientRects: () => [{}], focus: () => { focused = last; } };
  const element = { querySelectorAll: () => [first, middle, last], contains: value => [first, middle, last].includes(value), ownerDocument: { activeElement: first } };
  const key = shiftKey => ({ key: "Tab", shiftKey, nativeEvent: {}, currentTarget: element, stopPropagation() {}, preventDefault() { prevented++; } });
  f.tree.props.onKeyDown(key(true));
  assert.equal(focused, last, "reverse Tab at the first modal control must wrap instead of leaving the WebView");
  element.ownerDocument.activeElement = last; f.tree.props.onKeyDown(key(false)); assert.equal(focused, first);
  element.ownerDocument.activeElement = middle; f.tree.props.onKeyDown(key(false)); assert.equal(prevented, 2, "middle controls retain native Tab behavior");
  f.unmount();
}
console.log("Add marketplace native revision: Tab boundaries wrap within visible modal controls.");

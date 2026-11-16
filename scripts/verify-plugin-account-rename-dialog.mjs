import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync("src/components/PluginAccountRenameDialog.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const event = patch => ({ preventDefault() {}, stopPropagation() {}, nativeEvent: {}, ...patch });
function fixture(save = async () => true, retry = async () => {}) {
  let cursor = 0, dirty = true, effects = [], tree, restored = 0, focused = 0, updates = 0;
  const slots = [], writes = []; let closes = 0, retries = 0;
  let props = { identity: "a", linkId: "one", accountIdentity: "actual@example.com", initialNickname: "initial", currentName: "initial", pending: false, blocked: false, error: null,
    onSave: name => { writes.push(name); return save(name); }, onRetry: () => { retries++; return retry(); }, onClose: () => closes++ };
  const modal = { showModal() { this.open = true; }, close() { this.open = false; } };
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { if (!Object.is(slots[i], next)) { slots[i] = next; dirty = true; updates++; } }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useLayoutEffect(run, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((value, index) => value !== old.deps[index])) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: run() }; }); },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, document: { activeElement: { isConnected: true, focus: () => restored++ } }, require(name) {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === "./Icons") return { CloseIcon: "CloseIcon" }; return {};
  } });
  function render() { for (let turn = 0; dirty; turn++) { assert.ok(turn < 20); dirty = false; cursor = 0; tree = exports.PluginAccountRenameDialog(props);
    for (const node of nodes(tree)) if (node.props.ref) node.props.ref.current = node.type === "dialog" ? modal : { focus: () => focused++ };
    const batch = effects; effects = []; batch.forEach(run => run()); } return tree; }
  const find = predicate => nodes(render()).find(predicate);
  return { writes, modal, get closes() { return closes; }, get retries() { return retries; }, get restored() { return restored; }, get focused() { return focused; }, get updates() { return updates; }, get tree() { return render(); },
    get input() { return find(n => n.type === "input"); }, get submitButton() { return find(n => n.props.type === "submit"); }, get alert() { return find(n => n.props.role === "alert"); },
    button(label) { return find(n => n.type === "button" && (n.props.children === label || n.props["aria-label"] === label)); },
    change(value) { this.input.props.onChange({ target: { value } }); render(); }, submit() { find(n => n.type === "form").props.onSubmit(event()); render(); },
    update(patch) { props = { ...props, ...patch }; dirty = true; render(); }, unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
{
  const f = fixture(); assert.ok(f.tree); assert.equal(f.modal.open, true); assert.equal(f.focused, 1); assert.equal(f.input.props.name, "plugin-account-nickname");
  assert.equal(f.input.props.placeholder, "添加昵称"); assert.equal(f.input.props.value, "initial"); assert.equal(f.submitButton.props.disabled, true);
  f.submit(); assert.equal(f.writes.length, 0); f.change("   "); assert.equal(f.submitButton.props.disabled, false); f.submit(); assert.equal(f.alert.props.children, "请输入账户昵称");
  f.change("😀".repeat(65)); assert.equal(f.alert, undefined); f.submit(); assert.equal(f.alert.props.children, "昵称不得超过 64 个字符");
  f.change(`  ${"😀".repeat(64)}  `); f.submit(); await flush(); assert.equal(f.writes[0], "😀".repeat(64)); assert.equal(f.closes, 1); f.unmount(); assert.equal(f.restored, 1);
}
{
  const request = deferred(), f = fixture(() => request.promise); f.tree; f.change("next"); f.submit(); f.submit(); assert.equal(f.writes.length, 1);
  assert.ok(f.input.props.disabled); assert.ok(f.button("取消").props.disabled); assert.ok(f.button("关闭"), "busy X remains visible");
  f.button("关闭").props.onClick(); f.button("取消").props.onClick(); f.tree.props.onCancel(event()); f.tree.props.onKeyDown(event({ key: "Escape" })); assert.equal(f.closes, 0);
  f.change("tampered"); assert.equal(f.input.props.value, "next"); request.resolve(false); await flush(); assert.equal(f.closes, 0); assert.equal(f.input.props.value, "next"); f.unmount();
}
{
  const f = fixture(async () => { throw new Error("remote"); }); f.tree; f.change(" draft "); f.submit(); await flush();
  assert.equal(f.alert.props.children, "无法重命名账户"); assert.equal(f.input.props.value, " draft "); f.change("changed"); assert.equal(f.alert, undefined);
  f.update({ currentName: "changed" }); assert.equal(f.submitButton.props.disabled, true); f.update({ pending: true }); f.button("关闭").props.onClick(); assert.equal(f.closes, 0); f.unmount();
}
{
  const f = fixture(); f.tree; f.change("next"); f.tree.props.onCompositionStart(); let prevented = 0;
  f.tree.props.onKeyDown(event({ key: "Enter", preventDefault: () => prevented++ })); f.submit(); f.tree.props.onCancel(event()); assert.equal(f.writes.length, 0); assert.equal(f.closes, 0);
  f.tree.props.onCompositionEnd(); f.tree.props.onKeyDown(event({ key: "Escape", nativeEvent: { keyCode: 229 }, preventDefault: () => prevented++ })); assert.equal(f.closes, 0); assert.equal(prevented, 2);
  f.tree.props.onKeyDown(event({ key: "Escape" })); assert.equal(f.closes, 1); f.unmount();
}
{
  const request = deferred(), f = fixture(async () => true, () => request.promise); f.tree; f.change("draft"); f.update({ blocked: true, error: "写入结果未知" });
  assert.equal(f.submitButton.props.disabled, true); f.submit(); assert.equal(f.writes.length, 0); f.button("重试").props.onClick(); f.button("重试").props.onClick(); assert.equal(f.retries, 1);
  request.resolve(); await flush(); assert.equal(f.closes, 0); assert.equal(f.input.props.value, "draft"); assert.equal(f.writes.length, 0); f.unmount();
}
for (const unmount of [false, true]) {
  const request = deferred(), f = fixture(() => request.promise); f.tree; f.change("old"); f.submit();
  if (unmount) f.unmount(); else { f.update({ identity: "b", initialNickname: "second" }); f.update({ identity: "a", initialNickname: "initial" }); f.change("new scope"); }
  const updates = f.updates; request.resolve(true); await flush(); assert.equal(f.closes, 0); assert.equal(f.updates, updates); if (!unmount) { assert.equal(f.input.props.value, "new scope"); f.unmount(); }
}
{
  const f = fixture(); f.tree; let focused, prevented = 0, stopped = 0;
  const control = () => ({ tabIndex: 0, matches: () => false, getClientRects: () => [{}], focus() { focused = this; } });
  const first = control(), middle = control(), last = control(), element = { querySelectorAll: () => [first, middle, last], contains: value => [first, middle, last].includes(value), ownerDocument: { activeElement: first } };
  const key = shiftKey => event({ key: "Tab", shiftKey, currentTarget: element, preventDefault: () => prevented++, stopPropagation: () => stopped++ });
  f.tree.props.onKeyDown(key(true)); assert.equal(focused, last); element.ownerDocument.activeElement = last; f.tree.props.onKeyDown(key(false)); assert.equal(focused, first);
  element.ownerDocument.activeElement = middle; f.tree.props.onKeyDown(key(false)); assert.equal(prevented, 2); assert.equal(stopped, 3); f.unmount();
}
assert.match(fs.readFileSync("src/components/PluginAccountRenameDialog.css", "utf8"), /width: 520px; max-width: 92vw/);
for (const retire of ["unmount", "aba"]) {
  const f = fixture(async () => false); f.tree; f.change("retired draft");
  const close = f.button("关闭").props.onClick, change = f.input.props.onChange;
  const submit = nodes(f.tree).find(node => node.type === "form").props.onSubmit;
  if (retire === "unmount") f.unmount(); else { f.update({ identity: "other" }); f.update({ identity: "a" }); }
  const updates = f.updates; close(); change({ target: { value: "stale input" } }); submit(event()); await flush();
  assert.equal(f.closes, 0, "retired controls cannot close the current dialog");
  assert.equal(f.writes.length, 0, "retired controls cannot issue a new rename");
  assert.equal(f.updates, updates, "retired inputs cannot change a new scope or unmounted dialog");
  if (retire !== "unmount") f.unmount();
}
console.log("Plugin account rename dialog: source validation, Unicode boundaries, single flight, IME, pending close protection, read-only recovery, draft retention, focus trap and scope/ABA/unmount isolation passed.");

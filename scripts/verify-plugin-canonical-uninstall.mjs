import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = ts.transpileModule(fs.readFileSync("src/components/PluginCanonicalUninstall.tsx", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = node => typeof node === "string" ? node : !node || typeof node !== "object" ? "" : [node.props?.children].flat(Infinity).map(text).join("");
const event = patch => ({ preventDefault() {}, stopPropagation() {}, nativeEvent: {}, ...patch });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture() {
  let cursor = 0, dirty = true, effects = [], tree, current = true, calls = 0, restored = 0, confirm = async () => {};
  const slots = [], modal = { showModal() { this.open = true; }, close() { this.open = false; } }, trigger = { isConnected: true, focus: () => restored++ };
  let props = { name: "真实插件", accountCount: 1, disabled: false, isCurrent: () => current, onConfirm: () => { calls++; return confirm(); } };
  const react = { useId: () => "uninstall-test", useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useLayoutEffect(run, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((v, n) => v !== old.deps[n])) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: run() }; }); },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
    if (name.endsWith(".css")) return {}; throw Error(name);
  } });
  function render() { for (let i = 0; dirty; i++) { assert.ok(i < 20); dirty = false; cursor = 0; tree = exports.PluginCanonicalUninstall(props); for (const n of nodes(tree)) if (n.props.ref) n.props.ref.current = n.type === "dialog" ? modal : n.props.children === "取消" ? { focus() {} } : trigger; const batch = effects; effects = []; batch.forEach(fn => fn()); } return tree; }
  return { get tree() { return render(); }, get calls() { return calls; }, get restored() { return restored; }, get dialog() { return nodes(render()).find(n => n.type === "dialog"); },
    buttons(label) { return nodes(render()).filter(n => n.type === "button" && text(n) === label); }, find(fn) { return nodes(render()).find(fn); }, open() { this.buttons("卸载")[0].props.onClick(); render(); }, submit() { this.find(n => n.type === "form").props.onSubmit(event()); render(); },
    update(patch) { props = { ...props, ...patch }; dirty = true; render(); }, retire() { current = false; }, confirmWith(fn) { confirm = fn; }, unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
{
  const f = fixture(); f.tree; f.open(); assert.match(text(f.dialog), /要卸载 真实插件 吗？/); assert.match(text(f.dialog), /重新添加后才能使用此插件/);
  f.buttons("取消")[0].props.onClick(); assert.equal(f.dialog, undefined); assert.equal(f.calls, 0); assert.equal(f.restored, 1); f.update({ accountCount: 2 }); f.open(); assert.match(text(f.dialog), /这将移除该插件及其关联的所有账户/); f.unmount();
}
{
  const request = deferred(), f = fixture(); f.confirmWith(() => request.promise); f.open(); f.submit(); f.submit(); assert.equal(f.calls, 1); assert.equal(f.buttons("取消")[0].props.disabled, true);
  f.buttons("取消")[0].props.onClick(); f.dialog.props.onCancel(event()); assert.ok(f.dialog); request.resolve(); await flush(); assert.equal(f.dialog, undefined); assert.equal(f.restored, 1); f.unmount();
}
{
  const f = fixture(); f.confirmWith(async () => { throw Error("actual rejection"); }); f.open(); f.submit(); await flush(); assert.ok(f.dialog); assert.match(text(f.find(n => n.props.role === "alert")), /无法移除该插件。请重试/); assert.equal(f.calls, 1); f.unmount();
}
{
  const f = fixture(); f.confirmWith(async () => { throw Object.assign(Error("private transport detail must not leak"), { code: "unconfirmed_removal" }); });
  f.open(); f.submit(); await flush();
  const message = text(f.find(n => n.props.role === "alert"));
  assert.match(message, /结果尚未确认.*核验卸载结果/); assert.doesNotMatch(message, /请重试|private transport/);
  f.buttons("取消")[0].props.onClick(); assert.equal(f.dialog, undefined); assert.equal(f.calls, 1); f.unmount();
}
{
  const f = fixture(); f.open(); f.retire(); f.submit(); assert.equal(f.calls, 0); f.unmount();
}
{
  const request = deferred(), f = fixture(); f.confirmWith(() => request.promise); f.open(); const oldForm = f.find(n => n.type === "form"); f.submit(); f.update({ name: "其它插件" }); f.open();
  oldForm.props.onSubmit(event()); assert.equal(f.calls, 1); request.resolve(); await flush(); assert.ok(f.dialog, "retired completion cannot dismiss the new confirmation"); f.unmount();
}
{
  const f = fixture(); f.open(); f.dialog.props.onCompositionStart(); f.submit(); f.dialog.props.onCancel(event()); assert.equal(f.calls, 0); assert.ok(f.dialog);
  let prevented = 0; f.dialog.props.onKeyDown(event({ key: "Escape", nativeEvent: { keyCode: 229 }, preventDefault: () => prevented++ })); assert.equal(prevented, 1);
  f.dialog.props.onCompositionEnd(); f.dialog.props.onKeyDown(event({ key: "Escape" })); assert.equal(f.dialog, undefined); assert.equal(f.restored, 1); f.unmount();
}
console.log("Canonical uninstall confirmation: real names/account warning, cancel/no-write, fresh guards, single flight, failure context, scope retirement, IME and focus return passed.");

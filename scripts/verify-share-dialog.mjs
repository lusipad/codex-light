import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const all = node => node && typeof node === "object" ? [node, ...node.children.flatMap(all)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "string" ? node : "";
const event = extra => ({
  preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; },
  nativeEvent: {}, ...extra,
});
const recipient = (id, type = "user") => ({ id, label: id, principal: { principal_id: id, principal_type: type } });
function mount(overrides = {}) {
  const hooks = [], effects = [], calls = [];
  let cursor = 0, focused, opened = false, resolve;
  const pending = new Promise(done => { resolve = done; });
  const previous = { isConnected: true, focus() { focused = previous; } };
  const dialog = {
    showModal() { opened = true; }, close() { opened = false; }, focus() { focused = dialog; },
    getBoundingClientRect: () => ({ left: 200, right: 720, top: 100, bottom: 650 }),
  };
  const session = {
    phase: "prepared", error: null, snapshot: { version: 1, turns: [] }, shareUrl: null, copyFailed: false,
    account: { kind: "personal", accountUserId: "me" }, audience: { access: "public", principals: [] },
    query: "", selected: [], results: [], searching: false, searchError: null,
    retry: () => calls.push(["retry"]),
    publishOrCopy: () => { calls.push(["publishOrCopy"]); return pending; },
    setAccess: value => calls.push(["access", value]), setQuery: value => calls.push(["query", value]),
    addRecipient: value => calls.push(["add", value.id]), removeRecipient: value => calls.push(["remove", value]),
    ...overrides,
  };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useRef: value => { const index = cursor++; return hooks[index] ??= { current: value }; },
    useEffect: callback => { const index = cursor++; if (!hooks[index]) { hooks[index] = true; effects.push(callback); } },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/ShareThreadDialog.tsx", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, {
    exports: module.exports, document: { activeElement: previous },
    require: name => name === "react" ? react : name === "../shareThreadSession" ? {
      useShareThreadSession: threadId => { assert.equal(threadId, "thread-1"); return session; },
    } : {},
  });
  const render = () => {
    cursor = 0;
    const tree = module.exports.ShareThreadDialog({ threadId: "thread-1", title: "测试", onClose: () => calls.push(["close"]) });
    for (const node of all(tree)) if (node.props.ref) node.props.ref.current = node.type === "dialog" ? dialog : { focus() {} };
    return tree;
  };
  render();
  const cleanups = effects.map(effect => effect());
  return { session, render, calls, dialog, previous, resolve, get focused() { return focused; }, get opened() { return opened; },
    unmount() { cleanups.forEach(cleanup => cleanup?.()); } };
}
const submit = view => all(view.render()).find(node => node.type === "form").props.onSubmit(event());
const action = view => all(view.render()).find(node => node.props.type === "submit");
const root = view => view.render();
for (const phase of ["loading", "creating", "unknown", "unavailable"]) {
  const view = mount({ phase, snapshot: null });
  assert.equal(view.opened, true);
  assert.equal(view.focused, view.dialog, "initial focus must work even with a disabled action");
  assert.equal(action(view).props.disabled, true);
  submit(view); assert.deepEqual(view.calls, []);
  const cancel = event(); root(view).props.onCancel(cancel);
  assert.equal(cancel.defaultPrevented, true);
  assert.equal(view.calls.length, phase === "creating" ? 0 : 1);
  view.unmount(); assert.equal(view.focused, view.previous); assert.equal(view.opened, false);
}
const lock = mount({ phase: "creating" });
assert.equal(all(lock.render()).some(node => node.props["aria-label"] === "关闭对话框"), false);
root(lock).props.onMouseDown(event({ target: lock.dialog, currentTarget: lock.dialog, clientX: 1, clientY: 1 }));
assert.deepEqual(lock.calls, []);
lock.unmount();
const prepared = mount();
const ime = event({ key: "Enter", nativeEvent: { isComposing: true } });
root(prepared).props.onKeyDown(ime); assert.equal(ime.defaultPrevented, true); assert.equal(ime.stopped, true);
root(prepared).props.onCompositionStart(); submit(prepared); assert.deepEqual(prepared.calls, []);
root(prepared).props.onCompositionEnd();
submit(prepared); submit(prepared);
assert.deepEqual(prepared.calls, [["publishOrCopy"]], "synchronous duplicate submit must not publish twice");
root(prepared).props.onCancel(event()); assert.equal(prepared.calls.length, 1, "pending publish cannot dismiss before a rerender");
prepared.resolve(); await new Promise(resolve => setImmediate(resolve));
root(prepared).props.onCancel(event()); assert.deepEqual(prepared.calls.at(-1), ["close"]);
prepared.unmount();
const retry = mount({ phase: "error", error: "准备失败" });
assert.equal(text(action(retry)), "重试"); submit(retry); assert.deepEqual(retry.calls, [["retry"]]); retry.unmount();
const workspace = mount({
  account: { kind: "workspace", accountUserId: "me", name: "团队" },
  audience: { access: "invited", principals: [] }, results: [recipient("A"), recipient("G", "group")], query: "test",
  selected: [recipient("selected")],
});
assert.equal(action(workspace).props.disabled, true, "uncommitted recipient query prevents publish");
const select = all(workspace.render()).find(node => node.type === "select");
select.props.onChange({ target: { value: "workspace" } });
all(workspace.render()).find(node => node.type === "input").props.onChange({ target: { value: "next" } });
all(workspace.render()).find(node => node.type === "button" && text(node) === "G").props.onClick();
all(workspace.render()).find(node => node.props["aria-label"] === "移除 selected").props.onClick();
assert.deepEqual(workspace.calls, [["access", "workspace"], ["query", "next"], ["add", "G"], ["remove", "selected"]]);
workspace.session.query = ""; workspace.session.selected = []; assert.equal(action(workspace).props.disabled, true);
workspace.session.phase = "ready"; workspace.session.selected = [recipient("A")];
workspace.session.copyFailed = true; workspace.session.shareUrl = "https://chatgpt.com/share/server-id";
let input = all(workspace.render()).find(node => node.props["aria-label"] === "分享链接");
assert.equal(input.props.readOnly, true); assert.equal(input.props.value, workspace.session.shareUrl);
assert.equal(all(workspace.render()).find(node => node.type === "select").props.disabled, true);
workspace.unmount();
const preview = mount({ snapshot: { version: 1, turns: [
  { items: [{ type: "reasoning", summary: "hidden reasoning" }, { type: "agentMessage", phase: "commentary", text: "hidden commentary" }] },
  ...Array.from({ length: 5 }, (_, index) => ({ items: [{ type: "agentMessage", text: `answer-${index}` }] })),
] } });
const previewNode = all(preview.render()).find(node => node.props.className === "share-thread-preview-content");
assert.equal(previewNode.props.inert, true);
assert.ok(text(previewNode).includes("answer-3")); assert.ok(!text(previewNode).includes("answer-4"));
assert.ok(!text(previewNode).includes("hidden"));
preview.unmount();
assert.match(fs.readFileSync("src/components/ShareThreadDialog.css", "utf8"), /width:\s*520px/);
console.log("PASS share dialog production callbacks: states, focus lifecycle, IME, duplicate publish, audience/recipient controls and first-four preview (harness; native focus trapping and pixels unverified)");

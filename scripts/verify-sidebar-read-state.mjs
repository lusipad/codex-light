import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { mount } from "./verify-sidebar-projects.mjs";

const app = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function initializer(name) {
  let value;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(app) === name) value = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(app); assert.ok(value, `production ${name} must exist`); return value;
}
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const protocol = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync("src/protocol.ts", "utf8")), { exports: protocol.exports });
const read = { revision: "r1", firstUnread: null };
const unread = { revision: "r2", firstUnread: { type: "threadStart" } };
const all = node => node && typeof node === "object" ? [node, ...node.children.flatMap(all)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "string" ? node : "";
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
for (const [state, label] of [[read, "标记为未读"], [{ revision: "r-omitted" }, "标记为未读"], [unread, "标记为已读"], [undefined, null], [null, null]]) {
  const writes = [];
  const view = mount({
    threads: [{ id: "a1", name: "Alpha", cwd: "D:/parity/alpha", readState: state }],
    onSetThreadReadState: (...args) => writes.push(args),
  });
  view.render(); await flush();
  const row = all(view.render()).find(node => node.props["data-thread-id"] === "a1");
  row.props.onContextMenu({ currentTarget: view.element(row), clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {} });
  const menu = all(view.render()).find(node => node.props.role === "menu" && node.props["aria-label"] === "会话操作");
  const item = all(menu).find(node => node.type === "button" && text(node).startsWith("标记为"));
  assert.equal(item ? text(item) : null, label, "only a service-backed eligible receipt exposes the action");
  if (item) {
    const labels = all(menu).filter(node => node.type === "button").map(text);
    assert.equal(labels[0], label, "official organization group places receipt action before rename");
    item.props.onClick();
    assert.equal(all(view.render()).some(node => node.props.role === "menu"), false);
    assert.deepEqual(writes, [["a1", state.revision, state.firstUnread == null]]);
  }
  assert.equal(all(row).some(node => node.props.className === "sidebar-thread-unread-dot"), !!state?.firstUnread);
}
{
  const writes = [];
  const view = mount({
    threads: [{ id: "a1", readState: read }],
    onSetThreadReadState: (...args) => writes.push(args),
  });
  view.render(); await flush();
  const row = all(view.render()).find(node => node.props["data-thread-id"] === "a1");
  row.props.onContextMenu({ currentTarget: view.element(row), clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {} });
  view.props.threads = [{ id: "a1", readState: unread }];
  const menu = all(view.render()).find(node => node.props.role === "menu" && node.props["aria-label"] === "会话操作");
  const item = all(menu).find(node => node.type === "button" && text(node).startsWith("标记为"));
  assert.equal(text(item), "标记为未读", "an open menu keeps its observed intent despite external activity");
  item.props.onClick();
  assert.deepEqual(writes, [["a1", "r1", true]], "a stale menu sends its captured revision so the server can reject it");
}
const updateCode = compile(`(${initializer("handleSetThreadReadState").arguments[0].getText(app)})`);
const refreshCode = compile(`(${initializer("refreshThreads").arguments[0].getText(app)})`);
const notifyCode = compile(`(${initializer("handleNotification").getText(app)})`);
function context(rpc) {
  const calls = [], toasts = [], refreshes = [], writes = new Set();
  let threads = [{ id: "a1", readState: read }];
  const scope = vm.createContext({
    ...protocol.exports, readStateWritesRef: { current: writes },
    callAppServer: async (...args) => { calls.push(args); return rpc(...args); },
    refreshThreads: async () => { refreshes.push(true); },
    showAppToast: (...args) => toasts.push(args),
    setThreads: update => { threads = typeof update === "function" ? update(threads) : update; },
    refreshThreadsGenerationRef: { current: 0 }, activeThreadIdRef: { current: null },
    console,
  });
  return {
    update: vm.runInContext(updateCode, scope), refresh: vm.runInContext(refreshCode, scope),
    notify: vm.runInContext(notifyCode, scope),
    calls, toasts, refreshes, writes, threads: () => threads,
  };
}
{
  let finish;
  const view = context(() => new Promise(resolve => { finish = resolve; }));
  const pending = view.update("a1", "r1", true);
  await flush();
  await view.update("a1", "r1", true);
  assert.equal(view.calls.length, 1, "repeated gesture must not duplicate a write");
  assert.deepEqual(JSON.parse(JSON.stringify(view.calls[0])), ["thread/readState/update", {
    threadId: "a1", expectedRevision: "r1", operation: { type: "unread" },
  }]);
  assert.equal(view.threads()[0].readState.firstUnread, null, "waiting request must not fake unread");
  finish({ readState: unread }); await pending;
  assert.equal(view.refreshes.length, 1, "successful write reloads authoritative list projection");
  assert.equal(view.writes.size, 0);
}
for (const rpc of [async () => { throw Error("revision conflict"); }, async () => ({ readState: { revision: "" } })]) {
  const view = context(rpc);
  await view.update("a1", "r1", true);
  assert.equal(view.calls.length, 1, "failure/conflict must never retry automatically");
  assert.equal(view.threads()[0].readState.firstUnread, null);
  assert.match(view.toasts[0][0], /更新.*已读状态失败/);
  assert.equal(view.refreshes.length, 1, "conflict reloads the actual current receipt for a fresh action");
  assert.equal(view.writes.size, 0);
}
{
  const view = context(async () => ({ data: [{ id: "a1" }, { id: "b1" }], readStates: { a1: unread }, nextCursor: null }));
  await view.refresh();
  assert.deepEqual(JSON.parse(JSON.stringify(view.threads()[0].readState)), unread);
  assert.equal(view.threads()[1].readState, undefined, "ineligible rows must not inherit a receipt");
  view.notify({ method: protocol.exports.NOTIFICATION.THREAD_READ_STATE_CHANGED, params: { threadId: "a1", readState: read } });
  assert.equal(view.threads()[0].readState.firstUnread, null);
  view.notify({ method: protocol.exports.NOTIFICATION.THREAD_READ_STATE_CHANGED, params: { threadId: "a1", readState: { revision: "" } } });
  assert.equal(view.threads()[0].readState.revision, "r1", "malformed notification cannot manufacture a read state");
}
{
  assert.equal(protocol.exports.isThreadReadState({ revision: "read-without-position" }), true,
    "schema requires revision only; omitted nullable position is a valid read receipt");
  const view = context(async () => ({ readState: { revision: "read-without-position" } }));
  await view.update("a1", "r2", false);
  assert.equal(view.toasts.length, 0, "a schema-valid update response must not produce a false failure");
}
console.log("PASS service-backed sidebar read-state: menu eligibility/order/receipt, write single-flight, no optimistic mutation/retry, error refresh, page projection and notifications (L2)");

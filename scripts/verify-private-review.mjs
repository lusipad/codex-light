import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { randomUUID } from "node:crypto";
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const url = "https://github.com/o/r/pull/1";
const result = (reviewId = "check-1") => ({ reviewId, snapshotId: "snapshot-1", commitSha: null, available: false,
  coverage: "unverified", reason: "Selected account coverage remains unverified", missing: ["Complete changed-file manifest", "Fresh reviewer"],
  runtime: { modelId: "runtime-default", tools: [], disabledPluginIds: ["disabled-plugin"] } });
function moduleAt(file, require) {
  const exports = {};
  vm.runInNewContext(transpile(fs.readFileSync(file, "utf8")), { exports, require, AbortController, crypto: { randomUUID } });
  return exports;
}
function client() {
  const calls = [], listeners = [], control = { listen: async handler => { listeners.push(handler); return () => { control.stops++; }; },
    read: async () => result(), stops: 0 };
  const api = moduleAt("src/privateReview.ts", name => name === "./bridge" ? {
    tauriListen: async (name, handler) => { assert.equal(name, "remote-review-progress"); return control.listen(handler); },
  } : { serviceIdentity: async () => { calls.push("identity"); return { accountId: "a", userId: "u", generation: 1 }; },
    readPrivateReviewPreflight: async (...args) => { calls.push(args); return control.read(...args); },
    cancelPrivateReviewRequest: async id => { calls.push(["cancel", id]); return true; } });
  return { api, calls, listeners, control };
}
let c = client(), controller = new AbortController(), events = [];
const reading = c.api.checkPrivateReviewAvailability(url, "snapshot-1", null, "check-1", controller.signal, event => events.push(event));
await flush(); const response = await reading;
assert.equal(response.available, false); assert.equal(response.runtime.disabledPluginIds[0], "disabled-plugin"); assert.equal(c.control.stops, 1);
c = client(); c.control.listen = async () => { throw Error("listener unavailable"); };
await assert.rejects(c.api.checkPrivateReviewAvailability(url, "snapshot-1", null, "check-1", new AbortController().signal, () => {}), /listener unavailable/);
assert.equal(c.calls.length, 0, "cannot create a private context without its event subscription");
c = client(); const lateListener = deferred(); c.control.listen = () => lateListener.promise; controller = new AbortController();
const cancelledListener = c.api.checkPrivateReviewAvailability(url, "snapshot-1", null, "check-1", controller.signal, () => {});
controller.abort(); lateListener.resolve(() => c.control.stops++); await assert.rejects(cancelledListener, /取消/);
assert.equal(c.control.stops, 1); assert.equal(c.calls.length, 0);
c = client(); const pending = deferred(); c.control.read = () => pending.promise; controller = new AbortController(); events = [];
const pendingRead = c.api.checkPrivateReviewAvailability(url, "snapshot-1", null, "check-1", controller.signal, event => events.push(event));
await flush(); c.listeners[0]({ reviewId: "other-check", state: "running" }); c.listeners[0]({ reviewId: "check-1", state: "completed" });
assert.equal(events.length, 0); c.listeners[0]({ reviewId: "check-1", state: "running" }); assert.equal(events.length, 1);
controller.abort(); assert.ok(c.calls.some(call => Array.isArray(call) && call[0] === "cancel" && call[1] === "check-1"));
pending.resolve(result()); await assert.rejects(pendingRead, /取消/); assert.equal(c.control.stops, 1);
for (const mutate of [value => { value.snapshotId = "other"; }, value => { value.reviewId = "other"; }, value => { value.commitSha = "other"; },
  value => { value.available = true; }, value => { value.coverage = "verified"; }, value => { value.missing = []; },
  value => { value.runtime.disabledPluginIds = null; }, value => { value.runtime.tools = [null]; }]) {
  c = client(); c.control.read = async () => { const value = result(); mutate(value); return value; };
  await assert.rejects(c.api.checkPrivateReviewAvailability(url, "snapshot-1", null, "check-1", new AbortController().signal, () => {}), /响应不完整/);
}

function panel() {
  let slots = [], cursor = 0, pending = [], tree, props = { url, scope: "account-a", snapshotId: "snapshot-1", commitSha: null };
  const control = { check: async (...args) => result(args[3]) }, calls = [];
  const react = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useRef: initial => { const index = cursor++; return slots[index] ??= { current: initial }; },
    useState: initial => { const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
    useEffect: (fn, deps) => { const index = cursor++, old = slots[index];
      if (!old || deps.some((value, i) => value !== old.deps[i])) pending.push(() => { old?.stop?.(); slots[index] = { deps, stop: fn() }; }); } };
  const component = moduleAt("src/components/PrivateReviewPanel.tsx", name => name === "react" ? react : {
    checkPrivateReviewAvailability: (...args) => { calls.push(args); return control.check(...args); },
  });
  const render = next => { props = { ...props, ...next }; cursor = 0; tree = component.PrivateReviewPanel(props); };
  const effects = () => { const queue = pending; pending = []; queue.forEach(fn => fn()); };
  const walk = node => !node || typeof node !== "object" ? [] : [node, ...node.children.flatMap(walk)];
  const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "object" ? node.children.map(text).join(" ") : String(node);
  render(); effects(); render();
  return { render, effects, control, calls, text: () => text(tree), button: name => walk(tree).find(node => node.type === "button" && text(node) === name),
    unmount: () => slots.forEach(slot => slot?.stop?.()) };
}
let h = panel(); assert.equal(h.calls.length, 0); await h.button("检查审查可用性").props.onClick(); await flush(); h.render();
assert.match(h.text(), /Selected account coverage remains unverified/); assert.doesNotMatch(h.text(), /审查通过|无问题/);
h.render({ scope: "account-b" }); assert.doesNotMatch(h.text(), /Selected account coverage remains unverified/); h.effects(); h.unmount();
h = panel(); const slow = deferred(); h.control.check = () => slow.promise;
const start = h.button("检查审查可用性").props.onClick; start(); start(); assert.equal(h.calls.length, 1);
h.render(); h.button("停止检查").props.onClick(); assert.equal(h.calls[0][4].aborted, true);
slow.resolve(result()); await flush(); h.render(); assert.match(h.text(), /已请求停止检查/); assert.doesNotMatch(h.text(), /Selected account/); h.unmount();
h = panel(); h.control.check = async () => { throw Error("account changed"); }; await h.button("检查审查可用性").props.onClick(); await flush(); h.render();
assert.match(h.text(), /account changed/); h.control.check = async (...args) => result(args[3]);
await h.button("检查审查可用性").props.onClick(); await flush(); h.render(); assert.doesNotMatch(h.text(), /account changed/); h.unmount();
console.log("PASS private preflight: subscribed identity/snapshot binding, unavailable vs completed, disabled plugins, listener failure/release, cancel/late result, duplicate guard and scope isolation");

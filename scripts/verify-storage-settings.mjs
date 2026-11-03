import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { randomUUID } from "node:crypto";

const view = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
const native = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
const backend = fs.readFileSync("src-tauri/src/config_skills.rs", "utf8");
assert.ok(!native.includes("storage_clean_cache"), "STG02: destructive Tauri command stays removed");
assert.ok(!backend.includes("pub fn clean_storage_cache"), "STG02: rollout-deleting implementation stays removed");
assert.ok(!view.includes('"storage_clean_cache"'));
assert.ok(native.includes("storage_stats_get"), "STG04: unrelated local-stat consumers remain supported");
assert.ok(view.includes('activeSection === "storage" && <StorageSettings scope={JSON.stringify([connectionIdentity, accountIdentity])} onOpenLibrary={onOpenLibraryStorage} />'));
assert.ok(!view.includes("setStorageStats") && !view.includes("const formatBytes"), "STG01: cloud quota never substitutes local disk usage");
for (const suffix of ['<div className="header-right-btns">', 'saveBanner &&', 'errorBanner &&']) {
  assert.ok(view.includes(`activeSection !== "import" && activeSection !== "storage" && ${suffix}`), "STG03: no generic storage save/refresh/banner");
}
const transpile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const flush = async () => { for (let i = 0; i < 50; ++i) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const identity = { accountId: "account-fixture", userId: "user-fixture", generation: 0 };
const body = { used_bytes: 943718400, allowed_bytes: 1048576000, remaining_bytes: 104857600,
  is_over_limit: false, limit_tier: "plus", plan_type: "plus" };
function load(file, dependencies, requestId) {
  const exports = {};
  vm.runInNewContext(transpile(fs.readFileSync(file, "utf8")), { exports, AbortController, URL, Intl,
    crypto: { randomUUID: requestId ? () => requestId : randomUUID }, navigator: { userAgent: "Mozilla/5.0 Chrome/140.0.0.0", userAgentData: { platform: "Windows", brands: [{ brand: "Chromium", version: "140" }] } },
    localStorage: { getItem: () => "fixture-device" }, require: dependencies });
  return exports;
}
function client(requestId) {
  const calls = [], cancelled = [], events = {};
  const control = { identity, read: async request => ({ requestId: request.requestId, identity: request.expectedIdentity, body }),
    listen: async (name, handler) => { events[name] = handler; return () => { delete events[name]; }; } };
  const bridge = { tauriInvoke: async (command, args) => {
    if (command === "chatgpt_service_identity") return control.identity;
    if (command === "chatgpt_service_cancel") { cancelled.push(args.requestId); return; }
    assert.equal(command, "chatgpt_service_read");
    calls.push(args.request); return control.read(args.request);
  }, tauriListen: (...args) => control.listen(...args) };
  const service = load("src/chatgptService.ts", name => name === "./bridge" ? bridge : {}, requestId);
  const storage = load("src/storageUsage.ts", name => { assert.equal(name, "./chatgptService"); return service; });
  return { calls, cancelled, events, control, bridge, service, storage };
}
const parser = client().storage;
assert.equal(parser.parseStorageUsage(body).usedBytes, body.used_bytes);
assert.equal(parser.storageFullness(parser.parseStorageUsage(body)), "almostFull", "10% boundary is inclusive");
assert.equal(parser.storageFullness(parser.parseStorageUsage({ ...body, remaining_bytes: 104857601 })), "normal");
for (const change of [{ remaining_bytes: 0 }, { remaining_bytes: -1 }, { is_over_limit: true }]) {
  assert.equal(parser.storageFullness(parser.parseStorageUsage({ ...body, ...change })), "full");
}
assert.equal(parser.storageFullness(parser.parseStorageUsage({ ...body, allowed_bytes: 0, remaining_bytes: 0 })), "full");
assert.equal(parser.storageFullness(parser.parseStorageUsage({ ...body, allowed_bytes: 0, remaining_bytes: 1 })), "normal");
assert.equal(parser.parseStorageUsage({ ...body, plan_type: null, limit_tier: undefined }).limitTier, null);
for (const invalid of [null, [], {}, { ...body, used_bytes: -1 }, { ...body, allowed_bytes: -1 },
  { ...body, used_bytes: "0" }, { ...body, remaining_bytes: NaN }, { ...body, remaining_bytes: Infinity },
  { ...body, is_over_limit: null }, { ...body, allowed_bytes: undefined }, { ...body, plan_type: 1 }]) {
  assert.throws(() => parser.parseStorageUsage(invalid));
}
const fixtureIndex = process.argv.indexOf("--native-fixture");
if (fixtureIndex >= 0) {
  const fixture = JSON.parse(fs.readFileSync(process.argv[fixtureIndex + 1], "utf8"));
  const c = client(fixture.requestId); c.control.read = async () => fixture;
  const actual = await c.storage.readStorageUsage(fixture.identity, new AbortController().signal);
  assert.equal(actual.usedBytes, body.used_bytes);
  assert.equal(c.calls[0].operation, "storage_usage");
  console.log("PASS actual Rust service envelope -> production client identity/request guard -> storage parser");
}
{
  const c = client(); const signal = new AbortController().signal;
  await c.storage.readStorageUsage(identity, signal);
  assert.equal(c.calls[0].operation, "storage_usage"); assert.equal(JSON.stringify(c.calls[0].params), "{}");
  assert.equal(c.calls[0].expectedIdentity, identity);
  assert.equal(c.calls[0].profile.deviceId, "fixture-device");
  for (const change of [{ identity: { ...identity, generation: 1 } }, { identity: { ...identity, accountId: "other" } }, { requestId: "wrong" }]) {
    c.control.read = async request => ({ requestId: request.requestId, identity, body, ...change });
    await assert.rejects(c.storage.readStorageUsage(identity, signal), /账号发生变化/);
  }
  const late = deferred(); c.control.read = () => late.promise;
  const controller = new AbortController(); const reading = c.storage.readStorageUsage(identity, controller.signal);
  controller.abort(); assert.equal(c.cancelled.length, 1);
  const request = c.calls.at(-1); late.resolve({ requestId: request.requestId, identity, body });
  await assert.rejects(reading, /取消/);
}
function surface() {
  const c = client(); let slots = [], cursor = 0, pending = [], props = { scope: "a" }, tree;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect: (fn, deps) => { const i = cursor++, old = slots[i];
      if (!old || deps.some((value, index) => value !== old.deps[index])) pending.push(() => { old?.stop?.(); slots[i] = { deps, stop: fn() }; }); },
  };
  const component = load("src/components/StorageSettings.tsx", name => {
    if (name === "react") return react;
    if (name === "../bridge") return c.bridge;
    if (name === "../chatgptService") return c.service;
    assert.equal(name, "../storageUsage"); return c.storage;
  });
  const render = next => { if (next) props = { ...props, ...next }; cursor = 0; tree = component.StorageSettings(props); return tree; };
  const effects = () => { const queue = pending; pending = []; queue.forEach(fn => fn()); };
  const walk = node => !node || typeof node !== "object" ? [] : [node, ...node.children.flatMap(walk)];
  const content = node => node == null || typeof node === "boolean" ? "" : typeof node === "object" ? node.children.map(content).join(" ") : String(node);
  return Object.assign(c, { render, effects, nodes: () => walk(tree), text: () => content(tree),
    button: name => walk(tree).find(node => node.type === "button" && content(node).trim() === name),
    start: async () => { render(); effects(); await flush(); render(); effects(); },
    settle: async () => { await flush(); render(); effects(); }, unmount: () => slots.forEach(slot => slot?.stop?.()) });
}
let h = surface(); h.render(); assert.match(h.text(), /正在读取云端/); h.effects(); await h.settle();
assert.match(h.text(), /900 MB/); assert.match(h.text(), /100 MB/); assert.match(h.text(), /即将用完/);
assert.equal(h.nodes().find(node => node.type === "progress").props.value, body.used_bytes);
assert.ok(!h.nodes().some(node => node.type === "input"));
assert.doesNotMatch(h.text(), /文件数量|图像数量|升级|清理|尚未连接/);
const opened = []; h.render({ onOpenLibrary: tab => opened.push(tab) });
h.button("文件").props.onClick(); h.button("图像").props.onClick();
assert.deepEqual(opened, ["all", "images"], "storage entries keep the explicit official cleanup tab"); h.unmount();
h = surface(); h.control.read = async () => { throw Error("fixture unavailable"); }; await h.start();
assert.match(h.text(), /fixture unavailable/); assert.ok(!h.nodes().some(node => node.type === "progress"));
h.control.read = async request => ({ requestId: request.requestId, identity, body: { ...body, allowed_bytes: 0, used_bytes: 0, remaining_bytes: 0 } });
h.button("重试").props.onClick(); h.render(); h.effects(); await h.settle();
assert.match(h.text(), /0 B/); assert.match(h.text(), /已满/); assert.ok(!h.nodes().some(node => node.type === "progress")); h.unmount();
h = surface(); const first = deferred(); h.control.read = () => first.promise; await h.start();
const firstRequest = h.calls[0]; h.control.identity = { ...identity, generation: 1 };
h.control.read = async request => ({ requestId: request.requestId, identity: request.expectedIdentity,
  body: { ...body, used_bytes: 1, remaining_bytes: 1048575999 } });
h.render({ scope: "b" }); assert.doesNotMatch(h.text(), /900 MB/); h.effects(); await h.settle();
assert.equal(h.cancelled[0], firstRequest.requestId); assert.match(h.text(), /1 B/);
first.resolve({ requestId: firstRequest.requestId, identity, body }); await h.settle(); assert.doesNotMatch(h.text(), /900 MB/);
const second = deferred(); h.control.read = () => second.promise;
h.events["app-server:notification"]({ method: "account/updated" }); h.render(); assert.doesNotMatch(h.text(), /1 B/); await h.settle();
assert.equal(h.cancelled.length, 1); const secondRequest = h.calls.at(-1);
h.unmount(); assert.equal(h.cancelled.at(-1), secondRequest.requestId);
second.resolve({ requestId: secondRequest.requestId, identity: h.control.identity, body }); await flush();
assert.equal(Object.keys(h.events).length, 0);
h = surface(); const listening = deferred(); let stopped = 0; h.control.listen = () => listening.promise;
h.render(); h.effects(); h.unmount(); listening.resolve(() => stopped++); await flush();
assert.equal(stopped, 3); assert.equal(h.calls.length, 0);
h = surface(); await h.start(); assert.match(h.text(), /900 MB/);
const beforeInvalidation = h.calls.length;
h.control.identity = { ...identity, generation: 1 };
assert.equal(typeof h.events["chatgpt-service:invalidated"], "function", "auth invalidation must clear quota before account/updated");
h.events["chatgpt-service:invalidated"]({ generation: 1 }); await h.settle();
assert.doesNotMatch(h.text(), /900 MB/); assert.match(h.text(), /账号状态已变化/);
assert.equal(h.calls.length, beforeInvalidation, "invalidation cannot reread the old account while login is still pending");
h.events["app-server:notification"]({ method: "account/updated" }); await h.settle();
assert.match(h.text(), /900 MB/); assert.equal(h.calls.at(-1).expectedIdentity.generation, 1); h.unmount();
h = surface(); h.control.listen = async () => { throw Error("listener fixture failure"); }; await h.start();
assert.match(h.text(), /同步失败/); assert.ok(h.button("重试同步")); h.unmount();
console.log("PASS STG01-STG04 safety regressions; actual production storage client/parser/component: quota boundaries, schema errors, authenticated request envelope, late cancellation, account generation, scope change, retry and listener cleanup");
console.log("NOT TESTED: real authenticated HTTP, official pixel parity, native GUI/IME, complete Library cleanup and upgrades");

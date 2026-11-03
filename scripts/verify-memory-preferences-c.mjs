import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

let slots = [], cursor = 0, effects = [], pendingEffects = [], changed = false;
const windowListeners = new Map(), hostListeners = new Map(), frames = [], calls = [];
let invoke, guard = null, focused = "";
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], value => {
      const next = typeof value === "function" ? value(slots[index]) : value;
      if (!Object.is(next, slots[index])) changed = true;
      slots[index] = next;
    }];
  },
  useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
  useEffect(callback, deps) {
    const index = cursor++, previous = effects[index];
    if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps[i]))) pendingEffects.push(() => {
      previous?.cleanup?.(); effects[index] = { deps, cleanup: callback() };
    });
  },
};
const bridge = {
  tauriInvoke: (...args) => { calls.push(args); return invoke(...args); },
  tauriListen: async (name, handler) => {
    const handlers = hostListeners.get(name) || new Set(); hostListeners.set(name, handlers); handlers.add(handler);
    return () => handlers.delete(handler);
  },
};
const fakeWindow = {
  addEventListener(name, handler) { const handlers = windowListeners.get(name) || new Set(); windowListeners.set(name, handlers); handlers.add(handler); },
  removeEventListener(name, handler) { windowListeners.get(name)?.delete(handler); },
};
function load(file, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports, require: name => name === "react" ? react : name.endsWith(".css") ? {} : imports[name], window: fakeWindow,
    requestAnimationFrame: callback => frames.push(callback) });
  return exports;
}
const core = load("src/memoryPreferences.ts", { "./bridge": bridge,
  "./config": { getConfigValue: (raw, path) => path.split(".").reduce((value, key) => value?.[key], raw) } });
const { MemorySettings } = load("src/components/MemorySettings.tsx", { "../memoryPreferences": core });
const nodes = node => node && typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : [];
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const props = { active: true, accountIdentity: "account-a", connectionIdentity: "connected:a", onNavigationGuardChange: value => { guard = value; } };
const modal = { opened: false, showModal() { this.opened = true; }, close() { this.opened = false; } };
let tree;
function render() {
  let iteration = 0;
  do {
    assert.ok(iteration++ < 12, "production hooks must converge"); cursor = 0; changed = false;
    tree = MemorySettings(props);
    for (const node of nodes(tree)) {
      if (node.type === "dialog") node.props.ref.current = modal;
      else if (node.props.ref) node.props.ref.current = { focus() { focused = text(node); } };
    }
    pendingEffects.splice(0).forEach(effect => effect());
  } while (changed);
  frames.splice(0).forEach(callback => callback());
}
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const refreshRender = async () => { await settle(); render(); };
const control = id => nodes(tree).find(node => node.props.id === id);
const dialog = () => nodes(tree).find(node => node.type === "dialog");
const button = (label, inDialog = false) => {
  const found = nodes(inDialog ? dialog() : tree).find(node => node.type === "button" && text(node) === label);
  assert.ok(found, `button ${label}`); return found;
};
const eventHost = hostId => { for (const callback of hostListeners.get("memory-preferences-changed") || []) callback({ hostId }); };
const eventFocus = () => { for (const callback of windowListeners.get("focus") || []) callback(); };
const base = { hostId: "local:one", hostName: "WINDOWS-PC", userFile: "C:/isolated/config.toml", version: "v1",
  feature: { name: "memories", enabled: false, catalogEnabled: false }, config: {}, origins: {}, requirements: null,
  status: { v2Ready: true, v2ConsolidatedThreads: 0 }, statusError: null, chronicle: { available: false }, disabledReason: null, locks: {} };
let persisted = structuredClone(base);
invoke = async method => { assert.equal(method, "memory_preferences_read"); return persisted; };
render(); assert.equal(guard(() => {}), true, "read-only loading must not trap navigation"); await refreshRender();
assert.deepEqual(nodes(tree).filter(node => node.type === "label").map(text), ["启用 Codex 记忆功能", "允许从使用工具的聊天中生成记忆"]);
assert.ok(text(tree).includes("删除 Codex 记忆"));
assert.ok(text(tree).includes("根据 WINDOWS-PC 上的聊天创建记忆，并使用这些记忆为今后在 WINDOWS-PC 上的聊天提供个性化体验"));
assert.equal(control("codex-memory-enabled").props["aria-checked"], false, "ready=true cannot enable the feature");
assert.equal(control("codex-memory-external").props["aria-checked"], true);
assert.equal(control("codex-memory-external").props.disabled, true);
assert.equal(button("删除").props.disabled, false, "reset is available even with feature disabled");
assert.equal(guard(() => assert.fail("guard must not execute actions")), true);
assert.ok(!text(tree).includes("chronicle") && !text(tree).includes("v2Ready"));
console.log("PASS MC-C01: actual hook/TSX three controls and exact host Chinese, catalog qualification, ready is not enabled, feature-disabled reset remains available");

let release;
invoke = () => new Promise(resolve => { release = resolve; });
const enable = control("codex-memory-enabled").props.onClick;
enable(); enable(); render();
assert.equal(calls.filter(([method]) => method === "memory_preferences_write").length, 1);
assert.equal(control("codex-memory-enabled").props["aria-checked"], false, "no optimistic success");
assert.equal(guard(() => assert.fail("pending navigation")), false);
assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1)[1])), { expectedHostId: base.hostId, expectedVersion: "v1", operation: "enabled", value: true });
persisted = { ...base, version: "v2", feature: { ...base.feature, enabled: true }, config: { features: { memories: true }, memories: { generate_memories: true, use_memories: true } } };
release(persisted); await refreshRender();
assert.equal(control("codex-memory-enabled").props["aria-checked"], true); assert.equal(control("codex-memory-external").props.disabled, false);
invoke = async () => { throw Error("CAS conflict; delivery unknown"); };
control("codex-memory-external").props.onClick(); await refreshRender();
assert.equal(control("codex-memory-external").props["aria-checked"], true); assert.ok(text(tree).includes("CAS conflict; delivery unknown"));
const beforeFailureReload = calls.filter(([method]) => method === "memory_preferences_write").length;
invoke = async () => persisted; eventFocus(); await refreshRender();
assert.ok(text(tree).includes("CAS conflict; delivery unknown"), "background reads cannot erase mutation uncertainty");
assert.equal(calls.filter(([method]) => method === "memory_preferences_write").length, beforeFailureReload, "no automatic replay");
button("重试").props.onClick(); await refreshRender();
assert.ok(!text(tree).includes("CAS conflict"));
invoke = async (method, args) => {
  assert.equal(method, "memory_preferences_write"); assert.equal(args.operation, "external-context"); assert.equal(args.value, false);
  return persisted = { ...persisted, version: "v3", config: { ...persisted.config, memories: { ...persisted.config.memories, disable_on_external_context: true } } };
};
control("codex-memory-external").props.onClick(); await refreshRender(); assert.equal(control("codex-memory-external").props["aria-checked"], false);
console.log("PASS MC-C02: real production single-flight CAS callbacks, no optimistic selection, busy navigation, write error retains actual values and is never silently replayed");

invoke = async () => persisted = { ...persisted, feature: { ...persisted.feature, enabled: false },
  config: { features: { memories: false, chronicle: true }, memories: { generate_memories: false, use_memories: false } },
  mutation: { complete: false, errors: ["chronicle policy blocked"] } };
control("codex-memory-enabled").props.onClick(); await refreshRender();
assert.equal(control("codex-memory-enabled").props["aria-checked"], false, "partial writes must display actual committed values");
assert.ok(text(tree).includes("chronicle policy blocked"));
delete persisted.mutation; invoke = async () => persisted; button("重试").props.onClick(); await refreshRender();
invoke = async () => persisted = { ...persisted, feature: { ...persisted.feature, enabled: true },
  config: { memories: { generate_memories: false, use_memories: true } }, mutation: { complete: true, errors: [] } };
control("codex-memory-enabled").props.onClick(); await refreshRender();
assert.equal(control("codex-memory-enabled").props["aria-checked"], false);
assert.ok(text(tree).includes("保存后的记忆设置与提交值不一致"), "complete flags cannot bypass triple readback validation");
delete persisted.mutation; invoke = async () => persisted; button("重试").props.onClick(); await refreshRender();
console.log("PASS MC-C02b: actual partial mutation snapshot is adopted before error, and complete=true still requires feature/generate/use readback rather than combined false");

invoke = async () => persisted = { ...persisted, feature: { ...persisted.feature, enabled: true }, config: { memories: { generate_memories: false, use_memories: true } } };
eventHost(base.hostId); await refreshRender();
assert.equal(control("codex-memory-enabled").props["aria-checked"], false);
assert.equal(control("codex-memory-external").props.disabled, false, "tool switch depends on feature.enabled, not combined main checked");
invoke = async () => persisted;
persisted = { ...persisted, locks: { enabled: "管理员限制" }, config: { memories: { generate_memories: false, use_memories: true } } };
eventHost(base.hostId); await refreshRender(); assert.equal(control("codex-memory-enabled").props.disabled, true);
assert.equal(control("codex-memory-external").props.disabled, false);
persisted = { ...persisted, locks: {}, config: { memories: { generate_memories: "invalid", disable_on_external_context: "invalid" } } };
eventHost(base.hostId); await refreshRender(); assert.equal(control("codex-memory-enabled").props.disabled, true); assert.equal(control("codex-memory-external").props.disabled, true);
persisted = { ...persisted, config: {}, origins: { memories: { name: { type: "mdm" } } } };
eventHost(base.hostId); await refreshRender(); assert.equal(control("codex-memory-enabled").props.disabled, true); assert.ok(text(tree).includes("该值由管理员策略管理"));
persisted = { ...persisted, feature: null, config: {}, origins: {} }; eventHost(base.hostId); await refreshRender();
assert.ok(text(tree).includes("这台电脑不支持 Codex 记忆功能")); assert.equal(control("codex-memory-enabled"), undefined);
persisted = { ...base, feature: { ...base.feature, enabled: true } }; eventHost(base.hostId); await refreshRender();
persisted = { ...persisted, status: null, statusError: "status unavailable" }; eventHost(base.hostId); await refreshRender();
assert.ok(text(tree).includes("status unavailable")); assert.equal(control("codex-memory-enabled").props["aria-checked"], true);
assert.ok(!text(tree).includes("v2Ready"), "status failure is visible and never rewritten to ready");
persisted = { ...persisted, statusError: null }; eventHost(base.hostId); await refreshRender();
console.log("PASS MC-C03: separate feature/combined conditions, per-control policies, unknown/managed values locked, capability absence is visible without fabricated controls");

const resetCount = () => calls.filter(([method]) => method === "memory_preferences_reset").length;
button("删除").props.onClick(); render(); assert.equal(modal.opened, true); assert.equal(focused, "取消");
let prevented = 0, stopped = 0;
dialog().props.onKeyDown({ key: "Enter", keyCode: 229, nativeEvent: { isComposing: true }, preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
assert.equal(prevented, 1); assert.equal(stopped, 1); assert.equal(resetCount(), 0);
dialog().props.onCancel({ preventDefault() {} }); render(); assert.equal(modal.opened, false); assert.equal(focused, "删除"); assert.equal(resetCount(), 0);
button("删除").props.onClick(); render(); button("取消", true).props.onClick(); render(); assert.equal(resetCount(), 0);
button("删除").props.onClick(); render();
invoke = () => new Promise(resolve => { release = resolve; });
const confirmDelete = button("删除", true).props.onClick;
confirmDelete(); confirmDelete(); render(); assert.equal(resetCount(), 1); assert.equal(guard(() => {}), false);
assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1)[1])), { expectedHostId: base.hostId });
release({ snapshot: { ...persisted, status: { v2Ready: true, v2ConsolidatedThreads: 8 } }, reset: true, chronicleCleared: false });
await refreshRender(); assert.equal(modal.opened, false); assert.ok(text(tree).includes("Codex 记忆已删除")); assert.equal(focused, "删除");
// Acknowledgment, not a zeroed status counter, proves the reset result shown by this UI.
button("删除").props.onClick(); render();
invoke = async () => { throw Error("request sent, response lost"); };
await button("删除", true).props.onClick(); await refreshRender();
assert.ok(text(tree).includes("request sent, response lost")); assert.ok(!text(tree).includes("Codex 记忆已删除")); assert.equal(focused, "重试");
const lostResetCount = resetCount();
invoke = async () => persisted; eventHost(base.hostId); await refreshRender();
assert.equal(resetCount(), lostResetCount); assert.ok(text(tree).includes("request sent, response lost"));
button("重试").props.onClick(); await refreshRender();
button("删除").props.onClick(); render(); invoke = async () => ({ snapshot: persisted, reset: false, chronicleCleared: false });
await button("删除", true).props.onClick(); await refreshRender(); assert.ok(text(tree).includes("删除结果未获确认")); assert.ok(!text(tree).includes("Codex 记忆已删除"));
console.log("PASS MC-C04: real modal cancel/Escape/IME, single reset after explicit confirmation, acknowledgment-only success, no Chronicle claim, failure/unknown acknowledgment retained without replay");

invoke = async () => persisted; button("重试").props.onClick(); await refreshRender();
const beforeForeignHost = calls.length; eventHost("different-host"); await refreshRender(); assert.equal(calls.length, beforeForeignHost);
invoke = () => new Promise(resolve => { release = resolve; }); eventFocus(); render(); const oldRead = release;
props.accountIdentity = "account-b";
invoke = async () => ({ ...base, hostId: "local:two", hostName: "CURRENT-PC" }); render(); await refreshRender();
oldRead({ ...base, hostName: "LATE-OLD-PC" }); await refreshRender(); assert.ok(text(tree).includes("CURRENT-PC")); assert.ok(!text(tree).includes("LATE-OLD-PC"));
invoke = () => new Promise(resolve => { release = resolve; }); control("codex-memory-enabled").props.onClick(); render(); const oldWrite = release;
props.connectionIdentity = "disconnected:a"; invoke = async () => ({ ...base, hostId: "local:two", hostName: "RECONNECT-PC" }); render(); await refreshRender();
props.connectionIdentity = "connected:a"; render(); await refreshRender();
oldWrite({ ...persisted, hostId: "local:two", feature: { name: "memories", enabled: true } }); await refreshRender();
assert.equal(control("codex-memory-enabled").props["aria-checked"], false); assert.ok(text(tree).includes("RECONNECT-PC"));
props.active = false; render(); assert.equal(tree, null); assert.equal(guard, null);
assert.equal([...windowListeners.values()].reduce((sum, list) => sum + list.size, 0), 0);
assert.equal([...hostListeners.values()].reduce((sum, list) => sum + list.size, 0), 0);
props.active = true; invoke = () => new Promise(resolve => { release = resolve; }); render();
effects.forEach(effect => effect?.cleanup?.()); const beforeUnmount = slots.filter(value => value === null || typeof value !== "object");
release(base); await settle(); assert.deepEqual(slots.filter(value => value === null || typeof value !== "object"), beforeUnmount);
assert.equal(guard, null);
console.log("PASS MC-C05: foreign-host events ignored, account/reconnect epoch drops late reads/writes, inactive/unmount clears busy guards and listeners without stale updates");

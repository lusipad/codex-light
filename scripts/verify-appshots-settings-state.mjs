import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const identity = { userId: "fixture-user", accountId: "fixture-account", generation: 7 };
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const source = ts.transpileModule(fs.readFileSync("src/useAppshotsSettings.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(options = {}) {
  let active, unmounted = false, unmountStateWrites = 0;
  const calls = [], errors = [], listeners = new Map(), plans = new Map();
  const backend = { enabled: true, miniFeature: null, identity: clone(identity),
    snapshot: { identity: clone(identity), configuredHotkey: "DoubleAlt", configuredHotkeyDefaulted: false,
      eligible: true, ownerState: "active", supported: true, registration: "ready",
      destination: "automatic", destinationDefaulted: true }, ...options };
  const react = {
    useRef(value) { const run = active, index = run.cursor++; return run.slots[index] ??= { current: value }; },
    useState(value) {
      const run = active, index = run.cursor++;
      if (!(index in run.slots)) run.slots[index] = { value };
      return [run.slots[index].value, next => {
        if (unmounted) unmountStateWrites++;
        run.slots[index].value = typeof next === "function" ? next(run.slots[index].value) : next;
        run.dirty = true;
      }];
    },
    useEffect(effect, deps) {
      const run = active, index = run.cursor++, old = run.slots[index];
      if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) run.effects.push(() => {
        old?.cleanup?.(); run.slots[index] = { deps, cleanup: effect() };
      });
    },
  };
  async function invoke(name, args, signal, fallback) {
    calls.push({ name, args: clone(args), signal });
    const queue = plans.get(name);
    if (queue?.length) return queue.shift()(args, signal);
    return fallback();
  }
  const module = { exports: {} };
  vm.runInNewContext(source, { exports: module.exports, AbortController, navigator: { platform: "Win32" }, console,
    require(name) {
      if (name === "react") return react;
      if (name === "./chatgptService") return { serviceErrorMessage: error => error.message ?? String(error) };
      if (name === "./bridge") return {
        isTauriRuntime: () => true,
        tauriListen: async (name, callback) => {
          const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set);
          return () => set.delete(callback);
        },
      };
      if (name === "./appshotsAccess") return { readLocalAppshotsAccess: signal => invoke("access", [], signal,
        () => ({ identity: clone(backend.identity), enabled: backend.enabled, miniFeature: backend.miniFeature })) };
      if (name === "./appshotsSettings") return {
        readAppshotsDestination: (id, signal) => invoke("readDestination", [id], signal, () => clone(backend.snapshot)),
        readAppshotsSettings: (id, signal) => invoke("readSettings", [id], signal, () => clone(backend.snapshot)),
        setAppshotsHotkey: (id, value, signal) => invoke("setHotkey", [id, value], signal, () => {
          backend.snapshot.configuredHotkey = value; return clone(backend.snapshot);
        }),
        writeAppshotsDestination: (id, value, signal) => invoke("writeDestination", [id, value], signal, () => {
          backend.snapshot.destination = value;
          return { effective: clone(backend.snapshot), overridden: false };
        }),
      };
      throw Error(`Unexpected settings controller import ${name}`);
    },
  });
  const run = { cursor: 0, slots: [], effects: [], dirty: true, result: null,
    props: { scope: "account:7", connected: true, onError: message => errors.push(message) } };
  function render() {
    if (unmounted) return run.result;
    for (let guard = 0; run.dirty; guard++) {
      assert.ok(guard < 30, "production hook render must settle");
      run.dirty = false; run.cursor = 0; active = run;
      run.result = module.exports.useAppshotsSettings(run.props);
      run.effects.splice(0).forEach(effect => effect());
    }
    return run.result;
  }
  const flush = async () => { for (let i = 0; i < 60; i++) { await Promise.resolve(); render(); } };
  render();
  return {
    backend, calls, errors, flush,
    get view() { return render(); },
    get unmountStateWrites() { return unmountStateWrites; },
    plan(name, callback) { const queue = plans.get(name) ?? []; queue.push(callback); plans.set(name, queue); },
    count: name => calls.filter(call => call.name === name).length,
    values: name => calls.filter(call => call.name === name).map(call => call.args[1]),
    emit(name, event) { for (const listener of [...listeners.get(name) ?? []]) listener(event); },
    listenerCount: () => [...listeners.values()].reduce((count, set) => count + set.size, 0),
    setProps(patch) { run.props = { ...run.props, ...patch }; run.dirty = true; render(); },
    unmount() { unmounted = true; for (const slot of run.slots) slot?.cleanup?.(); },
  };
}

for (const [field, value] of [["eligible", null], ["eligible", false], ["supported", null], ["supported", false], ["ownerState", "unavailable"]]) {
  const f = fixture(); f.backend.snapshot[field] = value; await f.flush();
  assert.equal(f.view.available, false, `${field}=${value} cannot expose settings`);
  f.view.onHotkeyChange("DoubleShift"); f.view.onDestinationChange("last-chat"); await f.flush();
  assert.equal(f.count("setHotkey") + f.count("writeDestination"), 0);
  f.unmount();
}
for (const enabled of [null, false]) {
  const f = fixture({ enabled }); await f.flush(); assert.equal(f.view.available, false);
  assert.equal(f.count("readDestination"), 0, "unknown/denied access does not load native settings"); f.unmount();
}
const ready = fixture(); await ready.flush(); assert.equal(ready.view.available, true);
ready.emit("appshots:entry", { type: "state", supported: true, registration: "ready" }); await ready.flush();
assert.equal(ready.count("setHotkey") + ready.count("writeDestination"), 0, "state refresh is read-only"); ready.unmount();
console.log("PASS qualification/owner tri-state visibility and read-only refresh");

const hotkey = fixture(); await hotkey.flush();
const hotkeyWrite = deferred(); hotkey.plan("setHotkey", () => hotkeyWrite.promise);
hotkey.view.onHotkeyChange("DoubleShift"); await hotkey.flush();
assert.equal(hotkey.view.hotkeyPending, true); assert.equal(hotkey.view.configuredHotkey, "DoubleAlt", "pending hotkey is not optimistic");
hotkey.view.onHotkeyChange(null); await hotkey.flush(); assert.equal(hotkey.count("setHotkey"), 1, "one registration write in flight");
hotkeyWrite.reject(Error("fixture registration failed")); await hotkey.flush();
assert.match(hotkey.view.hotkeyError, /registration failed/); assert.equal(hotkey.view.hotkeyPending, false);
assert.equal(hotkey.count("setHotkey"), 1); assert.ok(hotkey.count("readSettings") >= 1, "failed write retries reads only");
hotkey.view.onHotkeyChange("DoubleAlt"); await hotkey.flush();
assert.equal(hotkey.view.hotkeyError, null, "reselecting confirmed value clears the actual inline error");
assert.equal(hotkey.count("setHotkey"), 1, "same-value hotkey selection has zero setter RPC");
hotkey.view.onHotkeyChange("DoubleShift"); await hotkey.flush(); assert.equal(hotkey.view.configuredHotkey, "DoubleShift");
hotkey.backend.snapshot.supported = false; hotkey.backend.snapshot.registration = "none";
hotkey.emit("appshots:entry", { type: "state", supported: false, registration: "none" });
assert.equal(hotkey.view.available, false, "late registration failure hides controls synchronously");
await hotkey.flush(); assert.equal(hotkey.view.configuredHotkey, "DoubleShift", "late failure keeps stored preference");
assert.equal(hotkey.view.supported, false); hotkey.unmount();
console.log("PASS hotkey confirmed selection/single-flight/error clearing/late native failure");

const hotkeyReadback = fixture(); await hotkeyReadback.flush();
hotkeyReadback.plan("setHotkey", async () => {
  hotkeyReadback.backend.snapshot.configuredHotkey = "DoubleShift";
  throw Error("fixture hotkey readback failed");
});
hotkeyReadback.plan("readSettings", async () => { throw Error("fixture first read retry failed"); });
hotkeyReadback.view.onHotkeyChange("DoubleShift"); await hotkeyReadback.flush();
assert.equal(hotkeyReadback.count("setHotkey"), 1, "ambiguous hotkey result is never rewritten");
assert.equal(hotkeyReadback.count("readSettings"), 1, "only read retry follows a failed hotkey transaction");
assert.equal(hotkeyReadback.view.configuredHotkey, "DoubleShift", "later read-only refresh finds the actually stored choice");
assert.match(hotkeyReadback.view.hotkeyError, /hotkey readback failed/, "read retry failure does not replace the original inline error");
hotkeyReadback.unmount();

const serial = fixture(); await serial.flush();
const first = deferred(), second = deferred();
serial.plan("writeDestination", () => first.promise); serial.plan("writeDestination", () => second.promise);
serial.view.onDestinationChange("last-chat"); serial.view.onDestinationChange("new-chat"); await serial.flush();
assert.deepEqual(serial.values("writeDestination"), ["last-chat"], "destination B waits for A");
assert.equal(serial.view.destination, "new-chat");
first.reject(Error("old A failed")); await serial.flush();
assert.deepEqual(serial.values("writeDestination"), ["last-chat", "new-chat"]);
assert.equal(serial.view.destination, "new-chat", "old A failure cannot roll back newer B");
assert.equal(serial.errors.length, 0, "obsolete A failure does not replace B status");
serial.backend.snapshot.destination = "automatic";
second.resolve({ effective: clone(serial.backend.snapshot), overridden: true }); await serial.flush();
assert.equal(serial.view.destination, "automatic", "B uses confirmed actual effective value");
assert.equal(serial.errors.length, 0, "source does not add a success/override toast; show the actual effective selection");
serial.view.onDestinationChange("automatic"); await serial.flush();
assert.deepEqual(serial.values("writeDestination"), ["last-chat", "new-chat", "automatic"], "same effective value still gets a new write/version");
serial.unmount();
console.log("PASS destination serialization/latest-choice/actual-effective/same-value new write");

for (const firstSucceeded of [false, true]) {
  const f = fixture(); await f.flush();
  const a = deferred(), b = deferred();
  f.plan("writeDestination", () => a.promise); f.plan("writeDestination", () => b.promise);
  f.plan("readDestination", async () => { throw Error("fixture recovery read failed"); });
  f.view.onDestinationChange("last-chat"); f.view.onDestinationChange("new-chat"); await f.flush();
  if (firstSucceeded) {
    f.backend.snapshot.destination = "last-chat";
    a.resolve({ effective: clone(f.backend.snapshot), overridden: false });
  } else a.reject(Error("fixture A write failed"));
  await f.flush();
  assert.equal(f.view.destination, "new-chat", "settled older A must not replace the pending B choice");
  b.reject(Error("fixture B write failed")); await f.flush();
  assert.equal(f.count("writeDestination"), 2, "failed destination writes are never replayed");
  assert.equal(f.view.destination, firstSucceeded ? "last-chat" : "automatic",
    `A ${firstSucceeded ? "confirmed" : "failed"}, B failed and recovery read failed must show the last actual confirmation`);
  f.unmount();
}
console.log("PASS destination failure rollback uses confirmed baseline, including superseded successful writes");

const reverseKeys = fixture(); await reverseKeys.flush();
const oldHotkeyAck = { ...clone(reverseKeys.backend.snapshot), configuredHotkey: "DoubleShift" };
const pendingHotkey = deferred(); reverseKeys.plan("setHotkey", () => pendingHotkey.promise);
reverseKeys.view.onHotkeyChange("DoubleShift"); await reverseKeys.flush();
reverseKeys.view.onDestinationChange("last-chat"); await reverseKeys.flush();
assert.equal(reverseKeys.view.destination, "last-chat");
reverseKeys.plan("readDestination", async () => { throw Error("fixture independent-key refresh failed"); });
reverseKeys.backend.snapshot.configuredHotkey = "DoubleShift";
pendingHotkey.resolve(oldHotkeyAck); await reverseKeys.flush();
assert.equal(reverseKeys.view.destination, "last-chat", "old destination inside hotkey ACK cannot undo independently confirmed destination");
assert.equal(reverseKeys.view.configuredHotkey, "DoubleShift"); reverseKeys.unmount();
console.log("PASS independent destination survives older hotkey ACK and failed refresh");

const independentKeys = fixture(); await independentKeys.flush();
const oldDestinationAck = { ...clone(independentKeys.backend.snapshot), destination: "last-chat" };
const pendingDestination = deferred(); independentKeys.plan("writeDestination", () => pendingDestination.promise);
independentKeys.view.onDestinationChange("last-chat"); await independentKeys.flush();
independentKeys.view.onHotkeyChange("DoubleShift"); await independentKeys.flush();
assert.equal(independentKeys.view.configuredHotkey, "DoubleShift");
independentKeys.plan("readDestination", async () => { throw Error("fixture independent-key refresh failed"); });
independentKeys.backend.snapshot.destination = "last-chat";
pendingDestination.resolve({ effective: oldDestinationAck, overridden: false }); await independentKeys.flush();
assert.equal(independentKeys.view.configuredHotkey, "DoubleShift", "older destination ACK cannot undo independently confirmed hotkey when refresh fails");
assert.equal(independentKeys.view.destination, "last-chat"); independentKeys.unmount();
console.log("PASS independent hotkey survives older destination ACK and failed refresh");

for (const write of ["setHotkey", "writeDestination"]) {
  const f = fixture();
  if (write === "writeDestination") f.backend.snapshot.configuredHotkey = "DoubleShift";
  await f.flush();
  const pending = deferred(); f.plan(write, () => pending.promise);
  if (write === "setHotkey") f.view.onHotkeyChange("DoubleShift");
  else f.view.onDestinationChange("last-chat");
  await f.flush();
  f.emit("appshots:entry", { type: "state", supported: false, registration: "none" });
  assert.equal(f.view.available, false, `${write} pending native failure hides immediately`);
  f.plan("readDestination", async () => { throw Error("fixture native-failure refresh failed"); });
  const oldAck = { ...clone(f.backend.snapshot), configuredHotkey: "DoubleShift", supported: true, registration: "ready" };
  if (write === "setHotkey") pending.resolve(oldAck);
  else pending.resolve({ effective: { ...oldAck, destination: "last-chat" }, overridden: false });
  await f.flush();
  assert.equal(f.view.available, false, `${write} stale ACK cannot revive support after a newer native failure`);
  assert.equal(f.view.supported, false, `${write} retains the newer native state despite failed refresh`);
  assert.equal(f.view.configuredHotkey, "DoubleShift", `${write} keeps the actually confirmed preference`);
  assert.equal(f.count(write), 1, `${write} native failure never replays the setter`);
  f.unmount();
}
console.log("PASS newer native failure survives older hotkey/destination ACK and failed refresh");

for (const stage of ["write", "readback"]) {
  const f = fixture(); await f.flush();
  f.plan("writeDestination", async () => {
    if (stage === "readback") f.backend.snapshot.destination = "last-chat";
    throw Error(`fixture ${stage} failed`);
  });
  const reads = f.count("readDestination");
  f.view.onDestinationChange("last-chat"); await f.flush();
  assert.equal(f.count("writeDestination"), 1, `${stage} failure must not replay a write`);
  assert.ok(f.count("readDestination") > reads, `${stage} failure reloads actual state read-only`);
  assert.equal(f.view.destination, stage === "readback" ? "last-chat" : "automatic");
  assert.ok(f.errors.includes("无法保存应用快照目标目标"), "destination failure uses the exact official Chinese toast, without debug details"); f.unmount();
}
console.log("PASS destination write/readback failure read-only recovery");

const aba = fixture(); await aba.flush();
const expectedLiveListeners = aba.listenerCount();
const staleActions = aba.view, old = deferred(); aba.plan("setHotkey", () => old.promise);
aba.view.onHotkeyChange("DoubleShift"); await aba.flush();
const oldSignal = aba.calls.find(call => call.name === "setHotkey").signal;
aba.setProps({ scope: "account:other" }); aba.setProps({ scope: "account:7" }); await aba.flush();
assert.equal(oldSignal.aborted, true, "scope replacement aborts old request even after ABA");
const setterCount = aba.count("setHotkey"), destinationCount = aba.count("writeDestination");
staleActions.onHotkeyChange(null); staleActions.onDestinationChange("new-chat");
old.resolve({ ...clone(aba.backend.snapshot), configuredHotkey: "DoubleShift" }); await aba.flush();
assert.equal(aba.view.configuredHotkey, "DoubleAlt", "old result cannot replace new same-key scope");
assert.equal(aba.count("setHotkey"), setterCount); assert.equal(aba.count("writeDestination"), destinationCount);
assert.equal(aba.listenerCount(), expectedLiveListeners, "scope ABA retains only live listeners"); aba.unmount();
assert.equal(aba.listenerCount(), 0); assert.equal(aba.unmountStateWrites, 0);

const invalidated = fixture(); await invalidated.flush();
const invalidatedSignals = invalidated.calls.map(call => call.signal);
const access = deferred(); invalidated.plan("access", () => access.promise);
invalidated.emit("chatgpt-service:invalidated", 8);
assert.equal(invalidated.view.available, false, "identity invalidation immediately hides old snapshot");
assert.ok(invalidatedSignals.every(signal => signal.aborted), "identity invalidation synchronously aborts the retired controller");
await invalidated.flush(); invalidated.setProps({ connected: false });
access.resolve({ identity: clone(identity), enabled: true }); await invalidated.flush();
assert.equal(invalidated.view.available, false); assert.equal(invalidated.listenerCount(), 0);
invalidated.unmount(); assert.equal(invalidated.unmountStateWrites, 0);

const subscribing = fixture(); subscribing.unmount(); await subscribing.flush();
assert.equal(subscribing.listenerCount(), 0, "subscription resolved after unmount is immediately released");
assert.equal(subscribing.unmountStateWrites, 0);

for (const name of ["access", "readDestination", "setHotkey", "writeDestination"]) {
  const f = fixture(), pending = deferred();
  if (name === "setHotkey" || name === "writeDestination") await f.flush();
  f.plan(name, () => pending.promise);
  if (name === "setHotkey") f.view.onHotkeyChange("DoubleShift");
  else if (name === "writeDestination") f.view.onDestinationChange("last-chat");
  await f.flush();
  const request = f.calls.findLast(call => call.name === name); assert.ok(request, `${name} is pending`);
  f.unmount(); assert.equal(request.signal.aborted, true); assert.equal(f.listenerCount(), 0);
  if (name === "access") pending.resolve({ identity: clone(identity), enabled: true });
  else if (name === "writeDestination") pending.resolve({ effective: clone(f.backend.snapshot), overridden: false });
  else pending.resolve(clone(f.backend.snapshot));
  await f.flush(); assert.equal(f.unmountStateWrites, 0, `${name} late completion cannot setState after unmount`);
}
console.log("PASS stale callbacks/scope ABA/identity invalidation/abort/unmount listener release");

const crossScope = fixture(); await crossScope.flush();
const oldDestination = deferred(); crossScope.plan("writeDestination", () => oldDestination.promise);
crossScope.view.onDestinationChange("last-chat");
crossScope.view.onDestinationChange("new-chat"); await crossScope.flush();
crossScope.setProps({ scope: "next-account" }); await crossScope.flush();
crossScope.view.onDestinationChange("last-chat"); await crossScope.flush();
assert.deepEqual(crossScope.values("writeDestination"), ["last-chat"], "new scope write waits behind already sent old write");
oldDestination.reject(Error("obsolete scope write failed")); await crossScope.flush();
assert.deepEqual(crossScope.values("writeDestination"), ["last-chat", "last-chat"], "retired scope's queued new-chat choice is never delivered");
assert.equal(crossScope.view.destination, "last-chat");
assert.equal(crossScope.errors.length, 0, "old scope failure cannot notify or roll back current scope");
crossScope.unmount(); assert.equal(crossScope.listenerCount(), 0); assert.equal(crossScope.unmountStateWrites, 0);
console.log("PASS cross-scope write serialization and retired queued-choice discard");

for (const replacement of ["scope", "unmount"]) {
  const original = fixture(); await original.flush();
  const pending = deferred(); original.plan("writeDestination", () => pending.promise);
  original.view.onDestinationChange("last-chat"); await original.flush();
  const oldSignal = original.calls.find(call => call.name === "writeDestination").signal;
  let current = original;
  if (replacement === "scope") {
    original.setProps({ scope: "new-composer-scope" });
  } else {
    original.unmount();
    current = fixture({ snapshot: original.backend.snapshot });
  }
  await current.flush();
  assert.equal(oldSignal.aborted, true, `${replacement} aborts the old request but cannot undo its later commit`);
  assert.equal(current.view.destination, "automatic", "replacement may initially read the value before the old commit");
  original.backend.snapshot.destination = "last-chat";
  pending.resolve({ effective: clone(original.backend.snapshot), overridden: false });
  current.emit("appshots-settings-changed", {}); // Host notification has no old-scope data to merge.
  await original.flush(); await current.flush();
  assert.equal(current.view.destination, "last-chat", `${replacement} replacement must read the actual old write after host completion notification`);
  assert.equal(original.count("writeDestination"), 1, "old write is never replayed");
  if (current !== original) assert.equal(current.count("writeDestination"), 0, "new controller performs reads only");
  current.unmount(); assert.equal(current.listenerCount(), 0);
  assert.equal(original.unmountStateWrites, 0); assert.equal(current.unmountStateWrites, 0);
}
console.log("PASS host destination-change notification refreshes replacement scope and remounted controller read-only");
console.log("Appshots settings state checks passed (production hook with isolated mocked controller dependencies; no native/service/IME verification).");

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const identity = { userId: "fixture-user", accountId: "fixture-account", generation: 7 };
const account = JSON.stringify([identity.userId, identity.accountId, identity.generation]);
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
class CaptureClock extends Date {
  constructor(...args) { super(...(args.length ? args : ["2026-11-17T04:05:06.789Z"])); }
}

function fixture() {
  let active;
  const calls = [], captures = [], errors = [], listeners = new Map();
  const config = { introAccepted: false, enabled: true, accept: null, claimError: false, generation: 0 };
  const react = {
    createElement: (type, props) => ({ type, props }),
    useRef(value) { const run = active, index = run.cursor++; return run.slots[index] ??= { current: value }; },
    useState(value) {
      const run = active, index = run.cursor++;
      if (!(index in run.slots)) run.slots[index] = { value };
      return [run.slots[index].value, next => { run.slots[index].value = typeof next === "function" ? next(run.slots[index].value) : next; run.dirty = true; }];
    },
    useEffect(effect, deps) {
      const run = active, index = run.cursor++, old = run.slots[index];
      if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) run.effects.push(() => {
        old?.cleanup?.(); run.slots[index] = { deps, cleanup: effect() };
      });
    },
  };
  const context = { exports: {}, require: () => { throw Error("Unexpected context import"); } };
  vm.runInNewContext(compile("src/appshotContext.ts"), context);
  const module = { exports: {} };
  vm.runInNewContext(compile("src/useAppshotsEntry.ts"), {
    exports: module.exports, AbortController, Date: CaptureClock, console, document: { querySelector: () => null },
    require(name) {
      if (name === "react") return react;
      if (name === "./appshotContext") return context.exports;
      if (name === "./components/AppshotIntroDialog") return { AppshotIntroDialog: "intro-dialog" };
      if (name === "./appshotsAccess") return { readLocalAppshotsAccess: async signal => { signal.throwIfAborted(); return { identity: clone(identity), enabled: config.enabled }; } };
      if (name === "./bridge") return {
        tauriListen: async (name, callback) => {
          const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set);
          return () => set.delete(callback);
        },
        tauriInvoke: async (command, args) => {
          calls.push({ command, args: args && clone(args) });
          if (command === "appshots_entry_claim") {
            if (config.claimError) throw Error("fixture claim failed");
            return { accepted: true, introAccepted: config.introAccepted };
          }
          if (command === "appshots_entry_accept") return config.accept ? config.accept.promise : true;
          if (command === "appshots_entry_configure") return { supported: true, registration: "ready", introAccepted: config.introAccepted };
          if (command === "appshots_entry_decline") return true;
          assert.equal(command, "appshots_entry_stop");
        },
      };
      throw Error(`Unexpected hook import ${name}`);
    },
  });
  const run = { cursor: 0, slots: [], effects: [], dirty: true, result: null,
    props: { enabled: true, scope: "thread:A", canAccept: true, isNewChat: false, contextKey: "account-7", captureGeneration: 0,
      getCaptureGeneration: () => config.generation,
      onCapture: value => captures.push(clone(value)), onError: message => errors.push(message) } };
  const render = () => {
    for (let guard = 0; run.dirty; guard++) {
      assert.ok(guard < 30); run.dirty = false; run.cursor = 0; active = run;
      run.result = module.exports.useAppshotsEntry(run.props);
      run.effects.splice(0).forEach(effect => effect());
    }
    return run.result;
  };
  const flush = async () => { for (let i = 0; i < 40; i++) { await Promise.resolve(); render(); } };
  render();
  return { config, calls, captures, errors, flush, get intro() { return render().intro; },
    emit: event => { for (const callback of listeners.get("appshots:entry") ?? []) callback(event); },
    invalidate: () => { for (const callback of listeners.get("chatgpt-service:invalidated") ?? []) callback(8); },
    setProps(patch) { if (patch.captureGeneration !== undefined) config.generation = patch.captureGeneration; run.props = { ...run.props, ...patch }; run.dirty = true; render(); },
    unmount() { for (const slot of run.slots) slot?.cleanup?.(); },
  };
}
const route = (id, patch = {}) => ({ type: "route", id, account, composer: "thread:A", route: "current",
  metadata: { appName: "Editor", bundleIdentifier: "process:C:\\Editor.exe", windowTitle: "Original" }, requestedAt: "2026-11-17T01:02:03.456Z", ...patch });
const captured = id => ({ type: "capture", id, account, composer: "thread:A", metadata: route(id).metadata,
  imageDataUrl: "data:image/png;base64,AA==", axTree: 'Window: "Actual title", App: "Editor"\nOffscreen' });
const count = (fixture, command) => fixture.calls.filter(call => call.command === command).length;

const cancel = fixture(); await cancel.flush();
cancel.emit(route("cancel")); cancel.emit(route("cancel")); await cancel.flush();
assert.equal(count(cancel, "appshots_entry_claim"), 1);
assert.ok(cancel.intro); cancel.intro.props.onClose(); await cancel.flush();
assert.equal(count(cancel, "appshots_entry_decline"), 1);
assert.equal(count(cancel, "appshots_entry_accept"), 0);
assert.equal(cancel.captures.length, 0); assert.equal(cancel.intro, null); cancel.unmount();

const race = fixture(); await race.flush(); race.emit(route("capture")); await race.flush();
race.config.accept = deferred(); race.intro.props.onAccept(); await race.flush();
assert.equal(race.calls.find(call => call.command === "appshots_entry_accept").args.request.acceptIntro, true);
race.emit(captured("capture")); await race.flush(); assert.equal(race.captures.length, 0, "capture waits for the accept ACK");
race.config.accept.resolve(true); await race.flush();
assert.equal(race.captures.length, 1); assert.equal(race.captures[0].context.windowTitle, "Actual title");
assert.equal(race.captures[0].context.imageName, "Editor Appshot 2026-11-17T04-05-06.789Z.png", "filename starts after intro, not at the original down event");
race.emit(captured("capture")); await race.flush(); assert.equal(race.captures.length, 1); race.unmount();

const stale = fixture(); stale.config.introAccepted = true; stale.config.accept = deferred();
await stale.flush(); stale.emit(route("old")); await stale.flush();
stale.setProps({ scope: "thread:B" }); stale.config.accept.resolve(true); stale.emit(captured("old")); await stale.flush();
assert.equal(stale.captures.length, 0); assert.equal(stale.intro, null); stale.unmount();

const submitted = fixture(); submitted.config.introAccepted = true; await submitted.flush();
submitted.emit(route("before-send")); await submitted.flush();
assert.equal(count(submitted, "appshots_entry_accept"), 1);
submitted.config.generation = 1; // ACK fences synchronously, before React renders the new generation
submitted.emit(captured("before-send")); await submitted.flush();
assert.equal(submitted.captures.length, 0, "a capture started before confirmed send must not enter the next follow-up draft");
submitted.setProps({ captureGeneration: 1 });
submitted.unmount();

const revoked = fixture(); await revoked.flush(); revoked.emit(route("revoked")); await revoked.flush();
revoked.config.enabled = false; revoked.intro.props.onAccept(); await revoked.flush();
assert.equal(count(revoked, "appshots_entry_accept"), 0); assert.equal(revoked.captures.length, 0); revoked.unmount();

const work = fixture(); await work.flush(); work.emit(route("work", { route: "new-chat" })); work.emit(route("foreign", { account: "foreign" })); await work.flush();
assert.equal(count(work, "appshots_entry_accept"), 0); assert.equal(count(work, "appshots_entry_claim"), 0); work.unmount();

const invalid = fixture(); await invalid.flush(); invalid.emit(route("invalid")); await invalid.flush();
invalid.invalidate(); invalid.emit(captured("invalid")); await invalid.flush();
assert.equal(invalid.intro, null, "service invalidation closes an old intro immediately");
assert.equal(invalid.captures.length, 0); invalid.unmount();

const failed = fixture(); failed.config.claimError = true; await failed.flush(); failed.emit(route("failed")); await failed.flush();
assert.equal(count(failed, "appshots_entry_decline"), 1, "claim errors retire the native lease");
assert.equal(failed.captures.length, 0); failed.unmount();
const appSource = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let canAccept;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(appSource) === "useAppshotsEntry") {
    canAccept = node.arguments[0].properties.find(property => property.name?.getText(appSource) === "canAccept").initializer;
  }
  ts.forEachChild(node, visit);
}
visit(appSource); assert.ok(canAccept);
for (const [activeRoute, cloudActive, expected] of [["home", true, false], ["home", false, true], ["thread", true, true], ["cloud-draft", true, false], ["settings", false, false]]) {
  assert.equal(vm.runInNewContext(canAccept.getText(appSource), { activeRoute, homeCloud: { active: cloudActive } }), expected,
    `production ${activeRoute} consumer must respect cloud mode`);
}
console.log("Appshots entry: cancellation, one-time delivery, ACK race, synchronous draft generation, stale scope, revoked access, cloud-home restriction, independent Work and identity invalidation passed (isolated bridge; no real service/model/native capture).");

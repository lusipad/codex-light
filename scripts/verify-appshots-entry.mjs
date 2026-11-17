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
  const calls = [], captures = [], errors = [], listeners = new Map(), commits = [];
  let unmounted = false, unmountStateWrites = 0;
  const config = { introAccepted: false, enabled: true, accept: null, access: null, claimError: false, generation: 0 };
  const react = {
    createElement: (type, props) => ({ type, props }),
    useRef(value) { const run = active, index = run.cursor++; return run.slots[index] ??= { current: value }; },
    useState(value) {
      const run = active, index = run.cursor++;
      if (!(index in run.slots)) run.slots[index] = { value };
      return [run.slots[index].value, next => { if (unmounted) unmountStateWrites++; run.slots[index].value = typeof next === "function" ? next(run.slots[index].value) : next; run.dirty = true; }];
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
      if (name === "react-dom") return { flushSync: callback => {
        callback(); render(); commits.push(clone(run.result.pendingIds));
      } };
      if (name === "./appshotContext") return context.exports;
      if (name === "./components/AppshotIntroDialog") return { AppshotIntroDialog: "intro-dialog" };
      if (name === "./appshotsAccess") return { readLocalAppshotsAccess: async signal => {
        signal.throwIfAborted();
        if (config.access) await config.access.promise;
        signal.throwIfAborted();
        return { identity: clone(identity), enabled: config.enabled };
      } };
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
          if (command === "appshots_entry_accept") {
            calls.at(-1).presentedPending = clone(run.result.pendingIds);
            return config.accept ? config.accept.promise : true;
          }
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
  return { config, calls, captures, errors, commits, flush, get intro() { return render().intro; },
    get unmountStateWrites() { return unmountStateWrites; },
    get pendingIds() { const value = render().pendingIds; return value === undefined ? undefined : clone(value); },
    emit: event => { for (const callback of listeners.get("appshots:entry") ?? []) callback(event); },
    invalidate: () => { for (const callback of listeners.get("chatgpt-service:invalidated") ?? []) callback(8); },
    setProps(patch) { if (patch.captureGeneration !== undefined) config.generation = patch.captureGeneration; run.props = { ...run.props, ...patch }; run.dirty = true; render(); },
    unmount() { unmounted = true; for (const slot of run.slots) slot?.cleanup?.(); },
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
assert.deepEqual(cancel.pendingIds, [], "intro alone has no pending attachment");
assert.ok(cancel.intro); cancel.intro.props.onClose(); await cancel.flush();
assert.equal(count(cancel, "appshots_entry_decline"), 1);
assert.equal(count(cancel, "appshots_entry_accept"), 0);
assert.equal(cancel.captures.length, 0); assert.equal(cancel.intro, null); cancel.unmount();
assert.deepEqual(cancel.pendingIds, [], "intro cancellation never creates pending");

const race = fixture(); await race.flush(); race.emit(route("capture")); await race.flush();
race.config.accept = deferred(); race.intro.props.onAccept(); await race.flush();
assert.equal(race.calls.find(call => call.command === "appshots_entry_accept").args.request.acceptIntro, true);
assert.deepEqual(race.calls.find(call => call.command === "appshots_entry_accept").presentedPending, ["capture"], "pending must already be committed before native capture starts");
assert.deepEqual(race.commits, [["capture"]], "capture start synchronously commits pending");
assert.deepEqual(race.pendingIds, ["capture"], "accept begins one pending attachment with the original id");
race.emit(captured("capture")); await race.flush(); assert.equal(race.captures.length, 0, "capture waits for the accept ACK");
assert.deepEqual(race.pendingIds, ["capture"], "early capture stays pending until ACK");
race.config.accept.resolve(true); await race.flush();
assert.equal(race.captures.length, 1); assert.equal(race.captures[0].context.windowTitle, "Actual title");
assert.equal(race.captures[0].capture.order, 1, "local capture metadata preserves its start rank");
assert.deepEqual(race.pendingIds, [], "successful delivery removes pending");
assert.equal(race.captures[0].context.imageName, "Editor Appshot 2026-11-17T04-05-06.789Z.png", "filename starts after intro, not at the original down event");
race.emit(captured("capture")); await race.flush(); assert.equal(race.captures.length, 1); race.unmount();
assert.equal(race.unmountStateWrites, 0, "effect cleanup does not update React state on unmount");

const ordered = fixture(); ordered.config.introAccepted = true; await ordered.flush();
ordered.emit(route("rank-a")); await ordered.flush(); ordered.emit(route("rank-b")); await ordered.flush();
ordered.emit(captured("rank-b")); ordered.emit(captured("rank-a")); await ordered.flush();
assert.deepEqual(ordered.captures.map(value => [value.id, value.capture.order]), [["rank-b", 2], ["rank-a", 1]], "completion order does not replace original start ranks");
ordered.setProps({ scope: "thread:B" }); await ordered.flush();
ordered.emit(route("rank-c", { composer: "thread:B" })); await ordered.flush();
ordered.emit({ ...captured("rank-c"), composer: "thread:B" }); await ordered.flush();
assert.equal(ordered.captures.at(-1).capture.order, 3, "start rank survives scope effect replacement");
assert.equal(ordered.captures.at(-1).context.order, undefined, "start rank is local bookkeeping, not a model context field");
ordered.unmount(); assert.equal(ordered.unmountStateWrites, 0);

const stale = fixture(); stale.config.introAccepted = true; stale.config.accept = deferred();
await stale.flush(); stale.emit(route("old")); await stale.flush();
stale.setProps({ scope: "thread:B" }); stale.config.accept.resolve(true); stale.emit(captured("old")); await stale.flush();
assert.deepEqual(stale.pendingIds, [], "new scope immediately hides old pending");
assert.equal(stale.captures.length, 0); assert.equal(stale.intro, null); stale.unmount();

const submitted = fixture(); submitted.config.introAccepted = true; await submitted.flush();
submitted.emit(route("before-send")); await submitted.flush();
assert.equal(count(submitted, "appshots_entry_accept"), 1);
submitted.config.generation = 1; // ACK fences synchronously, before React renders the new generation
submitted.setProps({}); // Render with the old prop but the already advanced imperative generation.
assert.deepEqual(submitted.pendingIds, [], "synchronous generation fence hides pending even before the generation prop advances");
submitted.emit(captured("before-send")); await submitted.flush();
assert.equal(submitted.captures.length, 0, "a capture started before confirmed send must not enter the next follow-up draft");
submitted.setProps({ captureGeneration: 1 });
submitted.unmount();

const revoked = fixture(); await revoked.flush(); revoked.emit(route("revoked")); await revoked.flush();
revoked.config.enabled = false; revoked.intro.props.onAccept(); await revoked.flush();
assert.equal(count(revoked, "appshots_entry_accept"), 0); assert.equal(revoked.captures.length, 0); revoked.unmount();
assert.deepEqual(revoked.pendingIds, [], "revoked qualification cannot create pending");

const fresh = fixture(); await fresh.flush(); fresh.emit(route("fresh")); await fresh.flush();
fresh.config.access = deferred(); fresh.config.accept = deferred(); fresh.intro.props.onAccept(); await fresh.flush();
assert.deepEqual(fresh.pendingIds, [], "fresh qualification must finish before pending begins");
fresh.config.access.resolve(); await fresh.flush();
assert.deepEqual(fresh.pendingIds, ["fresh"]);
fresh.config.accept.resolve(false); await fresh.flush();
assert.deepEqual(fresh.pendingIds, [], "negative accept ACK removes pending");
assert.equal(fresh.captures.length, 0); fresh.unmount();

for (const retirement of ["failed", "retired", "none", "invalidated"]) {
  const pending = fixture(); pending.config.introAccepted = true; pending.config.accept = deferred();
  await pending.flush(); pending.emit(route(retirement)); await pending.flush();
  assert.deepEqual(pending.pendingIds, [retirement], "autoaccepted entry also becomes pending");
  if (retirement === "invalidated") pending.invalidate();
  else if (retirement === "none") pending.emit({ type: "state", supported: true, registration: "none" });
  else pending.emit({ type: retirement, id: retirement, message: "fixture capture failed" });
  await pending.flush(); assert.deepEqual(pending.pendingIds, [], `${retirement} clears pending immediately`);
  pending.emit(captured(retirement)); pending.config.accept.resolve(true); await pending.flush();
  assert.equal(pending.captures.length, 0, `${retirement} rejects late ACK/capture`); pending.unmount();
}

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
console.log("Appshots entry: synchronous pending commit before start, cross-effect capture start ranks, no unmount state writes, pending qualification/ACK/delivery/retirement, cancellation, one-time delivery, ACK race, synchronous draft generation, stale scope, revoked access, cloud-home restriction, independent Work and identity invalidation passed (isolated bridge; no real service/model/native capture).");

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
  let unmounted = false, unmountStateWrites = 0, renderStateWrites = 0, rendering = false, pausePassive = false;
  const config = { introAccepted: false, enabled: true, accept: null, access: null, claim: null,
    configure: null, contexts: [], listen: null, stop: null, claimError: false, generation: 0 };
  const react = {
    createElement: (type, props) => ({ type, props }),
    useRef(value) { const run = active, index = run.cursor++; return run.slots[index] ??= { current: value }; },
    useMemo(create, deps) {
      const run = active, index = run.cursor++, old = run.slots[index];
      if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) run.slots[index] = { deps, value: create() };
      return run.slots[index].value;
    },
    useState(value) {
      const run = active, index = run.cursor++;
      if (!(index in run.slots)) run.slots[index] = { value };
      return [run.slots[index].value, next => {
        if (unmounted) unmountStateWrites++;
        if (rendering) renderStateWrites++;
        run.slots[index].value = typeof next === "function" ? next(run.slots[index].value) : next; run.dirty = true;
      }];
    },
    useEffect(effect, deps) {
      const run = active, index = run.cursor++, old = run.slots[index];
      if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) run.effects.push(() => {
        old?.cleanup?.(); run.slots[index] = { deps, phase: "passive", cleanup: effect() };
      });
    },
    useLayoutEffect(effect, deps) {
      const run = active, index = run.cursor++, old = run.slots[index];
      if (!old || !deps || deps.some((value, j) => !Object.is(value, old.deps?.[j]))) run.layoutEffects.push(() => {
        old?.cleanup?.(); run.slots[index] = { deps, phase: "layout", cleanup: effect() };
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
          if (config.listen) await config.listen.promise;
          return () => set.delete(callback);
        },
        tauriInvoke: async (command, args) => {
          calls.push({ command, args: args && clone(args) });
          if (command === "appshots_entry_claim") {
            if (config.claimError) throw Error("fixture claim failed");
            if (config.claim) await config.claim.promise;
            return { accepted: true, introAccepted: config.introAccepted };
          }
          if (command === "appshots_entry_accept") {
            calls.at(-1).presentedPending = clone(run.result.pendingIds);
            return config.accept ? config.accept.promise : true;
          }
          if (command === "appshots_entry_configure" || command === "appshots_entry_context") {
            const wait = command === "appshots_entry_configure" ? config.configure : config.contexts.shift();
            if (wait) {
              const override = await wait.promise;
              if (override !== undefined) return override;
            }
            const { composer, captureGeneration, canAccept, isNewChat } = args.request;
            return { supported: true, registration: "ready", introAccepted: config.introAccepted,
              composer, captureGeneration, canAccept, isNewChat };
          }
          if (command === "appshots_entry_decline") return true;
          assert.equal(command, "appshots_entry_stop");
          if (config.stop) await config.stop.promise;
        },
      };
      throw Error(`Unexpected hook import ${name}`);
    },
  });
  const run = { cursor: 0, slots: [], effects: [], layoutEffects: [], dirty: true, result: null,
    props: { enabled: true, scope: "thread:A", canAccept: true, isNewChat: false, contextKey: "account-7", captureGeneration: 0,
      getCaptureGeneration: () => config.generation,
      onCapture: value => captures.push(clone(value)), onError: message => errors.push(message) } };
  const render = () => {
    if (unmounted) return run.result;
    for (let guard = 0; run.dirty; guard++) {
      assert.ok(guard < 30); run.dirty = false; run.cursor = 0; active = run;
      rendering = true;
      run.result = module.exports.useAppshotsEntry(run.props);
      rendering = false;
      run.layoutEffects.splice(0).forEach(effect => effect());
      if (!pausePassive) run.effects.splice(0).forEach(effect => effect());
    }
    return run.result;
  };
  const flush = async () => { for (let i = 0; i < 40; i++) { await Promise.resolve(); render(); } };
  render();
  return { config, calls, captures, errors, commits, flush, get intro() { return render().intro; },
    get unmountStateWrites() { return unmountStateWrites; },
    get renderStateWrites() { return renderStateWrites; },
    get pendingIds() { const value = render().pendingIds; return value === undefined ? undefined : clone(value); },
    emit: event => { for (const callback of listeners.get("appshots:entry") ?? []) callback(event); },
    invalidate: () => { for (const callback of listeners.get("chatgpt-service:invalidated") ?? []) callback(8); },
    listenerCount: () => [...listeners.values()].reduce((count, set) => count + set.size, 0),
    setProps(patch) { if (patch.captureGeneration !== undefined) config.generation = patch.captureGeneration; run.props = { ...run.props, ...patch }; run.dirty = true; render(); },
    abortedRender(patch) {
      // React WIP shares ref objects, but changed memo/effect slots are discarded.
      const wip = { ...run, cursor: 0, slots: run.slots.slice(), effects: [], layoutEffects: [], props: { ...run.props, ...patch } };
      const previousCalls = calls.length;
      active = wip; rendering = true;
      module.exports.useAppshotsEntry(wip.props);
      rendering = false; active = run;
      assert.equal(renderStateWrites, 0, "abandoned render itself must not set component state");
      assert.equal(calls.length, previousCalls, "abandoned render does not execute effects or bridge calls");
      run.dirty = true; render();
    },
    setPropsBeforePassive(patch) { pausePassive = true; this.setProps(patch); },
    commitPassive() { pausePassive = false; run.effects.splice(0).forEach(effect => effect()); render(); },
    unmountLayout() {
      unmounted = true;
      for (const slot of run.slots) if (slot?.phase === "layout") { slot.cleanup?.(); slot.cleanup = null; }
    },
    unmount() {
      this.unmountLayout();
      for (const slot of run.slots) if (slot?.phase === "passive") { slot.cleanup?.(); slot.cleanup = null; }
    },
  };
}
const route = (id, patch = {}) => ({ type: "route", id, account, composer: "thread:A", captureGeneration: 0, route: "current",
  metadata: { appName: "Editor", bundleIdentifier: "process:C:\\Editor.exe", windowTitle: "Original" }, requestedAt: "2026-11-17T01:02:03.456Z", ...patch });
const captured = id => ({ type: "capture", id, account, composer: "thread:A", captureGeneration: 0, metadata: route(id).metadata,
  imageDataUrl: "data:image/png;base64,AA==", axTree: 'Window: "Actual title", App: "Editor"\nOffscreen' });
const count = (fixture, command) => fixture.calls.filter(call => call.command === command).length;

const abandonedOwnerRender = fixture(); await abandonedOwnerRender.flush();
abandonedOwnerRender.abortedRender({ contextKey: "uncommitted-owner-B" });
abandonedOwnerRender.emit(route("still-committed-owner-A")); await abandonedOwnerRender.flush();
assert.ok(abandonedOwnerRender.intro, "aborted owner B render cannot invalidate committed owner A");
assert.equal(count(abandonedOwnerRender, "appshots_entry_configure"), 1);
assert.equal(abandonedOwnerRender.renderStateWrites, 0); abandonedOwnerRender.unmount();

const abandonedConsumerRender = fixture(); await abandonedConsumerRender.flush();
abandonedConsumerRender.emit(route("committed-intro-A")); await abandonedConsumerRender.flush();
const committedIntro = abandonedConsumerRender.intro; assert.ok(committedIntro);
abandonedConsumerRender.abortedRender({ scope: "uncommitted-consumer-B", canAccept: false });
assert.equal(abandonedConsumerRender.intro?.props.key, "committed-intro-A", "aborted consumer render preserves A's committed intro");
committedIntro.props.onAccept(); await abandonedConsumerRender.flush();
assert.equal(count(abandonedConsumerRender, "appshots_entry_accept"), 1, "committed A continuation remains usable after speculative B is discarded");
abandonedConsumerRender.emit(captured("committed-intro-A")); await abandonedConsumerRender.flush();
assert.equal(abandonedConsumerRender.captures.length, 1);
assert.equal(abandonedConsumerRender.renderStateWrites, 0); abandonedConsumerRender.unmount();

for (const replacement of ["consumer", "owner"]) {
  const f = fixture(); f.config.introAccepted = true; f.config.accept = deferred(); await f.flush();
  f.emit(route("pre-commit-flight")); await f.flush(); assert.deepEqual(f.pendingIds, ["pre-commit-flight"]);
  const claims = count(f, "appshots_entry_claim");
  f.setPropsBeforePassive({ scope: "thread:B", ...(replacement === "owner" ? { contextKey: "committed-owner-B" } : {}) });
  assert.deepEqual(f.pendingIds, [], "new committed token hides old pending before passive cleanup");
  f.emit(route("late-old-route")); f.emit(captured("pre-commit-flight"));
  f.config.accept.resolve(true); await f.flush();
  assert.equal(count(f, "appshots_entry_claim"), claims, `${replacement} layout commit fences old routes before passive effects`);
  assert.equal(f.captures.length, 0); assert.equal(count(f, "appshots_entry_context"), 0);
  assert.equal(count(f, "appshots_entry_configure"), 1, "test has not run the new passive owner/context effect yet");
  f.commitPassive(); await f.flush();
  f.emit(route("new-committed-flight", { composer: "thread:B" })); await f.flush();
  f.emit({ ...captured("new-committed-flight"), composer: "thread:B" }); await f.flush();
  assert.equal(f.captures.length, 1, "new committed consumer becomes functional after real ACK");
  f.unmount(); await f.flush(); assert.equal(f.unmountStateWrites, 0);
}

const layoutUnmount = fixture(); await layoutUnmount.flush(); layoutUnmount.emit(route("unmount-intro")); await layoutUnmount.flush();
const beforeLayoutUnmount = layoutUnmount.intro; assert.ok(beforeLayoutUnmount);
const unmountClaims = count(layoutUnmount, "appshots_entry_claim"), unmountAccepts = count(layoutUnmount, "appshots_entry_accept");
layoutUnmount.unmountLayout(); assert.equal(layoutUnmount.listenerCount(), 2, "passive subscriptions are deliberately still installed");
beforeLayoutUnmount.props.onAccept(); layoutUnmount.emit(route("late-layout-unmount")); await layoutUnmount.flush();
assert.equal(count(layoutUnmount, "appshots_entry_claim"), unmountClaims);
assert.equal(count(layoutUnmount, "appshots_entry_accept"), unmountAccepts, "layout unmount immediately fences the old intro continuation");
assert.equal(layoutUnmount.unmountStateWrites, 0);
layoutUnmount.unmount(); await layoutUnmount.flush(); assert.equal(layoutUnmount.listenerCount(), 0);

const owner = fixture(); await owner.flush();
const initialStops = count(owner, "appshots_entry_stop");
for (const patch of [{ scope: "thread:B" }, { canAccept: false }, { canAccept: true, isNewChat: true }, { captureGeneration: 1 }]) {
  owner.setProps(patch); await owner.flush();
}
assert.equal(count(owner, "appshots_entry_configure"), 1, "ordinary Composer context changes keep the global hotkey owner");
assert.equal(count(owner, "appshots_entry_stop"), initialStops, "ordinary Composer updates never stop the global registration");
assert.equal(count(owner, "appshots_entry_context"), 4, "consumer changes use the existing owner context protocol");
owner.unmount(); await owner.flush(); assert.equal(owner.listenerCount(), 0); assert.equal(owner.unmountStateWrites, 0);

for (const phase of ["stop", "listen", "access"]) {
  const starting = fixture(), gate = deferred(); starting.config[phase] = gate;
  await starting.flush();
  starting.setProps({ scope: "thread:latest", captureGeneration: 3, canAccept: false, isNewChat: true });
  await starting.flush(); assert.equal(count(starting, "appshots_entry_configure"), 0, `${phase} setup is actually pending`);
  gate.resolve(); await starting.flush();
  assert.equal(count(starting, "appshots_entry_configure"), 1);
  const request = starting.calls.find(call => call.command === "appshots_entry_configure").args.request;
  assert.deepEqual([request.composer, request.captureGeneration, request.canAccept, request.isNewChat], ["thread:latest", 3, false, true], `${phase} setup configures latest context`);
  assert.equal(count(starting, "appshots_entry_context"), 0, "pre-registration contexts are not replayed");
  starting.unmount(); await starting.flush(); assert.equal(starting.unmountStateWrites, 0); assert.equal(starting.listenerCount(), 0);
}

const initialAck = fixture(); initialAck.config.configure = deferred(); await initialAck.flush();
initialAck.emit(route("early-configure")); await initialAck.flush();
assert.equal(count(initialAck, "appshots_entry_claim"), 0, "real route waits for initial configure ACK");
initialAck.config.configure.resolve(); await initialAck.flush();
assert.ok(initialAck.intro, "early route is retained until matching ACK, not discarded");
assert.equal(count(initialAck, "appshots_entry_claim"), 1); initialAck.unmount();

const contextAck = fixture(); await contextAck.flush();
const contextGate = deferred(); contextAck.config.contexts.push(contextGate);
contextAck.setProps({ scope: "thread:B", captureGeneration: 4 }); await contextAck.flush();
contextAck.emit(route("wrong-old-tuple"));
contextAck.emit(route("early-context", { composer: "thread:B", captureGeneration: 4 }));
contextAck.emit(route("early-context", { composer: "thread:B", captureGeneration: 4 })); await contextAck.flush();
assert.equal(count(contextAck, "appshots_entry_claim"), 0, "matching early route waits while stale tuple is rejected");
contextGate.resolve(); await contextAck.flush();
assert.equal(count(contextAck, "appshots_entry_claim"), 1, "matching early route claims once after real context ACK");
assert.ok(contextAck.intro);
const requestB = contextAck.calls.find(call => call.command === "appshots_entry_claim").args.request;
assert.deepEqual([requestB.composer, requestB.captureGeneration], ["thread:B", 4]); contextAck.unmount();

const initializeAba = fixture(); initializeAba.setProps({ captureGeneration: 10 });
initializeAba.config.configure = deferred(); await initializeAba.flush();
initializeAba.emit(route("old-initial-A", { captureGeneration: 10 })); await initializeAba.flush();
initializeAba.setProps({ scope: "thread:B", captureGeneration: 0 });
initializeAba.setProps({ scope: "thread:A", captureGeneration: 10 });
initializeAba.config.configure.resolve(); await initializeAba.flush();
assert.equal(count(initializeAba, "appshots_entry_configure"), 1);
assert.deepEqual(initializeAba.calls.filter(call => call.command === "appshots_entry_context").map(call =>
  [call.args.request.previousComposer, call.args.request.previousCaptureGeneration, call.args.request.composer, call.args.request.captureGeneration]),
[["thread:A", 10, "thread:B", 0], ["thread:B", 0, "thread:A", 10]], "A10/B0/A10 follows actual serial ACKs, not a global generation counter");
assert.equal(count(initializeAba, "appshots_entry_claim"), 0, "old A early route cannot inherit same-named A context");
initializeAba.emit(route("new-final-A", { captureGeneration: 10 })); await initializeAba.flush();
assert.ok(initializeAba.intro, "fresh same-named A is functional after initialization ABA"); initializeAba.unmount();

const claimedAba = fixture(); claimedAba.setProps({ captureGeneration: 10 }); await claimedAba.flush();
claimedAba.config.claim = deferred(); claimedAba.emit(route("late-claim-A", { captureGeneration: 10 })); await claimedAba.flush();
claimedAba.setProps({ scope: "thread:B", captureGeneration: 0 });
claimedAba.setProps({ scope: "thread:A", captureGeneration: 10 }); await claimedAba.flush();
claimedAba.config.claim.resolve(); await claimedAba.flush();
assert.equal(claimedAba.intro, null, "late old A claim ACK cannot revive an intro after ABA");
claimedAba.emit(route("valid-A", { captureGeneration: 10 })); await claimedAba.flush();
assert.ok(claimedAba.intro); const oldIntro = claimedAba.intro;
claimedAba.setProps({ canAccept: false }); await claimedAba.flush();
assert.equal(claimedAba.intro, null, "ordinary flags retire the intro immediately");
oldIntro.props.onAccept(); await claimedAba.flush(); assert.equal(count(claimedAba, "appshots_entry_accept"), 0);
assert.equal(count(claimedAba, "appshots_entry_configure"), 1); claimedAba.unmount();

const invalidAck = fixture(); invalidAck.config.configure = deferred(); await invalidAck.flush();
invalidAck.emit(route("bad-ack")); invalidAck.config.configure.resolve({ supported: true, registration: "ready" }); await invalidAck.flush();
assert.equal(count(invalidAck, "appshots_entry_claim"), 0, "missing context ACK cannot be treated as acceptance");
assert.equal(invalidAck.intro, null); assert.ok(invalidAck.errors.length > 0); invalidAck.unmount();

for (const failure of ["reject", "wrong-tuple"]) {
  const f = fixture(); f.config.introAccepted = true; f.config.accept = deferred(); await f.flush();
  f.emit(route("old-accept")); await f.flush(); assert.deepEqual(f.pendingIds, ["old-accept"]);
  const oldClaims = count(f, "appshots_entry_claim"), oldStops = count(f, "appshots_entry_stop");
  const ack = deferred(); f.config.contexts.push(ack);
  f.setProps({ scope: "thread:B", captureGeneration: 2 }); await f.flush();
  f.emit(route("early-failed-context", { composer: "thread:B", captureGeneration: 2 })); await f.flush();
  assert.equal(count(f, "appshots_entry_claim"), oldClaims, `${failure} early route waits for real context ACK`);
  if (failure === "reject") ack.reject(Error("fixture context update rejected"));
  else ack.resolve({ supported: true, registration: "ready", composer: "thread:B", captureGeneration: 999, canAccept: true, isNewChat: false });
  await f.flush();
  assert.equal(count(f, "appshots_entry_stop"), oldStops + 1, `${failure} closes the failed owner exactly once before final unmount`);
  assert.equal(count(f, "appshots_entry_claim"), oldClaims); assert.equal(f.listenerCount(), 0);
  assert.deepEqual(f.pendingIds, []); assert.equal(f.intro, null);
  f.config.accept.resolve(true); f.emit(captured("old-accept")); await f.flush();
  assert.equal(f.captures.length, 0, `${failure} discards old in-flight acceptance and attachments`);
  f.setProps({ scope: "thread:C", captureGeneration: 0 }); await f.flush();
  assert.equal(count(f, "appshots_entry_configure"), 1, `${failure} consumer changes cannot restart the failed owner`);
  assert.equal(count(f, "appshots_entry_context"), 1); assert.equal(count(f, "appshots_entry_stop"), oldStops + 1);
  f.unmount(); await f.flush(); assert.equal(f.unmountStateWrites, 0);
}

const ownerReplacement = fixture(), obsoleteConfigure = deferred(); ownerReplacement.config.configure = obsoleteConfigure;
await ownerReplacement.flush(); ownerReplacement.emit(route("obsolete-owner")); await ownerReplacement.flush();
ownerReplacement.config.configure = null;
ownerReplacement.setProps({ contextKey: "account-owner-new", scope: "thread:new-owner" }); await ownerReplacement.flush();
assert.equal(count(ownerReplacement, "appshots_entry_configure"), 2, "actual owner key change creates one new registration");
ownerReplacement.emit(route("new-owner-route", { composer: "thread:new-owner" })); await ownerReplacement.flush();
assert.ok(ownerReplacement.intro); const stopsBeforeLateAck = count(ownerReplacement, "appshots_entry_stop");
obsoleteConfigure.resolve(); await ownerReplacement.flush();
assert.equal(ownerReplacement.intro.props.key, "new-owner-route", "old configure ACK cannot clear the new owner's intro");
assert.equal(count(ownerReplacement, "appshots_entry_claim"), 1, "obsolete owner's early route never claims in the new owner");
assert.equal(count(ownerReplacement, "appshots_entry_stop"), stopsBeforeLateAck, "late old configure does not stop the new registration");
assert.equal(ownerReplacement.listenerCount(), 2); ownerReplacement.unmount(); await ownerReplacement.flush();
assert.equal(ownerReplacement.listenerCount(), 0); assert.equal(ownerReplacement.unmountStateWrites, 0);

const generationEvents = fixture(); generationEvents.config.introAccepted = true; await generationEvents.flush();
generationEvents.emit(route("old-gen")); await generationEvents.flush();
generationEvents.setProps({ captureGeneration: 1 }); await generationEvents.flush();
generationEvents.emit(captured("old-gen")); generationEvents.emit(route("wrong-gen")); await generationEvents.flush();
assert.equal(generationEvents.captures.length, 0); assert.deepEqual(generationEvents.pendingIds, []);
generationEvents.emit(route("current-gen", { captureGeneration: 1 })); await generationEvents.flush();
generationEvents.emit({ ...captured("current-gen"), captureGeneration: 0 }); await generationEvents.flush();
assert.equal(generationEvents.captures.length, 0, "capture must match event generation as well as request id");
generationEvents.emit({ ...captured("current-gen"), captureGeneration: 1 }); await generationEvents.flush();
assert.equal(generationEvents.captures.length, 1); assert.equal(generationEvents.captures[0].capture.generation, 1);
assert.equal(count(generationEvents, "appshots_entry_configure"), 1); generationEvents.unmount();

for (const patch of [{ scope: "thread:B" }, { canAccept: false }, { isNewChat: true }, { captureGeneration: 1 }]) {
  const f = fixture(); f.config.introAccepted = true; await f.flush();
  const stops = count(f, "appshots_entry_stop");
  f.emit(route("old-consumer")); await f.flush(); assert.deepEqual(f.pendingIds, ["old-consumer"]);
  f.setProps(patch); assert.deepEqual(f.pendingIds, [], "consumer token synchronously hides old pending");
  f.emit(captured("old-consumer")); await f.flush(); assert.equal(f.captures.length, 0);
  assert.equal(count(f, "appshots_entry_configure"), 1); assert.equal(count(f, "appshots_entry_stop"), stops);
  f.unmount(); await f.flush(); assert.equal(f.unmountStateWrites, 0); assert.equal(f.listenerCount(), 0);
}

const abandonedSetup = fixture(); abandonedSetup.config.stop = deferred(); await abandonedSetup.flush();
abandonedSetup.unmount(); abandonedSetup.config.stop.resolve(); await abandonedSetup.flush();
assert.equal(count(abandonedSetup, "appshots_entry_configure"), 0); assert.equal(abandonedSetup.listenerCount(), 0);
assert.equal(abandonedSetup.unmountStateWrites, 0);

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
const revokedStops = count(revoked, "appshots_entry_stop");
revoked.config.enabled = false; revoked.intro.props.onAccept(); await revoked.flush();
assert.equal(count(revoked, "appshots_entry_accept"), 0); assert.equal(revoked.captures.length, 0); revoked.unmount();
assert.equal(count(revoked, "appshots_entry_configure"), 1, "revoked access does not recreate the owner");
assert.equal(count(revoked, "appshots_entry_stop"), revokedStops + 1, "fresh revoked qualification unregisters the owner");
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
assert.equal(invalid.listenerCount(), 0, "identity invalidation releases the owner subscriptions");
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
console.log("Appshots entry: abandoned owner/consumer renders, commit-before-passive and layout-unmount fences, zero render state writes, one owner registration, serialized real context ACKs, early matching route barrier, initial stop/listener/access/configure races, scope A10/B0/A10, consumer flag/generation retirement, synchronous pending commit, capture ranks, cancellation and one-time delivery, fresh qualification, identity/unmount abort and listener release passed (isolated bridge; no real service/model/native capture).");

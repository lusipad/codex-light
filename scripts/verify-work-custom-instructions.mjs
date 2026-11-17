import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const identity = { userId: "custom-user", accountId: "custom-account", generation: 7 };
const nextIdentity = { ...identity, accountId: "next-account" };
const clone = value => JSON.parse(JSON.stringify(value));
const value = (customInstructions, communicationGuide = "", communicationGuideEnabled = false) => ({ customInstructions, communicationGuide, communicationGuideEnabled });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const code = ts.transpileModule(fs.readFileSync("src/workCustomInstructions.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture() {
  const calls = [], timers = [], plans = [];
  const reader = async (expected, signal) => {
    calls.push({ identity: clone(expected), signal });
    const plan = plans.shift();
    return plan ? plan(expected, signal) : value(null);
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { exports: module.exports, AbortController,
    AbortSignal: {
      any: signals => AbortSignal.any(signals),
      timeout: milliseconds => {
        const controller = new AbortController(); timers.push({ milliseconds, controller }); return controller.signal;
      },
    },
    require(name) {
      assert.equal(name, "./chatgptService", "cache cannot read AGENTS or use unrelated transports");
      return { readWorkCustomInstructions: reader };
    },
  });
  return { cache: module.exports.createWorkCustomInstructionsCache(), create: module.exports.createWorkCustomInstructionsCache,
    calls, timers, plan: fn => plans.push(fn) };
}

let groups = 0;
async function test(name, run) { await run(); groups++; console.log("PASS", name); }

await test("explicit gate false and signed-out principal make zero reads; unknown is not empty success", async () => {
  const f = fixture(); f.cache.update(identity, false); await f.cache.refresh();
  assert.equal(f.cache.read(identity), null); assert.equal(f.calls.length, 0);
  f.cache.update(identity, null);
  assert.throws(() => f.cache.read(identity), error => error.code === "custom_instructions_not_ready");
  await assert.rejects(f.cache.refresh(), error => error.code === "custom_instructions_not_ready");
  assert.equal(f.calls.length, 0);
  f.cache.update(null, true); await f.cache.refresh(); assert.equal(f.cache.read(identity), null); assert.equal(f.calls.length, 0);
});

await test("source golden retains raw nonblank text and joins only enabled guide with two newlines", async () => {
  const f = fixture(); f.cache.update(identity, true);
  assert.equal(f.cache.read(identity), null, "confirmed enabled but no completed cache is a real empty first read");
  for (const [response, expected] of [
    [value("  Account instruction\n", "\tGuide text  ", true), "  Account instruction\n\n\n\tGuide text  "],
    [value("Account", "Guide", false), "Account"],
    [value(null, " Guide only ", true), " Guide only "],
    [value(" \n\t", "\t", true), null],
    [value("Account", " \t", true), "Account"],
  ]) {
    f.plan(async () => response); await f.cache.refresh(); assert.equal(f.cache.read(identity), expected);
  }
  assert.deepEqual(f.calls[0].identity, identity); assert.equal(f.timers[0].milliseconds, 5000);
});

await test("refresh failures preserve old cache and first failure remains genuine null", async () => {
  const f = fixture(); f.cache.update(identity, true);
  f.plan(async () => { throw Error("first network failure"); }); await f.cache.refresh(); assert.equal(f.cache.read(identity), null);
  f.plan(async () => value("confirmed old")); await f.cache.refresh();
  f.plan(async () => { throw Error("later network failure"); }); await f.cache.refresh(); assert.equal(f.cache.read(identity), "confirmed old");
  f.plan(async () => ({ customInstructions: 42, communicationGuide: "wrong", communicationGuideEnabled: true }));
  await f.cache.refresh(); assert.equal(f.cache.read(identity), "confirmed old", "invalid response cannot replace confirmed text");
});

await test("single-flight returns the actual shared promise and a later caller cannot cancel its owner", async () => {
  const f = fixture(), pending = deferred(), joining = new AbortController(); f.cache.update(identity, true);
  f.plan(() => pending.promise);
  const first = f.cache.refresh(), second = f.cache.refresh(joining.signal); assert.equal(first, second);
  joining.abort(); await tick(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].signal.aborted, false);
  assert.equal(f.timers.length, 1); pending.resolve(value("shared result")); await first;
  assert.equal(f.cache.read(identity), "shared result");
});

await test("source 5000ms timeout aborts the reader, keeps cache and permits a later refresh", async () => {
  const f = fixture(); f.cache.update(identity, true); f.plan(async () => value("before timeout")); await f.cache.refresh();
  f.plan((_expected, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
  const refresh = f.cache.refresh(); await tick(); const timer = f.timers.at(-1);
  assert.equal(timer.milliseconds, 5000); timer.controller.abort(new DOMException("fixture deadline", "TimeoutError"));
  await refresh; assert.equal(f.calls.at(-1).signal.aborted, true); assert.equal(f.cache.read(identity), "before timeout");
  f.plan(async () => value("after timeout")); await f.cache.refresh(); assert.equal(f.cache.read(identity), "after timeout");
});

await test("account replacement cancels old request and its finally cannot clear the newer flight", async () => {
  const f = fixture(), old = deferred(), next = deferred(); f.cache.update(identity, true); f.plan(() => old.promise);
  const oldRefresh = f.cache.refresh(); await tick(); const oldSignal = f.calls[0].signal;
  f.cache.update(nextIdentity, true); assert.equal(oldSignal.aborted, true); assert.equal(f.cache.read(nextIdentity), null);
  assert.throws(() => f.cache.read(identity), error => error.code === "account_changed");
  f.plan(() => next.promise); const nextRefresh = f.cache.refresh(); await tick();
  old.resolve(value("old account secret")); await oldRefresh;
  assert.equal(f.cache.refresh(), nextRefresh, "old finally cannot retire the current owner's pending read");
  next.resolve(value("next account confirmed")); await nextRefresh;
  assert.equal(f.cache.read(nextIdentity), "next account confirmed");
});

await test("same principal generation changes and account ABA never revive an old result", async () => {
  for (const intermediate of [nextIdentity, { ...identity, generation: 8 }]) {
    const f = fixture(), old = deferred(); f.cache.update(identity, true); f.plan(() => old.promise);
    const oldRefresh = f.cache.refresh(); await tick();
    f.cache.update(intermediate, true); f.cache.update(identity, true);
    f.plan(async () => value("new confirmed A")); await f.cache.refresh();
    old.resolve(value("obsolete A")); await oldRefresh;
    assert.equal(f.cache.read(identity), "new confirmed A"); assert.equal(f.calls[0].signal.aborted, true);
  }
});

await test("gate revocation, unknown and disposal discard late data without fetching disabled defaults", async () => {
  for (const transition of ["false", "unknown", "signed-out", "dispose"]) {
    const f = fixture(), late = deferred(); f.cache.update(identity, true); f.plan(() => late.promise);
    const refresh = f.cache.refresh(); await tick();
    if (transition === "dispose") f.cache.dispose();
    else if (transition === "signed-out") f.cache.update(null, true);
    else f.cache.update(identity, transition === "false" ? false : null);
    assert.equal(f.calls[0].signal.aborted, true);
    late.resolve(value("must not publish")); await refresh;
    if (transition === "unknown") assert.throws(() => f.cache.read(identity), error => error.code === "custom_instructions_not_ready");
    else assert.equal(f.cache.read(identity), null);
    if (transition !== "dispose") { f.cache.update(identity, true); assert.equal(f.cache.read(identity), null); }
    else { f.cache.update(identity, true); await f.cache.refresh(); assert.equal(f.calls.length, 1); }
  }
});

await test("external initiator cancellation rejects late data and pre-aborted refresh has zero RPC", async () => {
  const f = fixture(), controller = new AbortController(), late = deferred(); f.cache.update(identity, true);
  controller.abort(); await f.cache.refresh(controller.signal); assert.equal(f.calls.length, 0);
  const live = new AbortController(); f.plan(() => late.promise); const refresh = f.cache.refresh(live.signal); await tick();
  live.abort(); assert.equal(f.calls[0].signal.aborted, true);
  late.resolve(value("late canceled data")); await refresh; assert.equal(f.cache.read(identity), null);
});

await test("synchronous reader errors do not leave a permanent pending promise", async () => {
  let calls = 0;
  const f = fixture(), cache = f.create(() => { if (++calls === 1) throw Error("synchronous failure"); return Promise.resolve(value("recovered")); });
  cache.update(identity, true); await cache.refresh(); assert.equal(cache.read(identity), null);
  await cache.refresh(); assert.equal(cache.read(identity), "recovered"); assert.equal(calls, 2); cache.dispose();
});

await test("default cache calls the real typed service adapter with fixed operation and actual cancellation", async () => {
  const calls = [], modules = new Map(); let pending = null, serial = 0;
  const body = { custom_instructions: " actual account instruction ", communication_guide: " Guide ", communication_guide_enabled: true };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    } }).outputText, { exports, AbortController, AbortSignal,
      crypto: { randomUUID: () => `custom-${++serial}` },
      navigator: { userAgent: "Isolated custom instructions test", userAgentData: { brands: [{ brand: "Chromium", version: "140" }], platform: "Windows" } },
      localStorage: { getItem: () => "fixture-device" },
      require(name) {
        if (name === "./chatgptService") return load("src/chatgptService.ts");
        if (["./sitesService", "./remoteReview"].includes(name)) return {};
        assert.equal(name, "./bridge");
        return { tauriInvoke: async (command, args) => {
          calls.push({ command, args: clone(args) });
          if (command === "chatgpt_service_cancel") return;
          assert.equal(command, "chatgpt_service_read");
          const request = args.request;
          assert.equal(request.operation, "work_custom_instructions"); assert.deepEqual(clone(request.params), {});
          assert.deepEqual(clone(request.expectedIdentity), identity);
          if (pending) await pending.promise;
          return { requestId: request.requestId, identity: clone(identity), body };
        } };
      },
    });
    return exports;
  }
  const cache = load("src/workCustomInstructions.ts").createWorkCustomInstructionsCache();
  cache.update(identity, false); await cache.refresh(); assert.equal(calls.length, 0);
  cache.update(identity, true); await cache.refresh(); assert.equal(cache.read(identity), " actual account instruction \n\n Guide ");
  pending = deferred(); const refresh = cache.refresh(); await tick(); cache.update(null, false); await tick();
  assert.equal(calls.filter(call => call.command === "chatgpt_service_cancel").length, 1);
  pending.resolve(); await refresh; assert.equal(cache.read(identity), null); cache.dispose();
});

console.log(`Work custom instructions: ${groups} groups passed (production cache, controlled reader/timeouts; no HTTP, account mutations or AGENTS access).`);

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const identity = { userId: "fixture", accountId: "fixture", generation: 1 }, calls = [];
let waiting;
const cache = {};
vm.runInNewContext(compile("src/workCustomInstructions.ts"), { exports: cache, AbortController, AbortSignal, Error,
  require: () => ({ readWorkCustomInstructions: async (identity, signal) => {
    const call = { identity, signal }; calls.push(call);
    if (waiting) await waiting;
    return { customInstructions: `Account ${identity.generation}`, communicationGuide: "", communicationGuideEnabled: false };
  } }),
});
const slots = []; let cursor = 0, setup;
const react = {
  useRef: value => slots[cursor++] ??= { current: value },
  useMemo: fn => { const index = cursor++; return slots[index] ??= fn(); },
  useLayoutEffect: effect => { cursor++; setup = effect; },
};
const hook = {};
vm.runInNewContext(compile("src/useWorkCustomInstructions.ts"), { exports: hook, Error,
  require: id => id === "react" ? react : cache });
const render = () => { cursor = 0; return hook.useWorkCustomInstructions(); };
const consumer = render();
assert.throws(() => consumer.update(identity, true), /未就绪/);
assert.equal(calls.length, 0, "render and abandoned render never create service work");
let cleanup = setup();
consumer.update(identity, true); await consumer.refresh(); assert.equal(consumer.read(identity), "Account 1");
cleanup(); const oldCleanup = cleanup;
cleanup = setup(); // Real StrictMode setup -> cleanup -> setup with memo state retained.
assert.equal(render(), consumer);
consumer.update(identity, true); consumer.refreshOnce(); await consumer.refresh(); assert.equal(consumer.read(identity), "Account 1");
assert.equal(calls.length, 2);
oldCleanup(); assert.equal(consumer.read(identity), "Account 1", "late cleanup cannot dispose the new committed instance");
let release; waiting = new Promise(resolve => { release = resolve; });
const request = consumer.refresh(); await Promise.resolve(); await Promise.resolve();
const inflight = calls.at(-1); cleanup(); assert.equal(inflight.signal.aborted, true);
cleanup = setup(); consumer.update({ ...identity, generation: 2 }, true);
release(); waiting = null; await request;
await consumer.refresh(); assert.equal(consumer.read({ ...identity, generation: 2 }), "Account 2");
cleanup(); assert.throws(() => consumer.read(identity), /未就绪/);
console.log("PASS actual Work cache hook lifecycle: render purity, StrictMode replay with stable facade/fresh cache, real cached reads, old cleanup isolation, abort-on-unmount and late result/new-owner fencing. Hook VM replay, not browser/GUI.");

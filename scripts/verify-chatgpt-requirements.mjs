import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

assert.ok(fs.existsSync("src/chatgptRequirements.ts"), "real initial requirements environment codec must exist");
const source = fs.readFileSync("src/chatgptRequirements.ts", "utf8");
assert.equal(/fetch\s*\(|tauriInvoke|chat-requirements\/|turnstile|proofofwork/i.test(source), false, "initial codec never performs HTTP or solves server challenges");
let randomCalls = 0, nowCalls = 0, uuidCalls = 0;
const browser = { ai: undefined, cache: {}, solana: undefined, location: { search: "?real=1&real=2&中文=3" } };
const nav = Object.assign(Object.create({ platform: "fixture-platform" }), { userAgent: "Real WebView fixture 中文", language: "zh-CN", languages: ["zh-CN", "en"], hardwareConcurrency: 8 });
const document = { scripts: [{ src: "https://own.invalid/assets/first.js" }, { src: "https://own.invalid/c/real/_runtime.js" }], documentElement: { getAttribute: name => name === "data-build" ? "own-real-build" : null }, visibleOwn: true };
const times = [100, 103, 108];
const math = Object.create(Math); math.random = () => { randomCalls++; return 0; };
const module = { exports: {} };
const context = { exports: module.exports, TextEncoder, btoa: value => Buffer.from(value, "binary").toString("base64"),
  window: browser, document, navigator: nav, screen: { width: 1200, height: 800 },
  performance: { now: () => { nowCalls++; return times.shift(); }, timeOrigin: 42, memory: { jsHeapSizeLimit: 12345 } },
  crypto: { randomUUID: () => { uuidCalls++; return "real-fixture-uuid"; } }, Math: math,
  Date: class extends Date { toString() { return "real-date-string"; } }, URLSearchParams,
};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
const { collectChatgptRequirementsEnvironment: collect, createChatgptRequirementsKey: create } = module.exports;
assert.equal(typeof collect, "function"); assert.equal(typeof create, "function");
const env = collect(); const before = JSON.stringify(env), key = create(env);
assert.equal(key.startsWith("gAAAAAC"), true);
const values = JSON.parse(Buffer.from(key.slice(7), "base64").toString("utf8"));
assert.deepEqual(values, [2000, "real-date-string", 12345, 1, nav.userAgent,
  document.scripts[0].src, "c/real/_", "zh-CN", "zh-CN,en", 8,
  "platform−fixture-platform", "scripts", "ai", 103, "real-fixture-uuid", "real,real,中文", 8, 42,
  1, 0, 1, 0, 1, 0, 0], "exact source tuple order, real feature presence and UTF8 envelope");
assert.equal(JSON.stringify(env), before, "encoding does not mutate captured environment");
assert.equal(randomCalls, 6, "both overwritten source nonce random samples plus four actual random choices are collected");
assert.equal(nowCalls, 3); assert.equal(uuidCalls, 1);
assert.equal(create(env), key, "pure encoding uses supplied snapshot, without sampling again");
console.log("PASS exact tuple order, real environment sampling, UTF8, pure repeat encoding (1 group)");

const noBuild = { ...env, scriptSample: undefined, build: null, languages: undefined, navigatorSample: undefined, documentSample: undefined, windowSample: undefined, heapSizeLimit: null };
const empty = JSON.parse(Buffer.from(create(noBuild).slice(7), "base64").toString("utf8"));
assert.equal(empty[2], null); for (const i of [5, 8, 10, 11, 12]) assert.equal(empty[i], null);
assert.equal(empty[6], null, "real missing optional data-build stays null, not official build");
for (const patch of [{ screenSize: NaN }, { startedAt: NaN }, { finishedAt: Infinity }, { sampledAt: NaN }, { userAgent: null }, { uuid: "" }, { featurePresence: [1] }]) {
  assert.throws(() => create({ ...env, ...patch }), /not ready/i, "invalid required environment fails explicitly");
}
console.log("PASS optional missing JSON semantics and malformed required environment (2 groups)");

for (const name of ["window", "document", "navigator", "screen", "performance", "crypto"]) {
  const actual = context[name]; context[name] = undefined;
  assert.throws(collect, /not ready/i, `missing ${name} never emits a dummy key`); context[name] = actual;
}
const actualDocument = context.document;
for (const broken of [{}, { scripts: [], documentElement: {} }]) {
  context.document = broken; assert.throws(collect, /not ready/i, "missing actual DOM cannot emit a key");
}
context.document = actualDocument;
let laterNow = 20;
context.performance = { now: () => laterNow++, timeOrigin: 2 };
context.document = { scripts: [], documentElement: { getAttribute: () => null } };
context.navigator = Object.assign(Object.create({}), { userAgent: "Actual", language: "en", hardwareConcurrency: 2 });
const actualEmpty = collect();
const actualEmptyTuple = JSON.parse(Buffer.from(create(actualEmpty).slice(7), "base64").toString("utf8"));
assert.equal(actualEmptyTuple[2], null); assert.equal(actualEmptyTuple[5], null); assert.equal(actualEmptyTuple[6], null);
assert.equal(actualEmptyTuple[8], null); assert.equal(actualEmptyTuple[10], "undefined−undefined");
assert.equal(actualEmptyTuple[4], "Actual", "no official UA or scripts are substituted");
context.document = { scripts: [], documentElement: { getAttribute: () => null } };
context.navigator = Object.assign(Object.create(null), { userAgent: "Actual", language: "en", hardwareConcurrency: 2 });
assert.throws(collect, /not ready/i, "missing actual navigator prototype cannot become invented fingerprint");
console.log("PASS missing actual browser producers reject, no network/challenge entry (3 groups)");

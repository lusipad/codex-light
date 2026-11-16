import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const load = (path, imports) => { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports, AbortController, require: name => { if (name in imports) return imports[name]; throw Error(`Unexpected import ${name}`); } }); return exports; };
const normalizer = load("src/pluginManagementMcp.ts", {}), details = load("src/pluginAppDetails.ts", { "./config": {}, "./chatgptService": {}, "./pluginManagementMcp": normalizer });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const link = (id, appId) => ({ id, connector_id: appId, owners: [{ id: "user", type: "USER", private: "secret" }], auth_status: "REAUTH_REQUIRED", visibility: "HIDDEN", owner_profile: { email: "actual@example.test", token: "secret" }, access_token: "secret" });
function fixture(ids = ["asdk_app_A", "connector_B"]) {
  const identity = { accountId: "a", userId: "u", generation: 1 }, slots = [], effects = [], calls = []; let cursor = 0, dirty = true, value, updates = 0;
  let props = { scope: "connection:plugin", ids, identity };
  const react = { useRef(initial) { return slots[cursor++] ??= { current: initial }; }, useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; dirty = true; updates++; }]; },
    useEffect(run, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((v, n) => v !== old.deps[n])) effects[i] = { deps, cleanup: (() => { old?.cleanup?.(); return run(); })() }; },
  };
  const bridge = { readPluginUsageMetadata: (id, actual, signal) => { assert.equal(actual, props.identity); const request = deferred(); calls.push({ kind: "metadata", id, signal, ...request }); return request.promise; },
    readPluginUsageLinks: (appIds, actual, signal) => { assert.equal(actual, props.identity); const request = deferred(); calls.push({ kind: "links", ids: appIds, signal, ...request }); return request.promise; } };
  const module = load("src/genericPluginUsage.ts", { react, "./chatgptService": bridge, "./pluginAppDetails": details, "./pluginManagementMcp": normalizer });
  const render = () => { for (let i = 0; dirty; i++) { assert.ok(i < 20); dirty = false; cursor = 0; value = module.useGenericPluginUsage(props.scope, props.ids, props.identity); } return value; };
  return { calls, module, identity, get value() { return render(); }, get updates() { return updates; }, update(patch) { props = { ...props, ...patch }; dirty = true; return render(); }, unmount() { effects.forEach(effect => effect?.cleanup?.()); } };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
{
  const f = fixture(); assert.equal(f.value.links, null); assert.equal(f.calls.length, 3); assert.equal(f.calls.filter(call => call.kind === "metadata").length, 2);
  f.calls[0].resolve({ appId: "connector_A", connector: { id: "asdk_app_A", name: "Actual A", logo_url: "https://example.test/a", secret: "secret" } }); await flush();
  assert.equal(f.value.connectors.asdk_app_A.name, "Actual A"); assert.equal(f.value.connectors.connector_B, undefined); assert.equal(f.value.links, null);
  f.calls.find(call => call.kind === "links").resolve({ appIds: ["connector_A", "connector_B"], links: [link("A", "connector_A"), link("B", "connector_B")] }); await flush();
  assert.equal(f.value.links.length, 2); assert.equal(f.value.links[0].visibility, "HIDDEN", "caller receives verified links and applies the source presentation filter"); assert.ok(!JSON.stringify(f.value).includes("secret"));
  f.calls.find(call => call.id === "connector_B").reject({ code: "failure" }); await flush(); assert.ok(f.value.metadataErrors.connector_B); assert.equal(f.value.connectors.asdk_app_A.logo_url, "https://example.test/a"); assert.equal(f.value.linksError, null); f.unmount();
}
{
  const f = fixture(); f.value; f.calls.find(call => call.kind === "links").reject({ code: "failed" }); await flush(); assert.equal(f.value.links, null); assert.ok(f.value.linksError); f.unmount();
}
{
  const f = fixture(["asdk_app_A", "connector_A"]); f.value; assert.equal(f.calls.length, 2); assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(call => call.kind === "links").ids)), ["asdk_app_A"]); f.unmount();
}
{
  const f = fixture([]); assert.equal(f.value.links.length, 0); assert.equal(f.calls.length, 0); f.unmount();
}
{
  const f = fixture(); f.value; const old = [...f.calls]; f.update({ scope: "other" }); assert.ok(old.every(call => call.signal.aborted)); f.update({ scope: "connection:plugin" }); const updates = f.updates;
  old[0].resolve({ appId: "asdk_app_A", connector: { id: "asdk_app_A", name: "Retired A" } }); old.find(call => call.kind === "links").resolve({ appIds: ["asdk_app_A", "connector_B"], links: [] }); await flush();
  assert.equal(f.updates, updates); assert.equal(f.value.connectors.asdk_app_A, undefined); assert.equal(f.value.links, null); f.unmount(); const unmounted = f.updates;
  for (const call of f.calls) call.reject(Error("late")); await flush(); assert.equal(f.updates, unmounted); assert.ok(f.calls.every(call => call.signal.aborted));
}
{
  const f = fixture(); f.value; const old = [...f.calls]; f.update({ identity: { ...f.identity, generation: 2 } }); assert.ok(old.every(call => call.signal.aborted)); f.unmount();
}
{
  const f = fixture(); const { decodeGenericPluginUsageMetadata: metadata, decodeGenericPluginUsageLinks: links } = f.module;
  assert.throws(() => metadata({ appId: "foreign", connector: { id: "asdk_app_A", name: "A" } }, "asdk_app_A"));
  assert.throws(() => metadata({ appId: "asdk_app_A", connector: { id: "foreign", name: "A" } }, "asdk_app_A"));
  assert.throws(() => links({ appIds: ["asdk_app_A"], links: [] }, ["asdk_app_A", "connector_B"]));
  assert.throws(() => links({ appIds: ["asdk_app_A"], links: [link("foreign", "foreign")] }, ["asdk_app_A"]));
  assert.throws(() => links({ appIds: ["asdk_app_A"], links: [link("same", "asdk_app_A"), link("same", "asdk_app_A")] }, ["asdk_app_A"]));
  assert.throws(() => links({ appIds: ["asdk_app_A"], links: null }, ["asdk_app_A"]));
}
console.log("Generic plugin usage: one metadata read per normalized pS app plus one shared links read, independent arrivals/errors, strict identities and public fields, cancellation and scope/identity/ABA/unmount isolation passed.");

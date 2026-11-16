import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = ts.transpileModule(fs.readFileSync("src/pluginSkillToggle.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const pure = (path, imports) => { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: name => { if (name in imports) return imports[name]; throw Error(`Unexpected pure import ${name}`); } }); return exports; };
const mcp = pure("src/pluginManagementMcp.ts", {}), remote = pure("src/remotePlugins.ts", { "./config": {}, "./chatgptService": {} });
const durable = pure("src/durablePluginDetail.ts", { "./config": {}, "./chatgptService": {}, "./pluginManagementMcp": mcp, "./remotePlugins": remote });
const rootDecoder = pure("src/pluginCanonicalRoot.ts", { "./config": {}, "./chatgptService": {}, "./pluginManagementMcp": mcp, "./durablePluginDetail": durable });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const snapshot = (disabled = ["s"], extra = {}) => {
  const plugin = { id: "p", name: "real", status: "ENABLED", release: { interface: {}, skills: [{ name: "s", description: "Actual skill" }, { name: "other", description: "Another skill" }] } };
  return { kind: "generic", pluginId: "p", appId: null, pluginHeader: { id: "p", name: "Real", version: null, shortDescription: null, logoUrl: null, logoUrlDark: null }, hostedApp: null, hostedError: null, nativeEligibility: "unverified",
    identity: { accountId: "a", userId: "u", generation: 1 }, genericSource: { plugin, installedPlugin: { ...plugin, enabled: false, disabled_skill_names: disabled } }, ...extra };
};
const result = (delivery, checked, verification = "confirmed") => ({ body: { delivery, warningCode: null }, verification, readback: checked === undefined ? null : { pluginId: "p", skillName: "s", installed: true, disabledListKnown: true, checked } });
function fixture() {
  let cursor = 0, dirty = true, value, updates = 0, allowed = true; const slots = [], effects = [], writes = [], reads = [];
  let props = { scope: "scope-A", snapshot: snapshot(), skillName: "s", isCurrent: () => allowed };
  const react = { useRef(initial) { return slots[cursor++] ??= { current: initial }; }, useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = next; dirty = true; updates++; }]; },
    useEffect(run, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((v, n) => v !== old.deps[n])) { old?.cleanup?.(); effects[i] = { deps, cleanup: run() }; } },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, AbortController, require(name) {
    if (name === "react") return react;
    if (name === "./pluginCanonicalRoot") return rootDecoder;
    if (name === "./chatgptService") return {
      toggleServicePluginSkill: (...args) => { const request = deferred(); writes.push({ args, ...request }); return request.promise; },
      readPluginCanonicalRoot: (...args) => { const request = deferred(); reads.push({ args, ...request }); return request.promise; },
    }; throw Error(`Unexpected account/catalog/CLI import ${name}`);
  } });
  const render = () => { for (let i = 0; dirty; i++) { assert.ok(i < 20); dirty = false; cursor = 0; value = exports.usePluginSkillToggle(props.scope, props.snapshot, props.skillName, props.isCurrent); } return value; };
  return { writes, reads, exports, get value() { return render(); }, get updates() { return updates; }, update(patch) { props = { ...props, ...patch }; dirty = true; return render(); }, retire() { allowed = false; }, restore() { allowed = true; dirty = true; return render(); }, unmount() { effects.forEach(effect => effect?.cleanup?.()); } };
}
{
  const f = fixture(), decode = f.exports.decodePluginSkillToggleInitial;
  assert.equal(decode(snapshot(), "s").checked, false); assert.equal(decode(snapshot([]), "s").checked, true, "plugin enabled=false does not disable the source skill toggle");
  const missing = snapshot(); delete missing.genericSource.installedPlugin.disabled_skill_names; assert.equal(decode(missing, "s").disabledListKnown, false); assert.equal(decode(missing, "s").checked, false);
  const absent = snapshot(); absent.genericSource.installedPlugin = null; assert.equal(decode(absent, "s").installed, false);
  const noEnabled = snapshot([]); delete noEnabled.genericSource.installedPlugin.enabled;
  assert.equal(decode(noEnabled, "s").installed, false, "matching raw rows without the enabled field are not installed"); assert.equal(decode(noEnabled, "s").checked, false); assert.equal(decode(noEnabled, "s").disabledListKnown, false);
  const malformedEnabled = snapshot(); malformedEnabled.genericSource.installedPlugin.enabled = "false"; assert.throws(() => decode(malformedEnabled, "s"));
  const admin = snapshot(); admin.genericSource.plugin.status = "DISABLED_BY_ADMIN"; assert.equal(decode(admin, "s").adminDisabled, true);
  const wrong = snapshot(); wrong.genericSource.installedPlugin.id = "foreign"; assert.throws(() => decode(wrong, "s")); assert.throws(() => decode(snapshot(), "missing"));
}
{
  const f = fixture(), noEnabled = snapshot([]); delete noEnabled.genericSource.installedPlugin.enabled; f.update({ snapshot: noEnabled }); await f.value.change(true); assert.equal(f.writes.length, 0, "uninstalled matching service rows never enable a skill toggle"); f.unmount();
}
{
  const f = fixture(); const write = f.value.change(true), duplicate = f.value.change(true); assert.equal(f.writes.length, 1); assert.equal(f.value.busy, true); f.writes[0].resolve(result("not_sent", undefined, "pending")); await write; await duplicate;
  assert.equal(f.value.pending, false); assert.equal(f.value.busy, false); assert.equal(f.value.checked, false); assert.ok(f.value.error);
  const retry = f.value.change(true); assert.equal(f.writes.length, 2, "definitely not-sent writes unlock a new explicit action"); f.writes[1].resolve(result("accepted", true)); await retry; assert.equal(f.value.checked, true); assert.equal(f.value.pending, false); f.unmount();
}
for (const delivery of ["not_sent", "unknown"]) {
  const f = fixture(); const write = f.value.change(true); f.writes[0].resolve(result(delivery, true)); await write;
  assert.equal(f.value.checked, true, "same-value backend optimization with exact known readback confirms the already reached target"); assert.equal(f.value.pending, false); assert.equal(f.value.error, null); f.unmount();
}
{
  const f = fixture(); const write = f.value.change(true); f.writes[0].resolve(result("not_sent", false)); await write;
  assert.equal(f.value.checked, false); assert.equal(f.value.pending, false); assert.ok(f.value.error, "not-sent with an old-value readback must not claim success"); f.unmount();
}
{
  const f = fixture(); const write = f.value.change(true), response = result("not_sent", true); response.body.warningCode = "read_warning"; f.writes[0].resolve(response); await write;
  assert.equal(f.value.checked, false); assert.equal(f.value.pending, false); assert.ok(f.value.error, "not-sent with a warning cannot claim target confirmation"); f.unmount();
}
for (const checked of [undefined, true]) {
  const f = fixture(); const write = f.value.change(true); f.writes[0].resolve(result("rejected", checked, checked === true ? "confirmed" : "pending")); await write;
  assert.equal(f.value.pending, false, "definite server rejection is not unknown delivery"); assert.equal(f.value.busy, false); assert.equal(f.value.checked, false); assert.ok(f.value.error); assert.equal(f.writes.length, 1, "rejection never automatically resubmits");
  const retry = f.value.change(true); assert.equal(f.writes.length, 2, "a new explicit action remains available after rejection"); f.writes[1].resolve(result("accepted", true)); await retry; assert.equal(f.value.checked, true); f.unmount();
}
{
  const f = fixture(); const write = f.value.change(true); f.writes[0].resolve(result("accepted", false)); await write; assert.equal(f.value.pending, true); assert.equal(f.value.checked, false);
  await f.value.change(true); assert.equal(f.writes.length, 1); const read = f.value.verify(); assert.equal(f.reads.length, 1); f.reads[0].resolve(snapshot([])); await read; assert.equal(f.value.checked, true); assert.equal(f.value.pending, false); assert.equal(f.writes.length, 1); f.unmount();
}
for (const patch of [{ installed: false }, { disabledListKnown: false }, { checked: null }, { pluginId: "other" }, { skillName: "other" }]) {
  const f = fixture(); const write = f.value.change(true), response = result("accepted", true); Object.assign(response.readback, patch); f.writes[0].resolve(response); await write; assert.equal(f.value.pending, true); assert.equal(f.value.checked, false); f.unmount();
}
{
  const f = fixture(); const write = f.value.change(true); f.writes[0].resolve(result("unknown", undefined, "pending")); await write; assert.equal(f.value.pending, true);
  f.update({ snapshot: snapshot([]) }); assert.equal(f.value.pending, true, "ordinary snapshot refresh cannot silently clear the unknown write");
  let read = f.value.verify(); const missing = snapshot(); delete missing.genericSource.installedPlugin.disabled_skill_names; f.reads[0].resolve(missing); await read; assert.equal(f.value.pending, true);
  read = f.value.verify(); f.reads[1].resolve(snapshot()); await read; assert.equal(f.value.pending, true, "old checked value cannot confirm target");
  read = f.value.verify(); f.reads[2].resolve(snapshot([], { kind: "canonical", genericSource: null })); await read; assert.equal(f.value.pending, true);
  read = f.value.verify(); f.reads[3].resolve(snapshot([])); await read; assert.equal(f.value.pending, false); assert.equal(f.writes.length, 1); f.unmount();
}
{
  const f = fixture(); const old = f.value.change, write = old(true); const oldSignal = f.writes[0].args[4]; f.update({ scope: "scope-B" }); f.update({ scope: "scope-A" }); assert.ok(oldSignal.aborted); assert.equal(f.value.pending, true);
  const before = f.updates; f.writes[0].resolve(result("accepted", true)); await write; assert.equal(f.updates, before); await old(false); assert.equal(f.writes.length, 1);
  const read = f.value.verify(); f.unmount(); const unmounted = f.updates; f.reads[0].resolve(snapshot([])); await read; assert.equal(f.updates, unmounted); assert.ok(f.reads[0].args[2].aborted);
}
{
  const f = fixture(); f.value; f.retire(); await f.value.change(true); assert.equal(f.writes.length, 0); f.unmount();
}
{
  const f = fixture(); const write = f.value.change(true); f.retire(); f.writes[0].resolve(result("accepted", true)); await write;
  f.restore(); assert.equal(f.value.busy, false); assert.equal(f.value.pending, true, "temporary invalid parent guard cannot confirm a response or leave a permanent busy lock");
  const read = f.value.verify(); assert.equal(f.reads.length, 1); f.reads[0].resolve(snapshot([])); await read; assert.equal(f.value.pending, false); f.unmount();
}
console.log("Service skill toggle: real installed/disabled-list state, not-sent unlock, strict confirmed readback, shared single-flight state, unknown-only root verification, refresh preservation and scope/ABA/unmount retirement passed.");

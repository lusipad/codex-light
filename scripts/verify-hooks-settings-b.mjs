import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const model = {};
vm.runInNewContext(compile(fs.readFileSync("src/hooksSettingsModel.ts", "utf8")), { exports: model });
const hook = (id, source, extra = {}) => ({ id, source, cwd: "project-a", event: "preToolUse", displayOrder: 1, enabled: true, trustStatus: "trusted", currentHash: "hash-1", raw: { key: id }, ...extra });
const group = (cwd, hooks, warnings = [], errors = []) => ({ cwd, hooks: hooks.map(h => ({ ...h, cwd })), warnings, errors });
const data = groups => ({ groups, hooks: groups.flatMap(g => g.hooks), warnings: [], errors: [] });
assert.deepEqual(Array.from(model.mergeHookRoots(["z", "b", "a", "b"], ["b", "c", "b"])), ["b", "c", "a", "z"]);
assert.deepEqual(Array.from(model.mergeHookRoots([], [])), []);
{
  const first = hook("shared", "user"), duplicate = { ...first, enabled: false };
  const sections = model.buildHookSourceSections(data([
    group("project-a", [first, hook("p-a", "project"), hook("plug-one", "plugin", { pluginId: "one" }), hook("managed", "mdm", { enabled: false, trustStatus: "managed" }), hook("review", "user", { trustStatus: "modified" }), hook("session", "sessionFlags")], ["warning"]),
    group("project-b", [duplicate, hook("p-b", "project"), hook("plug-null", "plugin", { pluginId: null }), hook("plug-two", "plugin", { pluginId: "two" })], ["warning"]),
    group("diagnostics", [], ["warning", "diagnostic"], [{ path: "file", message: "broken" }, { path: "file", message: "broken" }]),
  ]));
  assert.deepEqual(Array.from(sections, s => s.id), ["plugin", "user", "admin", "project", "sessionFlags", "unknown"]);
  const user = sections.find(s => s.id === "user").entry;
  assert.equal(user.hooks.length, 2); assert.equal(user.hooks[0].enabled, true, "duplicate key retains first fact");
  assert.equal(user.active, 1); assert.equal(user.needsReview, 1); assert.equal(user.warnings.length, 1);
  const plugins = sections[0]; assert.equal(plugins.entry.installed, 3);
  assert.deepEqual(Array.from(plugins.entries, e => e.pluginId), ["one", "two", null]);
  assert.equal(new Set(plugins.entries.map(e => e.key)).size, 3);
  const projects = sections.find(s => s.id === "project");
  assert.equal(projects.entry, null); assert.deepEqual(Array.from(projects.entries, e => e.cwd), ["project-a", "project-b"]);
  assert.equal(sections.find(s => s.id === "admin").entry.active, 1, "managed is active even if raw enabled is false");
  const diagnostics = sections.at(-1).entry; assert.equal(diagnostics.installed, 0); assert.equal(diagnostics.errors.length, 1);
  assert.deepEqual(Array.from(diagnostics.warnings), ["warning", "diagnostic"]);
  const events = model.groupHookEvents({ hooks: [hook("last", "user", { event: "stop", displayOrder: 3 }), hook("first", "user", { event: "stop", displayOrder: 1 }), hook("other", "user", { event: "preToolUse" })] });
  assert.deepEqual(Array.from(events, e => e.event), ["stop", "preToolUse"]);
  assert.deepEqual(Array.from(events[0].hooks, h => h.id), ["first", "last"]);
}
console.log("PASS HB01/HB02: source identity, first-key deduplication, diagnostics, counts and official event ordering");

const state = {}, calls = [];
let listed, config, writeResult, onRead, onConfig, onWrite;
vm.runInNewContext(compile(fs.readFileSync(process.argv[2] ?? "src/hookState.ts", "utf8")), { exports: state, require: name => name === "./hooksClient" ? {
  listHooks: async () => { calls.push("read"); onRead?.(); return listed.shift(); },
} : {
  configRead: async () => { calls.push("config"); onConfig?.(); return config; },
  configBatchWrite: async (...args) => { calls.push(["write", ...args]); onWrite?.(); return writeResult; },
} });
const trusted = hook('literal."key"', "user");
function reset() {
  calls.length = 0; listed = [data([group("project-a", [trusted])]), data([group("project-a", [{ ...trusted, enabled: false }])])];
  config = { layers: [{ name: { type: "user", file: "private/config.toml" }, version: "v1" }] };
  writeResult = { status: "ok" }; onRead = onConfig = onWrite = null;
}
for (const status of ["untrusted", "modified", "managed", "future-trust"]) {
  reset(); const target = { ...trusted, trustStatus: status }; listed[0] = data([group("project-a", [target])]);
  await assert.rejects(() => state.writeHookState(["project-a"], [target], false), /信任|托管/);
  assert.equal(calls.some(c => Array.isArray(c) && c[0] === "write"), false, `no enabled write before trust: ${status}`);
}
for (const boundary of ["before", "read", "config", "write"]) {
  reset(); let current = boundary !== "before";
  if (boundary === "read") onRead = () => current = false;
  if (boundary === "config") onConfig = () => current = false;
  if (boundary === "write") onWrite = () => current = false;
  await assert.rejects(() => state.writeHookState(["project-a"], [trusted], false, { isCurrent: () => current }), /上下文/);
  assert.equal(calls.filter(c => Array.isArray(c) && c[0] === "write").length, boundary === "write" ? 1 : 0);
  if (boundary === "write") assert.equal(calls.filter(c => c === "read").length, 1, "do not accept late write/readback in another context");
}
reset(); const wrongKey = { ...trusted, raw: { key: "different" } }; listed[0] = data([group("project-a", [wrongKey])]);
await assert.rejects(() => state.writeHookState(["project-a"], [wrongKey], false));
assert.equal(calls.length, 1);
for (const changed of [{ source: "plugin", pluginId: "other" }, { sourcePath: "changed/hooks.json" }]) {
  reset(); listed[0] = data([group("project-a", [{ ...trusted, ...changed }])]);
  await assert.rejects(() => state.writeHookState(["project-a"], [trusted], "trust"), /来源/);
  assert.equal(calls.some(c => Array.isArray(c) && c[0] === "write"), false);
}
reset(); await state.writeHookState(["project-a"], [trusted], false);
const write = calls.find(c => Array.isArray(c)); assert.equal(write[1][0].keyPath, `hooks.state.${JSON.stringify(trusted.id)}.enabled`);
assert.equal(write[2].expectedVersion, "v1"); assert.equal(write[2].reloadUserConfig, true);
console.log("PASS HB04/HB06/HB07: trusted-only toggles, exact raw identity, CAS readback and scope checks around each async boundary");

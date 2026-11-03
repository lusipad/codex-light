import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

let slots = [], index = 0, effects = [], previousDeps = [], cleanups = [], invoke, event;
const react = {
  useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], value => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }]; },
  useRef(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
  useEffect(callback, deps) { const slot = index++; if (!previousDeps[slot] || deps.some((dep, i) => dep !== previousDeps[slot][i])) { effects.push(() => { cleanups[slot]?.(); cleanups[slot] = callback(); }); previousDeps[slot] = deps; } },
};
const getConfigValue = (config, key) => key.split(".").reduce((value, part) => value?.[part], config);
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/agentConfiguration.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: mod.exports, require: name => name === "react" ? react : name === "./config" ? { getConfigValue } : {
  tauriInvoke: (...args) => invoke(...args), tauriListen: async (_, callback) => { event = callback; return () => {}; },
} });
const { supportsIndexedSearch, getScopeFieldValue, defaultAgentScope, agentConfigurationFields, useAgentConfiguration } = mod.exports;
const fixture = (config = {}, own = {}) => ({
  snapshot: { config, origins: {}, layers: [] }, requirements: null, serverVersion: "0.166.0-alpha.5.1",
  scopes: [
    { id: "project:C:/isolated/.codex", kind: "project", label: "isolated", filePath: "C:/isolated/.codex/config.toml", version: "p1", config: own, disabledReason: null, cwd: "C:/isolated", contents: "# preserve me\n" },
    { id: "user", kind: "user", label: "用户配置", filePath: "C:/isolated-home/config.toml", version: "u1", config: own, disabledReason: null },
    { id: "managed:2", kind: "managed", label: "管理员配置", filePath: null, version: "m1", config: { sandbox_mode: "read-only" }, disabledReason: null },
  ],
});
const keyField = (data, key, scope = data.scopes[0]) => agentConfigurationFields(data, scope).find(field => field.key === key);
const base = fixture({ sandbox_mode: "workspace-write", web_search: "cached" }, {});
assert.equal(getScopeFieldValue(base, base.scopes[0], "sandbox_mode"), "workspace-write");
assert.equal(keyField(base, "sandbox_mode").inherited, true);
assert.equal(defaultAgentScope(base, "C:/isolated"), base.scopes[0].id);
assert.equal(defaultAgentScope(base), "user");
assert.equal(defaultAgentScope(base, "C:/isolated/subdir"), base.scopes[0].id);
assert.equal(keyField(base, "sandbox_workspace_write.network_access").visible, true);
assert.equal(keyField(fixture({ sandbox_mode: "read-only" }), "sandbox_workspace_write.network_access").visible, false);
assert.equal(keyField(base, "approval_policy", base.scopes[2]).disabled, true);
const granular = fixture({ approval_policy: { granular: { rules: false } } });
assert.equal(keyField(granular, "approval_policy").disabled, true);
assert.equal(keyField(fixture({}, { approval_policy: "on-failure" }), "approval_policy").value, "on-failure");
assert.equal(keyField(base, "approval_policy").options.some(option => option.value === "on-failure" || option.value === "untrusted"), false);
const managed = fixture(); managed.snapshot.origins.approval_policy = { name: { type: "mdm" }, version: "m" };
assert.equal(keyField(managed, "approval_policy").disabled, true);
base.requirements = { allowedApprovalPolicies: ["never"], allowedSandboxModes: ["read-only"], allowedWebSearchModes: ["live"] };
assert.deepEqual(Array.from(keyField(base, "approval_policy").options, option => option.value), ["never"]);
assert.deepEqual(Array.from(keyField(base, "web_search").options, option => option.value), ["disabled", "live"]);
for (const version of [null, "unknown", "0.141.9", "0.142.0-alpha.5", "00.142.0", "codex-cli 0.166.0"]) assert.equal(supportsIndexedSearch(version), false, String(version));
for (const version of ["0.0.0", "0.142.0-alpha.6", "0.142.0-alpha.10", "0.142.0", "0.166.0-alpha.5.1"]) assert.equal(supportsIndexedSearch(version), true, version);
console.log("PASS AC-B01/B02/B03: scope inheritance, managed and complex policy locks, real options and indexed version boundary");

const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let props = { cwd: "C:/isolated", accountIdentity: "account-a" };
const render = () => { index = 0; const result = useAgentConfiguration(props); const pending = effects; effects = []; pending.forEach(run => run()); return result; };
let persisted = fixture({ sandbox_mode: "workspace-write" });
const calls = [];
invoke = async (command, args) => { calls.push([command, args]); return persisted; };
render(); await tick(); let state = render();
assert.equal(state.scope.id, persisted.scopes[0].id);
const pending = deferred();
invoke = (command, args) => { calls.push([command, args]); return command === "agent_configuration_write" ? pending.promise : Promise.resolve(persisted); };
const saved = state.change("sandbox_mode", "read-only");
assert.equal(await state.change("approval_policy", "never"), false);
state = render(); assert.equal(state.pendingKey, "sandbox_mode"); assert.equal(state.fields.find(field => field.key === "sandbox_mode").value, "workspace-write");
pending.reject(Error("version conflict")); assert.equal(await saved, false); state = render();
assert.match(state.errors.sandbox_mode, /version conflict/); assert.equal(state.fields.find(field => field.key === "sandbox_mode").value, "workspace-write");
invoke = async () => persisted;
assert.equal(await state.change("approval_policy", "never"), false); state = render();
assert.match(state.errors.approval_policy, /读回值/);
const changed = fixture({ sandbox_mode: "read-only" }, { sandbox_mode: "read-only" });
invoke = async (command, args) => { calls.push([command, args]); if (command === "agent_configuration_write") return changed; return persisted; };
assert.equal(await state.change("sandbox_mode", "read-only"), true); state = render();
assert.equal(state.fields.find(field => field.key === "sandbox_mode").value, "read-only");
const write = calls.find(call => call[0] === "agent_configuration_write");
assert.equal(write[1].expectedVersion, "p1"); assert.equal(write[1].expectedContents, "# preserve me\n");
assert.equal(write[1].keyPath, "sandbox_mode"); assert.equal(write[1].cwd, "C:/isolated");
console.log("PASS AS03/AS04: single-key CAS, original content, duplicate suppression, nonoptimistic failure and confirmed readback");

const late = deferred();
invoke = (command, args) => { calls.push([command, args]); return command === "agent_configuration_write" ? late.promise : Promise.resolve(persisted); };
const old = state.change("approval_policy", "never");
state.selectScope("user"); state = render(); late.resolve(fixture({}, { approval_policy: "never" }));
assert.equal(await old, false); state = render(); assert.equal(state.selectedScopeId, "user"); assert.notEqual(state.fields.find(field => field.key === "approval_policy").value, "never");
// A completed write in a departed scope must be visible when returning there.
await tick(); state = render();
state.selectScope("user"); await tick(); state = render();
const departedWrite = deferred();
invoke = command => command === "agent_configuration_write" ? departedWrite.promise : Promise.resolve(persisted);
const departed = state.change("approval_policy", "never");
state.selectScope(persisted.scopes[0].id); await tick(); state = render();
persisted = fixture({}, { approval_policy: "never" });
persisted.scopes[1].version = "u2";
departedWrite.resolve(persisted); assert.equal(await departed, false);
const scopeRead = deferred(); invoke = () => scopeRead.promise;
state.selectScope("user"); state = render();
assert.equal(state.loading, true); assert.equal(state.fields.every(field => field.disabled), true);
assert.equal(await state.change("approval_policy", "on-request"), false);
scopeRead.resolve(persisted); await tick(); state = render();
assert.equal(state.scope.version, "u2"); assert.equal(state.fields.find(field => field.key === "approval_policy").value, "never");
console.log("PASS scope return: scope switches reread persisted values/version and lock rows during reads");
const readLate = deferred(); invoke = () => readLate.promise;
const oldRead = state.reload(); props = { cwd: "C:/other", accountIdentity: "account-b" };
persisted = fixture({ sandbox_mode: "danger-full-access" }); persisted.scopes = persisted.scopes.filter(scope => scope.kind !== "project");
invoke = async () => persisted; render(); await tick(); state = render();
readLate.resolve(changed); await oldRead; state = render();
assert.equal(state.selectedScopeId, "user"); assert.equal(state.fields.find(field => field.key === "sandbox_mode").value, "danger-full-access");
const beforeEvent = calls.length; invoke = async (command, args) => { calls.push([command, args]); return persisted; }; event(); await tick(); state = render(); assert.ok(calls.length > beforeEvent);
const unload = deferred(); invoke = () => unload.promise; const flight = state.change("approval_policy", "never");
cleanups.forEach(cleanup => cleanup?.()); unload.resolve(fixture({}, { approval_policy: "never" })); assert.equal(await flight, false);
console.log("PASS AS05/AS06: scope/account/cwd/unmount isolation and cross-window refresh; late read/write cannot replace current scope");

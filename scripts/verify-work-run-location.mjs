import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

assert.ok(fs.existsSync("src/workRunLocation.ts"), "Work run-location pure state layer must exist");
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/workRunLocation.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: module.exports, require: name => { throw Error(`Unexpected runtime dependency ${name}`); } });
const { projectWorkRunLocationCore: core, projectWorkRunLocation: project } = module.exports;
const clone = value => JSON.parse(JSON.stringify(value));
const groups = [];
const allowed = { status: "allowed", accountId: "fixture-account" };
const denied = { status: "denied", reason: "workspace-disabled" };
const base = { applyRolloutRules: true, cloudAccess: allowed, localAccess: allowed, enforceAccess: true,
  cloudProjectUnavailableReason: null, isEnterprise: false, isM2SyncEnabled: false, preferredLocation: "cloud", lockedProject: false };
const state = input => clone(core({ ...base, ...input }));
assert.deepEqual(state({}), { canChooseLocation: false, effectiveLocation: "local", unavailableReasons: { cloud: null, local: null } });
assert.equal(state({ applyRolloutRules: false }).effectiveLocation, "cloud");
assert.equal(state({ applyRolloutRules: false }).canChooseLocation, true);
assert.equal(state({ isEnterprise: true }).effectiveLocation, "cloud");
assert.equal(state({ isM2SyncEnabled: true }).effectiveLocation, "cloud");
assert.equal(state({ cloudAccess: denied, isEnterprise: true }).effectiveLocation, "local");
assert.equal(state({ localAccess: denied }).effectiveLocation, "cloud", "rollout local preference can still fall back to cloud");
assert.equal(state({ localAccess: denied, cloudAccess: { status: "loading" } }).effectiveLocation, null);
assert.deepEqual(state({ cloudAccess: { status: "error", source: "workspace-settings" }, cloudProjectUnavailableReason: "project-only-memory" }).unavailableReasons,
  { cloud: "error", local: null }, "access error takes precedence over project error");
assert.equal(state({ cloudAccess: allowed, cloudProjectUnavailableReason: "shared-project", isEnterprise: true }).effectiveLocation, "local");
assert.equal(state({ enforceAccess: false, cloudAccess: denied, localAccess: denied, cloudProjectUnavailableReason: "shared-project", applyRolloutRules: false }).effectiveLocation, "local");
assert.equal(state({ applyRolloutRules: false, cloudAccess: denied, localAccess: denied }).canChooseLocation, true, "canChoose is independent of both sides being unavailable");
groups.push("core rollout/preference/fallback/reason precedence");
assert.deepEqual(state({ lockedProject: true }), { canChooseLocation: false, effectiveLocation: "cloud",
  unavailableReasons: { cloud: null, local: "unsupported-project-type" } });
assert.equal(state({ lockedProject: true, cloudAccess: denied }).effectiveLocation, null, "locked project never falls back to local");
groups.push("locked project override");
for (const [cloud, local, expected] of [[allowed, allowed, "cloud"], [denied, allowed, "local"], [allowed, denied, "cloud"], [denied, denied, null]]) {
  assert.equal(state({ applyRolloutRules: false, cloudAccess: cloud, localAccess: local }).effectiveLocation, expected);
}
groups.push("two-side availability matrix");
const evidence = { homeComposerMode: "work", gate246: true, gate355: true, plan: "plus", orchestrationCapable: true,
  lockdownState: "disabled", workCloud: allowed, workLocal: allowed, persistedLocation: null,
  project: { cloudUnavailableReason: null, locked: false } };
const projected = patch => clone(project({ ...evidence, ...patch }));
assert.equal(projected({}).state.effectiveLocation, "cloud", "real M2 + gate355 defaults to cloud");
assert.equal(projected({ gate355: false }).state.effectiveLocation, "local");
assert.equal(projected({ persistedLocation: "local" }).state.effectiveLocation, "local");
assert.equal(projected({ persistedLocation: "cloud", gate355: false }).state.effectiveLocation, "cloud");
assert.equal(projected({ gate246: true, orchestrationCapable: false, persistedLocation: "cloud" }).state.effectiveLocation, "local");
assert.equal(projected({ gate246: false, orchestrationCapable: false, persistedLocation: "cloud" }).state.effectiveLocation, "cloud");
assert.equal(projected({ plan: "business", orchestrationCapable: false, persistedLocation: "cloud" }).state.effectiveLocation, "cloud");
assert.equal(projected({ plan: "unknown-future-enterprise", orchestrationCapable: false, persistedLocation: "cloud" }).state.effectiveLocation, "local", "enterprise membership is an exact source list");
assert.equal(projected({ lockdownState: "loading" }).state.effectiveLocation, "local", "known loading lockdown is not disabled");
assert.equal(projected({ project: { cloudUnavailableReason: "project-incompatible", locked: false } }).state.effectiveLocation, "local");
assert.equal(projected({ project: { cloudUnavailableReason: null, locked: true } }).state.effectiveLocation, "cloud");
groups.push("evidence adapter defaults/persisted/project truth");
for (const [field, value] of [["gate246", null], ["gate355", null], ["plan", null], ["homeComposerMode", null],
  ["orchestrationCapable", null], ["lockdownState", null], ["workCloud", null], ["workLocal", null],
  ["persistedLocation", undefined], ["project", null], ["persistedLocation", "future-value"]]) {
  const result = projected({ [field]: value });
  assert.equal(result.state, null, `missing ${field} cannot become false/default-local`);
  assert.ok(result.missingInputs.includes(field), `unknown ${field} is exposed`);
}
assert.equal(projected({ workCloud: null, combined: allowed }).state, null, "N.allowed cannot replace WorkCloud");
assert.equal(projected({ workLocal: null, combined: allowed }).state, null, "N.allowed cannot replace WorkLocal");
assert.deepEqual(projected({}).missingInputs, []);
groups.push("missing evidence and combined-access substitution rejected");

const enterprisePlans = ["business", "enterprise", "enterprise_cbp_usage_based", "enterprise_cbp_automation", "enterprise_cbp_trial",
  "enterprise_cbp_view_only", "deprecated_enterprise", "hc", "hc_consumption", "finserv", "law", "ent26", "education", "edu_plus", "edu_pro",
  "edu", "deprecated_edu", "k12", "quorum"];
assert.equal(enterprisePlans.length, 19);
for (const plan of enterprisePlans) {
  const result = projected({ plan, orchestrationCapable: false, persistedLocation: "cloud" });
  assert.equal(result.state.effectiveLocation, "cloud", `${plan} is an exact source enterprise member`);
  assert.equal(result.state.canChooseLocation, true);
}
groups.push("all 19 exact enterprise plans");
const nonEnterprisePlans = [...enterprisePlans.flatMap(plan => [plan.toUpperCase(), `${plan} `, `${plan}-extra`]),
  "enterprise_cbp", "team", "edu_pro_plus", "Business", "Enterprise", "quorum-v2"];
assert.equal(new Set(nonEnterprisePlans).size, 63);
for (const plan of nonEnterprisePlans) {
  const result = projected({ plan, orchestrationCapable: false, persistedLocation: "cloud" });
  assert.equal(result.state.effectiveLocation, "local", `${plan} must not be accepted by case folding/prefix/trim`);
  assert.equal(result.state.canChooseLocation, false);
}
groups.push("63 enterprise case/whitespace/near-match negatives");

for (const [name, patch, cloudAvailable] of [
  ["chat mode", { homeComposerMode: "chat" }, true],
  ["enabled lockdown", { lockdownState: "enabled" }, true],
  ["loading cloud access", { workCloud: { status: "loading" } }, false],
  ["denied cloud access", { workCloud: denied }, false],
  ["error cloud access", { workCloud: { status: "error", source: "workspace-settings" } }, false],
]) {
  const result = projected(patch);
  assert.deepEqual(result.missingInputs, [], `${name} is known evidence, not missing`);
  assert.equal(result.state.effectiveLocation, "local", `${name} prevents M2 cloud default`);
  assert.equal(result.state.canChooseLocation, false);
  assert.equal(projected({ ...patch, workLocal: denied }).state.effectiveLocation, cloudAvailable ? "cloud" : null,
    `${name} still follows the normal availability fallback`);
}
groups.push("five independent M2 invalidation paths and normal fallback");

const incompatibleCloud = projected({ project: { cloudUnavailableReason: "shared-project", locked: false } });
assert.equal(incompatibleCloud.state.effectiveLocation, "local");
assert.equal(incompatibleCloud.state.unavailableReasons.cloud, "shared-project");
assert.equal(incompatibleCloud.state.canChooseLocation, true, "two allowed accesses keep canChoose independent of project cloud unavailability");
assert.deepEqual(state({ lockedProject: true, enforceAccess: false, cloudAccess: denied, localAccess: denied,
  cloudProjectUnavailableReason: "project-only-memory" }), { canChooseLocation: false, effectiveLocation: null,
  unavailableReasons: { cloud: "project-only-memory", local: "unsupported-project-type" } },
"skipping access enforcement does not bypass a locked project's cloud restriction");
assert.equal(state({ lockedProject: true, enforceAccess: false, cloudAccess: denied, localAccess: denied }).effectiveLocation, "cloud");
groups.push("project/canChoose independence and locked access-enforcement boundary");
assert.equal(groups.length, 9);
console.log(`PASS ${groups.length} Work run-location pure-state groups: ${groups.join("; ")}. No reader/service/model/native execution or iRBf override claimed.`);

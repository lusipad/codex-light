import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

assert.ok(fs.existsSync("src/workHomePreferences.ts"), "owner-bound Work home preference codec/reader must exist");
let readResult, pendingRead, readFailure, calls = 0, lastIdentity;
const identity = { userId: "fixture-user", accountId: "fixture-account", generation: 3 };
const atomKeys = ["work-run-location-v1", "home-composer-mode-v1", "chatgpt-last-selected-home-model-v1", "chatgpt-last-selected-model-v1"];
const response = () => ({ identity: { ...identity }, preferences: { owner: "bound", atoms: {}, unboundAtoms: [],
  selectedProject: { placement: "missing", binding: "confirmed" }, localProjects: { placement: "missing" } } });
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/workHomePreferences.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: module.exports, require(name) {
  assert.equal(name, "./chatgptService", "no generic state/HTTP reader is permitted");
  return { readWorkHomeState: async (actualIdentity, signal) => { calls++; lastIdentity = actualIdentity;
    signal.throwIfAborted(); if (readFailure) throw readFailure; return pendingRead ? pendingRead.promise : readResult; } };
} });
const { parseWorkHomePreferences: parse, readWorkHomePreferences: read } = module.exports;
const clone = value => JSON.parse(JSON.stringify(value));
const empty = clone(parse(response(), identity));
assert.deepEqual(empty.defaultModeRequestUserInput, { status: "missing" }, "default input owner key is missing, not an invented true default");
for (const field of ["runLocation", "mode", "homeModel", "lastModel", "selectedProject", "localProjects"]) assert.equal(empty[field].status, "missing");
assert.deepEqual(empty.identity, identity);
assert.equal(empty.legacyDetail, undefined, "omitted legacy metadata remains unknown, not missing");
for (const legacyDetail of ["missing", "unbound"]) {
  const legacy = response(); legacy.preferences.legacyDetail = legacyDetail;
  assert.equal(parse(legacy, identity).legacyDetail, legacyDetail);
}
for (const legacyDetail of [null, false, 0, "STEPS_PROSE", {}, []]) {
  const legacy = response(); legacy.preferences.legacyDetail = legacyDetail;
  assert.throws(() => parse(legacy, identity), /Work/, "invalid metadata cannot become a known missing legacy setting");
}

const raw = response();
const homeModel = { slug: "gpt-6.1-sol", thinkingEffort: null, versionId: "actual-version" };
const lastModel = { slug: "gpt-6-astra", thinkingEffort: "high" };
Object.assign(raw.preferences.atoms, { [atomKeys[0]]: "cloud", [atomKeys[1]]: "work", [atomKeys[2]]: homeModel,
  [atomKeys[3]]: lastModel, unrelatedSecret: "must-not-escape" });
raw.preferences.selectedProject = { placement: "owner-value", binding: "confirmed", value: { type: "local", projectId: "actual-project" } };
raw.preferences.localProjects = { placement: "root", value: { "actual-project": { id: "actual-project", rootPaths: ["fixture-root"],
  chatGptBacking: { accountId: identity.accountId, userId: identity.userId, projectId: "g-p-real" }, recovery: "preserve" } } };
const before = JSON.stringify(raw), ready = parse(raw, identity);
assert.equal(ready.homeModel.value, homeModel); assert.equal(ready.lastModel.value, lastModel);
assert.equal(ready.runLocation.value, "cloud"); assert.equal(ready.mode.value, "work");
assert.equal(ready.selectedProject.value, raw.preferences.selectedProject.value);
assert.equal(ready.localProjects.value, raw.preferences.localProjects.value, "project codec receives the complete allowed raw map");
assert.equal(JSON.stringify(raw), before, "codec does not migrate, rewrite defaults or clear state");
assert.equal(JSON.stringify(ready).includes("must-not-escape"), false);
assert.equal("atoms" in ready, false, "raw atom container never escapes the white-list projection");

const explicitNull = response(); for (const key of atomKeys) explicitNull.preferences.atoms[key] = null;
for (const field of ["runLocation", "mode", "homeModel", "lastModel"]) assert.deepEqual(clone(parse(explicitNull, identity)[field]), { status: "value", value: null });
const invalids = response(); Object.assign(invalids.preferences.atoms, { [atomKeys[0]]: "future-location", [atomKeys[1]]: "codex",
  [atomKeys[2]]: { model: "wrong-field" }, [atomKeys[3]]: { slug: "real", thinkingEffort: false } });
for (const field of ["runLocation", "mode", "homeModel", "lastModel"]) assert.equal(parse(invalids, identity)[field].status, "invalid");

const unbound = response(); unbound.preferences.unboundAtoms = [...atomKeys];
unbound.preferences.atoms[atomKeys[0]] = "local";
for (const field of ["runLocation", "mode", "homeModel", "lastModel"]) assert.deepEqual(clone(parse(unbound, identity)[field]), { status: "unbound" });
for (const placement of ["legacy-root", "legacy-atom"]) {
  const legacy = response(); legacy.preferences.selectedProject = { placement, binding: "legacy-unbound", value: { type: "local", projectId: "legacy" } };
  legacy.preferences.localProjects = { placement: "legacy-atom", value: { legacy: { id: "legacy", chatGptBacking: { projectId: "preserve" } } } };
  const decoded = parse(legacy, identity);
  assert.equal(decoded.selectedProject.status, "unbound"); assert.equal(decoded.selectedProject.placement, placement);
  assert.equal(decoded.selectedProject.binding, "legacy-unbound");
  assert.equal("value" in decoded.selectedProject, false, "unbound selected-project values never escape the codec");
  assert.equal(decoded.localProjects.status, "value", "global legacy inventory is preserved with placement, not silently removed");
  assert.equal(decoded.localProjects.placement, "legacy-atom");
}
for (const bad of [null, [], { ...response(), identity: { ...identity, accountId: "foreign" } },
  { ...response(), preferences: { ...response().preferences, atoms: [] } },
  { ...response(), preferences: { ...response().preferences, owner: "signed-out" } },
  { ...response(), preferences: { ...response().preferences, unboundAtoms: ["unrelatedSecret"] } }]) {
  assert.throws(() => parse(bad, identity), /Work/);
}
for (const field of ["selectedProject", "localProjects"]) {
  const malformed = response(); malformed.preferences[field] = { placement: field === "selectedProject" ? "owner-value" : "root", binding: "confirmed", value: [] };
  assert.equal(parse(malformed, identity)[field].status, "invalid");
}
for (const value of [null, false, true]) {
  const preference = response(); preference.preferences.atoms["default-mode-request-user-input-enabled"] = value;
  assert.deepEqual(clone(parse(preference, identity).defaultModeRequestUserInput), { status: "value", value });
}
for (const value of ["false", 0, {}, []]) {
  const preference = response(); preference.preferences.atoms["default-mode-request-user-input-enabled"] = value;
  assert.equal(parse(preference, identity).defaultModeRequestUserInput.status, "invalid");
}
const unboundDefault = response(); unboundDefault.preferences.unboundAtoms = ["default-mode-request-user-input-enabled"];
unboundDefault.preferences.atoms["default-mode-request-user-input-enabled"] = true;
assert.deepEqual(clone(parse(unboundDefault, identity).defaultModeRequestUserInput), { status: "unbound" });

readResult = raw;
const controller = new AbortController();
const actual = await read(identity, controller.signal); assert.equal(calls, 1); assert.equal(actual.mode.value, "work");
assert.notEqual(lastIdentity, identity, "reader snapshots the identity before awaiting");
const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(() => read(identity, cancelled.signal)); assert.equal(calls, 1, "pre-aborted read performs no IPC");
let resolve; pendingRead = { promise: new Promise(yes => { resolve = yes; }) };
const late = new AbortController(), operation = read(identity, late.signal); late.abort(); resolve(raw);
await assert.rejects(() => operation); assert.equal(calls, 2, "late response cannot become a successful empty/default snapshot");
pendingRead = null; readFailure = Error("fixture host unavailable");
await assert.rejects(() => read(identity, new AbortController().signal), /fixture host unavailable/, "host failures never become a missing/default snapshot");
readFailure = null;
pendingRead = { promise: new Promise(yes => { resolve = yes; }) };
const mutableIdentity = { ...identity }, originalRead = read(mutableIdentity, new AbortController().signal);
mutableIdentity.accountId = "changed-by-caller"; resolve(raw);
assert.deepEqual(clone((await originalRead).identity), identity, "identity snapshot survives caller mutation during await");
assert.equal(lastIdentity.accountId, identity.accountId);
console.log("PASS owner-bound Work home preferences: seven white-list fields, five exact owner atom names including boolean default input, missing/null/false/invalid/unbound separation, project raw/placement preservation, no migration/leak, identity and cancellation fences; one restricted host read only. No real account/service/native execution.");

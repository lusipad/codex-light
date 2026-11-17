import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const identity = { accountId: "actual-account", userId: "actual-user", generation: 4 };
const calls = [], readers = {};
const boundary = (name, ...args) => { calls.push({ name, args }); if (!readers[name]) throw Error(`Unexpected reader ${name}`); return readers[name](...args); };
const services = {
  serviceIdentity: signal => boundary("identity", signal),
  readWorkAccountInfo: (owner, signal) => boundary("account", owner, signal),
  readWorkHomeState: (owner, signal) => boundary("preferences", owner, signal),
  readChatgptService: (operation, body, owner, signal) => { assert.equal(operation, "library_settings"); assert.equal(JSON.stringify(body), "{}"); return boundary("settings", owner, signal); },
};
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const api = {}; modules.set(file, api);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(`src/${file}.ts`, "utf8"), {
    fileName: `${file}.ts`, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: api, require: name => {
    if (name === "./chatgptService") return services;
    if (name === "./workModelCatalog") return { readWorkModelCatalog: (owner, signal) => boundary("catalog", owner, signal) };
    if (name === "./workHomePreferences") return load("workHomePreferences");
    throw Error(`Unexpected dependency ${name}`);
  } }); return api;
}
const api = load("chatgptHistoryModel");
const project = (...args) => JSON.parse(JSON.stringify(api.projectChatgptHistoryModel(...args)));
const catalog = () => ({ defaultModelSlug: "catalog-default", modelConfigBySlug: {
  "catalog-default": {}, instant: {}, automatic: {}, historical: {}, },
  options: [{ slug: "catalog-default", thinkingEffort: "standard" }, { slug: "historical", thinkingEffort: "extended" }],
  internalOptions: [], chatAlphaOptions: [], sliderSettings: [], disabledVersionSlugs: [],
  categories: [{ defaultModel: "instant", supportedModels: ["alias:instant"], lane: "instant" },
    { defaultModel: "automatic", supportedModels: ["alias:automatic"], lane: "auto" }],
  versionOptions: [{ id: "older", slugs: ["historical"], options: [], modelSlugByLane: {} },
    { id: "latest", slugs: ["automatic", "instant", "historical", "catalog-default"], options: [], modelSlugByLane: {} }],
  defaultThinkingEffortByModelSlug: { historical: "standard", "catalog-default": "min", automatic: "extended" },
  workspaceModelPolicy: { selection: { model: "instant", thinkingEffort: "ultra" }, newThreadPrecedence: "prefer_policy" },
});
const history = (slug, effort = null) => ({ defaultModelSlug: slug, thinkingEffort: effort });
assert.deepEqual(project(catalog(), history("historical", "xhigh"), { plan: "free", lastSelection: { slug: "instant", thinkingEffort: "ultra" } }),
  { slug: "historical", thinkingEffort: "xhigh", versionId: "latest" });
assert.deepEqual(project(catalog(), history("historical"), { plan: "plus", prefersAutoForInstantPreset: false }),
  { slug: "historical", thinkingEffort: "standard", versionId: "latest" });
console.log("PASS actual historical slug/ancestry effort wins; catalog default effort and latest version are real fallbacks");

for (const plan of ["free", "go", "free_workspace", null]) {
  assert.equal(project(catalog(), history("retired"), { plan, prefersAutoForInstantPreset: true }).slug, "catalog-default");
  assert.equal(project(catalog(), history(null), { plan, prefersAutoForInstantPreset: false }).slug, "catalog-default");
}
const paid = catalog(); paid.versionOptions.unshift({ id: "first-paid", slugs: ["instant", "automatic"], options: [], modelSlugByLane: {} });
for (const plan of ["plus", "pro", "business"]) {
  assert.equal(project(paid, history("retired"), { plan }).slug, "automatic");
  assert.equal(project(paid, history("retired"), { plan, prefersAutoForInstantPreset: false }).slug, "instant");
  assert.equal(project(paid, history(null), { plan, lastSelection: { slug: "alias:instant", thinkingEffort: "ultra" } }).slug, "instant");
  assert.equal(project(paid, history("retired"), { plan, lastSelection: { slug: "instant", thinkingEffort: null } }).slug, "automatic",
    "nonnull retired history candidate suppresses last-selected lane fallback");
}
console.log("PASS source paid-plan/lane/settings nullish behavior and exact first-version order");

const noLane = catalog(); noLane.categories = [];
assert.equal(project(noLane, history(null), { plan: "plus" }).slug, "catalog-default");
const first = catalog(); first.versionOptions.unshift({ id: "first-no-match", slugs: ["historical"], options: [], modelSlugByLane: {} });
assert.equal(project(first, history(null), { plan: "plus" }).slug, "catalog-default", "do not scan later versions after the selected source first version");
const noConfig = catalog(); delete noConfig.modelConfigBySlug.automatic;
assert.equal(project(noConfig, history(null), { plan: "plus" }).slug, "catalog-default", "lane slug must have actual config");
console.log("PASS source fallback uses catalog default when the first version/lane/config does not qualify");

const optionOnly = catalog(); delete optionOnly.modelConfigBySlug.historical;
assert.equal(project(optionOnly, history("historical"), { plan: "free" }).slug, "historical", "TFzY.$ also accepts a real option without a config entry");
const versionOnly = catalog(); versionOnly.modelConfigBySlug = {}; versionOnly.options = [];
versionOnly.versionOptions[0].options = [{ slug: "version-only", thinkingEffort: "extended" }];
assert.equal(project(versionOnly, history("version-only"), { plan: "free" }).slug, "version-only");
const work = catalog(); work.modelConfigBySlug.historical.isWorkModeModel = true;
assert.equal(project(work, history("historical"), { plan: "free" }).slug, "historical", "cold projection does not invent a Work filter; caller owns route admission");
console.log("PASS actual config/all-option availability, without home policy or invented Work filtering");

const unknown = catalog(); unknown.defaultModelSlug = "auto"; unknown.modelConfigBySlug = {}; unknown.options = []; unknown.versionOptions = [];
assert.equal(project(unknown, history(null), { plan: "free" }), null, "synthetic auto cannot prove an available model");
assert.equal(project(null, history(null), { plan: "free" }), null);
const immutable = catalog(), before = JSON.stringify(immutable); project(immutable, history(null), { plan: "plus" }); assert.equal(JSON.stringify(immutable), before);
console.log("PASS unresolved catalog is explicit null, input immutable, no HTTP or CLI fallback");
assert.equal(calls.length, 0, "pure projection never reads any service");

const preferences = atoms => ({ identity, preferences: { owner: "bound", atoms, unboundAtoms: [],
  selectedProject: { placement: "missing", binding: "confirmed" }, localProjects: { placement: "missing" } } });
function resetReaders() {
  calls.length = 0;
  Object.assign(readers, { identity: async () => ({ ...identity }), catalog: async () => paid, account: async () => ({ identity, authMethod: "chatgpt", plan: "plus" }),
    preferences: async () => preferences({}), settings: async () => ({ settings: {} }) });
}
const read = value => api.readChatgptHistoryModelContext(identity, value, new AbortController().signal);
resetReaders();
readers.preferences = async () => preferences({ "chatgpt-last-selected-model-v1": { slug: "alias:instant", thinkingEffort: "extended" },
  "chatgpt-last-selected-home-model-v1": { slug: "automatic" } });
let context = await read(history(null)); assert.equal(context.selection.slug, "instant"); assert.equal(context.warnings.length, 0);
readers.settings = async () => ({ settings: { model_picker_prefers_auto_for_instant_preset: true } });
context = await read(history(null)); assert.equal(context.selection.slug, "automatic");
readers.settings = async () => ({ settings: { model_picker_prefers_auto_for_instant_preset: false } });
context = await read(history("retired")); assert.equal(context.selection.slug, "instant");
for (const call of calls.filter(call => call.name !== "identity")) { assert.deepEqual(JSON.parse(JSON.stringify(call.args[0])), identity); assert.equal(call.args[1].aborted, false); }
console.log("PASS actual owner-bound preference parser plus library settings produce distinct last/home and true/false choices");

for (const failedReader of ["catalog", "account"]) {
  resetReaders(); const error = Error(`${failedReader} read failed`); readers[failedReader] = async () => { throw error; };
  await assert.rejects(read(history(null)), cause => cause === error);
  assert.equal(calls.some(call => call.name === "settings" || call.name === "preferences"), false);
}
resetReaders(); readers.preferences = async () => { throw Error("preference transport failed"); }; readers.settings = async () => { throw Error("settings transport failed"); };
context = await read(history("retired")); assert.equal(context.selection.slug, "automatic"); assert.equal(context.warnings.length, 2);
resetReaders(); readers.preferences = async () => ({ ...preferences({}), identity: { ...identity, generation: 99 } });
context = await read(history(null)); assert.equal(context.warnings.length, 1);
console.log("PASS required catalog/account failures throw; optional failures retain warnings rather than fake known-missing values");

resetReaders(); readers.settings = async () => ({ settings: { model_picker_prefers_auto_for_instant_preset: "false" } });
context = await read(history("retired")); assert.equal(context.selection.slug, "automatic", "non-boolean setting is never coerced false"); assert.equal(context.warnings.length, 1);
resetReaders(); readers.preferences = async () => { const value = preferences({}); value.preferences.unboundAtoms = ["chatgpt-last-selected-model-v1"]; return value; };
context = await read(history(null)); assert.equal(context.warnings.length, 1);
resetReaders(); readers.settings = async () => { throw Object.assign(Error("routing account changed"), { code: "account_changed" }); };
await assert.rejects(read(history(null)), error => error.code === "account_changed");
resetReaders(); let reads = 0; readers.identity = async () => ++reads < 3 ? identity : { ...identity, generation: 5 };
await assert.rejects(read(history(null)), error => error.code === "account_changed");
resetReaders(); const abort = new AbortController(); abort.abort(); await assert.rejects(api.readChatgptHistoryModelContext(identity, history(null), abort.signal));
assert.equal(calls.length, 0);
console.log("PASS malformed/unknown preferences remain distinct, optional account errors and abort cannot escape identity fencing");
console.log("ChatGPT cold history model: 8 production pure/reader groups passed (controlled read boundaries, no HTTP/CLI)");

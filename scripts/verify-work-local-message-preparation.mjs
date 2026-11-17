import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const load = (file, require) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText, { exports, require, Error, AbortController, AbortSignal });
  return exports;
};
const identity = { userId: "fixture-user", accountId: "fixture-account", generation: 1 };
const instructions = load("src/workDeveloperInstructions.ts", () => ({}));
const cacheModule = load("src/workCustomInstructions.ts", () => ({}));
function fixture() {
  const calls = [], state = { identity, gate: true, fail: false, ready: true, developerReady: true };
  const cache = cacheModule.createWorkCustomInstructionsCache(async () => {
    calls.push("account-settings"); if (state.wait) await state.wait;
    if (state.fail) throw Error("fixture read failed");
    return { customInstructions: "  Account instructions  ", communicationGuide: "Guide", communicationGuideEnabled: true };
  });
  const preparation = { status: "ready", identity, model: "fixture-model" };
  const api = load("src/workLocalMessagePreparation.ts", name => {
    if (name === "./chatgptService") return { serviceIdentity: async () => state.identity };
    if (name === "./workHomePreparation") return { readWorkLocalSubmissionPreparation: async () => {
      calls.push("model-and-execution"); return state.ready ? preparation : { status: "not-ready", reason: "model", missingInputs: ["model"] };
    } };
    if (name === "./workDeveloperPreparation") return { readWorkDeveloperPreparation: async () => {
      calls.push("project-instructions"); return state.developerReady ? { status: "ready", unifiedCustomInstructionsEnabled: state.gate,
        inputs: { threadId: null, gitSettings: { branchPrefix: "codex/", commitInstructions: "", pullRequestInstructions: "" }, gitWorkspace: "unknown",
          artifactFollowupsEnabled: false, workspaceDependenciesEnabled: false, worktreeCreationPreference: false,
          tools: { thread: false, worktree: false, worktreeLifecycle: false, sidebarSections: false },
          includeProseDetailLevelInstructions: true, writingBlockInstructions: false } }
        : { status: "not-ready", missingInputs: ["git-settings"] };
    } };
    if (name === "./workDeveloperInstructions") return instructions;
    assert.fail(name);
  });
  return { state, calls, cache, run: (signal = new AbortController().signal) => api.readWorkLocalMessagePreparation({}, { appServerVersion: "0.165.0" }, cache, signal) };
}
{
  const f = fixture(); f.cache.update(identity, true); await f.cache.refresh();
  const result = await f.run();
  assert.equal(result.status, "ready"); assert.equal(result.model, "fixture-model");
  assert.ok(result.developerInstructions.startsWith("Account instructions  \n\nGuide\n\n<app-context>"));
  assert.ok(result.developerInstructions.includes("### Git"));
  assert.deepEqual(f.calls, ["account-settings", "model-and-execution", "project-instructions"]);
  f.cache.dispose();
}
{
  const f = fixture(); let release;
  f.state.wait = new Promise(resolve => { release = resolve; });
  let completed = false;
  const first = f.run().then(result => { completed = true; return result; });
  for (let i = 0; i < 30 && !completed; i++) await Promise.resolve();
  assert.equal(completed, true, "send reads source cache without waiting for account HTTP completion");
  assert.ok((await first).developerInstructions.startsWith("<app-context>"));
  await f.run(); assert.equal(f.calls.filter(call => call === "account-settings").length, 1);
  release(); await f.cache.refresh();
  assert.ok((await f.run()).developerInstructions.startsWith("Account instructions"));
  assert.equal(f.calls.filter(call => call === "account-settings").length, 1, "warm sends do not fetch account instructions again");
  f.cache.dispose();
}
for (const gate of [false, null]) {
  const f = fixture(); f.state.gate = gate;
  if (gate === null) await assert.rejects(f.run(), error => error.code === "custom_instructions_not_ready");
  else assert.equal((await f.run()).status, "ready");
  assert.equal(f.calls.includes("account-settings"), false); f.cache.dispose();
}
{
  const f = fixture(); f.state.fail = true;
  const result = await f.run(); assert.equal(result.status, "ready");
  assert.ok(result.developerInstructions.startsWith("<app-context>"), "a genuinely failed first refresh has no cached base, as in source");
  assert.equal(f.calls.includes("account-settings"), true); f.cache.dispose();
}
for (const missing of ["ready", "developerReady"]) {
  const f = fixture(); f.state[missing] = false;
  const result = await f.run(); assert.equal(result.status, "not-ready");
  assert.equal(f.calls.includes("account-settings"), false); f.cache.dispose();
}
{
  const f = fixture(); f.state.identity = { ...identity, generation: 2 };
  await assert.rejects(f.run(), /账号已变化/); f.cache.dispose();
}
{
  const f = fixture(), abort = new AbortController(); abort.abort();
  await assert.rejects(f.run(abort.signal)); f.cache.dispose();
}
console.log("PASS actual Work message preparation composition: real cache and source-golden assembler, model/producer chain, known disabled versus unknown gate, real failed-refresh absence, identity and abort fences; isolated inputs, zero HTTP/model/AGENTS writes.");

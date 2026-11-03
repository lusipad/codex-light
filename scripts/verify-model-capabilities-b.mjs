import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/modelCapabilities.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: module.exports, require: () => ({}) });
const caps = module.exports;
const model = { id: "picker-id", model: "wire-name", defaultReasoningEffort: "medium", supportedReasoningEfforts: ["low", "medium", "high", "ultra", "high", ""], serviceTiers: [
  { id: "vendor-speed", name: "Fast" }, { id: "flex", name: "Flex" }, { id: "ultrafast", name: "Ultrafast" },
], defaultServiceTier: "vendor-speed" };
const access = { fast: true, ultrafast: false };
assert.equal(caps.modelRequestName([model], "picker-id"), "wire-name");
assert.equal(caps.modelRequestName([model], "not-present"), undefined);
assert.equal(caps.resolveModelSelection([], { model: "wire-name" }).available, false);
assert.equal(caps.resolveReasoningEffort(model, "high"), "high");
assert.equal(caps.resolveReasoningEffort(model, "unsupported"), "medium");
assert.equal(caps.resolveReasoningEffort(model, "ultra"), "medium");
assert.equal(caps.resolveReasoningEffort(model, "ultra", { includeUltraReasoningEffort: true }), "ultra");
assert.equal(caps.resolveReasoningEffort(model, "high", { enabledReasoningEfforts: ["low"] }), "low");
assert.equal(caps.resolveReasoningEffort(model, "high", { authMethod: "copilot" }), "medium");
assert.equal(caps.resolveReasoningEffort(model, "high", { enabledReasoningEfforts: [] }), null);
assert.deepEqual(Array.from(caps.getSupportedEfforts(model), e => e.reasoningEffort), ["low", "medium", "high"]);
console.log("PASS MC-B02/03: unknown models rejected, wire identity preserved, effort retention/default, ultra and account effort restrictions");
const hidden = { ...model, id: "hidden-id", model: "hidden-name", hidden: true };
assert.equal(caps.getModelEligibility(hidden).available, false);
assert.equal(caps.getModelEligibility(hidden, { configuredModel: hidden.model }).available, true);
assert.equal(caps.getPickerModels([hidden], { configuredModel: hidden.model }).length, 0);
assert.equal(caps.getPickerModels([hidden], { additionalAvailableModels: [hidden.model] }).length, 1);
assert.equal(caps.getModelEligibility({ ...model, model: "codex-auto-review" }, { additionalAvailableModels: ["codex-auto-review"] }).available, false);
const gated = { ...model, availableAccessPrograms: { cyber: ["restricted"] } };
assert.equal(caps.getModelEligibility(gated).available, false);
assert.equal(caps.getModelEligibility(gated, { availableModels: [model.model] }).available, true);
assert.equal(caps.getModelEligibility(gated, { authMethod: "apikey", availableModels: [model.model] }).available, false);
assert.equal(caps.getModelEligibility(model, { useHiddenModels: true, availableModels: [] }).available, false);
console.log("PASS MC-B02/08: hidden configured versus ordinary picker, review exclusion, unknown restricted gate and revoked availability");
assert.equal(caps.getFastServiceTier(model).id, "vendor-speed");
assert.equal(caps.resolveServiceTier(model, "fast", access).serviceTier, "vendor-speed");
assert.equal(caps.resolveServiceTier(model, undefined, access).serviceTier, "vendor-speed");
assert.equal(caps.resolveServiceTier(model, null, access).serviceTier, null);
assert.equal(caps.resolveServiceTier(model, "default", access).serviceTier, null);
assert.equal(caps.resolveServiceTier(model, "priority", access).available, false);
assert.equal(caps.resolveServiceTier(model, "fast", null).available, false);
assert.equal(caps.resolveServiceTier(model, "ultrafast", access).available, false);
assert.equal(caps.resolveServiceTier(model, "flex", null).serviceTier, "flex");
assert.equal(caps.modelSupportsFast({ ...model, serviceTiers: [], additionalSpeedTiers: ["fast"] }), false);
assert.equal(caps.resolveServiceTier({ ...model, serviceTiers: [{ id: "fast", name: "Fast" }] }, "fast", access).serviceTier, "fast");
assert.equal(caps.resolveServiceTier({ ...model, serviceTiers: [{ id: "priority", name: "Fast" }] }, "fast", access).serviceTier, "priority");
const resolved = caps.resolveModelSelection([model], { model: "picker-id", reasoningEffort: "high", serviceTier: "fast" }, {}, access);
assert.equal(resolved.available, true);
assert.deepEqual(JSON.parse(JSON.stringify(resolved.configuration)), { model: "wire-name", reasoningEffort: "high", serviceTier: "vendor-speed" });
assert.equal(caps.resolveModelSelection([model], { model: "picker-id", reasoningEffort: "high", serviceTier: "fast" }).available, false);
console.log("PASS MC-B04/09: real tier ids, default versus standard, custom/priority/fast, account rejection and one shared selection result");
const catalogModule = { exports: {} };
let response;
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/modelCatalog.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: catalogModule.exports, require: () => ({ callAppServer: async () => response }) });
for (const invalid of [null, {}, { id: "" }, { id: "ok", model: 42 }]) {
  response = { data: [invalid] };
  await assert.rejects(catalogModule.exports.loadModelCatalog, /条目格式无效/);
}
for (const nextCursor of [5, ""]) {
  response = { data: [], nextCursor };
  await assert.rejects(catalogModule.exports.loadModelCatalog, /分页格式无效/);
}
console.log("PASS MC-B01: malformed catalog identities and non-string/empty cursor rejected before exposing executable models");

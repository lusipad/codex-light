import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { mountProjectContext } from "./verify-new-thread-project-context.mjs";

const transpile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
function load(file, require) {
  const mod = { exports: {} };
  vm.runInNewContext(transpile(fs.readFileSync(file, "utf8")), { exports: mod.exports, require });
  return mod.exports;
}
const caps = load("src/modelCapabilities.ts", () => ({}));
let request;
const { loadModelCatalog } = load("src/modelCatalog.ts", () => ({ callAppServer: (...args) => request(...args) }));
const sample = (id, fields = {}) => ({
  id, model: id, displayName: id, hidden: false, isDefault: false,
  defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium" }], ...fields,
});
const calls = [];
request = async (method, params) => {
  calls.push([method, { ...params }]);
  return params.cursor == null
    ? { data: [sample("a")], nextCursor: "opaque cursor" }
    : { data: [sample("a", { description: "updated" }), sample("b")], nextCursor: null };
};
const result = await loadModelCatalog();
assert.deepEqual(Array.from(result, model => model.id), ["a", "b"]);
assert.equal(result[0].description, "updated");
assert.deepEqual(calls, [
  ["model/list", { cursor: null, includeHidden: true, limit: 100 }],
  ["model/list", { cursor: "opaque cursor", includeHidden: true, limit: 100 }],
]);
request = async () => ({ data: [] }); assert.equal((await loadModelCatalog()).length, 0);
request = async () => ({ data: [], nextCursor: "repeat" });
await assert.rejects(loadModelCatalog, /分页重复/);
request = async () => ({ models: [] }); await assert.rejects(loadModelCatalog, /格式无效/);
request = async () => { throw Error("disconnected"); }; await assert.rejects(loadModelCatalog, /disconnected/);
console.log("PASS MC01: production paginated loader, opaque cursors, updated duplicate identity, empty/malformed/failure and cursor loop");

const visible = sample("menu-id", { model: "wire-model", displayName: "Vendor-Model" });
const hidden = sample("hidden", { hidden: true, isDefault: true });
const review = sample("review", { model: "codex-auto-review", isDefault: true });
assert.equal(caps.getDefaultModel([hidden, review]), undefined);
assert.equal(caps.getDefaultModel([hidden, review, visible]), visible);
assert.deepEqual(Array.from(caps.getPickerModels([hidden, review, visible]), model => model.id), ["menu-id"]);
assert.equal(caps.findModel([visible], "wire-model"), visible);
assert.equal(caps.modelRequestName([visible], "menu-id"), "wire-model");
console.log("PASS MC03: hidden/review entries are excluded from ordinary defaults; ID and backend model remain distinct");

const app = fs.readFileSync("src/App.tsx", "utf8");
const appAst = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(appAst) === name) found = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(appAst); assert.ok(found, name); return found;
}
const state = { models: [visible], selected: visible.id, loading: false, error: null };
const context = {
  ...caps, modelCatalogRevisionRef: { current: 0 }, loadModelCatalog: () => request(),
  setModels: value => { state.models = value; },
  setModelsLoading: value => { state.loading = value; },
  setModelsError: value => { state.error = value; },
  setSelectedModelId: value => { state.selected = typeof value === "function" ? value(state.selected) : value; },
};
const refresh = vm.runInNewContext(transpile(`(${declaration("refreshModels").arguments[0].getText(appAst)})`), context);
let releaseOld, releaseNew;
request = () => new Promise(resolve => { releaseOld = resolve; });
const old = refresh();
request = () => new Promise(resolve => { releaseNew = resolve; });
const newer = refresh();
releaseNew([sample("new", { isDefault: true })]); await newer;
releaseOld([sample("old")]); await old;
assert.equal(state.models[0].id, "new"); assert.equal(state.selected, "new");
request = async () => []; await refresh(); assert.equal(state.models.length, 0); assert.equal(state.selected, "");
request = async () => [visible]; await refresh();
request = async () => { throw Error("offline"); }; await refresh();
assert.equal(state.models[0], visible); assert.match(state.error, /offline/); assert.equal(state.loading, false);
let releaseLate;
request = () => new Promise(resolve => { releaseLate = resolve; });
const late = refresh();
let cleanupExpression;
function findCleanup(node) {
  if (ts.isCallExpression(node) && node.expression.getText(appAst) === "useEffect" &&
      node.arguments[0]?.getText(appAst).includes("modelCatalogRevisionRef.current += 1")) cleanupExpression = node.arguments[0];
  ts.forEachChild(node, findCleanup);
}
findCleanup(appAst); assert.ok(cleanupExpression);
const cleanup = vm.runInNewContext(transpile(`(${cleanupExpression.getText(appAst)})()`), context);
cleanup(); releaseLate([sample("unmounted")]); await late;
assert.equal(state.models[0], visible);
console.log("PASS MC02/MC05: production App refresh rejects stale/unmounted results, clears successful empty results, preserves failures and reconciles selection");

const sendView = mountProjectContext({});
sendView.context.selectedModelId = visible.id;
sendView.context.selectedModelName = vm.runInNewContext(transpile(`(${declaration("selectedModelName").getText(appAst)})`), {
  ...caps, models: [visible], selectedModelId: visible.id,
});
await sendView.send();
for (const method of ["thread/start", "turn/start"]) {
  assert.equal(sendView.calls.find(([name]) => name === method)?.[1].model, "wire-model", `${method} must send backend model`);
}
console.log("PASS MC04: actual App send callback uses backend model in thread/start and turn/start");

let configUpdated, settingsModels, configRefreshes = 0, modelRefreshes = 0;
function findConfigCallback(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(appAst) === "SettingsView") {
    configUpdated = node.attributes.properties.find(attr => attr.name?.getText(appAst) === "onConfigUpdated")?.initializer?.expression;
    settingsModels = node.attributes.properties.find(attr => attr.name?.getText(appAst) === "models")?.initializer?.expression;
  }
  ts.forEachChild(node, findConfigCallback);
}
findConfigCallback(appAst); assert.ok(configUpdated);
const update = vm.runInNewContext(transpile(`(${configUpdated.getText(appAst)})`), {
  refreshConfigOverview: async () => { configRefreshes++; },
  refreshModels: async () => { assert.equal(configRefreshes, 1); modelRefreshes++; },
});
await update(); assert.equal(modelRefreshes, 1);
const settingsChoices = vm.runInNewContext(transpile(`(${settingsModels.getText(appAst)})`), { ...caps, models: [hidden, review, visible] });
assert.deepEqual(Array.from(settingsChoices, model => model.id), ["menu-id"]);
console.log("PASS MC05: actual settings save callback refreshes config before discovering the new model catalog");

let view = "compact";
const selections = [];
const react = {
  createElement: (tag, props, ...children) => ({ tag, props: props ?? {}, children: children.flat(Infinity) }),
  useState: () => [view, value => { view = value; }], useId: () => "menu",
  useRef: () => ({ current: null }), useMemo: fn => fn(), useEffect() {},
};
const component = { exports: {} };
vm.runInNewContext(transpile(fs.readFileSync("src/components/ModelSelector.tsx", "utf8")), {
  exports: component.exports, requestAnimationFrame() {}, document: { hasFocus: () => true },
  require: name => name === "react" ? react : name.includes("modelCapabilities") ? caps : {},
});
const props = {
  models: [hidden, review, visible], selectedModelId: visible.model, defaultModelSelected: false,
  reasoningEffort: "medium", fastMode: false, open: true, onOpenChange() {},
  onSelectModel: (...args) => selections.push(args), onSelectReasoningEffort() {}, onToggleFastMode() {},
};
const all = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(all)] : [];
const text = node => typeof node === "string" ? node : node?.children?.map(text).join("") ?? "";
let tree = component.exports.ModelSelector(props);
assert.ok(text(tree).includes("Vendor-Model"), "display name must not be rewritten");
all(tree).find(node => node.props.className === "model-compact-current").props.onClick();
tree = component.exports.ModelSelector(props);
const rows = all(tree).filter(node => node.props.role === "menuitemradio");
assert.equal(rows.length, 2, "only default and visible model are choices");
assert.equal(rows[1].props["aria-checked"], true, "saved backend slug remains selected");
rows[1].props.onClick(); assert.deepEqual(selections, [["menu-id", false]]);
let retried = false;
tree = component.exports.ModelSelector({ ...props, modelsError: "offline", onRefreshModels: () => { retried = true; } });
all(tree).find(node => node.tag === "button" && text(node) === "重新读取").props.onClick(); assert.equal(retried, true);
tree = component.exports.ModelSelector({ ...props, models: [], modelsLoading: true });
assert.ok(all(tree).some(node => node.props.role === "status" && text(node).includes("正在加载")));
console.log("PASS MC03 JSX: original display name, hidden/review exclusion, slug selection, loading and retry callbacks");

const settings = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
assert.doesNotMatch(settings, /slug: "providers-models"|config_generate_models_api|newProvId|自定义 Model Providers/);
const settingsAst = ts.createSourceFile("SettingsView.tsx", settings, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let alias;
function findAlias(node) {
  if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) &&
      node.name.elements[0]?.name?.getText(settingsAst) === "activeSection") alias = node.initializer.arguments[0];
  ts.forEachChild(node, findAlias);
}
findAlias(settingsAst); assert.ok(alias);
for (const initialSection of ["providers-models", "appearance"]) {
  const actual = vm.runInNewContext(transpile(`(${alias.getText(settingsAst)})`), { initialSection });
  assert.equal(actual, initialSection === "providers-models" ? "agent" : initialSection);
}
console.log("PASS MC06: unsupported provider navigation/editor removed; legacy section resolves to agent");

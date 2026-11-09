import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
let dismissed = false;
const react = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useId: () => "fixture-tooltip",
  useState: () => [dismissed, value => { dismissed = value; }],
};
const exports = {};
vm.runInNewContext(compile(fs.readFileSync("src/components/TokenUsageMeter.tsx", "utf8")), {
  exports, require: name => name === "react" ? react : {},
});
const render = usage => exports.ComposerContextUsage({ usage });
for (const usage of [null, {}, { modelContextWindow: 100, total: { totalTokens: 20 } },
  { modelContextWindow: 0, last: { totalTokens: 10 } }, { modelContextWindow: 100, last: { totalTokens: -1 } },
  { modelContextWindow: Infinity, last: { totalTokens: 1 } }]) assert.equal(render(usage), null);
const usage = { modelContextWindow: 80000, last: { totalTokens: 20000 }, total: { totalTokens: 260000 } };
const indicator = render(usage);
assert.equal(indicator.props["aria-label"], "上下文用量：25%");
assert.equal(indicator.props.tabIndex, 0);
assert.equal(indicator.children[1].props.id, indicator.props["aria-describedby"]);
assert.equal(indicator.children[1].children[1].children.join(""), "25% 已用（剩余 75%）");
assert.equal(render({ ...usage, last: { totalTokens: 0 } }).props["aria-label"], "上下文用量：0%");
assert.equal(render({ ...usage, last: { totalTokens: 99999 } }).props["aria-label"], "上下文用量：100%");
const rounded = render({ ...usage, last: { totalTokens: 39600 } });
assert.equal(rounded.children[1].children[1].children.join(""), "50% 已用");
let stopped = false;
indicator.props.onKeyDown({ key: "Escape", nativeEvent: { isComposing: true }, stopPropagation() { stopped = true; } });
assert.equal(render(usage).props["data-dismissed"], false);
indicator.props.onKeyDown({ key: "Escape", nativeEvent: {}, stopPropagation() { stopped = true; } });
assert.equal(stopped, true);
assert.equal(render(usage).props["data-dismissed"], true);
indicator.props.onPointerEnter();
assert.equal(render(usage).props["data-dismissed"], false);

const app = fs.readFileSync("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let select, save, load, update;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "tokenUsage") select = node.initializer.getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleSetContextUsageVisible") save = node.initializer.arguments[0].getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes('key: "show-context-window-usage"')) load = node.arguments[0].getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "setThreadUsage" &&
      ts.isArrowFunction(node.arguments[0])) update = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
const selectUsage = (threadUsage, activeThreadId) => vm.runInNewContext(compile(select), { threadUsage, activeThreadId });
assert.equal(selectUsage({ threadId: "one", usage }, "one"), usage);
assert.equal(selectUsage({ threadId: "one", usage }, "two"), null);
assert.equal(selectUsage(null, null), null);
const next = vm.runInNewContext(compile(`(${update})`), {
  eventThreadId: "two", params: { tokenUsage: { modelContextWindow: 100 } },
  mergeTokenUsage: (previous, params) => ({ ...previous, ...params.tokenUsage }),
})({ threadId: "one", usage });
assert.equal(next.usage.last, undefined);

let stored = null, writes = 0, fail = false;
const context = {
  contextUsageVisible: false, contextUsagePendingRef: { current: true }, error: "",
  setContextUsageVisible: visible => { context.contextUsageVisible = visible; },
  setContextUsageSaving: () => {}, setContextUsageError: error => { context.error = error; },
  tauriInvoke: async (method, args) => {
    assert.equal(args.key, "show-context-window-usage");
    if (method === "desktop_state_set") { ++writes; if (fail) throw Error("denied"); stored = args.value; }
    return stored;
  },
};
const persist = vm.runInNewContext(compile(`(${save})`), context);
const restore = vm.runInNewContext(compile(`(${load})`), context);
await persist(true); assert.equal(writes, 0, "startup blocks writes");
restore(); await new Promise(setImmediate);
assert.equal(context.contextUsageVisible, false);
await persist(true); assert.equal(context.contextUsageVisible, true);
context.contextUsageVisible = false; restore(); await new Promise(setImmediate);
assert.equal(context.contextUsageVisible, true);
fail = true; await persist(false);
assert.equal(context.contextUsageVisible, true); assert.match(context.error, /denied/);
fail = false; await persist(false); assert.equal(context.contextUsageVisible, false); assert.equal(stored, false);
console.log("PASS 16L production context usage: last turn, scoped identity, invalid and clamped data, tooltip, confirmed preference");

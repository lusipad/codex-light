import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let orderedMap, thought, visible;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "turn.items.map" &&
      node.arguments[0]?.getText(ast).includes("switch (item.type)")) orderedMap = node.arguments[0];
  if (ts.isVariableDeclaration(node)) {
    if (node.name.getText(ast) === "renderThought") thought = node.initializer;
    if (node.name.getText(ast) === "hasAssistantContent") visible = node.initializer;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(orderedMap, "TO01: production timeline must dispatch in original item order");
const compile = text => ts.transpileModule(text, {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
}).outputText;
const rendered = [];
const context = {
  React: {
    Fragment: "fragment",
    createElement(type, props, ...children) {
      if (typeof type === "function") return type(props);
      return { type, props, children };
    },
  },
  ToolCallCards: ({ items }) => { rendered.push(items[0].id); return items[0].id; },
  selectThread() {},
};
for (const name of ["Thought", "Command", "FileChange", "Plan", "McpCall", "WebSearch", "Image", "SystemEvent", "Message"]) {
  context[`render${name}`] = item => { rendered.push(item.id); return item.id; };
}
const render = vm.runInNewContext(compile(`(${orderedMap.getText(ast)})`), context);
const types = ["agentMessage", "commandExecution", "reasoning", "fileChange", "assistantMessage", "mcpToolCall", "dynamicToolCall", "webSearch", "imageView", "sleep", "plan", "thought", "agentMessage"];
const items = types.map((type, index) => ({ id: `item-${index}`, type }));
const first = items.map(render);
assert.deepEqual(rendered, items.map(item => item.id), "TO01–TO03: mixed item order must survive production dispatch");
rendered.length = 0;
const updated = items.map(item => ({ ...item, output: "updated", status: "completed" })).map(render);
assert.deepEqual(updated.map(node => node.props.key), first.map(node => node.props.key), "TO04: completion preserves item identity");
assert.equal(render({ id: "user", type: "userMessage" }, 0), null, "TO06: user messages retain the existing separate deduplication path");
assert.match(thought.getText(ast), /extractReasoningText\(item\)/, "TO02: each reasoning renderer uses its own item");
assert.doesNotMatch(thought.getText(ast), /thoughts\.map/, "TO02: later reasoning must not be pulled into the first body");
const systemOnly = vm.runInNewContext(compile(`(${visible.getText(ast)})`), {
  meaningfulThoughts: [], commands: [], fileChanges: [], planItems: [], mcpCalls: [],
  dynamicToolItems: [], webSearches: [], imageViews: [], messages: [],
  systemEvents: [{ type: "sleep" }], isStreaming: false, turn: { status: "completed", items: [{ type: "sleep" }] },
});
assert.equal(systemOnly, true, "TO03: system-only turns remain visible");
console.log("PASS TO01–TO06 production dispatch: interleaved order, per-item reasoning, stable keys, system-only visibility and separate user path");

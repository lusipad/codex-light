import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const load = async file => import(`data:text/javascript;base64,${Buffer.from(compile(fs.readFileSync(new URL(file, import.meta.url), "utf8"))).toString("base64")}`);
const { mergeTimelineItem, ThreadHistoryBuffer } = await load("../src/threadTimeline.ts");
const { NOTIFICATION } = await load("../src/protocol.ts");
const { extractTextFromItem } = await load("../src/threadText.ts");
const source = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let reasoning, command, lifecycle, extract, output, label;
function visit(node) {
  if (ts.isIfStatement(node)) {
    const condition = node.expression.getText(ast);
    if (condition.includes('method === "item/reasoning/delta"') && ts.isBlock(node.thenStatement)) reasoning = node.thenStatement.getText(ast);
    if (condition === "method === NOTIFICATION.ITEM_COMMAND_OUTPUT_DELTA") command = node.thenStatement.getText(ast);
    if (condition === 'method === "item/started" || method === "item/completed"') lifecycle = node.thenStatement.getText(ast);
  }
  if (ts.isFunctionDeclaration(node) && node.name?.text === "extractReasoningText") extract = node.getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "outText") output = node.initializer.getText(ast);
  if (ts.isConditionalExpression(node) && node.condition.getText(ast).includes("cmd.exitCode !==") && node.whenTrue.getText(ast).includes("exit ${")) label = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast); for (const value of [reasoning, command, lifecycle, extract, output, label]) assert.ok(value);
let turns = [{ id: "t", status: "inProgress", items: [] }];
const context = vm.createContext({ NOTIFICATION, mergeTimelineItem, extractTextFromItem, setTurns: update => { turns = update(turns); } });
vm.runInContext(compile(`${extract}; globalThis.extract = extractReasoningText;`), context);
const run = (body, method, params) => {
  context.method = method; context.params = params; context.eventTurnId = params.turnId;
  vm.runInContext(compile(`(()=>${body})()`), context);
};
const notify = (method, params) => {
  params = { threadId: "a", turnId: "t", ...params };
  run(method === "item/started" || method === "item/completed" ? lifecycle : method === NOTIFICATION.ITEM_COMMAND_OUTPUT_DELTA ? command : reasoning, method, params);
};
const summary = (index, delta) => notify(NOTIFICATION.ITEM_REASONING_SUMMARY_DELTA, { itemId: "r", summaryIndex: index, delta });
summary(1, "第二"); summary(0, "第一"); summary(1, "段");
assert.deepEqual(turns[0].items[0].summary && JSON.parse(JSON.stringify(turns[0].items[0].summary)), ["第一", "第二段"], "reasoning deltas must respect summaryIndex");
notify(NOTIFICATION.ITEM_REASONING_TEXT_DELTA, { itemId: "r", contentIndex: 1, delta: "正文二" });
notify(NOTIFICATION.ITEM_REASONING_TEXT_DELTA, { itemId: "r", contentIndex: 0, delta: "正文一" });
assert.deepEqual(JSON.parse(JSON.stringify(turns[0].items[0].content)), ["正文一", "正文二"]);
const before = JSON.stringify(turns);
notify(NOTIFICATION.ITEM_REASONING_SUMMARY_PART, { itemId: "r", summaryIndex: 1 });
assert.equal(JSON.stringify(turns), before, "section boundary must not fabricate text");
notify("item/completed", { item: { id: "r", type: "reasoning", summary: ["最终摘要"], content: [] } });
assert.equal(context.extract(turns[0].items[0]), "最终摘要");
assert.equal(context.extract({ summary: ["重复但独立的段", "重复但独立的段"], content: [] }), "重复但独立的段\n重复但独立的段", "equal indexed sections are not duplicate delivery");
console.log("PASS indexed reasoning sections and authoritative completion without duplicate streamed text");

notify(NOTIFICATION.ITEM_COMMAND_OUTPUT_DELTA, { itemId: "cmd", delta: "旧输出" });
notify("item/completed", { item: { id: "cmd", type: "commandExecution", command: "fixed", aggregatedOutput: "最终输出", status: "failed", exitCode: null } });
context.cmd = turns[0].items.find(item => item.id === "cmd");
assert.equal(vm.runInContext(output, context), "最终输出", "completed output must replace stream buffer");
assert.equal(vm.runInContext(label, context), "失败");
for (const [status, expected] of [["completed", "完成"], ["declined", "已拒绝"], ["inProgress", "运行中..."]]) {
  context.cmd = { status, aggregatedOutput: "", output: "stale", exitCode: null };
  assert.equal(vm.runInContext(output, context), "", "authoritative empty output must not fall back to stale text");
  assert.equal(vm.runInContext(label, context), expected);
}
console.log("PASS command output authority, empty output and terminal status labels");

const history = [{ id: "t", items: [{ id: "r", type: "reasoning", summary: ["第一段", "第二段"], content: ["正文"] }] }];
const event = (method, params) => ({ method, params: { threadId: "a", turnId: "t", itemId: "r", ...params } });
const replay = events => { const buffer = new ThreadHistoryBuffer(); buffer.begin(1, "a"); events.forEach(e => buffer.capture(e, 1)); return buffer.release(1, "a", history); };
assert.deepEqual(replay([event(NOTIFICATION.ITEM_REASONING_SUMMARY_DELTA, { summaryIndex: 0, delta: "段" }), event(NOTIFICATION.ITEM_REASONING_SUMMARY_DELTA, { summaryIndex: 1, delta: "段" }), event(NOTIFICATION.ITEM_REASONING_TEXT_DELTA, { contentIndex: 0, delta: "正文" })]), [], "history replay deduplicates each reasoning section separately");
const fresh = event(NOTIFICATION.ITEM_REASONING_SUMMARY_DELTA, { summaryIndex: 1, delta: "新内容" });
assert.deepEqual(replay([fresh]), [fresh]);
const completed = event("item/completed", { item: { id: "r", type: "reasoning", summary: ["final"], content: [] } });
assert.deepEqual(replay([fresh, completed]), [completed]);
const started = event("item/started", { item: { id: "r", type: "reasoning", summary: [], content: [] } });
assert.deepEqual(replay([started])[0].params.item.summary, history[0].items[0].summary, "empty started cannot erase hydrated reasoning");
console.log("PASS reasoning hydration replay preserves indexed history and final snapshots");

const commandHistory = [{ id: "t", items: [{ id: "cmd", type: "commandExecution", aggregatedOutput: "历史输出" }] }];
const commandStarted = event("item/started", { item: { id: "cmd", type: "commandExecution", aggregatedOutput: "" } });
const commandDelta = event(NOTIFICATION.ITEM_COMMAND_OUTPUT_DELTA, { itemId: "cmd", delta: "输出" });
const commandCompleted = event("item/completed", { item: { id: "cmd", type: "commandExecution", aggregatedOutput: "最终值", status: "completed" } });
const commandBuffer = new ThreadHistoryBuffer(); commandBuffer.begin(1, "a");
for (const e of [commandStarted, commandDelta, commandCompleted]) commandBuffer.capture(e, 1);
const commandEvents = commandBuffer.release(1, "a", commandHistory);
assert.equal(commandEvents[0].params.item.aggregatedOutput, "历史输出");
assert.deepEqual(commandEvents.map(e => e.method), ["item/started", "item/completed"]);
console.log("PASS command hydration keeps output and final completion suppresses buffered deltas");

import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source = fs.readFileSync(new URL("../src/threadTimeline.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { mergeTimelineItem, isCurrentThreadRequest, ThreadHistoryBuffer } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
let turns = [];
const delta = (turnId, itemId, text, type = "agentMessage") => {
  turns = mergeTimelineItem(turns, turnId, itemId, item => ({ ...item, type, text: (item.text || "") + text }));
};
delta("turn-a", "msg-a", "甲");
const snapshot = structuredClone(turns);
delta("turn-b", "msg-b", "乙");
delta("turn-a", "msg-c", "丙");
delta("turn-a", "msg-a", "丁");
assert.deepEqual(snapshot[0].items.map(i => i.text), ["甲"]);
assert.deepEqual(turns.map(t => t.items.map(i => i.text)), [["甲丁", "丙"], ["乙"]]);
delta("turn-a", "cmd-a", "a", "commandExecution");
delta("turn-a", "cmd-b", "b", "commandExecution");
delta("turn-a", "cmd-b", "c", "commandExecution");
assert.deepEqual(turns[0].items.filter(i => i.type === "commandExecution").map(i => i.text), ["a", "bc"]);
assert.equal(mergeTimelineItem(turns, undefined, "msg-a", () => ({})), turns);
assert.equal(mergeTimelineItem(turns, "turn-a", undefined, () => ({})), turns);
assert.equal(isCurrentThreadRequest(1, 2, "a", "b"), false);
assert.equal(isCurrentThreadRequest(1, 3, "a", "a"), false); // A → B → A
assert.equal(isCurrentThreadRequest(3, 3, "a", "a"), true);
console.log("PASS: interleaved turn/item replay, immutable updates and stale request");


// Resolve old A and B reads after a fresh A read: only the latest generation commits.
let active = "a";
let generation = 1;
let visible = [];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const read = async (threadId, request, pending) => {
  const result = await pending.promise;
  if (isCurrentThreadRequest(request, generation, threadId, active)) visible = result;
};
const oldA = deferred();
const oldATask = read("a", 1, oldA);
active = "b"; generation = 2;
const oldB = deferred();
const oldBTask = read("b", 2, oldB);
active = "a"; generation = 3;
const newA = deferred();
const newATask = read("a", 3, newA);
newA.resolve(["current a"]); await newATask;
oldB.resolve(["stale b"]); oldA.resolve(["stale a"]);
await Promise.all([oldATask, oldBTask]);
assert.deepEqual(visible, ["current a"]);
console.log("PASS: deferred A → B → A history responses cannot replace the latest selection");

// Loading notifications must replay over history, not replace it with a suffix.
const history = [{ id: "t", status: "inProgress", items: [{ id: "i", type: "agentMessage", text: "前缀后缀" }] }];
const notification = (method, params = {}) => ({ method, params: { threadId: "a", turnId: "t", ...params } });
const messageDelta = text => notification("item/agentMessage/delta", { itemId: "i", delta: text });
const replay = (events, loaded = history) => {
  const buffer = new ThreadHistoryBuffer();
  buffer.begin(1, "a");
  for (const event of events) assert.equal(buffer.capture(event, 1), true);
  return buffer.release(1, "a", loaded);
};
assert.deepEqual(replay([messageDelta("后缀")]), []);
assert.deepEqual(replay([messageDelta("后"), messageDelta("缀")]), []);
assert.deepEqual(replay([messageDelta("新内容")]), [messageDelta("新内容")]);
const legacyDelta = text => ({method:"codex/event/agent_message_delta",params:{thread_id:"a",turn_id:"t",itemId:"i",text}});
assert.deepEqual(replay([legacyDelta("后缀")]), []);
assert.equal(replay([legacyDelta("新内容")])[0].params.delta, "新内容");
assert.equal(replay([legacyDelta("新内容")])[0].method, "item/agentMessage/delta");
assert.deepEqual(replay([{method:"codex/event/agent_message_delta",params:{thread_id:"a",turn_id:"t",text:"无身份"}}]), []);
const otherItem = notification("item/agentMessage/delta", { itemId: "j", delta: "新条目" });
assert.deepEqual(replay([messageDelta("后"), otherItem, messageDelta("缀")]), [otherItem]);
// Match official endsWith behavior, including its repeated-text ambiguity.
assert.deepEqual(replay([messageDelta("哈")], [{id:"t",items:[{id:"i",type:"agentMessage",text:"哈哈"}]}]), []);
const completed = notification("item/completed", {item:{id:"i",type:"agentMessage",text:"最终权威回答"}});
assert.deepEqual(replay([messageDelta("后缀"), completed]), [completed]);
const started = notification("item/started", {item:{id:"i",type:"agentMessage",text:""}});
assert.equal(replay([started, messageDelta("后缀")])[0].params.item.text, "前缀后缀");
assert.equal(replay([started, messageDelta("新内容")])[0].params.item.text, "");
const command = notification("item/commandExecution/outputDelta", {itemId:"cmd",delta:"输出"});
assert.deepEqual(replay([command], [{id:"t",items:[{id:"cmd",type:"commandExecution",aggregatedOutput:"已有输出"}]}]), []);
assert.deepEqual(replay([command], [{id:"t",items:[{id:"cmd",type:"commandExecution",aggregatedOutput:"历史"}]}]), [command]);
assert.deepEqual(replay([command], []), [command]);
assert.deepEqual(replay([messageDelta("失败仍可见")], []), [messageDelta("失败仍可见")]);
const buffer = new ThreadHistoryBuffer();buffer.begin(1,"a");buffer.capture(messageDelta("旧A"),1);buffer.begin(2,"b");buffer.begin(3,"a");
assert.equal(buffer.release(1,"a",history), null);
assert.equal(buffer.capture(messageDelta("旧代次"),1), false);
assert.deepEqual(buffer.release(3,"a",history), []);
assert.equal(buffer.release(3,"a",history), null);
buffer.begin(4,"a");buffer.capture(messageDelta("丢弃"),4);buffer.discard();
assert.equal(buffer.release(4,"a",history), null);
assert.equal(buffer.capture(messageDelta("释放后"),4), false);
console.log("PASS: official hydration replay, authoritative completion, command output, failed load and stale buffers");

// Execute the actual App notification branches with state setters captured.
const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const appAst = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let startedBody, installFinishedHistory;
const visit = node => {
  if (ts.isIfStatement(node) && node.expression.getText(appAst) === 'method === "turn/started"') startedBody = node.thenStatement.getText(appAst);
  if (ts.isBinaryExpression(node) && node.left.getText(appAst) === "finishedTurnIdsRef.current" && node.right.getText(appAst).startsWith("new Set(loadedTurns")) installFinishedHistory = node.getText(appAst);
  ts.forEachChild(node, visit);
};
visit(appAst);assert.ok(startedBody);assert.ok(installFinishedHistory);
const runStarted = new Function("params", "finishedTurnIdsRef", "turnLifecycleRef", "setIsStreaming", "setActiveTurnId", "setTurns", "flushPendingAttachmentSave", startedBody);
const installHistory = new Function("loadedTurns", "finishedTurnIdsRef", installFinishedHistory);
for (const status of ["completed", "failed", "interrupted"]) {
  let streaming = false, active = null, rows = [{id:"t",status,items:[]}];
  const lifecycle = {current:0};
  const finished = {current:new Set()};installHistory(rows, finished);
  const pending = new ThreadHistoryBuffer();pending.begin(1,"a");pending.capture(notification("turn/started",{turn:{id:"t"}}),1);
  for (const event of pending.release(1,"a",rows)) runStarted(event.params, finished, lifecycle, value=>{streaming=value}, value=>{active=value}, update=>{rows=update(rows)}, ()=>{});
  assert.equal(streaming, false, status+" must ignore late started before changing streaming");
  assert.equal(active,null);assert.equal(lifecycle.current,0);assert.equal(rows[0].status,status);
}
for (const rows of [[{id:"t",status:"inProgress",items:[]}], []]) {
  let streaming=false, active=null;
  runStarted({threadId:"a",turn:{id:"t"}}, {current:new Set()}, {current:0}, value=>{streaming=value}, value=>{active=value}, update=>update(rows), ()=>{});
  assert.equal(streaming,true);assert.equal(active,"t");
}
console.log("PASS: actual App turn/started ignores finished history before changing running state");

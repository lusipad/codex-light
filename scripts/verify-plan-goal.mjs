import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText;
const load = async file => import(`data:text/javascript;base64,${Buffer.from(compile(fs.readFileSync(new URL(file, import.meta.url), "utf8"))).toString("base64")}`);
const { mergeTimelineItem, ThreadHistoryBuffer } = await load("../src/threadTimeline.ts");
const { NOTIFICATION } = await load("../src/protocol.ts");
const source = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

let goalUpdatedBranch, goalClearedBranch;
let planDeltaBranch, planUpdatedBranch, lifecycleBranch;

function visit(node) {
  if (ts.isIfStatement(node)) {
    const condition = node.expression.getText(ast);
    if (condition.includes("NOTIFICATION.THREAD_GOAL_UPDATED") || condition.includes('"thread/goal/updated"')) {
      goalUpdatedBranch = node.thenStatement.getText(ast);
    }
    if (condition.includes("NOTIFICATION.THREAD_GOAL_CLEARED") || condition.includes('"thread/goal/cleared"')) {
      goalClearedBranch = node.thenStatement.getText(ast);
    }
    if (condition.includes("NOTIFICATION.ITEM_PLAN_DELTA")) {
      planDeltaBranch = node.thenStatement.getText(ast);
    }
    if (condition.includes("NOTIFICATION.TURN_PLAN_UPDATED")) {
      planUpdatedBranch = node.thenStatement.getText(ast);
    }
    if (condition === 'method === "item/started" || method === "item/completed"') {
      lifecycleBranch = node.thenStatement.getText(ast);
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);

// 1. Goal 实时通知分支检查
assert.ok(goalUpdatedBranch, "App.tsx must handle NOTIFICATION.THREAD_GOAL_UPDATED");
assert.ok(goalClearedBranch, "App.tsx must handle NOTIFICATION.THREAD_GOAL_CLEARED");

// 2. Goal 状态机切换逻辑检查：blocked / usageLimited 必须能恢复为 active
let toggleGoalBody;
function findToggleGoal(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleToggleGoalPause") {
    toggleGoalBody = node.initializer?.getText(ast);
  }
  ts.forEachChild(node, findToggleGoal);
}
findToggleGoal(ast);
assert.ok(toggleGoalBody, "handleToggleGoalPause must be defined");
{
  const nextStatuses = [];
  const fakeContext = vm.createContext({
    useCallback: fn => fn,
    activeThreadIdRef: { current: "thread-1" },
    serverGoalRef: { current: null },
    goalSet: async (tid, patch) => { nextStatuses.push(patch.status); return patch; },
    showAppToast: () => {},
  });
  const toggleFn = vm.runInContext(compile(`(${toggleGoalBody})`), fakeContext);

  // 测试 paused -> active
  fakeContext.serverGoalRef.current = { status: "paused" };
  await toggleFn();

  // 测试 blocked -> active
  fakeContext.serverGoalRef.current = { status: "blocked" };
  await toggleFn();

  // 测试 usageLimited -> active
  fakeContext.serverGoalRef.current = { status: "usageLimited" };
  await toggleFn();

  assert.deepEqual(nextStatuses, ["active", "active", "active"], "paused, blocked, and usageLimited must resume to active");
}

// 3. Plan 流式增量与权威 completed 覆盖
{
  let turns = [{ id: "t", status: "inProgress", items: [] }];
  const context = vm.createContext({
    NOTIFICATION,
    mergeTimelineItem,
    setTurns: update => { turns = update(turns); }
  });
  const run = (body, method, params) => {
    context.method = method; context.params = params; context.eventTurnId = params.turnId;
    vm.runInContext(compile(`(()=>${body})()`), context);
  };

  run(planDeltaBranch, NOTIFICATION.ITEM_PLAN_DELTA, { turnId: "t", itemId: "p-1", delta: "初步" });
  run(planDeltaBranch, NOTIFICATION.ITEM_PLAN_DELTA, { turnId: "t", itemId: "p-1", delta: "计划" });
  assert.equal(turns[0].items.find(i => i.id === "p-1")?.text, "初步计划");

  // 权威快照覆盖旧流式文本
  run(lifecycleBranch, "item/completed", { turnId: "t", item: { id: "p-1", type: "plan", text: "最终权威计划：步骤1与步骤2" } });
  assert.equal(turns[0].items.find(i => i.id === "p-1")?.text, "最终权威计划：步骤1与步骤2");
}

// 4. Plan 历史回放与缓冲区抑制（threadTimeline.ts）
{
  const event = (method, params) => ({ method, params: { threadId: "a", turnId: "t", ...params } });
  const history = [
    {
      id: "t",
      items: [
        { id: "p-done", type: "plan", status: "completed", text: "历史权威计划" }
      ]
    }
  ];

  // 1) 已在历史中完成的 plan，缓冲中过时的 plan delta 必须被抑制
  const staleDelta = event(NOTIFICATION.ITEM_PLAN_DELTA, { itemId: "p-done", delta: "过时增量" });
  const buffer1 = new ThreadHistoryBuffer(); buffer1.begin(1, "a");
  buffer1.capture(staleDelta, 1);
  const replayed1 = buffer1.release(1, "a", history);
  assert.deepEqual(replayed1, [], "stale item/plan/delta for completed plan must be suppressed");

  // 2) 缓冲中有 item/completed 时抑制前面的 plan delta
  const activeDelta = event(NOTIFICATION.ITEM_PLAN_DELTA, { itemId: "p-new", delta: "中间增量" });
  const completePlan = event("item/completed", { item: { id: "p-new", type: "plan", status: "completed", text: "最终计划" } });
  const buffer2 = new ThreadHistoryBuffer(); buffer2.begin(1, "a");
  buffer2.capture(activeDelta, 1);
  buffer2.capture(completePlan, 1);
  const replayed2 = buffer2.release(1, "a", [{ id: "t", items: [] }]);
  assert.deepEqual(replayed2.map(e => e.method), ["item/completed"], "completed in buffer must suppress earlier plan deltas");

  // 3) 空 started 不能清空历史中已 hydrated 的 plan.text
  const startedPlan = event("item/started", { item: { id: "p-done", type: "plan", text: "" } });
  const buffer3 = new ThreadHistoryBuffer(); buffer3.begin(1, "a");
  buffer3.capture(startedPlan, 1);
  const replayed3 = buffer3.release(1, "a", history);
  assert.equal(replayed3[0].params.item.text, "历史权威计划", "empty started cannot erase hydrated plan text");
}

console.log("PASS all plan and goal parity expectations");

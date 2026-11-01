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

const React = {
  createElement: (type, props, ...children) => ({ type, props, children: children.flat() })
};

let fileChangeBranch, mcpProgressBranch, lifecycleBranch;
let fileChangeMapBody, mcpCallMapBody;

function visit(node) {
  if (ts.isIfStatement(node)) {
    const condition = node.expression.getText(ast);
    if (condition === "method === NOTIFICATION.ITEM_FILE_CHANGE_PATCH") {
      fileChangeBranch = node.thenStatement.getText(ast);
    }
    if (condition === "method === NOTIFICATION.ITEM_MCP_PROGRESS") {
      mcpProgressBranch = node.thenStatement.getText(ast);
    }
    if (condition === 'method === "item/started" || method === "item/completed"') {
      lifecycleBranch = node.thenStatement.getText(ast);
    }
  }
  if (ts.isCallExpression(node)) {
    const expr = node.expression.getText(ast);
    if (expr === "fileChanges.map" && node.arguments.length > 0) {
      fileChangeMapBody = node.arguments[0].getText(ast);
    }
    if (expr === "mcpCalls.map" && node.arguments.length > 0) {
      mcpCallMapBody = node.arguments[0].getText(ast);
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);

// 1. 检查 NOTIFICATION.ITEM_MCP_PROGRESS 通知分支
assert.ok(mcpProgressBranch, "App.tsx must handle NOTIFICATION.ITEM_MCP_PROGRESS");

// 2. 验证 fileChanges 渲染：kind 必须支持官方 schema 对象形式，且状态指示完整
assert.ok(fileChangeMapBody, "App.tsx must contain fileChanges.map");
{
  const fakeReactContext = vm.createContext({
    React,
    countDiffLines: () => ({ additions: 1, deletions: 1 }),
    DiffIcon: () => null,
    setSelectedPreviewFile: () => {},
    setShowRightDrawer: () => {},
  });
  const renderFc = vm.runInContext(compile(`(${fileChangeMapBody})`), fakeReactContext);

  // 检查 inProgress 与 kind 对象
  const sampleFc = {
    id: "fc-1",
    status: "inProgress",
    changes: [
      {
        path: "src/sample.ts",
        kind: { type: "update", move_path: null },
        diff: "+add\n-del"
      }
    ]
  };
  const jsxResult = renderFc(sampleFc, 0);
  const renderedStr = JSON.stringify(jsxResult);
  assert.ok(!renderedStr.includes("[object Object]"), "fileChange kind must not render as [object Object]");
  assert.ok(renderedStr.includes("update") || renderedStr.includes("修改"), "fileChange kind must show valid kind label");
  assert.ok(renderedStr.includes("修改中") || renderedStr.includes("调用中") || renderedStr.includes("运行中") || renderedStr.includes("inProgress"), "fileChange card must display inProgress status");

  // 检查 failed 和 declined 终态
  for (const [status, label] of [["failed", "失败"], ["declined", "已拒绝"]]) {
    const res = renderFc({ id: "fc-2", status, changes: [{ path: "f.ts", kind: "delete", diff: "-del" }] }, 0);
    const s = JSON.stringify(res);
    assert.ok(s.includes(label), `fileChange card must display ${label} for status ${status}`);
  }
}

// 3. 验证 mcpCalls 渲染：error 支持官方 schema 对象形式，result 提取文本，progress 进度展示
assert.ok(mcpCallMapBody, "App.tsx must contain mcpCalls.map");
{
  const fakeReactContext = vm.createContext({
    React,
    SparklesIcon: () => null,
  });
  const renderMcp = vm.runInContext(compile(`(${mcpCallMapBody})`), fakeReactContext);

  // 错误对象
  const failedMcp = {
    id: "mcp-1",
    server: "filesystem",
    tool: "read_file",
    status: "failed",
    error: { message: "Permission denied for read_file" }
  };
  const resFailed = renderMcp(failedMcp, 0);
  const strFailed = JSON.stringify(resFailed);
  assert.ok(!strFailed.includes("[object Object]"), "mcpCall error must not render as [object Object]");
  assert.ok(strFailed.includes("Permission denied for read_file"), "mcpCall error must display the error message");

  // 结果对象 content 提取
  const successMcp = {
    id: "mcp-2",
    server: "github",
    tool: "create_issue",
    status: "completed",
    result: {
      content: [{ type: "text", text: "Created issue #42" }]
    }
  };
  const resSuccess = renderMcp(successMcp, 0);
  const strSuccess = JSON.stringify(resSuccess);
  assert.ok(strSuccess.includes("Created issue #42"), "mcpCall result must extract and display text content");

  // 进行中进度消息
  const inProgressMcp = {
    id: "mcp-3",
    server: "db",
    tool: "query",
    status: "inProgress",
    progressMessage: "正在检索行数据..."
  };
  const resProgress = renderMcp(inProgressMcp, 0);
  const strProgress = JSON.stringify(resProgress);
  assert.ok(strProgress.includes("正在检索行数据..."), "mcpCall must display progress message when inProgress");
}

// 4. 验证通知处理分支行为（通过 AST 执行）
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

  // 测试 ITEM_MCP_PROGRESS 更新 progressMessage
  run(mcpProgressBranch, NOTIFICATION.ITEM_MCP_PROGRESS, { turnId: "t", itemId: "mcp-p", message: "读取文件中..." });
  assert.equal(turns[0].items.find(i => i.id === "mcp-p")?.progressMessage, "读取文件中...");

  // 测试 item/completed 清除 progressMessage 并设定终态
  run(lifecycleBranch, "item/completed", { turnId: "t", item: { id: "mcp-p", type: "mcpToolCall", server: "fs", tool: "read", status: "completed" } });
  const completedMcp = turns[0].items.find(i => i.id === "mcp-p");
  assert.equal(completedMcp?.progressMessage, undefined, "completed mcpToolCall must clear progressMessage");
  assert.equal(completedMcp?.status, "completed");
}

// 5. 验证历史回放与缓冲区抑制（threadTimeline.ts）
{
  const event = (method, params) => ({ method, params: { threadId: "a", turnId: "t", ...params } });
  const history = [
    {
      id: "t",
      items: [
        { id: "fc-c", type: "fileChange", status: "completed", changes: [{ path: "a.ts", kind: "add", diff: "+1" }] },
        { id: "mcp-c", type: "mcpToolCall", status: "completed", server: "fs", tool: "read", result: { content: [{ type: "text", text: "历史结果" }] } }
      ]
    }
  ];

  // 1) 已在历史中完成的项，缓冲中的过时 patchUpdated 和 progress 必须被抑制
  const stalePatch = event(NOTIFICATION.ITEM_FILE_CHANGE_PATCH, { itemId: "fc-c", changes: [] });
  const staleProgress = event(NOTIFICATION.ITEM_MCP_PROGRESS, { itemId: "mcp-c", message: "过时进度" });
  const buffer1 = new ThreadHistoryBuffer(); buffer1.begin(1, "a");
  buffer1.capture(stalePatch, 1);
  buffer1.capture(staleProgress, 1);
  const replayed1 = buffer1.release(1, "a", history);
  assert.deepEqual(replayed1, [], "stale patchUpdated and progress for completed items must be suppressed");

  // 2) 缓冲区自身有 item/completed 时，同样抑制其前面的 patchUpdated 和 progress
  const activePatch = event(NOTIFICATION.ITEM_FILE_CHANGE_PATCH, { itemId: "fc-new", changes: [{ path: "b.ts", kind: "update", diff: "+2" }] });
  const completePatch = event("item/completed", { item: { id: "fc-new", type: "fileChange", status: "completed", changes: [] } });
  const buffer2 = new ThreadHistoryBuffer(); buffer2.begin(1, "a");
  buffer2.capture(activePatch, 1);
  buffer2.capture(completePatch, 1);
  const replayed2 = buffer2.release(1, "a", [{ id: "t", items: [] }]);
  assert.deepEqual(replayed2.map(e => e.method), ["item/completed"], "completed in buffer must suppress earlier patch updates");

  // 3) 空 started 不能清空历史中已 hydrated 的 changes 和 result
  const startedFc = event("item/started", { item: { id: "fc-c", type: "fileChange", changes: [] } });
  const startedMcp = event("item/started", { item: { id: "mcp-c", type: "mcpToolCall", result: null } });
  const buffer3 = new ThreadHistoryBuffer(); buffer3.begin(1, "a");
  buffer3.capture(startedFc, 1);
  buffer3.capture(startedMcp, 1);
  const replayed3 = buffer3.release(1, "a", history);
  assert.deepEqual(replayed3[0].params.item.changes, history[0].items[0].changes, "empty started cannot erase hydrated fileChange changes");
  assert.deepEqual(replayed3[1].params.item.result, history[0].items[1].result, "empty started cannot erase hydrated mcp result");
}

console.log("PASS all tool cards and execution item parity expectations");

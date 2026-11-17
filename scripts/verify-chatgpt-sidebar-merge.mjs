import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const api = {}; modules.set(file, api);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(`src/${file}.ts`, "utf8"), {
    fileName: `${file}.ts`, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: api, require: name => {
    if (name === "./chatgptConversationHistory") return load("chatgptConversationHistory");
    throw Error(`Unexpected pure merge dependency ${name}`);
  } }); return api;
}
const api = load("chatgptSidebarConversations"), historyApi = load("chatgptConversationHistory");
const merge = (memory, items) => JSON.parse(JSON.stringify(api.mergeChatgptSidebarConversations(memory, items)));
const local = (clientId, serverId, title, pending = false, extra = {}) => ({ clientId, serverId, title, pending,
  projectId: null, isTemporaryChat: false, messages: [], ...extra });
const server = (id, title, extra = {}) => ({ id, title, raw: {}, updatedAt: null, preview: null, gizmoId: null, ...extra });

{
  const memory = [local("local-chatgpt:unlisted", null, "新本地", true), local("local-chatgpt:bound", "server-a", "旧标题", true),
    local("server-b", "server-b", "缓存旧名"), local("local-chatgpt:background", "server-not-in-page", "未列出服务聊天")];
  const items = [server("server-b", "远端重命名 B", { updatedAt: 1 }), server("server-a", "远端重命名 A", { updatedAt: 999 })];
  const rows = merge(memory, items);
  assert.deepEqual(rows.map(row => row.id), ["local-chatgpt:unlisted", "local-chatgpt:background", "server-b", "server-a"]);
  assert.deepEqual(rows.map(row => row.title), ["新本地", "未列出服务聊天", "远端重命名 B", "远端重命名 A"]);
  assert.equal(rows[3].pending, true); assert.equal(rows[3].serverId, "server-a"); assert.equal(rows[1].serverId, "server-not-in-page");
  console.log("PASS unlisted local first, real server order/title wins, client/server identities stay distinct");
}
{
  const items = [server("same-title-a", "相同标题"), server("same-title-b", "相同标题"), server("same-title-a", "后重复")];
  const rows = merge([local("local-a", null, "相同标题"), local("local-a", null, "本地重复")], items);
  assert.deepEqual(rows.map(row => row.id), ["local-a", "same-title-a", "same-title-b"]);
  assert.deepEqual(rows.map(row => row.title), ["相同标题", "相同标题", "相同标题"]);
  assert.equal(merge([local("client-a", "one-service", "首次"), local("client-b", "one-service", "重复绑定")], []).length, 1);
  console.log("PASS dedupe by actual IDs preserves equal titles and first server occurrence");
}
{
  const memory = [local("temporary-local", "temporary-service", "临时", true, { isTemporaryChat: true }),
    local("listed-client", "listed", "本地旧名", false)];
  const rows = merge(memory, [server("listed", "服务名", { raw: { status: "running", pending: true } }), server("unknown-state", "未知状态", { raw: { status: "in_progress" } })]);
  assert.deepEqual(rows.map(row => row.id), ["listed", "unknown-state"]); assert.ok(rows.every(row => row.pending === false));
  console.log("PASS temporary memory excluded and unknown list statuses never manufacture pending activity");
}
{
  const memory = [local("client-project", null, null, false, { projectId: "g-p/local", messages: [
    { id: "assistant", raw: { author: { role: "assistant" } }, text: "非用户标题" },
    { id: "user", raw: { author: { role: "user" } }, text: "用户原始草稿" },
  ] })];
  const items = [server("server-project", "实际服务标题", { gizmoId: "g-p/server" })], before = JSON.stringify({ memory, items });
  const rows = merge(memory, items); assert.equal(rows[0].title, "用户原始草稿"); assert.equal(rows[0].gizmoId, "g-p/local"); assert.equal(rows[1].gizmoId, "g-p/server");
  assert.equal(JSON.stringify({ memory, items }), before); assert.deepEqual(merge([], []), []);
  assert.equal("updatedAt" in rows[0], false); assert.equal("hasMore" in rows, false);
  console.log("PASS actual gizmo routes/user title fallback retained, immutable inputs and no invented time/paging");
}
{
  const history = (status, raw = null, origin = null) => historyApi.decodeChatgptConversationHistory({
    mapping: raw ? { current: { parent: null, message: raw } } : {}, current_node: raw ? "current" : null,
    async_status: status, conversation_origin: origin,
  });
  const assistant = { id: "real-message", author: { role: "assistant" }, content: { content_type: "text", parts: ["partial"] },
    metadata: { async_source: "actual-background-source" }, channel: "final", status: "in_progress" };
  for (const [value, expected] of [
    [history(6), true], [history(7), true], [history(3, assistant), true],
    [history(3, { ...assistant, status: "finished_successfully" }), false],
    [history(3, { ...assistant, metadata: {} }), false],
    [history("6"), false], [history(99), false], [history(6, null, "tpp"), false],
  ]) {
    const memory = [local("remote-client", "remote-server", "真实历史", false, { history: value })];
    assert.equal(merge(memory, [])[0].pending, expected, "unlisted local preserves actual history activity");
    assert.equal(merge(memory, [server("remote-server", "服务标题")])[0].pending, expected, "serverlisted preserves same actual history activity");
  }
  assert.equal(merge([local("explicit-pending", null, "当前流", true, { history: history(4) })], [])[0].pending, true);
  console.log("PASS actual getChatgptHistoryActivity bridges statuses6/7 and conditional3 to both local and serverlisted rows");
}
console.log("ChatGPT sidebar merge: 5 pure production groups passed; no HTTP/CLI/GUI");

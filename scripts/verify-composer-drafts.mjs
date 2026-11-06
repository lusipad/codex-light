import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { mountProjectContext } from "./verify-new-thread-project-context.mjs";
import { mountProjectNavigation } from "./verify-sidebar-project-selection.mjs";

const ast = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node)) declarations.set(node.name.getText(ast), node.initializer);
  ts.forEachChild(node, visit);
}
visit(ast);
const compile = text => ts.transpileModule(`(${text})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const evaluate = (name, context, callback = false) => {
  const value = declarations.get(name);
  assert.ok(value, `production ${name} must exist`);
  return vm.runInNewContext(compile((callback ? value.arguments[0] : value).getText(ast)), context);
};
const plain = value => JSON.parse(JSON.stringify(value));
function mount(serialized = null, utility = false) {
  const storageKey = evaluate("promptStorageKey", { isQuickChatWindow: utility, threadWindowId: null });
  const disk = new Map(serialized === null ? [] : [[storageKey, serialized]]);
  const context = {
    localStorage: { getItem: key => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value) },
    console: { warn() {} }, activeThreadId: null, promptStorageKey: storageKey, homePromptRevisionRef: { current: 0 },
  };
  const state = declarations.get("[promptDrafts, setPromptDrafts]");
  assert.ok(state, "prompt drafts must have separate persisted identities instead of one global input");
  context.promptDrafts = vm.runInNewContext(compile(state.arguments[0].getText(ast)), context)();
  context.setPromptDrafts = update => { context.promptDrafts = update(context.promptDrafts); };
  context.setThreadPrompt = evaluate("setThreadPrompt", context, true);
  const move = evaluate("moveHomePromptToThread", context, true);
  return {
    context, disk, move,
    select(id) { context.activeThreadId = id; },
    get prompt() {
      const key = evaluate("promptDraftKey", context);
      return evaluate("promptInput", { ...context, promptDraftKey: key });
    },
    edit(value) { evaluate("setPromptInput", { ...context }, true)(value); },
    read(id) { return context.promptDrafts[id === null ? "home" : `thread:${id}`] ?? ""; },
  };
}

{
  const view = mount();
  view.edit("首页H");
  view.select("a"); assert.equal(view.prompt, "");
  view.edit("会话A");
  view.select("b"); assert.equal(view.prompt, "");
  view.edit(text => `${text}会话B`);
  view.select("a"); assert.equal(view.prompt, "会话A");
  view.select(null); assert.equal(view.prompt, "首页H");
  view.select(null); assert.equal(view.prompt, "首页H", "repeated ordinary new-chat preserves home draft");
  view.edit("");
  assert.equal(Object.hasOwn(view.context.promptDrafts, "home"), false);
  assert.equal(view.read("a"), "会话A");
  assert.equal(view.read("b"), "会话B");
}
for (const content of ["not-json", "null", "[]", '{"home":17,"thread:a":"saved","other":"ignore"}']) {
  const view = mount(content);
  assert.equal(view.prompt, "");
  assert.equal(view.read("a"), content.includes("saved") ? "saved" : "");
  assert.equal(Object.hasOwn(view.context.promptDrafts, "other"), false);
}
{
  const view = mount('{"home":"恢复H","thread:a":"恢复A"}');
  assert.equal(view.prompt, "恢复H");
  view.select("a"); assert.equal(view.prompt, "恢复A");
  const capturedSetter = evaluate("setPromptInput", { ...view.context }, true);
  view.select("b"); view.edit("B新输入");
  capturedSetter("");
  assert.equal(view.prompt, "B新输入", "an old callback can only update its captured identity");
}
{
  const view = mount();
  view.edit("首次发送");
  view.move("created");
  view.select("created");
  assert.equal(view.prompt, "首次发送", "turn/start failure retains text on the created thread");
  assert.equal(view.read(null), "", "home text moves once, rather than reappearing as another new message");
  view.edit("发送中继续输入");
  view.context.setThreadPrompt("created", value => value === "首次发送" ? "" : value);
  assert.equal(view.prompt, "发送中继续输入");
  view.context.setThreadPrompt("created", value => value === "发送中继续输入" ? "" : value);
  assert.equal(view.prompt, "");
}

// Execute the real persistence effect, not a test-only serialization of the map.
let persistenceEffect;
function findEffect(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes('localStorage.setItem(promptStorageKey,')) {
    persistenceEffect = node.arguments[0].getText(ast);
  }
  ts.forEachChild(node, findEffect);
}
findEffect(ast);
assert.ok(persistenceEffect);
{
  const view = mount(); view.edit("持久化H"); view.select("a"); view.edit("持久化A");
  vm.runInNewContext(compile(persistenceEffect), { ...view.context, showAppToast() {} })();
  const restarted = mount(view.disk.get("codex_composer_prompt_drafts_v1"));
  assert.equal(restarted.prompt, "持久化H");
  restarted.select("a"); assert.equal(restarted.prompt, "持久化A");
}
assert.deepEqual(plain(mount().context.promptDrafts), {});
{
  const main = mount('{"home":"main draft"}');
  const utility = mount('{"home":"utility draft"}', true);
  assert.notEqual(main.context.promptStorageKey, utility.context.promptStorageKey);
  vm.runInNewContext(compile(persistenceEffect), { ...utility.context, localStorage: main.context.localStorage, showAppToast() {} })();
  assert.equal(JSON.parse(main.disk.get(main.context.promptStorageKey)).home, "main draft");
  assert.equal(JSON.parse(main.disk.get(utility.context.promptStorageKey)).home, "utility draft");
}
console.log("PASS production draft state/setters/effect: home and thread isolation, functional edits, corrupt storage, restart, late callbacks and created-thread handoff (L2)");

for (const scenario of ["success", "failure", "edited", "left"]) {
  const draft = mount(); draft.edit("hello");
  const view = mountProjectContext({
    turn: async () => {
      if (scenario === "failure") throw Error("fixture turn/start denied");
      if (scenario === "edited") draft.context.setThreadPrompt("created", "新编辑");
      if (scenario === "left") {
        view.context.threadRequestRef.current++;
        view.context.activeThreadIdRef.current = "other";
        draft.select("other"); draft.edit("其他会话");
      }
      return { turn: { id: "accepted" } };
    },
  });
  Object.assign(view.context, {
    moveHomePromptToThread: draft.move,
    moveHomeAttachmentsToThread() {},
    attachmentScopeRef: { current: "home" },
    setThreadPrompt: draft.context.setThreadPrompt,
  });
  await view.send();
  assert.equal(draft.read(null), "");
  assert.equal(draft.read("created"), scenario === "success" ? "" : scenario === "edited" ? "新编辑" : "hello");
  if (scenario === "left") assert.equal(draft.read("other"), "其他会话");
  assert.equal(view.calls.filter(call => call[0] === "thread/start").length, 1);
  assert.equal(view.calls.filter(call => call[0] === "turn/start").length, 1);
}
{
  const draft = mount(); draft.select("a"); draft.edit("已发送");
  draft.select("b"); draft.edit("B草稿");
  let clearedFiles = false;
  const pending = { threadId: "a", clearComposer: true, prompt: "已发送", files: [{ id: "A-file" }] };
  const newFile = { id: "A-new-file" };
  let originalThreadFiles = [...pending.files, newFile];
  const flush = evaluate("flushPendingAttachmentSave", {
    pendingAttachmentSaveRef: { current: pending },
    attachedFilesRef: { current: [{ id: "B-file" }] },
    activeThreadIdRef: { current: "b" },
    setThreadPrompt: draft.context.setThreadPrompt,
    persistThreadAttachments: async (id, files) => {
      assert.equal(id, "a");
      assert.deepEqual(plain(files), [{ id: "A-file" }], "only the sent thread attachment snapshot may be persisted");
      return { errors: [] };
    },
    setAttachedFiles: () => { clearedFiles = true; },
    setScopedAttachedFiles: (scope, update) => {
      assert.equal(scope, "thread:a", "late save cleans only its original thread scope");
      originalThreadFiles = update(originalThreadFiles);
    },
    showAppToast() {},
  }, true);
  await flush("a");
  assert.equal(draft.read("a"), "");
  assert.equal(draft.prompt, "B草稿");
  assert.equal(clearedFiles, false, "late attachment persistence must not clear the current thread attachments");
  assert.deepEqual(originalThreadFiles, [newFile], "late save preserves new attachments on its original thread");
}
console.log("PASS real send/attachment callbacks with draft store: handoff, failure, edited input, late navigation and foreign-thread attachment isolation (L2)");

{
  const draft = mount(); draft.edit("首页H"); draft.select("old"); draft.edit("旧会话");
  const view = mountProjectNavigation();
  const setId = view.context.setActiveThreadId;
  view.context.setActiveThreadId = id => { setId(id); draft.select(id); };
  await view.start();
  assert.equal(draft.prompt, "首页H", "actual ordinary new-chat callback restores home identity");
  assert.equal(draft.read("old"), "旧会话");
  await view.start();
  assert.equal(draft.prompt, "首页H");
  assert.ok(view.calls.some(call => call[0] === "setComposerFocusRequest"));
}
{
  const draft = mount(); draft.edit("首页H"); draft.select("old"); draft.edit("旧会话");
  const view = mountProjectNavigation({ select: async () => { throw Error("project selection denied"); } });
  view.context.setActiveThreadId = id => draft.select(id);
  await view.start("D:/one", { id: "multi", serverProjectId: "server-multi", rootPaths: ["D:/one", "D:/two"] });
  assert.equal(draft.prompt, "旧会话", "failed project navigation must not switch draft scope");
}
for (const name of ["onStartSkillCreatorSession"]) {
  let handler;
  function find(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === name) handler = node.initializer.expression.getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast); assert.ok(handler, name);
  const draft = mount(); draft.select("old"); draft.edit("旧会话");
  const action = vm.runInNewContext(compile(handler), {
    setThreadPrompt: draft.context.setThreadPrompt, startNewThread() {}, showAppToast() {},
  });
  action("预填");
  assert.match(draft.read(null), /预填/);
  assert.equal(draft.read("old"), "旧会话");
}
console.log("PASS production ordinary new-chat, failed navigation and existing cross-page prefill callbacks preserve draft ownership (L2)");

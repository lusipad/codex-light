import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { mount } from "./verify-sidebar-projects.mjs";

const { outputText } = ts.transpileModule(fs.readFileSync("src/cloudRecentChats.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const identity = { accountId: "a", userId: "u", generation: 1 };
const env = { environmentId: "env", environmentConfigId: "asenvcfg_saved" };
const thread = { id: "same-id", name: "云端对话", updatedAt: 120, environments: [env] };
const binding = { ...identity, configId: env.environmentConfigId, environmentId: env.environmentId,
  draftId: null, name: "Saved", repositoryNamesById: {}, conversation: true };
const known = new Map([["known", binding], ["draft", { ...binding, conversation: undefined, draftId: "draft-id" }],
  ["conflict", binding]]);
const pages = [
  { data: [
    thread, { ...thread, id: "archived", archived: true }, { ...thread, id: "temp", ephemeral: true },
    { ...thread, id: "side", sideConversation: true }, { ...thread, id: "child", parentThreadId: "parent" },
    { ...thread, id: "draft" }, { ...thread, id: "no-env", environments: [] },
    { ...thread, id: "many", environments: [env, env] },
    { ...thread, id: "invalid-config", environments: [{ ...env, environmentConfigId: "asenvcfg_bad\n" }] },
    { ...thread, id: "conflict", environments: [{ ...env, environmentConfigId: "asenvcfg_other" }] },
  ], nextCursor: "next" },
  { data: [{ ...thread, name: "duplicate" }, { id: "known", preview: "之前的聊天", recencyAt: 150 }], nextCursor: null },
];

function fixture(readPage, current = identity, mutate = () => assert.fail("unexpected mutation"), archived = false) {
  const exports = {};
  const cursors = [];
  vm.runInNewContext(outputText, { exports, require(name) {
    if (name === "./chatgptService") return {
      async serviceIdentity() { return current; },
      async callCloudThread(operation, actual) {
        assert.equal(actual, identity);
        if (operation.kind !== "list") return mutate(operation);
        assert.equal(operation.archived, archived || undefined);
        cursors.push(operation.cursor);
        return readPage(operation.cursor);
      },
    };
    if (name === "./cloudDraftBindings") return {
      readCloudDraftBinding(id, actual) { assert.equal(actual, identity); return known.get(id); },
    };
    assert.fail(name);
  } });
  return { read: signal => exports.readCloudRecentChats(identity, signal, archived), action: exports.applyCloudRecentAction, cursors };
}

const signal = new AbortController().signal;
const catalog = fixture(cursor => pages[cursor === null ? 0 : 1]);
const chats = await catalog.read(signal);
assert.deepEqual(catalog.cursors, [null, "next"]);
assert.equal(JSON.stringify(chats.map(chat => [chat.session.threadId, chat.title, chat.recency])),
  JSON.stringify([["known", "之前的聊天", 150], ["same-id", "云端对话", 120]]));
assert.equal(chats[0].session.binding.name, "Saved");
assert.equal(chats[1].session.binding.configId, env.environmentConfigId);
assert.equal(chats[1].session.binding.conversation, true);
const archivedCatalog = fixture(cursor => cursor === null
  ? { data: [{ ...thread, archived: true }, { ...thread, id: "active", archived: false }], nextCursor: "archives-2" }
  : { data: [{ ...thread, id: "another-archive" }], nextCursor: null }, identity, undefined, true);
assert.equal(JSON.stringify((await archivedCatalog.read(signal)).map(chat => chat.session.threadId)),
  '["same-id","another-archive"]');
assert.deepEqual(archivedCatalog.cursors, [null, "archives-2"]);
await assert.rejects(fixture(() => pages[0]).read(signal), /重复游标/);
await assert.rejects(fixture(() => pages[1], { ...identity, generation: 2 }).read(signal), /账号/);
const abort = new AbortController();
await assert.rejects(fixture(() => { abort.abort(); return pages[0]; }).read(abort.signal), { name: "AbortError" });

const picked = [];
const actions = [];
const all = node => node && typeof node === "object" ? [node, ...node.children.flatMap(all)] : [];
const sidebar = mount({
  workspaces: [],
  threads: [{ id: "same-id", name: "本地对话", cwd: "", updatedAt: 140 }],
  activeRoute: "cloud-draft",
  activeThreadId: "same-id",
  activeCloudThreadId: "same-id",
  cloudRecentChats: chats,
  onSelectCloudChat: chat => picked.push(chat.session.threadId),
  onCloudRecentAction: (chat, action) => actions.push([chat.session.threadId, action.kind, action.name]),
});
const rows = all(sidebar.render()).filter(node => node.props["data-thread-id"] || node.props["data-chat-host"] === "durable");
assert.equal(rows.length, 3);
assert.deepEqual(rows.map(row => row.props["data-chat-host"] ?? row.props["data-thread-id"]),
  ["durable", "same-id", "durable"]);
assert.equal(rows[1].props["aria-current"], undefined);
const cloudButton = rows[2].children.find(node => node.type === "button");
assert.equal(cloudButton.props["aria-current"], "page");
cloudButton.props.onClick();
assert.deepEqual(picked, ["same-id"]);
const menu = all(rows[2]).find(node => node.type === "ThreadActionsMenu");
menu.props.onSelect("rename");
let dialog = all(sidebar.render()).find(node => node.type === "RenameThreadDialog");
assert.equal(dialog.props.initialValue, "云端对话");
dialog.props.onClose();
assert.deepEqual(actions, []);
menu.props.onSelect("rename");
dialog = all(sidebar.render()).find(node => node.type === "RenameThreadDialog");
dialog.props.onSave("新云端名称");
menu.props.onSelect("archive");
assert.deepEqual(actions, [["same-id", "rename", "新云端名称"], ["same-id", "archive", undefined]]);
assert.deepEqual(picked, ["same-id"]);
sidebar.props.cloudRecentChats = [];
assert.ok(!all(sidebar.render()).some(node => node.type === "RenameThreadDialog"));
sidebar.props.cloudRecentChats = chats;
sidebar.props.activityOnly = true;
assert.ok(!all(sidebar.render()).some(node => node.props["data-chat-host"] === "durable"));

const wire = [];
let readName = "新云端名称";
let failedArchive = false;
const calls = fixture(() => assert.fail("unexpected list"), identity, operation => {
  wire.push(JSON.stringify(operation));
  if (operation.kind === "read") return { thread: { id: "same-id", name: readName } };
  if (operation.kind === "archive" && failedArchive) throw Error("lost archive response");
  return {};
});
assert.equal(await calls.action(chats[1], { kind: "rename", name: " " }, signal), false);
assert.equal(await calls.action(chats[1], { kind: "rename", name: "云端对话 " }, signal), false);
assert.equal(wire.length, 0);
assert.equal(await calls.action(chats[1], { kind: "rename", name: " 新云端名称 " }, signal), true);
assert.equal(await calls.action(chats[1], { kind: "archive" }, signal), true);
assert.equal(await calls.action(chats[1], { kind: "unarchive" }, signal), true);
assert.deepEqual(wire.map(value => JSON.parse(value)), [
  { kind: "title", threadId: "same-id", name: "新云端名称" },
  { kind: "read", threadId: "same-id" },
  { kind: "archive", threadId: "same-id", archived: true },
  { kind: "archive", threadId: "same-id", archived: false },
]);
readName = "旧标题";
await assert.rejects(calls.action(chats[1], { kind: "rename", name: "待确认" }, signal), /尚未确认/);
failedArchive = true;
const previousCalls = wire.length;
await assert.rejects(calls.action(chats[1], { kind: "archive" }, signal), /lost archive response/);
assert.equal(wire.length, previousCalls + 1);
await assert.rejects(calls.action(chats[1], { kind: "archive" }, abort.signal), { name: "AbortError" });
assert.equal(wire.length, previousCalls + 1);

console.log("PASS cloud recent chats: scoped pagination and host routing, rename dialog and verified readback, archive, undo, cancellation and no replay");

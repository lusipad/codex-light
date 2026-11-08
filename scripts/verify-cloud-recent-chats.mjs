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

function fixture(readPage, current = identity) {
  const exports = {};
  const cursors = [];
  vm.runInNewContext(outputText, { exports, require(name) {
    if (name === "./chatgptService") return {
      async serviceIdentity() { return current; },
      async callCloudThread(operation, actual) {
        assert.equal(operation.kind, "list");
        assert.equal(actual, identity);
        cursors.push(operation.cursor);
        return readPage(operation.cursor);
      },
    };
    if (name === "./cloudDraftBindings") return {
      readCloudDraftBinding(id, actual) { assert.equal(actual, identity); return known.get(id); },
    };
    assert.fail(name);
  } });
  return { read: signal => exports.readCloudRecentChats(identity, signal), cursors };
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
await assert.rejects(fixture(() => pages[0]).read(signal), /重复游标/);
await assert.rejects(fixture(() => pages[1], { ...identity, generation: 2 }).read(signal), /账号/);
const abort = new AbortController();
await assert.rejects(fixture(() => { abort.abort(); return pages[0]; }).read(abort.signal), { name: "AbortError" });

const picked = [];
const all = node => node && typeof node === "object" ? [node, ...node.children.flatMap(all)] : [];
const sidebar = mount({
  workspaces: [],
  threads: [{ id: "same-id", name: "本地对话", cwd: "", updatedAt: 140 }],
  activeRoute: "cloud-draft",
  activeThreadId: "same-id",
  activeCloudThreadId: "same-id",
  cloudRecentChats: chats,
  onSelectCloudChat: chat => picked.push(chat.session.threadId),
});
const rows = all(sidebar.render()).filter(node => node.props["data-thread-id"] || node.props["data-chat-host"] === "durable");
assert.equal(rows.length, 3);
assert.deepEqual(rows.map(row => row.props["data-chat-host"] ?? row.props["data-thread-id"]),
  ["durable", "same-id", "durable"]);
assert.equal(rows[1].props["aria-current"], undefined);
assert.equal(rows[2].props["aria-current"], "page");
rows[2].props.onClick();
assert.deepEqual(picked, ["same-id"]);
assert.ok(!rows[2].props.onContextMenu);
sidebar.props.activityOnly = true;
assert.ok(!all(sidebar.render()).some(node => node.props["data-chat-host"] === "durable"));

console.log("PASS cloud recent chats: authenticated pagination, visibility, account changes, cancellation, separate host routing and recent row order");

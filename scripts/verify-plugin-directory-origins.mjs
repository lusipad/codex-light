import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const entries = {}, accounts = {};
vm.runInNewContext(compile("src/pluginDirectoryEntries.ts"), { exports: entries });
vm.runInNewContext(compile("src/serviceAccounts.ts"), { exports: accounts });
const identity = { accountId: "actual", userId: "user", generation: 1 };
const row = (id, extra = {}) => ({ id, name: id, release: { display_name: id, interface: {} }, ...extra });
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(options = {}) {
  const api = {}, calls = [], controller = new AbortController();
  let generation = 1, accountReads = 0;
  const ready = { kind: "ready", identity, structure: options.structure ?? "workspace", name: "Workspace" };
  vm.runInNewContext(compile("src/pluginDirectoryOrigins.ts"), { exports: api, require: name => {
    if (name === "./pluginDirectoryEntries") return entries;
    if (name === "./serviceAccounts") return accounts;
    if (name === "./config") return { accountRead: async () => {
      calls.push("account"); accountReads++;
      if (options.abortAccount) controller.abort();
      return { account: { type: options.auth ?? "chatgpt", email: "not-a-structure-proof" },
        workspaceRouting: { chatgptAccountId: accountReads > 1 && options.routingChanged ? "foreign" : "actual" } };
    } };
    return {
      serviceIdentity: async () => { calls.push("identity"); return { ...identity, generation }; },
      readChatgptService: async (...args) => {
        calls.push(["accounts", ...args]);
        if (options.abortMap) controller.abort();
        if (options.changeMap) generation++;
        return options.map ?? { account_ordering: ["other", "actual"], accounts: {
          other: { account: { structure: "personal" } },
          actual: { account: { account_id: "actual", account_user_id: "user", account_user_role: "member", plan_type: "team",
            is_zdr: false, structure: ready.structure, name: "  Actual Name  ", is_deactivated: options.deactivated },
            can_access_with_session: options.canAccess },
        } };
      },
      readRemotePluginDirectoryList: async (id, kind, limit, cursor, signal) => {
        calls.push(["list", id, kind, limit, cursor, signal]);
        if (options.abortList) controller.abort();
        if (options.changeList) generation++;
        if (options.failKind === kind) throw Error("403 denied");
        return options.page?.(kind, cursor) ?? { plugins: [row(kind)], nextCursor: options.next ?? null };
      },
    };
  } });
  return { api, calls, controller, ready, signal: controller.signal, lists: () => calls.filter(call => Array.isArray(call) && call[0] === "list") };
}
{
  const h = fixture(), result = await h.api.loadPluginDirectoryAccount(h.signal);
  assert.equal(result.structure, "workspace"); assert.equal(result.name, "Actual Name");
  const request = h.calls.find(call => Array.isArray(call));
  assert.equal(request[1], "share_accounts"); assert.deepEqual(plain(request[2]), {}); assert.equal(request[3].accountId, "actual");
}
{
  const h = fixture({ auth: "apiKey" });
  assert.equal((await h.api.loadPluginDirectoryAccount(h.signal)).kind, "unauthenticated");
  assert.deepEqual(h.calls, ["account"]);
}
for (const options of [{ deactivated: true }, { canAccess: false }, { changeMap: true }, { routingChanged: true },
  { map: { accounts: {}, account_ordering: ["actual"] } }, { abortAccount: true }, { abortMap: true }]) {
  const h = fixture(options); await assert.rejects(h.api.loadPluginDirectoryAccount(h.signal));
  if (options.abortMap) assert.equal(h.calls.at(-1)[0], "accounts", "cancelled account read performs no later identity reads");
}
for (const kind of ["workspace", "shared", "personal", "created"]) {
  const h = fixture({ next: "server-summary-token" });
  const page = await h.api.readPluginDirectoryOriginPage(h.ready, kind, null, h.signal);
  assert.equal(h.lists()[0][3], ["personal", "created"].includes(kind) ? 9 : 50);
  assert.equal(page.nextCursor, ["personal", "created"].includes(kind) ? null : "server-summary-token");
  assert.equal(page.entries[0].rawId, kind);
  if (["personal", "created"].includes(kind)) {
    await assert.rejects(h.api.readPluginDirectoryOriginPage(h.ready, kind, "not-a-summary-cursor", h.signal));
    assert.equal(h.lists().length, 1);
  }
}
{
  const h = fixture({ page: (kind, cursor) => ({ plugins: [row(kind)], nextCursor: kind === "personal" && cursor === null ? "user-next" : null }) });
  const first = await h.api.readPluginDirectoryCreatedPage(h.ready, null, h.signal);
  assert.deepEqual(first.entries.map(entry => entry.rawId).join(","), "created,personal");
  assert.deepEqual(plain(first.nextCursor), { userPageToken: "user-next", workspaceCreatedPageToken: null });
  const second = await h.api.readPluginDirectoryCreatedPage(h.ready, first.nextCursor, h.signal);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(h.lists().map(call => [call[2], call[3], call[4]]), [["created", 50, null], ["personal", 50, null], ["personal", 50, "user-next"]]);
}
{
  const h = fixture({ structure: "personal" });
  await h.api.readPluginDirectoryCreatedPage(h.ready, null, h.signal);
  assert.deepEqual(h.lists().map(call => call[2]), ["personal"]);
  await assert.rejects(h.api.readPluginDirectoryOriginPage(h.ready, "workspace", null, h.signal));
  const summary = await h.api.loadPluginDirectoryPersonalSummary(h.ready, h.signal);
  assert.equal(summary.shared, null); assert.deepEqual(h.lists().map(call => call[2]), ["personal", "personal"]);
}
{
  const h = fixture({ page: (kind, cursor) => ({ plugins: [row(kind)], nextCursor: kind === "created" && cursor === null ? "workspace-next" : null }) });
  const first = await h.api.readPluginDirectoryCreatedPage(h.ready, null, h.signal);
  await h.api.readPluginDirectoryCreatedPage(h.ready, first.nextCursor, h.signal);
  assert.deepEqual(h.lists().map(call => [call[2], call[4]]), [["created", null], ["personal", null], ["created", "workspace-next"]]);
}
{
  const h = fixture(), summary = await h.api.loadPluginDirectoryPersonalSummary(h.ready, h.signal);
  assert.equal(summary.created.map(entry => entry.rawId).join(","), "created,personal");
  assert.deepEqual(h.lists().map(call => [call[2], call[3], call[4]]), [["created", 9, null], ["personal", 9, null], ["shared", 50, null]]);
}
for (const operation of ["readPluginDirectoryCreatedPage", "loadPluginDirectoryPersonalSummary"]) for (const options of [
  { failKind: "created" }, { changeList: true }, { abortList: true }, { routingChanged: true },
  { page: () => ({ plugins: [{ id: "missing-release" }], nextCursor: null }) },
]) {
  const h = fixture(options);
  await assert.rejects(operation === "readPluginDirectoryCreatedPage" ? h.api[operation](h.ready, null, h.signal) : h.api[operation](h.ready, h.signal));
  if (options.abortList) assert.equal(h.calls.at(-1)[0], "list", "abort never starts post-read identity checks");
}
{
  const h = fixture(), template = entries.parsePluginDirectoryEntries([row("template", { is_template: true })], "workspace");
  const instance = entries.parsePluginDirectoryEntries([row("instance", { template_plugin_id: "template" })], "workspace");
  assert.equal(h.api.mergePluginDirectoryOriginPages([template, instance], "workspace").map(entry => entry.rawId).join(","), "instance");
  assert.equal(h.api.mergePluginDirectoryOriginPages([template, instance], "shared").length, 2);
}

// Execute the production TS bridge wrapper, not a duplicated request builder.
{
  const api = {}, calls = [];
  let reply = request => ({ requestId: request.requestId, identity, plugins: [row("bridge")], nextPageToken: "opaque" });
  vm.runInNewContext(compile("src/chatgptService.ts"), { exports: api, require: name => name === "./bridge" ? {
    tauriInvoke: async (command, args) => { calls.push({ command, args }); return reply(args.request); },
  } : {}, AbortController, URL, crypto: { randomUUID: () => "request" },
    navigator: { userAgent: "Private test", userAgentData: { brands: [{ brand: "Chromium", version: "140" }], platform: "Windows" } },
    localStorage: { getItem: () => "private-device" },
  });
  const controller = new AbortController();
  const result = await api.readRemotePluginDirectoryList(identity, "workspace", 50, "cursor+", controller.signal);
  assert.equal(result.nextCursor, "opaque");
  assert.equal(calls[0].command, "remote_plugin_directory_list");
  const { profile, ...request } = calls[0].args.request;
  assert.deepEqual(plain(request), { requestId: "request", expectedIdentity: identity, kind: "workspace", limit: 50, cursor: "cursor+" });
  assert.equal(profile.deviceId, "private-device");
  for (const bad of [{ plugins: {} , nextPageToken: null }, { plugins: [], nextPageToken: 9 }, { plugins: [] }]) {
    reply = request => ({ requestId: request.requestId, identity, ...bad });
    await assert.rejects(api.readRemotePluginDirectoryList(identity, "personal", 9, null, controller.signal));
  }
  controller.abort(); const count = calls.length;
  await assert.rejects(api.readRemotePluginDirectoryList(identity, "shared", 50, null, controller.signal));
  assert.equal(calls.length, count);
}
console.log("PASS plugin origins: true account map, scoped summaries, atomic dual cursors, identity/abort isolation, cross-page templates and production bridge");

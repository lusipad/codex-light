import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const api = {}, requests = [], identity = { accountId: "account", userId: "user", generation: 1 };
let reply = request => ({ requestId: request.requestId, identity, sections: [{ id: "featured", plugins: [{ id: "plugin-id", display_name: "Flat" }] }] });
const bridge = { tauriInvoke: async (command, args) => { requests.push({ command, args }); return reply(args.request); } };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/chatgptService.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: api, require: name => name === "./bridge" ? bridge : {}, AbortController, URL,
  crypto: { randomUUID: () => "home-request" },
  navigator: { userAgent: "Isolated directory client", userAgentData: { brands: [{ brand: "Chromium", version: "140" }], platform: "Windows" } },
  localStorage: { getItem: () => "private-device" },
});
const signal = new AbortController().signal;
const sections = await api.readRemotePluginDirectoryHome(identity, signal);
assert.equal(sections[0].plugins[0].display_name, "Flat");
assert.equal(requests[0].command, "remote_plugin_home");
assert.deepEqual(Object.keys(requests[0].args.request).sort(), ["expectedIdentity", "profile", "requestId"]);
assert.equal(requests[0].args.request.expectedIdentity, identity);
assert.equal(requests[0].args.request.profile.deviceId, "private-device");
for (const invalid of [
  () => ({ requestId: "wrong", identity, sections: [] }),
  () => ({ requestId: "home-request", identity: { ...identity, generation: 2 }, sections: [] }),
  () => ({ requestId: "home-request", identity, sections: null }),
  () => ({ requestId: "home-request", identity }),
]) { reply = invalid; await assert.rejects(api.readRemotePluginDirectoryHome(identity, signal)); }
const aborted = new AbortController(); aborted.abort();
const before = requests.length;
await assert.rejects(api.readRemotePluginDirectoryHome(identity, aborted.signal));
assert.equal(requests.length, before, "aborted home read does not issue a bridge request");
reply = request => ({ requestId: request.requestId, identity, plugin: { id: request.pluginId, name: "actual-plugin", release: {} } });
const rawId = "opaque/id?中%2F";
assert.equal((await api.readRemotePluginDirectoryDetail(rawId, identity, signal)).id, rawId);
assert.equal(requests.at(-1).command, "remote_plugin_detail");
assert.equal(requests.at(-1).args.request.pluginId, rawId, "client passes raw identity; the fixed backend encodes its single path segment");
reply = request => ({ requestId: request.requestId, identity, plugin: { id: "foreign" } });
await assert.rejects(api.readRemotePluginDirectoryDetail(rawId, identity, signal));
reply = request => ({ requestId: request.requestId, identity, plugins: [{ id: "flat", display_name: "Category" }], nextPageToken: "next" });
const category = await api.readRemotePluginDirectoryCategory(identity, "tools/中", "  query  ", "opaque+cursor", signal);
assert.equal(category.nextCursor, "next");
assert.equal(requests.at(-1).command, "remote_plugin_category");
assert.equal(requests.at(-1).args.request.categorySlug, "tools/中");
assert.equal(requests.at(-1).args.request.searchTerm, "query");
assert.equal(requests.at(-1).args.request.cursor, "opaque+cursor");
for (const value of [{ plugins: {}, nextPageToken: null }, { plugins: [], nextPageToken: 1 }, { plugins: [] }]) {
  reply = request => ({ requestId: request.requestId, identity, ...value });
  await assert.rejects(api.readRemotePluginDirectoryCategory(identity, "tools", "", null, signal));
}
console.log("PASS directory home client: exact scoped command/profile, flat sections, wrong request/identity/malformed and cancelled rejection");

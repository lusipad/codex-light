import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const calls = [];
const builtin = { id: "default", name: "GitHub", disabled: false };
const outputs = {
  cloud_github_default: builtin,
  cloud_github_enterprise: { connectors: [{ id: "disabled", name: "Zulu", disabled: true }, { id: "work", name: "Alpha", disabled: false }, builtin] },
  cloud_github_links: { links: [
    { id: "personal", connector_id: "default", nickname: "Personal", available: true },
    { id: "extra", connector_id: "default", nickname: null, available: false },
    { id: "external", connector_id: "unknown", nickname: null, available: true },
  ] },
  cloud_github_installations: { memberships: [{ id: "37", account_login: "owner", account_type: "Organization" }],
    other: [{ id: "37", account_login: "duplicate", account_type: "User" }] },
  cloud_github_repositories: { repositories: Array.from({ length: 20 }, (_, i) => ({ id: String(i), repository_full_name: `owner/repo-${i}`, default_branch: i ? null : "release" })) },
};
const exports = {};
const identity = { accountId: "account", userId: "user", generation: 1 };
let deferred;
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/cloudRepositoryDiscovery.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, require: () => ({ readChatgptService(operation, params, expected, signal) {
  assert.equal(expected, identity);
  calls.push({ operation, params: JSON.parse(JSON.stringify(params)), signal });
  return deferred ?? Promise.resolve(outputs[operation]);
} }) });

const signal = new AbortController().signal;
const connections = await exports.loadRepositoryConnections(identity, signal);
assert.deepEqual(JSON.parse(JSON.stringify(connections.map(c => [c.connectorId, c.linkId, c.status]))),
  [["default", "personal", "connected"], ["default", "extra", "reconnect"], ["work", null, "connect"], ["disabled", null, "disabled"]]);
const before = calls.length;
assert.equal((await exports.loadRepositoryInstallations(connections[1], identity, signal)).length, 0);
await assert.rejects(exports.loadRepositoryPage(connections[1], null, "", 1, identity, signal), /不可用/);
assert.equal(calls.length, before);
const [installation] = await exports.loadRepositoryInstallations(connections[0], identity, signal);
assert.equal(installation.account_login, "owner");
assert.deepEqual(calls.at(-1).params, { connectorId: "default", linkId: "personal" });
const page = await exports.loadRepositoryPage(connections[0], installation, " 中文 & repo ", 2, identity, signal);
assert.equal(page.nextPage, 3);
assert.equal(page.rows[0].default_branch, "release");
assert.equal(page.rows[1].default_branch, null);
assert.deepEqual(calls.at(-1).params, { connectorId: "default", linkId: "personal", page: 2, query: "中文 & repo",
  installation: { id: "37", accountLogin: "owner", accountType: "Organization" } });
outputs.cloud_github_repositories.repositories.pop();
assert.equal((await exports.loadRepositoryPage(connections[0], null, "", 3, identity, signal)).nextPage, null);
let resolve;
deferred = new Promise(done => { resolve = done; });
const obsolete = new AbortController();
const result = exports.loadRepositoryPage(connections[0], installation, "obsolete", 1, identity, obsolete.signal);
obsolete.abort();
resolve(outputs.cloud_github_repositories);
await assert.rejects(result, { name: "AbortError" });
console.log("PASS cloud repository discovery: connection matching, inaccessible links, exact organization scope, pagination and stale result cancellation");

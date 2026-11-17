import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import ts from "typescript";
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/chatgptRoutes.ts", "utf8"), {
  fileName: "chatgptRoutes.ts", compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, URL });
for (const data of [{ id: "local-chatgpt:uuid", projectId: null, temporary: false },
  { id: "actual/server", projectId: "g-p-中文", temporary: true }]) {
  const path = exports.chatgptConversationPath(data);
  assert.deepEqual(JSON.parse(JSON.stringify(exports.parseChatgptConversationLocation(`https://fixture.invalid${path}`))), data);
}
assert.equal(exports.chatgptConversationPath({ id: "local-chatgpt:u", projectId: null, temporary: false }), "/c/local-chatgpt%3Au");
for (const path of ["/", "/c/", "/c/id/extra", "/g/project/c/", "/c/%XX", "/sites/id"]) {
  assert.equal(exports.parseChatgptConversationLocation(`https://fixture.invalid${path}`), null);
}
console.log("PASS fixed Chat /c and /g/c paths: actual client/server identity, encoding, temporary flag and invalid routes");

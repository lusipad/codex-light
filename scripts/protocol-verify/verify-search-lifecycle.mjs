// Isolated real file-search roundtrip; never starts a model turn.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-search-lifecycle-"));
const home = path.join(root, "home"), workspace = path.join(root, "workspace");
fs.mkdirSync(home); fs.mkdirSync(workspace);
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const options = {
  shell: binary.endsWith(".cmd"), windowsHide: true,
  env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" },
};
const version = spawnSync(binary, ["--version"], { ...options, encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
const pending = new Map(), transcript = [], notifications = [], notificationListeners = new Set();
let buffer = "", id = 0, passed = false;
const child = spawn(binary, ["app-server", "--listen", "stdio://"], { ...options, stdio: ["pipe", "pipe", "pipe"] });
const closed = new Promise(resolve => child.once("close", resolve));
child.stdout.setEncoding("utf8");
child.stderr.resume();
child.stdout.on("data", chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.id != null) pending.get(message.id)?.(message);
    else {
      if (message.method?.startsWith("fuzzyFileSearch/")) notifications.push(message);
      notificationListeners.forEach(handler => handler(message));
    }
  }
});
function rpc(method, params) {
  assert.ok(["initialize", "fuzzyFileSearch", "thread/search",
    "fuzzyFileSearch/sessionStart", "fuzzyFileSearch/sessionUpdate", "fuzzyFileSearch/sessionStop"].includes(method));
  const requestId = ++id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(Error(`${method} timed out`)); }, 20000);
    pending.set(requestId, message => {
      clearTimeout(timer); pending.delete(requestId);
      transcript.push({ method, params, response: message });
      if (message.error) reject(Error(`${method}: ${JSON.stringify(message.error)}`));
      else resolve(message.result);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n");
  });
}
const source = fs.readFileSync("src/components/QuickSearchModal.tsx", "utf8");
const ast = ts.createSourceFile("QuickSearchModal.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) declarations.push(node.getText(ast));
  if (ts.isVariableDeclaration(node) && /^REMOTE_/.test(node.name.getText(ast))) declarations.push(`const ${node.getText(ast)};`);
  ts.forEachChild(node, visit);
}
visit(ast);
const search = vm.runInNewContext(ts.transpileModule(
  `${declarations.join("\n")}\n({normalize:normalizeRemoteFileHits,threads:searchThreadsProtocol})`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText, { callAppServer: rpc });
const fileModule = { exports: {} };
const fileSource = fs.readFileSync("src/fuzzyFileSearch.ts", "utf8");
vm.runInNewContext(ts.transpileModule(fileSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, {
  exports: fileModule.exports, crypto: globalThis.crypto, require: () => ({
    callAppServer: rpc,
    async tauriListen(name, callback) {
      assert.equal(name, "app-server:notification");
      notificationListeners.add(callback);
      return () => notificationListeners.delete(callback);
    },
  }),
});
function createSearchCompletion(matches, complete, fail) {
  let response = [];
  let completed = false, received = false, settled = false;
  const finish = () => {
    if (!settled && completed && received && matches(response)) { settled = true; complete(response); }
  };
  return {
    onResults(value) { response = value; received = true; finish(); },
    onLoading(loading) { if (!loading) { completed = true; finish(); } },
    onError(error) { if (!settled) { settled = true; fail(error); } },
  };
}
async function searchFiles(query, matches) {
  let complete, fail;
  const done = new Promise((resolve, reject) => { complete = resolve; fail = reject; });
  const completion = createSearchCompletion(matches, complete, fail);
  const timer = setTimeout(() => fail(Error("real session notification timed out")), 15000);
  const controller = fileModule.exports.createFuzzyFileSearch([workspace], {
    onResults: value => completion.onResults(search.normalize(value.files, [workspace])),
    onLoading: completion.onLoading,
    onError: completion.onError,
  });
  try { await controller.update(query); return await done; }
  finally { clearTimeout(timer); await controller.dispose(); }
}
try {
  await rpc("initialize", {
    clientInfo: { name: "codex-native-search-lifecycle-probe", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");
  const name = "target-中文-🙂.txt", file = path.join(workspace, name);
  fs.writeFileSync(file, "isolated search fixture");
  const files = await searchFiles("target", results => results.some(item =>
    path.resolve(item.absPath).toLowerCase() === file.toLowerCase() && item.fileName === name));
  assert.ok(files.some(item => path.resolve(item.absPath).toLowerCase() === file.toLowerCase()));
  assert.ok(files.some(item => item.fileName === name), "production normalization preserves Unicode filename");
  fs.unlinkSync(file);
  const afterDelete = await searchFiles("target", results => results.length === 0);
  assert.equal(afterDelete.length, 0, "same real query observes removed file");
  const deleted = await rpc("fuzzyFileSearch", { roots: [workspace], query: "target" });
  assert.ok(Array.isArray(deleted.files), "independent deletion check must return a real files array");
  assert.equal(search.normalize(deleted.files, [workspace]).length, 0, "independent real search confirms removal, not a session's initial empty snapshot");
  const chatPage = await search.threads("unmatched-isolated-query", 26);
  assert.ok(chatPage, "the empty chat page must come from a successful request");
  assert.equal(chatPage.threads.length, 0);
  assert.equal(chatPage.nextCursor, null);
  assert.ok(transcript.every(entry => !entry.response.error), "helpers must not hide a rejected protocol call");
  passed = true;
  assert.equal(notificationListeners.size, 0);
  assert.equal(transcript.filter(entry => entry.method === "fuzzyFileSearch/sessionStop").length, 2);
  console.log(`PASS ${version.stdout.trim()}: production sessions observe Unicode file creation/removal, stop both sessions and read empty isolated thread search`);
} finally {
  child.stdin.end();
  const stopTimer = setTimeout(() => child.kill(), 5000);
  await closed;
  clearTimeout(stopTimer);
  const evidence = process.env.SEARCH_EVIDENCE_DIR || ".ref/parity/08/actual/08B";
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, `protocol-${version.stdout.trim().replace(/[^a-zA-Z0-9.-]/g, "-")}.json`), JSON.stringify({
    binary, version: version.stdout.trim(), passed, isolatedHome: home, workspace,
    probeSourceSha256: createHash("sha256").update(fs.readFileSync(new URL(import.meta.url))).digest("hex"),
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    sessionSourceSha256: createHash("sha256").update(fileSource).digest("hex"), transcript, notifications,
    scope: "real isolated file search and empty thread result; no model turn, native UI or official comparison",
  }, null, 2));
  const absolute = fs.realpathSync(root);
  assert.equal(path.dirname(absolute).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(absolute).startsWith("codex-search-lifecycle-"));
  function removeFixture(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const childPath = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) removeFixture(childPath);
      else fs.unlinkSync(childPath);
    }
    fs.rmdirSync(directory);
  }
  for (let attempt = 0; ; attempt++) {
    try { removeFixture(absolute); break; }
    catch (error) {
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code) || attempt === 19) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
const clone = v => JSON.parse(JSON.stringify(v));
const patch = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new";
const context = { unifiedDiff: patch, filesChanged: 1, linesAdded: 1, linesRemoved: 1, filePaths: ["src/a.ts"], headBranch: "codex/topic", baseBranch: "main" };
function fixture() {
  const exports = {}, calls = []; let data = context, instructions = "", read = null, generate = null;
  const invoke = async (command, args) => {
    calls.push([command, args]);
    if (command === "git_message_context") return read ? read() : clone(data);
    if (command === "desktop_state_get") return instructions;
    if (command === "git_message_generation_cancel") return true;
    if (command === "git_message_generate") return generate ? generate(args.request) : { operationId: args.request.operationId, message: "Prevent a stale response from replacing the draft", title: "Preserve the current draft", body: "## Summary\n- Preserve input\n## Testing\n- Not run (not requested)" };
    throw Error(`Unexpected fixture command ${command}`);
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/gitMessageGeneration.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: () => ({ tauriInvoke: invoke }), crypto: { randomUUID } });
  return { ...exports, calls, data: v => data = v, instructions: v => instructions = v, read: v => read = v, generate: v => generate = v };
}
const golden = JSON.parse(fs.readFileSync("scripts/fixtures/git-message-golden.json", "utf8")).fixtures;
{
  const f = fixture();
  assert.equal(f.buildCommitContext(context, "使用中文说明原因", "已有草稿"), golden[0].context);
  const bigPatch = "diff --git a/a b/a\n@@ -0,0 +1,700 @@\n" + Array(700).fill("+new").join("\n") + "\ndiff --git a/b b/b\n@@ -1,301 +0,0 @@\n" + Array(301).fill("-old").join("\n");
  assert.equal(f.buildCommitContext({ ...context, unifiedDiff: bigPatch }, "", ""), golden[1].context);
  assert.equal(f.buildPullRequestContext(context, "使用中文\n```text\n示例"), golden[2].context);
  assert.equal(f.buildPullRequestContext({ ...context, unifiedDiff: "", filePaths: Array.from({ length: 101 }, (_, i) => `src/${i}.ts`) }, ""), golden[3].context);
  const thousand = "diff --git a/a b/a\n@@ -0,0 +1,1000 @@\n" + Array(1000).fill("+new").join("\n");
  assert.doesNotMatch(f.buildCommitContext({ ...context, unifiedDiff: thousand }, "", ""), /too large/);
  assert.match(f.buildCommitContext({ ...context, unifiedDiff: thousand + "\n+new" }, "", ""), /too large/);
  assert.equal(f.buildCommitContext({ ...context, unifiedDiff: "" }, "", ""), "");
}
console.log("PASS GB02: fixed Store golden contexts, separate commit/PR thresholds and guidance scopes");
{
  const f = fixture(), control = new AbortController(); f.instructions("使用中文");
  await f.generateGitMessage("fixture", "commit", { includeUnstaged: false, draftMessage: "existing draft" }, control.signal);
  assert.equal(f.calls.find(c => c[0] === "git_message_context")[1].includeUnstaged, false);
  assert.equal(f.calls.find(c => c[0] === "desktop_state_get")[1].key, "git-commit-instructions");
  assert.match(f.calls.find(c => c[0] === "git_message_generate")[1].request.prompt, /existing draft/);
  assert.ok(f.calls.every(c => !["git_stage", "git_commit_changes", "git_push_changes", "git_create_pr", "app_server_call"].includes(c[0])));
  const empty = fixture(); empty.data({ ...context, unifiedDiff: "", filePaths: [] });
  await assert.rejects(empty.generateGitMessage("fixture", "commit", {}, control.signal), /没有/);
  assert.ok(!empty.calls.some(c => c[0] === "git_message_generate"));
}
{
  const f = fixture(), control = new AbortController(); let release;
  f.read(() => new Promise(resolve => release = resolve));
  const pending = f.generateGitMessage("fixture", "commit", {}, control.signal); control.abort(); release(context);
  await assert.rejects(pending, /取消/); assert.ok(!f.calls.some(c => c[0] === "git_message_generate"));
}
{
  const f = fixture(), control = new AbortController(); let release;
  f.generate(request => new Promise(resolve => release = () => resolve({ operationId: request.operationId, message: "Prevent a stale result from replacing the draft" })));
  const pending = f.generateGitMessage("fixture", "commit", {}, control.signal);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  control.abort(); release(); await assert.rejects(pending, /取消/);
  const sent = f.calls.find(c => c[0] === "git_message_generate")[1].request;
  assert.equal(f.calls.find(c => c[0] === "git_message_generation_cancel")[1].operationId, sent.operationId);
}
for (const result of [{ operationId: "wrong", message: "Long enough result" }, { message: "short" }, { message: "x".repeat(73) }]) {
  const f = fixture(); f.generate(request => ({ operationId: request.operationId, ...result }));
  await assert.rejects(f.generateGitMessage("fixture", "commit", {}, new AbortController().signal), /格式/);
}
console.log("PASS GB04/GB05: real client IPC contract, saved instructions, no Git writes, cancellation boundaries and malformed-result rejection");

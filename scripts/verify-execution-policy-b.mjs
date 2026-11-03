import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/executionPolicy.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: module.exports });
const { resolveConfiguredExecutionPolicy: configured, resolvePresetExecutionPolicy: preset, readThreadExecutionPolicy: thread } = module.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const roots = ["D:/project"];
assert.deepEqual(plain(configured({}, roots)), {
  approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: "read-only",
  sandboxPolicy: { type: "readOnly", networkAccess: false },
});
const granular = { sandbox_approval: false, rules: true, mcp_elicitations: true, skill_approval: false, request_permissions: true };
const config = {
  sandbox_mode: "workspace-write", approval_policy: { granular }, approvals_reviewer: "auto_review",
  sandbox_workspace_write: { writable_roots: ["E:/extra"], network_access: true, exclude_slash_tmp: true, exclude_tmpdir_env_var: true },
};
const execution = configured(config, roots);
assert.deepEqual(plain(execution), {
  approvalPolicy: { granular }, approvalsReviewer: "auto_review", sandbox: "workspace-write",
  sandboxPolicy: { type: "workspaceWrite", writableRoots: ["D:/project", "E:/extra"], networkAccess: true, excludeSlashTmp: true, excludeTmpdirEnvVar: true },
});
execution.sandboxPolicy.writableRoots.push("F:/mutated");
execution.approvalPolicy.granular.rules = false;
assert.deepEqual(roots, ["D:/project"]);
assert.deepEqual(config.sandbox_workspace_write.writable_roots, ["E:/extra"]);
assert.equal(granular.rules, true);
assert.equal(configured({ sandbox_mode: "danger-full-access" }, roots).approvalPolicy, "never");
assert.equal(configured({ sandbox_mode: "danger-full-access", approval_policy: "on-request" }, roots).approvalPolicy, "on-request");
assert.equal(configured({ approval_policy: "untrusted" }, roots).approvalPolicy, "untrusted");
assert.equal(configured({ approval_policy: "on-failure" }, roots).approvalPolicy, "on-failure");
assert.equal(configured({ approvals_reviewer: "guardian_subagent", features: { guardian_approval: false } }, roots).approvalsReviewer, "user");
assert.equal(configured({ approvals_reviewer: "guardian_subagent", "features.guardian_approval": false }, roots).approvalsReviewer, "user");
assert.equal(configured({ approvals_reviewer: "guardian_subagent", "features.guardian_approval": "unknown", features: { guardian_approval: false } }, roots).approvalsReviewer, "user");
assert.equal(configured({ approvals_reviewer: "guardian_subagent" }, roots).approvalsReviewer, "guardian_subagent");
for (const invalid of [
  { sandbox_mode: "unknown" }, { approval_policy: "unknown" }, { approvals_reviewer: "unknown" },
  { approval_policy: { granular: { sandbox_approval: false } } },
  { approval_policy: { granular: { ...granular, future_permission: true } } },
  { approval_policy: { granular, extra: true } },
  { sandbox_mode: "workspace-write", sandbox_workspace_write: [] },
  { sandbox_mode: "workspace-write", sandbox_workspace_write: { network_access: "false" } },
  { sandbox_mode: "workspace-write", sandbox_workspace_write: { writable_roots: [null] } },
  { sandbox_mode: "workspace-write", sandbox_workspace_write: { exclude_slash_tmp: 1 } },
]) assert.throws(() => configured(invalid, roots));
const ask = preset("ask", roots);
assert.equal(ask.approvalPolicy, "on-request");
assert.equal(ask.approvalsReviewer, "user");
assert.equal(ask.sandboxPolicy.networkAccess, false);
assert.equal(preset("auto", roots, true).approvalsReviewer, "auto_review");
assert.equal(preset("auto", roots, true).sandboxPolicy.networkAccess, true);
assert.equal(preset("full", roots).approvalPolicy, "never");
assert.equal(preset("full", roots).sandbox, "danger-full-access");
assert.throws(() => preset("custom", roots));
const restored = configured(config, roots);
const response = { approvalPolicy: restored.approvalPolicy, approvalsReviewer: restored.approvalsReviewer, sandbox: restored.sandboxPolicy };
assert.deepEqual(plain(thread(response)), plain(restored));
const settings = { approvalPolicy: response.approvalPolicy, approvalsReviewer: response.approvalsReviewer, sandboxPolicy: response.sandbox };
assert.deepEqual(plain(thread({ threadSettings: settings })), plain(restored));
assert.deepEqual(plain(thread(settings)), plain(restored));
assert.equal(thread({ thread: response }), undefined);
assert.equal(thread({ threadSettings: { approvalPolicy: "never" }, ...response }), undefined);
assert.equal(thread({ ...response, approvalsReviewer: "future" }), undefined);
assert.equal(thread({ ...response, sandbox: { type: "externalSandbox", networkAccess: "enabled" } }), undefined);
assert.equal(thread({ ...response, sandbox: { ...response.sandbox, networkAccess: "true" } }), undefined);
assert.equal(thread({}), undefined);
assert.equal(thread(null), undefined);
assert.equal(thread({ ...response, approvalPolicy: undefined }), undefined);
assert.equal(thread({ approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "readOnly", networkAccess: true } }).sandboxPolicy.networkAccess, true);
console.log("execution policy B: configured/default/preset/granular/thread isolation passed");

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const client = { exports: {} };
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync("src/automationsClient.ts", "utf8") +
    "\nexport { normalizeFinishedEvent, normalizeSchedulerStatus };",
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText, { exports: client.exports, require: () => ({}) });
for (const status of ["completed", "failed", "interrupted", "unknown"]) {
  assert.equal(client.exports.normalizeFinishedEvent({
    id: "task", status, startedAt: 100, finishedAt: 200,
  }).status, status, "terminal status must not default to success");
}
assert.equal(client.exports.normalizeFinishedEvent({ id: "task", status: "running" }), null);
assert.equal(client.exports.normalizeFinishedEvent({ id: "task" }), null);
const status = client.exports.normalizeSchedulerStatus;
assert.equal(status({ entries: [] }).activityThreadIds, null, "older backends cannot attest to the identity set");
assert.equal(status({ activityThreadIds: ["known", 42] }).activityThreadIds, null, "invalid sets are not treated as authoritative");
assert.deepEqual(Array.from(status({ activityThreadIds: ["new", "old", "new"] }).activityThreadIds), ["new", "old"]);
assert.deepEqual(Array.from(status({ activityThreadIds: [] }).activityThreadIds), []);

const source = fs.readFileSync("src/components/AutomationsView.tsx", "utf8");
const ast = ts.createSourceFile("view.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const context = vm.createContext({ MAX_RUN_HISTORY: 20 });
for (const node of ast.statements) {
  if (ts.isFunctionDeclaration(node) &&
      ["appendRunRecord", "applyStartedEvent", "applyFinishedEvent"].includes(node.name?.text)) {
    vm.runInContext(ts.transpileModule(node.getText(ast), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, context);
  }
}
const started = { id: "task", name: "task", at: 100 };
const finished = { id: "task", name: "task", status: "completed", startedAt: 100, finishedAt: 200, threadId: "thread" };
let records = context.applyFinishedEvent([], finished);
records = context.applyStartedEvent(records, started);
assert.equal(records.length, 1, "late start/accepted response cannot duplicate an early terminal");
assert.equal(records[0].status, "completed", "late accepted cannot revert the terminal");
records = context.applyFinishedEvent(records, finished);
assert.equal(records.length, 1, "duplicate terminal is idempotent");
records = context.applyStartedEvent(records, { ...started, at: 300 });
records = context.applyFinishedEvent(records, finished);
assert.equal(records.length, 2);
assert.equal(records.find(record => record.startedAt === 300).status, "running",
  "late old terminal cannot complete the newer run");
console.log("PASS RC frontend: strict terminal normalization, early/duplicate completion and run identity isolation");

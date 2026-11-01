import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/sidebarOrder.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: module.exports });
const { applySidebarOrder, moveVisibleSidebarThread, prependSidebarThread, sidebarDropTarget } = module.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const items = ["a", "b", "c"].map(id => ({ id }));
assert.deepEqual(plain(applySidebarOrder(items, ["missing", "c", "a"]).map(t => t.id)), ["c", "a", "b"]);
assert.deepEqual(plain(applySidebarOrder(items, ["missing", "c", "a"], true).map(t => t.id)), ["b", "c", "a"]);
assert.deepEqual(plain(moveVisibleSidebarThread(["a", "hidden", "b", "missing", "c"], ["a", "b", "c"], ["a", "b", "c"], "c", "a", false)), ["c", "hidden", "a", "missing", "b"], "replace visible slots, keep all hidden/unloaded IDs in place");
assert.deepEqual(plain(moveVisibleSidebarThread(["a", "b", "c"], ["a", "b", "c"], ["a", "b", "c"], "a", "c", true)), ["b", "c", "a"]);
assert.deepEqual(plain(moveVisibleSidebarThread(["a", "b"], ["a", "b"], ["a", "b"], "external", "a", false)), ["a", "b"], "unknown drag must not add or delete rows");
assert.deepEqual(plain(prependSidebarThread(["a", "b", "a"], "a")), ["a", "b"]);
assert.deepEqual(plain(prependSidebarThread(["old", "missing"], "new")), ["new", "old", "missing"]);
assert.deepEqual(items.map(t => t.id), ["a", "b", "c"], "rendering must not mutate input");
const visible = ["a", "b", "c", "d"];
assert.equal(typeof sidebarDropTarget, "function", "drag indicator must use the official canonical insertion boundary contract");
for (const [active, target, after, beforeId] of [
  ["d", "a", false, "a"],
  ["d", "a", true, "b"],
  ["a", "c", false, "c"],
  ["a", "c", true, "d"],
  ["a", "d", true, null],
  ["d", "b", false, "b"],
]) {
  assert.deepEqual(plain(sidebarDropTarget(visible, active, target, after)), { beforeId }, "normalize before/after placement to a boundary after excluding the dragged item");
}
for (const [active, target, after] of [
  ["a", "a", false], ["a", "a", true],
  ["a", "b", false], ["b", "a", true],
  ["d", "c", true], ["c", "d", false],
  ["missing", "b", false], ["a", "missing", false],
]) {
  assert.equal(sidebarDropTarget(visible, active, target, after), null, "self, missing IDs and unchanged adjacent placements must not show an insertion indicator");
}
assert.equal(sidebarDropTarget([], "a", "b", false), null);
assert.deepEqual(visible, ["a", "b", "c", "d"], "drop target lookup must not mutate visible order");
assert.deepEqual(plain(moveVisibleSidebarThread(["hidden", "a"], ["a", "b"], ["a", "b"], "a", "b", false)), ["hidden", "a", "b"], "an unchanged valid move retains existing unknown-item merge semantics");
console.log("PASS manual order functions: project/recent new-item position, hidden/unloaded slot retention, before/after drop and explicit new-thread prepend");
console.log("PASS canonical drop boundary: head/middle/tail before/after, no-op suppression, missing IDs and nonmutation");

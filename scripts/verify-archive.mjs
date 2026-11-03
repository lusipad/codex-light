import assert from "node:assert/strict";
import fs from "node:fs";

// 1. 检查 ArchiveView.tsx
const viewSource = fs.readFileSync(
  new URL("../src/components/ArchiveView.tsx", import.meta.url),
  "utf8"
);

// AR01: 检查 thread/list 调用携带 archived: true
const hasArchivedQuery =
  viewSource.includes('"thread/list"') &&
  viewSource.includes("archived: true");

// AR02: 先读取全部分页，再搜索本地列表。
const hasSearchDebounce =
  viewSource.includes("useDeferredValue") &&
  viewSource.includes("nextCursor") &&
  viewSource.includes(".includes(query)");

// AR03: 检查恢复与彻底删除
const hasRestoreAndDelete =
  viewSource.includes("onUnarchive") &&
  viewSource.includes("onDelete") &&
  viewSource.includes("confirm") &&
  viewSource.includes("busyId");

assert.ok(
  hasArchivedQuery,
  "ArchiveView.tsx: Must query 'thread/list' with archived: true"
);
assert.ok(
  hasSearchDebounce,
  "ArchiveView.tsx: Must search complete paginated data locally"
);
assert.ok(
  hasRestoreAndDelete,
  "ArchiveView.tsx: Must support onUnarchive and onDelete with confirm protection and busyId"
);

console.log("ALL ARCHIVE VERIFICATIONS PASSED!");

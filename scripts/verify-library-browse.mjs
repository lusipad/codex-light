import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { client } from "./verify-library-read.mjs";

function load(file, require) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require, Intl });
  return exports;
}
const data = load("src/libraryData.ts", () => assert.fail("unexpected dependency"));
const browse = load("src/libraryBrowse.ts", name => name === "./libraryData" ? data : assert.fail(name));
const json = value => JSON.parse(JSON.stringify(value));
const node = (id, rest = {}) => ({ node: { id, name: id, kind: "file", ...rest } });
const entries = [node("file10", { file_size_bytes: -1 }), node("file2", { file_size_bytes: 2 }),
  node("file1", { file_size_bytes: 10 }), node("folder", { kind: "directory" }), node("root", { is_root: true })];
assert.deepEqual(json(browse.sortLibraryBrowseItems(entries, null)), entries);
assert.notEqual(browse.sortLibraryBrowseItems(entries, null), entries);
for (const direction of ["asc", "desc"]) {
  const sorted = browse.sortLibraryBrowseItems(entries, { key: "size", direction });
  assert.deepEqual(json(sorted.slice(0, 2).map(x => x.node.id)), ["root", "folder"]);
  assert.equal(sorted.at(-1).node.id, "file10", "invalid size stays last in either direction");
  assert.deepEqual(entries.map(x => x.node.id), ["file10", "file2", "file1", "folder", "root"]);
}
for (const key of ["name", "date", "size"]) {
  const a = browse.nextLibraryBrowseSort(null, key), b = browse.nextLibraryBrowseSort(a, key);
  assert.equal(a.direction, key === "name" ? "asc" : "desc");
  assert.notEqual(a.direction, b.direction); assert.equal(browse.nextLibraryBrowseSort(b, key), null);
}
const dated = { ...node("date", { updated_at: "2026-11-01", file_upload_time: "2026-10-01" }), lastUsedAt: "2026-11-05" };
assert.equal(browse.libraryBrowseDate(dated), Date.parse("2026-11-01"));
assert.equal(browse.libraryBrowseDate(dated, true), Date.parse("2026-11-05"));
assert.ok(Number.isNaN(browse.libraryBrowseDate(node("unknown"))));
assert.notEqual(browse.libraryBrowsePreferenceKey({ accountId: "a", userId: "u" }), browse.libraryBrowsePreferenceKey({ accountId: "b", userId: "u" }));
assert.equal(browse.libraryBrowsePreferenceKey({ accountId: "a", userId: null }), null);
assert.deepEqual(json(browse.decodeLibraryBrowsePreferences({ viewMode: "bad", lastTab: "bad" })), { lastTab: "suggested" });

const c = client("browse-contract"), access = { available: true, identity: { accountId: "account-fixture", userId: "user-fixture", generation: 0 }, onedrive: false };
assert.equal(typeof c.library.readLibraryBrowsePage, "function", "ordinary browse needs ranked feed dispatch, not all nodes");
const base = { tab: "suggested", directoryId: null, search: "", categories: [], sources: [] };
const read = async (changes = {}, cursor = null) => {
  const page = await c.library.readLibraryBrowsePage(access, { ...base, ...changes }, cursor, new AbortController().signal);
  const request = c.calls.filter(x => x.command === "chatgpt_service_read").at(-1).args.request;
  return { page, request };
};
c.control.read = async request => ({ requestId: request.requestId, identity: request.expectedIdentity,
  body: { cursor: null, items: request.operation === "library_nodes" ? [{ id: "folder", name: "folder", kind: "directory" }]
    : [{ id: "libfile_fde1_doc", file_name: "普通文档.docx", directory_id: "dir", current_version_number: 3, last_used_at: "2026-11-05" }] } });
let result = await read();
assert.equal(result.request.operation, "library_suggested");
assert.deepEqual(json(result.request.params), { cursor: null, categories: [], source: null });
assert.equal(result.page.items[0].node.name, "普通文档.docx"); assert.equal(result.page.items[0].currentVersion, 3);
assert.equal(result.page.items[0].lastUsedAt, "2026-11-05"); assert.equal(result.page.items[0].node.parent_directory_id, "dir");
result = await read({ categories: ["documents", "pdfs"], sources: ["uploaded"] }, "next");
assert.deepEqual(json(result.request.params), { cursor: "next", categories: ["documents", "pdfs"], source: "uploaded" });
assert.equal((await read({ sources: ["uploaded", "generated"] })).request.params.source, null);
result = await read({ tab: "images" }); assert.equal(result.request.operation, "library_images");
for (const changes of [{ tab: "all" }, { tab: "folders" }, { directoryId: "dir" }, { search: " 中文 " }, { tab: "images", search: "query" }]) {
  result = await read(changes); assert.equal(result.request.operation, "library_nodes");
  assert.equal(result.request.params.include_files, changes.tab !== "folders");
  if (changes.search) assert.equal(result.request.params.q, changes.search.trim());
}
assert.equal((await read({ tab: "folders", directoryId: "dir" })).request.params.include_files, true);
result = await read({ tab: "all", categories: ["pdfs"] }); assert.equal(result.page.items.length, 0, "category results exclude ordinary directories");
await assert.rejects(() => c.library.readLibraryBrowsePage({ ...access, available: false }, base, null, new AbortController().signal));
console.log("PASS 18H ordinary Library: ranked/native reader dispatch and file-info normalization, category/source request and cursor, folder inclusion, local three-state sorting, real metadata dates and identity preference keys; no authenticated HTTP or official pixels.");

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/libraryData.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports, Intl });
const { parseLibraryNodesPage, parseLibraryImagesPage, mergeLibraryPages, nextLibraryCursor,
  isLibraryNavigationRoot, sortLibraryItems } = exports;
const node = (id, name = id, size = 1, kind = "file") => ({ id, name, kind, file_size_bytes: size });
const page = (items, cursor = null) => parseLibraryNodesPage({ items, cursor });
const ids = items => Array.from(items, item => item.node.id);
const original = { ...node("a"), future_metadata: { flag: true } };
assert.equal(page([original]).items[0].node, original, "GET preserves original node and unknown metadata");
const image = parseLibraryImagesPage({ items: [{ id: "image", file_name: "图像.png", directory_id: "dir",
  current_version_number: 4, last_used_at: "time", future_metadata: 8 }], cursor: "next", extra: 9 });
assert.equal(image.items[0].node.kind, "file");
assert.equal(image.items[0].node.name, "图像.png");
assert.equal(image.items[0].node.parent_directory_id, "dir");
assert.equal(image.items[0].node.file_name, "图像.png");
assert.equal(image.items[0].node.future_metadata, 8);
assert.equal(image.items[0].currentVersion, 4);
assert.equal(image.items[0].lastUsedAt, "time");
assert.equal(image.extra, 9);
const minimal = parseLibraryImagesPage({ items: [{ id: "image", file_name: "" }], cursor: null }).items[0];
assert.equal(minimal.currentVersion, 0);
assert.equal(minimal.node.parent_directory_id, null);
assert.equal(minimal.lastUsedAt, undefined);
for (const invalid of [null, [], {}, { items: null, cursor: null }, { items: [], cursor: 4 },
  { items: [], cursor: undefined }, { items: [null], cursor: null },
  ...[{ id: "", name: "n", kind: "file" }, { id: "i", name: 1, kind: "file" },
    { id: "i", name: "n" }, { id: "i", name: "n", kind: "" }].map(item => ({ items: [item], cursor: null }))]) {
  assert.throws(() => parseLibraryNodesPage(invalid));
}
assert.throws(() => parseLibraryImagesPage({ items: [{ id: "i", name: "not-file-name" }], cursor: null }));
const pages = Array.from({ length: 120 }, (_, i) => page([node("shared", `version${i}`), node(`item${i}`)], `c${i}`));
const merged = mergeLibraryPages(pages);
assert.equal(merged.length, 121);
assert.equal(merged[0].node.id, "shared");
assert.equal(merged[0].node.name, "version119", "later page replaces payload without moving insertion position");
assert.equal(merged[120].node.id, "item119");
assert.equal(nextLibraryCursor(page([], "c2"), [null, "c1"]), "c2");
for (const cursor of [null, "", "c1"]) assert.equal(nextLibraryCursor(page([], cursor), [null, "c1"]), null);
const mixed = page([node("invalid", "Z", -1), node("small", "file2", 2), node("large", "file10", 10),
  node("tie", "file1", 2), node("missing", "A", undefined), node("directory", "dir", 0, "directory"),
  { ...node("rootZ", "Z", 0, "directory"), is_root: true },
  { ...node("rootA", "A", 0, "directory"), is_root: true }]).items;
// Explicit undefined, rather than the fixture helper's default size.
mixed.find(item => item.node.id === "missing").node.file_size_bytes = undefined;
assert.deepEqual(ids(sortLibraryItems(mixed, { key: "size", direction: "desc" })),
  ["rootZ", "rootA", "directory", "large", "tie", "small", "missing", "invalid"]);
assert.deepEqual(ids(sortLibraryItems(mixed, { key: "size", direction: "asc" })),
  ["rootZ", "rootA", "directory", "tie", "small", "large", "missing", "invalid"]);
assert.deepEqual(ids(sortLibraryItems(page([node("a", "file10"), node("b", "FILE2"), node("c", "file1")]).items,
  { key: "name", direction: "asc" })), ["c", "b", "a"]);
assert.deepEqual(ids(sortLibraryItems(page([node("a", "file10"), node("b", "FILE2"), node("c", "file1")]).items,
  { key: "name", direction: "desc" })), ["a", "b", "c"]);
for (const size of [null, undefined, -1, NaN, Infinity, -Infinity, "10"]) {
  const items = page([{ ...node("invalid"), file_size_bytes: size }, node("valid", "Z", 0)]).items;
  for (const direction of ["asc", "desc"]) assert.deepEqual(ids(sortLibraryItems(items, { key: "size", direction })), ["valid", "invalid"]);
}
for (const id of ["library:collection:shared-with-me", "external-google-drive:root", "external-a1:root"])
  assert.equal(isLibraryNavigationRoot({ node: node(id) }), true);
for (const id of ["external-A:root", "external-a:root:suffix", "external-:root", "library:other"])
  assert.equal(isLibraryNavigationRoot({ node: node(id) }), false);
assert.equal(isLibraryNavigationRoot({ node: { ...node("x"), is_root: "true" } }), false);
const inputOrder = ids(mixed);
sortLibraryItems(mixed, { key: "name", direction: "desc" });
assert.deepEqual(ids(mixed), inputOrder, "sorting never mutates merged data");
console.log("PASS production Library parser, POST mapping, 120-page deduplication, cursor guards and official size/name comparison");

// Directory ancestry is not a nodes page: no kind or cursor is required.
const { parseLibraryDirectoryPath } = exports;
const ancestry = { items: [{ id: "root", name: "根", is_root: true }, { id: "目录/a", name: "A", future: 1 }] };
assert.equal(parseLibraryDirectoryPath(ancestry)[1], ancestry.items[1]);
assert.deepEqual(Array.from(parseLibraryDirectoryPath({ items: [] })), []);
for (const invalid of [null, [], {}, { items: null }, { items: [null] },
  { items: [{ id: "", name: "A" }] }, { items: [{ id: "a", name: 1 }] },
  { items: [{ id: "a", name: "A", is_root: "true" }] },
  { items: [{ id: "a", name: "A" }, { id: "a", name: "again" }] }])
  assert.throws(() => parseLibraryDirectoryPath(invalid));
console.log("PASS directory path accepts actual ancestry shape without inventing kind/cursor and rejects malformed identities");

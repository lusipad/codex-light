import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
const source = process.env.IMAGES_DATA_SOURCE || "src/imagesData.ts";
vm.runInNewContext(ts.transpileModule(fs.readFileSync(source, "utf8"), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText, { exports });
const d = exports;
const plain = value => JSON.parse(JSON.stringify(value));
const prompt = (id, section) => ({ id, section, title: id });
const page = (items, cursor = null) => d.parseImagesHistory({ items, cursor });
const allowed = { id: "same", title: "first", url: "https://fixture.invalid/original", future: 42 };
let failed = 0;
function check(name, run) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}
check("only the first matching prompt collection receives suggestions; sources are unchanged", () => {
  const catalog = d.parseImagesCatalog({ groups: [
    { id: "other", kind: "other", items: [prompt("style")] },
    { id: "first", presentation: "portrait", items: [prompt("style")] },
    { id: "second", kind: "prompt_collection", items: [prompt("style")] },
  ], future: { keep: true } });
  const styles = d.parseImagesStyles({ styles: [{ id: "style" }], image_suggestions: [prompt("suggestion")] });
  const merged = d.mergeImagesCatalog(catalog, styles);
  assert.deepEqual(plain(merged.map(group => group.items[0].id)), ["style", "suggestion", "style"]);
  assert.equal(catalog.groups[1].items[0].id, "style");
  assert.equal(catalog.future.keep, true);
  assert.equal(merged[0], catalog.groups[0]);
});
check("missing groups is successful empty; no styles match does not synthesize a group", () => {
  const catalog = d.parseImagesCatalog({});
  assert.equal(catalog.groups.length, 0);
  assert.equal(d.mergeImagesCatalog(catalog), catalog.groups);
  assert.equal(d.mergeImagesCatalog(catalog, d.parseImagesStyles({})), catalog.groups);
  const one = d.parseImagesCatalog({ groups: [{ id: "one", items: [prompt("x")] }] });
  assert.deepEqual(plain(d.mergeImagesCatalog(one, d.parseImagesStyles({
    styles: [{ id: "unmatched" }], image_suggestions: [prompt("new")],
  }))), plain(one.groups));
});
check("section sorting maps empty section to trending and preserves unlisted encounter order", () => {
  const groups = d.parseImagesCatalog({ groups: [
    { id: "a", items: [prompt("1", "Z"), prompt("2"), prompt("3", "Templates"), prompt("4", "A"), prompt("5", "Z")] },
    { id: "ignored", kind: "other", items: [prompt("6", "Ignored")] },
  ] }).groups;
  assert.deepEqual(plain(d.imagesSections(groups)), ["Z", "", "Templates", "A"]);
  assert.deepEqual(plain(d.imagesSections(groups, ["Templates", "trending"])), ["Templates", "", "Z", "A"]);
});
check("ordinary repeated ids retain the first payload and order without mutating pages", () => {
  const first = page([allowed, { id: "b" }], "next");
  const second = page([{ id: "same", title: "later" }, { id: "c" }]);
  const merged = d.mergeImagesHistory([first, second]);
  assert.deepEqual(plain(merged.map(image => image.id)), ["same", "b", "c"]);
  assert.equal(merged[0].title, "first");
  assert.equal(merged[0].future, 42);
  assert.equal(first.items[0].title, "first");
});
check("later duplicate blocked status overrides the earlier usable thumbnail", () => {
  const first = page([allowed], "next");
  const merged = d.mergeImagesHistory([first, page([{ id: "same", output_blocked: true }])]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, "first");
  assert.equal(d.imageThumbnail(merged[0]), null);
  assert.equal(d.imageThumbnail(first.items[0]), allowed.url, "merge never changes an earlier snapshot");
  const samePage = page([allowed, { id: "same", output_blocked: true }]);
  assert.equal(d.imageThumbnail(d.mergeImagesHistory([samePage])[0]), null, "same-page dedup cannot swallow deny either");
});
check("archived deny survives parsing until cross-page merging removes the earlier item", () => {
  const denied = page([{ id: "same", is_archived: true }]);
  assert.equal(denied.items.length, 1, "parser must retain the deny record");
  assert.equal(d.imageThumbnail(denied.items[0]), null);
  assert.equal(d.mergeImagesHistory([page([allowed], "next"), denied]).length, 0);
  assert.equal(d.mergeImagesHistory([page([allowed, { id: "same", output_blocked: true },
    { id: "same", is_archived: true }])]).length, 0, "archive takes priority over blocked within one page");
});
check("denies persist only in the current pages; a fresh allowed snapshot can recover", () => {
  for (const field of ["output_blocked", "is_archived"]) {
    const denied = page([{ id: "same", [field]: true }]);
    const withLaterAllowed = d.mergeImagesHistory([denied, page([allowed])]);
    assert.equal(withLaterAllowed.some(image => d.imageThumbnail(image) !== null), false);
    assert.equal(d.imageThumbnail(d.mergeImagesHistory([page([allowed])])[0]), allowed.url);
  }
});
check("empty intermediate pages keep a next cursor and earlier items; repeated cursors stop", () => {
  const empty = page([], "third");
  assert.equal(d.imagesNextCursor(empty, [null, "second"]), "third");
  assert.equal(d.mergeImagesHistory([page([allowed], "second"), empty]).length, 1);
  for (const cursor of [null, "", "second"]) assert.equal(d.imagesNextCursor(page([], cursor), [null, "second"]), null);
});
check("thumbnail uses nullish precedence, preserves empty path, and denies blocked or archived", () => {
  for (const path of [undefined, null]) assert.equal(d.imageThumbnail({ ...allowed, encodings: { thumbnail: { path } } }), allowed.url);
  assert.equal(d.imageThumbnail({ ...allowed, encodings: { thumbnail: { path: "" } } }), "");
  assert.equal(d.imageThumbnail({ ...allowed, encodings: { thumbnail: { path: "thumbnail" } } }), "thumbnail");
  assert.equal(d.imageThumbnail({ ...allowed, output_blocked: true }), null);
  assert.equal(d.imageThumbnail({ ...allowed, is_archived: true }), null);
  assert.equal(d.imageThumbnail({ id: "none" }), null);
});
check("malformed consumed fields fail instead of becoming a successful empty response", () => {
  for (const value of [null, [], { groups: 1 }, { groups: [{ id: "g", items: [null] }] },
    { groups: [{ id: "g", items: [{ id: "p", image_variants: [12] }] }] }]) assert.throws(() => d.parseImagesCatalog(value));
  for (const value of [null, { styles: false }, { image_suggestions: 1 }, { styles: [{ id: 1 }] }]) assert.throws(() => d.parseImagesStyles(value));
  for (const value of [null, {}, { items: [], cursor: 1 }, { items: [], cursor: undefined },
    { items: [{ id: "a", is_archived: "true" }], cursor: null },
    { items: [{ id: "a", output_blocked: 0 }], cursor: null },
    { items: [{ id: "a", encodings: { thumbnail: [] } }], cursor: null }]) assert.throws(() => d.parseImagesHistory(value));
});
console.log(`${10 - failed}/10 Images data groups passed; source=${source}`);
console.log("NOT TESTED: online schema completeness, identity/capability, requests, image bytes/revocation, GUI/native/pixel parity");
process.exitCode = failed ? 1 : 0;

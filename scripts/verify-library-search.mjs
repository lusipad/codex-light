import assert from "node:assert/strict";
import { harness } from "./verify-library-service.mjs";

const walk = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(walk)] : [];
const text = tree => walk(tree).flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const access = { available: true, identity: { accountId: "a", userId: "u", generation: 1 }, onedrive: false };
const folder = (id = "folder") => ({ node: { id, name: id, kind: "directory" } });
const file = (id = "file") => ({ node: { id, name: `${id}.txt`, kind: "file" } });
const page = (items = [], cursor = null) => ({ items, cursor });
const button = (h, name) => walk(h.render()).find(node => node.type === "button" && (node.props["aria-label"] === name || text(node) === name));
const input = h => walk(h.render()).find(node => node.type === "input" && node.props.id === "library-search-input");
const pane = h => walk(h.render()).find(node => node.type === "LibraryPreviewPane");
async function authenticate(h) { await flush(); h.accesses.at(-1).resolve(access); await flush(); h.render(); }
async function ready(items = [folder(), file()]) {
  const h = harness(); h.render(); await authenticate(h); h.reads.at(-1).resolve(page(items)); await flush(); h.render(); return h;
}
function search(h, value) {
  const field = input(h); assert.ok(field, "official native Library search must be an input");
  field.props.onChange({ target: { value }, currentTarget: { value } }); h.render();
}
let h = await ready();
{
  const gate = harness(); gate.render(); await flush(); assert.equal(input(gate), undefined);
  gate.accesses.at(-1).resolve({ ...access, available: false }); await flush(); assert.equal(input(gate), undefined); gate.unmount();
}
assert.ok(input(h), "native root must expose the official search input");
assert.equal(input(h).props.placeholder, "搜索资料库");
assert.equal(input(h).props.type, "text"); assert.equal(input(h).props.autoComplete, "off");
assert.equal(walk(h.render()).filter(node => node.type === "h1").length, 1);
assert.equal(walk(h.render()).some(node => node.props["aria-label"] === "文件夹路径"), false, "root has no duplicate breadcrumb title");
const staleInput = input(h), first = h.reads[0];
search(h, "  中文 term  "); await authenticate(h);
assert.equal(first.signal.aborted, true); assert.equal(h.reads.at(-1).search, "中文 term");
assert.equal(input(h).props.value, "  中文 term  ", "raw input must preserve spaces");
assert.equal(h.navigation.canGoBack, false, "search replaces the current history entry");
h.reads.at(-1).resolve(page([folder(), file()], "search-page-2")); await flush();
const count = h.reads.length, source = h.reads.at(-1).signal;
search(h, "中文 term"); await flush();
assert.equal(h.reads.length, count); assert.equal(source.aborted, false, "equivalent trimmed query retains current pages");
staleInput.props.onChange({ target: { value: "stale" } }); h.render();
assert.equal(input(h).props.value, "中文 term", "old search callback cannot replace newer location");
button(h, "加载更多").props.onClick(); const oldPage = h.reads.at(-1);
assert.equal(oldPage.search, "中文 term"); assert.equal(oldPage.cursor, "search-page-2");
search(h, "other"); assert.ok(input(h), "query revalidation must retain the active input"); await authenticate(h);
assert.equal(oldPage.signal.aborted, true); oldPage.resolve(page([file("late")])); await flush();
assert.doesNotMatch(text(h.render()), /late.txt/);
h.reads.at(-1).reject(Error("search network")); await flush();
const staleRetry = button(h, "重试"); assert.match(text(h.render()), /search network/);
staleRetry.props.onClick(); h.render(); await authenticate(h);
assert.equal(h.reads.at(-1).search, "other"); h.reads.at(-1).resolve(page()); await flush();
assert.match(text(h.render()), /未找到文件/);
let focused = 0; input(h).props.ref.current = { focus() { focused++; } };
button(h, "清空搜索").props.onClick(); h.render(); await authenticate(h);
assert.equal(focused, 1); assert.equal(input(h).props.value, ""); assert.equal(h.reads.at(-1).search, "");
const newCount = h.accesses.length; staleRetry.props.onClick(); h.render(); await flush(); assert.equal(h.accesses.length, newCount);
h.reads.at(-1).resolve(page([folder(), file()])); await flush();
search(h, "root query"); await authenticate(h); h.reads.at(-1).resolve(page([folder(), file()])); await flush();
button(h, "folder").props.onClick(); h.render(); await authenticate(h);
assert.equal(input(h).props.placeholder, "在当前文件夹中搜索"); assert.equal(input(h).props.value, "");
assert.equal(h.reads.at(-1).directoryId, "folder"); assert.equal(h.reads.at(-1).search, "");
h.paths.at(-1).resolve([{ id: "folder", name: "folder", is_root: false }]); h.reads.at(-1).resolve(page([file()])); await flush();
search(h, "folder query"); await authenticate(h);
assert.equal(h.reads.at(-1).directoryId, "folder"); assert.equal(h.reads.at(-1).search, "folder query");
h.reads.at(-1).resolve(page([file()])); await flush();
button(h, "资料库").props.onClick(); h.render(); await authenticate(h);
assert.equal(input(h).props.value, "root query", "breadcrumb restores saved root search");
h.reads.at(-1).resolve(page([folder(), file()])); await flush();
h.navigation.back(); h.render(); await authenticate(h); assert.equal(input(h).props.value, "folder query");
h.reads.at(-1).resolve(page([file()])); await flush();
h.navigation.forward(); h.render(); await authenticate(h); assert.equal(input(h).props.value, "root query");
h.reads.at(-1).resolve(page([folder(), file()])); await flush();
button(h, "file.txt").props.onClick({ currentTarget: { isConnected: true, focus() {} } });
const preview = pane(h); assert.ok(preview);
search(h, "while preview"); await authenticate(h);
assert.equal(preview.props.request.controller.signal.aborted, false, "search preserves the original preview request");
assert.equal(pane(h).props.request, preview.props.request);
h.reads.at(-1).resolve(page([file("other")])); await flush();
button(h, "other.txt").props.onClick({ currentTarget: { isConnected: true, focus() {} } });
assert.equal(preview.props.request.controller.signal.aborted, true);
const switchedPreview = pane(h); preview.props.onClose();
assert.equal(pane(h).props.request, switchedPreview.props.request, "old close cannot dismiss the new file");
pane(h).props.onClose(); h.render(); await authenticate(h);
assert.equal(input(h).props.value, "root query", "close restores the first preview return location");
h.reads.at(-1).resolve(page([file()])); await flush();
const oldInput = input(h); h.invalidate(); h.render(); await authenticate(h);
oldInput.props.onChange({ target: { value: "old account" } }); h.render();
assert.equal(input(h).props.value, "", "identity invalidation discards saved searches and old callbacks");
h.unmount();
{
  const h = await ready([file()]); search(h, "term"); await authenticate(h);
  h.reads.at(-1).resolve(page([file()])); await flush();
  button(h, "file.txt").props.onClick({ currentTarget: { isConnected: true, focus() {} } });
  search(h, "term "); const count = h.reads.length, active = h.reads.at(-1).signal;
  pane(h).props.onClose(); h.render(); await flush();
  assert.equal(input(h).props.value, "term"); assert.equal(h.reads.length, count);
  assert.equal(active.aborted, false, "restoring only raw spaces must keep the existing query alive");
  assert.match(text(h.render()), /file.txt/); assert.doesNotMatch(text(h.render()), /正在读取资料库/); h.unmount();
}
{
  const h = harness(); h.render(); await authenticate(h);
  h.reads.at(-1).reject(Error("list failed")); await flush(); button(h, "重试").props.onClick(); h.render(); await flush();
  const next = { ...access, identity: { accountId: "b", userId: "u", generation: 2 } };
  h.accesses.at(-1).resolve(next); await flush(); h.render(); await flush();
  assert.equal(h.accesses.length, 3, "same-root identity fallback must start a fresh effect without relying on an event");
  h.accesses.at(-1).resolve(next); await flush(); h.render();
  assert.equal(h.reads.at(-1).access.identity.accountId, "b"); assert.equal(h.reads.at(-1).signal.aborted, false); h.unmount();
}
console.log("PASS 18G production Library search: real reader scope, raw/trim split, immediate cancellation, history replacement, folder/root restoration, paging and stale callbacks, error/retry, clear focus, preview preservation/return location and identity isolation. Controlled hooks fixture; not authenticated HTTP, native IME or paired pixels.");

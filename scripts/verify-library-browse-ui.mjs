import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { harness } from "./verify-library-service.mjs";

// Production JSX and event handlers, controlled service/React/DOM boundaries.
// Layout measurement, native focus and actual account HTTP require separate QA.
const walk = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(walk)] : [];
const text = tree => walk(tree).flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const access = { available: true, identity: { accountId: "a", userId: "u", generation: 1 }, onedrive: false };
const find = (h, label) => walk(h.render()).find(node => node.type === "button" && (node.props["aria-label"] === label || text(node) === label));
const page = (ids, cursor = null) => ({ items: ids.map((id, i) => ({ node: { id, name: id, kind: "file", file_size_bytes: i + 1 } })), cursor });
async function ready(storage = new Map()) {
  const h = harness(null, storage); h.render();
  for (let i = 0; i < 4 && !h.reads.length; i++) { await flush(); h.accesses.at(-1).resolve(access); await flush(); h.render(); }
  return h;
}
const authenticate = async (h, next = access) => { h.render(); await flush(); h.accesses.at(-1).resolve(next); await flush(); h.render(); };
const ids = h => walk(h.render()).filter(node => node.props["data-library-item"]).map(node => node.props["data-library-item"]);
const header = (h, key) => walk(h.render()).find(node => node.props.role === "columnheader" && node.props["data-library-column"] === key);
const preferenceKey = 'library-display-preferences:["a","u"]';
let h = await ready();
assert.equal(h.reads[0].tab, "suggested", "ordinary Library defaults to the real recommended reader");
assert.ok(find(h, "推荐")); assert.ok(find(h, "文件夹")); assert.ok(find(h, "图像")); assert.ok(find(h, "全部"));
const initialTree = h.render(), initialHeader = walk(initialTree).find(node => node.props.className === "library-view-header library-browse-header");
assert.ok(walk(initialHeader).some(node => node.props["aria-label"] === "网格视图"), "official xe header toolbar owns view controls alongside search, rather than the tab navigation row");
const initialTabs = walk(initialTree).find(node => node.props.role === "tablist");
assert.equal(initialTabs.props["aria-label"], "资料库分区");
assert.ok(!walk(initialHeader).includes(initialTabs), "root tabs remain a separate navigation row below the heading toolbar");
h.reads.at(-1).resolve(page(["second", "first"], "next")); await flush();
assert.equal(find(h, "网格视图").props["aria-pressed"], true);
const before = h.reads.length; find(h, "列表视图").props.onClick(); h.render(); await flush();
assert.equal(h.reads.length, before, "layout switch must not issue a new read");
assert.ok(walk(h.render()).some(node => node.props.role === "grid" && node.props["aria-label"] === "资料库文件"));
assert.equal(find(h, "大小"), undefined, "recommended list omits size");
assert.deepEqual(ids(h), ["second", "first"], "null sort preserves the backend recommendation order");
header(h, "name").children[0].props.onClick(); assert.deepEqual(ids(h), ["first", "second"]);
header(h, "name").children[0].props.onClick(); assert.deepEqual(ids(h), ["second", "first"]);
header(h, "name").children[0].props.onClick(); assert.equal(header(h, "name").props["aria-sort"], "none");
const original = h.reads.length; find(h, "推荐").props.onClick(); h.render(); await flush(); assert.equal(h.reads.length, original, "selected tab is inert");
find(h, "打开筛选器").props.onClick(); h.render();
const checkbox = label => walk(h.render()).find(node => node.props.role === "menuitemcheckbox" && text(node) === label);
checkbox("文档").props.onClick(); await authenticate(h);
assert.deepEqual([...h.reads.at(-1).categories], ["documents"]); assert.equal(h.reads.at(-1).cursor, null);
const toolbar = walk(h.render()).find(node => node.props.className === "library-header-actions");
assert.deepEqual(toolbar.children.filter(node => node && typeof node === "object").map(node => node.props.className),
  ["library-browse-selected-filters", "library-browse-tools", "library-search"], "header toolbar DOM order is selected tags, view controls, search (no unsupported page actions)");
assert.ok(checkbox("已上传"), "filter selection keeps the menu open for multiple choices");
checkbox("已上传").props.onClick(); await authenticate(h);
checkbox("生成的文件").props.onClick(); await authenticate(h);
assert.deepEqual([...h.reads.at(-1).sources], ["uploaded", "generated"]);
assert.ok(find(h, "移除文档筛选条件"));
const oldMore = find(h, "加载更多"); // No old page cursor is carried into a filter scope.
assert.equal(oldMore, undefined);
h.reads.at(-1).resolve(page(["filtered"])); await flush();
find(h, "文件夹").props.onClick(); await authenticate(h);
assert.equal(h.reads.at(-1).tab, "folders"); assert.deepEqual([...h.reads.at(-1).categories], []); assert.deepEqual([...h.reads.at(-1).sources], []);
assert.equal(walk(h.render()).find(node => node.props["aria-label"]?.startsWith?.("打开筛选器")), undefined, "folders root has no filters");
h.reads.at(-1).resolve(page([])); await flush();
find(h, "图像").props.onClick(); await authenticate(h);
assert.equal(h.reads.at(-1).tab, "images"); assert.equal(find(h, "列表视图"), undefined, "root images forces grid and hides toggle");
assert.equal(JSON.parse(h.storage.get(preferenceKey)).viewMode, "list", "forced grid does not overwrite saved list");
h.reads.at(-1).resolve(page([])); await flush(); find(h, "全部").props.onClick(); await authenticate(h);
h.reads.at(-1).resolve(page(["all"])); await flush(); assert.equal(find(h, "列表视图").props["aria-pressed"], true);
assert.ok(header(h, "size"));
const input = walk(h.render()).find(node => node.type === "input"); input.props.onChange({ target: { value: " query " } }); await authenticate(h);
h.reads.at(-1).resolve(page(["searched"])); await flush();
assert.equal(find(h, "推荐"), undefined, "root tabs hide for normalized nonempty search");
assert.equal(header(h, "name").children[0].props.disabled, true); assert.equal(header(h, "size"), undefined);
console.log("PASS 18H true tab/filter scope dispatch, preserved recommendation order, three-state sort, forced images grid and search sorting boundaries");
h.unmount();

// Exact review reproduction through production controls, not client-side
// parameter suppression: images/folders -> query -> category/source -> clear.
for (const tab of ["图像", "文件夹"]) {
  h = await ready(); h.reads.at(-1).resolve(page([])); await flush();
  find(h, tab).props.onClick(); await authenticate(h); h.reads.at(-1).resolve(page(["metadata"])); await flush();
  walk(h.render()).find(node => node.type === "input").props.onChange({ target: { value: "query" } }); await authenticate(h);
  h.reads.at(-1).resolve(page(["metadata"])); await flush(); find(h, "打开筛选器").props.onClick(); h.render();
  const choice = label => walk(h.render()).find(node => node.props.role === "menuitemcheckbox" && text(node) === label);
  choice("文档").props.onClick(); await authenticate(h); choice("已上传").props.onClick(); await authenticate(h);
  h.reads.at(-1).resolve(page(["metadata"])); await flush();
  assert.deepEqual([...h.reads.at(-1).categories], ["documents"]);
  assert.deepEqual([...h.reads.at(-1).sources], ["uploaded"]);
  find(h, "metadata").props.onClick(); h.render();
  find(h, "清空搜索").props.onClick(); await authenticate(h);
  assert.deepEqual([...h.reads.at(-1).categories], [], `${tab} root must clear category in actual scope instead of hiding a dormant filter`);
  assert.deepEqual([...h.reads.at(-1).sources], tab === "图像" ? ["uploaded"] : [], `${tab} root source normalization follows MMs`);
  h.reads.at(-1).resolve(page(["metadata"])); await flush();
  walk(h.render()).find(node => node.type === "LibraryPreviewPane").props.onClose(); await authenticate(h);
  assert.equal(h.reads.at(-1).search, "query", "preview return restores its original legal search scope");
  assert.deepEqual([...h.reads.at(-1).categories], ["documents"]);
  h.reads.at(-1).resolve(page(["metadata"])); await flush();
  walk(h.render()).find(node => node.type === "input").props.onChange({ target: { value: "   " } }); await authenticate(h);
  assert.deepEqual([...h.reads.at(-1).categories], [], "raw whitespace also normalizes the restored scope at the shared boundary");
  assert.deepEqual([...h.reads.at(-1).sources], tab === "图像" ? ["uploaded"] : []);
  h.reads.at(-1).resolve(page(["metadata"])); await flush();
  h.navigation.back(); await authenticate(h); h.reads.at(-1).resolve(page([])); await flush();
  h.navigation.forward(); await authenticate(h);
  assert.deepEqual([...h.reads.at(-1).categories], [], "restored root history also has legal categories");
  h.reads.at(-1).resolve(page(["metadata"])); await flush();
  walk(h.render()).find(node => node.type === "input").props.onChange({ target: { value: "another query" } }); await authenticate(h);
  assert.deepEqual([...h.reads.at(-1).categories], [], "next search cannot silently revive the old document filter"); h.unmount();
}
console.log("PASS 18H production images/folders query-filter-clear-history-new-query scope normalization, preserving only allowed image-root sources");

for (const tab of ["推荐", "全部", "图像", "文件夹"]) {
  h = await ready(); h.reads.at(-1).resolve(page([])); await flush();
  if (tab !== "推荐") { find(h, tab).props.onClick(); await authenticate(h); h.reads.at(-1).resolve(page([])); await flush(); }
  const emptyTitle = tab === "图像" ? "暂无图像" : tab === "文件夹" ? "创建你的第一个文件夹" : "创建新内容";
  assert.match(text(h.render()), new RegExp(emptyTitle), `${tab} unfiltered terminal empty state uses the actual tab title`);
  if (tab === "文件夹") { h.unmount(); continue; }
  find(h, "打开筛选器").props.onClick(); h.render();
  const option = tab === "图像" ? "已上传" : "文档";
  walk(h.render()).find(node => node.props.role === "menuitemcheckbox" && text(node) === option).props.onClick(); await authenticate(h);
  h.reads.at(-1).resolve(page([])); await flush();
  assert.match(text(h.render()), /未找到文件/, `${tab} empty filtered result must not claim an empty library`);
  assert.doesNotMatch(text(h.render()), /创建新内容|暂无图像/); h.unmount();
}
h = await ready(); h.reads.at(-1).resolve({ items: [{ node: { id: "folder", name: "Folder", kind: "directory" } }], cursor: null }); await flush();
find(h, "Folder").props.onClick(); await authenticate(h); h.paths.at(-1).resolve([{ id: "folder", name: "Folder" }]);
h.reads.at(-1).resolve(page([])); await flush(); assert.match(text(h.render()), /此文件夹为空/);
find(h, "打开筛选器").props.onClick(); h.render();
walk(h.render()).find(node => node.props.role === "menuitemcheckbox" && text(node) === "文档").props.onClick(); await authenticate(h);
h.reads.at(-1).resolve(page([])); await flush(); assert.match(text(h.render()), /未找到文件/); assert.doesNotMatch(text(h.render()), /此文件夹为空/); h.unmount();
console.log("PASS 18H production tab-specific and filter-aware terminal empty states at roots and ordinary directories, without fabricated creation/upload actions");

const storage = new Map([[preferenceKey, JSON.stringify({ viewMode: "list", lastTab: "all", hiddenProviders: ["box"], custom: 42 })]]);
h = await ready(storage); assert.equal(h.reads.length, 1); assert.equal(h.reads[0].tab, "all", "hydrate before first request; never fetch the wrong recommended source first");
h.reads[0].resolve(page(["file"])); await flush(); assert.equal(find(h, "列表视图").props["aria-pressed"], true);
const trigger = { isConnected: true, focus() {} }; find(h, "file").props.onClick({ currentTarget: trigger });
const preview = walk(h.render()).find(node => node.type === "LibraryPreviewPane").props.request;
const readCount = h.reads.length; find(h, "网格视图").props.onClick(); h.render(); await flush();
assert.equal(h.reads.length, readCount); assert.equal(walk(h.render()).find(node => node.type === "LibraryPreviewPane").props.request, preview);
assert.deepEqual(JSON.parse(storage.get(preferenceKey)), { viewMode: "grid", lastTab: "all", hiddenProviders: ["box"], custom: 42 });
const oldList = find(h, "列表视图"); h.invalidate(); await authenticate(h, { ...access, identity: { accountId: "b", userId: "u", generation: 2 } });
oldList.props.onClick(); h.render();
assert.equal(h.reads.at(-1).tab, "suggested"); assert.equal(find(h, "网格视图").props["aria-pressed"], true, "another account cannot inherit old mode or stale mode callback");
assert.equal(preview.controller.signal.aborted, true); assert.equal(storage.has('library-display-preferences:["b","u"]'), false); h.unmount();

h = await ready(); h.reads[0].resolve({ items: [{ node: { id: "image", name: "image.png", kind: "file", library_file_category: "image", file_id: "real-file" } }, { node: { id: "document", name: "doc", kind: "file" } }], cursor: null }); await flush(); h.render();
assert.equal(h.images.length, 1, "only real image items use the fixed image reader, never documents or arbitrary thumbnail URLs");
assert.equal(h.images[0].item.node.file_id, "real-file");
h.images[0].resolve("data:image/png;base64,AQ=="); await flush();
let img = walk(h.render()).find(node => node.type === "img"); assert.ok(img);
img.props.onLoad({ currentTarget: { src: img.props.src, naturalWidth: 1200, naturalHeight: 600 } });
assert.equal(walk(h.render()).find(node => node.props.className === "library-browse-image").props.style.aspectRatio, 2);
img.props.onError(); assert.equal(walk(h.render()).find(node => node.type === "img"), undefined, "real decode failure switches to icon fallback");
find(h, "列表视图").props.onClick(); h.render(); assert.equal(h.images[0].signal.aborted, true, "unmounting image cards cancels their request lifecycle"); h.unmount();
console.log("PASS 18H identity/key-isolated preference hydration/merge, stale mode guards, preview-preserving zero-read layout changes and real image load/error/aspect/cancel lifecycle");

h = await ready();
const imageItem = extra => ({ node: { id: "same-image", name: "photo.png", kind: "file", library_file_category: "image", file_id: "underlying-one", file_upload_time: "2026-11-01T00:00:00Z", ...extra } });
h.reads.at(-1).resolve({ items: [imageItem()], cursor: "more-images" }); await flush(); h.render();
h.images[0].resolve("data:image/png;base64,AQ=="); await flush(); const oldImage = walk(h.render()).find(node => node.type === "img"); assert.ok(oldImage);
find(h, "加载更多").props.onClick(); h.reads.at(-1).resolve({ items: [imageItem({ file_upload_time: "2026-11-02T00:00:00Z" })], cursor: "image-source" }); await flush(); h.render();
assert.equal(h.images.length, 2, "same ID later page with no version/updated_at but new file_upload_time must refresh real image bytes");
assert.equal(h.images[0].signal.aborted, true);
assert.equal(walk(h.render()).find(node => node.type === "img"), undefined, "new image identity immediately hides the old URL");
find(h, "加载更多").props.onClick(); h.reads.at(-1).resolve({ items: [imageItem({ file_upload_time: "2026-11-02T00:00:00Z", file_id: "underlying-two", gizmo_id: "other-source" })], cursor: null }); await flush(); h.render();
assert.equal(h.images.length, 3, "same mounted ID with changed underlying source must get its own read lifecycle");
assert.equal(h.images[1].signal.aborted, true); assert.equal(h.images[2].item.node.file_id, "underlying-two");
h.images[1].resolve("data:image/png;base64,Ag=="); await flush(); assert.equal(walk(h.render()).find(node => node.type === "img"), undefined, "late previous-source result cannot paint over the new source");
h.images[2].resolve("data:image/png;base64,Aw=="); await flush();
assert.equal(walk(h.render()).find(node => node.type === "img").props.src, "data:image/png;base64,Aw==");
oldImage.props.onError(); assert.equal(walk(h.render()).find(node => node.type === "img").props.src, "data:image/png;base64,Aw==", "old DOM image failure cannot clear the replacement source"); h.unmount();
console.log("PASS 18H same-ID later-page upload timestamp/source replacement refreshes image bytes, hides old image, aborts stale work and rejects late responses/events");

// Execute the actual masonry effect with controlled measured DOM dimensions.
// These geometry samples validate assignment logic, not browser/CSS pixels.
{
  const hooks = [], effects = [], observers = [];
  let cursor = 0, columns = 2, ids = ["a", "b", "c", "d"], heights = { a: 100, b: 200, c: 50, d: 80, e: 40 };
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, { style: {}, getBoundingClientRect: () => ({ height: heights[id] }) }); return elements.get(id); };
  const root = { clientWidth: 600, style: {}, querySelectorAll: () => ids.map(element) };
  const react = {
    createElement: (type, props, ...children) => { if (props?.ref) props.ref.current = root; return { type, props, children }; },
    useRef: initial => { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useLayoutEffect: (fn, deps) => { const index = cursor++, previous = hooks[index]; if (!previous || deps.some((value, i) => previous.deps[i] !== value)) { previous?.cleanup?.(); effects.push(() => { hooks[index] = { deps, cleanup: fn() }; }); } },
  }; react.default = react;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/LibraryBrowseLayout.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText,
    { exports, require: name => name === "react" ? react : {}, Map, Number, Array, JSON,
      getComputedStyle: () => ({ getPropertyValue: () => String(columns), rowGap: "16px" }),
      ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } },
    });
  const render = () => { cursor = 0; exports.LibraryMasonry({ ids, children: [] }); while (effects.length) effects.shift()(); };
  render();
  assert.equal(element("a").style.gridColumn, "1"); assert.equal(element("b").style.gridColumn, "2");
  assert.equal(element("c").style.transform, "translateY(116px)"); assert.equal(element("d").style.transform, "translateY(182px)");
  assert.equal(root.style.height, "262px");
  ids = [...ids, "e"]; render(); assert.equal(element("e").style.gridColumn, "2"); assert.equal(element("e").style.transform, "translateY(216px)");
  heights.a = 300; observers.at(-1).callback();
  assert.equal(element("c").style.gridColumn, "1", "stable ID prefix keeps its previous column when image dimensions settle");
  assert.equal(element("c").style.transform, "translateY(316px)");
  columns = 3; observers.at(-1).callback(); assert.equal(element("c").style.gridColumn, "3", "column count change recomputes shortest assignments");
  for (const hook of hooks) hook?.cleanup?.(); assert.equal(observers.at(-1).disconnected, true);
}
console.log("PASS 18H production masonry measured shortest-column assignment, appended stable prefix, image-height resize, responsive column reset and observer release");

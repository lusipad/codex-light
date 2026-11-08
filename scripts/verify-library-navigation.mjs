import assert from "node:assert/strict";
import { harness } from "./verify-library-service.mjs";

// Actual production JSX/handlers with the established controlled hooks fixture.
// This does not exercise browser layout, native focus or account HTTP.
const walk = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(walk)] : [];
const text = tree => walk(tree).flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
const button = (h, name) => walk(h.render()).find(node => node.type === "button" && (node.props["aria-label"] === name || text(node) === name));
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const access = { available: true, identity: { accountId: "a", userId: "u", generation: 1 }, onedrive: false };
const folder = (id, name = id) => ({ node: { id, name, kind: "directory" } });
const page = (items, cursor = null) => ({ items, cursor });
async function ready(items = [folder("A"), folder("external-gdrive:blocked")]) {
  const h = harness(); h.render(); await flush(); h.accesses.at(-1).resolve(access); await flush();
  h.reads.at(-1).resolve(page(items)); await flush(); h.render(); return h;
}
async function open(h, name) {
  const action = button(h, name); assert.ok(action, `directory ${name} must be actionable`);
  action.props.onClick(); action.props.onClick(); h.render(); await flush();
  h.accesses.at(-1).resolve(access); await flush(); h.render();
}
let h = await ready();
assert.equal(button(h, "external-gdrive:blocked"), undefined, "provider directory is metadata, not a native open action");
await open(h, "A");
assert.equal(h.reads.length, 2, "repeated activation starts exactly one scoped list");
assert.equal(h.reads.at(-1).directoryId, "A");
assert.equal(h.paths.length, 1); assert.equal(h.paths[0].directoryId, "A");
h.reads.at(-1).resolve(page([folder("B")], "A-next"));
h.paths.at(-1).resolve([{ id: "root-id", name: "Root", is_root: true }, { id: "A", name: "A" }]);
await flush();
assert.ok(walk(h.render()).some(node => node.props["aria-current"] === "page" && text(node) === "A"));
h.render(); assert.equal(h.triggerPagination(), 1); const late = h.reads.at(-1);
await open(h, "B"); assert.equal(late.signal.aborted, true);
late.resolve(page([folder("late-A")], "bad")); await flush();
h.paths.at(-1).reject(Error("path failed")); h.reads.at(-1).resolve(page([], "B-next")); await flush();
assert.doesNotMatch(text(h.render()), /late-A/); assert.match(text(h.render()), /path failed/);
h.render(); assert.ok(h.paginationObservers.some(observer => !observer.disconnected), "empty nonterminal directory observes another page");
button(h, "重试路径").props.onClick(); assert.equal(h.paths.length, 3);
h.paths.at(-1).resolve([{ id: "A", name: "A" }, { id: "B", name: "B" }]); await flush();
assert.ok(button(h, "A"));
h.navigation.back(); h.render(); await flush(); h.accesses.at(-1).resolve(access); await flush();
assert.equal(h.reads.at(-1).directoryId, "A"); assert.equal(h.reads.at(-1).cursor, null);
h.reads.at(-1).resolve(page([])); h.paths.at(-1).resolve([{ id: "A", name: "A" }]); await flush();
h.render(); assert.equal(h.navigation.canGoForward, true);
h.navigation.forward(); h.render(); await flush(); h.accesses.at(-1).resolve(access); await flush();
assert.equal(h.reads.at(-1).directoryId, "B");
h.reads.at(-1).resolve(page([])); h.paths.at(-1).resolve([{ id: "A", name: "A" }, { id: "B", name: "B" }]); await flush();
h.render(); assert.equal(h.navigation.canGoForward, false);
h.navigation.back(); h.render(); await flush(); h.accesses.at(-1).resolve(access); await flush();
h.reads.at(-1).resolve(page([])); h.paths.at(-1).resolve([{ id: "A", name: "A" }]); await flush();
button(h, "资料库").props.onClick(); h.render(); await flush(); h.accesses.at(-1).resolve(access); await flush();
assert.equal(h.reads.at(-1).directoryId, null); h.reads.at(-1).resolve(page([folder("fresh")])); await flush();
assert.doesNotMatch(text(h.render()), /path failed/); assert.equal(h.navigation.canGoBack, true);
h.navigation.back(); h.render(); await flush(); h.accesses.at(-1).resolve(access); await flush();
assert.equal(h.reads.at(-1).directoryId, "A", "root breadcrumb pushes navigation; Back restores the previously viewed directory");
h.unmount();
assert.equal(h.navigation, null, "unmount clears the App titlebar directory adapter");

h = await ready([folder("A"), folder("root-sibling")]);
const oldA = button(h, "A"), oldSibling = button(h, "root-sibling");
oldA.props.onClick(); oldSibling.props.onClick(); // Before React commits the first navigation.
h.render(); await flush(); h.accesses.at(-1).resolve(access); await flush();
assert.equal(h.reads.at(-1).directoryId, "A", "old root sibling callback cannot become a child after synchronous navigation");
oldSibling.props.onClick(); h.render(); await flush();
assert.equal(h.reads.length, 2, "old rendered row also cannot navigate after the new scope effect");
h.invalidate(); oldA.props.onClick(); h.render(); await flush();
h.accesses.at(-1).resolve({ ...access, identity: { ...access.identity, generation: 2 } }); await flush();
assert.equal(h.reads.at(-1).directoryId, null, "stale row cannot resurrect old-account folder after invalidation");
h.unmount();

h = await ready(); await open(h, "A"); const delayedPath = h.paths.at(-1);
h.reads.at(-1).resolve(page([folder("B")])); await flush(); await open(h, "B");
delayedPath.resolve([{ id: "A", name: "late-path-name" }]); await flush();
assert.doesNotMatch(text(h.render()), /late-path-name/);
h.reads.at(-1).resolve(page([])); h.paths.at(-1).reject(Error("path-only failure")); await flush();
const beforeRetry = h.reads.length, retryPath = button(h, "重试路径");
retryPath.props.onClick(); retryPath.props.onClick();
assert.equal(h.paths.length, 3, "path retry has its own synchronous single-flight");
assert.equal(h.reads.length, beforeRetry, "path retry never refetches the successful directory list");
h.paths.at(-1).resolve([{ id: "wrong-directory", name: "wrong" }]); await flush();
assert.match(text(h.render()), /路径与当前目录不符/);
assert.doesNotMatch(text(h.render()), /wrong-directory/); h.unmount();

h = await ready(); button(h, "A").props.onClick(); h.render(); await flush();
h.accesses.at(-1).resolve({ ...access, identity: { ...access.identity, generation: 3 } }); await flush();
assert.equal(h.reads.length, 1, "identity changed between directory subscriptions must not read old-directory list under new identity");
assert.equal(h.paths.length, 0, "new account must not ask for old known directory ancestors");
h.render(); await flush(); h.accesses.at(-1).resolve({ ...access, identity: { ...access.identity, generation: 3 } }); await flush();
assert.equal(h.reads.at(-1).directoryId, null); assert.equal(h.navigation.canGoBack, false); h.unmount();

h = await ready(); await open(h, "A");
h.reads.at(-1).resolve(page([folder("B")], "A-cursor")); h.paths.at(-1).reject(Error("A path failed")); await flush();
const oldRetry = button(h, "重试路径"); h.render();
const oldMore = h.paginationObservers.findLast(observer => !observer.disconnected); assert.ok(oldMore);
await open(h, "B"); h.reads.at(-1).resolve(page([]));
h.paths.at(-1).resolve([{ id: "A", name: "A" }, { id: "B", name: "B" }]); await flush(); h.render();
const beforePaths = h.paths.length, beforePages = h.reads.length;
oldRetry.props.onClick(); oldMore.callback([{ isIntersecting: true }], oldMore);
assert.equal(h.paths.length, beforePaths, "old path retry must not borrow the new directory controller");
assert.equal(h.reads.length, beforePages, "old pagination must not borrow the new directory controller and cursor"); h.unmount();

h = await ready(); await open(h, "A");
h.reads.at(-1).resolve(page([])); h.paths.at(-1).resolve([{ id: "A", name: "A" }]); await flush(); h.render();
h.navigation.back(); h.render(); await flush();
h.accesses.at(-1).resolve({ ...access, identity: { ...access.identity, userId: "another-user" } }); await flush(); h.render();
assert.equal(h.navigation.canGoForward, false, "identity change at root must discard the old account's forward folder");
h.navigation.forward(); h.render(); await flush();
h.accesses.at(-1).resolve({ ...access, identity: { ...access.identity, userId: "another-user" } }); await flush();
assert.equal(h.reads.at(-1).directoryId, null); h.unmount();

h = await ready(); await open(h, "A"); const oldList = h.reads.at(-1), oldPath = h.paths.at(-1);
h.invalidate(); assert.ok(oldList.signal.aborted); assert.ok(oldPath.signal.aborted);
oldList.resolve(page([folder("old-user")])); oldPath.resolve([{ id: "A", name: "old-name" }]); await flush();
assert.doesNotMatch(text(h.render()), /old-user|old-name/); assert.equal(h.navigation.canGoBack, false);
h.render(); await flush(); h.accesses.at(-1).resolve({ ...access, identity: { ...access.identity, generation: 2 } }); await flush();
assert.equal(h.reads.at(-1).directoryId, null, "identity reset cannot inherit directory or ancestors");
const unmounted = h.reads.at(-1); h.unmount(); const writes = h.writes;
unmounted.resolve(page([folder("late-unmounted")])); await flush(); assert.equal(h.writes, writes);

h = await ready([folder("A/中文", "同名"), folder("A-other", "同名")]);
await open(h, "同名"); assert.equal(h.reads.at(-1).directoryId, "A/中文", "use raw real ID, never display label");
h.reads.at(-1).reject(Error("403 list failed")); h.paths.at(-1).resolve([{ id: "A/中文", name: "同名" }]); await flush();
assert.match(text(h.render()), /403 list failed/); assert.ok(button(h, "资料库"));
button(h, "重试").props.onClick(); h.render(); await flush(); h.accesses.at(-1).resolve(access); await flush();
assert.equal(h.reads.at(-1).directoryId, "A/中文"); h.unmount();
{
  const id = "A/中文";
  const address = "https://fixture.invalid/library/d/A%2F%E4%B8%AD%E6%96%87?tab=all&search=%20project%20&category=pdfs&source=uploaded";
  const preferences = new Map([['library-display-preferences:["a","u"]', JSON.stringify({ lastTab: "images", viewMode: "list" })]]);
  const routed = harness(null, preferences, address);
  routed.render(); await flush();
  assert.equal(routed.reads.length, 0, "URL does not bypass account qualification");
  routed.accesses.at(-1).resolve(access); await flush();
  const requested = routed.reads.at(-1);
  assert.equal(requested?.directoryId, id, "direct URL restores the decoded directory before reading");
  assert.equal(requested.tab, "all", "explicit URL wins over saved last tab");
  assert.equal(requested.search, "project");
  assert.equal(requested.categories.join(), "pdfs");
  assert.equal(requested.sources.join(), "uploaded");
  assert.equal(routed.paths[0].directoryId, id);
  requested.resolve(page([folder("B")])); routed.paths[0].resolve([{ id, name: "目录 A" }]); await flush(); routed.render();
  await open(routed, "B");
  assert.equal(routed.window.location.pathname, "/library/d/B");
  assert.equal(routed.window.location.searchParams.has("search"), false);
  routed.navigation.back(); routed.render(); await flush();
  assert.equal(routed.window.location.pathname, "/library/d/A%2F%E4%B8%AD%E6%96%87");
  assert.equal(routed.window.location.searchParams.get("search"), "project");
  routed.pop("/library/d/C?tab=all&search=restored");
  routed.render(); await flush(); routed.accesses.at(-1).resolve(access); await flush();
  assert.equal(routed.reads.at(-1).directoryId, "C");
  assert.equal(routed.reads.at(-1).search, "restored");
  assert.equal(routed.navigation.canGoBack, false, "external history navigation cannot use old local history");
  routed.invalidate(); routed.render(); await flush();
  assert.equal(routed.window.location.pathname, "/library");
  assert.equal(routed.window.location.searchParams.has("search"), false);
  assert.equal(routed.navigation.canGoForward, false);
  for (const suffix of ["/d/%ZZ", "/d/external-gdrive%3Afoo", "/d/library%3Acollection%3Ashared-with-me", "?tab=favorites", "?deleted=true", "?storage_cleanup=true", "?account_id=other"]) {
    assert.equal(routed.browse.parseLibraryLocation(`/library${suffix}`), null, suffix);
  }
  assert.equal(routed.browse.libraryLocationUrl("/library/d/A?tab=all&search=secret&source=uploaded&other=1", null), "/?other=1");
  assert.equal(routed.browse.parseLibraryFileLocation("/library/file/libfile%5Ffde1%5Fabc"), "libfile_fde1_abc");
  for (const href of ["/library/file/libfile_", "/library/file/libfile_%2Fabc", "/library/file/%ZZ",
    "/library/file/external-gdrive%3Afile", "/library/share/libfile_abc", "/library?file_id=libfile_abc",
    "/library/file/libfile_abc?account_id=other"]) assert.equal(routed.browse.parseLibraryFileLocation(href), null, href);
  routed.unmount();
}
console.log("PASS 18E production Library directory activation, direct URL, titlebar history, independent path retry and account cancellation");

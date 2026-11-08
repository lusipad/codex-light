import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const data = {}; vm.runInNewContext(compile("src/libraryData.ts"), { exports: data, Intl });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const nodes = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(nodes)] : [];
const text = tree => nodes(tree).flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
const button = (tree, label) => { const found = nodes(tree).find(node => node.type === "button" && text(node) === label); assert.ok(found, label); return found; };
export function harness(listenerError = null, storage = new Map(), href, fileRoute) {
  const contexts = new Map(), effects = [], accesses = [], reads = [], paths = [], images = [], paginationObservers = [];
  class PaginationObserver {
    constructor(callback) { this.callback = callback; paginationObservers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }
  let listener, writes = 0, navigation = null, context, used;
  const windowListeners = new Map();
  const window = { innerWidth: 1280, innerHeight: 800, location: new URL(href ?? "https://fixture.invalid/"),
    history: { state: { fixture: true }, replaceState(state, _, next) {
      assert.equal(state, window.history.state); window.location = new URL(next, window.location);
    } }, addEventListener(name, callback) { windowListeners.set(name, callback); },
    removeEventListener(name, callback) { if (windowListeners.get(name) === callback) windowListeners.delete(name); } };
  const componentContext = key => { if (!contexts.has(key)) contexts.set(key, { hooks: [], cursor: 0 }); return contexts.get(key); };
  const renderComponent = (type, props) => {
    const before = context, key = `${type.name}:${props?.key ?? "single"}`;
    context = componentContext(key); context.cursor = 0; used.add(key);
    const tree = type(props); context = before; return tree;
  };
  const React = { createElement: (type, props, ...children) => {
      if (type === React.Fragment) return children.flat(Infinity);
      if (typeof type === "function") return renderComponent(type, { ...props, children: children.flat(Infinity) });
      if (type === "button" && props?.onClick) { const callback = props.onClick; props = { ...props, onClick: event => callback(event ?? { currentTarget: { isConnected: true, focus() {} }, preventDefault() {}, stopPropagation() {} }) }; }
      const node = { type, props: props ?? {}, children: children.flat(Infinity) };
      // Only pagination receives a committed DOM ref in this shared hooks fixture.
      // Image IO and real header geometry have their own dedicated fixtures.
      if (props?.["data-library-pagination"] !== undefined && props.ref) props.ref.current = node;
      return node;
    },
    useState: initial => { const owner = context, i = owner.cursor++; if (!(i in owner.hooks)) owner.hooks[i] = typeof initial === "function" ? initial() : initial;
      return [owner.hooks[i], value => { writes++; owner.hooks[i] = typeof value === "function" ? value(owner.hooks[i]) : value; }]; },
    useCallback: (fn, deps) => { const owner = context, i = owner.cursor++, old = owner.hooks[i]; if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) owner.hooks[i] = { deps, fn }; return owner.hooks[i].fn; },
    useRef: initial => { const owner = context, i = owner.cursor++; if (!(i in owner.hooks)) owner.hooks[i] = { current: initial }; return owner.hooks[i]; },
    useEffect: (effect, deps) => { const owner = context, i = owner.cursor++, old = owner.hooks[i]; if (!old || !deps || deps.some((v, j) => !Object.is(v, old.deps?.[j]))) { owner.hooks[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { owner.hooks[i].cleanup?.(); owner.hooks[i].cleanup = effect(); }); } },
  }; React.default = React; React.Fragment = Symbol("controlled React.Fragment"); React.useLayoutEffect = React.useEffect;
  const modules = new Map();
  const load = file => {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    vm.runInNewContext(compile(file), { exports, AbortController, Date, Intl, Map, Set, Number, JSON, URL, URLSearchParams, TextEncoder,
      ...(file.endsWith("/LibraryPagination.tsx") ? { IntersectionObserver: PaginationObserver } : {}),
      document: { body: {}, addEventListener() {}, removeEventListener() {} }, window,
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
      require: name => {
      if (name === "react") return React;
      if (name === "react-dom") return { createPortal: node => ({ type: "portal", props: {}, children: [node] }) };
      if (name === "lucide-react") return new Proxy({}, { get: (_, key) => String(key) });
      if (name.endsWith(".css")) return {};
      if (name === "./LibraryBrowseLayout") return load("src/components/LibraryBrowseLayout.tsx");
      if (name === "./LibraryPagination") return load("src/components/LibraryPagination.tsx");
      // Preserve title/actions/navigation JSX for existing interaction assertions.
      // Sticky observation, measurement and scroll behavior are tested separately.
      if (name === "./LibraryStickyHeader") return { LibraryStickyHeader: ({ title, actions, navigation }) => React.createElement("fixture-header", null,
        React.createElement("div", { className: "library-view-header library-browse-header" }, React.createElement("h1", null, title),
          actions && React.createElement("div", { className: "library-header-actions" }, actions)), navigation) };
      if (name === "./ThreadActionsMenu") return { ThreadActionsMenu: "ThreadActionsMenu" };
      if (name === "./LibraryPreviewPane") return { LibraryPreviewPane: "LibraryPreviewPane" };
      if (name === "../bridge") return { tauriListen: (_event, callback) => { listener = callback; return listenerError ? Promise.reject(listenerError) : Promise.resolve(() => {}); } };
      if (name === "../chatgptService") return { serviceErrorMessage: cause => cause.message };
      if (name === "../libraryData" || name === "./libraryData") return data;
      if (name === "../libraryBrowse" || name === "./libraryBrowse") return load("src/libraryBrowse.ts");
      if (name === "../libraryBrowsePreferences") return load("src/libraryBrowsePreferences.ts");
      if (name === "../storageUsage") return { formatStorageBytes: value => `${value} bytes` };
      if (name === "../libraryClient") return {
        readLibraryAccess: signal => { const pending = deferred(); accesses.push({ signal, ...pending }); return pending.promise; },
        readLibraryBrowsePage: (access, scope, cursor, signal) => { const pending = deferred(); reads.push({ access, ...scope, search: scope.search.trim(), cursor, signal, ...pending }); return pending.promise; },
        readLibraryDirectoryPath: (access, directoryId, signal) => { const pending = deferred(); paths.push({ access, directoryId, signal, ...pending }); return pending.promise; },
        readLibraryImage: (item, access, signal) => { const pending = deferred(); images.push({ item, access, signal, ...pending }); return pending.promise; },
      }; assert.fail(name);
    } }); return exports;
  };
  const exports = load("src/components/LibraryView.tsx");
  const onNavigationChange = next => { navigation = next; };
  return { accesses, reads, paths, images, storage, paginationObservers, window, browse: load("src/libraryBrowse.ts"),
    pop(next) { window.location = new URL(next, window.location); windowListeners.get("popstate")?.(); },
    triggerPagination(entries = [{ isIntersecting: true }]) {
      const active = paginationObservers.filter(observer => !observer.disconnected && observer.target);
      for (const observer of active) observer.callback(entries, observer);
      return active.length;
    },
    get navigation() { return navigation; }, setListenError(value) { listenerError = value; }, render() {
    used = new Set(); const tree = fileRoute ? renderComponent(exports.LibraryFileRoute, fileRoute)
      : renderComponent(exports.LibraryView, { onNavigationChange, routeUrl: href !== undefined });
    for (const [key, owner] of contexts) if (!used.has(key)) { owner.hooks.forEach(hook => hook?.cleanup?.()); contexts.delete(key); }
    while (effects.length) effects.shift()(); return tree;
  }, invalidate() { listener(); }, unmount() { for (const owner of contexts.values()) owner.hooks.forEach(hook => hook?.cleanup?.()); }, get writes() { return writes; } };
}
const access = { available: true, identity: { accountId: "a", userId: "u", generation: 1 }, onedrive: false };
const page = (names, cursor = null) => ({ items: names.map(name => ({ node: { id: name, name, kind: "file", file_size_bytes: 10 } })), cursor });
let h = harness(); assert.match(text(h.render()), /正在读取/); await flush();
h.accesses[0].reject(Error("not authenticated")); await flush(); assert.match(text(h.render()), /not authenticated/); assert.doesNotMatch(text(h.render()), /暂无/);
button(h.render(), "重试").props.onClick(); h.render(); await flush(); h.accesses.at(-1).resolve({ ...access, available: false }); await flush(); assert.equal(h.reads.length, 0); assert.match(text(h.render()), /暂不支持/);
h = harness(); h.render(); await flush(); h.accesses[0].resolve(access); await flush(); assert.equal(h.reads[0].tab, "suggested"); assert.equal(h.reads[0].cursor, null);
h.reads[0].resolve(page(["real.pdf"], "next")); await flush(); assert.match(text(h.render()), /real.pdf/);
h.render(); const firstObserver = h.paginationObservers.at(-1);
assert.equal(h.triggerPagination(), 1); assert.equal(h.triggerPagination(), 0); assert.equal(h.reads.length, 2);
h.reads.at(-1).reject(Error("page failed")); await flush(); assert.match(text(h.render()), /page failed/); assert.match(text(h.render()), /real.pdf/);
assert.equal(h.triggerPagination(), 0, "pagination error suspends automatic observation rather than retrying in a loop");
firstObserver.callback([{ isIntersecting: true }]); assert.equal(h.reads.length, 2, "already queued intersection cannot bypass explicit error retry");
const retry = button(h.render(), "重试加载"); retry.props.onClick(); retry.props.onClick(); assert.equal(h.reads.length, 3, "manual retry retains synchronous single-flight");
h.reads.at(-1).resolve(page(["real.pdf", "second.pdf"], "last")); await flush(); assert.equal(nodes(h.render()).filter(node => node.props["data-library-item"]).length, 2);
h.render(); assert.notEqual(h.paginationObservers.at(-1), firstObserver, "successful page-key remount observes the next cursor");
assert.equal(h.triggerPagination(), 1); h.reads.at(-1).resolve(page(["third.pdf"], "last")); await flush(); assert.match(text(h.render()), /重复分页/); assert.doesNotMatch(text(h.render()), /third.pdf/);
assert.equal(h.triggerPagination(), 0, "repeated cursor failure also suspends automatic paging");
button(h.render(), "重试加载").props.onClick(); const oldRead = h.reads.at(-1); h.invalidate(); assert.equal(oldRead.signal.aborted, true); h.render(); oldRead.resolve(page(["old account"])); await flush(); assert.doesNotMatch(text(h.render()), /old account|real.pdf/);
h.accesses.at(-1).resolve(access); await flush(); const last = h.reads.at(-1); h.unmount(); const writes = h.writes; last.resolve(page(["unmounted"])); await flush(); assert.equal(h.writes, writes);
h = harness(); h.render(); await flush(); h.accesses[0].resolve(access); await flush(); h.reads[0].resolve(page([])); await flush(); assert.match(text(h.render()), /创建新内容/);
h = harness(); h.render(); await flush(); h.accesses[0].resolve(access); await flush(); h.reads[0].resolve(page([], "page-2")); await flush();
assert.doesNotMatch(text(h.render()), /创建新内容/, "empty nonterminal page must not claim entire library is empty");
assert.ok(nodes(h.render()).some(node => node.props["data-library-pagination"] !== undefined));
assert.equal(h.triggerPagination(), 1); h.reads.at(-1).resolve(page(["after-empty.pdf"])); await flush();
assert.match(text(h.render()), /after-empty.pdf/);
const source = fs.readFileSync("src/components/LibraryView.tsx", "utf8"); assert.doesNotMatch(source, /DEFAULT_LIBRARY_ITEMS|fakeUpload|localStorage|Date.now|setTimeout|文件已删除|已创建/);
console.log("PASS 18D default Library production JSX: identity/availability-bound actual root reads, loading/error/retry/empty, pagination single-flight/deduplication/retained data/repeated cursor, invalidation and unmount cancellation; no upload/write/preview claims");

h = harness(Error("listener unavailable")); h.render(); await flush();
assert.equal(h.accesses.length, 0, "must not read account data without identity invalidation listener");
assert.match(text(h.render()), /listener unavailable/);
h.setListenError(null); button(h.render(), "重试").props.onClick(); h.render(); await flush();
assert.equal(h.accesses.length, 1, "retry registers listener before data read");
console.log("PASS 18D nonterminal empty page and rejected identity listener with retry");

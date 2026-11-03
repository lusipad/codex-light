import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const transpile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const flush = async () => { for (let i = 0; i < 50; ++i) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const identity = { accountId: "fixture-account", userId: "fixture-user", generation: 1 };
const access = { identity, available: true, onedrive: false };
const item = (id, size, extra = {}) => ({ node: { id, name: id, kind: "file", file_size_bytes: size, ...extra } });
const initialPage = { items: [item("small", 1), item("large", 100)], cursor: null };

function surface() {
  let slots = [], cursor = 0, pending = [], props = { scope: "fixture", tab: "all", onTabChange: tab => tabs.push(tab) }, tree, renderFn;
  const tabs = [], events = {}, calls = [], imageCalls = [], observers = [];
  const control = { readAccess: async () => access, readPage: async () => initialPage,
    readImage: async () => "data:image/png;base64,fixture", listen: async (name, handler) => {
      events[name] = handler; return () => { if (events[name] === handler) delete events[name]; };
    } };
  const react = {
    createElement: (type, props, ...children) => {
      if (props?.ref && (props.className === "library-cleanup-sentinel" || props.className?.startsWith("library-cleanup-artwork"))) props.ref.current = {};
      return { type, props: props || {}, children: children.flat(Infinity) };
    },
    useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect: (fn, deps) => { const i = cursor++, old = slots[i];
      if (!old || deps.some((value, index) => value !== old.deps[index])) pending.push(() => { old?.stop?.(); slots[i] = { deps, stop: fn() }; }); },
  };
  react.useLayoutEffect = react.useEffect;
  const load = (file, require) => {
    const exports = {};
    vm.runInNewContext(transpile(file), { exports, require, AbortController, Intl, Date, Map, JSON,
      IntersectionObserver: class {
        constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
        observe() {} disconnect() { this.disconnected = true; }
      } });
    return exports;
  };
  const data = load("src/libraryData.ts", () => { throw Error("Unexpected dependency"); });
  const component = load("src/components/LibraryCleanupView.tsx", name => {
    if (name === "react") return react;
    if (name === "lucide-react") return new Proxy({}, { get: (_, key) => String(key) });
    if (name === "../bridge") return { tauriListen: (...args) => control.listen(...args) };
    if (name === "../libraryData") return data;
    if (name === "../storageUsage") return { formatStorageBytes: size => `${size} B` };
    if (name === "../libraryClient") return {
      readLibraryAccess: signal => { calls.push({ kind: "access", signal }); return control.readAccess(signal); },
      readLibraryPage: (a, tab, cursor, signal) => { calls.push({ kind: "page", access: a, tab, cursor, signal }); return control.readPage(a, tab, cursor, signal); },
      readLibraryImage: (item, access, signal) => { imageCalls.push({ item, access, signal }); return control.readImage(item, access, signal); },
    };
    assert.equal(name, "./LibraryCleanupView.css"); return {};
  });
  renderFn = component.LibraryCleanupView;
  const render = next => { if (next) props = { ...props, ...next }; cursor = 0; tree = renderFn(props); return tree; };
  const effects = () => { const queue = pending; pending = []; queue.forEach(fn => fn()); };
  const walk = node => !node || typeof node !== "object" ? [] : [node, ...node.children.flatMap(walk)];
  const content = node => node == null || typeof node === "boolean" ? "" : typeof node === "object" ? node.children.map(content).join(" ") : String(node);
  const unmount = () => slots.forEach(slot => slot?.stop?.());
  return { control, calls, events, tabs, imageCalls, observers, component, render, effects, unmount,
    nodes: () => walk(tree), text: () => content(tree),
    button: label => walk(tree).find(node => node.type === "button" && (node.props["aria-label"] === label || content(node).trim() === label)),
    start: async () => { render(); effects(); await flush(); render(); effects(); },
    settle: async () => { await flush(); render(); effects(); },
    mount: (fn, nextProps) => { unmount(); slots = []; pending = []; renderFn = fn; props = nextProps; },
  };
}

let h = surface();
await h.start();
assert.match(h.text(), /large.*small/s, "size-desc affects real merged rows");
h.button("大小").props.onClick(); h.render(); assert.match(h.text(), /small.*large/s);
h.button("名称").props.onClick(); h.render(); assert.match(h.text(), /large.*small/s);
h.button("名称").props.onClick(); h.render();
h.button("名称").props.onClick(); h.render();
assert.equal(h.nodes().find(node => node.props.role === "columnheader" && node.props.className === "library-cleanup-name").props["aria-sort"], "none", "third activation restores unsorted loaded order");
h.button("图像").props.onClick(); assert.deepEqual(h.tabs, ["images"]);
h.render({ tab: "images" }); assert.doesNotMatch(h.text(), /large|small/, "new tab hides old snapshot before effects");
h.effects(); await h.settle(); assert.equal(h.calls.at(-1).tab, "images");
assert.equal(h.button("列表视图"), undefined, "root images has no list toggle"); h.unmount();

h = surface(); let listening = deferred(); h.control.listen = () => listening.promise;
h.render(); h.effects(); await flush(); assert.equal(h.calls.length, 0, "listen before identity/read");
let stops = 0; h.unmount(); listening.resolve(() => ++stops); await flush();
assert.equal(stops, 3); assert.equal(h.calls.length, 0);
h = surface(); h.control.listen = async () => { throw Error("listener fixture failed"); }; await h.start();
assert.match(h.text(), /同步失败/); assert.equal(h.calls.length, 0, "failed listeners never create account context"); h.unmount();

h = surface(); await h.start(); const before = h.calls.length;
h.events["chatgpt-service:invalidated"]({}); h.render(); assert.doesNotMatch(h.text(), /large|small/);
await h.settle(); assert.equal(h.calls.length, before, "invalidated does not reread an old account");
h.events["app-server:notification"]({ method: "account/updated" }); await h.settle(); assert.match(h.text(), /large/);
h.events["chatgpt-service:invalidated"]({}); h.render(); h.button("重试").props.onClick(); h.render(); h.effects(); await h.settle();
assert.match(h.text(), /large/, "explicit retry reauthorizes after invalidation"); h.unmount();

h = surface(); const late = deferred(); h.control.readPage = () => late.promise; await h.start();
const old = h.calls.find(call => call.kind === "page"); h.render({ scope: "other" }); h.effects();
h.control.readPage = async () => ({ items: [item("new-account", 4)], cursor: null });
await h.settle(); late.resolve(initialPage); await h.settle();
assert.equal(old.signal.aborted, true); assert.doesNotMatch(h.text(), /large|small/); h.unmount();

h = surface(); h.control.readPage = async () => ({ items: [item("kept", 5)], cursor: "next" }); await h.start();
h.control.readPage = async () => { throw Error("page fixture failed"); };
h.observers.at(-1).callback([{ isIntersecting: true }]); await h.settle();
assert.match(h.text(), /kept/); assert.match(h.text(), /page fixture failed/);
const count = h.calls.length; await h.settle(); assert.equal(h.calls.length, count, "pagination errors do not auto retry forever");
h.control.readPage = async () => ({ items: [item("kept", 6), item("larger-page-two", 50)], cursor: "next" });
h.button("重试").props.onClick(); await h.settle(); assert.match(h.text(), /larger-page-two.*kept/s);
assert.equal(h.nodes().filter(node => node.type === "div" && node.props.role === "row").length, 3, "duplicate id merges into one row");
assert.equal(h.nodes().some(node => node.props.className === "library-cleanup-sentinel"), false, "repeated cursor terminates"); h.unmount();

h = surface(); h.control.readAccess = async () => ({ ...access, available: false }); await h.start();
assert.match(h.text(), /暂不支持/); assert.equal(h.calls.some(call => call.kind === "page"), false); h.unmount();
h = surface(); h.control.readPage = async () => ({ items: [], cursor: null }); await h.start(); assert.match(h.text(), /创建新内容/); h.unmount();

h = surface(); await h.start();
const Artwork = h.nodes().find(node => typeof node.type === "function" && node.type.name === "LibraryArtwork").type;
const image = item("image-a", 10, { library_file_category: "image", width: 400, height: 100 });
const imageLate = deferred(), imageNew = deferred(); h.control.readImage = item => item.node.id === "image-a" ? imageLate.promise : imageNew.promise;
h.mount(Artwork, { item: image, access }); h.render(); h.effects();
assert.equal(h.imageCalls.length, 0, "native image bytes are not downloaded before visibility");
h.observers.at(-1).callback([{ isIntersecting: true }]);
const imageRequest = h.imageCalls.at(-1);
h.render({ item: item("image-b", 20, { library_file_category: "image" }) }); h.effects(); await flush();
h.observers.at(-1).callback([{ isIntersecting: true }]);
imageLate.resolve("data:image/png;base64,old-account"); await h.settle();
assert.equal(imageRequest.signal.aborted, true);
assert.equal(h.nodes().some(node => node.type === "img"), false, "late previous image cannot fill a different item");
imageNew.resolve("data:image/png;base64,new-account"); await h.settle();
assert.equal(h.nodes().find(node => node.type === "img").props.src, "data:image/png;base64,new-account");
h.render({ access: { ...access, identity: { ...identity, generation: 2 } } });
assert.equal(h.nodes().some(node => node.type === "img"), false, "identity change immediately hides old image before effect");
h.effects(); h.observers.at(-1).callback([{ isIntersecting: true }]); await h.settle(); const img = h.nodes().find(node => node.type === "img");
img.props.onError(); h.render(); assert.equal(h.nodes().some(node => node.type === "img"), false, "image failure restores file artwork"); h.unmount();

const m = surface().component;
assert.equal(m.libraryImageRatio(1, 100), .5); assert.equal(m.libraryImageRatio(0, 10), 1);
let placed = m.placeLibraryMasonry(["a", "b", "c"], [100, 20, 20], 2, 10, { columns: 0, ids: [], assignments: new Map() });
assert.equal(placed.positions[2].column, 1); assert.equal(placed.positions[2].top, 30);
placed = m.placeLibraryMasonry(["a", "b", "c", "d"], [1, 100, 1, 10], 2, 10,
  { columns: 2, ids: ["a", "b", "c"], assignments: placed.assignments });
assert.equal(placed.positions[2].column, 1, "append preserves prior column assignment despite changed image heights");
assert.equal(placed.positions[3].column, 0, "new item chooses the shortest measured column");
console.log("PASS production LibraryCleanupView: listener gate, invalidation/retry, scope/tab isolation, real sorting, pagination error/retry/dedup/cursor stop, image identity binding/fallback and masonry placement");
console.log("NOT TESTED: authenticated HTTP, native GUI, actual thumbnail assets, official paired pixels");

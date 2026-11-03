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
function harness(listenerError = null) {
  const hooks = [], effects = [], accesses = [], reads = []; let cursor = 0, listener, writes = 0;
  const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: initial => { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { writes++; hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }]; },
    useRef: initial => { const i = cursor++; if (!(i in hooks)) hooks[i] = { current: initial }; return hooks[i]; },
    useEffect: (effect, deps) => { const i = cursor++, old = hooks[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) { hooks[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = effect(); }); } },
  }; React.default = React;
  const exports = {};
  vm.runInNewContext(compile("src/components/LibraryView.tsx"), { exports, AbortController, require: name => {
    if (name === "react") return React;
    if (name.endsWith(".css")) return {};
    if (name === "../bridge") return { tauriListen: (_event, callback) => { listener = callback; return listenerError ? Promise.reject(listenerError) : Promise.resolve(() => {}); } };
    if (name === "../chatgptService") return { serviceErrorMessage: cause => cause.message };
    if (name === "../libraryData") return data;
    if (name === "../storageUsage") return { formatStorageBytes: value => `${value} bytes` };
    if (name === "../libraryClient") return {
      readLibraryAccess: signal => { const pending = deferred(); accesses.push({ signal, ...pending }); return pending.promise; },
      readLibraryPage: (access, tab, cursor, signal) => { const pending = deferred(); reads.push({ access, tab, cursor, signal, ...pending }); return pending.promise; },
    }; assert.fail(name);
  } });
  return { accesses, reads, setListenError(value) { listenerError = value; }, render() { cursor = 0; const tree = exports.LibraryView(); while (effects.length) effects.shift()(); return tree; }, invalidate() { listener(); }, unmount() { for (const h of hooks) h?.cleanup?.(); }, get writes() { return writes; } };
}
const access = { available: true, identity: { accountId: "a", userId: "u", generation: 1 }, onedrive: false };
const page = (names, cursor = null) => ({ items: names.map(name => ({ node: { id: name, name, kind: "file", file_size_bytes: 10 } })), cursor });
let h = harness(); assert.match(text(h.render()), /正在读取/); await flush();
h.accesses[0].reject(Error("not authenticated")); await flush(); assert.match(text(h.render()), /not authenticated/); assert.doesNotMatch(text(h.render()), /暂无/);
button(h.render(), "重试").props.onClick(); h.render(); await flush(); h.accesses.at(-1).resolve({ ...access, available: false }); await flush(); assert.equal(h.reads.length, 0); assert.match(text(h.render()), /暂不支持/);
h = harness(); h.render(); await flush(); h.accesses[0].resolve(access); await flush(); assert.equal(h.reads[0].tab, "all"); assert.equal(h.reads[0].cursor, null);
h.reads[0].resolve(page(["real.pdf"], "next")); await flush(); assert.match(text(h.render()), /real.pdf/);
const more = button(h.render(), "加载更多"); more.props.onClick(); more.props.onClick(); assert.equal(h.reads.length, 2);
h.reads.at(-1).reject(Error("page failed")); await flush(); assert.match(text(h.render()), /page failed/); assert.match(text(h.render()), /real.pdf/);
button(h.render(), "重试加载").props.onClick(); h.reads.at(-1).resolve(page(["real.pdf", "second.pdf"], "last")); await flush(); assert.equal(nodes(h.render()).filter(node => node.type === "tr").length, 3);
button(h.render(), "加载更多").props.onClick(); h.reads.at(-1).resolve(page(["third.pdf"], "last")); await flush(); assert.match(text(h.render()), /重复分页/); assert.doesNotMatch(text(h.render()), /third.pdf/);
button(h.render(), "重试加载").props.onClick(); const oldRead = h.reads.at(-1); h.invalidate(); assert.equal(oldRead.signal.aborted, true); h.render(); oldRead.resolve(page(["old account"])); await flush(); assert.doesNotMatch(text(h.render()), /old account|real.pdf/);
h.accesses.at(-1).resolve(access); await flush(); const last = h.reads.at(-1); h.unmount(); const writes = h.writes; last.resolve(page(["unmounted"])); await flush(); assert.equal(h.writes, writes);
h = harness(); h.render(); await flush(); h.accesses[0].resolve(access); await flush(); h.reads[0].resolve(page([])); await flush(); assert.match(text(h.render()), /暂无内容/);
h = harness(); h.render(); await flush(); h.accesses[0].resolve(access); await flush(); h.reads[0].resolve(page([], "page-2")); await flush();
assert.doesNotMatch(text(h.render()), /资料库中暂无内容/, "empty nonterminal page must not claim entire library is empty");
assert.ok(button(h.render(), "加载更多"));
button(h.render(), "加载更多").props.onClick(); h.reads.at(-1).resolve(page(["after-empty.pdf"])); await flush();
assert.match(text(h.render()), /after-empty.pdf/);
const source = fs.readFileSync("src/components/LibraryView.tsx", "utf8"); assert.doesNotMatch(source, /DEFAULT_LIBRARY_ITEMS|fakeUpload|localStorage|Date.now|setTimeout|文件已删除|已创建/);
console.log("PASS 18D default Library production JSX: identity/availability-bound actual root reads, loading/error/retry/empty, pagination single-flight/deduplication/retained data/repeated cursor, invalidation and unmount cancellation; no upload/write/preview claims");

h = harness(Error("listener unavailable")); h.render(); await flush();
assert.equal(h.accesses.length, 0, "must not read account data without identity invalidation listener");
assert.match(text(h.render()), /listener unavailable/);
h.setListenError(null); button(h.render(), "重试").props.onClick(); h.render(); await flush();
assert.equal(h.accesses.length, 1, "retry registers listener before data read");
console.log("PASS 18D nonterminal empty page and rejected identity listener with retry");

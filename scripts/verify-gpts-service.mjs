import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = fs.readFileSync("src/components/GptsView.tsx", "utf8");
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const resource = (id, name = id, extra = {}) => ({ resource: { gizmo: { id, display: { name, description: `description ${id}` }, ...extra } } });
const section = (items, cursor = null, id = "featured") => ({ info: { id, title: "真实分类" }, list: { items, cursor } });
const nodes = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(nodes)] : [];
const text = tree => nodes(tree).flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node).includes(label));
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function harness() {
  const hooks = [], effects = [], requests = [], identities = [];
  let cursor = 0, writes = 0, listener, unlistened = 0, opened = 0, closed = 0;
  const dialog = { showModal() { opened++; }, close() { closed++; } };
  const React = {
    createElement: (type, props, ...children) => { if (type === "dialog" && props.ref) props.ref.current = dialog; return { type, props: props ?? {}, children: children.flat(Infinity) }; },
    useState: initial => { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], value => { writes++; hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }]; },
    useRef: initial => { const index = cursor++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
    useEffect: (effect, deps) => { const index = cursor++; const old = hooks[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) { hooks[index] = { deps, cleanup: old?.cleanup }; effects.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = effect(); }); } },
  }; React.default = React;
  const exports = {};
  vm.runInNewContext(output, { exports, AbortController, require: name => {
    if (name === "react") return React;
    if (name.endsWith(".css")) return {};
    if (name === "../bridge") return { tauriListen: (_event, callback) => { listener = callback; return Promise.resolve(() => unlistened++); } };
    if (name === "../chatgptService") return {
      serviceIdentity: signal => { const pending = deferred(); identities.push({ signal, ...pending }); return pending.promise; },
      readChatgptService: (operation, params, identity, signal) => { const pending = deferred(); requests.push({ operation, params, identity, signal, ...pending }); return pending.promise; },
      serviceErrorMessage: error => error.message || error.code,
    };
    assert.fail(name);
  } });
  return { exports, requests, identities,
    render() { cursor = 0; const tree = exports.GptsView(); while (effects.length) effects.shift()(); return tree; },
    invalidate() { listener(); }, unmount() { for (const hook of hooks) hook?.cleanup?.(); },
    get writes() { return writes; }, get unlistened() { return unlistened; }, get opened() { return opened; }, get closed() { return closed; },
  };
}
const identity = { accountId: "account", userId: "user", generation: 1 };
async function boot(h, cuts = [section([resource("g-1", "真实 GPT")], "next")]) {
  h.render(); h.identities.at(-1).resolve(identity); await flush();
  assert.equal(h.requests.at(-1).operation, "gpts_discovery");
  h.requests.at(-1).resolve({ cuts }); await flush(); return h.render();
}
let h = harness();
assert.match(text(h.render()), /正在读取/); assert.doesNotMatch(text(h.render()), /暂无/);
h.identities[0].reject({ code: "not_logged_in" }); await flush(); assert.match(text(h.render()), /not_logged_in/);
button(h.render(), "重试").props.onClick(); h.render(); h.identities.at(-1).resolve(identity); await flush();
h.requests.at(-1).resolve({ wrong: [] }); await flush(); assert.match(text(h.render()), /响应格式/); assert.doesNotMatch(text(h.render()), /暂无/);
for (const code of ["forbidden", "rate_limited"]) {
  button(h.render(), "重试").props.onClick(); h.render(); h.identities.at(-1).resolve(identity); await flush();
  h.requests.at(-1).reject({ code }); await flush(); assert.match(text(h.render()), new RegExp(code));
}
h = harness(); let tree = await boot(h, [section([resource("g-1", "真实 GPT"), resource("hidden", "隐藏项目", { gizmo_type: "snorlax" })], "next")]);
assert.match(text(tree), /真实 GPT/); assert.doesNotMatch(text(tree), /隐藏项目/);
const more = button(tree, "加载更多"); more.props.onClick(); more.props.onClick(); assert.equal(h.requests.length, 2);
assert.equal(h.requests.at(-1).operation, "gpts_category"); assert.equal(h.requests.at(-1).params.cursor, "next");
h.requests.at(-1).reject(Error("分页失败")); await flush(); tree = h.render(); assert.match(text(tree), /分页失败/); assert.match(text(tree), /真实 GPT/);
button(tree, "重试加载").props.onClick(); h.requests.at(-1).resolve(section([resource("g-1", "更新 GPT"), resource("g-2")], "empty-page")); await flush(); tree = h.render();
assert.equal(nodes(tree).filter(node => node.props.className === "gpt-card").length, 2); assert.match(text(tree), /更新 GPT/);
button(tree, "加载更多").props.onClick(); h.requests.at(-1).resolve(section([], "after-empty")); await flush();
assert.equal(h.requests.at(-1).params.cursor, "after-empty");
h.requests.at(-1).resolve(section([resource("g-3")], "mismatch")); await flush(); tree = h.render();
button(tree, "加载更多").props.onClick(); h.requests.at(-1).resolve(section([resource("foreign")], null, "other")); await flush();
assert.match(text(h.render()), /分类在读取期间发生变化/); assert.doesNotMatch(text(h.render()), /foreign/);
let focused = 0;
button(h.render(), "更新 GPT").props.onClick({ currentTarget: { focus() { focused++; } } });
assert.equal(h.requests.at(-1).operation, "gpts_detail"); assert.equal(h.requests.at(-1).params.id, "g-1");
assert.match(text(h.render()), /正在读取详情/); assert.equal(h.opened, 1);
h.requests.at(-1).reject({ code: "not_found" }); await flush(); tree = h.render(); assert.match(text(tree), /not_found/);
const detailDialog = () => nodes(h.render()).find(node => node.type === "dialog");
button(detailDialog(), "重试").props.onClick(); h.requests.at(-1).resolve(resource("g-1", "真实详情")); await flush();
assert.match(text(detailDialog()), /真实详情/); assert.match(text(detailDialog()), /对话服务尚未接通/);
let prevented = false; detailDialog().props.onCancel({ preventDefault() { prevented = true; } }); h.render();
assert.equal(prevented, true); assert.equal(h.closed, 1); assert.equal(focused, 1);
button(h.render(), "更新 GPT").props.onClick({ currentTarget: { focus() {} } }); const oldDetail = h.requests.at(-1); h.render();
h.invalidate(); assert.equal(oldDetail.signal.aborted, true); h.render();
oldDetail.resolve(resource("g-1", "旧账号详情")); await flush(); assert.doesNotMatch(text(h.render()), /旧账号详情/);
h.identities.at(-1).resolve({ ...identity, generation: 2 }); await flush(); const oldCatalog = h.requests.at(-1);
h.unmount(); const writes = h.writes; oldCatalog.resolve({ cuts: [section([resource("late", "离页旧结果")])] }); await flush();
assert.equal(h.writes, writes); assert.equal(oldCatalog.signal.aborted, true); assert.equal(h.unlistened, 1);
h = harness(); await boot(h); button(h.render(), "加载更多").props.onClick(); const oldPage = h.requests.at(-1);
h.invalidate(); h.render(); oldPage.reject(Error("旧账号错误")); await flush(); assert.doesNotMatch(text(h.render()), /旧账号错误/);
const api = h.exports;
assert.throws(() => api.parseGptDiscovery({ cuts: [section([{}])] }), /无法识别/);
assert.throws(() => api.appendGptPage(api.parseGptSection(section([])), api.parseGptSection(section([], null, "other"))), /发生变化/);
h = harness(); assert.match(text(await boot(h, [])), /暂无可显示/);
assert.doesNotMatch(source, /SAMPLE_GPTS|promptStarter|尚未创建|12 月 11|无缝迁移/);
const app = fs.readFileSync("src/App.tsx", "utf8"); assert.ok(app.includes("<GptsView />")); assert.ok(!app.includes("onStartGptChat="));
console.log("PASS GP01/20B production JSX contracts: authentic resources, loading/error/retry/empty, pagination single-flight/deduplication/retained data/empty cursor/mismatch, real detail ID/404/retry/dialog cancellation/focus callbacks, identity invalidation and unmount late-response isolation; native focus and actual HTTP remain unverified");

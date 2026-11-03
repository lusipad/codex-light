import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const compile = path => ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let tick = 0; tick < 18; tick++) await Promise.resolve(); };
const identity = { accountId: "account", userId: "user", generation: 1 };
const summary = (id, extra = {}) => ({ id, name: `环境 ${id}`, version_id: "v1", share_settings: "private", repositories: [{ repository_id: "repo", ref: "main" }], ...extra });
const config = (id = "one", extra = {}) => ({ ...summary(id), status: "ready", network_policy: { type: "disabled" }, ...extra });
const calls = [], repositoryCalls = [], api = {};
vm.runInNewContext(compile("src/cloudEnvironmentService.ts"), { exports: api, require: name => {
  assert.equal(name, "./chatgptService"); return {
    readCloudService: (operation, params, current, signal) => { const pending = deferred(); calls.push({ operation, params, identity: current, signal, ...pending }); return pending.promise; },
    readChatgptService: (operation, params, current, signal) => { const pending = deferred(); repositoryCalls.push({ operation, params, identity: current, signal, ...pending }); return pending.promise; },
    serviceErrorMessage: cause => cause.message || cause.code,
  };
} });
assert.throws(() => api.parseCloudPage({ data: [] }), /无法识别/);
assert.throws(() => api.parseCloudPage({ data: [summary("one", { version_id: "" })], next_cursor: null }), /无法识别/);
let control = new AbortController(); let start = calls.length;
let catalogRead = api.loadCloudCatalog(identity, control.signal);
assert.equal(calls.length - start, 2, "user/workspace first pages start concurrently");
assert.deepEqual(calls.slice(start).map(call => call.params.scope), ["user", "workspace"]);
for (const call of calls.slice(start)) { assert.equal(call.operation, "list"); assert.equal(call.params.limit, 100); assert.equal(call.params.omitDraft, true); assert.equal("cursor" in call.params, false); assert.equal(call.identity, identity); }
calls[start + 1].resolve({ data: [summary("same", { name: "共享记录" })], next_cursor: null });
calls[start].resolve({ data: [summary("same", { name: "个人记录" })], next_cursor: "user-next" }); await flush();
assert.equal(calls.at(-1).params.scope, "user"); assert.equal(calls.at(-1).params.cursor, "user-next");
calls.at(-1).resolve({ data: [], next_cursor: "empty-next" }); await flush(); assert.equal(calls.at(-1).params.cursor, "empty-next");
calls.at(-1).resolve({ data: [summary("two")], next_cursor: null }); let result = await catalogRead;
assert.equal(result.items.length, 2); assert.equal(result.items[0].name, "共享记录"); assert.equal(Object.keys(result.errors).length, 0);
assert.equal(calls.slice(start).filter(call => call.params.scope === "workspace").length, 1, "finished scope must never restart");
start = calls.length; catalogRead = api.loadCloudCatalog(identity, control.signal);
calls[start].resolve({ data: [summary("kept")], next_cursor: "repeat" }); calls[start + 1].reject({ code: "forbidden" }); await flush();
calls.at(-1).resolve({ data: [summary("later")], next_cursor: "repeat" }); result = await catalogRead;
assert.equal(result.items.length, 2); assert.match(result.errors.user, /重复分页游标/); assert.equal(result.errors.workspace, "forbidden");
control = new AbortController(); start = calls.length; catalogRead = api.loadCloudCatalog(identity, control.signal); control.abort();
calls[start].resolve({ data: [summary("late")], next_cursor: "never" }); calls[start + 1].resolve({ data: [], next_cursor: null });
await assert.rejects(catalogRead, /取消/); assert.equal(calls.length, start + 2, "abort cannot start another page");
let nameRead = api.loadRepositoryName("opaque-id", identity, new AbortController().signal);
assert.equal(repositoryCalls.at(-1).operation, "github_repository"); assert.equal(repositoryCalls.at(-1).params.id, "opaque-id"); repositoryCalls.at(-1).resolve({ repository_full_name: "owner/actual-repository" }); assert.equal((await nameRead).name, "owner/actual-repository");
nameRead = api.loadRepositoryName("opaque-id", identity, new AbortController().signal); repositoryCalls.at(-1).reject({ status: 404 }); assert.equal((await nameRead).error, "未知仓库");
const draft = { id: "draft", base_version_id: "v1", revision: 2, repositories: [{ repository_id: "draft-repo", ref: "branch" }], network_policy: { type: "restricted", presets: ["package_managers"], egress_rules: [{ host: "actual.example.invalid" }] },
  install_script: "real draft script", cwd: "/workspace", secrets: [{ name: "API", source: "environment", value: "never-render", target: { environment_variable: "API", allowed_domains: ["allowed.invalid"] } }] };
const detailFixture = config("one", { draft }); const parsed = api.parseCloudDetail(detailFixture, "one", "draft");
assert.equal(parsed.draft.network.hosts[0], "actual.example.invalid"); assert.doesNotMatch(JSON.stringify(parsed), /never-render/);
assert.throws(() => api.parseCloudDetail(detailFixture, "wrong"), /身份不匹配/); assert.throws(() => api.parseCloudDetail(detailFixture, "one", "wrong"), /草稿/);
assert.throws(() => api.parseCloudDetail(config("one", { network_policy: { type: "vpc" } }), "one"), /无法识别/);
assert.equal(api.parseCloudDetail(config("one", { status: "new-server-state" }), "one").status, "new-server-state");

const nodes = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(nodes)] : [];
const text = tree => nodes(tree).flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
const button = (tree, label) => { const value = nodes(tree).find(node => node.type === "button" && text(node) === label); assert.ok(value, `${label} in ${text(tree)}`); return value; };
const uiItem = api.parseCloudSummary(summary("one"));
function harness() {
  const hooks = [], effects = [], accesses = [], catalogs = [], details = [], names = [], timers = new Map();
  let cursor = 0, listener, writes = 0, nextTimer = 0, opened = 0, closed = 0, unlistened = 0;
  const dialog = { showModal() { opened++; }, close() { closed++; } };
  const React = {
    createElement: (type, props, ...children) => { if (type === "dialog" && props.ref) props.ref.current = dialog; return { type, props: props ?? {}, children: children.flat(Infinity) }; },
    useState: initial => { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial; return [hooks[index], value => { writes++; hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }]; },
    useRef: initial => { const index = cursor++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
    useEffect: (effect, deps) => { const index = cursor++; const old = hooks[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) { hooks[index] = { deps, cleanup: old?.cleanup }; effects.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = effect(); }); } },
  }; React.default = React;
  const exports = {};
  vm.runInNewContext(compile("src/components/CloudEnvironmentsView.tsx"), { exports, AbortController,
    localStorage: { getItem() { assert.fail("no fabricated cloud resources"); }, setItem() { assert.fail("no fake resource writes"); } },
    setTimeout(callback, delay) { assert.equal(delay, 300); const id = ++nextTimer; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); },
    require: name => {
      if (name === "react") return React; if (name.endsWith(".css")) return {};
      if (name === "../bridge") return { tauriListen: (_event, callback) => { listener = callback; return Promise.resolve(() => unlistened++); } };
      if (name === "../chatgptService") return {
        cloudServiceAccess: signal => { const pending = deferred(); accesses.push({ signal, ...pending }); return pending.promise; },
        readCloudService: (operation, params, current, signal) => { const pending = deferred(); details.push({ operation, params, identity: current, signal, ...pending }); return pending.promise; },
        serviceErrorMessage: cause => cause.message || cause.code,
      };
      if (name === "../cloudEnvironmentService") return { ...api,
        loadCloudCatalog: (current, signal) => { const pending = deferred(); catalogs.push({ identity: current, signal, ...pending }); return pending.promise; },
        loadRepositoryName: (id, current, signal) => { const pending = deferred(); names.push({ id, identity: current, signal, ...pending }); return pending.promise; },
      };
      assert.fail(name);
    } });
  return { accesses, catalogs, details, names,
    render() { cursor = 0; const tree = exports.CloudEnvironmentsView(); while (effects.length) effects.shift()(); return tree; },
    invalidate() { listener(); }, unmount() { for (const hook of hooks) if (typeof hook?.cleanup === "function") hook.cleanup(); },
    runTimers() { const queued = [...timers.values()]; timers.clear(); queued.forEach(callback => callback()); },
    get timerCount() { return timers.size; }, get writes() { return writes; }, get opened() { return opened; }, get closed() { return closed; }, get unlistened() { return unlistened; },
  };
}
async function boot(h, evidence = "personal-plan-branch", value = { items: [uiItem], errors: {} }) {
  h.render(); h.accesses.at(-1).resolve({ identity, gateEvidence: evidence }); await flush();
  if (evidence === "personal-plan-branch") { h.catalogs.at(-1).resolve(value); await flush(); for (const name of h.names) name.resolve({ name: "owner/actual-repository", error: null }); await flush(); }
  return h.render();
}
let h = harness(); assert.match(text(h.render()), /正在读取/); assert.doesNotMatch(text(h.render()), /没有匹配/);
h.accesses.at(-1).reject({ code: "not_logged_in" }); await flush(); assert.match(text(h.render()), /not_logged_in/);
h = harness(); let tree = await boot(h, "incomplete"); assert.equal(h.catalogs.length, 0); assert.match(text(tree), /资格尚未完成核对/);
const read = button(tree, "读取云环境"); read.props.onClick(); read.props.onClick(); assert.equal(h.catalogs.length, 1);
h.catalogs.at(-1).resolve({ items: [], errors: { workspace: "403" } }); await flush(); assert.match(text(h.render()), /403/); assert.doesNotMatch(text(h.render()), /没有匹配/);
button(h.render(), "重试目录").props.onClick(); h.catalogs.at(-1).resolve({ items: [uiItem], errors: {} }); await flush(); h.names.at(-1).resolve({ name: null, error: "未知仓库" }); await flush(); tree = h.render(); assert.match(text(tree), /未知仓库/); assert.match(text(tree), /资格尚未完成核对/, "HTTP success must never upgrade incomplete official gate");
h = harness(); tree = await boot(h); assert.equal(h.catalogs.length, 1); assert.match(text(tree), /owner\/actual-repository/);
let input = nodes(tree).find(node => node.type === "input"); input.props.onChange({ target: { value: "actual-repository" } }); tree = h.render(); assert.match(text(tree), /环境 one/); assert.equal(h.catalogs.length, 1);
input.props.onChange({ target: { value: "no-match" } }); h.render(); assert.equal(h.timerCount, 1);
input.props.onChange({ target: { value: "other-query" } }); h.render(); assert.equal(h.timerCount, 1); h.runTimers(); assert.equal(h.catalogs.length, 2);
h.catalogs.at(-1).resolve({ items: [uiItem], errors: {} }); await flush(); h.names.at(-1).resolve({ name: "owner/actual-repository", error: null }); await flush(); h.render(); assert.equal(h.timerCount, 0, "same empty search must not refresh forever");
input.props.onChange({ target: { value: "" } }); tree = h.render(); let focused = 0;
button(tree, "环境 one").props.onClick({ currentTarget: { focus() { focused++; } } }); assert.equal(h.details.at(-1).operation, "detail"); assert.equal(h.details.at(-1).params.id, "one");
assert.match(text(h.render()), /正在读取详情/); assert.equal(h.opened, 1);
h.details.at(-1).resolve(config("wrong")); await flush(); assert.match(text(h.render()), /身份不匹配/);
button(h.render(), "重试详情").props.onClick(); h.details.at(-1).resolve(detailFixture); await flush();
assert.equal(h.names.at(-1).id, "draft-repo", "draft-only repositories must resolve their actual service name");
h.names.at(-1).resolve({ name: "owner/draft-repository", error: null }); await flush();
const dialog = () => nodes(h.render()).find(node => node.type === "dialog");
assert.match(text(dialog()), /草稿配置/); assert.match(text(dialog()), /real draft script/); assert.match(text(dialog()), /actual.example.invalid/); assert.doesNotMatch(JSON.stringify(dialog()), /never-render/);
assert.match(text(dialog()), /owner\/draft-repository/);
let prevented = false; dialog().props.onCancel({ preventDefault() { prevented = true; } }); h.render(); assert.equal(prevented, true); assert.equal(focused, 1); assert.equal(h.closed, 1);
button(h.render(), "环境 one").props.onClick({ currentTarget: { focus() {} } }); const oldDetail = h.details.at(-1); h.render(); h.invalidate(); assert.equal(oldDetail.signal.aborted, true); h.render(); oldDetail.resolve(config("one", { name: "旧账号详情" })); await flush(); assert.doesNotMatch(text(h.render()), /旧账号详情/);
h.accesses.at(-1).resolve({ identity: { ...identity, generation: 2 }, gateEvidence: "personal-plan-branch" }); await flush(); const oldCatalog = h.catalogs.at(-1); h.unmount(); const writes = h.writes;
oldCatalog.resolve({ items: [uiItem], errors: {} }); await flush(); assert.equal(h.writes, writes); assert.equal(h.unlistened, 1);
h = harness(); tree = await boot(h);
button(tree, "环境 one").props.onClick({ currentTarget: { focus() {} } }); h.render();
h.details.at(-1).resolve(detailFixture); await flush(); const closedName = h.names.at(-1);
button(h.render(), "关闭").props.onClick(); h.render(); assert.equal(closedName.signal.aborted, true);
let priorWrites = h.writes; closedName.resolve({ name: "owner/closed-detail", error: null }); await flush(); assert.equal(h.writes, priorWrites);
button(h.render(), "环境 one").props.onClick({ currentTarget: { focus() {} } }); h.render();
h.details.at(-1).resolve(detailFixture); await flush(); const replacedName = h.names.at(-1);
button(h.render(), "环境 one").props.onClick({ currentTarget: { focus() {} } }); h.render(); assert.equal(replacedName.signal.aborted, true);
priorWrites = h.writes; replacedName.resolve({ name: "owner/replaced-detail", error: null }); await flush(); assert.equal(h.writes, priorWrites);
h.details.at(-1).resolve(detailFixture); await flush(); const invalidatedName = h.names.at(-1);
h.invalidate(); h.render(); assert.equal(invalidatedName.signal.aborted, true); priorWrites = h.writes;
invalidatedName.resolve({ name: "owner/old-account", error: null }); await flush(); assert.equal(h.writes, priorWrites); assert.doesNotMatch(text(h.render()), /owner\/old-account/);
h = harness(); assert.match(text(await boot(h, "personal-plan-branch", { items: [], errors: {} })), /没有匹配/);
const source = fs.readFileSync("src/components/CloudEnvironmentsView.tsx", "utf8"), app = fs.readFileSync("src/App.tsx", "utf8");
assert.doesNotMatch(source, /DEFAULT_ENVIRONMENTS|codex_cloud_environments|handleToggleStatus|handleResetCache|Date\.now|分配算力|onStartChatInEnv/); assert.doesNotMatch(app, /onStartChatInEnv=/);
console.log("PASS CE01-CE06/CE11 production helpers and JSX: independent full-scope pagination/dedup/cursor loops/partial failure, separate repo resolver, malformed config/draft identity and secret metadata, personal-plan auto/incomplete explicit read, truthful status, local search and one debounced refresh, detail retry/draft priority/dialog callbacks/account and unmount isolation; actual HTTP/native/visual unverified.");

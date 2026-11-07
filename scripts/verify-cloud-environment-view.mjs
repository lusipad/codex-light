import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
} }).outputText;
const walk = node => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(walk)] : [];
const text = node => walk(node).flatMap(item => (item.children ?? []).filter(value => typeof value === "string" || typeof value === "number")).join(" ");
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 40; ++i) await Promise.resolve(); };
const identity = { accountId: "account", userId: "user", generation: 1 };
const access = { identity, available: true, canManage: true, rbacEnabled: false, gateEvidence: "personal-plan" };
const summary = (id = "one", extra = {}) => ({ id, name: `环境 ${id}`, version_id: "v1", share_settings: "private", repositories: [{ repository_id: "repo", ref: "main" }], ...extra });
const config = (id = "one", extra = {}) => ({ ...summary(id), status: "ready", network_policy: { type: "disabled" }, ...extra });

export function cloudEnvironmentHarness({ listenerError, deferredListener = false, embedded = false, onOpenDraft, pendingDraft = null } = {}) {
  const hooks = [], effects = [], layouts = [], calls = [], listeners = [], timers = new Map(), elements = new Map(), events = new Map();
  let cursor = 0, domIndex = 0, writes = 0, clock = 0, nextTimer = 0, tree, unlistened = 0;
  const document = { body: {}, activeElement: null,
    addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
    removeEventListener(name, fn) { events.get(name)?.delete(fn); },
  };
  const window = { innerWidth: 1280, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
  const React = {
    Fragment: Symbol("fragment"),
    createElement(type, props, ...children) {
      if (type === React.Fragment) return children.flat(Infinity);
      if (typeof type === "function") return type({ ...props, children });
      const node = { type, props: props ?? {}, children: children.flat(Infinity) };
      const key = `${domIndex++}:${type}:${props?.key ?? ""}`;
      let element = elements.get(key);
      if (!element) { element = { focus() { document.activeElement = this; }, contains(value) { return value === this; },
        getBoundingClientRect() { return { right: 900, bottom: 200, top: 172 }; },
        querySelector() { return walk(tree).find(n => n.props.role === "menuitem" && !n.props.disabled)?.element; },
      }; elements.set(key, element); }
      node.element = element; element.node = node;
      if (typeof props?.ref === "function") props.ref(element); else if (props?.ref) props.ref.current = element;
      return node;
    },
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial;
      return [hooks[i], value => { writes++; hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return hooks[i] ?? (hooks[i] = { current: initial }); },
  };
  const effect = queue => (fn, deps) => { const i = cursor++, old = hooks[i];
    if (!old || !deps || deps.some((value, j) => !Object.is(value, old.deps?.[j]))) {
      hooks[i] = { deps, cleanup: old?.cleanup }; queue.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn(); });
    }
  };
  React.useEffect = effect(effects); React.useLayoutEffect = effect(layouts); React.default = React;
  const call = (operation, args, signal) => { const pending = deferred(); calls.push({ operation, args, signal, ...pending }); return pending.promise; };
  const data = {};
  vm.runInNewContext(compile("src/cloudEnvironmentService.ts"), { exports: data, require: () => ({ serviceErrorMessage: cause => cause.message || cause.code }) });
  const view = {};
  vm.runInNewContext(compile(process.env.CLOUD_ENVIRONMENT_VIEW_SOURCE ?? "src/components/CloudEnvironmentsView.tsx"), { exports: view, AbortController, document, window,
    localStorage: { getItem() { assert.fail("no fabricated cloud resources"); }, setItem() { assert.fail("no fabricated cloud persistence"); } },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, due: clock + delay, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === "react") return React;
      if (name === "react-dom") return { createPortal: node => node };
      if (name === "lucide-react") return new Proxy({}, { get: (_, key) => String(key) });
      if (name.endsWith(".css")) return {};
      if (name === "../bridge") return { tauriListen: (_event, callback) => {
        const pending = deferred(); listeners.push({ callback, ...pending });
        return listenerError ? Promise.reject(listenerError) : deferredListener ? pending.promise : Promise.resolve(() => unlistened++);
      } };
      if (name === "../cloudEnvironmentAccess") return { readCloudEnvironmentAccess: signal => call("access", [], signal) };
      if (name === "../cloudDraftSession") return { createCloudDraftSession: (environment, names, current, signal) => call("create", [environment, names, current], signal) };
      if (name === "../cloudDraftRepositoryApply") return { pendingRepositoryApplySession: () => pendingDraft };
      if (name === "../chatgptService") return { readCloudService: (operation, params, current, signal) => call(operation, [params, current], signal), serviceErrorMessage: cause => cause.message || cause.code };
      if (name === "../cloudEnvironmentService") return { ...data, loadCloudCatalog: (current, signal) => call("catalog", [current], signal), loadRepositoryName: (id, current, signal) => call("repository", [id, current], signal) };
      assert.fail(name);
    },
  });
  return { calls, listeners, document, data,
    render() { cursor = 0; domIndex = 0; tree = view.CloudEnvironmentsView({ embedded, onOpenDraft }); while (layouts.length) layouts.shift()(); while (effects.length) effects.shift()(); return tree; },
    tick(ms) { clock += ms; for (const [id, timer] of [...timers]) if (timer.due <= clock) { timers.delete(id); timer.callback(); } },
    invalidate() { listeners.at(-1).callback(); },
    key(value) { for (const fn of events.get("keydown") ?? []) fn({ preventDefault() {}, stopPropagation() {}, ...value }); },
    unmount() { for (const hook of hooks) hook?.cleanup?.(); },
    get writes() { return writes; }, get unlistened() { return unlistened; }, get timers() { return [...timers.values()]; },
  };
}
const latest = (h, operation) => h.calls.filter(call => call.operation === operation).at(-1);
const count = (h, operation) => h.calls.filter(call => call.operation === operation).length;
const button = (h, label) => { const node = walk(h.render()).find(n => n.type === "button" && (n.props["aria-label"] === label || text(n) === label)); assert.ok(node, `button ${label}: ${text(h.render())}`); return node; };
const input = h => walk(h.render()).find(n => n.type === "input");
async function boot(h = cloudEnvironmentHarness(), raw = [summary()], overrides = {}, resolveNames = true) {
  h.render(); await flush(); latest(h, "access").resolve({ ...access, ...overrides }); await flush();
  if ({ ...access, ...overrides }.available) {
    latest(h, "catalog").resolve({ items: raw.map(h.data.parseCloudSummary), errors: {} }); await flush();
    if (resolveNames) { h.calls.filter(c => c.operation === "repository").forEach(c => c.resolve({ name: "owner/actual-repository", error: null })); await flush(); }
  }
  h.render(); return h;
}
function open(h, id = "one") { const trigger = button(h, `针对 环境 ${id} 的操作`); trigger.props.onClick({ currentTarget: trigger.element }); button(h, "查看").props.onClick(); h.render(); return trigger; }
let passed = 0;
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`); }

await check("listener confirmation, rejection and late unsubscribe", async () => {
  const h = cloudEnvironmentHarness({ deferredListener: true }); h.render(); await flush(); assert.equal(h.calls.length, 0);
  h.listeners[0].resolve(() => {}); await flush(); assert.equal(h.calls[0].operation, "access"); h.unmount();
  const failed = cloudEnvironmentHarness({ listenerError: Error("listener unavailable") }); failed.render(); await flush(); assert.equal(failed.calls.length, 0); assert.match(text(failed.render()), /listener unavailable/); failed.unmount();
  const late = cloudEnvironmentHarness({ deferredListener: true }); late.render(); late.unmount(); const writes = late.writes; let cleaned = 0;
  late.listeners[0].resolve(() => cleaned++); await flush(); assert.equal(cleaned, 1); assert.equal(late.calls.length, 0); assert.equal(late.writes, writes);
});
await check("access denied/error never exposes incomplete manual bypass; empty is separate from loading/error", async () => {
  const denied = await boot(undefined, [], { available: false, gateEvidence: "incomplete" }); assert.equal(count(denied, "catalog"), 0); assert.match(text(denied.render()), /无法设置云环境/); assert.doesNotMatch(text(denied.render()), /读取云环境|暂无已保存|没有匹配/); denied.unmount();
  const h = cloudEnvironmentHarness(); assert.match(text(h.render()), /正在加载/); await flush(); latest(h, "access").reject(Error("access unavailable")); await flush(); assert.match(text(h.render()), /access unavailable/); assert.doesNotMatch(text(h.render()), /暂无已保存|没有匹配/); h.unmount();
  const empty = await boot(undefined, []); assert.match(text(empty.render()), /暂无已保存的环境/); empty.unmount();
});
await check("scope failure is a visible catalog failure and retry resolves fresh access", async () => {
  const h = cloudEnvironmentHarness(); h.render(); await flush(); latest(h, "access").resolve(access); await flush(); latest(h, "catalog").reject(Error("workspace rejected")); await flush();
  assert.match(text(h.render()), /workspace rejected/); assert.doesNotMatch(text(h.render()), /暂无已保存|没有匹配/);
  button(h, "重试").props.onClick(); h.render(); await flush(); assert.equal(count(h, "access"), 2); latest(h, "access").resolve(access); await flush(); latest(h, "catalog").resolve({ items: [], errors: {} }); await flush(); assert.match(text(h.render()), /暂无已保存/); h.unmount();
});
await check("sharing states, description, revision-one badge, first repository plus count and repository skeleton", async () => {
  const h = await boot(undefined, [summary("one", { description: "真实说明", version_revision: 1, repositories: [{ repository_id: "repo", ref: "main" }, { repository_id: "repo2", ref: "next" }] }), summary("two", { share_settings: "workspace" }), summary("three", { share_settings: "workspace", is_owner: true }), summary("four", { share_settings: "workspace", is_owner: false })], {}, false);
  const rendered = text(h.render()); for (const label of ["真实说明", "未发布", "私有", "共享", "由你共享", "与你共享"]) assert.ok(rendered.includes(label), label);
  assert.match(rendered, /\+\s*1\s*个仓库/); assert.ok(walk(h.render()).some(n => n.props["aria-label"] === "正在加载代码仓库…")); h.calls.filter(c => c.operation === "repository").forEach(c => c.resolve({ name: null, error: "未知仓库" })); await flush(); assert.match(text(h.render()), /未知代码仓库/); h.unmount();
});
await check("repository search and stable 300ms no-match refresh happens once", async () => {
  const h = await boot(); input(h).props.onChange({ target: { value: " ACTUAL-repository " } }); assert.match(text(h.render()), /环境 one/); assert.equal(count(h, "catalog"), 1);
  input(h).props.onChange({ target: { value: "missing" } }); h.render(); assert.equal(h.timers.length, 1); assert.equal(h.timers[0].delay, 300); h.tick(299); assert.equal(count(h, "catalog"), 1);
  input(h).props.onChange({ target: { value: "other" } }); h.render(); h.tick(1); assert.equal(count(h, "catalog"), 1); h.tick(299); assert.equal(count(h, "catalog"), 2);
  latest(h, "catalog").resolve({ items: [h.data.parseCloudSummary(summary())], errors: {} }); await flush(); latest(h, "repository").resolve({ name: "owner/actual-repository", error: null }); await flush(); assert.match(text(h.render()), /没有匹配/); h.tick(1000); assert.equal(count(h, "catalog"), 2); h.unmount();
});
await check("pending old repository lookup cannot block a no-match refresh or overwrite refreshed names", async () => {
  const h = await boot(undefined, [summary()], {}, false); const oldName = latest(h, "repository");
  input(h).props.onChange({ target: { value: "current-repository" } }); h.render(); h.tick(300);
  assert.equal(count(h, "catalog"), 2, "repository lookup must not keep the catalog refresh busy");
  latest(h, "catalog").resolve({ items: [h.data.parseCloudSummary(summary())], errors: {} }); await flush(); const currentName = latest(h, "repository"); assert.notEqual(currentName, oldName);
  currentName.resolve({ name: "owner/current-repository", error: null }); await flush(); assert.match(text(h.render()), /owner\/current-repository/);
  const writes = h.writes; oldName.resolve({ name: "owner/stale-repository", error: null }); await flush(); assert.equal(h.writes, writes); assert.match(text(h.render()), /owner\/current-repository/); assert.doesNotMatch(text(h.render()), /stale-repository/); h.unmount();
});
await check("menu View opens same-page detail; wrong identity rejects and retry uses draft while omitting secret values", async () => {
  const h = await boot(); open(h); assert.equal(latest(h, "detail").args[0].id, "one"); assert.match(text(h.render()), /正在载入环境/); assert.equal(walk(h.render()).some(n => n.type === "dialog" || n.props.role === "dialog"), false);
  latest(h, "detail").resolve(config("wrong")); await flush(); assert.match(text(h.render()), /身份不匹配/); button(h, "重试").props.onClick();
  latest(h, "detail").resolve(config("one", { install_script: "published script", draft: { id: "draft", base_version_id: "v1", revision: 2, repositories: [{ repository_id: "draft-only", ref: "draft-branch" }], network_policy: { type: "restricted", presets: ["package_managers"], egress_rules: [{ host: "actual.example.invalid" }] }, install_script: "real draft script", cwd: "/workspace", secrets: [{ name: "API", source: "environment", value: "never-render", target: { environment_variable: "API", allowed_domains: ["allowed.invalid"] } }] } })); await flush();
  assert.equal(latest(h, "repository").args[0], "draft-only"); latest(h, "repository").resolve({ name: "owner/draft-repository", error: null }); await flush();
  const rendered = text(h.render()); assert.match(rendered, /real draft script/); assert.match(rendered, /draft-branch/); assert.match(rendered, /owner\/draft-repository/); assert.match(rendered, /actual.example.invalid/); assert.doesNotMatch(rendered, /published script|never-render/); assert.equal(button(h, "保存更改").props.disabled, true); h.unmount();
});
await check("cancel aborts detail and returns focus to row menu trigger; late completion cannot write", async () => {
  const h = await boot(); open(h); const pending = latest(h, "detail"); button(h, "取消").props.onClick(); h.render(); assert.equal(pending.signal.aborted, true); assert.equal(h.document.activeElement?.node?.props["aria-label"], "针对 环境 one 的操作");
  const writes = h.writes; pending.resolve(config("one", { name: "closed detail" })); await flush(); assert.equal(h.writes, writes); assert.doesNotMatch(text(h.render()), /closed detail/); h.unmount();
});
await check("closing while a draft repository resolves prevents stale names; unmount prevents late access/detail writes", async () => {
  const h = await boot(); open(h); latest(h, "detail").resolve(config("one", { repositories: [{ repository_id: "draft-late", ref: "main" }] })); await flush(); const name = latest(h, "repository");
  button(h, "取消").props.onClick(); h.render(); assert.equal(name.signal.aborted, true); const writes = h.writes;
  name.resolve({ name: "owner/closed-detail", error: null }); await flush(); assert.equal(h.writes, writes); assert.doesNotMatch(text(h.render()), /closed-detail/);
  open(h); const detail = latest(h, "detail"); h.unmount(); assert.equal(detail.signal.aborted, true); const detailWrites = h.writes; detail.resolve(config("one", { name: "unmounted detail" })); await flush(); assert.equal(h.writes, detailWrites);
  const lateAccess = cloudEnvironmentHarness(); lateAccess.render(); await flush(); const pendingAccess = latest(lateAccess, "access"); lateAccess.unmount(); assert.equal(pendingAccess.signal.aborted, true); const accessWrites = lateAccess.writes;
  pendingAccess.resolve(access); await flush(); assert.equal(lateAccess.writes, accessWrites); assert.equal(count(lateAccess, "catalog"), 0);
});
await check("account invalidation/unmount abort details and repository names without stale writes", async () => {
  const h = await boot(); open(h); latest(h, "detail").resolve(config("one", { repositories: [{ repository_id: "detail-only", ref: "main" }] })); await flush(); const name = latest(h, "repository");
  h.invalidate(); assert.equal(name.signal.aborted, true); const writes = h.writes; name.resolve({ name: "owner/previous-account", error: null }); await flush(); assert.equal(h.writes, writes); h.render(); await flush(); assert.doesNotMatch(text(h.render()), /previous-account/);
  latest(h, "access").resolve({ ...access, identity: { ...identity, generation: 2 } }); await flush(); const catalog = latest(h, "catalog"); h.unmount(); const stoppedWrites = h.writes; catalog.resolve({ items: [h.data.parseCloudSummary(summary())], errors: {} }); await flush(); assert.equal(h.writes, stoppedWrites); assert.ok(h.unlistened >= 1);
});
await check("menu Escape restores focus while IME composition does not close menu", async () => {
  const h = await boot(); const trigger = button(h, "针对 环境 one 的操作"); trigger.props.onClick({ currentTarget: trigger.element }); h.render(); h.key({ key: "Escape", isComposing: true }); assert.ok(walk(h.render()).some(n => n.props.role === "menu")); h.key({ key: "Escape" }); assert.equal(walk(h.render()).some(n => n.props.role === "menu"), false); assert.equal(h.document.activeElement, trigger.element); h.unmount();
});
await check("readonly environment menus omit editing while keeping the real detail entry", async () => {
  for (const share of ["private", "workspace"]) for (const owner of [undefined, true, false]) for (const manages of [true, false]) {
    const h = await boot(undefined, [summary("one", { share_settings: share, ...(owner === undefined ? {} : { is_owner: owner }), version_revision: 1 })], { rbacEnabled: true, canManage: manages });
    const trigger = button(h, "针对 环境 one 的操作"); trigger.props.onClick({ currentTarget: trigger.element });
    const menu = walk(h.render()).find(node => node.props.role === "menu");
    const editable = share === "workspace" ? manages : owner !== false;
    assert.equal(walk(menu).some(node => node.props.role === "menuitem" && text(node) === "继续设置"), editable);
    button(h, "查看").props.onClick(); await flush(); assert.equal(count(h, "detail"), 1); h.unmount();
  }
});
await check("edit and continue create once, then navigate with the confirmed session", async () => {
  for (const embedded of [false, true]) {
    const opened = [];
    const h = await boot(cloudEnvironmentHarness({ embedded, onOpenDraft: (...args) => opened.push(args) }), [summary("one", { version_revision: 1 })]);
    const trigger = button(h, "针对 环境 one 的操作");
    trigger.props.onClick({ currentTarget: trigger.element });
    const action = button(h, "继续设置");
    assert.equal(action.props.disabled, false);
    action.props.onClick(); action.props.onClick();
    assert.equal(count(h, "create"), 1);
    assert.match(text(h.render()), /正在创建环境草稿/);
    assert.equal(latest(h, "create").args[0].id, "one");
    assert.equal(latest(h, "create").args[1].repo, "owner/actual-repository");
    const session = { threadId: "thread-one", binding: { configId: "one" }, identity };
    latest(h, "create").resolve({ session, persisted: true }); await flush();
    assert.deepEqual(opened, [[session, true]]);
    h.unmount();
  }
});
await check("an invalidated edit request cannot open its late receipt", async () => {
  const h = await boot(cloudEnvironmentHarness({ onOpenDraft: () => assert.fail("stale navigation") }));
  const trigger = button(h, "针对 环境 one 的操作");
  trigger.props.onClick({ currentTarget: trigger.element });
  button(h, "编辑").props.onClick();
  const pending = latest(h, "create");
  h.invalidate(); assert.equal(pending.signal.aborted, true);
  pending.resolve({ session: { threadId: "previous-account" }, persisted: true }); await flush();
  h.unmount();
});
await check("a pending repository application reopens its existing draft instead of creating a new one", async () => {
  const pendingDraft = { threadId: "existing", binding: { configId: "one" }, identity };
  const opened = [];
  const h = await boot(cloudEnvironmentHarness({ pendingDraft, onOpenDraft: (...args) => opened.push(args) }));
  const trigger = button(h, "针对 环境 one 的操作");
  trigger.props.onClick({ currentTarget: trigger.element });
  button(h, "编辑").props.onClick();
  await flush();
  assert.deepEqual(opened, [[pendingDraft, true]]);
  assert.equal(count(h, "create"), 0);
  h.unmount();
});
console.log(`PASS ${passed} cloud environment production JSX/hook scenarios; ReactDOM, bridge/access/service transport and lucide are explicit offline boundaries. HTTP, native UI, physical IME and pixel parity remain unverified.`);

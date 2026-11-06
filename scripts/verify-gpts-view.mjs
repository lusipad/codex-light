import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
} }).outputText;
const walk = node => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === "object"
  ? [node, ...(node.children ?? []).flatMap(walk)] : [];
const text = tree => walk(tree).flatMap(node => (node.children ?? []).filter(child => typeof child === "string" || typeof child === "number")).join(" ");
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const resource = (id, name = id, extra = {}) => ({ gizmo: { id, display: { name, description: `description ${id}` },
  author: { display_name: "real creator" }, tags: [], ...extra }, tools: [{ type: "browser" }] });
const section = (items, cursor = null, id = "featured", extra = {}) => ({ info: { id, title: "真实分类", ...extra }, list: { items: items.map(resource => ({ resource })), cursor } });
const identity = { accountId: "account", userId: "user", generation: 1 };
const access = { identity, available: true, seatAccess: false, newLayout: false, refreshDetails: false, isWorkspaceOwner: false };

export function gptsHarness({ listenerError, deferredListener = false, href = "https://fixture.invalid/gpts?view=public&keep=1#hash", component = "GptsView", props = {} } = {}) {
  const contexts = new Map(), effects = [], layouts = [], listeners = [], calls = [], timers = new Map();
  const domEvents = new Map(), windowEvents = new Map(), elements = new Map();
  let owner, used, writes = 0, clock = 0, nextTimer = 0, tree, commitInert = false, replaces = 0, unlistened = 0;
  const document = { body: { style: { overflow: "scroll" } }, activeElement: null,
    addEventListener(name, callback) { if (!domEvents.has(name)) domEvents.set(name, new Set()); domEvents.get(name).add(callback); },
    removeEventListener(name, callback) { domEvents.get(name)?.delete(callback); },
  };
  const window = { location: { href }, history: { state: { preserved: true }, replaceState(state, _title, url) {
    assert.equal(state, window.history.state); replaces++; window.location.href = String(url);
  } }, addEventListener(name, callback) { windowEvents.set(name, callback); },
    removeEventListener(name, callback) { if (windowEvents.get(name) === callback) windowEvents.delete(name); },
    matchMedia() { return { matches: false }; },
  };
  function renderComponent(type, props) {
    const previous = owner;
    const key = `${previous?.key ?? "root"}/${type.name}:${props?.key ?? (previous ? previous.childIndex++ : 0)}`;
    if (!contexts.has(key)) contexts.set(key, { key, hooks: [], cursor: 0, childIndex: 0 });
    owner = contexts.get(key); owner.cursor = 0; owner.childIndex = 0; used.add(key);
    const result = type(props); owner = previous; return result;
  }
  const React = {
    Fragment: Symbol("fragment"),
    createElement(type, props, ...children) {
      if (type === React.Fragment) return children.flat(Infinity);
      if (typeof type === "function") return renderComponent(type, { ...props, children: children.flat(Infinity) });
      const node = { type, props: props ?? {}, children: children.flat(Infinity) };
      const key = `${owner?.key}/${owner ? owner.domIndex++ : 0}:${type}:${props?.key ?? ""}`;
      let element = elements.get(key);
      if (!element) { element = { isConnected: true, attributes: {},
        focus() { if (!commitInert || this.inDialog) document.activeElement = this; },
        removeAttribute(name) { delete this.attributes[name]; this.removed = name; },
        scrollIntoView(options) { this.scrolled = options; },
        querySelectorAll() { return walk(tree).filter(n => n.props.role === "dialog").flatMap(dialog => walk(dialog))
          .filter(n => n.type === "button" && !n.props.disabled).map(n => n.element); },
        contains(target) { return this.querySelectorAll().includes(target); },
      }; elements.set(key, element); }
      element.disabled = props?.disabled; element.node = node;
      if (props?.src) element.attributes.src = props.src;
      node.element = element;
      if (typeof props?.ref === "function") props.ref(element); else if (props?.ref) props.ref.current = element;
      return node;
    },
    useState(initial) { const current = owner, i = current.cursor++; if (!(i in current.hooks)) current.hooks[i] = typeof initial === "function" ? initial() : initial;
      return [current.hooks[i], value => { writes++; current.hooks[i] = typeof value === "function" ? value(current.hooks[i]) : value; }]; },
    useRef(initial) { const current = owner, i = current.cursor++; return current.hooks[i] ?? (current.hooks[i] = { current: initial }); },
    useCallback(fn, deps) { const current = owner, i = current.cursor++, old = current.hooks[i];
      if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) current.hooks[i] = { fn, deps }; return current.hooks[i].fn; },
  };
  const effect = queue => (fn, deps) => { const current = owner, i = current.cursor++, old = current.hooks[i];
    if (!old || !deps || deps.some((v, j) => !Object.is(v, old.deps?.[j]))) {
      current.hooks[i] = { deps, cleanup: old?.cleanup }; queue.push(() => { current.hooks[i].cleanup?.(); current.hooks[i].cleanup = fn(); });
    }
  };
  React.useEffect = effect(effects); React.useLayoutEffect = effect(layouts); React.default = React;
  const modules = new Map();
  const call = (operation, args, signal) => { const pending = deferred(); calls.push({ operation, args, signal, ...pending }); return pending.promise; };
  const load = file => {
    if (modules.has(file)) return modules.get(file); const exports = {}; modules.set(file, exports);
    const compiled = compile(file) + (file.endsWith("GptsView.tsx") ? "\nexports.__GptDetail = GptDetail; exports.__GptAvatar = GptAvatar;" : "");
    vm.runInNewContext(compiled, { exports, AbortController, URL, document, window,
      setTimeout: (callback, ms) => { timers.set(++nextTimer, { callback, due: clock + ms }); return nextTimer; },
      clearTimeout: id => timers.delete(id), require: name => {
        if (name === "react") return React;
        if (name === "react-dom") return { createPortal: node => node };
        if (name === "lucide-react") return new Proxy({}, { get: (_, key) => String(key) });
        if (name.endsWith(".css")) return {};
        if (name === "../gptsData") return load("src/gptsData.ts");
        if (name === "../chatgptService") return { serviceErrorMessage: error => error.message || error.code };
        if (name === "../bridge") return { tauriListen: (_name, callback) => {
          const pending = deferred(); listeners.push({ callback, ...pending });
          return listenerError ? Promise.reject(listenerError) : deferredListener ? pending.promise : Promise.resolve(() => unlistened++);
        } };
        if (name === "../gptsClient") return {
          readGptsAccess: signal => call("access", [], signal),
          readGptsDiscovery: (access, signal) => call("discovery", [access], signal),
          readGptsSearch: (access, query, cursor, signal) => call("search", [access, query, cursor], signal),
          readGptsCategory: (access, section, locale, signal) => call("category", [access, section, locale], signal),
          readGptsDetail: (access, id, signal) => call("detail", [access, id], signal),
          readGptsAbout: (access, id, signal) => call("about", [access, id], signal),
          readGptsAvatar: (asset, access, signal) => call("avatar", [asset, access], signal),
        };
        if (name === "./LibraryStickyHeader") return { LibraryStickyHeader: props => React.createElement("header", null,
          React.createElement("h1", null, props.title), React.createElement("p", null, props.description), props.actions) };
        throw Error(name);
      } }); return exports;
  };
  const data = load("src/gptsData.ts"), view = load("src/components/GptsView.tsx");
  return { calls, listeners, document, window, domEvents, data,
    render() {
      used = new Set(); for (const current of contexts.values()) current.domIndex = 0;
      tree = renderComponent(view[component === "GptsView" ? component : `__${component}`], props);
      for (const [key, current] of contexts) if (!used.has(key)) { current.hooks.forEach(h => h?.cleanup?.()); contexts.delete(key); }
      commitInert = walk(tree).some(node => node.props.className?.startsWith("gpts-view-container") && node.props.inert === true);
      for (const dialog of walk(tree).filter(node => node.props.role === "dialog")) for (const n of walk(dialog)) n.element.inDialog = true;
      while (layouts.length) layouts.shift()(); while (effects.length) effects.shift()(); return tree;
    },
    tick(ms = 250) { clock += ms; for (const [id, timer] of [...timers]) if (timer.due <= clock) { timers.delete(id); timer.callback(); } },
    invalidate() { listeners.at(-1).callback(); },
    key(event) { for (const callback of domEvents.get("keydown") ?? []) callback({ preventDefault() {}, stopPropagation() {}, ...event }); },
    pop(href) { window.location.href = href; windowEvents.get("popstate")?.(); },
    unmount() { for (const current of contexts.values()) current.hooks.forEach(h => h?.cleanup?.()); contexts.clear(); },
    get writes() { return writes; }, get unlistened() { return unlistened; }, get replaces() { return replaces; }, get inert() { return commitInert; },
  };
}
const button = (h, label, inside) => {
  const found = walk(inside ?? h.render()).find(node => node.type === "button" && (node.props["aria-label"] === label || text(node) === label));
  assert.ok(found, `button ${label}`); return found;
};
const card = (h, label) => { const found = walk(h.render()).find(node => node.type === "button" && node.props.className === "gpt-card" && text(node).includes(label)); assert.ok(found, `card ${label}`); return found; };
const latest = (h, operation) => h.calls.filter(call => call.operation === operation).at(-1);
const discovery = (h, cuts, assets = []) => ({ ...h.data.parseGptDiscovery({ cuts, locale: "zh-CN" }), assets });
const page = (h, raw, assets = []) => ({ ...h.data.parseGptSection(raw), assets });
const results = (h, raw, assets = []) => ({ ...h.data.parseGptSearch(raw), assets });
const input = h => walk(h.render()).find(node => node.type === "input" && node.props.type === "search");
async function boot(h = gptsHarness(), cuts = [section([resource("g1", "真实 GPT")], "next")], overrides = {}, assets = []) {
  h.render(); await flush(); latest(h, "access").resolve({ ...access, ...overrides }); await flush();
  latest(h, "discovery").resolve(discovery(h, cuts, assets)); await flush(); h.render(); await flush(); return h;
}

let passed = 0;
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
await check("listener confirmation gates access; failure is visible and late unsubscribe is released", async () => {
  const h = gptsHarness({ deferredListener: true }); h.render(); await flush(); assert.equal(h.calls.length, 0);
  h.listeners[0].resolve(() => {}); await flush(); assert.equal(h.calls[0].operation, "access"); h.unmount();
  const failed = gptsHarness({ listenerError: Error("listener unavailable") }); failed.render(); await flush();
  assert.equal(failed.calls.length, 0); assert.match(text(failed.render()), /listener unavailable/); failed.unmount();
  const late = gptsHarness({ deferredListener: true }); late.render(); late.unmount(); const writes = late.writes; let cleaned = 0;
  late.listeners[0].resolve(() => cleaned++); await flush(); assert.equal(cleaned, 1); assert.equal(late.calls.length, 0); assert.equal(late.writes, writes);
});
await check("loading, access/service errors, retry, malformed data and authentic successful empty remain distinct", async () => {
  const h = gptsHarness(); assert.match(text(h.render()), /正在加载 GPT/); await flush(); latest(h, "access").reject({ code: "not_logged_in" }); await flush();
  assert.match(text(h.render()), /not_logged_in/); assert.doesNotMatch(text(h.render()), /没有可用/);
  for (const code of ["forbidden", "rate_limited", "响应格式无法识别"]) {
    button(h, "重试").props.onClick(); h.render(); await flush(); latest(h, "access").resolve(access); await flush(); latest(h, "discovery").reject(Error(code)); await flush();
    assert.match(text(h.render()), new RegExp(code)); assert.doesNotMatch(text(h.render()), /没有可用/);
  }
  button(h, "重试").props.onClick(); h.render(); await flush(); latest(h, "access").resolve(access); await flush(); latest(h, "discovery").resolve(discovery(h, [])); await flush();
  assert.match(text(h.render()), /没有可用的 GPT|暂无可用的 GPT/); h.unmount();
  for (const denied of [{ available: false }, { seatAccess: true }]) {
    const scoped = gptsHarness(); scoped.render(); await flush(); latest(scoped, "access").resolve({ ...access, ...denied }); await flush();
    assert.equal(scoped.calls.some(c => c.operation === "discovery"), false); assert.match(text(scoped.render()), /暂不支持|尚未授予/); scoped.unmount();
  }
});
await check("actual metadata/snorlax, restricted noninteractive rows, categories and locale are retained", async () => {
  const h = await boot(gptsHarness(), [section([resource("g1", "真实 GPT"), resource("hidden", "隐藏项目", { gizmo_type: "snorlax" }),
    resource("blocked", "限制 GPT", { tags: ["interactions_disabled"] })], "next", "featured", { display_group: "精选", display_type: "featured", description: "真实说明" }),
  section([resource("g2")], null, "second", { display_group: "精选" }), section([resource("g3")], null, "third", { display_group: "写作" })]);
  const tree = h.render(); assert.match(text(tree), /真实 GPT|真实说明|real creator/); assert.doesNotMatch(text(tree), /隐藏项目/);
  const restricted = walk(tree).find(node => node.props.className === "gpt-card gpt-card-restricted");
  assert.equal(restricted.type, "div"); assert.equal(restricted.props.tabIndex, -1); assert.equal(restricted.props.onClick, undefined);
  const navigation = walk(tree).find(node => node.type === "nav"); assert.equal(walk(navigation).filter(n => n.type === "button").length, 2);
  button(h, "写作").props.onClick(); assert.equal(button(h, "写作").props["aria-current"], "true");
  assert.equal(walk(h.render()).filter(node => node.props.className === "gpt-rank").length, 2); h.unmount();
});
await check("category paging single-flight, error retention, retry, duplicate merge, mismatch and loop guards", async () => {
  const h = await boot(); const more = button(h, "查看更多"); more.props.onClick(); more.props.onClick();
  assert.equal(h.calls.filter(c => c.operation === "category").length, 1); assert.equal(latest(h, "category").args[2], "zh-CN");
  latest(h, "category").reject(Error("分页失败")); await flush(); assert.match(text(h.render()), /分页失败|真实 GPT/);
  button(h, "重试").props.onClick(); latest(h, "category").resolve(page(h, section([resource("g1", "更新 GPT"), resource("g2")], "p2"))); await flush();
  assert.equal(walk(h.render()).filter(n => n.props.className === "gpt-card").length, 2); assert.match(text(h.render()), /更新 GPT/);
  button(h, "查看更多").props.onClick(); latest(h, "category").resolve(page(h, section([resource("foreign")], null, "other"))); await flush();
  assert.match(text(h.render()), /分类在读取期间发生变化/); assert.doesNotMatch(text(h.render()), /foreign/);
  button(h, "重试").props.onClick(); latest(h, "category").resolve(page(h, section([resource("loop")], "p2"))); await flush();
  assert.match(text(h.render()), /重复分页游标/); assert.doesNotMatch(text(h.render()), /description loop/); h.unmount();
});
await check("public search waits exactly 250ms, preserves URL state, cancels stale results, supports clear and popstate", async () => {
  const h = await boot(); input(h).props.onChange({ target: { value: " first " } }); h.render(); h.tick(249); assert.equal(latest(h, "search"), undefined);
  h.tick(1); const first = latest(h, "search"); assert.equal(first.args[1], "first"); assert.equal(first.args[2], null);
  assert.equal(new URL(h.window.location.href).searchParams.get("keep"), "1"); assert.equal(new URL(h.window.location.href).hash, "#hash");
  input(h).props.onChange({ target: { value: "second" } }); h.render(); assert.equal(first.signal.aborted, true); h.tick();
  first.resolve(results(h, { items: [resource("stale", "stale search")], cursor: null })); await flush(); assert.doesNotMatch(text(h.render()), /stale search/);
  latest(h, "search").resolve(results(h, { items: [resource("result", "search GPT"), resource("hidden", "搜索隐藏", { gizmo_type: "snorlax" })], cursor: "page2" })); await flush();
  assert.match(text(h.render()), /search GPT|real creator/); assert.doesNotMatch(text(h.render()), /真实 GPT|搜索隐藏/);
  button(h, "查看更多").props.onClick(); assert.equal(latest(h, "search").args[2], "page2"); latest(h, "search").resolve(results(h, { items: [resource("changed")], cursor: "page2" })); await flush();
  assert.match(text(h.render()), /重复分页游标/); assert.match(text(h.render()), /search GPT/);
  input(h).props.onChange({ target: { value: "broken" } }); h.render(); h.tick(); latest(h, "search").reject(Error("search failed")); await flush();
  assert.match(text(h.render()), /search failed/); assert.doesNotMatch(text(h.render()), /未找到 GPT/);
  button(h, "重试").props.onClick(); h.render(); h.tick(); latest(h, "search").resolve(results(h, { items: [], cursor: null })); await flush(); assert.match(text(h.render()), /未找到 GPT/);
  button(h, "清除搜索").props.onClick(); h.render(); assert.equal(new URL(h.window.location.href).searchParams.has("search"), false); assert.match(text(h.render()), /真实 GPT/);
  h.pop("https://fixture.invalid/gpts?search=back&keep=1#hash"); h.render(); h.tick(); assert.equal(latest(h, "search").args[1], "back"); h.unmount();
});
await check("catalog resource opens immediately; about is independent and refresh gate retains metadata on error", async () => {
  const h = await boot(); card(h, "真实 GPT").props.onClick({ currentTarget: card(h, "真实 GPT").element }); h.render(); await flush();
  assert.equal(latest(h, "detail"), undefined, "ordinary public resource does not force a detail request");
  assert.match(text(h.render()), /真实 GPT|网页搜索/); assert.equal(latest(h, "about").args[1], "g1");
  latest(h, "about").reject(Error("about failure")); await flush(); assert.match(text(h.render()), /about failure/); assert.match(text(h.render()), /真实 GPT/);
  button(h, "重试附加信息").props.onClick(); h.render(); latest(h, "about").resolve(h.data.parseGptAbout({ about_blocks: [{ type: "rating", avg: 4.6, count_str: "100+" }] })); await flush();
  assert.match(text(h.render()), /4.6|100\+/); assert.equal(button(h, "开始聊天").props.disabled, true); h.unmount();
  const refreshing = await boot(gptsHarness(), undefined, { refreshDetails: true });
  card(refreshing, "真实 GPT").props.onClick({ currentTarget: card(refreshing, "真实 GPT").element }); refreshing.render(); await flush();
  assert.equal(latest(refreshing, "detail").args[1], "g1"); latest(refreshing, "detail").reject({ code: "not_found" }); await flush();
  assert.match(text(refreshing.render()), /not_found/); assert.match(text(refreshing.render()), /真实 GPT/);
  button(refreshing, "重试详情").props.onClick(); refreshing.render(); latest(refreshing, "detail").resolve({ resource: refreshing.data.parseGptResource(resource("g1", "真实详情")), assets: [] }); await flush();
  assert.match(text(refreshing.render()), /真实详情/); refreshing.unmount();
});
await check("actual ID-only detail branch exposes loading, 404, independent retry and original resource metadata", async () => {
  const scope = new AbortController();
  const h = gptsHarness({ component: "GptDetail", props: { state: { id: "id-only", resource: null, assets: [] }, access, scope: scope.signal, onClose() {} } });
  assert.match(text(h.render()), /正在加载 GPT 详情/); assert.equal(latest(h, "detail").args[1], "id-only");
  latest(h, "detail").reject({ code: "not_found" }); await flush(); assert.match(text(h.render()), /not_found/);
  button(h, "重试").props.onClick(); h.render(); latest(h, "detail").resolve({ resource: h.data.parseGptResource(resource("id-only", "真实 ID 详情")), assets: [] }); await flush();
  assert.match(text(h.render()), /真实 ID 详情/); assert.equal(latest(h, "about").args[1], "id-only");
  assert.equal(h.calls.filter(c => c.operation === "about").length, 1, "detail retry does not reset the independent about query");
  h.unmount(); assert.equal(h.document.body.style.overflow, "scroll");
});
await check("detail Escape/IME/Tab trap, body overflow and focus restoration follow committed inert removal", async () => {
  const h = await boot(); const trigger = card(h, "真实 GPT").element; trigger.focus(); card(h, "真实 GPT").props.onClick({ currentTarget: trigger }); h.render();
  assert.equal(h.inert, true); assert.equal(h.document.body.style.overflow, "hidden");
  latest(h, "about").reject(Error("about trap fixture")); await flush();
  const dialog = walk(h.render()).find(n => n.props.role === "dialog"), controls = dialog.element.querySelectorAll(); assert.equal(controls.length, 2);
  h.document.activeElement = controls.at(-1); let prevented = false;
  h.key({ key: "Tab", preventDefault() { prevented = true; } }); assert.equal(prevented, true); assert.equal(h.document.activeElement, controls[0]);
  h.key({ key: "Tab", shiftKey: true }); assert.equal(h.document.activeElement, controls.at(-1));
  h.document.activeElement = trigger; h.key({ key: "Tab" }); assert.equal(h.document.activeElement, controls[0], "focus outside dialog is redirected inside");
  h.key({ key: "Escape", isComposing: true }); assert.ok(walk(h.render()).some(n => n.props.role === "dialog"));
  h.key({ key: "Escape" }); assert.notEqual(h.document.activeElement, trigger, "inert ancestor blocks immediate focus"); h.render();
  assert.equal(h.inert, false); assert.equal(h.document.activeElement, trigger); assert.equal(h.document.body.style.overflow, "scroll");
  assert.equal(h.domEvents.get("keydown").size, 0); h.unmount();
});
await check("controlled avatar bytes only, decode failure, source change and abort reject late downloads", async () => {
  const grant = { id: "g1", assetKey: "one", sourceRequestId: "catalog", role: "gpt_avatar" };
  const h = await boot(gptsHarness(), undefined, {}, [grant]); const avatar = latest(h, "avatar"); assert.equal(avatar.args[0], grant);
  assert.equal(walk(h.render()).some(n => n.type === "img"), false); avatar.resolve("data:image/png;base64,AAAA"); await flush();
  const image = walk(h.render()).find(n => n.type === "img"); assert.equal(image.props.src, "data:image/png;base64,AAAA"); image.props.onError(); h.render();
  assert.equal(walk(h.render()).some(n => n.type === "img"), false);
  button(h, "查看更多").props.onClick(); const fresh = { ...grant, assetKey: "two", sourceRequestId: "page" };
  latest(h, "category").resolve(page(h, section([resource("g1", "更新头像")], "next2"), [fresh])); await flush(); h.render(); await flush();
  const newest = latest(h, "avatar"); assert.equal(avatar.signal.aborted, true); assert.equal(newest.args[0], fresh);
  h.invalidate(); assert.equal(newest.signal.aborted, true); h.render(); newest.resolve("data:image/png;base64,LATE"); await flush();
  assert.equal(walk(h.render()).some(n => n.type === "img"), false); h.unmount();
});
await check("completed avatar bytes are withdrawn or replaced across catalog/search after detail refresh without touching other cards", async () => {
  for (const replacement of [false, true]) for (const searching of [false, true]) {
    const old = { id: "g1", assetKey: "old", sourceRequestId: "catalog" };
    const other = { id: "g2", assetKey: "other", sourceRequestId: "catalog" };
    const h = await boot(gptsHarness(), [section([resource("g1", "first"), resource("g2", "other")])], { refreshDetails: true }, [old, other]);
    if (searching) {
      input(h).props.onChange({ target: { value: "query" } }); h.render(); h.tick();
      latest(h, "search").resolve(results(h, { items: [resource("g1", "first"), resource("g2", "other")], cursor: null }, [old, other]));
      await flush(); h.render();
    }
    for (const request of h.calls.filter(c => c.operation === "avatar" && !c.signal.aborted)) request.resolve(`data:image/png;base64,${request.args[0].id === "g1" ? "T0xE" : "T1RIRVI="}`);
    await flush(); h.render();
    assert.equal(walk(card(h, "first")).find(n => n.type === "img").props.src, "data:image/png;base64,T0xE");
    const beforeOther = h.calls.filter(c => c.operation === "avatar" && c.args[0].id === "g2").length;
    const trigger = card(h, "first").element; card(h, "first").props.onClick({ currentTarget: trigger }); h.render(); await flush();
    const fresh = { id: "g1", assetKey: "fresh", sourceRequestId: "detail" };
    latest(h, "detail").resolve({ resource: h.data.parseGptResource(resource("g1", "first")), assets: replacement ? [fresh] : [] });
    await flush(); h.render(); await flush();
    for (const request of h.calls.filter(c => c.operation === "avatar" && c.args[0] === fresh)) request.resolve("data:image/png;base64,TkVX");
    await flush(); h.render(); h.key({ key: "Escape" }); h.render();
    const changed = card(h, "first"), image = walk(changed).find(n => n.type === "img");
    assert.equal(image?.props.src, replacement ? "data:image/png;base64,TkVX" : undefined, "latest detail must replace/withdraw already completed catalog/search avatar bytes");
    assert.equal(walk(card(h, "other")).find(n => n.type === "img").props.src, "data:image/png;base64,T1RIRVI=");
    assert.equal(h.calls.filter(c => c.operation === "avatar" && c.args[0].id === "g2").length, beforeOther, "unrelated avatar must not reload");
    assert.equal(h.calls.filter(c => c.operation === "detail").length, 1, "parent synchronization must not restart detail request");
    assert.equal(h.calls.filter(c => c.operation === "about").length, 1, "about remains independent");
    h.unmount();
  }
});
await check("account invalidation and unmount cancel catalog/page/search/detail/about and suppress late writes", async () => {
  const h = await boot(gptsHarness(), undefined, { refreshDetails: true }); button(h, "查看更多").props.onClick(); const oldPage = latest(h, "category");
  card(h, "真实 GPT").props.onClick({ currentTarget: card(h, "真实 GPT").element }); h.render(); const oldDetail = latest(h, "detail"), oldAbout = latest(h, "about");
  h.invalidate(); assert.equal(oldPage.signal.aborted, true); assert.equal(oldDetail.signal.aborted, true); assert.equal(oldAbout.signal.aborted, true); h.render(); await flush();
  oldPage.reject(Error("旧账号错误")); oldDetail.resolve({ resource: h.data.parseGptResource(resource("late", "旧账号详情")), assets: [] }); oldAbout.resolve([]); await flush();
  assert.doesNotMatch(text(h.render()), /旧账号详情|旧账号错误|真实 GPT/);
  latest(h, "access").resolve({ ...access, identity: { ...identity, generation: 2 } }); await flush(); const oldCatalog = latest(h, "discovery");
  h.unmount(); const writes = h.writes; oldCatalog.resolve(discovery(h, [section([resource("late", "离页旧结果")])])); await flush();
  assert.equal(h.writes, writes); assert.equal(oldCatalog.signal.aborted, true); assert.equal(h.unlistened, 2);
  const searching = await boot(); input(searching).props.onChange({ target: { value: "pending" } }); searching.render(); searching.tick(); const pending = latest(searching, "search");
  searching.invalidate(); assert.equal(pending.signal.aborted, true); searching.render(); pending.resolve(results(searching, { items: [], cursor: null })); await flush();
  assert.doesNotMatch(text(searching.render()), /未找到 GPT/); searching.unmount();
});
await check("existing malformed-resource and wrong-category guards remain exercised through the actual decoder", async () => {
  const h = gptsHarness();
  assert.throws(() => h.data.parseGptDiscovery({ cuts: [section([{}])] }), /无法识别/);
  assert.throws(() => h.data.appendGptPage(h.data.parseGptSection(section([])), h.data.parseGptSection(section([], null, "other"))), /发生变化/);
  assert.throws(() => h.data.parseGptSearch({ items: [null] }), /无法识别/);
  h.unmount();
});
console.log(`PASS 20E production GptsView/GptAvatar/GptDetail JSX: ${passed} behavior groups; offline client boundary, committed-inert focus model; browser/native and HTTP are separate`);

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
} }).outputText;
const walk = node => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(walk)] : [];
const text = tree => walk(tree).flatMap(node => (node.children ?? []).filter(child => typeof child === "string" || typeof child === "number")).join(" ");
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const identity = { accountId: "account", userId: "user", generation: 1 };
const access = { identity, enabled: true, workspace: true, editable: true, pinned: true, collectionPreview: false };
const capabilities = { slugChangeEnabled: false, customDomainsEnabled: true };
const raw = (id, extra = {}) => ({ id, title: `站点 ${id}`, slug: id, status: "active", updated_at: "2026-11-03T01:00:00Z", live_url: `https://example.invalid/${id}`,
  sharing: { access_mode: "private", user_count: 1, group_count: 0 }, ...extra });

function harness({ deferredListener = false, listenerError, href = "http://localhost/sites?keep=1#hash", savedMode, props = {}, component = "SitesView" } = {}) {
  const contexts = new Map(), effects = [], layouts = [], calls = [], listeners = [], timers = new Map(), events = new Map(), elements = new Map();
  const disk = new Map(savedMode ? [["sites-view-mode", savedMode]] : []), observers = [], componentProps = new Map();
  let owner, used, tree, writes = 0, clock = 0, timerId = 0, unlistened = 0, currentProps = props;
  const document = { activeElement: null, body: { style: {} }, addEventListener() {}, removeEventListener() {} };
  const window = { location: { href }, history: { state: { kept: true }, pushState(state, _title, url) { assert.equal(state.kept, true); this.state = state; window.location.href = new URL(url, window.location.href).href; }, replaceState(state, _title, url) { assert.equal(state.kept, true); this.state = state; window.location.href = new URL(url, window.location.href).href; } },
    addEventListener(name, callback) { events.set(name, callback); }, removeEventListener(name, callback) { if (events.get(name) === callback) events.delete(name); } };
  function render(type, props) {
    componentProps.set(type.name, props);
    const previous = owner, key = `${previous?.key ?? "root"}/${type.name}:${props?.key ?? (previous ? previous.childIndex++ : 0)}`;
    if (!contexts.has(key)) contexts.set(key, { key, hooks: [] });
    owner = contexts.get(key); owner.cursor = 0; owner.childIndex = 0; owner.domIndex = 0; used.add(key);
    const result = type(props); owner = previous; return result;
  }
  const React = {
    Fragment: Symbol("fragment"),
    createElement(type, props, ...children) {
      if (type === React.Fragment) return children.flat(Infinity);
      if (typeof type === "function") return render(type, { ...props, children: children.flat(Infinity) });
      const node = { type, props: props ?? {}, children: children.flat(Infinity) }, key = `${owner?.key}/${(owner ? owner.domIndex++ : 0)}:${type}:${props?.key ?? ""}`;
      if (!elements.has(key)) elements.set(key, { attributes: {}, isConnected: true, focus() { document.activeElement = this; }, removeAttribute(name) { delete this.attributes[name]; }, scrollIntoView() {}, querySelector() { return null; }, contains(target) { return walk(this.node).some(n => n.element === target); }, showModal() { this.open = true; }, close() { this.open = false; } });
      node.element = elements.get(key); node.element.node = node;
      if (props?.src) node.element.attributes.src = props.src;
      if (typeof props?.ref === "function") props.ref(node.element); else if (props?.ref) props.ref.current = node.element;
      return node;
    },
    useState(initial) { const current = owner, i = current.cursor++; if (!(i in current.hooks)) current.hooks[i] = typeof initial === "function" ? initial() : initial;
      return [current.hooks[i], value => { writes++; current.hooks[i] = typeof value === "function" ? value(current.hooks[i]) : value; }]; },
    useRef(initial) { const current = owner, i = current.cursor++; return current.hooks[i] ?? (current.hooks[i] = { current: initial }); },
    useCallback(fn, deps) { const current = owner, i = current.cursor++, old = current.hooks[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) current.hooks[i] = { value: fn, deps }; return current.hooks[i].value; },
    useMemo(fn, deps) { const current = owner, i = current.cursor++, old = current.hooks[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) current.hooks[i] = { value: fn(), deps }; return current.hooks[i].value; },
  };
  const effect = queue => (fn, deps) => { const current = owner, i = current.cursor++, old = current.hooks[i]; if (!old || !deps || deps.some((v, j) => !Object.is(v, old.deps?.[j]))) {
    current.hooks[i] = { deps, cleanup: old?.cleanup }; queue.push(() => { current.hooks[i].cleanup?.(); current.hooks[i].cleanup = fn(); });
  } };
  React.useEffect = effect(effects); React.useLayoutEffect = effect(layouts); React.default = React;
  const call = (operation, args, signal) => { const pending = deferred(); calls.push({ operation, args, signal, ...pending }); return pending.promise; };
  const modules = new Map();
  const load = file => {
    if (modules.has(file)) return modules.get(file); const exports = {}; modules.set(file, exports);
    vm.runInNewContext(compile(file), { exports, AbortController, URL, document, window,
      IntersectionObserver: class { constructor(callback) { this.callback = callback; this.active = true; observers.push(this); } observe() {} disconnect() { this.active = false; } },
      localStorage: { getItem(key) { assert.equal(key, "sites-view-mode"); return disk.get(key) ?? null; }, setItem(key, value) { assert.equal(key, "sites-view-mode"); disk.set(key, value); } },
      setTimeout(callback, delay) { timers.set(++timerId, { callback, due: clock + delay }); return timerId; }, clearTimeout(id) { timers.delete(id); },
      require: name => {
        if (name === "react") return React;
        if (name === "react-dom") return { createPortal: node => node };
        if (name === "lucide-react") return new Proxy({}, { get: (_, key) => String(key) });
        if (name.endsWith(".css")) return {};
        if (name === "../sitesService" || name === "./sitesService") return load("src/sitesService.ts");
        if (name === "../siteSettingsState" || name === "./siteSettingsState") return load("src/siteSettingsState.ts");
        if (name === "../siteSlugState") return load("src/siteSlugState.ts");
        if (name === "./SiteSlugSettings") return load("src/components/SiteSlugSettings.tsx");
        if (name === "./SiteSettingsForm") return load("src/components/SiteSettingsForm.tsx");
        if (name === "../sitesNavigation") return load("src/sitesNavigation.ts");
        if (name === "../chatgptService") return { serviceErrorMessage: error => error.message || error.code };
        if (name === "../bridge") return { tauriListen: (_name, callback) => { const pending = deferred(), registration = { callback, active: true, ...pending }; listeners.push(registration); return listenerError ? Promise.reject(listenerError) : deferredListener ? pending.promise : Promise.resolve(() => { if (registration.active) { registration.active = false; unlistened++; } }); } };
        if (name === "../sitesClient" || name === "./sitesClient") return {
          readSitesAccess: signal => call("access", [], signal),
          readSitesPage: (access, kind, query, cursor, signal, seen) => call("page", [access, kind, query, cursor, seen], signal),
          readSiteDetail: (access, id, signal) => call("detail", [access, id], signal),
          readSiteSettings: (access, id, signal) => call("settings", [access, id], signal),
          readSiteDomainSettings: (access, id, signal) => call("domain-settings", [access, id], signal),
          readSiteScreenshot: (asset, access, signal) => call("screenshot", [asset, access], signal),
          readSitePin: (access, id, signal) => call("pin-read", [access, id], signal),
          setSitePinned: (access, id, pinned, signal) => call("pin-write", [access, id, pinned], signal),
          saveSiteTitle: (access, id, title, signal) => call("title-write", [access, id, title], signal),
          saveSiteEnvironment: (access, id, patch, signal, baseline) => call("environment-write", [access, id, patch, baseline], signal),
          readSiteEnvironmentSnapshot: (access, id, signal) => call("environment-read", [access, id], signal),
          checkSiteSlug: (access, id, slug, signal) => call("slug-check", [access, id, slug], signal),
          changeSiteSlug: (access, id, slug, signal) => call("slug-write", [access, id, slug], signal),
        };
        if (name === "./LibraryStickyHeader") return { LibraryStickyHeader: p => React.createElement("header", null, React.createElement("h1", null, p.title), p.description, p.navigation, p.actions) };
        if (name === "./ThreadActionsMenu") return { ThreadActionsMenu: p => React.createElement("mock-menu", p) };
        throw Error(name);
      } }); return exports;
  };
  const data = load("src/sitesService.ts"), view = load(component === "SiteSettingsForm" ? "src/components/SiteSettingsForm.tsx" : "src/components/SitesView.tsx");
  return { calls, listeners, data, disk, window, document, view, load, componentProps,
    render(nextProps = currentProps) { currentProps = nextProps; used = new Set(); tree = render(view[component], nextProps);
      for (const [key, current] of contexts) if (!used.has(key)) { current.hooks.forEach(h => h?.cleanup?.()); contexts.delete(key); }
      while (layouts.length) layouts.shift()(); while (effects.length) effects.shift()(); return tree; },
    tick(ms = 300) { clock += ms; for (const [id, timer] of [...timers]) if (timer.due <= clock) { timers.delete(id); timer.callback(); } },
    intersect() { for (const observer of [...observers]) if (observer.active) observer.callback([{ isIntersecting: true }]); },
    invalidate() { for (const registration of [...listeners]) if (registration.active) registration.callback(); }, pop(href) { window.location.href = href; events.get("popstate")?.({ state: window.history.state }); },
    unmount() { for (const current of contexts.values()) current.hooks.forEach(h => h?.cleanup?.()); contexts.clear(); },
    get writes() { return writes; }, get unlistened() { return unlistened; },
  };
}
const latest = (h, operation) => h.calls.filter(c => c.operation === operation).at(-1);
const button = (h, label) => { const found = walk(h.render()).find(n => n.type === "button" && (n.props["aria-label"] === label || text(n) === label)); assert.ok(found, `button ${label} in ${text(h.render())}`); return found; };
const input = h => walk(h.render()).find(n => n.type === "input" && n.props.type === "search");
const page = (h, items = [raw("one")], cursor = null, assets = []) => ({ items: items.map(h.data.parseSite), cursor, assets });
async function boot(h = harness(), overrides = {}, items = [raw("one")], cursor = "next") {
  h.render(); await flush(); latest(h, "access").resolve({ ...access, ...overrides }); await flush(); h.render(); await flush();
  if (latest(h, "page")) { latest(h, "page").resolve(page(h, items, cursor)); await flush(); h.render(); }
  return h;
}
let passed = 0;
const failures = [];
async function check(name, run) { try { await run(); passed++; console.log(`PASS ${name}`); } catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}`, error); } }
await check("listener confirmation precedes reads; failure is visible; late unsubscribe and unmount are released", async () => {
  const h = harness({ deferredListener: true }); h.render(); await flush(); assert.equal(h.calls.length, 0);
  h.listeners[0].resolve(() => {}); await flush(); assert.equal(latest(h, "access").operation, "access"); h.unmount();
  const failed = harness({ listenerError: Error("listener unavailable") }); failed.render(); await flush();
  assert.equal(failed.calls.length, 0); assert.match(text(failed.render()), /listener unavailable/); failed.unmount();
  const late = harness({ deferredListener: true }); late.render(); late.unmount(); const writes = late.writes; let cleaned = 0;
  late.listeners[0].resolve(() => cleaned++); await flush(); assert.equal(cleaned, 1); assert.equal(late.calls.length, 0); assert.equal(late.writes, writes);
});
await check("entry failures and successful empty are distinct; unavailable access never reads a directory", async () => {
  const h = harness(); h.render(); await flush(); latest(h, "access").reject(Error("not_logged_in")); await flush();
  assert.match(text(h.render()), /not_logged_in/); assert.doesNotMatch(text(h.render()), /暂无站点|没有站点/); h.unmount();
  const denied = await boot(harness(), { enabled: false }); assert.equal(denied.calls.some(c => c.operation === "page"), false); denied.unmount();
  const empty = await boot(harness(), {}, [], null); assert.equal(walk(empty.render()).some(n => n.type === "dialog"), false); empty.unmount();
});
await check("conditional tabs and durable view preference do not cache site data", async () => {
  const h = await boot(harness({ savedMode: "invalid" })); const value = text(h.render());
  assert.match(value, /你拥有的/); assert.match(value, /与你共享/); assert.match(value, /已置顶/); assert.doesNotMatch(value, /全部/);
  button(h, "网格视图").props.onClick(); h.render(); assert.equal(h.disk.get("sites-view-mode"), "grid"); h.unmount();
  const minimal = await boot(harness(), { workspace: false, editable: false, pinned: false });
  assert.doesNotMatch(text(minimal.render()), /与你共享|已置顶|全部/); minimal.unmount();
});
await check("owned search is local and standalone query does not write URL; tab changes update view and clear query", async () => {
  const h = await boot(harness(), {}, [raw("one"), raw("two")], null), before = h.calls.length;
  input(h).props.onChange({ target: { value: " TWO " } }); h.render(); h.tick(); await flush();
  assert.equal(h.calls.length, before); assert.match(text(h.render()), /站点 two/); assert.doesNotMatch(text(h.render()), /站点 one/);
  assert.equal(new URL(h.window.location.href).searchParams.has("search"), false);
  button(h, "与你共享").props.onClick(); h.render(); await flush();
  assert.equal(input(h).props.value, ""); assert.equal(new URL(h.window.location.href).searchParams.get("view"), "shared");
  assert.equal(new URL(h.window.location.href).searchParams.get("keep"), "1"); assert.equal(new URL(h.window.location.href).hash, "#hash"); h.unmount();
});
await check("workspace search waits 300 ms and newer queries cancel stale results", async () => {
  const h = await boot(); button(h, "与你共享").props.onClick(); h.render(); await flush();
  latest(h, "page").resolve(page(h, [raw("shared")], null)); await flush(); h.render();
  input(h).props.onChange({ target: { value: "a" } }); h.render(); const before = h.calls.length;
  h.tick(299); await flush(); assert.equal(h.calls.length, before); h.tick(1); await flush();
  const old = latest(h, "page"); assert.equal(old.args[2], "a");
  input(h).props.onChange({ target: { value: "ab" } }); h.render(); assert.equal(old.signal.aborted, true);
  old.resolve(page(h, [raw("old-search")])); await flush(); assert.doesNotMatch(text(h.render()), /old-search/);
  h.tick(); await flush(); latest(h, "page").resolve(page(h, [raw("new-search")])); await flush(); assert.match(text(h.render()), /new-search/); h.unmount();
});
await check("all workspace searches shared remotely, keeps server matches, and rereads cached queries after cancellation", async () => {
  const h = harness({ href: "http://localhost/sites?view=all", props: { collectionNavigation: true } });
  h.render(); await flush(); latest(h, "access").resolve(access); await flush(); h.render(); await flush();
  const owned = h.calls.find(call => call.operation === "page" && call.args[1] === "owned");
  const shared = latest(h, "page");
  owned.resolve(page(h, [raw("owned-match", { title: "MiXeD owned" })])); shared.resolve(page(h, [raw("cached-shared")])); await flush(); h.render();
  input(h).props.onChange({ target: { value: " MiXeD " } }); h.render();
  assert.equal(input(h).props.maxLength, 200); const before = h.calls.length;
  h.tick(299); await flush(); assert.equal(h.calls.length, before); h.tick(1); await flush();
  const first = latest(h, "page"); assert.equal(first.args[1], "shared"); assert.equal(first.args[2], "MiXeD");
  input(h).props.onChange({ target: { value: "Other" } }); h.render(); assert.equal(first.signal.aborted, true);
  first.resolve(page(h, [raw("late-result")])); await flush(); assert.doesNotMatch(text(h.render()), /late-result/);
  h.tick(); await flush(); const second = latest(h, "page"); assert.equal(second.args[2], "Other");
  second.resolve(page(h, [raw("remote-match", { title: "匹配服务端索引的结果" })])); await flush(); h.render();
  assert.match(text(h.render()), /匹配服务端索引的结果/); assert.doesNotMatch(text(h.render()), /MiXeD owned/);
  input(h).props.onChange({ target: { value: "MiXeD" } }); h.render(); const count = h.calls.length;
  h.tick(299); await flush(); assert.equal(h.calls.length, count); h.tick(1); await flush();
  assert.equal(latest(h, "page").args[2], "MiXeD"); assert.notEqual(latest(h, "page"), first);
  assert.equal(h.calls.filter(call => call.operation === "page" && call.args[1] === "owned").length, 1);
  latest(h, "page").resolve(page(h, [raw("server-only-match", { title: "服务端索引命中" })])); await flush(); h.render();
  assert.match(text(h.render()), /服务端索引命中/); assert.match(text(h.render()), /MiXeD owned/); h.unmount();
});

await check("collection alone enables all; URL search round trips while standalone ignores it", async () => {
  const navigation = { canGoBack: true, canGoForward: false, back() {}, forward() {} };
  const h = await boot(harness({ href: "http://localhost/sites?view=all&search=one&keep=1#hash", props: { collectionNavigation: navigation } }));
  assert.match(text(h.render()), /全部/); assert.equal(input(h).props.value, "one");
  input(h).props.onChange({ target: { value: "two" } }); h.render();
  assert.equal(new URL(h.window.location.href).searchParams.get("search"), "two");
  assert.equal(new URL(h.window.location.href).searchParams.get("keep"), "1"); h.unmount();
  const standalone = await boot(harness({ href: "http://localhost/sites?view=all&search=one" }));
  assert.equal(input(standalone).props.value, ""); assert.doesNotMatch(text(standalone.render()), /全部/); standalone.unmount();
});
await check("account invalidation and unmount abort reads; late errors and rows cannot write across identities", async () => {
  const h = await boot(); button(h, "与你共享").props.onClick(); h.render(); await flush(); const old = latest(h, "page");
  h.invalidate(); assert.equal(old.signal.aborted, true); h.render(); await flush();
  old.reject(Error("旧账号错误")); await flush(); assert.doesNotMatch(text(h.render()), /旧账号错误|站点 one/);
  latest(h, "access").resolve({ ...access, identity: { ...identity, generation: 2 } }); await flush(); h.render(); await flush();
  const pending = latest(h, "page"); h.unmount(); const writes = h.writes;
  pending.resolve(page(h, [raw("stale")])); await flush(); assert.equal(h.writes, writes); assert.equal(pending.signal.aborted, true); assert.ok(h.unlistened >= 1);
});
await check("intersection paging is single-flight, failure retains rows and retry merges newest rows", async () => {
  const h = await boot(); const before = h.calls.length; h.intersect(); h.intersect();
  assert.equal(h.calls.length, before + 1); assert.equal(latest(h, "page").args[3], "next");
  latest(h, "page").reject(Error("后页失败")); await flush(); assert.match(text(h.render()), /站点 one|后页失败/);
  assert.match(text(h.render()), /后页失败/); const count = h.calls.length; h.intersect(); assert.equal(h.calls.length, count);
  button(h, "重试").props.onClick(); latest(h, "page").resolve(page(h, [raw("one", { title: "较新标题", updated_at: "2026-11-04T00:00:00Z" }), raw("two")], null));
  await flush(); assert.match(text(h.render()), /较新标题/); assert.equal(walk(h.render()).filter(n => n.type === "article").length, 2); h.unmount();
});
await check("returning to a cached tab preserves a live paging controller without rereading its first page", async () => {
  const h = await boot(); button(h, "与你共享").props.onClick(); h.render(); await flush(); latest(h, "page").resolve(page(h, [raw("shared")], null)); await flush(); h.render();
  const count = h.calls.length; button(h, "你拥有的").props.onClick(); h.render(); await flush(); assert.equal(h.calls.length, count);
  h.intersect(); assert.equal(h.calls.length, count + 1); assert.equal(latest(h, "page").args[3], "next"); h.unmount();
});
const menu = (h, title = "站点 one") => { const found = walk(h.render()).find(n => n.type === "mock-menu" && n.props.triggerAriaLabel === `${title} 的更多操作`); assert.ok(found, `menu ${title}`); return found; };
await check("settings is a route workface; detail failure retries, independent configuration errors retain real domains and masked secrets", async () => {
  const h = await boot(); menu(h).props.onSelect("settings"); h.render(); await flush();
  assert.equal(new URL(h.window.location.href).pathname, "/sites/one/settings"); assert.equal(walk(h.render()).some(n => n.type === "dialog"), false);
  latest(h, "detail").reject(Error("not_found")); await flush(); assert.match(text(h.render()), /not_found/);
  button(h, "重试").props.onClick(); h.render(); await flush(); latest(h, "detail").resolve({ site: h.data.parseSite(raw("one", { live_url: null })), assets: [] }); await flush();
  latest(h, "settings").resolve({ capabilities, environment: null, domains: [{ id: "apex", hostname: "apex.example.invalid", status: "pending", cname: "real-target", ipv4: ["192.0.2.14"], records: [{ type: "TXT", value: "real-proof" }] }], errors: { environment: "environment failed" } }); await flush();
  assert.match(text(h.render()), /environment failed/); assert.match(text(h.render()), /real-target|real-proof/); assert.match(text(h.render()), /192\.0\.2\.14/);
  button(h, "重试").props.onClick(); const first = latest(h, "settings"); button(h, "重试").props.onClick(); assert.equal(latest(h, "settings"), first);
  first.resolve({ capabilities, environment: h.data.parseSiteEnvironment({ project_id: "one", entries: [{ type: "envvar", key: "TOKEN", is_secret: true, value: "never-render" }, { type: "envvar", key: "MODE", is_secret: false, value: "prod" }] }, "one"), environmentSnapshot: { projectId: "one", entries: [{ key: "TOKEN", secret: true, value: null }, { key: "MODE", secret: false, value: "prod" }], revision: 1, updatedAt: null }, domains: [], errors: {} }); await flush();
  assert.ok(walk(h.render()).some(n => n.type === "input" && n.props.value === "prod")); assert.doesNotMatch(JSON.stringify(h.render(), (key, value) => key === "element" || key === "ref" ? undefined : value), /never-render/);
  button(h, "← 网站").props.onClick(); h.render(); assert.equal(new URL(h.window.location.href).pathname, "/sites"); h.unmount();
});
await check("pin mutation is single-flight; unknown write outcome locks repeat writes until explicit GET recovery", async () => {
  const h = await boot(harness(), {}, [raw("one", { is_pinned: false })]);
  menu(h).props.onSelect("pin"); menu(h).props.onSelect("pin"); assert.equal(h.calls.filter(c => c.operation === "pin-write").length, 1);
  latest(h, "pin-write").reject({ code: "site_pin_unconfirmed", message: "unknown write result" }); await flush();
  assert.equal(menu(h).props.items.find(i => i.id === "pin").disabled, true);
  menu(h).props.onSelect("pin"); assert.equal(h.calls.filter(c => c.operation === "pin-write").length, 1);
  button(h, "重新读取置顶状态").props.onClick(); latest(h, "pin-read").resolve(true); await flush(); h.render();
  assert.equal(menu(h).props.items.find(i => i.id === "pin").label, "取消置顶"); assert.equal(menu(h).props.items.find(i => i.id === "pin").disabled, false);
  menu(h).props.onSelect("pin"); assert.equal(latest(h, "pin-write").args[2], false); latest(h, "pin-write").resolve(false); await flush(); h.render(); h.unmount();
});
await check("unknown pin starts with a read; identity change drops old pin results and old finally cannot unlock a new account write", async () => {
  const h = await boot(harness(), {}, [raw("one")]); menu(h).props.onOpenChange(true); assert.equal(h.calls.filter(c => c.operation === "pin-write").length, 0);
  latest(h, "pin-read").resolve(false); await flush(); h.render(); menu(h).props.onSelect("pin"); const old = latest(h, "pin-write");
  h.invalidate(); h.render(); await flush(); latest(h, "access").resolve({ ...access, identity: { ...identity, generation: 2 } }); await flush(); h.render(); await flush();
  latest(h, "page").resolve(page(h, [raw("one", { is_pinned: false })])); await flush(); h.render(); menu(h).props.onSelect("pin"); const fresh = latest(h, "pin-write");
  old.resolve(true); await flush(); h.render(); assert.equal(old.signal.aborted, true); assert.equal(menu(h).props.items.find(i => i.id === "pin").disabled, true);
  menu(h).props.onSelect("pin"); assert.equal(latest(h, "pin-write"), fresh); fresh.resolve(true); await flush(); h.unmount();
});
await check("actual screenshot decoder aborts replaced grants, withdraws old bytes and suppresses late account/unmount results", async () => {
  const scope = new AbortController(), site = raw("image", { screenshot_url: "https://example.invalid/screenshot" });
  const asset = { id: "image", assetKey: "opaque-1", sourceRequestId: "request-1" };
  const h = harness({ component: "SiteScreenshot" }); let props = { site: h.data.parseSite(site), assets: [asset], access, scope: scope.signal };
  h.render(props); const old = latest(h, "screenshot");
  props = { ...props, assets: [{ ...asset, assetKey: "opaque-2", sourceRequestId: "request-2" }] }; h.render(props);
  assert.equal(old.signal.aborted, true); old.resolve("data:image/png;base64,old"); await flush(); assert.equal(walk(h.render(props)).some(n => n.type === "img"), false);
  latest(h, "screenshot").resolve("data:image/png;base64,fresh"); await flush(); let image = walk(h.render(props)).find(n => n.type === "img"); assert.equal(image.props.src, "data:image/png;base64,fresh");
  image.props.onError(); assert.equal(walk(h.render(props)).some(n => n.type === "img"), false);
  props = { ...props, assets: [] }; h.render(props); assert.equal(walk(h.render(props)).some(n => n.type === "img"), false);
  props = { ...props, assets: [{ ...asset, assetKey: "opaque-3" }] }; h.render(props); const pending = latest(h, "screenshot");
  scope.abort(); assert.equal(pending.signal.aborted, true); pending.resolve("data:image/png;base64,late"); await flush(); assert.equal(walk(h.render(props)).some(n => n.type === "img"), false);
  h.unmount(); const writes = h.writes; await flush(); assert.equal(h.writes, writes);
});
await check("sharing counts, URL safety, unpublished status and role restrictions retain source distinctions", async () => {
  const h = await boot(harness(), {}, [raw("one", { live_url: null }), raw("restricted", { sharing: { access_mode: "custom", user_count: 0, group_count: 0, counts_available: false } }), raw("disabled", { status: "suspended", disabled_by: "workspace_admin" })]);
  assert.match(text(h.render()), /未发布/); assert.match(text(h.render()), /受限/);
  assert.equal(h.view.siteSharingText(h.data.parseSite(raw("self", { sharing: { access_mode: "custom", user_count: 0, group_count: 0 } }))), "仅自己可见");
  assert.equal(h.view.siteSharingText(h.data.parseSite(raw("both", { sharing: { access_mode: "custom", user_count: 1, group_count: 2 } }))), "人员和群组");
  assert.equal(walk(h.render()).some(n => n.type === "a" && n.props.href?.includes("/disabled")), false);
  assert.equal(walk(h.render()).some(n => n.type === "a" && n.props.href?.includes("/one")), false);
  h.unmount();
});
await check("fallback shared first-page incompatibility disables only that capability; later errors retain shared rows", async () => {
  const h = await boot(harness(), { workspace: false, editable: true }); button(h, "与你共享").props.onClick(); h.render(); await flush();
  latest(h, "page").reject({ code: "shared_fallback_unavailable", status: 400, message: "不支持共享" }); await flush(); h.render();
  assert.equal(new URL(h.window.location.href).searchParams.has("view"), false); assert.match(text(h.render()), /不支持共享/); assert.doesNotMatch(text(h.render()), /与你共享/); h.unmount();
  const later = await boot(harness(), { workspace: false, editable: true }); button(later, "与你共享").props.onClick(); later.render(); await flush();
  latest(later, "page").resolve(page(later, [raw("shared", { current_user_role: "editor" })], "later")); await flush(); later.render(); later.intersect();
  latest(later, "page").reject({ status: 400, message: "later-400" }); await flush();
  assert.match(text(later.render()), /later-400/); assert.match(text(later.render()), /站点 shared/); assert.match(text(later.render()), /与你共享/); later.unmount();
});
await check("pinned search uses bounded input and 300ms cancellation; paging passes previous cursor history and preserves data on repetition", async () => {
  const h = await boot(); button(h, "已置顶").props.onClick(); h.render(); await flush(); latest(h, "page").resolve(page(h, [raw("pinned", { is_pinned: true })], "pinned-next")); await flush(); h.render();
  assert.equal(input(h).props.maxLength, 200); h.intersect(); const next = latest(h, "page"); assert.equal(next.args[3], "pinned-next"); assert.deepEqual(Array.from(next.args[4]), ["pinned-next"]);
  next.reject(Error("重复分页游标")); await flush(); assert.match(text(h.render()), /站点 pinned/); assert.match(text(h.render()), /重复分页游标/);
  input(h).props.onChange({ target: { value: "new" } }); h.render(); const count = h.calls.length; h.tick(299); assert.equal(h.calls.length, count); h.tick(1); await flush(); assert.equal(latest(h, "page").args[1], "pinned");
  const pending = latest(h, "page"); input(h).props.onChange({ target: { value: "newer" } }); h.render(); assert.equal(pending.signal.aborted, true); h.unmount();
});
await check("popstate cancels prior detail; no late detail/settings can replace the current route", async () => {
  const h = await boot(); menu(h).props.onSelect("settings"); h.render(); await flush(); const old = latest(h, "detail");
  h.pop("http://localhost/sites?keep=1#hash"); h.render(); assert.equal(old.signal.aborted, true);
  old.resolve({ site: h.data.parseSite(raw("one", { title: "旧详情" })), assets: [] }); await flush(); assert.doesNotMatch(text(h.render()), /旧详情/);
  menu(h).props.onSelect("settings"); h.render(); await flush(); latest(h, "detail").resolve({ site: h.data.parseSite(raw("one")), assets: [] }); await flush(); const settings = latest(h, "settings");
  h.invalidate(); h.render(); settings.resolve({ capabilities, environment: [{ key: "old-key", value: "旧配置" }], domains: [], errors: {} }); await flush(); assert.doesNotMatch(text(h.render()), /旧配置|old-key/); h.unmount();
});
await check("production route has no fake deployment data or unconditional dialog; timestamp is actual relative metadata", async () => {
  const source = fs.readFileSync("src/components/SitesView.tsx", "utf8"), app = fs.readFileSync("src/App.tsx", "utf8");
  assert.doesNotMatch(source, /DEFAULT_SITES|codex_sites_data|创建并部署成功|6166bb5|cname\.codex\.app|onStartChatForSite|<dialog/);
  assert.doesNotMatch(app, /onStartChatForSite=/);
  const h = harness(); const now = new Date("2026-11-07T12:00:00+08:00").getTime();
  assert.equal(h.view.siteUpdatedText("2026-11-07T11:59:45+08:00", now), "1 分钟前");
  assert.equal(h.view.siteUpdatedText("2026-11-07T10:00:00+08:00", now), "2 小时前");
  h.unmount();
});
await check("next page replacement uses the newest same-ID screenshot grant rather than the withdrawn first grant", async () => {
  const h = harness(); h.render(); await flush(); latest(h, "access").resolve(access); await flush(); h.render(); await flush();
  const old = { id: "one", assetKey: "old-grant", sourceRequestId: "old-request" }, fresh = { id: "one", assetKey: "new-grant", sourceRequestId: "new-request" };
  latest(h, "page").resolve(page(h, [raw("one", { screenshot_url: "https://example.invalid/old" })], "next", [old])); await flush(); h.render(); await flush();
  latest(h, "screenshot").resolve("data:image/png;base64,old"); await flush(); h.render(); h.intersect();
  latest(h, "page").resolve(page(h, [raw("one", { screenshot_url: "https://example.invalid/new", updated_at: "2026-11-04T00:00:00Z" })], null, [fresh])); await flush(); h.render(); await flush();
  assert.equal(latest(h, "screenshot").args[0].assetKey, "new-grant"); latest(h, "screenshot").resolve("data:image/png;base64,new"); await flush();
  assert.equal(walk(h.render()).find(n => n.type === "img").props.src, "data:image/png;base64,new"); h.unmount();
});
await check("all selects the screenshot grant belonging to the newer merged record across owned and shared pages", async () => {
  const h = harness({ href: "http://localhost/sites?view=all", props: { collectionNavigation: true } }); h.render(); await flush(); latest(h, "access").resolve(access); await flush(); h.render(); await flush();
  const owned = h.calls.find(c => c.operation === "page" && c.args[1] === "owned"), shared = h.calls.find(c => c.operation === "page" && c.args[1] === "shared");
  owned.resolve(page(h, [raw("one", { screenshot_url: "https://example.invalid/old" })], null, [{ id: "one", assetKey: "owned-old", sourceRequestId: "owned-request" }]));
  shared.resolve(page(h, [raw("one", { screenshot_url: "https://example.invalid/new", updated_at: "2026-11-04T00:00:00Z", title: "最新共享站点" })], null, [{ id: "one", assetKey: "shared-new", sourceRequestId: "shared-request" }])); await flush(); h.render(); await flush();
  assert.match(text(h.render()), /最新共享站点/); assert.equal(latest(h, "screenshot").args[0].assetKey, "shared-new"); h.unmount();
});
await check("all does not choose an older shared grant when the owned record is newer", async () => {
  const h = harness({ href: "http://localhost/sites?view=all", props: { collectionNavigation: true } }); h.render(); await flush(); latest(h, "access").resolve(access); await flush(); h.render(); await flush();
  h.calls.find(c => c.operation === "page" && c.args[1] === "owned").resolve(page(h, [raw("one", { screenshot_url: "https://example.invalid/new", updated_at: "2026-11-04T00:00:00Z", title: "最新拥有站点" })], null, [{ id: "one", assetKey: "owned-new", sourceRequestId: "owned-request" }]));
  h.calls.find(c => c.operation === "page" && c.args[1] === "shared").resolve(page(h, [raw("one", { screenshot_url: "https://example.invalid/old" })], null, [{ id: "one", assetKey: "shared-old", sourceRequestId: "shared-request" }])); await flush(); h.render(); await flush();
  assert.match(text(h.render()), /最新拥有站点/); assert.equal(latest(h, "screenshot").args[0].assetKey, "owned-new"); h.unmount();
});
await check("next page screenshot withdrawal removes prior decoded bytes without another asset read", async () => {
  const h = harness(); h.render(); await flush(); latest(h, "access").resolve(access); await flush(); h.render(); await flush();
  latest(h, "page").resolve(page(h, [raw("one", { screenshot_url: "https://example.invalid/old" })], "next", [{ id: "one", assetKey: "old-grant", sourceRequestId: "old-request" }])); await flush(); h.render(); latest(h, "screenshot").resolve("data:image/png;base64,old"); await flush(); h.render();
  const count = h.calls.filter(c => c.operation === "screenshot").length; h.intersect(); latest(h, "page").resolve(page(h, [raw("one", { screenshot_url: null, updated_at: "2026-11-04T00:00:00Z" })], null, [])); await flush(); h.render(); await flush();
  assert.equal(walk(h.render()).filter(n => n.type === "img").length, 0); assert.equal(h.calls.filter(c => c.operation === "screenshot").length, count); h.unmount();
});
await check("detail screenshot withdrawal synchronizes both cached lists and leaves no prior decoded image on return", async () => {
  const h = harness(); h.render(); await flush(); latest(h, "access").resolve(access); await flush(); h.render(); await flush();
  latest(h, "page").resolve(page(h, [raw("one", { screenshot_url: "https://example.invalid/owned" })], null, [{ id: "one", assetKey: "owned", sourceRequestId: "request-owned" }])); await flush(); h.render(); await flush();
  latest(h, "screenshot").resolve("data:image/png;base64,owned"); await flush(); h.render();
  button(h, "与你共享").props.onClick(); h.render(); await flush(); latest(h, "page").resolve(page(h, [raw("one", { screenshot_url: "https://example.invalid/shared" })], null, [{ id: "one", assetKey: "shared", sourceRequestId: "request-shared" }])); await flush(); h.render();
  latest(h, "screenshot").resolve("data:image/png;base64,shared"); await flush(); h.render(); menu(h).props.onSelect("settings"); h.render(); await flush();
  latest(h, "detail").resolve({ site: h.data.parseSite(raw("one", { screenshot_url: null })), assets: [] }); await flush(); h.render();
  latest(h, "settings").resolve({ capabilities, environment: [], domains: [], errors: {} }); await flush(); button(h, "← 网站").props.onClick(); h.render();
  assert.equal(walk(h.render()).filter(n => n.type === "img").length, 0); const count = h.calls.filter(c => c.operation === "screenshot").length;
  button(h, "你拥有的").props.onClick(); h.render(); await flush(); assert.equal(walk(h.render()).filter(n => n.type === "img").length, 0); assert.equal(h.calls.filter(c => c.operation === "screenshot").length, count); h.unmount();
});
await check("URL change entry requires the official gate, settings capability, active status and owner context", async () => {
  for (const gate of [false, true]) for (const enabled of [false, true]) for (const status of ["active", "archived", "suspended", "deleting"]) for (const role of [null, "owner", "editor", "viewer"]) {
    const h = await boot(harness(), { slugChangeAllowed: gate });
    menu(h).props.onSelect("settings"); h.render(); await flush();
    latest(h, "detail").resolve({ site: h.data.parseSite(raw("one", { status, current_user_role: role })), assets: [] }); await flush(); h.render();
    latest(h, "settings").resolve({ capabilities: { slugChangeEnabled: enabled, customDomainsEnabled: false }, environment: [], environmentSnapshot: { projectId: "one", entries: [], revision: 0, updatedAt: null }, domains: null, errors: {} }); await flush();
    const change = walk(h.render()).some(n => n.type === "button" && n.props["aria-label"] === "更改托管站点 URL");
    assert.equal(change, gate && enabled && status === "active" && (role === null || role === "owner"), JSON.stringify({ gate, enabled, status, role }));
    assert.equal(h.calls.some(c => c.operation === "slug-write"), false); h.unmount();
  }
});
await check("settings title is editable through the real source component", async () => {
  const h = await boot(); menu(h).props.onSelect("settings"); h.render(); await flush(); latest(h, "detail").resolve({ site: h.data.parseSite(raw("one")), assets: [] }); await flush();
  latest(h, "settings").resolve({ capabilities, environment: [], environmentSnapshot: { projectId: "one", entries: [], revision: 0, updatedAt: null }, domains: [], errors: {} }); await flush();
  const field = walk(h.render()).find(n => n.type === "input" && n.props["aria-label"] === "站点标题");
  assert.ok(field); assert.notEqual(field.props.readOnly, true); assert.equal(typeof field.props.onChange, "function"); h.unmount();
});
await check("older title readback callback cannot replace the grant paired with newer cached site metadata", async () => {
  const h = await boot(); menu(h).props.onSelect("settings"); h.render(); await flush();
  const site = h.data.parseSite(raw("one", { title: "新缓存标题", updated_at: "2026-11-05T00:00:00Z", screenshot_url: "https://example.invalid/new" }));
  latest(h, "detail").resolve({ site, assets: [{ id: "one", assetKey: "new-grant", sourceRequestId: "new-request" }] }); await flush(); h.render();
  latest(h, "settings").resolve({ capabilities, environment: [], environmentSnapshot: { projectId: "one", entries: [], revision: 0, updatedAt: null }, domains: [], errors: {} }); await flush(); h.render();
  h.componentProps.get("SiteSettingsForm").onSite({ site: h.data.parseSite(raw("one", { title: "旧标题", updated_at: "2026-11-04T00:00:00Z", screenshot_url: "https://example.invalid/old" })), assets: [{ id: "one", assetKey: "old-grant", sourceRequestId: "old-request" }] });
  h.render(); button(h, "← 网站").props.onClick(); h.render(); await flush();
  assert.match(text(h.render()), /新缓存标题/); assert.equal(latest(h, "screenshot").args[0].assetKey, "new-grant"); h.unmount();
});
async function openDomainSettings(result) {
  const h = await boot(); menu(h).props.onSelect("settings"); h.render(); await flush(); latest(h, "detail").resolve({ site: h.data.parseSite(raw("one")), assets: [] }); await flush(); h.render();
  if (result) { latest(h, "settings").resolve(result); await flush(); h.render(); }
  return h;
}
const domainEnvironment = { projectId: "one", entries: [{ key: "MODE", secret: false, value: "dev" }], revision: 1, updatedAt: null };
const domainSettings = (extra = {}) => ({ capabilities, environment: domainEnvironment.entries, environmentSnapshot: domainEnvironment, domains: [], errors: {}, ...extra });
await check("unfetched and false custom-domain capability hide the complete section without a fake empty state", async () => {
  const h = await openDomainSettings(); assert.doesNotMatch(text(h.render()), /自定义域名|暂无域名/);
  latest(h, "settings").resolve(domainSettings({ capabilities: { slugChangeEnabled: true, customDomainsEnabled: false }, domains: null, errors: { environment: "environment failed" } })); await flush();
  assert.doesNotMatch(text(h.render()), /自定义域名/); assert.equal(walk(h.render()).some(n => n.props["aria-label"] === "站点标题"), true);
  button(h, "重试").props.onClick(); h.render(); assert.doesNotMatch(text(h.render()), /自定义域名/);
  latest(h, "settings").resolve(domainSettings({ capabilities: { slugChangeEnabled: false, customDomainsEnabled: false }, domains: null })); await flush(); h.unmount();
});
await check("capability failure has independent single-flight retry which preserves environment snapshot and unsaved draft", async () => {
  const h = await openDomainSettings(domainSettings({ capabilities: null, domains: null, errors: { capabilities: "capability failed" } }));
  assert.match(text(h.render()), /capability failed/); const snapshot = h.componentProps.get("SiteSettingsForm").snapshot;
  walk(h.render()).find(n => n.props["aria-label"] === "值").props.onChange({ target: { value: "unsaved draft" } });
  const retry = button(h, "重试自定义域名"), initialSettings = h.calls.filter(c => c.operation === "settings").length;
  retry.props.onClick(); retry.props.onClick(); assert.equal(h.calls.filter(c => c.operation === "domain-settings").length, 1); assert.equal(latest(h, "domain-settings").args[1], "one");
  latest(h, "domain-settings").resolve({ capabilities, domains: [{ id: "verified", hostname: "verified.example.invalid", status: "pending", cname: "real-target", ipv4: [], records: [] }], errors: {} }); await flush();
  assert.match(text(h.render()), /verified.example.invalid/); assert.doesNotMatch(text(h.render()), /capability failed/);
  assert.equal(h.calls.filter(c => c.operation === "settings").length, initialSettings); assert.equal(h.componentProps.get("SiteSettingsForm").snapshot, snapshot);
  assert.equal(walk(h.render()).find(n => n.props["aria-label"] === "值").props.value, "unsaved draft"); h.invalidate(); h.render(); h.unmount();
});
await check("domain read failure is distinct from capability failure; retry false hides domains without resetting environment errors", async () => {
  const h = await openDomainSettings(domainSettings({ domains: null, errors: { domains: "domain failed", environment: "environment failed" } }));
  assert.match(text(h.render()), /无法读取自定义域名/); assert.doesNotMatch(text(h.render()), /无法读取设置能力/);
  button(h, "重试自定义域名").props.onClick(); latest(h, "domain-settings").resolve({ capabilities: { slugChangeEnabled: false, customDomainsEnabled: false }, domains: null, errors: {} }); await flush();
  assert.doesNotMatch(text(h.render()), /自定义域名|domain failed/); assert.match(text(h.render()), /environment failed/); h.unmount();
});
await check("leaving or switching identity discards old domain capability responses and cannot unlock a new site retry", async () => {
  const h = await openDomainSettings(domainSettings({ capabilities: null, domains: null, errors: { capabilities: "first failed" } }));
  button(h, "重试自定义域名").props.onClick(); const old = latest(h, "domain-settings"); h.pop("http://localhost/sites/two/settings"); h.render(); await flush(); assert.equal(old.signal.aborted, true);
  latest(h, "detail").resolve({ site: h.data.parseSite(raw("two")), assets: [] }); await flush(); h.render(); latest(h, "settings").resolve(domainSettings({ environmentSnapshot: { ...domainEnvironment, projectId: "two" }, capabilities: null, domains: null, errors: { capabilities: "second failed" } })); await flush();
  button(h, "重试自定义域名").props.onClick(); const current = latest(h, "domain-settings"); assert.equal(current.args[1], "two");
  old.resolve({ capabilities, domains: [{ id: "old", hostname: "old.example.invalid", status: "active", records: [], ipv4: [] }], errors: {} }); await flush();
  assert.doesNotMatch(text(h.render()), /old.example.invalid/); assert.equal(button(h, "重试自定义域名").props.disabled, true);
  h.invalidate(); h.render(); assert.equal(current.signal.aborted, true); current.resolve({ capabilities, domains: [{ id: "late", hostname: "late.example.invalid", status: "active", records: [], ipv4: [] }], errors: {} }); await flush();
  assert.doesNotMatch(text(h.render()), /late.example.invalid/); h.unmount();
});
await check("domain and full-settings retries cannot race to overwrite each other's state", async () => {
  const h = await openDomainSettings(domainSettings({ domains: null, errors: { domains: "domain failed", environment: "environment failed" } }));
  const environmentRetry = () => walk(h.render()).find(n => n.type === "button" && text(n) === "重试" && !n.props["aria-label"]);
  button(h, "重试自定义域名").props.onClick(); const initial = h.calls.filter(c => c.operation === "settings").length;
  environmentRetry().props.onClick(); assert.equal(h.calls.filter(c => c.operation === "settings").length, initial);
  latest(h, "domain-settings").reject(Error("capability retry failed")); await flush();
  assert.match(text(h.render()), /无法读取设置能力：\s*capability retry failed/); assert.doesNotMatch(text(h.render()), /无法读取自定义域名：\s*domain failed/);
  environmentRetry().props.onClick(); const retries = h.calls.filter(c => c.operation === "domain-settings").length;
  button(h, "重试自定义域名").props.onClick(); assert.equal(h.calls.filter(c => c.operation === "domain-settings").length, retries);
  latest(h, "settings").resolve(domainSettings({ capabilities: { slugChangeEnabled: false, customDomainsEnabled: false }, domains: null })); await flush(); assert.doesNotMatch(text(h.render()), /自定义域名/); h.unmount();
});
assert.equal(failures.length, 0, failures.map(f => f.name).join("; "));
console.log(`PASS 21E production SitesView/SiteScreenshot JSX: ${passed} groups; offline client/menu/header boundaries; actual HTTP, DOM menu focus, browser/native and pixel parity require separate evidence`);

export { harness, walk, text, flush, latest, button, raw, access, identity };

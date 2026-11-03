import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const compile = path => ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const api = {}; vm.runInNewContext(compile("src/sitesService.ts"), { exports: api, URL });
const record = (id, extra = {}) => ({ id, title: `站点 ${id}`, slug: id, status: "active", updated_at: "2026-11-03T01:00:00Z", live_url: `https://example.invalid/${id}`, sharing: { access_mode: "private", user_count: 1, group_count: 0 }, ...extra });
const page = (items = [record("one")], cursor = null) => ({ items, cursor });
const access = { enabled: true, supports_workspace_listing: true, supports_editable_listing: true };
const identity = { accountId: "account", userId: "user", generation: 1 };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let tick = 0; tick < 18; tick++) await Promise.resolve(); };
const nodes = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(nodes)] : [];
const text = tree => nodes(tree).flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
const button = (tree, label) => { const match = nodes(tree).find(node => node.type === "button" && text(node) === label); assert.ok(match, `button ${label} in ${text(tree)}`); return match; };
function harness(savedMode) {
  const hooks = [], effects = [], requests = [], identities = [], timers = new Map(), disk = new Map(savedMode ? [["sites-view-mode", savedMode]] : []);
  let cursor = 0, listener, writes = 0, timerId = 0, unlistened = 0, opened = 0, closed = 0;
  const dialog = { showModal() { opened++; }, close() { closed++; } };
  const React = {
    createElement: (type, props, ...children) => { if (type === "dialog" && props.ref) props.ref.current = dialog; return { type, props: props ?? {}, children: children.flat(Infinity) }; },
    useState: initial => { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial; return [hooks[index], value => { writes++; hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }]; },
    useRef: initial => { const index = cursor++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
    useEffect: (effect, deps) => { const index = cursor++; const old = hooks[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) { hooks[index] = { deps, cleanup: old?.cleanup }; effects.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = effect(); }); } },
  }; React.default = React;
  const exports = {};
  vm.runInNewContext(compile("src/components/SitesView.tsx"), { exports, AbortController,
    localStorage: { getItem(key) { assert.equal(key, "sites-view-mode", "no fake site cache reads"); return disk.get(key) ?? null; }, setItem(key, value) { assert.equal(key, "sites-view-mode", "only view preference is persisted"); disk.set(key, value); } },
    setTimeout(callback, delay) { assert.equal(delay, 300); const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); },
    require: name => {
      if (name === "react") return React;
      if (name.endsWith(".css")) return {};
      if (name === "../sitesService") return api;
      if (name === "../bridge") return { tauriListen: (_event, callback) => { listener = callback; return Promise.resolve(() => unlistened++); } };
      if (name === "../chatgptService") return {
        serviceIdentity: signal => { const pending = deferred(); identities.push({ signal, ...pending }); return pending.promise; },
        readChatgptService: (operation, params, current, signal) => { const pending = deferred(); requests.push({ operation, params, identity: current, signal, ...pending }); return pending.promise; },
        serviceErrorMessage: error => error.message || error.code,
      };
      assert.fail(name);
    } });
  return { requests, identities, disk,
    render() { cursor = 0; const tree = exports.SitesView(); while (effects.length) effects.shift()(); return tree; },
    invalidate() { listener(); }, unmount() { for (const hook of hooks) if (typeof hook?.cleanup === "function") hook.cleanup(); },
    runTimers() { const queued = [...timers.values()]; timers.clear(); queued.forEach(callback => callback()); },
    get timerCount() { return timers.size; }, get writes() { return writes; }, get unlistened() { return unlistened; }, get opened() { return opened; }, get closed() { return closed; },
  };
}
async function bootstrap(h, capability = access, result = page([record("one")], "owned-next")) {
  h.render(); h.identities.at(-1).resolve(identity); await flush(); assert.equal(h.requests.at(-1).operation, "sites_access");
  h.requests.at(-1).resolve(capability); await flush();
  if (capability.enabled) { assert.equal(h.requests.at(-1).operation, "sites_list"); assert.equal(h.requests.at(-1).params.include_editable, false); assert.equal("after" in h.requests.at(-1).params, false); h.requests.at(-1).resolve(result); await flush(); }
  return h.render();
}
assert.equal(api.parseSitesAccess({ enabled: true }).workspace, false);
assert.throws(() => api.parseSitesAccess({ enabled: true, supports_workspace_listing: "yes" }), /无法识别/);
assert.throws(() => api.parseSitesPage({}), /无法识别/); assert.throws(() => api.parseSitesPage(page([record("x", { updated_at: "invalid" })])), /无法识别/);
assert.throws(() => api.parseSitesPage(page([record("x", { live_url: undefined })])), /无法识别/);
assert.equal(api.safeSiteUrl("javascript:alert(1)"), null); assert.equal(api.safeSiteUrl("https://user:secret@example.invalid"), null); assert.equal(api.safeSiteUrl(null), null);
const merged = api.mergeSites([api.parseSite(record("one"))], [api.parseSite(record("one", { title: "新标题", updated_at: "2026-11-03T02:00:00Z" })), api.parseSite(record("two"))]);
assert.equal(merged.length, 2); assert.equal(merged[0].title, "新标题"); assert.equal(api.filterSites(merged, "新标").length, 1);
assert.equal(api.parseSiteEnvironment({ project_id: "one", entries: [{ key: "TOKEN", type: "envvar", is_secret: true, value: "never-render" }] }, "one")[0].value, null);
assert.throws(() => api.parseSiteEnvironment({ project_id: "foreign", entries: [] }, "one"), /无法识别/);
const apexDomain = { id: "apex", project_id: "one", hostname: "apex.example.invalid", status: "pending", cname_target: null,
  apex_proxy_ipv4_targets: ["192.0.2.14"], validation_records: [] };
assert.equal(api.parseSiteDomains({ items: [apexDomain] }, "one")[0].ipv4[0], "192.0.2.14");
assert.throws(() => api.parseSiteDomains({ items: [{ ...apexDomain, apex_proxy_ipv4_targets: [17] }] }, "one"), /无法识别/);
let h = harness(); assert.match(text(h.render()), /正在读取/); assert.doesNotMatch(text(h.render()), /没有匹配/);
h.identities.at(-1).reject({ code: "not_logged_in" }); await flush(); assert.match(text(h.render()), /not_logged_in/);
h = harness(); assert.match(text(await bootstrap(h, { enabled: false })), /不可使用/); assert.equal(h.requests.length, 1);
h = harness("invalid"); let tree = await bootstrap(h);
assert.equal(button(tree, "列表").props["aria-pressed"], true);
button(tree, "网格").props.onClick(); assert.equal(h.disk.get("sites-view-mode"), "grid");
const more = button(h.render(), "加载更多我的站点"); more.props.onClick(); more.props.onClick(); assert.equal(h.requests.length, 3);
assert.equal(h.requests.at(-1).params.after, "owned-next"); h.requests.at(-1).reject(Error("后页失败")); await flush();
assert.match(text(h.render()), /站点 one/); assert.match(text(h.render()), /后页失败/);
button(h.render(), "重试加载我的站点").props.onClick(); h.requests.at(-1).resolve(page([record("one"), record("two")], null)); await flush();
assert.equal(nodes(h.render()).filter(node => node.type === "article").length, 2);
let search = nodes(h.render()).find(node => node.type === "input"); search.props.onChange({ target: { value: "two" } }); const beforeSearch = h.requests.length;
assert.match(text(h.render()), /站点 two/); assert.doesNotMatch(text(h.render()), /站点 one/); assert.equal(h.requests.length, beforeSearch, "owned search stays local");
search = nodes(h.render()).find(node => node.type === "input"); search.props.onChange({ target: { value: "" } }); h.render();
button(h.render(), "共享").props.onClick(); h.render(); assert.equal(h.requests.at(-1).operation, "sites_shared"); assert.equal("after" in h.requests.at(-1).params, false);
h.requests.at(-1).resolve(page([record("shared")], "shared-next")); await flush(); tree = h.render(); assert.match(text(tree), /站点 shared/);
search = nodes(tree).find(node => node.type === "input"); search.props.onChange({ target: { value: "a" } }); h.render(); assert.equal(h.timerCount, 1);
search.props.onChange({ target: { value: "ab" } }); h.render(); assert.equal(h.timerCount, 1); h.runTimers(); assert.equal(h.requests.at(-1).params.query, "ab");
const oldSearch = h.requests.at(-1); search.props.onChange({ target: { value: "abc" } }); h.render(); assert.equal(oldSearch.signal.aborted, true);
oldSearch.resolve(page([record("old-search")])); await flush(); assert.doesNotMatch(text(h.render()), /old-search/);
h.runTimers(); h.requests.at(-1).resolve(page([record("one", { title: "共享较新", updated_at: "2026-11-03T03:00:00Z" })])); await flush(); h.render();
search.props.onChange({ target: { value: "" } }); h.render(); h.requests.at(-1).resolve(page([record("one", { title: "共享较新", updated_at: "2026-11-03T03:00:00Z" }), record("shared")])); await flush();
button(h.render(), "全部").props.onClick(); tree = h.render(); assert.equal(nodes(tree).filter(node => node.type === "article").length, 3); assert.match(text(tree), /共享较新/);
let focused = 0; button(tree, "共享较新").props.onClick({ currentTarget: { focus() { focused++; } } }); assert.equal(h.requests.at(-1).operation, "sites_detail"); assert.equal(h.requests.at(-1).params.id, "one");
assert.match(text(h.render()), /正在读取详情/); assert.equal(h.opened, 1);
h.requests.at(-1).reject({ code: "not_found" }); await flush(); assert.match(text(h.render()), /not_found/);
button(h.render(), "重试详情").props.onClick(); h.requests.at(-1).resolve(record("one", { live_url: null })); await flush(); tree = h.render();
const dialog = () => nodes(h.render()).find(node => node.type === "dialog"); assert.equal(nodes(dialog()).filter(node => node.type === "a").length, 0, "unpublished URL is not invented");
const settings = button(dialog(), "读取域名与环境变量"); const beforeSettings = h.requests.length; settings.props.onClick(); settings.props.onClick(); assert.equal(h.requests.length, beforeSettings + 2);
h.requests.at(-2).resolve({ project_id: "one", entries: [{ key: "TOKEN", type: "envvar", is_secret: true, value: "never-render" }, { key: "MODE", type: "envvar", is_secret: false, value: "prod" }] });
h.requests.at(-1).resolve({ items: [{ id: "domain", hostname: "real.example.invalid", project_id: "one", status: "pending", cname_target: "real-target.example.invalid", apex_proxy_ipv4_targets: [], ssl_status: "pending", validation_records: [{ record_type: "TXT", value: "real-proof" }] }, apexDomain] }); await flush();
assert.match(text(dialog()), /prod/); assert.match(text(dialog()), /real-target/); assert.match(text(dialog()), /real-proof/); assert.doesNotMatch(JSON.stringify(dialog()), /never-render/);
assert.match(text(dialog()), /192\.0\.2\.14/, "apex DNS targets come from the real service, never a fixed UI address");
let prevented = false; dialog().props.onCancel({ preventDefault() { prevented = true; } }); h.render(); assert.equal(prevented, true); assert.equal(focused, 1); assert.equal(h.closed, 1);
button(h.render(), "共享较新").props.onClick({ currentTarget: { focus() {} } }); const oldDetail = h.requests.at(-1); h.render(); h.invalidate(); assert.equal(oldDetail.signal.aborted, true); h.render();
oldDetail.resolve(record("one", { title: "旧账号详情" })); await flush(); assert.doesNotMatch(text(h.render()), /旧账号详情/);
h.identities.at(-1).resolve({ ...identity, generation: 2 }); await flush(); const oldAccess = h.requests.at(-1); h.unmount(); const writes = h.writes;
oldAccess.resolve(access); await flush(); assert.equal(h.writes, writes); assert.equal(h.unlistened, 1);
h = harness(); tree = await bootstrap(h, { enabled: true, supports_editable_listing: true });
button(tree, "共享").props.onClick(); h.render(); assert.equal(h.requests.at(-1).operation, "sites_list"); assert.equal(h.requests.at(-1).params.after, "sites-shared-projects:");
h.requests.at(-1).reject({ status: 400, code: "service_error" }); await flush(); tree = h.render(); assert.equal(button(tree, "共享").props.disabled, true); assert.equal(button(tree, "我创建的").props["aria-pressed"], true); assert.match(text(tree), /不支持共享/);
h = harness(); await bootstrap(h, { enabled: true, supports_editable_listing: true }); button(h.render(), "共享").props.onClick(); h.render(); h.requests.at(-1).resolve(page([record("shared")], "second")); await flush();
button(h.render(), "加载更多共享站点").props.onClick(); h.requests.at(-1).reject({ status: 400, code: "later-400" }); await flush(); assert.equal(button(h.render(), "共享").props.disabled, false); assert.match(text(h.render()), /站点 shared/); assert.match(text(h.render()), /later-400/);
h = harness(); await bootstrap(h); button(h.render(), "加载更多我的站点").props.onClick(); const oldPage = h.requests.at(-1); h.invalidate(); h.render(); oldPage.reject(Error("旧账号分页错误")); await flush(); assert.doesNotMatch(text(h.render()), /旧账号分页错误/);
h = harness(); assert.match(text(await bootstrap(h, access, page([]))), /没有匹配/);
const source = fs.readFileSync("src/components/SitesView.tsx", "utf8"), app = fs.readFileSync("src/App.tsx", "utf8");
assert.doesNotMatch(source, /DEFAULT_SITES|codex_sites_data|创建并部署成功|6166bb5|cname\.codex\.app|Date\.now|onStartChatForSite/); assert.doesNotMatch(app, /onStartChatForSite=/);
console.log("PASS S01-S07/S10 production parsers and JSX callbacks: capability/error/empty, service-only sites, owned local search, shared debounce/cancel and compatibility branch, pagination single-flight/retained data/deduplication, all sorting, view preference, real detail ID/404/retry/URL safety, configuration read/secret masking, dialog callbacks, identity and unmount isolation. Actual HTTP/native/visual remain unverified.");

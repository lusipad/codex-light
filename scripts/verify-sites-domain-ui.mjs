import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const walk = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(walk)] : [];
const text = node => walk(node).flatMap(n => n.children.filter(c => typeof c === "string")).join(" ");
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const access = { identity: { accountId: "account", userId: "user", generation: 1 }, enabled: true };
const domain = { id: "domain-one", projectId: "one", hostname: "actual.example.invalid", status: "pending", error: null, updatedAt: "2026-11-07T00:00:00Z" };
const site = { id: "one", slug: "old", title: "真实站点", updatedAt: "2026-11-07T00:00:00Z", hostedUrl: "https://old.example.invalid", liveUrl: null };
function harness() {
  const calls = [], timers = new Map(), modules = new Map(), hooks = [], effects = [], events = new Map(); let clock = 0, serial = 0, cursor = 0, tree, writes = 0;
  const document = { visibilityState: "visible", activeElement: null, addEventListener: (n, fn) => events.set(n, fn), removeEventListener: (n, fn) => { if (events.get(n) === fn) events.delete(n); } };
  const window = { addEventListener: document.addEventListener, removeEventListener: document.removeEventListener };
  const call = (operation, args, signal) => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); calls.push({ operation, args, signal, resolve, reject }); return promise; };
  const React = { default: null,
    createElement(type, props, ...children) { const node = { type, props: props ?? {}, children: children.flat(Infinity) }; if (typeof type === "function") return type({ ...props, children: node.children }); const element = { open: false, focus() { document.activeElement = node; }, showModal() { this.open = true; }, close() { this.open = false; } }; if (props?.ref) props.ref.current = element; return node; },
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial; return [hooks[i], value => { writes++; hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return hooks[i] ?? (hooks[i] = { current: initial }); },
    useMemo(fn, deps) { const i = cursor++, old = hooks[i]; if (!old || deps.some((d, j) => !Object.is(d, old.deps[j]))) hooks[i] = { value: fn(), deps }; return hooks[i].value; },
    useEffect(fn, deps) { const i = cursor++, old = hooks[i]; if (!old || deps.some((d, j) => !Object.is(d, old.deps[j]))) { hooks[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn(); }); } },
  }; React.default = React;
  function load(file) { if (modules.has(file)) return modules.get(file); const exports = {}; modules.set(file, exports);
    vm.runInNewContext(compile(file), { exports, AbortController, URL, Date: class extends Date { static now() { return clock; } }, document, window,
      setTimeout(fn, delay) { timers.set(++serial, { fn, due: clock + delay }); return serial; }, clearTimeout: id => timers.delete(id), require: name => {
        if (name === "react") return React; if (name.endsWith(".css")) return {};
        if (name === "lucide-react") return { X: "svg", Clock: "svg", AlertCircle: "svg", LoaderCircle: "svg", RefreshCw: "svg", Trash2: "svg" };
        if (["../siteDomainState"].includes(name)) return load("src/siteDomainState.ts");
        if (["./siteSettingsState"].includes(name)) return load("src/siteSettingsState.ts");
        if (["../sitesService", "./sitesService"].includes(name)) return load("src/sitesService.ts");
        if (["./sitesClient"].includes(name)) return { readSiteDomains: (a, id, s) => call("domains", [a, id], s), refreshSiteDomain: (a, id, d, s) => call("refresh", [a, id, d], s), removeSiteDomain: (a, id, d, s) => call("remove", [a, id, d], s), readSiteDetail: (a, id, s) => call("detail", [a, id], s) };
        throw Error(name);
      } }); return exports; }
  const stateModule = load("src/siteDomainState.ts"), component = load("src/components/SiteDomainSettings.tsx"), errors = [], updated = [], scope = new AbortController();
  const changes = []; const props = { access, siteId: site.id, domains: [domain], scope: scope.signal, onDomains: r => changes.push(r), onSite: r => updated.push(r), onError: message => errors.push(message) };
  return { calls, errors, updated, changes, scope, props, document, stateModule, load,
    state(a = access, d = [domain], signal = scope.signal) { const state = new stateModule.SiteDomainState(a, site.id, d, signal, props.onDomains, props.onSite, props.onError); state.attach(); return state; },
    render(next = props) { cursor = 0; tree = component.SiteDomainSettings(next); while (effects.length) effects.shift()(); return tree; },
    tick(ms) { clock += ms; for (const [id, timer] of [...timers]) if (timer.due <= clock) { timers.delete(id); timer.fn(); } },
    setClock(ms) { clock = ms; }, unmount() { hooks.forEach(h => h?.cleanup?.()); }, get writes() { return writes; },
  };
}
const latest = (h, op) => h.calls.filter(c => c.operation === op).at(-1);
const result = (slug, extra = {}) => ({ site: { ...site, slug, hostedUrl: `https://${slug}.example.invalid`, updatedAt: "2026-11-08T00:00:00Z", ...extra }, assets: [{ id: "one", assetKey: `grant-${slug}`, sourceRequestId: "request" }] });
let passed = 0; const failures = [];
async function check(name, fn) { try { await fn(); passed++; console.log(`PASS ${name}`); } catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); } }
await check("source row uses real statuses/last_error and active hides refresh; no fake Add/DNS", async () => {
  const h = harness(); const tree = h.render({ ...h.props, domains: [domain, { ...domain, id: "active", status: "active" }, { ...domain, id: "failed", hostname: "failed.invalid", status: "failed", error: "实际错误" }] });
  assert.match(text(tree), /DNS 更改待处理。可能需要 24 小时才会生效。/); assert.match(text(tree), /DNS 设置未成功。请检查 DNS 记录。/); assert.match(text(tree), /上次错误：\s*实际错误/);
  assert.equal(walk(tree).filter(n => n.props["aria-label"]?.startsWith("刷新 ")).length, 2); assert.equal(walk(tree).filter(n => n.props["aria-label"]?.startsWith("移除 ")).length, 3);
  assert.equal(walk(tree).some(n => text(n) === "添加" || text(n) === "查看DNS设置"), false); assert.equal(h.document.activeElement, null); h.unmount();
});
await check("remove confirmation/cancel writes nothing; submitting is single-flight and waits for domain GET absence", async () => {
  const h = harness(), s = h.state(); s.select(domain); s.close(); assert.equal(h.calls.length, 0); s.select(domain); void s.remove(); void s.remove(); s.close(); assert.equal(s.selected.id, domain.id);
  assert.equal(h.calls.length, 1); assert.equal(h.changes.length, 0); latest(h, "remove").resolve(domain); await flush(); assert.equal(h.changes.length, 0); latest(h, "domains").resolve([]); await flush();
  assert.equal(s.selected, null); assert.equal(s.domains.length, 0); assert.equal(h.changes.length, 1); s.dispose();
});
await check("ACK alone never removes target; GET still present keeps confirmation for explicit retry", async () => {
  const h = harness(), s = h.state(); s.select(domain); void s.remove(); latest(h, "remove").resolve(domain); await flush(); latest(h, "domains").resolve([domain]); await flush();
  assert.equal(s.domains.length, 1); assert.equal(s.selected.id, domain.id); assert.match(s.error, /仍存在/); assert.equal(h.calls.filter(c => c.operation === "remove").length, 1); void s.remove(); assert.equal(h.calls.filter(c => c.operation === "remove").length, 2); h.scope.abort(); latest(h, "remove").reject(Error()); await flush(); s.dispose();
});
await check("refresh uses actual readback status not ACK; active ACK updates metadata/assets as a pair", async () => {
  const h = harness(), s = h.state(); void s.refresh(domain); latest(h, "refresh").resolve({ ...domain, status: "active" }); await flush();
  latest(h, "domains").resolve([{ ...domain, status: "failed", error: "真实失败", updatedAt: "2026-11-08T00:00:00Z" }]); await flush(); assert.equal(s.domains[0].status, "failed"); assert.equal(h.updated.length, 0);
  latest(h, "detail").resolve(result("actual")); await flush(); assert.equal(h.updated[0].assets[0].assetKey, "grant-actual"); s.dispose();
});
await check("remove old active refreshes metadata but failure does not restore confirmed removed domain", async () => {
  const h = harness(), active = { ...domain, status: "active" }, s = h.state(access, [active]); s.select(active); void s.remove(); latest(h, "remove").resolve(active); await flush(); latest(h, "domains").resolve([]); await flush();
  latest(h, "detail").reject(Error("metadata failure")); await flush(); assert.equal(s.domains.length, 0); assert.equal(s.unknown, null); assert.equal(s.metadataError, true); assert.equal(s.selected, null);
  void s.retryMetadata(); latest(h, "detail").resolve(result("actual")); await flush(); assert.equal(s.metadataError, false); assert.equal(h.calls.filter(c => c.operation === "remove").length, 1); s.dispose();
});
await check("known rejection preserves dialog and list; unknown locks writes until explicit recovery GET", async () => {
  const h = harness(), s = h.state(); s.select(domain); void s.remove(); latest(h, "remove").reject({ status: 403 }); await flush(); assert.equal(s.unknown, null); assert.equal(s.selected.id, domain.id); assert.equal(h.errors[0], "无法移除域名");
  void s.remove(); latest(h, "remove").reject({ code: "site_domain_unconfirmed" }); await flush(); assert.ok(s.unknown); await s.remove(); await s.refresh(domain); assert.equal(h.calls.filter(c => c.operation === "remove").length, 2);
  void s.recover(); latest(h, "domains").reject(Error("read failed")); await flush(); assert.ok(s.unknown); void s.recover(); latest(h, "domains").resolve([domain]); await flush(); assert.equal(s.unknown, null); assert.equal(s.selected.id, domain.id);
  assert.equal(h.calls.filter(c => c.operation === "remove").length, 2); s.dispose();
});
await check("unknown refresh resolved active requires actual metadata readback", async () => {
  const h = harness(), s = h.state(); void s.refresh(domain); latest(h, "refresh").reject({ code: "site_domain_unconfirmed" }); await flush(); void s.recover(); latest(h, "domains").resolve([{ ...domain, status: "active" }]); await flush();
  assert.ok(latest(h, "detail"), "Recovered active domain must refresh actual site/grants"); latest(h, "detail").resolve(result("active")); await flush(); s.dispose();
});
await check("leaving before ACK starts no new read or callback; identity abort suppresses toast and releases tracker", async () => {
  const h = harness(), s = h.state(); void s.refresh(domain); s.dispose(); latest(h, "refresh").resolve(domain); await flush(); assert.equal(h.calls.length, 1); assert.equal(h.changes.length, 0);
  const next = h.state(); void next.refresh(domain); const pending = latest(h, "refresh"); next.dispose(); let settled = false; void h.load("src/siteSettingsState.ts").waitForSiteSettingsWrites(h.scope.signal).then(() => { settled = true; }); await flush(); assert.equal(settled, false);
  h.scope.abort(); assert.equal(pending.signal.aborted, true); pending.reject({ code: "site_domain_unconfirmed" }); await flush(); assert.equal(h.errors.length, 0); assert.equal(settled, true);
});
await check("late domain GET and metadata cannot callback after leave or switch identity", async () => {
  for (const atMetadata of [false, true]) { const h = harness(), s = h.state(); void s.refresh(domain); latest(h, "refresh").resolve({ ...domain, status: "active" }); await flush();
    if (atMetadata) { latest(h, "domains").resolve([domain]); await flush(); }
    const pending = latest(h, atMetadata ? "detail" : "domains"), count = h.changes.length; s.dispose(); h.scope.abort(); pending.resolve(atMetadata ? result("late") : []); await flush(); assert.equal(h.updated.length, 0); assert.equal(h.changes.length, count); }
});
await check("hydration cannot substitute another hostname into an existing remove confirmation", async () => {
  const h = harness(), s = h.state(); s.hydrate([{ ...domain, status: "active", updatedAt: "2026-11-10T00:00:00Z" }]);
  s.select(s.domains[0]); s.hydrate([{ ...domain, hostname: "replaced.invalid", updatedAt: "2026-11-11T00:00:00Z" }]); await s.remove(); assert.equal(h.calls.length, 0); s.close(); s.select(s.domains[0]); void s.remove(); latest(h, "remove").resolve(s.domains[0]); await flush(); latest(h, "domains").resolve([]); await flush();
  assert.equal(latest(h, "detail"), undefined); s.dispose();
});
await check("StrictMode cleanup/setup remains operational; pure discarded constructor makes no request", async () => {
  const h = harness(), s = h.state(); s.dispose(); s.attach(); new h.stateModule.SiteDomainState(access, "other", [domain], h.scope.signal, () => {}, () => {}); assert.equal(h.calls.length, 0);
  void s.refresh(domain); latest(h, "refresh").resolve(domain); await flush(); latest(h, "domains").resolve([domain]); await flush(); assert.equal(h.changes.length, 1); s.dispose();
});
await check("actual JSX form prevents defaults, busy blocks close and removes X; recovery cannot submit via reused button", async () => {
  const h = harness(); let tree = h.render(); const remove = walk(tree).find(n => n.props["aria-label"] === `移除 ${domain.hostname}`); remove.props.onClick({ preventDefault() {}, currentTarget: { focus() {} } }); tree = h.render(); assert.match(text(tree), /访客将无法再使用此域名访问该站点/);
  let prevented = false; walk(tree).find(n => n.type === "form").props.onSubmit({ preventDefault() { prevented = true; } }); assert.equal(prevented, true); tree = h.render();
  assert.equal(walk(tree).some(n => n.props["aria-label"] === "关闭"), false); assert.equal(walk(tree).find(n => n.type === "button" && text(n) === "取消").props.disabled, true);
  let stopped = false; walk(tree).find(n => n.type === "dialog").props.onCancel({ preventDefault() {}, stopPropagation() { stopped = true; } }); assert.equal(stopped, true);
  latest(h, "remove").reject({ code: "site_domain_unconfirmed" }); await flush(); tree = h.render(); const recovery = walk(tree).filter(n => n.type === "button" && text(n) === "重新读取当前域名").at(-1); prevented = false; recovery.props.onClick({ preventDefault() { prevented = true; } }); assert.equal(prevented, true); assert.equal(recovery.props.type, "button");
  latest(h, "domains").resolve([domain]); await flush(); assert.equal(h.calls.filter(c => c.operation === "remove").length, 1); h.unmount();
});
await check("busy/unknown ignores late parent props; actual GET confirms and old initial array cannot resurrect removed domain", async () => {
  const h = harness(), s = h.state(); void s.refresh(domain); latest(h, "refresh").resolve(domain); await flush();
  const initial = s.domains; s.hydrate([]); assert.equal(s.domains.length, 1); latest(h, "domains").reject(Error("read failed")); await flush(); assert.ok(s.unknown); s.hydrate([]); assert.equal(s.domains.length, 1);
  void s.recover(); latest(h, "domains").resolve([]); await flush(); assert.equal(s.unknown, null); assert.equal(s.domains.length, 0); s.hydrate(initial); assert.equal(s.domains.length, 0); s.dispose();
});
await check("tracker holds authority through domain and metadata GETs, detached read cannot spawn metadata", async () => {
  const h = harness(), s = h.state(); void s.refresh(domain); latest(h, "refresh").resolve({ ...domain, status: "active" }); await flush();
  let settled = false; void h.load("src/siteSettingsState.ts").waitForSiteSettingsWrites(h.scope.signal).then(() => { settled = true; }); await flush(); assert.equal(settled, false);
  latest(h, "domains").resolve([domain]); await flush(); assert.equal(settled, false); latest(h, "detail").resolve(result("actual")); await flush(); assert.equal(settled, true); s.dispose();
  const next = h.state(); void next.refresh(domain); latest(h, "refresh").resolve({ ...domain, status: "active" }); await flush(); const count = h.calls.filter(c => c.operation === "detail").length; next.dispose(); latest(h, "domains").resolve([domain]); await flush(); assert.equal(h.calls.filter(c => c.operation === "detail").length, count);
});
await check("actual dialog outside/escape cancel performs no mutation and returns trigger focus only after open", async () => {
  const h = harness(); let tree = h.render(); assert.equal(h.document.activeElement, null); let focused = 0;
  walk(tree).find(n => n.props["aria-label"] === `移除 ${domain.hostname}`).props.onClick({ preventDefault() {}, currentTarget: { focus() { focused++; } } }); tree = h.render();
  const target = { getBoundingClientRect: () => ({ left: 10, top: 10, right: 100, bottom: 100 }) }; walk(tree).find(n => n.type === "dialog").props.onClick({ target, currentTarget: target, clientX: 0, clientY: 0 }); tree = h.render(); assert.equal(focused, 1); assert.equal(h.calls.length, 0);
  walk(tree).find(n => n.props["aria-label"] === `移除 ${domain.hostname}`).props.onClick({ preventDefault() {}, currentTarget: { focus() { focused++; } } }); tree = h.render(); let stopped = false;
  walk(tree).find(n => n.type === "dialog").props.onCancel({ preventDefault() {}, stopPropagation() { stopped = true; } }); h.render(); assert.equal(stopped, true); assert.equal(focused, 2); assert.equal(h.calls.length, 0); h.unmount();
});
await check("actual JSX adopts latest parent domains after known write rejection instead of stranding ignored props", async () => {
  const h = harness(); let tree = h.render(); walk(tree).find(n => n.props["aria-label"] === `刷新 ${domain.hostname} 状态`).props.onClick({ preventDefault() {} });
  h.render({ ...h.props, domains: [{ ...domain, hostname: "intermediate.invalid" }] });
  const props = { ...h.props, domains: [{ ...domain, hostname: "fresh.invalid", status: "active" }] }; h.render(props);
  latest(h, "refresh").reject({ status: 403 }); await flush(); tree = h.render(props);
  assert.equal(text(tree).includes("fresh.invalid"), true); assert.equal(text(tree).includes(domain.hostname), false); assert.equal(text(tree).includes("intermediate.invalid"), false); h.unmount();
});
await check("disposed mutation rejection cannot toast old site; tracked work still settles and identity listener releases", async () => {
  const h = harness(), s = h.state(); void s.refresh(domain); s.dispose(); let settled = false;
  void h.load("src/siteSettingsState.ts").waitForSiteSettingsWrites(h.scope.signal).then(() => { settled = true; }); await flush(); assert.equal(settled, false);
  latest(h, "refresh").reject({ status: 403 }); await flush(); assert.equal(h.errors.length, 0); assert.equal(h.changes.length, 0); assert.equal(settled, true); assert.equal(s.busy, false);
});
await check("queued old props never overwrite successful actual GET or unknown recovery confirmation", async () => {
  for (const unknown of [false, true]) { const h = harness(), s = h.state(); void s.refresh(domain); s.hydrate([{ ...domain, hostname: "stale.invalid" }]);
    if (unknown) { latest(h, "refresh").reject({ code: "site_domain_unconfirmed" }); await flush(); assert.ok(s.unknown); s.hydrate([{ ...domain, hostname: "last-stale.invalid" }]); void s.recover(); }
    else { latest(h, "refresh").resolve({ ...domain, status: "active" }); await flush(); }
    latest(h, "domains").resolve([{ ...domain, hostname: "confirmed.invalid", status: "active" }]); await flush(); const stale = [{ ...domain, hostname: "during-metadata.invalid" }]; s.hydrate(stale);
    latest(h, "detail").resolve(result("confirmed")); await flush(); s.hydrate(stale); assert.equal(s.domains[0].hostname, "confirmed.invalid"); assert.equal(s.unknown, null); s.dispose(); }
});
await check("known remove failure adopts latest props and closes obsolete confirmation; same target retains refreshed data", async () => {
  for (const variant of ["missing", "renamed", "same"]) { const h = harness(), s = h.state(); s.select(domain); void s.remove();
    const next = variant === "missing" ? [] : [{ ...domain, hostname: variant === "same" ? domain.hostname : "other.invalid", status: "active" }]; s.hydrate(next);
    latest(h, "remove").reject({ status: 403 }); await flush();
    if (variant === "same") { assert.equal(s.selected.hostname, domain.hostname); assert.equal(s.selected.status, "active"); }
    else assert.equal(s.selected, null, "obsolete hostname/id must not leave an inert confirmation button");
    assert.equal(h.calls.filter(c => c.operation === "remove").length, 1); s.dispose(); }
});
assert.equal(failures.length, 0, failures.join("; "));
console.log(`PASS actual SiteDomainSettings/state: ${passed} groups; explicit deferred client boundary; no HTTP/native/pixel claim`);

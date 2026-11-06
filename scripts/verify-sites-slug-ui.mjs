import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const walk = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(walk)] : [];
const text = node => walk(node).flatMap(n => n.children.filter(c => typeof c === "string")).join(" ");
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const access = { identity: { accountId: "account", userId: "user", generation: 1 }, enabled: true };
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
        if (name === "lucide-react") return { X: "svg" };
        if (["../siteSlugState"].includes(name)) return load("src/siteSlugState.ts");
        if (["./siteSettingsState"].includes(name)) return load("src/siteSettingsState.ts");
        if (["../sitesService", "./sitesService"].includes(name)) return load("src/sitesService.ts");
        if (["./sitesClient"].includes(name)) return { checkSiteSlug: (a, id, raw, s) => call("check", [a, id, raw], s), changeSiteSlug: (a, id, raw, s) => call("change", [a, id, raw], s), readSiteDetail: (a, id, s) => call("detail", [a, id], s) };
        throw Error(name);
      } }); return exports; }
  const stateModule = load("src/siteSlugState.ts"), component = load("src/components/SiteSlugSettings.tsx"), errors = [], updated = [], scope = new AbortController();
  const props = { access, site, scope: scope.signal, canChange: true, onSite: r => updated.push(r), onError: message => errors.push(message) };
  return { calls, errors, updated, scope, props, document, stateModule, load,
    state(a = access, s = site, signal = scope.signal) { const state = new stateModule.SiteSlugState(a, s, signal, props.onSite, props.onError); state.attach(); return state; },
    render(next = props) { cursor = 0; tree = component.SiteSlugSettings(next); while (effects.length) effects.shift()(); return tree; },
    tick(ms) { clock += ms; for (const [id, timer] of [...timers]) if (timer.due <= clock) { timers.delete(id); timer.fn(); } },
    setClock(ms) { clock = ms; }, unmount() { hooks.forEach(h => h?.cleanup?.()); }, get writes() { return writes; },
  };
}
const latest = (h, op) => h.calls.filter(c => c.operation === op).at(-1);
const result = (slug, extra = {}) => ({ site: { ...site, slug, hostedUrl: `https://${slug}.example.invalid`, updatedAt: "2026-11-08T00:00:00Z", ...extra }, assets: [{ id: "one", assetKey: `grant-${slug}`, sourceRequestId: "request" }] });
let passed = 0; const failures = [];
async function check(name, fn) { try { await fn(); passed++; console.log(`PASS ${name}`); } catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); } }
async function available(h, state, value = "new") { state.show(); state.change(value); h.tick(400); latest(h, "check").resolve({ slug: value.trim().toLowerCase(), available: true }); await flush(); }
await check("initial URL row never steals focus; controlled dialog preserves suffix and has no arbitrary maxlength", async () => {
  const h = harness(); let tree = h.render({ ...h.props, hostedDomainSuffix: ".example.invalid" }); assert.equal(h.document.activeElement, null);
  walk(tree).find(n => n.props["aria-label"] === "更改托管站点 URL").props.onClick(); tree = h.render({ ...h.props, hostedDomainSuffix: ".example.invalid" });
  const field = walk(tree).find(n => n.type === "input"); assert.equal(field.props.maxLength, undefined); assert.equal(field.props.autoComplete, "off"); assert.match(text(tree), /\.example.invalid/); h.unmount();
});
await check("400ms normalized eligibility and late availability do not authorize changed raw input", async () => {
  const h = harness(), s = h.state(); s.show(); for (const raw of ["old", "", "1bad", "bad--slug"]) { s.change(raw); h.tick(400); } assert.equal(h.calls.length, 0);
  s.change(" NEW "); h.tick(399); assert.equal(h.calls.length, 0); h.tick(1); const old = latest(h, "check"); assert.equal(old.args[2], " NEW ");
  s.change("newer"); assert.equal(old.signal.aborted, true); old.resolve({ slug: "new", available: true }); await flush(); assert.equal(Boolean(s.canSubmit), false);
  h.tick(400); latest(h, "check").resolve({ slug: "newer", available: true }); await flush(); assert.equal(s.canSubmit, true); s.change("newer "); assert.equal(Boolean(s.canSubmit), false); s.dispose();
});
await check("POST is single-flight, busy refuses close, complete needs a matching actual GET before accepting metadata and grants", async () => {
  const h = harness(), s = h.state(); await available(h, s); void s.submit(); void s.submit(); assert.equal(h.calls.filter(c => c.operation === "change").length, 1); s.close(); assert.equal(s.open, true);
  latest(h, "change").resolve({ requestedSlug: "new", status: "complete" }); await flush(); assert.equal(h.updated.length, 0); latest(h, "detail").resolve(result("new")); await flush();
  assert.equal(s.open, false); assert.equal(h.updated[0].assets[0].assetKey, "grant-new"); s.dispose();
});
await check("real pending polls immediately then each 1000ms; matching readback wins over expiration", async () => {
  const h = harness(), s = h.state(); await available(h, s); void s.submit(); latest(h, "change").resolve({ requestedSlug: "new", status: "pending" }); await flush(); assert.equal(h.calls.filter(c => c.operation === "detail").length, 1);
  latest(h, "detail").resolve(result("old")); await flush(); h.tick(999); assert.equal(h.calls.filter(c => c.operation === "detail").length, 1); h.tick(1); assert.equal(h.calls.filter(c => c.operation === "detail").length, 2);
  h.setClock(700000); latest(h, "detail").resolve(result("new")); await flush(); assert.equal(s.pending, null); assert.equal(h.updated.length, 1); assert.equal(h.errors.length, 0); s.dispose();
});
await check("pending expiration or GET failure clears only that token and reports actual source error", async () => {
  for (const failure of [false, true]) { const h = harness(), s = h.state(); await available(h, s); void s.submit(); latest(h, "change").resolve({ requestedSlug: "new", status: "pending" }); await flush();
    h.setClock(700000); if (failure) latest(h, "detail").reject(Error("read failed")); else latest(h, "detail").resolve(result("old")); await flush();
    assert.equal(s.pending, null); assert.equal(h.updated.length, 0); assert.equal(h.errors[0], failure ? "无法确认站点 URL 更改" : "站点 URL 更改所需时间比预期更长"); s.dispose(); }
});
await check("unknown POST never repeats automatically; GET old plus fresh availability controls explicit retry", async () => {
  const h = harness(), s = h.state(); await available(h, s); void s.submit(); latest(h, "change").reject({ code: "site_slug_unconfirmed" }); await flush();
  void s.submit(); assert.equal(h.calls.filter(c => c.operation === "change").length, 1); void s.recover(); latest(h, "detail").resolve(result("old")); await flush(); latest(h, "check").resolve({ slug: "new", available: false }); await flush(); assert.equal(s.unknown, true);
  void s.recover(); latest(h, "detail").resolve(result("old")); await flush(); latest(h, "check").resolve({ slug: "new", available: true }); await flush(); assert.equal(s.canSubmit, true); assert.equal(h.calls.filter(c => c.operation === "change").length, 1);
  void s.submit(); assert.equal(h.calls.filter(c => c.operation === "change").length, 2); h.scope.abort(); latest(h, "change").reject(Error("cancelled")); await flush(); s.dispose();
});
await check("leaving preserves pending for return, stops own poll; another account has no matching pending", async () => {
  const h = harness(), s = h.state(); await available(h, s); void s.submit(); latest(h, "change").resolve({ requestedSlug: "new", status: "pending" }); await flush(); const old = latest(h, "detail"); s.dispose(); assert.equal(old.signal.aborted, true);
  old.resolve(result("new")); await flush(); assert.equal(h.updated.length, 0); const foreign = h.state({ ...access, identity: { ...access.identity, accountId: "other" } }); assert.equal(foreign.pending, null); foreign.dispose();
  const returned = h.state(); returned.setVisible(true); assert.equal(latest(h, "detail").signal.aborted, false); latest(h, "detail").resolve(result("new")); await flush(); assert.equal(returned.pending, null); assert.equal(h.updated.length, 1); returned.dispose();
});
await check("identity abort prevents old POST/GET result and toast, while tracking retains the enclosing write owner until settlement", async () => {
  const h = harness(), s = h.state(); await available(h, s); void s.submit(); const pending = latest(h, "change");
  let settled = false; void h.load("src/siteSettingsState.ts").waitForSiteSettingsWrites(h.scope.signal).then(() => { settled = true; }); await flush(); assert.equal(settled, false);
  h.scope.abort(); assert.equal(pending.signal.aborted, true); pending.reject({ code: "site_slug_unconfirmed" }); await flush(); assert.equal(h.errors.length, 0); assert.equal(h.updated.length, 0); assert.equal(settled, true); s.dispose();
});
await check("observed hidden pending is retained; last detach collects after 660000ms and return cancels the old collection timer", async () => {
  const h = harness(), s = h.state(); await available(h, s); void s.submit(); latest(h, "change").resolve({ requestedSlug: "new", status: "pending" }); await flush(); latest(h, "detail").resolve(result("old")); await flush(); s.setVisible(false); h.tick(660000);
  assert.ok(s.pending); s.dispose(); h.tick(659999); const returned = h.state(); assert.ok(returned.pending); h.tick(1); assert.ok(returned.pending); returned.dispose(); h.tick(660000);
  const collected = h.state(); assert.equal(collected.pending, null); collected.dispose();
});
await check("a newer pending is not deleted by the previous token's collection timer or old poll result", async () => {
  const h = harness(), old = h.state(); await available(h, old); void old.submit(); latest(h, "change").resolve({ requestedSlug: "new", status: "pending" }); await flush(); const stale = latest(h, "detail"); old.dispose();
  const returned = h.state(); returned.setVisible(true); latest(h, "detail").resolve(result("new")); await flush();
  await available(h, returned, "newer"); void returned.submit(); latest(h, "change").resolve({ requestedSlug: "newer", status: "pending" }); await flush(); returned.setVisible(false);
  stale.resolve(result("new")); await flush(); h.tick(660000); assert.equal(returned.pending.requestedSlug, "newer"); const observer = h.state(); assert.equal(observer.pending.requestedSlug, "newer"); observer.dispose(); returned.dispose();
});
await check("actual JSX cancels IME Enter and busy disables input/cancel/Escape/outside/X without a synthetic write", async () => {
  const h = harness(); let tree = h.render(); walk(tree).find(n => n.props["aria-label"] === "更改托管站点 URL").props.onClick(); tree = h.render(); let input = walk(tree).find(n => n.type === "input");
  input.props.onChange({ target: { value: "new" } }); h.tick(400); latest(h, "check").resolve({ slug: "new", available: true }); await flush(); tree = h.render(); input = walk(tree).find(n => n.type === "input");
  let prevented = false; input.props.onKeyDown({ key: "Enter", nativeEvent: { isComposing: true, keyCode: 229 }, preventDefault() { prevented = true; } }); assert.equal(prevented, true); assert.equal(h.calls.filter(c => c.operation === "change").length, 0);
  walk(tree).find(n => n.type === "form").props.onSubmit({ preventDefault() {} }); tree = h.render(); assert.equal(walk(tree).find(n => n.type === "input").props.disabled, true); assert.equal(walk(tree).some(n => n.props["aria-label"] === "关闭"), false);
  assert.equal(walk(tree).find(n => n.type === "button" && text(n) === "取消").props.disabled, true); const dialog = walk(tree).find(n => n.type === "dialog"); dialog.props.onCancel({ preventDefault() {} });
  const target = { getBoundingClientRect: () => ({ left: 10, top: 10, right: 100, bottom: 100 }) }; dialog.props.onClick({ target, currentTarget: target, clientX: 0, clientY: 0 }); tree = h.render(); assert.equal(walk(tree).find(n => n.type === "input").props.disabled, true);
  h.scope.abort(); latest(h, "change").reject(Error("cancelled")); await flush(); h.unmount();
});
await check("availability error can retry; cancellation aborts readonly work and cannot submit a previously available slug", async () => {
  const h = harness(), s = h.state(); s.show(); s.change("new"); h.tick(400); latest(h, "check").reject(Error("check failed")); await flush(); assert.equal(s.checkError, true); void s.check(); latest(h, "check").resolve({ slug: "new", available: true }); await flush();
  assert.equal(s.canSubmit, true); s.close(); await s.submit(); assert.equal(h.calls.filter(c => c.operation === "change").length, 0);
  s.show(); s.change("other"); h.tick(400); const pending = latest(h, "check"); s.close(); assert.equal(pending.signal.aborted, true); pending.resolve({ slug: "other", available: true }); await flush(); assert.equal(Boolean(s.canSubmit), false); s.dispose();
});
await check("complete acknowledgement with mismatching GET is explicit unknown; matched recovery accepts only actual metadata", async () => {
  const h = harness(), s = h.state(); await available(h, s); void s.submit(); latest(h, "change").resolve({ requestedSlug: "new", status: "complete" }); await flush(); latest(h, "detail").resolve(result("old")); await flush();
  assert.equal(s.pending, null); assert.equal(s.unknown, true); assert.equal(s.raw, "new"); assert.equal(h.updated.length, 0); assert.equal(s.site.slug, "old");
  void s.recover(); latest(h, "detail").resolve(result("new")); await flush(); assert.equal(s.open, false); assert.equal(s.unknown, false); assert.equal(h.updated[0].site.slug, "new"); s.dispose();
});
await check("hidden observer pauses intervals and visible/focus rechecks immediately without allowing late paused GET data", async () => {
  const h = harness(), s = h.state(); await available(h, s); void s.submit(); latest(h, "change").resolve({ requestedSlug: "new", status: "pending" }); await flush(); const old = latest(h, "detail"); s.setVisible(false); assert.equal(old.signal.aborted, true);
  const count = h.calls.length; h.tick(10000); assert.equal(h.calls.length, count); s.setVisible(true); assert.equal(h.calls.length, count + 1);
  old.resolve(result("new")); await flush(); assert.equal(h.updated.length, 0); latest(h, "detail").resolve(result("new")); await flush(); assert.equal(h.updated.length, 1); s.dispose();
});
for (const path of ["complete", "pending", "recovery"]) await check(`older matching slug cannot falsely complete newer current metadata (${path})`, async () => {
    const h = harness(), s = h.state(access, { ...site, slug: "current", updatedAt: "2026-11-10T00:00:00Z" }); await available(h, s); void s.submit();
    if (path === "recovery") { latest(h, "change").reject({ code: "site_slug_unconfirmed" }); await flush(); void s.recover(); }
    else { latest(h, "change").resolve({ requestedSlug: "new", status: path }); await flush(); }
    latest(h, "detail").resolve(result("new")); await flush(); assert.equal(s.site.slug, "current"); assert.equal(h.updated.length, 0);
    if (path === "pending") assert.ok(s.pending, "older matching GET must not remove pending confirmation"); else { assert.equal(s.open, true); assert.equal(s.unknown, true); }
    s.dispose();
});
await check("late pending POST notifies the currently mounted same-account observer after the original page left", async () => {
  const h = harness(), old = h.state(); await available(h, old); void old.submit(); old.dispose(); const returned = h.state(); assert.equal(returned.pending, null);
  latest(h, "change").resolve({ requestedSlug: "new", status: "pending" }); await flush(); assert.equal(returned.pending?.requestedSlug, "new"); assert.ok(latest(h, "detail"));
  latest(h, "detail").resolve(result("new")); await flush(); assert.equal(returned.pending, null); assert.equal(h.updated.length, 1); returned.dispose();
});
await check("StrictMode setup-cleanup-setup restores 400ms checks; discarded constructors own no observer or listener", async () => {
  const h = harness(), s = h.state(); s.show(); s.change("new"); h.tick(400); latest(h, "check").resolve({ slug: "new", available: true }); await flush(); s.dispose(); s.attach(); s.show(); s.change("newer"); h.tick(400);
  assert.equal(h.calls.filter(c => c.operation === "check").length, 2); latest(h, "check").resolve({ slug: "newer", available: true }); await flush(); void s.submit(); latest(h, "change").resolve({ requestedSlug: "newer", status: "pending" }); await flush();
  const orphan = new h.stateModule.SiteSlugState(access, site, h.scope.signal, h.props.onSite); assert.equal(orphan.pending.observers, 1); const pendingRead = latest(h, "detail"); s.dispose(); pendingRead.resolve(result("old")); await flush(); h.tick(660000);
  const next = h.state(); assert.equal(next.pending, null); assert.equal(h.calls.filter(c => c.operation === "detail").length, 1); next.dispose();
});
await check("acknowledged complete followed by failed readback stays unknown and cannot POST again", async () => {
  const h = harness(), s = h.state(); await available(h, s); void s.submit(); latest(h, "change").resolve({ requestedSlug: "new", status: "complete" }); await flush(); latest(h, "detail").reject(Error("readback failed")); await flush();
  assert.equal(s.unknown, true); await s.submit(); assert.equal(h.calls.filter(c => c.operation === "change").length, 1); assert.equal(h.updated.length, 0); s.dispose();
});
await check("older hydrated matching slug cannot clear pending against newer adopted current metadata", async () => {
  const h = harness(), s = h.state(access, { ...site, updatedAt: "2026-11-10T00:00:00Z" }); await available(h, s); void s.submit(); latest(h, "change").resolve({ requestedSlug: "new", status: "pending" }); await flush();
  const currentPoll = latest(h, "detail"); s.hydrate(result("new").site); assert.equal(s.site.slug, "old"); assert.ok(s.pending); assert.equal(currentPoll.signal.aborted, false);
  currentPoll.resolve(result("old", { updatedAt: "2026-11-10T00:00:00Z" })); await flush(); h.tick(1000); assert.notEqual(latest(h, "detail"), currentPoll); s.dispose();
});
await check("actual recovery button cancels click default before changing into a submit button", async () => {
  const h = harness(); let tree = h.render(); walk(tree).find(n => n.props["aria-label"] === "更改托管站点 URL").props.onClick(); tree = h.render(); walk(tree).find(n => n.type === "input").props.onChange({ target: { value: "new" } }); h.tick(400); latest(h, "check").resolve({ slug: "new", available: true }); await flush();
  tree = h.render(); walk(tree).find(n => n.type === "form").props.onSubmit({ preventDefault() {} }); latest(h, "change").reject({ code: "site_slug_unconfirmed" }); await flush(); tree = h.render();
  const recovery = walk(tree).find(n => n.type === "button" && text(n) === "重新读取当前状态"); let prevented = false; recovery.props.onClick({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true, "Observed browser button reuse requires suppressing the original click default");
  latest(h, "detail").resolve(result("old")); await flush(); latest(h, "check").resolve({ slug: "new", available: true }); await flush(); tree = h.render();
  assert.equal(walk(tree).find(n => n.type === "button" && text(n) === "更改 URL").props.type, "submit"); assert.equal(h.calls.filter(c => c.operation === "change").length, 1); h.unmount();
});
assert.equal(failures.length, 0, failures.join("; "));
console.log(`PASS actual SiteSlugSettings/state: ${passed} groups; client deferred boundary, virtual clock; no HTTP/native/pixel claim`);

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const walk = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(walk)] : [];
const text = node => walk(node).flatMap(n => n.children.filter(c => typeof c === "string")).join(" ");
const richText = node => typeof node === "string" ? node : node && typeof node === "object" ? (node.children ?? []).map(richText).join("") : "";
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const access = { identity: { accountId: "account", userId: "user", generation: 1 }, enabled: true };
const context = { memberId: "member", email: "owner@example.invalid", workspace: true, canManageEditors: true, canInviteExternal: true, sharingManagementAllowed: true, externalPermissionError: false };
const policy = { accessMode: "custom", availableModes: ["custom", "workspace_all", "public"], users: [{ account_user_id: "member", email: "owner@example.invalid", name: "实际所有者", role: "owner", avatar_url: "https://untrusted.invalid/avatar" }], groups: [], showPrivateTunnelsWarning: false };
const site = { id: "one", slug: "old", title: "真实站点", updatedAt: "2026-11-07T00:00:00Z", hostedUrl: "https://old.example.invalid", liveUrl: null };
function harness() {
  const calls = [], timers = new Map(), modules = new Map(), hooks = [], effects = [], events = new Map(), portals = []; let clock = 0, serial = 0, cursor = 0, tree, writes = 0;
  const document = { body: {}, visibilityState: "visible", activeElement: null, addEventListener: (n, fn) => events.set(n, fn), removeEventListener: (n, fn) => { if (events.get(n) === fn) events.delete(n); } };
  const window = { innerWidth: 1280, innerHeight: 800, addEventListener: document.addEventListener, removeEventListener: document.removeEventListener };
  const call = (operation, args, signal) => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); calls.push({ operation, args, signal, resolve, reject }); return promise; };
  const React = { default: null,
    createElement(type, props, ...children) { const node = { type, props: props ?? {}, children: children.flat(Infinity) }; if (typeof type === "function") return type({ ...props, children: node.children }); const element = { open: false, offsetHeight: 240, getBoundingClientRect() { return type === "dialog" ? { left: 384, top: 200, right: 896, bottom: 600 } : { left: 420, top: 240, right: 620, bottom: 276 }; }, contains() { return false; }, querySelector() { return null; }, focus() { document.activeElement = node; }, showModal() { this.open = true; }, close() { this.open = false; } }; if (props?.ref) props.ref.current = element; return node; },
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial; return [hooks[i], value => { writes++; hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return hooks[i] ?? (hooks[i] = { current: initial }); },
    useMemo(fn, deps) { const i = cursor++, old = hooks[i]; if (!old || deps.some((d, j) => !Object.is(d, old.deps[j]))) hooks[i] = { value: fn(), deps }; return hooks[i].value; },
    useEffect(fn, deps) { const i = cursor++, old = hooks[i]; if (!old || deps.some((d, j) => !Object.is(d, old.deps[j]))) { hooks[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn(); }); } },
  }; React.default = React; React.useLayoutEffect = React.useEffect;
  function load(file) { if (modules.has(file)) return modules.get(file); const exports = {}; modules.set(file, exports);
    vm.runInNewContext(compile(file), { exports, AbortController, URL, HTMLElement: Object, Date: class extends Date { static now() { return clock; } }, document, window,
      setTimeout(fn, delay) { timers.set(++serial, { fn, due: clock + delay }); return serial; }, clearTimeout: id => timers.delete(id), require: name => {
        if (name === "react") return React; if (name.endsWith(".css")) return {};
        if (name === "react-dom") return { createPortal: (child, target) => { portals.push({ child, target }); return child; } };
        if (name === "./SiteSharingInviteInput") return { SiteSharingInviteInput: "invite-input" };
        if (name === "lucide-react") return { X: "svg", Check: "svg", ChevronDown: "svg", Copy: "svg", ExternalLink: "svg", Globe: "svg", Lock: "svg", Users: "svg" };
        if (["../siteSharingState"].includes(name)) return load("src/siteSharingState.ts");
        if (["./siteSettingsState"].includes(name)) return load("src/siteSettingsState.ts");
        if (["../sitesService", "./sitesService"].includes(name)) return load("src/sitesService.ts");
        if (name === "./sitesSharingClient") return { readSiteSharingContext: (a,s) => call("context",[a],s), readSiteSharingPolicy: (a,id,s) => call("policy",[a,id],s), readSiteSharingUrl: (a,id,s) => call("url",[a,id],s), writeSiteSharingMode: (a,id,mode,s) => call("write",[a,id,mode],s), writeSiteSharingMember: (a,id,target,role,s) => call("member",[a,id,target,role],s) };
        if (name === "./sitesSharingInvitationsClient") return { writeSiteSharingInvitation: (a,id,target,s) => call("member",[a,id,target,"viewer"],s) };
        if (["./siteSharingData", "../siteSharingData"].includes(name)) return load("src/siteSharingData.ts");
        if (name === "./sitesClient") return {};
        if (name === "../clipboard") return { copyTextToClipboard: value => call("copy",[value]) };
        throw Error(name);
      } }); return exports; }
  const stateModule = load("src/siteSharingState.ts"), component = load("src/components/SiteSharingDialog.tsx"), errors = [], updated = [], scope = new AbortController();
  const changes = []; const props = { access, siteId: site.id, siteTitle: site.title, open: true, scope: scope.signal, onClose: () => changes.push("closed"), onPolicy: r => updated.push(r), onError: message => errors.push(message) };
  return { calls, errors, updated, changes, scope, props, document, stateModule, load, portals, window, events, get componentState() { return hooks.find(h => h?.value instanceof stateModule.SiteSharingState)?.value; },
    state(a = access, signal = scope.signal) { const state = new stateModule.SiteSharingState(a, site.id, signal, props.onPolicy, props.onError); state.attach(); return state; },
    render(next = props) { cursor = 0; tree = component.SiteSharingDialog(next); while (effects.length) effects.shift()(); return tree; },
    tick(ms) { clock += ms; for (const [id, timer] of [...timers]) if (timer.due <= clock) { timers.delete(id); timer.fn(); } },
    setClock(ms) { clock = ms; }, unmount() { hooks.forEach(h => h?.cleanup?.()); }, get writes() { return writes; },
  };
}
const latest = (h, op) => h.calls.filter(c => c.operation === op).at(-1);
const result = (slug, extra = {}) => ({ site: { ...site, slug, hostedUrl: `https://${slug}.example.invalid`, updatedAt: "2026-11-08T00:00:00Z", ...extra }, assets: [{ id: "one", assetKey: `grant-${slug}`, sourceRequestId: "request" }] });
let passed = 0; const failures = [];
async function check(name, fn) { try { await fn(); passed++; console.log(`PASS ${name}`); } catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); } }
async function ready(h, s, p = policy, c = context) { s.setOpen(true); latest(h, "context").resolve(c); latest(h, "policy").resolve(p); latest(h, "url").resolve("https://preferred.example.invalid/live"); await flush(); }
function chooseMode(h, tree, mode) { walk(tree).find(n => n.type === "button" && n.props["aria-label"] === "链接访问权限").props.onClick({ preventDefault() {} }); tree = h.render(); walk(tree).find(n => n.props["data-mode"] === mode).props.onClick({ preventDefault() {} }); return h.render(); }
function memberMenu(h, label) { let tree = h.render(); const element = { getBoundingClientRect: () => ({ left: 700, right: 780, top: 350, bottom: 378 }), contains: () => false, focus() {} }; walk(tree).find(n => n.type === "button" && n.props["aria-label"]?.startsWith(`${label} 的权限：`)).props.onClick({ preventDefault() {}, currentTarget: element }); h.render(); return h.render(); }
function removalDialog(h, label) { let tree = memberMenu(h, label); walk(tree).find(n => n.props.role === "menuitem" && text(n) === "移除访问权限").props.onClick({ preventDefault() {} }); tree = h.render(); return walk(tree).find(n => n.type === "dialog" && n.props.className.includes("site-sharing-member-confirm")); }
await check("context and policy start in parallel, preferred URL independent; within one minute reopening reuses all data", async () => {
  const h = harness(), s = h.state(); s.setOpen(true); assert.deepEqual(h.calls.map(c => c.operation), ["context", "policy", "url"]);
  latest(h, "context").resolve(context); latest(h, "policy").resolve(policy); latest(h, "url").reject(Error("url failed")); await flush(); assert.equal(s.owner, true); assert.equal(s.policy.accessMode, "custom"); assert.equal(s.urlError, true);
  void s.loadUrl(); latest(h, "url").resolve("https://preferred.example.invalid/live"); await flush(); const count = h.calls.length; s.setOpen(false); s.setOpen(true); await flush(); assert.equal(h.calls.length, count); h.tick(60000); s.setOpen(false); s.setOpen(true); assert.equal(h.calls.filter(c => c.operation === "policy").length, 2); s.dispose();
});
await check("owner derives actual account member/email, not global id; mode options are real and admins_only not writable", async () => {
  const h = harness(), s = h.state(); await ready(h, s, { ...policy, users: [{ ...policy.users[0], account_user_id: null, email: null }] }); assert.equal(s.owner, false); s.change("public"); assert.equal(s.draft, null);
  void s.load(true); latest(h, "context").resolve({ ...context, memberId: "different", email: "OWNER@example.invalid" }); latest(h, "policy").resolve(policy); latest(h, "url").resolve(null); await flush(); assert.equal(s.owner, true); s.change("admins_only"); assert.equal(s.draft, null); s.dispose();
});
await check("cancel resets only draft, owner write single-flight; successful matching GET clears draft but leaves dialog open", async () => {
  const h = harness(), s = h.state(); await ready(h, s); s.change("public"); s.reset(); assert.equal(s.open, true); assert.equal(h.calls.filter(c => c.operation === "write").length, 0);
  s.change("public"); void s.save(); void s.save(); assert.equal(h.calls.filter(c => c.operation === "write").length, 1); latest(h, "write").resolve(null); await flush(); latest(h, "policy").resolve({ ...policy, accessMode: "public" }); await flush(); assert.equal(s.draft, null); assert.equal(s.open, true); s.dispose();
});
await check("accepted ACK with mismatched GET stays unknown and never pretends mode applied", async () => {
  const h = harness(), s = h.state(); await ready(h, s); s.change("public"); void s.save(); latest(h, "write").resolve({ status: "accepted" }); await flush(); latest(h, "policy").resolve(policy); await flush(); assert.equal(s.unknown, true); assert.equal(s.draft, "public"); assert.equal(s.policy.accessMode, "custom"); await s.save(); assert.equal(h.calls.filter(c => c.operation === "write").length, 1); s.dispose();
});
await check("workspace_all pending is projected custom even if extra GET says workspace_all; explicit refresh later may adopt", async () => {
  const h = harness(), s = h.state(); await ready(h, s); s.change("workspace_all"); void s.save(); latest(h, "write").resolve({ status: "pending" }); await flush(); latest(h, "policy").resolve({ ...policy, accessMode: "workspace_all" }); await flush(); assert.equal(s.policy.accessMode, "custom"); assert.equal(s.draft, null); assert.equal(s.open, true);
  void s.load(true); latest(h, "context").resolve(context); latest(h, "policy").resolve({ ...policy, accessMode: "workspace_all" }); latest(h, "url").resolve(null); await flush(); assert.equal(s.policy.accessMode, "workspace_all"); s.dispose();
});
await check("write rejection first GET converges before original error and preserves draft; 403 clears stale policy", async () => {
  const h = harness(), s = h.state(); await ready(h, s); s.change("public"); void s.save(); latest(h, "write").reject({ status: 403 }); await flush(); assert.equal(h.errors.length, 0); assert.equal(s.saving, true);
  latest(h, "policy").reject({ status: 403 }); await flush(); assert.equal(s.policy, null); assert.equal(s.draft, "public"); assert.equal(s.unknown, false); assert.equal(h.errors[0], "无法保存共享设置"); s.dispose();
});
await check("refresh 5xx retains existing policy; 404 revokes it; null initial response is error not empty success", async () => {
  for (const status of [500, 404]) { const h = harness(), s = h.state(); await ready(h, s); void s.load(true); latest(h, "policy").reject({ status }); latest(h, "context").resolve(context); latest(h, "url").resolve(null); await flush(); assert.equal(s.policy === null, status === 404); assert.equal(s.policyError, true); s.dispose(); }
  const h = harness(), s = h.state(); await ready(h, s, null); assert.equal(s.policyError, true); assert.equal(s.owner, false); s.dispose();
});
await check("unknown PATCH converges but never automatically repeats; explicit recovery permits later manual write", async () => {
  const h = harness(), s = h.state(); await ready(h, s); s.change("public"); void s.save(); latest(h, "write").reject({ code: "site_sharing_unconfirmed" }); await flush(); latest(h, "policy").resolve(policy); await flush(); assert.equal(s.unknown, true); assert.equal(s.canSave, false);
  void s.recover(); latest(h, "policy").resolve(policy); await flush(); assert.equal(s.unknown, false); assert.equal(s.canSave, true); assert.equal(h.calls.filter(c => c.operation === "write").length, 1); s.dispose();
});
await check("whole mutation/readback remains tracked; identity invalidation suppresses old callback/toast", async () => {
  const h = harness(), s = h.state(); await ready(h, s); s.change("public"); void s.save(); let settled = false; void h.load("src/siteSettingsState.ts").waitForSiteSettingsWrites(h.scope.signal).then(() => { settled = true; }); await flush(); assert.equal(settled, false);
  latest(h, "write").resolve(null); await flush(); assert.equal(settled, false); const pending = latest(h, "policy"), count = h.updated.length; s.dispose(); h.scope.abort(); assert.equal(pending.signal.aborted, true); pending.reject(Error("account changed")); await flush(); assert.equal(h.errors.length, 0); assert.equal(h.updated.length, count); assert.equal(settled, true);
});
await check("closing during save is allowed but reopening must read fresh policy after obsolete write settles", async () => {
  const h = harness(), s = h.state(); await ready(h, s); s.change("public"); void s.save(); s.setOpen(false); assert.equal(s.open, false); s.setOpen(true); latest(h, "write").resolve(null); await flush();
  assert.equal(h.calls.filter(c => c.operation === "policy").length, 2, "reopened dialog needs fresh policy after invalidated late save"); assert.equal(h.errors.length, 0); s.dispose();
});
await check("StrictMode setup cleanup setup restarts actual initial reads and discarded constructors have no side effects", async () => {
  const h = harness(), s = h.state(); s.setOpen(true); const old = latest(h, "policy"); s.dispose(); s.attach(); s.setOpen(true); assert.equal(old.signal.aborted, true); assert.equal(h.calls.filter(c => c.operation === "policy").length, 2);
  old.resolve({ ...policy, accessMode: "public" }); latest(h, "context").resolve(context); latest(h, "policy").resolve(policy); latest(h, "url").resolve(null); await flush(); assert.equal(s.policy.accessMode, "custom"); s.dispose();
});
await check("actual JSX loading/error/participants/groups are readonly; no avatar request/invitation fake button", async () => {
  const h = harness(); h.render(); let tree = h.render(); assert.equal(walk(tree).some(n => n.props["aria-label"] === "正在加载共享设置…"), true);
  latest(h, "context").resolve(context); latest(h, "policy").resolve({ ...policy, users: [...policy.users, { account_user_id: null, email: "guest@example.invalid", pending: true, role: "viewer" }], groups: [{ id: "real-group", name: "实际群组", size: 3 }] }); latest(h, "url").resolve(null); await flush(); tree = h.render();
  assert.match(text(tree), /实际所有者/); assert.match(text(tree), /实际群组/); assert.match(text(tree), /待处理/); assert.equal(walk(tree).some(n => n.type === "img" || text(n) === "邀请"), false); h.unmount();
});
await check("actual JSX mode/secret tunnel warning, IME Enter, cancel reset and save footer mirror source", async () => {
  const h = harness(); h.render(); latest(h, "context").resolve(context); latest(h, "policy").resolve({ ...policy, showPrivateTunnelsWarning: true }); latest(h, "url").resolve(null); await flush(); let tree = h.render();
  tree = chooseMode(h, tree, "public"); assert.match(text(tree), /如果此网站使用私有隧道/); let prevented = false;
  walk(tree).find(n => n.type === "form").props.onKeyDown({ key: "Enter", nativeEvent: { isComposing: true }, preventDefault() { prevented = true; } }); assert.equal(prevented, true); assert.equal(h.calls.filter(c => c.operation === "write").length, 0);
  walk(tree).find(n => n.type === "button" && text(n) === "取消").props.onClick({ preventDefault() {} }); tree = h.render(); assert.equal(h.changes.length, 0); assert.equal(walk(tree).some(n => n.type === "button" && text(n) === "完成"), true); h.unmount();
});
await check("actual saving leaves X and Escape usable; copy uses only preferred URL and boolean clipboard receipt", async () => {
  const h = harness(); h.render(); latest(h, "context").resolve(context); latest(h, "policy").resolve(policy); latest(h, "url").resolve("https://preferred.example.invalid/live"); await flush(); let tree = h.render();
  const link = walk(tree).find(n => n.type === "a"); assert.equal(link.props.href, "https://preferred.example.invalid/live"); assert.equal(link.props.rel, "noreferrer");
  walk(tree).find(n => n.props["aria-label"] === "复制链接").props.onClick({ preventDefault() {} }); assert.equal(latest(h, "copy").args[0], link.props.href); latest(h, "copy").resolve(false); await flush(); assert.equal(h.errors.at(-1), "无法复制链接");
  tree = chooseMode(h, tree, "public"); walk(tree).find(n => n.type === "form").props.onSubmit({ preventDefault() {} }); tree = h.render(); assert.equal(walk(tree).find(n => n.props["aria-label"] === "关闭").props.disabled, undefined);
  walk(tree).find(n => n.type === "dialog").props.onCancel({ preventDefault() {}, stopPropagation() {} }); assert.equal(h.changes.at(-1), "closed"); latest(h, "write").reject(Error("late")); await flush(); assert.equal(h.errors.filter(e => e === "无法保存共享设置").length, 0); h.unmount();
});
await check("first load does not notify parent metadata; active refresh does, pending projection retains actual GET separately", async () => {
  const h = harness(), s = h.state(); await ready(h, s); assert.equal(h.updated.length, 0); s.change("workspace_all"); void s.save(); latest(h, "write").resolve({ status: "pending" }); await flush(); latest(h, "policy").resolve({ ...policy, accessMode: "workspace_all" }); await flush();
  assert.equal(s.lastReadPolicy.accessMode, "workspace_all"); assert.equal(h.updated.at(-1).accessMode, "custom"); s.dispose();
});
await check("preferred refresh single-flight and 10-second failed-write readback abort preserve draft without repeat PATCH", async () => {
  const h = harness(), s = h.state(); await ready(h, s); void s.loadUrl(); void s.loadUrl(); assert.equal(h.calls.filter(c => c.operation === "url").length, 2); latest(h, "url").resolve(null); await flush();
  s.change("public"); void s.save(); latest(h, "write").reject({ code: "site_sharing_unconfirmed" }); await flush(); const get = latest(h, "policy"); h.tick(10000); assert.equal(get.signal.aborted, true); get.reject(Error("cancelled")); await flush();
  assert.equal(s.draft, "public"); assert.equal(s.unknown, true); assert.equal(s.saving, false); assert.equal(h.calls.filter(c => c.operation === "write").length, 1); s.dispose();
});
await check("actual mode menu option descriptions and keyboard Escape never dismiss whole dialog or save", async () => {
  const h = harness(); h.render(); latest(h, "context").resolve(context); latest(h, "policy").resolve(policy); latest(h, "url").resolve(null); await flush(); let tree = h.render();
  walk(tree).find(n => n.type === "button" && n.props["aria-label"] === "链接访问权限").props.onClick({ preventDefault() {} }); tree = h.render(); assert.equal(walk(tree).filter(n => n.props.role === "menuitemradio").length, 3); assert.match(text(tree), /任何拥有该链接的互联网用户均可查看/);
  let prevented = false, stopped = false; walk(tree).find(n => n.props.role === "menu").props.onKeyDown({ key: "Escape", nativeEvent: {}, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }); tree = h.render(); assert.equal(prevented && stopped, true); assert.equal(walk(tree).some(n => n.props.role === "menu"), false); assert.equal(h.changes.length, 0); assert.equal(h.calls.filter(c => c.operation === "write").length, 0); h.unmount();
});
await check("clipboard late failure after unmount cannot display old toast on another page", async () => {
  const h = harness(); h.render(); latest(h, "context").resolve(context); latest(h, "policy").resolve(policy); latest(h, "url").resolve("https://preferred.example.invalid/live"); await flush(); const tree = h.render();
  walk(tree).find(n => n.props["aria-label"] === "复制链接").props.onClick({ preventDefault() {} }); h.unmount(); const writes = h.writes; latest(h, "copy").resolve(false); await flush(); assert.equal(h.errors.length, 0); assert.equal(h.writes, writes);
});
await check("parent metadata notification sync/async errors remain separate from confirmed sharing save", async () => {
  for (const asyncFailure of [false, true]) { const h = harness(), s = h.state(); await ready(h, s); let reject; const failure = new Promise((_, no) => { reject = no; }); failure.catch(() => {});
    s.onPolicy = () => { if (!asyncFailure) throw Error("parent metadata"); return failure; };
    s.change("public"); void s.save(); latest(h, "write").resolve(null); await flush(); latest(h, "policy").resolve({ ...policy, accessMode: "public" }); await flush();
    if (asyncFailure) { reject(Error("parent metadata")); await flush(); }
    assert.equal(s.unknown, false); assert.equal(s.draft, null); assert.equal(s.policyError, false); assert.equal(s.error, null); assert.equal(h.errors.at(-1), "无法读取站点最新信息"); s.dispose(); }
});
await check("failed convergence cannot PATCH against errored policy; reopen read after late closed write notifies actual changed policy", async () => {
  const h = harness(), s = h.state(); await ready(h, s); s.change("public"); void s.save(); latest(h, "write").reject({ status: 409 }); await flush(); latest(h, "policy").reject({ status: 500 }); await flush(); assert.equal(s.canSave, false); await s.save(); assert.equal(h.calls.filter(c => c.operation === "write").length, 1); s.dispose();
  const r = harness(), state = r.state(); await ready(r, state); state.change("public"); void state.save(); state.setOpen(false); state.setOpen(true); latest(r, "write").resolve(null); await flush(); latest(r, "policy").resolve({ ...policy, accessMode: "public" }); await flush(); assert.equal(r.updated.at(-1)?.accessMode, "public"); state.dispose();
});
await check("actual mode menu portals inside top-layer dialog, source420/start-5/side5 geometry and listeners clean up", async () => {
  const h = harness(); h.render(); latest(h, "context").resolve(context); latest(h, "policy").resolve(policy); latest(h, "url").resolve(null); await flush(); let tree = h.render();
  walk(tree).find(n => n.type === "button" && n.props["aria-label"] === "链接访问权限").props.onClick({ preventDefault() {} }); h.render(); tree = h.render();
  assert.ok(h.portals.length); assert.equal(typeof h.portals.filter(p => p.child.props.role === "menu").at(-1).target.showModal, "function"); const menu = walk(tree).find(n => n.props.role === "menu"); assert.equal(menu.props.style.width, 420); assert.equal(menu.props.style.left, 31); assert.equal(menu.props.style.top, 81);
  h.window.innerWidth = 320; h.events.get("resize")(); tree = h.render(); assert.equal(walk(tree).find(n => n.props.role === "menu").props.style.width, 296); assert.equal(h.events.has("pointerdown"), true);
  h.unmount(); assert.equal(h.events.has("pointerdown"), false); assert.equal(h.events.has("resize"), false); assert.equal(h.events.has("scroll"), false);
  assert.match(fs.readFileSync("src/components/SiteSharingDialog.css", "utf8"), /\.site-sharing-mode-menu\s*\{\s*position:\s*absolute/);
});
await check("member role writes immediately and preserves existing mode draft; actual GET alone confirms role", async () => {
  const h = harness(), s = h.state(), viewer = { account_user_id: "viewer", name: "既有成员", role: "viewer", editable: true }; await ready(h, s, { ...policy, users: [...policy.users, viewer] }); s.change("public");
  const done = s.changeMember({ kind: "user", id: "viewer" }, "editor"); await flush(); assert.equal(latest(h, "member").args[3], "editor"); assert.equal(s.draft, "public"); latest(h, "member").resolve({ status: "accepted", role_id: "role-site-editor" }); await flush(); assert.equal(s.policy.users.find(u => u.account_user_id === "viewer").role, "viewer"); latest(h, "policy").resolve({ ...policy, users: [...policy.users, { ...viewer, role: "editor" }] }); await flush(); assert.equal(await done, true); assert.equal(s.draft, "public"); assert.equal(s.lastMemberAck.role_id, "role-site-editor"); s.dispose();
});
await check("member pending removal retains row and locks additional mode/member PATCH until GET proves disappearance", async () => {
  const h = harness(), s = h.state(), viewer = { account_user_id: "viewer", role: "viewer", editable: true }; await ready(h, s, { ...policy, users: [...policy.users, viewer] });
  const done = s.changeMember({ kind: "user", id: "viewer" }, null); await flush(); latest(h, "member").resolve({ status: "pending", role_id: null }); await flush(); latest(h, "policy").resolve({ ...policy, users: [...policy.users, viewer] }); await flush(); assert.equal(await done, false); assert.ok(s.memberUnknown); assert.match(s.error, /确认/); await s.changeMember({ kind: "user", id: "viewer" }, null); s.change("public"); await s.save(); assert.equal(h.calls.filter(c => c.operation === "member").length, 1); assert.equal(h.calls.filter(c => c.operation === "write").length, 0);
  const recovery = s.recoverMember(); latest(h, "policy").resolve(policy); await flush(); assert.equal(await recovery, true); assert.equal(s.memberUnknown, null); s.dispose();
});
await check("stale/error policy preflight revalidates target/permissions and admins_only refuses recipient PATCH", async () => {
  const h = harness(), s = h.state(), viewer = { account_user_id: "viewer", role: "viewer", editable: true }; await ready(h, s, { ...policy, users: [...policy.users, viewer] }); h.tick(60000);
  const done = s.changeMember({ kind: "user", id: "viewer" }, null); await flush(); assert.equal(latest(h, "member"), undefined); latest(h, "policy").resolve({ ...policy, accessMode: "admins_only", users: [...policy.users, viewer] }); await flush(); assert.equal(await done, false); assert.equal(latest(h, "member"), undefined); s.dispose();
});
await check("actual existing participant menu removes only through separate compact confirmation; cancel writes nothing", async () => {
  const h = harness(); h.render(); latest(h, "context").resolve(context); latest(h, "policy").resolve({ ...policy, users: [...policy.users, { account_user_id: "viewer", name: "既有成员", role: "viewer", editable: true }] }); latest(h, "url").resolve(null); await flush();
  let confirmation = removalDialog(h, "既有成员"); assert.equal(richText(walk(confirmation).find(n => n.props.id === "site-sharing-member-description")), "This removes 既有成员 from this site’s access list. Other sharing settings may still give them access."); assert.equal(h.portals.filter(p => p.child.props.className?.includes("site-sharing-member-confirm")).at(-1).target, h.document.body);
  walk(confirmation).find(n => n.type === "button" && text(n) === "取消").props.onClick({ preventDefault() {} }); h.render(); assert.equal(h.changes.length, 0); assert.equal(h.calls.filter(c => c.operation === "member").length, 0);
  confirmation = removalDialog(h, "既有成员"); walk(confirmation).find(n => n.type === "form").props.onSubmit({ preventDefault() {}, stopPropagation() {} }); await flush(); assert.equal(latest(h, "member").args[2].id, "viewer");
  let tree = h.render(); confirmation = walk(tree).find(n => n.type === "dialog" && n.props.className.includes("site-sharing-member-confirm")); assert.equal(walk(confirmation).find(n => n.props["aria-label"] === "关闭移除确认").props.disabled, true); assert.equal(walk(confirmation).find(n => n.type === "button" && text(n) === "取消").props.disabled, true);
  let stopped = false; confirmation.props.onCancel({ preventDefault() {}, stopPropagation() { stopped = true; } }); assert.equal(stopped, true); walk(tree).find(n => n.type === "dialog" && !n.props.className.includes("member-confirm")).props.onCancel({ preventDefault() {}, stopPropagation() {} }); assert.equal(h.changes.length, 0);
  latest(h, "member").resolve(null); await flush(); latest(h, "policy").resolve(policy); await flush(); h.render(); assert.equal(h.changes.length, 0); h.unmount();
});
await check("actual role selection writes immediately without removal confirmation and editor description remains exact Chinese", async () => {
  const h = harness(); h.render(); latest(h, "context").resolve({ ...context, canManageEditors: false, sharingManagementAllowed: false }); latest(h, "policy").resolve({ ...policy, users: [...policy.users, { account_user_id: "editor", name: "既有编辑者", role: "editor", editable: true }] }); latest(h, "url").resolve(null); await flush(); let tree = memberMenu(h, "既有编辑者"); assert.match(text(tree), /编辑站点并发布更新。访问、下载、更改或删除其数据。/);
  walk(tree).find(n => n.props["data-member-role"] === "viewer").props.onClick({ preventDefault() {} }); await flush(); assert.equal(latest(h, "member").args[3], "viewer"); latest(h, "member").resolve({ status: "accepted", role_id: "role-site-viewer" }); await flush(); latest(h, "policy").resolve({ ...policy, users: [...policy.users, { account_user_id: "editor", name: "既有编辑者", role: "viewer", editable: true }] }); await flush(); h.unmount();
  const r = harness(); r.render(); latest(r, "context").resolve(context); latest(r, "policy").resolve({ ...policy, users: [...policy.users, { account_user_id: "editor", name: "既有编辑者", role: "editor" }] }); latest(r, "url").resolve(null); await flush(); const confirm = removalDialog(r, "既有编辑者"); assert.match(text(confirm), /既有编辑者 将无法再编辑 真实站点/); r.unmount();
});
await check("group/email target removal is exact; owner, external upgrade, editable false and gate-denied viewer cannot write", async () => {
  const h = harness(), s = h.state(), guest = { account_user_id: null, email: "MixedCase@Actual.invalid", role: "viewer", editable: true }, group = { id: "group", name: "实际群组", editable: true }; await ready(h, s, { ...policy, users: [...policy.users, guest], groups: [group] });
  await s.changeMember({ kind: "email", email: "mixedcase@actual.invalid" }, null); await s.changeMember({ kind: "email", email: guest.email }, "editor"); await s.changeMember({ kind: "user", id: "member" }, null); assert.equal(latest(h, "member"), undefined);
  const done = s.changeMember({ kind: "email", email: guest.email }, null); await flush(); assert.equal(latest(h, "member").args[2].email, guest.email); latest(h, "member").resolve(null); await flush(); latest(h, "policy").resolve({ ...policy, groups: [group] }); await flush(); assert.equal(await done, true);
  const removed = s.changeMember({ kind: "group", id: "group" }, null); await flush(); assert.equal(latest(h, "member").args[2].kind, "group"); latest(h, "member").resolve({ status: "accepted" }); await flush(); latest(h, "policy").resolve(policy); await flush(); assert.equal(await removed, true); s.dispose();
});
await check("member known failure GET revocation clears policy and unknown recovery remains read-only without losing mode draft", async () => {
  const h = harness(), s = h.state(), viewer = { account_user_id: "viewer", role: "viewer", editable: true }; await ready(h, s, { ...policy, users: [...policy.users, viewer] }); s.change("public"); const done = s.changeMember({ kind: "user", id: "viewer" }, null); await flush(); latest(h, "member").reject({ status: 403 }); await flush(); assert.equal(h.errors.length, 0); latest(h, "policy").reject({ status: 403 }); await flush(); assert.equal(await done, false); assert.equal(s.policy, null); assert.equal(h.updated.at(-1), null); assert.equal(s.draft, "public"); assert.equal(s.memberUnknown, null); s.dispose();
  const r = harness(), state = r.state(); await ready(r, state, { ...policy, users: [...policy.users, viewer] }); const write = state.changeMember({ kind: "user", id: "viewer" }, "editor"); await flush(); latest(r, "member").reject({ code: "site_sharing_unconfirmed" }); await flush(); latest(r, "policy").resolve({ ...policy, users: [...policy.users, viewer] }); await flush(); assert.equal(await write, false); assert.ok(state.memberUnknown); const recovery = state.recoverMember(); latest(r, "policy").resolve({ ...policy, users: [...policy.users, { ...viewer, role: "editor" }] }); await flush(); assert.equal(await recovery, true); assert.equal(r.calls.filter(c => c.operation === "member").length, 1); state.dispose();
});
await check("member operation retains tracked scope through GET; disposed/changed-account late failure cannot toast or notify", async () => {
  for (const abort of [false, true]) { const h = harness(), s = h.state(), viewer = { account_user_id: "viewer", role: "viewer", editable: true }; await ready(h, s, { ...policy, users: [...policy.users, viewer] }); const done = s.changeMember({ kind: "user", id: "viewer" }, null); await flush(); let settled = false; void h.load("src/siteSettingsState.ts").waitForSiteSettingsWrites(h.scope.signal).then(() => { settled = true; }); await flush(); assert.equal(settled, false); s.dispose(); if (abort) h.scope.abort(); latest(h, "member").reject({ code: "site_sharing_unconfirmed" }); await flush(); assert.equal(await done, false); assert.equal(h.errors.length, 0); assert.equal(h.updated.length, 0); assert.equal(settled, true); }
});
await check("stale removal preflight rejects changed label/role/owner/removed target instead of mutating old confirmation semantics", async () => {
  for (const variant of ["label", "editor", "owner", "missing"]) { const h = harness(), s = h.state(), viewer = { account_user_id: "viewer", name: "原成员", role: "viewer", editable: true }; await ready(h, s, { ...policy, users: [...policy.users, viewer] }); h.tick(60000);
    const done = s.changeMember({ kind: "user", id: "viewer" }, null, { label: "原成员", role: "viewer" }); await flush(); const changed = variant === "missing" ? [] : [{ ...viewer, name: variant === "label" ? "新成员" : viewer.name, role: variant === "editor" ? "editor" : variant === "owner" ? "owner" : "viewer" }]; latest(h, "policy").resolve({ ...policy, users: [...policy.users, ...changed] }); await flush(); assert.equal(latest(h, "member"), undefined); assert.equal(await done, false); assert.match(s.error, /变化/); s.dispose(); }
});
await check("actual refreshed policy invalidates stale remove dialog; unresolved operation keeps global GET recovery after close/reopen", async () => {
  const h = harness(), viewer = { account_user_id: "viewer", name: "原成员", role: "viewer", editable: true }; h.render(); latest(h, "context").resolve(context); latest(h, "policy").resolve({ ...policy, users: [...policy.users, viewer] }); latest(h, "url").resolve(null); await flush(); removalDialog(h, "原成员");
  void h.componentState.load(true); latest(h, "context").resolve(context); latest(h, "policy").resolve({ ...policy, users: [...policy.users, { ...viewer, name: "新成员" }] }); latest(h, "url").resolve(null); await flush(); h.render(); let tree = h.render(); const title = walk(tree).find(n => n.props.id === "site-sharing-member-title"); assert.equal(text(title).includes("原成员"), false); assert.equal(h.calls.filter(c => c.operation === "member").length, 0);
  let confirmation = removalDialog(h, "新成员"); walk(confirmation).find(n => n.type === "form").props.onSubmit({ preventDefault() {}, stopPropagation() {} }); await flush(); latest(h, "member").resolve({ status: "pending" }); await flush(); latest(h, "policy").resolve({ ...policy, users: [...policy.users, { ...viewer, name: "新成员" }] }); await flush(); tree = h.render(); confirmation = walk(tree).find(n => n.type === "dialog" && n.props.className.includes("member-confirm")); walk(confirmation).find(n => n.type === "button" && text(n) === "取消").props.onClick({ preventDefault() {} }); h.render();
  h.render({ ...h.props, open: false }); h.render({ ...h.props, open: true }); await flush(); tree = h.render(); const recovery = walk(tree).find(n => n.type === "button" && text(n) === "重新读取访问权限"); assert.ok(recovery); recovery.props.onClick({ preventDefault() {} }); latest(h, "policy").resolve(policy); await flush(); tree = h.render(); assert.equal(h.componentState.memberUnknown, null); assert.equal(h.calls.filter(c => c.operation === "member").length, 1); h.unmount();
});

await check("email removal readback cannot falsely confirm case-normalized or accepted member with same mailbox", async () => {
  for (const accepted of [false, true]) { const h = harness(), s = h.state(), guest = { account_user_id: null, email: "MixedCase@Actual.invalid", role: "viewer", editable: true }; await ready(h, s, { ...policy, users: [...policy.users, guest] });
    const done = s.changeMember({ kind: "email", email: guest.email }, null); await flush(); assert.equal(latest(h, "member").args[2].email, guest.email); latest(h, "member").resolve(null); await flush();
    latest(h, "policy").resolve({ ...policy, users: [...policy.users, { ...guest, account_user_id: accepted ? "accepted-member" : null, email: " mixedcase@actual.invalid " }] }); await flush();
    assert.equal(await done, false, "same mailbox still has access even after normalization or account binding"); assert.ok(s.memberUnknown);
    const recovery = s.recoverMember(); latest(h, "policy").resolve(policy); await flush(); assert.equal(await recovery, true); assert.equal(h.calls.filter(c => c.operation === "member").length, 1); s.dispose(); }
});
await check("owner editable group retains current-role menu when invitee mutations are unavailable", async () => {
  const h = harness(); h.render(); latest(h, "context").resolve(context); latest(h, "policy").resolve({ ...policy, accessMode: "admins_only", groups: [{ id: "group", name: "实际群组", editable: true }] }); latest(h, "url").resolve(null); await flush();
  const tree = memberMenu(h, "实际群组"), menu = walk(tree).find(n => n.props.role === "menu" && n.props["aria-label"] === "实际群组 的权限");
  assert.ok(menu); assert.equal(walk(menu).filter(n => n.props.role === "menuitemradio").length, 1); assert.equal(walk(menu).filter(n => n.props.role === "menuitem").length, 0);
  walk(menu).find(n => n.props.role === "menuitemradio").props.onClick({ preventDefault() {} }); await flush(); assert.equal(h.calls.filter(c => c.operation === "member").length, 0); h.unmount();
});
await check("inviting an unshared workspace member uses viewer and actual readback without changing mode draft", async () => {
  const h = harness(), s = h.state(); await ready(h, s); s.change("public");
  const done = s.invite({ kind: "user", id: "new-member" }); await flush(); assert.equal(latest(h, "member").args[3], "viewer"); assert.equal(s.saving, true); await s.save(); assert.equal(latest(h, "write"), undefined);
  latest(h, "member").resolve(null); await flush(); latest(h, "policy").resolve({ ...policy, users: [...policy.users, { account_user_id: "new-member", role: "viewer", editable: true }] }); await flush();
  assert.equal(await done, true); assert.equal(s.draft, "public"); assert.equal(s.canInvite, true); s.dispose();
});
await check("existing external visitors do not grant new invitations; non-owner, existing and duplicate targets cannot write", async () => {
  const h = harness(), s = h.state(); await ready(h, s, { ...policy, users: [...policy.users, { email: "guest@example.invalid", role: "viewer", editable: true }] });
  s.context = { ...context, workspace: false, canInviteExternal: false }; assert.equal(s.canInvite, false); await s.invite({ kind: "user", id: "new-member" }); assert.equal(latest(h, "member"), undefined);
  s.context = context; await s.invite({ kind: "user", id: "member" }); await s.invite({ kind: "email", email: "GUEST@example.invalid" }); assert.equal(latest(h, "member"), undefined);
  s.context = { ...context, memberId: "viewer", email: null }; assert.equal(s.canInvite, false); await s.invite({ kind: "group", id: "new-group" }); assert.equal(latest(h, "member"), undefined); s.dispose();
});
await check("group invitation pending requires explicit readback and never grants editor or repeats the PATCH", async () => {
  const h = harness(), s = h.state(); await ready(h, s); const done = s.invite({ kind: "group", id: "new-group" }); await flush();
  latest(h, "member").resolve({ status: "pending" }); await flush(); latest(h, "policy").resolve(policy); await flush(); assert.equal(await done, false); assert.ok(s.memberUnknown);
  await s.invite({ kind: "group", id: "new-group" }); const recovered = s.recoverMember(); latest(h, "policy").resolve({ ...policy, groups: [{ id: "new-group", editable: true }] }); await flush();
  assert.equal(await recovered, true); assert.equal(h.calls.filter(c => c.operation === "member").length, 1); s.dispose();
});
await check("close/reopen cannot drop an in-flight invitation outcome lock or replay its target", async () => {
  for (const result of ["unknown", "pending"]) {
    const h = harness(), s = h.state(); await ready(h, s); const done = s.invite({ kind: "user", id: "new-member" }); await flush();
    s.setOpen(false); s.setOpen(true); if (result === "unknown") latest(h, "member").reject({ code: "site_sharing_unconfirmed" }); else latest(h, "member").resolve({ status: "pending" }); await flush();
    latest(h, "policy").resolve(policy); await flush(); await done; assert.ok(s.memberUnknown); assert.equal(s.canInvite, false);
    await s.invite({ kind: "user", id: "new-member" }); assert.equal(h.calls.filter(c => c.operation === "member").length, 1);
    const recovered = s.recoverMember(); latest(h, "policy").resolve({ ...policy, users: [...policy.users, { account_user_id: "new-member", role: "viewer", pending: false }] }); await flush(); assert.equal(await recovered, true); s.dispose();
  }
});
assert.equal(failures.length, 0, failures.join("; "));
console.log(`PASS actual SiteSharingDialog/state: ${passed} groups; explicit deferred client/clipboard boundary; no HTTP/native/pixel claim`);

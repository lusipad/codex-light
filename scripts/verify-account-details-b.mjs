import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

let slots = [], cursor = 0, effects = [], scheduled = [], changed = false, read, writeName, writeUsername, check;
const reads = [], nameWrites = [], usernameWrites = [], checks = [], listeners = new Map(), frames = [], timers = new Map();
let time = 0, timerId = 0, tree, focused = "", guard;
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) changed = true; slots[index] = next; }];
  },
  useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
  useEffect(callback, deps) {
    const index = cursor++, old = effects[index];
    if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps[i]))) scheduled.push(() => { old?.cleanup?.(); effects[index] = { deps, cleanup: callback() }; });
  },
};
const service = { serviceErrorMessage: error => error?.message || String(error) };
const bridge = { tauriListen: async (name, handler) => {
  const set = listeners.get(name) || new Set(); listeners.set(name, set); set.add(handler); return () => set.delete(handler);
} };
function load(file, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports, URL, AbortController, require: name => name === "react" ? react : name.endsWith(".css") ? {} : imports[name],
    requestAnimationFrame: callback => frames.push(callback),
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { at: time + delay, callback }); return id; },
    clearTimeout: id => timers.delete(id) });
  return exports;
}
const shared = load("src/accountProfile.ts", { "./config": {}, "./chatgptService": service });
const client = { ...shared,
  loadAccountProfile: signal => { reads.push(signal); return read(signal); },
  updateAccountName: (name, identity, signal) => { nameWrites.push({ name, identity, signal }); return writeName(name, identity, signal); },
  updateProfileUsername: (username, identity, signal) => { usernameWrites.push({ username, identity, signal }); return writeUsername(username, identity, signal); },
  checkProfileUsername: (username, identity, signal) => { checks.push({ username, identity, signal }); return check(username, identity, signal); },
};
const core = load("src/accountDetails.ts", { "./accountProfile": client, "./chatgptService": service, "./bridge": bridge });
const { AccountDetails } = load("src/components/AccountDetails.tsx", { "../accountDetails": core, "../accountProfile": client });
const nodes = node => node && typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : [];
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const modal = () => ({ open: false, showModal() { this.open = true; }, close() { this.open = false; } });
const editModal = modal(), confirmModal = modal();
const props = { accountIdentity: "account-a", connectionIdentity: "connected:one", accountEmail: "auth-fallback@example.invalid", onNavigationGuardChange: value => { guard = value; } };
function render() {
  let count = 0;
  do {
    assert.ok(count++ < 12, "production hooks must converge"); cursor = 0; changed = false;
    tree = AccountDetails(props);
    let dialogIndex = 0;
    for (const node of nodes(tree)) {
      if (node.type === "dialog") node.props.ref.current = dialogIndex++ === 0 ? editModal : confirmModal;
      else if (node.props.ref) node.props.ref.current = { focus() { focused = node.props.id || text(node); } };
    }
    scheduled.splice(0).forEach(effect => effect());
  } while (changed);
  frames.splice(0).forEach(callback => callback());
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const tick = async () => { await settle(); render(); };
const advance = async amount => {
  time += amount;
  for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback(); }
  await tick();
};
const dialogs = () => nodes(tree).filter(node => node.type === "dialog");
const button = (label, confirm = false) => { const found = nodes(confirm ? dialogs()[1] : tree).find(node => node.type === "button" && text(node) === label); assert.ok(found, `button ${label}`); return found; };
const rowButton = kind => nodes(tree).filter(node => node.props.className === "account-details-value")[kind === "name" ? 0 : 1];
const input = () => nodes(tree).find(node => node.type === "input");
const edit = value => { input().props.onChange({ target: { value } }); render(); };
const submit = () => nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
const emit = (event, payload) => { for (const callback of listeners.get(event) || []) callback(payload); };
const identity = { accountId: "account-a", userId: "user-a", generation: 4 };
const profile = { displayName: "公开名不是账户姓名", bio: "public", username: "local_name~workspace", profileUrl: null, pictureUrl: null, canEdit: true, canEditUsername: true };
let snapshot = { account: { account: { type: "chatgpt", email: "account-read@example.invalid", planType: "pro" }, requiresOpenaiAuth: true }, identity,
  me: { id: "user-a", name: "真实账户姓名", email: "me-source@example.invalid", picture: null }, profile, page: { ...profile, isSelf: true }, errors: {} };
read = async () => snapshot; check = async () => ({ available: true });
render(); await tick();
assert.ok(text(tree).includes("真实账户姓名")); assert.ok(!text(tree).includes("公开名不是账户姓名"));
assert.ok(text(tree).includes("me-source@example.invalid")); assert.ok(!text(tree).includes(props.accountEmail));
snapshot = { ...snapshot, me: { ...snapshot.me, email: null } };
emit("account-profile-changed", { identity }); await tick(); assert.ok(text(tree).includes(props.accountEmail));
rowButton("name").props.onClick(); render(); assert.equal(editModal.open, true); assert.equal(focused, "account-detail-input");
assert.equal(button("保存").props.disabled, true); submit(); await tick(); assert.equal(nameWrites.length, 0);
edit("   "); assert.equal(button("保存").props.disabled, true); submit(); await tick(); assert.equal(nameWrites.length, 0);
edit("  原串姓名  ");
let release;
writeName = () => new Promise(resolve => { release = resolve; });
submit(); submit(); render(); assert.equal(nameWrites.length, 1); assert.equal(nameWrites[0].name, "  原串姓名  ");
assert.equal(guard(() => assert.fail("busy navigation")), false); dialogs()[0].props.onCancel({ preventDefault() {} }); render(); assert.equal(editModal.open, true);
snapshot = { ...snapshot, me: { ...snapshot.me, name: "  原串姓名  " } };
release({ verification: "confirmed", body: {}, readback: snapshot.me }); await tick(); assert.equal(editModal.open, false); assert.equal(focused, "  原串姓名  ");
console.log("PASS AD-B01: actual name/me-email sources never borrow public display name, auth email fallback, empty/unchanged zero writes, raw name submission, save single-flight/busy guard and confirmed focus return");

rowButton("name").props.onClick(); render(); edit("失败姓名稿");
writeName = async () => { throw { message: "name rejected" }; }; submit(); await tick(); assert.equal(input().props.value, "失败姓名稿"); assert.ok(text(tree).includes("name rejected"));
let prevented = 0;
input().props.onKeyDown({ key: "Enter", nativeEvent: { isComposing: true }, keyCode: 229, preventDefault() { prevented++; } });
assert.equal(prevented, 1); assert.equal(nameWrites.length, 2, "composition key event does not invoke a write");
let navigations = 0, reentry;
assert.equal(guard(() => { reentry = guard(() => {}); navigations++; }), false); render();
button("继续编辑", true).props.onClick(); render(); assert.equal(input().props.value, "失败姓名稿");
assert.equal(guard(() => { reentry = guard(() => {}); navigations++; }), false); render();
const discardTwice = button("放弃更改", true).props.onClick; discardTwice(); discardTwice(); render();
assert.equal(navigations, 1); assert.equal(reentry, true); assert.equal(editModal.open, false);
rowButton("username").props.onClick(); render(); assert.equal(input().props.value, "local_name", "tilde scoped suffix is excluded from local editing");
edit("new_name"); const checksBefore = checks.length; await advance(399); assert.equal(checks.length, checksBefore); assert.equal(button("更改用户名").props.disabled, true);
await advance(1); assert.equal(checks.length, checksBefore + 1); assert.equal(checks.at(-1).username, "new_name"); assert.equal(button("更改用户名").props.disabled, false);
let oldCheck, newCheck;
check = value => new Promise(resolve => { if (value === "old_name") oldCheck = resolve; else newCheck = resolve; });
edit("old_name"); await advance(400); edit("newer_name"); await advance(400);
assert.equal(checks.at(-2).signal.aborted, true); oldCheck({ available: true }); await tick(); assert.equal(button("更改用户名").props.disabled, true);
newCheck({ available: false }); await tick(); assert.ok(text(tree).includes("该用户名已被占用")); assert.equal(button("更改用户名").props.disabled, true);
check = async () => { throw Error("availability offline"); }; edit("other_name"); await advance(400); assert.ok(text(tree).includes("无法检查用户名是否可用"));
check = async () => ({ available: true }); button("重试").props.onClick(); render(); await advance(400); assert.equal(button("更改用户名").props.disabled, false);
writeUsername = async username => {
  snapshot = { ...snapshot, profile: { ...snapshot.profile, username: `${username}~workspace` } };
  return { verification: "confirmed", body: {}, readback: { profile_details: { username: `${username}~workspace` }, viewer_access: { can_edit_username: true } } };
};
submit(); await tick(); assert.equal(usernameWrites.at(-1).username, "other_name"); assert.equal(editModal.open, false); assert.ok(text(tree).includes("@other_name~workspace"));
console.log("PASS AD-B02: failed drafts retained, IME suppresses default submit, dirty guard confirms once/reentry clean, tilde local editing, exact 400ms check, aborted late checks, occupied/error/retry and canonical confirmed username");

for (const permission of [false, null]) {
  snapshot = { ...snapshot, profile: { ...snapshot.profile, canEditUsername: permission } }; emit("account-profile-changed", { identity }); await tick();
  assert.equal(rowButton("username").props.disabled, true); rowButton("username").props.onClick(); render(); assert.equal(editModal.open, false);
}
snapshot = { ...snapshot, profile: { ...snapshot.profile, canEditUsername: true } }; emit("account-profile-changed", { identity }); await tick();
rowButton("name").props.onClick(); render(); edit("等待姓名同步");
writeName = async () => ({ verification: "pending", body: { name: "等待姓名同步" }, readback: snapshot.me });
submit(); await tick(); const pendingWrites = nameWrites.length;
assert.ok(text(tree).includes("已提交，等待资料同步")); assert.equal(input().props.value, "等待姓名同步"); assert.equal(button("保存").props.disabled, true);
submit(); await tick(); assert.equal(nameWrites.length, pendingWrites);
button("重新读取核验").props.onClick(); await tick(); assert.equal(nameWrites.length, pendingWrites); assert.equal(editModal.open, true);
snapshot = { ...snapshot, me: { ...snapshot.me, name: "等待姓名同步" } }; button("重新读取核验").props.onClick(); await tick(); assert.equal(editModal.open, false);
rowButton("name").props.onClick(); render(); edit("未知送达姓名"); writeName = async () => { throw { code: "profile_write_unknown", message: "unknown delivery" }; };
submit(); await tick(); const unknownWrites = nameWrites.length; assert.ok(text(tree).includes("unknown delivery"));
submit(); button("重新读取核验").props.onClick(); await tick(); assert.equal(nameWrites.length, unknownWrites);
button("取消").props.onClick(); render(); assert.equal(confirmModal.open, true); button("关闭编辑", true).props.onClick(); render(); assert.equal(editModal.open, false);
console.log("PASS AD-B03: false/null permissions lock username, HTTP-pending body never substitutes GET, pending/unknown only reread without duplicate writes, explicit pending-close confirmation");

rowButton("name").props.onClick(); render(); edit("跨窗姓名草稿");
snapshot = { ...snapshot, me: { ...snapshot.me, name: "外部真实姓名" } }; emit("account-profile-changed", { identity }); await tick();
assert.equal(input().props.value, "跨窗姓名草稿"); assert.ok(text(tree).includes("账户资料已在其他位置更改"));
button("重新读取").props.onClick(); render(); assert.equal(confirmModal.open, true); button("继续编辑", true).props.onClick(); render(); assert.equal(input().props.value, "跨窗姓名草稿");
button("重新读取").props.onClick(); render(); button("放弃更改", true).props.onClick(); await tick(); assert.equal(input().props.value, "外部真实姓名");
read = () => new Promise(resolve => { release = resolve; }); emit("account-profile-changed", { identity }); render(); const oldRead = release;
props.accountIdentity = "account-b"; snapshot = { ...snapshot, me: { ...snapshot.me, name: "新账户姓名" } }; read = async () => snapshot;
focused = "new-context"; render(); await tick(); oldRead({ ...snapshot, me: { ...snapshot.me, name: "旧账户晚响应" } }); await tick();
assert.ok(text(tree).includes("新账户姓名")); assert.ok(!text(tree).includes("旧账户晚响应")); assert.equal(focused, "new-context");
rowButton("name").props.onClick(); render(); edit("pending old write"); writeName = () => new Promise(resolve => { release = resolve; }); submit(); render(); const oldWrite = release;
props.connectionIdentity = "connected:two"; render(); await tick(); assert.equal(nameWrites.at(-1).signal.aborted, true);
oldWrite({ verification: "confirmed", body: {}, readback: { ...snapshot.me, name: "pending old write" } }); await tick(); assert.ok(!text(tree).includes("pending old write"));
rowButton("username").props.onClick(); render();
let releaseIdentityCheck;
check = () => new Promise(resolve => { releaseIdentityCheck = resolve; });
edit("generation_probe"); await advance(400);
const priorIdentityCheck = checks.at(-1);
snapshot = { ...snapshot, identity: { ...snapshot.identity, generation: snapshot.identity.generation + 1 } };
emit("account-profile-changed", { identity: snapshot.identity }); await tick();
releaseIdentityCheck({ available: true }); await tick();
assert.equal(button("更改用户名").props.disabled, true, "an availability result from the previous service generation cannot authorize the new identity");
assert.equal(priorIdentityCheck.signal.aborted, true, "service generation changes must dispose the previous username check");
await advance(400); assert.equal(checks.at(-1).identity.generation, snapshot.identity.generation);
releaseIdentityCheck({ available: true }); await tick(); assert.equal(button("更改用户名").props.disabled, false, "the current identity can recover with a fresh successful availability check");
const writesBeforeBackendIdentityChange = usernameWrites.length;
snapshot = { ...snapshot, identity: { accountId: "backend-account-c", userId: "backend-user-c", generation: 20 },
  account: { ...snapshot.account, workspaceRouting: { chatgptAccountId: "backend-account-c" } },
  me: { ...snapshot.me, id: "backend-user-c", name: "后端新账户姓名" },
  profile: { ...snapshot.profile, username: "new_backend_user" } };
emit("app-server:notification", { method: "account/updated" }); await tick();
assert.ok(!editModal.open || button("更改用户名").props.disabled, "backend account/user changes must close or lock the old dirty editor even when props have not changed");
submit(); await tick();
assert.equal(usernameWrites.length, writesBeforeBackendIdentityChange, "an old identity draft must never be written with the new backend identity");
effects.forEach(effect => effect?.cleanup?.()); const beforeUnmount = slots.filter(value => value === null || typeof value !== "object");
await settle(); assert.deepEqual(slots.filter(value => value === null || typeof value !== "object"), beforeUnmount);
assert.equal(guard, null); assert.equal(timers.size, 0); assert.equal([...listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
console.log("PASS AD-B04: cross-window dirty preservation and explicit reload, account/connection late read/write isolation, context-safe focus and unmount timer/subscription/guard cleanup");

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

let slots = [], cursor = 0, effects = [], scheduled = [], changed = false, read, write;
const listeners = new Map(), windowListeners = new Map(), frames = [], reads = [], writes = [];
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
const bridge = {
  tauriListen: async (name, callback) => { const set = listeners.get(name) || new Set(); listeners.set(name, set); set.add(callback); return () => set.delete(callback); },
  tauriInvoke: async () => ({}),
};
const fakeWindow = {
  addEventListener(name, callback) { const set = windowListeners.get(name) || new Set(); windowListeners.set(name, set); set.add(callback); },
  removeEventListener(name, callback) { windowListeners.get(name)?.delete(callback); },
};
function load(file, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports, URL, AbortController, require: name => name === "react" ? react : name.endsWith(".css") ? {} : imports[name],
    window: fakeWindow, requestAnimationFrame: callback => frames.push(callback) });
  return exports;
}
const shared = load("src/accountProfile.ts", { "./config": {}, "./chatgptService": service });
const client = { decodePublicProfile: shared.decodePublicProfile,
  loadAccountProfile: signal => { reads.push(signal); return read(signal); },
  updatePublicProfile: (edits, identity, signal) => { writes.push({ edits, identity, signal }); return write(edits, identity, signal); } };
const core = load("src/publicProfileSettings.ts", { "./accountProfile": client, "./bridge": bridge, "./chatgptService": service });
const navigationModule = load("src/navigationContinuation.ts", {});
const { ProfileSettings } = load("src/components/ProfileSettings.tsx", { "../navigationContinuation": navigationModule, "../publicProfileSettings": core, "../bridge": bridge });
assert.deepEqual(JSON.parse(JSON.stringify(core.publicProfileEdits({ displayName: "A", bio: "old" }, { displayName: " A ", bio: "  " }))), { bio: "" });
const nodes = node => node && typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : [];
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const props = { accountIdentity: "account-a", connectionIdentity: "connected:one", onNavigationGuardChange: value => { guard = value; } };
let guard, tree, focused = "";
const modals = new Map();
function render() {
  let count = 0;
  do {
    assert.ok(count++ < 12, "production hooks must converge"); cursor = 0; changed = false;
    tree = ProfileSettings(props);
    for (const node of nodes(tree)) {
      if (node.type === "dialog") {
        let dialog = modals.get(node.props.className);
        if (!dialog) { dialog = { opened: false, showModal() { this.opened = true; }, close() { this.opened = false; } }; modals.set(node.props.className, dialog); }
        node.props.ref.current = dialog;
      } else if (node.props.ref) node.props.ref.current = { focus() { focused = node.props.id || text(node); } };
    }
    scheduled.splice(0).forEach(effect => effect());
  } while (changed);
  frames.splice(0).forEach(callback => callback());
}
const settle = async () => { for (let i = 0; i < 18; i++) await Promise.resolve(); };
const tick = async () => { await settle(); render(); };
const dialog = kind => nodes(tree).find(node => node.type === "dialog" && node.props.className.includes(kind));
const button = (label, kind) => { const found = nodes(kind ? dialog(kind) : tree).find(node => node.type === "button" && text(node) === label); assert.ok(found, `button ${label}`); return found; };
const input = id => nodes(tree).find(node => node.props.id === `public-profile-${id}`);
const edit = (key, value) => { input(key === "displayName" ? "name" : "bio").props.onChange({ target: { value } }); render(); };
const profileFields = { displayName: "公开显示名称", bio: "公开简介", username: "real_user", profileUrl: "https://example.invalid/u/real_user", pictureUrl: null, canEdit: null, canEditUsername: true };
const identity = { accountId: "account-a", userId: "user-a", generation: 1 };
let snapshot = { account: { account: { type: "chatgpt", email: "auth@example.invalid", planType: "pro" }, requiresOpenaiAuth: true }, identity,
  me: { id: "user-a", name: "账户姓名不得当显示名称", email: "me@example.invalid", picture: "https://example.invalid/account-picture" },
  profile: { ...profileFields }, page: { ...profileFields, canEdit: true, isSelf: null }, errors: {} };
const rawReadback = (displayName, bio) => ({ profile_details: { display_name: displayName, description: bio } });
const emitProfile = (eventIdentity = identity) => { for (const callback of listeners.get("account-profile-changed") || []) callback({ identity: eventIdentity }); };
const focusEvent = () => { for (const callback of windowListeners.get("focus") || []) callback(); };
read = async () => snapshot;
render(); await tick();
assert.ok(text(tree).includes("公开显示名称")); assert.ok(!text(tree).includes("账户姓名不得当显示名称"));
assert.equal(nodes(tree).filter(node => node.type === "img").length, 0, "account picture is not a public picture fallback");
assert.equal(button("编辑个人资料").props.disabled, false, "own page can_edit is sufficient without is_self or viewer_access gate");
assert.equal(nodes(tree).find(node => node.type === "a").props.href, profileFields.profileUrl);
button("编辑个人资料").props.onClick(); render(); assert.equal(focused, "public-profile-name");
assert.equal(input("name").props.maxLength, 64); assert.equal(input("bio").props.maxLength, 140);
assert.equal(input("name").props.value, profileFields.displayName);
button("保存", "edit-dialog").props.onClick(); await tick(); assert.equal(writes.length, 0, "unchanged save closes without a write");
button("编辑个人资料").props.onClick(); render(); edit("bio", "中文\r\n简介\u2028第二行");
assert.equal(input("bio").props.value, "中文 简介 第二行");
let prevented = 0;
input("bio").props.onKeyDown({ key: "Enter", keyCode: 0, nativeEvent: { isComposing: true }, preventDefault() { prevented++; } }); assert.equal(prevented, 0);
input("bio").props.onKeyDown({ key: "Enter", keyCode: 0, nativeEvent: { isComposing: false }, preventDefault() { prevented++; } }); assert.equal(prevented, 1);
input("name").props.onKeyDown({ key: "Enter", keyCode: 229, nativeEvent: { isComposing: false }, preventDefault() {} }); await tick(); assert.equal(writes.length, 0);
button("取消", "edit-dialog").props.onClick(); render(); assert.equal(writes.length, 0); assert.equal(focused, "编辑个人资料");
console.log("PASS PF-B01: production public fields/actual URL and permission branch, no account-name/avatar substitution, exact UTF16 limits, newline/IME handling and unchanged/cancel zero writes");

button("编辑个人资料").props.onClick(); render(); edit("displayName", "  新公开名  ");
let release;
write = () => new Promise(resolve => { release = resolve; });
const save = button("保存", "edit-dialog").props.onClick;
save(); save(); render(); assert.equal(writes.length, 1); assert.equal(guard(() => assert.fail("busy guard")), false);
assert.deepEqual(JSON.parse(JSON.stringify(writes[0].edits)), { displayName: "新公开名" });
assert.deepEqual(JSON.parse(JSON.stringify(writes[0].identity)), identity);
dialog("edit-dialog").props.onCancel({ preventDefault() {} }); render(); assert.equal(modals.get(dialog("edit-dialog").props.className).opened, true);
release({ verification: "confirmed", body: { ignored: true }, readback: rawReadback("新公开名", "公开简介") }); await tick();
assert.equal(modals.get(dialog("edit-dialog").props.className).opened, false); assert.equal(focused, "编辑个人资料");
button("编辑个人资料").props.onClick(); render(); assert.equal(input("name").props.value, "新公开名"); edit("bio", "");
write = async () => { throw { message: "description moderated" }; };
button("保存", "edit-dialog").props.onClick(); await tick(); assert.equal(input("bio").props.value, ""); assert.ok(text(tree).includes("description moderated"));
assert.deepEqual(JSON.parse(JSON.stringify(writes.at(-1).edits)), { bio: "" });
let navigation = 0, reentry;
assert.equal(guard(() => { reentry = guard(() => {}); navigation++; }), false); render();
button("继续编辑", "discard-dialog").props.onClick(); render(); assert.equal(input("bio").props.value, "");
assert.equal(guard(() => { reentry = guard(() => {}); navigation++; }), false); render();
button("放弃更改", "discard-dialog").props.onClick(); render(); assert.equal(navigation, 1); assert.equal(reentry, true);
console.log("PASS PF-B02: production minimal trimmed PATCH intent, empty bio, single-flight/busy close guard, verified GET values, service field failure keeps draft and global discard clears guard synchronously");

button("编辑个人资料").props.onClick(); render(); edit("bio", "等待同步");
write = async () => ({ verification: "pending", body: { profile_details: { description: "等待同步" } }, readback: rawReadback("公开显示名称", "旧简介") });
button("保存", "edit-dialog").props.onClick(); await tick(); assert.ok(text(tree).includes("已提交，等待个人资料同步")); assert.equal(input("bio").props.value, "等待同步");
const pendingWrites = writes.length;
button("保存", "edit-dialog").props.onClick(); await tick(); assert.equal(writes.length, pendingWrites, "pending cannot resend a PATCH");
snapshot = { ...snapshot, page: { ...snapshot.page, bio: "仍是旧值" } }; focusEvent(); await tick();
assert.equal(writes.length, pendingWrites); assert.equal(input("bio").props.value, "等待同步");
snapshot = { ...snapshot, page: { ...snapshot.page, bio: "等待同步" } }; button("重新读取", "edit-dialog").props.onClick(); await tick();
assert.equal(modals.get(dialog("edit-dialog").props.className).opened, false); assert.equal(writes.length, pendingWrites);
button("编辑个人资料").props.onClick(); render(); edit("bio", "未知送达");
write = async () => { throw { code: "profile_write_unknown", message: "response lost" }; };
button("保存", "edit-dialog").props.onClick(); await tick(); assert.ok(text(tree).includes("response lost")); assert.ok(text(tree).includes("已提交，等待个人资料同步"));
const unknownWrites = writes.length; button("保存", "edit-dialog").props.onClick(); await tick(); assert.equal(writes.length, unknownWrites);
button("取消", "edit-dialog").props.onClick(); render();
console.log("PASS PF-B03: HTTP success with pending/mismatched GET keeps draft and never trusts body, later actual GET confirms, unknown-delivery errors enter read-only verification without automatic replay");

// A new identity clears submitted intents and any old private draft.
props.accountIdentity = "account-next"; render(); await tick();
button("编辑个人资料").props.onClick(); render(); edit("bio", "dirty external draft");
const beforeForeign = reads.length; emitProfile({ ...identity, accountId: "foreign" }); await tick(); assert.equal(reads.length, beforeForeign);
emitProfile(); render(); assert.ok(text(tree).includes("你的草稿已保留")); assert.equal(input("bio").props.value, "dirty external draft");
assert.equal(button("保存", "edit-dialog").props.disabled, true);
button("重新加载", "edit-dialog").props.onClick(); render(); button("继续编辑", "discard-dialog").props.onClick(); render(); assert.equal(input("bio").props.value, "dirty external draft");
snapshot = { ...snapshot, page: { ...snapshot.page, bio: "external actual" } };
button("重新加载", "edit-dialog").props.onClick(); render(); button("放弃更改", "discard-dialog").props.onClick(); await tick(); assert.equal(input("bio").props.value, "external actual");
read = () => new Promise(resolve => { release = resolve; }); focusEvent(); render(); const inFlightRead = release;
edit("bio", "typed while loading");
inFlightRead({ ...snapshot, page: { ...snapshot.page, bio: "newer external" } }); await tick(); assert.equal(input("bio").props.value, "typed while loading"); assert.ok(text(tree).includes("你的草稿已保留"));
button("取消", "edit-dialog").props.onClick(); render();
read = async () => snapshot = { ...snapshot, page: { ...snapshot.page, canEdit: false } }; focusEvent(); await tick(); assert.equal(button("编辑个人资料").props.disabled, true);
for (const account of [null, { type: "apiKey" }, { type: "amazonBedrock" }]) {
  read = async () => ({ account: { account, requiresOpenaiAuth: false }, identity: null, me: null, profile: null, page: null, errors: {} });
  focusEvent(); await tick(); assert.ok(!text(tree).includes("external actual"));
  assert.ok(text(tree).includes(account === null ? "未登录" : account.type === "apiKey" ? "API Key" : "Amazon Bedrock"));
}
console.log("PASS PF-B04: foreign identity events ignored, dirty/cross-window/in-flight read preserves draft, explicit reload confirms discard, revoked/unknown permissions and non-ChatGPT states cannot edit or retain prior profile");

snapshot = { ...snapshot, page: { ...snapshot.page, canEdit: true } }; read = async () => snapshot; focusEvent(); await tick();
button("编辑个人资料").props.onClick(); render(); edit("bio", "previous identity draft");
snapshot = { ...snapshot, identity: { accountId: "backend-other", userId: "backend-user", generation: 9 }, page: { ...snapshot.page, displayName: "另一实际账户", bio: "另一实际简介" } };
read = async () => snapshot; focused = "do-not-steal"; focusEvent(); await tick();
assert.equal(modals.get(dialog("edit-dialog").props.className).opened, false, "same-prop backend identity switch must close the old editor");
const previousWrites = writes.length; button("保存", "edit-dialog").props.onClick(); await tick();
assert.equal(writes.length, previousWrites, "old draft cannot be submitted under a new service identity");
assert.equal(focused, "do-not-steal", "closing an old identity editor must not refocus the new identity");
assert.ok(!text(tree).includes("previous identity draft"));
console.log("PASS PF-B06: a backend account/user switch with unchanged props drops the old edit intent and cannot write or steal focus across identities");

read = () => new Promise(resolve => { release = resolve; }); focusEvent(); render(); const oldRead = release;
props.connectionIdentity = "connected:two";
snapshot = { ...snapshot, page: { ...snapshot.page, canEdit: true, displayName: "新连接显示名" } }; read = async () => snapshot;
render(); await tick(); oldRead({ ...snapshot, page: { ...snapshot.page, displayName: "旧连接晚响应" } }); await tick();
assert.ok(text(tree).includes("新连接显示名")); assert.ok(!text(tree).includes("旧连接晚响应"));
button("编辑个人资料").props.onClick(); render(); edit("bio", "late write"); write = () => new Promise(resolve => { release = resolve; });
button("保存", "edit-dialog").props.onClick(); render(); const oldWrite = release;
props.accountIdentity = "another-account"; render(); await tick(); assert.equal(writes.at(-1).signal.aborted, true);
oldWrite({ verification: "confirmed", body: {}, readback: rawReadback("旧账户", "late write") }); await tick(); assert.ok(!text(tree).includes("late write"));
read = () => new Promise(resolve => { release = resolve; }); focusEvent(); render();
effects.forEach(effect => effect?.cleanup?.()); const beforeUnmount = slots.filter(value => value === null || typeof value !== "object");
release(snapshot); await settle(); assert.deepEqual(slots.filter(value => value === null || typeof value !== "object"), beforeUnmount);
assert.equal(guard, null); assert.equal([...listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
assert.equal([...windowListeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
console.log("PASS PF-B05: connection/account epochs abort old work, late read/write cannot expose prior profile or refocus new identity, unmount disposes listeners/guard and ignores pending results");

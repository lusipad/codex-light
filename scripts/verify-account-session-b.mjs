import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

let slots = [], cursor = 0, effects = [], scheduled = [], changed = false, protocol, native;
let failNotificationSubscription = false;
const subscriptionCalls = [];
const listeners = new Map(), windowListeners = new Map(), calls = [], frames = [];
const react = {
  useCallback(callback, deps) {
    const index = cursor++, old = slots[index];
    if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) slots[index] = { deps, callback };
    return slots[index].callback;
  },
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) changed = true; slots[index] = next; }];
  },
  useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
  useEffect(callback, deps) {
    const index = cursor++, old = effects[index];
    if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps[i]))) scheduled.push(() => {
      old?.cleanup?.(); effects[index] = { deps, cleanup: callback() };
    });
  },
};
const bridge = {
  callAppServer: (method, params) => { calls.push([method, params]); return protocol(method, params); },
  tauriInvoke: (method, params) => { calls.push([method, params]); return native(method, params); },
  tauriListen: async (name, callback) => {
    subscriptionCalls.push(name);
    if (name === "app-server:notification" && failNotificationSubscription) { failNotificationSubscription = false; throw Error("subscription failed"); }
    const set = listeners.get(name) || new Set(); listeners.set(name, set); set.add(callback); return () => set.delete(callback);
  },
};
const fakeWindow = {
  addEventListener(name, callback) { const set = windowListeners.get(name) || new Set(); windowListeners.set(name, set); set.add(callback); },
  removeEventListener(name, callback) { windowListeners.get(name)?.delete(callback); },
};
function load(file, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports, URL, require: name => name === "react" ? react : name.endsWith(".css") ? {} : imports[name], window: fakeWindow,
    requestAnimationFrame: callback => frames.push(callback) });
  return exports;
}
const core = load("src/accountSession.ts", { "./bridge": bridge });
const AccountDetails = () => null;
const { AccountSettings } = load("src/components/AccountSettings.tsx", { "../accountSession": core, "./AccountDetails": { AccountDetails } });
const methods = core.managedLoginMethods;
assert.equal(methods({}).status, "unsupported");
for (const malformed of [undefined, [], "bad", { allowedLoginMethods: undefined }, { allowedLoginMethods: ["unknown"] }]) assert.equal(methods(malformed).status, "error");
assert.equal(methods({ allowedLoginMethods: null }).api, true);
assert.equal(methods({ allowedLoginMethods: [] }).chatgpt, false);
assert.equal(methods(null, { forced_login_method: "chatgpt" }).api, false);
assert.equal(methods(null, { forced_login_method: "api" }).chatgpt, false);
assert.equal(methods(null, {}).api, true);
for (const url of ["http://auth.example/", "file:///a", "https://u:p@auth.example/", "https://auth.example/\n", "javascript:alert(1)"]) assert.throws(() => core.validateLoginUrl(url));
assert.equal(core.validateLoginUrl("https://auth.example/login?state=fixture"), "https://auth.example/login?state=fixture");

let account = { account: null, requiresOpenaiAuth: true }, requirements = { allowedLoginMethods: ["api", "chatgpt"] }, fallbackConfig = {};
let start, cancel = async () => ({ status: "canceled" }), logout = async () => ({}), open = async () => ({}), notifyCount = 0;
protocol = async (method, params) => {
  if (method === "account/read") return account;
  if (method === "configRequirements/read") { if (requirements instanceof Error) throw requirements; return { requirements }; }
  if (method === "config/read") return { config: fallbackConfig };
  if (method === "account/login/start") return start(params);
  if (method === "account/login/cancel") return cancel(params);
  if (method === "account/logout") return logout();
  throw Error(`unexpected ${method}`);
};
native = async (method, params) => { assert.equal(method, "review_link_open"); return open(params); };
const nodes = node => node && typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : [];
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const props = { active: true, accountIdentity: "signedout", connectionIdentity: "connected:one", onAccountChanged: () => { notifyCount++; } };
let tree, focused = "";
function render() {
  let count = 0;
  do {
    assert.ok(count++ < 12, "production effects must settle"); cursor = 0; changed = false;
    tree = AccountSettings(props);
    for (const node of nodes(tree)) if (node.props.ref) node.props.ref.current = { focus() { focused = node.props.id || text(node); } };
    scheduled.splice(0).forEach(effect => effect());
  } while (changed);
  frames.splice(0).forEach(callback => callback());
}
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
const tick = async () => { await settle(); render(); };
const button = label => { const found = nodes(tree).find(node => node.type === "button" && text(node) === label); assert.ok(found, `button ${label}`); return found; };
const hasButton = label => nodes(tree).some(node => node.type === "button" && text(node) === label);
const input = () => nodes(tree).find(node => node.type === "input");
const emit = (name, payload) => { for (const callback of listeners.get(name) || []) callback(payload); };
const complete = (loginId, success = true, error) => emit("app-server:notification", { method: "account/login/completed", params: { loginId, success, error } });
const starts = () => calls.filter(([method]) => method === "account/login/start");
const cancels = () => calls.filter(([method]) => method === "account/login/cancel");
render(); await tick(); assert.ok(hasButton("使用 ChatGPT 继续")); assert.ok(hasButton("输入 API 密钥"));
requirements = {}; emit("app-server:notification", { method: "account/updated" }); await tick();
assert.ok(text(tree).includes("请更新此计算机上的 Codex")); assert.equal(hasButton("使用 ChatGPT 继续"), false);
requirements = new Error("managed denied"); button("重试").props.onClick(); await tick();
assert.ok(text(tree).includes("无法加载登录要求")); assert.equal(hasButton("输入 API 密钥"), false);
requirements = null; fallbackConfig = { forced_login_method: "chatgpt" }; button("重试").props.onClick(); await tick();
assert.equal(hasButton("输入 API 密钥"), false); assert.ok(hasButton("使用 ChatGPT 继续"));
requirements = { allowedLoginMethods: [] }; emit("app-server:notification", { method: "account/updated" }); await tick();
assert.ok(text(tree).includes("你的管理员已禁用所有可用的登录方式"));
requirements = { allowedLoginMethods: ["api", "chatgpt"] }; button("重试").props.onClick(); await tick();
console.log("PASS AC08-B01: production managed restrictions fail closed, unsupported requirements, null-only forced-login fallback and true empty restrictions; HTTPS browser URLs validated");

let release;
start = () => new Promise(resolve => { release = resolve; });
const beforeStarts = starts().length;
const clickChat = button("使用 ChatGPT 继续").props.onClick;
clickChat(); clickChat(); render(); assert.equal(starts().length, beforeStarts + 1); assert.ok(hasButton("取消登录"));
release({ type: "chatgpt", loginId: "login-one", authUrl: "https://auth.example/login" }); await tick();
complete("wrong-id"); await tick(); assert.equal(notifyCount, 0); assert.ok(hasButton("取消登录"));
account = { account: { type: "chatgpt", email: "fixture@example.invalid", planType: "plus" }, requiresOpenaiAuth: true };
complete("login-one"); await tick(); assert.equal(notifyCount, 1);
assert.equal(nodes(tree).find(node => node.type === AccountDetails).props.accountEmail, "fixture@example.invalid");
assert.ok(!text(tree).includes("Developer"));
assert.ok(!text(tree).includes("Backend") && !text(tree).includes("account/read") && !text(tree).includes("AccountID"));
logout = async () => { throw Error("logout denied"); }; button("退出登录").props.onClick(); await tick();
assert.ok(text(tree).includes("logout denied")); assert.equal(nodes(tree).find(node => node.type === AccountDetails).props.accountEmail, "fixture@example.invalid");
logout = async () => ({}); button("退出登录").props.onClick(); await tick(); assert.ok(text(tree).includes("退出后仍检测到已登录账户"));
logout = async () => { account = { account: null, requiresOpenaiAuth: true }; return {}; };
button("退出登录").props.onClick(); await tick(); assert.equal(notifyCount, 2); assert.ok(hasButton("使用 ChatGPT 继续"));
console.log("PASS AC08-B02/B03: single active ChatGPT login, matching completion plus actual account readback, real basic rows without fabricated names/diagnostics, logout failure and signed-out readback");

start = async () => ({ type: "chatgpt", loginId: "cancel-one", authUrl: "https://auth.example/login" });
button("使用 ChatGPT 继续").props.onClick(); await tick();
cancel = async () => { throw Error("cancel denied"); };
button("取消登录").props.onClick(); await tick(); assert.ok(text(tree).includes("cancel denied")); assert.ok(hasButton("取消登录"));
assert.equal(hasButton("使用 ChatGPT 继续"), false, "failed cancellation must not free a second active login");
cancel = async () => ({ status: "canceled" }); button("取消登录").props.onClick(); await tick();
assert.ok(hasButton("使用 ChatGPT 继续")); const afterCancel = notifyCount;
complete("cancel-one"); await tick(); assert.equal(notifyCount, afterCancel);
// Cancellation before the start response still cancels the eventual login ID and never opens it.
start = () => new Promise(resolve => { release = resolve; });
button("使用 ChatGPT 继续").props.onClick(); render(); button("取消登录").props.onClick(); render();
const beforeOpen = calls.filter(([method]) => method === "review_link_open").length;
release({ type: "chatgpt", loginId: "cancel-before-response", authUrl: "https://auth.example/login" }); await tick();
assert.equal(cancels().at(-1)[1].loginId, "cancel-before-response");
assert.equal(calls.filter(([method]) => method === "review_link_open").length, beforeOpen); assert.ok(hasButton("使用 ChatGPT 继续"));
// A completion sent before the start result must be bound to that exact returned ID.
start = () => new Promise(resolve => { release = resolve; }); button("使用 ChatGPT 继续").props.onClick(); render();
complete("early-login"); account = { account: { type: "chatgpt", email: "early@example.invalid", planType: "free" }, requiresOpenaiAuth: true };
release({ type: "chatgpt", loginId: "early-login", authUrl: "https://auth.example/login" }); await tick();
assert.equal(nodes(tree).find(node => node.type === AccountDetails).props.accountEmail, "early@example.invalid");
button("退出登录").props.onClick(); await tick();
start = async () => ({ type: "chatgpt", loginId: "browser-failed", authUrl: "https://auth.example/login" });
open = async () => { throw Error("browser unavailable"); }; button("使用 ChatGPT 继续").props.onClick(); await tick();
assert.ok(text(tree).includes("browser unavailable")); assert.equal(cancels().at(-1)[1].loginId, "browser-failed");
assert.ok(hasButton("使用 ChatGPT 继续"));
open = async () => ({});
console.log("PASS AC08-B04: cancellation failure retains active login, cancel-before-ID and old completions are isolated, early matching completion is retained, browser failure cancels the actual request");

button("输入 API 密钥").props.onClick(); render(); assert.equal(focused, "account-api-key"); assert.equal(input().props.type, "password");
nodes(tree).find(node => node.props.className === "account-settings-api-entry").props.onKeyDown({ key: "Escape", preventDefault() {} });
focused = "BODY"; render(); assert.equal(input(), undefined); assert.equal(focused, "输入 API 密钥", "Escape returns focus to the real API entry");
button("输入 API 密钥").props.onClick(); render(); button("取消").props.onClick(); focused = "BODY"; render();
assert.equal(focused, "输入 API 密钥", "explicit cancel returns focus after the password input unmounts");
button("输入 API 密钥").props.onClick(); render(); button("取消").props.onClick();
props.active = false; focused = "other-page"; render(); assert.equal(focused, "other-page", "pending focus must not target an inactive page");
props.active = true; render(); await tick();
button("输入 API 密钥").props.onClick(); render(); button("取消").props.onClick();
props.accountIdentity = "focus-next-account"; focused = "new-account"; render(); await tick();
assert.equal(focused, "new-account", "pending focus must not steal focus after an identity change");
button("输入 API 密钥").props.onClick(); render();
const secret = "sk-fixture-never-real";
input().props.onChange({ target: { value: secret } }); render();
const apiKeyDown = nodes(tree).find(node => node.props.className === "account-settings-api-entry").props.onKeyDown;
const keyEvent = (isComposing, keyCode = 0) => ({ key: "Enter", keyCode, nativeEvent: { isComposing }, preventDefault() {} });
const apiBefore = starts().length;
apiKeyDown(keyEvent(true)); apiKeyDown(keyEvent(false, 229)); await tick(); assert.equal(starts().length, apiBefore);
start = async params => { assert.equal(params.type, "apiKey"); throw Error(`denied ${params.apiKey}`); };
button("继续").props.onClick(); render(); assert.equal(input().props.value, ""); await tick();
assert.ok(text(tree).includes("[已隐藏]")); assert.ok(!text(tree).includes(secret));
assert.ok(!slots.some(value => typeof value === "string" && value.includes(secret)), "API secrets cannot remain in production React state");
input().props.onChange({ target: { value: secret } }); render();
start = async params => { assert.equal(params.apiKey, secret); account = { account: { type: "apiKey" }, requiresOpenaiAuth: true }; return { type: "apiKey" }; };
button("继续").props.onClick(); await tick(); assert.ok(text(tree).includes("已通过 API 密钥登录")); assert.equal(input(), undefined);
button("退出登录").props.onClick(); await tick();
console.log("PASS AC08-B05: actual API password input, IME/229 exclusion, synchronous secret clearing/redacted errors and successful readback without token/local storage");

start = () => new Promise(resolve => { release = resolve; }); button("使用 ChatGPT 继续").props.onClick(); render(); const oldStart = release;
const beforeRestartCancel = cancels().length;
emit("app-server:status", { connected: false }); render();
assert.ok(text(tree).includes("连接已断开")); assert.equal(hasButton("使用 ChatGPT 继续"), false);
emit("app-server:status", { connected: true }); await tick();
oldStart({ type: "chatgpt", loginId: "old-service-id", authUrl: "https://auth.example/login" }); await tick();
assert.equal(cancels().length, beforeRestartCancel, "old service IDs must never cancel a login on the restarted service");
assert.ok(hasButton("使用 ChatGPT 继续"));
start = async () => ({ type: "chatgpt", loginId: "unload-id", authUrl: "https://auth.example/login" }); button("使用 ChatGPT 继续").props.onClick(); await tick();
for (const handler of windowListeners.get("beforeunload") || []) handler(); await tick();
assert.equal(cancels().at(-1)[1].loginId, "unload-id");
props.active = false; render(); await tick(); assert.equal(tree, null);
assert.equal([...listeners.values()].reduce((sum, set) => sum + set.size, 0), 0); assert.equal([...windowListeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
props.active = true; props.accountIdentity = "another-account"; render(); await tick(); assert.ok(hasButton("使用 ChatGPT 继续"));
start = () => new Promise(resolve => { release = resolve; }); button("使用 ChatGPT 继续").props.onClick(); render(); const finalStart = release;
effects.forEach(effect => effect?.cleanup?.()); const beforeUnmount = slots.filter(value => value === null || typeof value !== "object");
finalStart({ type: "chatgpt", loginId: "late-unmount-id", authUrl: "https://auth.example/login" }); await settle();
assert.deepEqual(slots.filter(value => value === null || typeof value !== "object"), beforeUnmount);
assert.equal(cancels().at(-1)[1].loginId, "late-unmount-id");
assert.equal([...listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
console.log("PASS AC08-B06: disconnect/restart isolates late service IDs, beforeunload cancellation, active/account remount and late unmount response dispose all listeners without stale state");

slots = []; cursor = 0; effects = []; scheduled = []; changed = false;
failNotificationSubscription = true;
const subscriptionsBefore = subscriptionCalls.length;
render(); await tick();
assert.ok(text(tree).includes("无法监听登录状态")); assert.equal(button("使用 ChatGPT 继续").props.disabled, true);
assert.equal([...listeners.values()].reduce((sum, set) => sum + set.size, 0), 0, "failed subscriptions release the other successful subscription");
assert.equal(subscriptionCalls.length, subscriptionsBefore + 2);
await tick(); assert.equal(subscriptionCalls.length, subscriptionsBefore + 2, "subscription failures do not create an automatic retry loop");
button("重试").props.onClick(); render(); await tick();
assert.equal(subscriptionCalls.length, subscriptionsBefore + 4); assert.equal(button("使用 ChatGPT 继续").props.disabled, false);
assert.equal(listeners.get("app-server:notification").size, 1); assert.equal(listeners.get("app-server:status").size, 1);
start = async () => ({ type: "chatgpt", loginId: "subscription-recovered", authUrl: "https://auth.example/login" });
const startsBeforeRecovery = starts().length; button("使用 ChatGPT 继续").props.onClick(); await tick();
assert.equal(starts().length, startsBeforeRecovery + 1); assert.ok(hasButton("取消登录"));
const changedBeforeRecovery = notifyCount;
account = { account: { type: "chatgpt", email: "recovered@example.invalid", planType: "free" }, requiresOpenaiAuth: true };
complete("subscription-recovered"); await tick(); assert.equal(notifyCount, changedBeforeRecovery + 1);
assert.equal(nodes(tree).find(node => node.type === AccountDetails).props.accountEmail, "recovered@example.invalid");
effects.forEach(effect => effect?.cleanup?.()); await settle();
assert.equal([...listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
console.log("PASS AC08-B07: failed/half-successful subscriptions are released, explicit retry alone recreates listeners, recovered login completes once without duplicate handlers");

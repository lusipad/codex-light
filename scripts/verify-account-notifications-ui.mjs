import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the production page with controlled service completion order, without account traffic.
const code = ts.transpileModule(fs.readFileSync("src/components/AccountNotificationSettings.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const flush = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const identity = { accountId: "account-a", userId: "user-a", generation: 1 };
const sample = (email = false, push = false) => ({ identity, access: "allowed", contacts: { email: true, sms: false }, contactsError: false,
  settings: [{ category: "tasks", name: "来自服务器的任务", description: "动态描述", options: [
    { channel: "email", name: "邮件", enabled: email }, { channel: "push", name: "推送", enabled: push },
  ] }, { category: "teen_safety", name: "家庭", description: "联系渠道", options: [
    { channel: "email", name: "邮件", enabled: false }, { channel: "sms", name: "短信", enabled: false }, { channel: "other", name: "其他", enabled: false },
  ] }] });
const nodes = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(nodes)] : [];
const text = node => typeof node === "string" ? node : node && typeof node === "object" ? (node.children ?? []).map(text).join("") : "";
function mount() {
  const hooks = [], effects = [], cleanups = new Map(), listeners = new Map(), reads = [], writes = [];
  let cursor = 0, tree; const props = { scope: "a", onManageTasks() { tasks++; } }; let tasks = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useRef(value) { return hooks[cursor++] ??= { current: value }; },
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }]; },
    useEffect(fn, deps) { const i = cursor++; if (!hooks[i] || deps.some((value, n) => value !== hooks[i][n])) {
      hooks[i] = deps; effects.push(() => { cleanups.get(i)?.(); cleanups.set(i, fn()); });
    } },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { exports: module.exports, AbortController, console, require(name) {
    if (name === "react") return react;
    if (name.endsWith("bridge")) return { tauriListen: async (event, callback) => { listeners.set(event, callback); return () => { if (listeners.get(event) === callback) listeners.delete(event); }; } };
    if (name.endsWith("chatgptService")) return { serviceErrorMessage: error => error.message };
    if (name.endsWith("accountNotifications")) return {
      loadAccountNotifications: signal => { const item = { ...deferred(), signal }; reads.push(item); return item.promise; },
      updateAccountNotification: (category, channel, enabled, identity, signal) => {
        const item = { ...deferred(), category, channel, enabled, identity, signal }; writes.push(item); return item.promise;
      },
    };
    if (name.endsWith("AccountNotificationMenu")) return { AccountNotificationMenu: function AccountNotificationMenu() {} };
    return {};
  } });
  const render = () => { cursor = 0; tree = module.exports.AccountNotificationSettings(props); for (const effect of effects.splice(0)) effect(); return tree; };
  const all = () => nodes(tree), menu = label => all().find(node => node.type?.name === "AccountNotificationMenu" && node.props.label === label);
  render();
  return { props, render, all, menu, reads, writes, listeners, tasks: () => tasks, dispose() { for (const cleanup of cleanups.values()) cleanup?.(); } };
}
const page = mount();
assert.ok(page.all().some(node => node.props.role === "status"));
page.reads[0].resolve(sample()); await flush(); page.render();
assert.equal(page.menu("来自服务器的任务").props.options.length, 2);
assert.deepEqual(Array.from(page.menu("家庭").props.options, item => item.channel), ["email", "other"]);
page.all().find(node => node.type === "button" && text(node) === "管理任务").props.onClick(); assert.equal(page.tasks(), 1);

page.menu("来自服务器的任务").props.onChange("email", true); page.render();
page.menu("来自服务器的任务").props.onChange("push", true); page.render();
assert.equal(page.writes.length, 2);
page.writes[1].resolve({ settings: sample(false, true).settings, verification: "confirmed" }); await flush(); page.render();
assert.deepEqual(Array.from(page.menu("来自服务器的任务").props.options, item => item.enabled), [true, true], "one response only merges its channel");
assert.equal(page.reads.length, 1, "wait for every pending write before convergence");
page.writes[0].resolve({ settings: sample(true, false).settings, verification: "confirmed" }); await flush(); page.render();
assert.deepEqual(Array.from(page.menu("来自服务器的任务").props.options, item => item.enabled), [true, true]);
assert.equal(page.reads.length, 2);
page.reads[1].resolve(sample(true, true)); await flush(); page.render();

page.menu("来自服务器的任务").props.onChange("email", false); page.render();
page.menu("来自服务器的任务").props.onChange("email", true); page.render();
page.writes[3].resolve({ settings: sample(true, true).settings, verification: "confirmed" }); await flush(); page.render();
page.writes[2].resolve({ settings: sample(false, true).settings, verification: "confirmed" }); await flush(); page.render();
assert.equal(page.menu("来自服务器的任务").props.options[0].enabled, true, "late same-channel result cannot replace newer intent");
page.reads[2].resolve(sample(true, true)); await flush(); page.render();

page.menu("来自服务器的任务").props.onChange("email", false); page.render();
page.writes[4].reject(Error("write outcome unknown")); await flush(); page.render();
assert.ok(page.menu("来自服务器的任务").props.disabled);
page.menu("来自服务器的任务").props.onChange("push", false); assert.equal(page.writes.length, 5, "unknown write is never replayed or followed by unverified writes");
page.reads[3].reject(Error("read failed")); await flush(); page.render();
assert.ok(page.all().some(node => node.props.role === "alert" && text(node).includes("read failed")));
page.all().find(node => node.type === "button" && text(node) === "重试").props.onClick();
page.reads[4].resolve(sample(false, true)); await flush(); page.render();
assert.equal(page.menu("来自服务器的任务").props.disabled, false);
assert.equal(page.all().some(node => node.props.role === "alert" && text(node).includes("未能更新")), false,
  "successful authoritative GET clears the resolved unknown-write warning");

page.menu("来自服务器的任务").props.onChange("email", true); page.render();
page.listeners.get("chatgpt-service:invalidated")(); page.render();
assert.equal(page.writes[5].signal.aborted, true);
page.reads[5].resolve(sample(false, false)); await flush(); page.render();
page.writes[5].resolve({ settings: sample(true, true).settings, verification: "confirmed" }); await flush(); page.render();
assert.deepEqual(Array.from(page.menu("来自服务器的任务").props.options, item => item.enabled), [false, false], "invalidated result cannot mutate refreshed identity");

page.menu("来自服务器的任务").props.onChange("email", true); page.render();
const oldChange = page.menu("来自服务器的任务").props.onChange;
page.props.scope = "b"; page.render(); page.props.scope = "a"; page.render();
page.reads.at(-1).resolve(sample(false, false)); await flush(); page.render();
oldChange("push", true); assert.equal(page.writes.length, 7, "old rendered callback is rejected even after returning to the same scope");
page.writes[6].resolve({ settings: sample(true, true).settings, verification: "confirmed" }); await flush(); page.render();
assert.equal(page.menu("来自服务器的任务").props.options[0].enabled, false, "ABA scope cannot revive an old write");
page.dispose(); assert.equal(page.listeners.size, 0);

const contacts = mount(); contacts.reads[0].resolve({ ...sample(), contacts: null, contactsError: true }); await flush(); contacts.render();
assert.equal(contacts.menu("家庭"), undefined); assert.ok(contacts.menu("来自服务器的任务"));
assert.ok(contacts.all().some(node => node.props.role === "alert" && text(node).includes("无法加载你的联系方式"))); contacts.dispose();
for (const snapshot of [{ ...sample(), access: "denied" }, { ...sample(), settings: [] }]) {
  const empty = mount(); empty.reads[0].resolve(snapshot); await flush(); empty.render();
  assert.equal(empty.all().filter(node => node.type?.name === "AccountNotificationMenu").length, 0); empty.dispose();
}
const unavailable = mount();
unavailable.reads[0].reject({ code: "notifications_account_unavailable", message: "inventory unavailable" });
await flush(); unavailable.render();
assert.ok(unavailable.all().some(node => node.props.role === "alert" && text(node).includes("无法加载你的账户信息。")));
assert.equal(unavailable.all().some(node => node.props.role === "alert" && text(node).includes("无法加载 ChatGPT 通知设置。")), false);
unavailable.all().find(node => node.type === "button" && text(node) === "重试").props.onClick();
unavailable.reads[1].resolve(sample()); await flush(); unavailable.render();
assert.equal(unavailable.menu("来自服务器的任务").props.disabled, false); unavailable.dispose();
const pending = mount(); pending.reads[0].resolve(sample()); await flush(); pending.render();
pending.menu("来自服务器的任务").props.onChange("email", true); pending.render();
pending.writes[0].resolve({ settings: null, verification: "pending" }); await flush(); pending.render();
assert.ok(pending.all().some(node => node.props.role === "alert" && text(node).includes("等待通知设置同步")));
pending.reads[1].resolve(sample(true)); await flush(); pending.render();
assert.equal(pending.all().some(node => node.props.role === "alert"), false, "confirmed reread clears pending verification prompt");
assert.equal(pending.menu("来自服务器的任务").props.disabled, false); pending.dispose();
console.log("PASS account notifications page: dynamic rows, contacts, per-channel ordering, convergence, unknown writes, retry, invalidation, scope ABA and cleanup");

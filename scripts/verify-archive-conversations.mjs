import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(setImmediate);
let identity = { accountId: "a", userId: "u", generation: 1 }, account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "a" } };
let identityError = null, accountReads = 0, holdListeners = false;
const calls = [], listeners = new Map(), subscriptions = [];
let hooks, effects, cleanups, cursor;
const react = {
  useRef(value) { return hooks[cursor++] ??= { current: value }; },
  useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial;
    return [hooks[i], value => { hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }]; },
  useEffect(fn, deps) { const i = cursor++; if (!hooks[i] || deps.some((value, n) => value !== hooks[i][n])) {
    hooks[i] = deps; effects.push(() => { cleanups.get(i)?.(); cleanups.set(i, fn()); });
  } },
};
const listen = (event, fn) => {
  const pending = defer(); subscriptions.push({ ...pending, event, fn });
  if (!holdListeners) { listeners.set(event, fn); pending.resolve(() => { if (listeners.get(event) === fn) listeners.delete(event); }); }
  return pending.promise;
};
const dependencies = name => {
  if (name === "react") return react;
  if (name.endsWith("bridge")) return { tauriListen: listen };
  if (name.endsWith("config")) return { accountRead: async () => { accountReads++; return structuredClone(account); } };
  if (name.endsWith("chatgptService")) return {
    serviceIdentity: async () => { if (identityError) throw identityError; return { ...identity }; }, serviceErrorMessage: cause => cause.message,
    readArchiveConversationsPage: (offset, expected, signal) => { const item = { ...defer(), offset, expected, signal }; calls.push(item); return item.promise; },
  };
  if (name.endsWith("archiveReadLifecycle")) {
    const shared = { exports: {} }; vm.runInNewContext(compile(fs.readFileSync("src/archiveReadLifecycle.ts", "utf8")), { exports: shared.exports, require: dependencies }); return shared.exports;
  }
  throw Error(`Unexpected dependency ${name}`);
};
const module = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync("src/archiveConversations.ts", "utf8")), { exports: module.exports, AbortController, console, require: dependencies });
const { decodeArchivedConversationsPage: decode, useArchivedConversations } = module.exports;
const item = (id, extra = {}) => ({ id, title: `Conversation ${id}`, create_time: "2026-01-01T00:00:00Z", update_time: "2026-02-01T00:00:00Z", gizmo_id: "gizmo-local-id", ...extra });
const page = (ids, offset = 0, total = 40, includeWorkCloud = false) => ({ access: { status: "allowed", includeWorkCloud }, body: { items: ids.map(id => item(id)), offset, limit: 20, total } });
const decoded = decode({ items: [item("same"), item("same"), {}, null, item(4), item("")], offset: 0, limit: 20, total: 40 }, 0);
assert.deepEqual(Array.from(decoded.items, item => item.id), ["same", ""], "PAr retains string IDs and source-scoped deduplication retains first occurrence");
assert.equal(decoded.nextOffset, 20);
assert.equal(decode({ items: [], offset: 20, limit: 7, total: 29 }, 20).nextOffset, 27, "advance by actual returned limit");
const dates = decode({ items: [item("dates", { create_time: 12, update_time: "invalid" })], offset: 0, limit: 20, total: 1 }).items[0];
assert.equal(dates.createdAt, Date.parse(12) / 1000); assert.equal(dates.updatedAt, null); assert.equal(dates.displayTime, "invalid");
const numericDisplay = decode({ items: [item("number", { update_time: 12 })], offset: 0, limit: 20, total: 1 }).items[0];
assert.equal(numericDisplay.displayTime, 12); assert.equal(numericDisplay.updatedAt, Date.parse(12) / 1000);
for (const bad of [{ items: {}, offset: 0, limit: 20, total: 1 }, { items: [], offset: 0, limit: 0, total: 40 },
  { items: [], offset: -1, limit: 20, total: 0 }, { items: [], offset: 0, limit: 20, total: 1.5 },
  { items: [], offset: Number.MAX_SAFE_INTEGER, limit: 20, total: 1 }, { items: [item("bad", { create_time: {} })], offset: 0, limit: 20, total: 1 }]) assert.throws(() => decode(bad), /无效/);
assert.throws(() => decode({ items: [], offset: 0, limit: 20, total: 40 }, 20), /无效/);
function mount(props = { enabled: true, scope: "a", connected: true }) {
  hooks = []; effects = []; cleanups = new Map(); let state;
  const render = (runEffects = true) => { cursor = 0; state = useArchivedConversations(props); if (runEffects) for (const effect of effects.splice(0)) effect(); return state; };
  render(); return { props, render, get state() { return state; }, dispose() { for (const cleanup of cleanups.values()) cleanup?.(); } };
}
let view = mount({ enabled: false, scope: "a", connected: true }); await flush(); assert.equal(subscriptions.length, 0); assert.equal(accountReads, 0); view.dispose();
holdListeners = true; view = mount(); await flush(); assert.equal(accountReads, 0);
let stopped = 0; subscriptions[0].resolve(() => { stopped++; }); subscriptions[1].reject(Error("listener failure")); await flush(); view.render();
assert.equal(view.state.status, "error"); assert.equal(stopped, 1); assert.equal(calls.length, 0);
subscriptions[2].resolve(() => { stopped++; }); await flush(); assert.equal(stopped, 2);
holdListeners = false; view.state.retryListeners(); view.render(); await flush(); assert.equal(calls.length, 1);
calls[0].resolve(page(["same", "a"])); await flush(); view.render(); assert.equal(view.state.nextOffset, 20);
view.state.loadMore(); view.state.loadMore(); await flush(); assert.equal(calls.length, 2); assert.equal(calls[1].offset, 20);
calls[1].resolve(page(["same", "b"], 20, 61)); await flush(); view.render(); assert.equal(view.state.items.length, 3); assert.equal(view.state.nextOffset, 40);
view.state.loadMore(); await flush(); calls.at(-1).reject({ code: "http_error", message: "HTTP 403" }); await flush(); view.render();
assert.equal(view.state.items.length, 3); assert.ok(view.state.pageError); assert.equal(view.state.nextOffset, 40);
view.state.loadMore(); await flush(); calls.at(-1).resolve(page([], 40, 61)); await flush(); view.render(); assert.equal(view.state.nextOffset, 60);
view.state.loadMore(); await flush(); calls.at(-1).resolve(page(["wrong-scope"], 60, 61, true)); await flush(); view.render();
assert.equal(view.state.items.length, 0); assert.equal(view.state.nextOffset, null); assert.equal(view.state.status, "error");
view.state.reload(); await flush(); assert.equal(calls.at(-1).offset, 0); calls.at(-1).resolve(page(["new-scope"], 0, 1, true)); await flush(); view.render();
assert.equal(view.state.includeWorkCloud, true);
view.state.reload(); await flush(); calls.at(-1).resolve({ access: { status: "denied", includeWorkCloud: null }, body: null }); await flush(); view.render();
assert.equal(view.state.status, "denied"); assert.equal(view.state.items.length, 0); assert.equal(view.state.includeWorkCloud, null);
view.state.reload(); await flush(); calls.at(-1).reject({ code: "archive_access_unknown", message: "unknown gate" }); await flush(); view.render();
assert.equal(view.state.status, "error"); assert.ok(view.state.error);
view.state.reload(); await flush(); const old = calls.at(-1);
view.props.scope = "b"; view.render(); view.props.scope = "a"; view.render(); await flush();
old.resolve(page(["stale"])); calls.at(-1).resolve(page(["fresh"], 0, 40)); await flush(); view.render();
assert.equal(old.signal.aborted, true); assert.equal(view.state.items[0].id, "fresh");
view.state.loadMore(); await flush(); const envelope = calls.at(-1); envelope.reject({ code: "account_changed", message: "wrong response identity" }); await flush(); view.render();
assert.equal(view.state.items.length, 0); assert.equal(view.state.identity, null);
view.state.reload(); await flush(); calls.at(-1).resolve(page(["signout"], 0, 40)); await flush(); view.render();
view.state.loadMore(); await flush(); const signingOut = calls.at(-1); account = { account: null }; identityError = { code: "auth_expired", message: "signed out" };
signingOut.resolve(page(["late"], 20, 40)); await flush(); view.render(); assert.equal(view.state.items.length, 0); assert.equal(view.state.nextOffset, null);
identityError = null; view.dispose();
account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "a" } };
view = mount(); await flush(); calls.at(-1).resolve(page(["range-bound"], 0, 40, false)); await flush(); view.render();
view.state.loadMore(); await flush(); calls.at(-1).resolve({ access: { status: "allowed", includeWorkCloud: true }, body: {} });
await flush(); view.render();
assert.equal(view.state.items.length, 0, "known range changes clear stale pages even when the new body is malformed");
assert.equal(view.state.nextOffset, null); view.dispose();
view = mount(); await flush(); calls.at(-1).resolve(page(["reload-range"], 0, 40, true)); await flush(); view.render();
view.state.reload(); await flush(); calls.at(-1).resolve({ access: { status: "allowed", includeWorkCloud: false }, body: {} });
await flush(); view.render();
assert.equal(view.state.items.length, 0, "reload must clear known old range before decoding a changed-range body");
assert.equal(view.state.identity, null); assert.equal(view.state.includeWorkCloud, null);
assert.equal(view.state.nextOffset, null); assert.equal(view.state.status, "error");
view.state.reload(); await flush(); assert.equal(calls.at(-1).offset, 0);
calls.at(-1).resolve(page(["reloaded-range"], 0, 1, false)); await flush(); view.render();
assert.equal(view.state.items[0].id, "reloaded-range"); assert.equal(view.state.includeWorkCloud, false);
view.state.reload(); await flush(); calls.at(-1).reject({ code: "http_error", message: "HTTP 429" }); await flush(); view.render();
assert.equal(view.state.items[0].id, "reloaded-range", "ordinary reload failure preserves the last verified range");
assert.equal(view.state.includeWorkCloud, false); assert.equal(view.state.status, "error"); view.dispose();
view = mount(); await flush(); calls.at(-1).resolve(page(["old-token-range"], 0, 40, true)); await flush(); view.render();
view.state.loadMore(); await flush(); calls.at(-1).reject({ code: "archive_scope_changed", message: "token plan changed during refresh" });
await flush(); view.render();
assert.equal(view.state.items.length, 0, "host-detected token plan changes also invalidate already displayed pages");
assert.equal(view.state.identity, null); assert.equal(view.state.includeWorkCloud, null); assert.equal(view.state.nextOffset, null);
view.state.reload(); await flush(); assert.equal(calls.at(-1).offset, 0); view.dispose();
for (const [value, status] of [[null, "signed_out"], [{ type: "apiKey" }, "unsupported_auth"]]) {
  account = { account: value }; const count = calls.length; view = mount(); await flush(); view.render();
  assert.equal(view.state.status, status); assert.equal(calls.length, count); view.dispose();
}
// Accepted cache changes are live-epoch operations, distinct from the ready gate for starting writes.
identity = { accountId: "a", userId: "u", generation: 20 };
account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "a" } }; identityError = null;
view = mount(); await flush(); calls.at(-1).resolve(page(["one", "two"], 0, 40, false)); await flush(); view.render();
assert.equal(view.state.canUnarchive("one", identity), true);
assert.equal(view.state.canUnarchive("not-read", identity), false);
assert.equal(view.state.forgetAccepted("one", { ...identity, generation: 21 }), false);
assert.equal(view.state.canUnarchive("already-left-current-page", identity), false, "absent targets cannot start new writes");
assert.equal(view.state.forgetAccepted("already-left-current-page", identity), true, "accepted targets evicted by another operation's first-page refresh are a successful cache no-op");
const acceptedReadVersion = view.state.readVersion;
view.state.reload(); await flush(); const absentTargetOldRead = calls.at(-1); view.render();
assert.equal(view.state.forgetAccepted("already-left-current-page", identity), true);
assert.equal(absentTargetOldRead.signal.aborted, true, "accepted absent targets must still cancel pre-write reads");
absentTargetOldRead.resolve(page(["already-left-current-page", "one", "two"], 0, 40, false)); await flush(); view.render();
assert.deepEqual(Array.from(view.state.items, item=>item.id), ["one", "two"], "a missing-cache no-op must not permit late reinsertion");
const oldCanRecover = view.state.canUnarchive, oldForgetAccepted = view.state.forgetAccepted, oldCurrentIdentity = view.state.isCurrentIdentity;
view.state.reload(); await flush(); const stalePageAfterAcceptance = calls.at(-1); view.render();
assert.equal(view.state.status, "loading"); assert.equal(view.state.canUnarchive("two", identity), false);
assert.equal(view.state.isCurrentIdentity(identity), true, "same-account ordinary refresh does not invalidate in-flight writes");
assert.equal(view.state.forgetAccepted("one", identity), true, "accepted operations may finish during an ordinary list refresh");
assert.equal(stalePageAfterAcceptance.signal.aborted, true);
stalePageAfterAcceptance.resolve(page(["one", "two"], 0, 40, false)); await flush(); view.render();
assert.equal(view.state.readVersion, acceptedReadVersion, "local cache acceptance is not a successful network snapshot");
assert.deepEqual(Array.from(view.state.items, item=>item.id), ["two"], "aborted older page must not reinsert an accepted ID");
view.state.reload(); await flush(); calls.at(-1).resolve(page(["two"], 0, 1, false)); await flush(); view.render();
assert.equal(view.state.readVersion, acceptedReadVersion + 1, "only a successful fresh network replacement advances the snapshot proof");
listeners.get("app-server:notification")({ method: "account/updated" });
assert.equal(oldCanRecover("two", identity), false); assert.equal(oldForgetAccepted("two", identity), false); assert.equal(oldCurrentIdentity(identity), false, "same identity but invalidated epoch rejects stale callbacks before render");
await flush(); calls.at(-1).resolve(page(["same-identity-new-epoch"], 0, 1, false)); await flush(); view.render();
assert.equal(view.state.canUnarchive("same-identity-new-epoch", identity), true);
view.props.connected = false; view.render(false);
assert.equal(view.state.isCurrentIdentity(identity), false); assert.equal(view.state.forgetAccepted("same-identity-new-epoch", identity), false);
view.render(); view.dispose();
console.log("PASS archived conversations: source decoding/dates, real offset, scope changes, independent errors, subscriber gate/cleanup, ABA, identity and authentication boundaries");

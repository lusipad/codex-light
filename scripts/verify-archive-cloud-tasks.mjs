import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/archiveCloudTasks.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
let identity = { accountId: "a", userId: "u", generation: 1 };
let account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "a" } };
const calls = [], pending = [], listeners = new Map();
let holdListeners = false, listenerRequests = [], reads = 0;
let identityError = null;
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(setImmediate);
let hooks, effects, cleanups, cursor;
const react = {
  useRef(value) { return hooks[cursor++] ??= { current: value }; },
  useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial;
    return [hooks[i], value => { hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }]; },
  useEffect(fn, deps) { const i = cursor++; if (!hooks[i] || deps.some((value, n) => value !== hooks[i][n])) {
    hooks[i] = deps; effects.push(() => { cleanups.get(i)?.(); cleanups.set(i, fn()); });
  } },
};
const module = { exports: {} };
vm.runInNewContext(compiled, { exports: module.exports, AbortController, TextEncoder, console, require(name) {
  if (name === "react") return react;
  if (name.endsWith("config")) return { accountRead: async () => { reads++; return structuredClone(account); } };
  if (name.endsWith("chatgptService")) return {
    serviceIdentity: async () => { if (identityError) throw identityError; return { ...identity }; }, serviceErrorMessage: error => error.message,
    readArchiveCloudTasksPage: (next, expected, signal) => { const item = { ...defer(), cursor: next, expected, signal }; calls.push(item); pending.push(item); return item.promise; },
  };
  if (name.endsWith("bridge")) return { tauriListen: (event, fn) => {
    const result = defer(); listenerRequests.push({ ...result, event, fn });
    if (!holdListeners) { listeners.set(event, fn); result.resolve(() => listeners.delete(event)); }
    return result.promise;
  } };
  throw Error(name);
} });
const { decodeArchivedCloudTasksPage, useArchivedCloudTasks } = module.exports;
assert.equal(typeof decodeArchivedCloudTasksPage, "function", "production archive page decoder is required");
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, created_at: 12, updated_at: 14, task_status_display: { environment_label: "Workspace" }, ...extra });
const page = (ids, next = null) => ({ status: 200, body: { items: ids.map(id => task(id)), cursor: next } });
assert.equal(decodeArchivedCloudTasksPage({ items: [task("a"), task("a")] }).items.length, 1);
for (const bad of [{}, { items: null }, { items: [task(2)] }, { items: [task("")] }, { items: [], cursor: 1 },
  { items: [], cursor: "中".repeat(683) }, { items: [], cursor: "a\n" }, { items: [task("a", { created_at: Infinity })] }, { items: [task("a", { task_status_display: [] })] }]) {
  assert.throws(() => decodeArchivedCloudTasksPage(bad), /无效/);
}
assert.equal(decodeArchivedCloudTasksPage({ items: [{ id: "minimal" }], cursor: "opaque +/?" }).nextCursor, "opaque +/?");
assert.equal(decodeArchivedCloudTasksPage({ items: [], cursor: "" }).nextCursor, "", "empty opaque cursor is not null");
const stringTime = decodeArchivedCloudTasksPage({ items: [task("iso", { created_at: 25, updated_at: "2026-11-06T01:02:03Z" })] }).items[0];
assert.equal(stringTime.updatedAt, null, "date strings never become numeric OJ sorting values");
assert.equal(stringTime.createdAt, 25);
assert.equal(stringTime.displayTime, "2026-11-06T01:02:03Z");
assert.ok(Number.isFinite(new Date(stringTime.displayTime).getTime()), "raw ISO display time remains displayable");
const invalidTime = decodeArchivedCloudTasksPage({ items: [task("invalid-date", { created_at: 25, updated_at: "not-a-date" })] }).items[0];
assert.equal(invalidTime.updatedAt, null); assert.equal(invalidTime.createdAt, 25);
assert.equal(invalidTime.displayTime, "not-a-date", "invalid non-null update string never falls back to created date for display");
assert.equal(Number.isFinite(new Date(invalidTime.displayTime).getTime()), false);
for (const value of [true, {}, []]) assert.throws(() => decodeArchivedCloudTasksPage({ items: [task("bad-time", { updated_at: value })] }), /无效/);
function mount(props = { enabled: true, scope: "a", connected: true }) {
  hooks = []; effects = []; cleanups = new Map(); let state;
  const render = (runEffects = true) => { cursor = 0; state = useArchivedCloudTasks(props); if (runEffects) for (const effect of effects.splice(0)) effect(); return state; };
  render(); return { props, render, get state() { return state; }, dispose() { for (const cleanup of cleanups.values()) cleanup?.(); } };
}
let view = mount({ enabled: false, scope: "a", connected: true }); await flush(); assert.equal(reads, 0); assert.equal(listenerRequests.length, 0); view.dispose();
holdListeners = true; view = mount(); await flush(); assert.equal(reads, 0, "no account read before all subscriptions");
listenerRequests[0].resolve(() => {}); listenerRequests[1].reject(Error("listen failed")); await flush(); view.render();
assert.equal(view.state.status, "error"); assert.equal(calls.length, 0);
let lateCleaned = false; listenerRequests[2].resolve(() => { lateCleaned = true; }); await flush(); assert.equal(lateCleaned, true);
holdListeners = false; view.state.retryListeners(); view.render(); await flush(); assert.equal(calls.length, 1);
calls[0].resolve(page(["a", "b"], "next")); await flush(); view.render(); assert.equal(view.state.items.length, 2);
view.state.loadMore(); view.state.loadMore(); await flush(); assert.equal(calls.length, 2); assert.equal(calls[1].cursor, "next");
calls[1].resolve(page(["b", "c"], "third")); await flush(); view.render(); assert.equal(view.state.items.length, 3);
view.state.loadMore(); await flush(); calls[2].resolve(page([], "third")); await flush(); view.render();
assert.ok(view.state.pageError); assert.equal(view.state.items.length, 3); assert.equal(view.state.nextCursor, "third");
view.state.loadMore(); await flush(); calls[3].resolve(page([], "fourth")); await flush(); view.render();
assert.equal(view.state.nextCursor, "fourth", "empty page with a new cursor is not a false end");
view.state.loadMore(); await flush(); calls[4].resolve({ status: 403, body: null }); await flush(); view.render();
assert.equal(view.state.httpEmptyStatus, 403); assert.equal(view.state.nextCursor, null); assert.equal(view.state.items.length, 3);
const establishedListeners = listenerRequests.length;
view.state.retryListeners(); await flush(); assert.equal(listenerRequests.length, establishedListeners, "a ready listener retry is a normal read, not a resubscription");
calls[5].reject(Error("network denied")); await flush(); view.render();
assert.equal(view.state.items.length, 3); assert.equal(view.state.status, "error");
view.state.reload(); await flush(); const old = calls[6];
view.props.scope = "b"; view.render(); view.props.scope = "a"; view.render(); await flush();
assert.equal(old.signal.aborted, true); old.resolve(page(["stale"])); await flush(); view.render(); assert.equal(view.state.items.length, 0);
calls.at(-1).resolve(page(["fresh"])); await flush(); view.render(); assert.equal(view.state.items[0].id, "fresh");
const before = calls.length; view.props.connected = false; view.render(false); view.state.reload(); assert.equal(calls.length, before, "render-gap disconnect blocks reads synchronously");
view.render(); view.dispose();
for (const [code, afterAccount] of [["auth_expired", null], ["auth_required", { type: "apiKey" }],
  ["account_changed", { type: "chatgpt", marker: "different-account" }]]) {
  account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "a" } };
  view = mount(); await flush(); calls.at(-1).resolve(page(["private-old-row"], "private-cursor")); await flush(); view.render();
  view.state.loadMore(); await flush(); const response = calls.at(-1);
  account = { account: afterAccount }; identityError = { code, message: code };
  response.resolve(page(["late-row"])); await flush(); view.render();
  assert.equal(view.state.items.length, 0, `signout before identity ${code} must clear old rows`);
  assert.equal(view.state.nextCursor, null); assert.equal(view.state.identity, null); view.dispose(); identityError = null;
}
account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "a" } };
view = mount(); await flush(); calls.at(-1).resolve(page(["old-user"], "next-user")); await flush(); view.render();
identityError = { code: "account_changed", message: "host identity invalidated" };
const beforeInvalidIdentity = calls.length; view.state.loadMore(); await flush(); view.render();
assert.equal(calls.length, beforeInvalidIdentity, "pre-read identity rejection does not request HTTP");
assert.equal(view.state.items.length, 0); assert.equal(view.state.nextCursor, null); view.dispose(); identityError = null;
view = mount(); await flush(); calls.at(-1).resolve(page(["cancelled-list"], "cancelled-cursor")); await flush(); view.render();
view.state.loadMore(); await flush(); const cancelledIdentity = calls.at(-1);
view.props.enabled = false; view.render(); identityError = { code: "auth_required", message: "late identity failure" };
cancelledIdentity.resolve(page(["ignored"])); await flush(); view.render();
assert.equal(cancelledIdentity.signal.aborted, true); assert.equal(view.state.error, null); assert.equal(view.state.items.length, 0);
view.dispose(); identityError = null;
view = mount(); await flush(); calls.at(-1).resolve(page(["old-envelope"], "next-envelope")); await flush(); view.render();
view.state.loadMore(); await flush(); calls.at(-1).reject({ code: "account_changed", message: "mismatched response envelope" }); await flush(); view.render();
assert.equal(view.state.items.length, 0, "invalid identity envelope drops the already displayed page");
assert.equal(view.state.identity, null); assert.equal(view.state.nextCursor, null); assert.equal(view.state.status, "error"); view.dispose();
view = mount(); await flush(); calls.at(-1).resolve(page(["first"], "")); await flush(); view.render();
view.state.loadMore(); await flush(); assert.equal(calls.at(-1).cursor, "");
calls.at(-1).resolve(page(["second"], "")); await flush(); view.render();
assert.ok(view.state.pageError, "repeated empty opaque cursor is a pagination error, not end-of-list");
assert.equal(view.state.items.length, 1);
const staleReload = view.state.reload;
identity = { ...identity, generation: 2 };
view.state.loadMore(); await flush(); view.render();
assert.equal(view.state.status, "error"); assert.equal(view.state.items.length, 0, "generation change clears old identity rows before any page HTTP");
const identityCalls = calls.length;
view.props.enabled = false; view.render(false); staleReload(); await flush();
assert.equal(calls.length, identityCalls, "disabled render gap rejects old callbacks");
view.render(); view.dispose();
view = mount(); await flush(); const invalidated = calls.at(-1);
listeners.get("app-server:notification")({ method: "account/updated" }); await flush();
assert.equal(invalidated.signal.aborted, true); invalidated.reject(Error("old failure"));
calls.at(-1).resolve(page(["new-account"])); await flush(); view.render();
assert.equal(view.state.items[0].id, "new-account"); assert.equal(view.state.error, null);
listeners.get("app-server:status")({ connected: false }); view.render();
assert.equal(view.state.items.length, 0); const disconnectedCalls = calls.length;
view.state.reload(); await flush(); assert.equal(calls.length, disconnectedCalls);
listeners.get("app-server:status")({ connected: true }); await flush(); calls.at(-1).resolve(page([]));
await flush(); view.render(); assert.equal(view.state.status, "ready"); view.dispose();
view = mount(); await flush(); const identityRace = calls.at(-1);
identity = { ...identity, generation: 3 }; identityRace.resolve(page(["unverified"])); await flush(); view.render();
assert.equal(view.state.status, "error"); assert.equal(view.state.items.length, 0, "identity is checked again after the page response"); view.dispose();
account = { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: "other" } };
const mismatchCalls = calls.length; view = mount(); await flush(); view.render();
assert.equal(view.state.status, "error"); assert.equal(calls.length, mismatchCalls, "workspace routing mismatch never calls list HTTP"); view.dispose();
for (const [value, expected] of [[null, "signed_out"], [{ type: "apiKey" }, "unsupported_auth"]]) {
  account = { account: value }; const start = calls.length; view = mount(); await flush(); view.render();
  assert.equal(view.state.status, expected); assert.equal(calls.length, start); view.dispose();
}
console.log("PASS archived cloud tasks: decoder, listener gate/retry/late cleanup, opaque pagination/dedup, HTTP empty, partial failure, ABA, disconnect and auth applicability");

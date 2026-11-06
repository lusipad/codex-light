import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const json = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const identity = { accountId: "account-a", userId: "global-user", generation: 7 };
const access = kind => ({ identity, gate: true, account: { kind, accountUserId: "membership-self", name: "团队" } });
const prepared = { preparationId: "preparation-a", identity };
const snapshot = { version: 1, turns: [{ items: [{ type: "agentMessage", text: "shared" }] }] };
function mount(overrides = {}) {
  const calls = [], hooks = [], listeners = [], timers = new Map();
  const behavior = {
    access: async () => access("workspace"),
    prepare: async () => ({ json: '{"version":1,"turns":[]}', assets: [{ assetId: "asset-1", mimeType: "image/png", bytes: new Uint8Array([1, 2]) }], redactedSnapshot: snapshot }),
    upload: async () => prepared,
    publish: async () => ({ shareId: "server-id", shareUrl: "https://chatgpt.com/share/server-id" }),
    copy: async () => true,
    search: async operation => operation === "share_groups" ? { items: [{ id: "group-real", name: "Group" }] } :
      { items: [{ id: "global-other", account_user_id: "membership-other", email: "other@example.invalid" }] },
    ...overrides,
  };
  let cursor = 0, dirty = true, mounted = true, result, nextTimer = 0;
  const effects = new Map();
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], value => {
        const next = typeof value === "function" ? value(hooks[index]) : value;
        if (next !== hooks[index]) { hooks[index] = next; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useEffect(callback, dependencies) {
      const index = cursor++, previous = effects.get(index);
      if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
        effects.set(index, { callback, dependencies, previousCleanup: previous?.cleanup, pending: true });
      }
    },
  };
  const membershipModule = { exports: {} };
  vm.runInNewContext(compile("src/serviceAccounts.ts"), { exports: membershipModule.exports, Error, Set });
  const accessModule = { exports: {} };
  vm.runInNewContext(compile("src/shareAccess.ts"), { exports: accessModule.exports, require: name => name === "./serviceAccounts" ? membershipModule.exports : {}, Error, Set });
  const service = {
    discardSharedThread: async (...args) => { calls.push(["discard", ...args]); },
    prepareSharedThread: async (...args) => { calls.push(["upload", ...args]); return behavior.upload(...args); },
    publishSharedThread: async (...args) => { calls.push(["publish", ...args]); return behavior.publish(...args); },
    readChatgptService: async (...args) => { calls.push(["search", ...args]); return behavior.search(...args); },
    serviceErrorMessage: failure => failure?.message || "service error",
  };
  const module = { exports: {} };
  vm.runInNewContext(compile("src/shareThreadSession.ts"), {
    exports: module.exports, AbortController, Uint8Array,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    require: name => {
      if (name === "react") return react;
      if (name === "./bridge") return {
        callAppServer: (...args) => calls.push(["rpc", ...args]),
        tauriListen: async (name, callback) => {
          assert.equal(name, "chatgpt-service:invalidated");
          const listener = { callback, active: true }; listeners.push(listener);
          return () => { listener.active = false; calls.push(["unlisten"]); };
        },
      };
      if (name === "./clipboard") return { copyTextToClipboard: async url => { calls.push(["copy", url]); return behavior.copy(url); } };
      if (name === "./fsClient") return { bytesToBase64: bytes => Buffer.from(bytes).toString("base64") };
      if (name === "./shareAssetReader") return { createShareAssetReader: expected => { calls.push(["reader", expected]); return () => null; } };
      if (name === "./shareAccess") return {
        decodeShareRecipients: accessModule.exports.decodeShareRecipients,
        readShareAccess: async signal => { calls.push(["access", signal]); return behavior.access(signal); },
      };
      if (name === "./chatgptService") return service;
      if (name === "./prepareShareThread") return { prepareShareThread: async (...args) => { calls.push(["prepare", ...args]); return behavior.prepare(...args); } };
      assert.fail(`Unexpected import ${name}`);
    },
  });
  const render = () => {
    if (!mounted) return result;
    let count = 0;
    do {
      assert.ok(count++ < 30, "hook effects must settle");
      dirty = false; cursor = 0;
      result = module.exports.useShareThreadSession("thread-a", () => calls.push(["close"]));
      for (const effect of effects.values()) if (effect.pending) {
        effect.pending = false;
        effect.previousCleanup?.();
        effect.cleanup = effect.callback();
      }
    } while (dirty);
    return result;
  };
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); return render(); };
  render();
  return {
    calls, behavior, render, flush, get value() { return render(); },
    timerCount(delay) { return [...timers.values()].filter(timer => timer.delay === delay).length; },
    tick(delay) {
      for (const [id, timer] of [...timers]) if (timer.delay === delay) {
        timers.delete(id); timer.callback();
      }
      return render();
    },
    invalidate() { for (const listener of listeners) if (listener.active) listener.callback(); return render(); },
    unmount() { mounted = false; for (const effect of effects.values()) effect.cleanup?.(); },
  };
}

const view = mount(); await view.flush();
assert.equal(view.value.phase, "prepared");
assert.deepEqual(json(view.value.snapshot), snapshot);
assert.equal(view.value.audience.access, "workspace");
assert.equal(view.calls.find(call => call[0] === "prepare")[1].threadId, "thread-a");
const upload = view.calls.find(call => call[0] === "upload");
assert.equal(upload[1], "thread-a"); assert.deepEqual(upload[4], identity);
assert.deepEqual(json(upload[3]), [{ assetId: "asset-1", mimeType: "image/png", bytesBase64: "AQI=" }]);
view.value.setQuery("  other  "); view.render();
assert.equal(view.calls.some(call => call[0] === "search"), false, "search waits for debounce");
view.tick(150); await view.flush();
assert.equal(view.value.searching, false); assert.equal(view.value.results.length, 2);
assert.ok(view.calls.filter(call => call[0] === "search").every(call => call[2].query === "other" && call[3] === identity));
const member = view.value.results.find(item => item.principal.principal_type === "user");
view.value.addRecipient(member);
assert.equal(view.value.audience.access, "invited");
assert.deepEqual(json(view.value.audience.principals), [{ principal_id: "membership-other", principal_type: "user" }]);
view.value.removeRecipient(member.id);
assert.equal(view.value.audience.access, "workspace", "automatic invited returns to workspace when emptied");
view.value.setAccess("invited");
await view.value.publishOrCopy();
assert.equal(view.calls.some(call => call[0] === "publish"), false, "manual invited with no principal cannot publish");
assert.equal(view.value.audience.access, "invited", "manual empty invited remains selected");
view.value.setQuery("group"); view.render(); view.tick(150); await view.flush();
const group = view.value.results.find(item => item.principal.principal_type === "group");
view.value.addRecipient(group);
assert.deepEqual(json(view.value.audience.principals), [{ principal_id: "group-real", principal_type: "group" }]);
view.value.setAccess("workspace");
assert.equal(view.value.selected.length, 0); assert.equal(view.value.query, "");
assert.deepEqual(json(view.value.audience.principals), []);
view.unmount(); await view.flush();
assert.deepEqual(json(view.calls.find(call => call[0] === "discard")), ["discard", "preparation-a", identity]);
assert.ok(view.calls.some(call => call[0] === "unlisten"));

const waitingUpload = deferred(), late = mount({ upload: () => waitingUpload.promise });
await late.flush(); const lateSignal = late.calls.find(call => call[0] === "upload").at(-1);
late.unmount(); assert.equal(lateSignal.aborted, true);
waitingUpload.resolve(prepared); await late.flush();
assert.equal(late.calls.filter(call => call[0] === "discard").length, 1, "late upload must release preparation");
assert.equal(late.calls.some(call => call[0] === "publish"), false);
const invalidated = mount(); await invalidated.flush();
invalidated.invalidate();
assert.ok(invalidated.calls.some(call => call[0] === "close"));
assert.equal(invalidated.calls.find(call => call[0] === "access")[1].aborted, true);
await invalidated.value.publishOrCopy();
assert.equal(invalidated.calls.some(call => call[0] === "publish"), false);
invalidated.unmount();

const unknown = mount({ publish: async () => { throw { code: "transport_error" }; } });
await unknown.flush(); await unknown.value.publishOrCopy();
assert.equal(unknown.value.phase, "unknown");
await unknown.value.publishOrCopy(); unknown.value.retry(); await unknown.flush();
assert.equal(unknown.calls.filter(call => call[0] === "publish").length, 1);
assert.equal(unknown.calls.filter(call => call[0] === "upload").length, 1);
assert.equal(unknown.calls.some(call => call[0] === "copy"), false); unknown.unmount();
const audienceChanged = mount({ publish: async () => { throw { code: "share_audience_changed" }; } });
await audienceChanged.flush(); await audienceChanged.value.publishOrCopy();
assert.equal(audienceChanged.value.phase, "unknown", "audience change does not prove the server did not publish");
await audienceChanged.value.publishOrCopy(); audienceChanged.value.retry(); await audienceChanged.flush();
assert.equal(audienceChanged.calls.filter(call => call[0] === "publish").length, 1);
assert.equal(audienceChanged.calls.some(call => call[0] === "copy"), false); audienceChanged.unmount();
const rejected = mount({ publish: async () => { throw { code: "forbidden", message: "Denied" }; } });
await rejected.flush(); await rejected.value.publishOrCopy();
assert.equal(rejected.value.phase, "prepared"); assert.equal(rejected.value.error, "Denied"); rejected.unmount();

let copies = 0;
const copyFailure = mount({ access: async () => access("personal"), copy: async () => ++copies > 1 });
await copyFailure.flush(); assert.equal(copyFailure.value.audience.access, "public");
await copyFailure.value.publishOrCopy();
assert.equal(copyFailure.value.phase, "ready"); assert.equal(copyFailure.value.copyFailed, true);
assert.equal(copyFailure.calls.some(call => call[0] === "close"), false);
await copyFailure.value.publishOrCopy();
assert.equal(copyFailure.calls.filter(call => call[0] === "publish").length, 1, "copy retry cannot republish");
assert.equal(copyFailure.calls.filter(call => call[0] === "copy").length, 2);
assert.equal(copyFailure.calls.filter(call => call[0] === "close").length, 1); copyFailure.unmount();

const flight = deferred(), single = mount({ publish: () => flight.promise });
await single.flush();
const first = single.value.publishOrCopy(), second = single.value.publishOrCopy();
assert.equal(single.calls.filter(call => call[0] === "publish").length, 1);
assert.equal(single.value.phase, "creating");
flight.resolve({ shareId: "id", shareUrl: "https://chatgpt.com/share/id" });
await Promise.all([first, second]); assert.equal(single.calls.filter(call => call[0] === "copy").length, 1); single.unmount();
const latePublication = deferred(), changedDuringPublish = mount({ publish: () => latePublication.promise });
await changedDuringPublish.flush();
const publishing = changedDuringPublish.value.publishOrCopy();
changedDuringPublish.invalidate();
latePublication.resolve({ shareId: "late", shareUrl: "https://chatgpt.com/share/late" });
await publishing;
assert.equal(changedDuringPublish.value.shareUrl, null, "identity invalidation must discard late publish UI results");
assert.equal(changedDuringPublish.calls.some(call => call[0] === "copy"), false);
assert.equal(changedDuringPublish.calls.filter(call => call[0] === "close").length, 1);
changedDuringPublish.unmount();

const oldUsers = deferred(), oldGroups = deferred();
const stale = mount({ search: (operation, params) => params.query === "old"
  ? (operation === "share_users" ? oldUsers.promise : oldGroups.promise)
  : Promise.resolve(operation === "share_users" ? { items: [{ id: "new-global", account_user_id: "new-member", name: "New" }] } : { items: [] }) });
await stale.flush(); stale.value.setQuery("old"); stale.render(); stale.tick(150);
const oldSignal = stale.calls.find(call => call[0] === "search").at(-1);
stale.value.setQuery("new"); stale.render(); assert.equal(oldSignal.aborted, true);
stale.tick(150); await stale.flush();
assert.equal(stale.value.results[0].label, "New");
oldUsers.resolve({ items: [{ id: "old-global", account_user_id: "old-member", name: "Old" }] }); oldGroups.resolve({ items: [] });
await stale.flush(); assert.equal(stale.value.results.length, 1); assert.equal(stale.value.results[0].label, "New");
stale.unmount();
let siblingSignal;
const failedSearch = mount({ search: (operation, _params, _identity, signal) => {
  if (operation === "share_users") return Promise.reject(Error("User search failed"));
  siblingSignal = signal;
  return new Promise(() => {});
} });
await failedSearch.flush(); failedSearch.value.setQuery("failing"); failedSearch.render(); failedSearch.tick(150);
assert.equal(failedSearch.timerCount(15000), 1);
await failedSearch.flush();
assert.equal(siblingSignal.aborted, true, "a failed branch must cancel the otherwise permanently pending sibling");
assert.equal(failedSearch.timerCount(15000), 0, "failed search must clear its timeout");
assert.equal(failedSearch.value.searching, false);
assert.equal(failedSearch.value.searchError, "User search failed");
failedSearch.unmount();
const disabled = mount({ access: async () => ({ identity, gate: false, account: null }) });
await disabled.flush(); assert.equal(disabled.value.phase, "unavailable");
assert.equal(disabled.calls.some(call => call[0] === "prepare" || call[0] === "upload"), false); disabled.unmount();
const failure = mount({ prepare: async () => { throw Error("History failed"); } });
await failure.flush(); assert.equal(failure.value.phase, "error");
failure.behavior.prepare = async () => ({ json: "{}", assets: [], redactedSnapshot: snapshot });
failure.value.retry(); failure.render(); await failure.flush();
assert.equal(failure.value.phase, "prepared"); failure.unmount();
console.log("PASS production share session hook: preparation, lifecycle cleanup, identity invalidation, unknown/singleflight, copy retry, recipients and stale searches");

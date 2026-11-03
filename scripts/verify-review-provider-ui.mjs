import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const source = ts.transpileModule(fs.readFileSync("src/components/ReviewProviderSettings.tsx", "utf8"), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const identity = { accountId: "a", userId: "u", generation: 1 };
const base = () => ({ identity, preferences: { gitHostingProvider: "github", githubConnection: null, gitlabConnectorId: null },
  capabilities: { githubInstances: true, gitlab: false, reviewTabDefault: null }, githubConnections: [], githubConnectionsError: null,
  gitlabInstances: [], gitlabInstancesError: null });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function harness(initial = base()) {
  let slots = [], cursor = 0, pending = [], tree, currentScope = "local", stopped = 0;
  const events = {}, writes = [];
  const control = { read: async () => initial, write: async (field, value) => ({ ...initial, preferences: { ...initial.preferences, [field]: value } }),
    listen: async (name, handler) => { events[name] = handler; return () => { stopped++; delete events[name]; }; } };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    Fragment: "fragment",
    useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect: (fn, deps) => { const i = cursor++; const old = slots[i]; if (!old || deps.some((value, index) => value !== old.deps[index])) {
      pending.push(() => { old?.stop?.(); slots[i] = { deps, stop: fn() }; });
    } },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, AbortController, require: name => name === "react" ? react : name === "../bridge" ? {
    tauriListen: (...args) => control.listen(...args),
  } : { serviceIdentity: async () => identity, readReviewProviderAccess: (...args) => control.read(...args),
    updateReviewProviderPreference: async (...args) => { writes.push(args); return control.write(...args); } } });
  const render = (scope = currentScope) => { currentScope = scope; cursor = 0; tree = exports.ReviewProviderSettings({ scope }); return tree; };
  const effects = () => { const queue = pending; pending = []; queue.forEach(fn => fn()); };
  const nodes = (node = tree) => !node || typeof node !== "object" ? [] : [node, ...node.children.flatMap(child => nodes(child))];
  const text = (node = tree) => node == null || typeof node === "boolean" ? "" : typeof node === "object" ? node.children.map(text).join(" ") : String(node);
  const select = name => nodes().find(node => node.type === "select" && node.props["aria-label"] === name);
  return { control, writes, events, render, effects, nodes, text, select, stopped: () => stopped,
    start: async () => { render(); effects(); await flush(); render(); },
    unmount: () => slots.forEach(slot => slot?.stop?.()), snapshot: () => JSON.stringify(slots) };
}

// CRB07: gate fallback never rewrites the stored value or grants unknown capabilities.
const gated = base(); gated.preferences.gitHostingProvider = "gitlab"; gated.capabilities.gitlab = null;
let h = harness(gated); await h.start();
assert.equal(h.select("代码审查提供商").props.value, "github");
assert.equal(h.nodes().filter(node => node.type === "option" && node.props.value === "gitlab").length, 0);
assert.equal(h.writes.length, 0); assert.match(h.text(), /偏好未更改/); h.unmount();
const unknown = base(); unknown.preferences.gitHostingProvider = "future";
h = harness(unknown); await h.start(); assert.equal(h.select("代码审查提供商").props.value, "future");
assert.match(h.text(), /不支持的原值/); assert.equal(h.writes.length, 0); h.unmount();

// CRB08: unavailable selection is visible and is not replaced by a fabricated connection.
const lost = base(); lost.preferences.githubConnection = { hostname: "git.example.com", connectorId: "lost", accountLinkId: "old" };
lost.githubConnections = [{ hostname: "real.example.com", name: "Enterprise", connection: { connectorId: "real", accountLinkId: "current" } }];
h = harness(lost); await h.start(); assert.equal(h.select("GitHub 实例").props.value, "unavailable");
assert.match(h.text(), /real.example.com — Enterprise/);
assert.match(h.text(), /未自动替换/); assert.equal(h.writes.length, 0);
const wait = deferred(); h.control.write = () => wait.promise;
const change = h.select("GitHub 实例").props.onChange;
change({ target: { value: "0" } }); change({ target: { value: "0" } });
assert.equal(h.writes.length, 1, "single flight blocks repeated event before React rerender");
assert.deepEqual(h.writes[0][4], lost.preferences.githubConnection, "CAS expectation is the actual previously read field");
h.render(); assert.equal(h.select("GitHub 实例").props.value, "unavailable", "no optimistic success");
wait.reject(Error("disk failed")); await flush(); h.render(); assert.match(h.text(), /disk failed/);
assert.equal(h.select("GitHub 实例").props.value, "unavailable");
h.control.write = async (field, value) => ({ ...lost, preferences: { ...lost.preferences, [field]: value } });
h.nodes().find(node => node.type === "button" && h.text(node) === "重试").props.onClick();
await flush(); h.render(); assert.equal(h.select("GitHub 实例").props.value, "0");
assert.equal(h.writes[1][1].accountLinkId, "current"); h.unmount();

// Connection transport errors must not masquerade as an empty inventory or block independent provider changes.
const connectionError = base(); connectionError.capabilities.gitlab = true;
connectionError.githubConnections = null; connectionError.githubConnectionsError = "connection transport failed";
connectionError.preferences.githubConnection = lost.preferences.githubConnection;
h = harness(connectionError); await h.start();
assert.equal(h.select("代码审查提供商").props.disabled, false);
assert.equal(h.select("GitHub 实例").props.disabled, true);
assert.match(h.text(), /connection transport failed/); assert.doesNotMatch(h.text(), /不在当前账号的可用列表/);
h.select("GitHub 实例").props.onChange({ target: { value: "default" } }); assert.equal(h.writes.length, 0);
let rereads = 0; h.control.read = async () => { rereads++; return base(); };
h.nodes().find(node => node.type === "button" && h.text(node) === "重试读取实例").props.onClick();
h.render(); h.effects(); await flush(); h.render();
assert.equal(rereads, 1); assert.equal(h.writes.length, 0, "retry reloads inventory, not a prior mutation");
assert.equal(h.select("GitHub 实例").props.disabled, false); assert.equal(h.select("GitHub 实例").props.value, "default"); h.unmount();
h = harness(connectionError); await h.start();
h.select("代码审查提供商").props.onChange({ target: { value: "gitlab" } }); await flush(); h.render();
assert.equal(h.writes[0][0], "gitHostingProvider"); assert.equal(h.select("代码审查提供商").props.value, "gitlab"); h.unmount();

const gitlab = base(); gitlab.capabilities.gitlab = true; gitlab.preferences.gitHostingProvider = "gitlab"; gitlab.preferences.gitlabConnectorId = "old";
h = harness(gitlab); await h.start(); assert.equal(h.select("GitLab 实例").props.value, "unavailable");
h.select("GitLab 实例").props.onChange({ target: { value: "default" } }); await flush(); h.render();
assert.equal(h.writes[0][0], "gitlabConnectorId"); assert.equal(h.writes[0][1], null); h.unmount();

// Real authorized GitLab instances are selectable; a failed request cannot become an empty inventory.
const gitlabAvailable = { ...gitlab, gitlabInstances: [
  { connectorId: "z-c", hostname: "z.git.example.com", name: "Z work" },
  { connectorId: "a-c", hostname: "a.git.example.com", name: "A work" },
] };
h = harness(gitlabAvailable); await h.start();
assert.match(h.text(), /a.git.example.com — A work/);
const gitlabOptions = h.select("GitLab 实例").children.filter(node => node?.type === "option");
assert.ok(gitlabOptions.findIndex(node => node.props.value === "a-c") < gitlabOptions.findIndex(node => node.props.value === "z-c"), "use the official JS hostname ordering");
h.select("GitLab 实例").props.onChange({ target: { value: "a-c" } }); await flush(); h.render();
assert.equal(h.select("GitLab 实例").props.value, "a-c");
assert.equal(h.writes[0][1], "a-c"); assert.equal(h.writes[0][4], "old", "preserve actual saved CAS expectation");
h.select("GitLab 实例").props.onChange({ target: { value: "forged-c" } }); await flush();
assert.equal(h.writes.length, 1, "unknown connector cannot be selected by a forged DOM change"); h.unmount();
const gitlabFailed = { ...gitlabAvailable, gitlabInstances: null, gitlabInstancesError: "GitLab links failed" };
h = harness(gitlabFailed); await h.start();
assert.equal(h.select("代码审查提供商").props.disabled, false);
assert.equal(h.select("GitLab 实例").props.disabled, true);
assert.match(h.text(), /GitLab links failed/); assert.doesNotMatch(h.text(), /授权列表尚未接入/);
h.select("GitLab 实例").props.onChange({ target: { value: "default" } }); assert.equal(h.writes.length, 0);
let gitlabRereads = 0; h.control.read = async () => { gitlabRereads++; return gitlabAvailable; };
h.nodes().find(node => node.type === "button" && h.text(node) === "重试读取 GitLab 实例").props.onClick();
h.render(); h.effects(); await flush(); h.render();
assert.equal(gitlabRereads, 1); assert.equal(h.select("GitLab 实例").props.disabled, false); assert.equal(h.writes.length, 0); h.unmount();
const explicitDefault = { ...gitlab, preferences: { ...gitlab.preferences, gitlabConnectorId: "connector_0c9786b2f41f41558056126bdb46c9bd" } };
h = harness(explicitDefault); await h.start(); assert.equal(h.select("GitLab 实例").props.value, "default"); assert.equal(h.writes.length, 0); h.unmount();

// CRB06: scope masks old data synchronously, aborts work, ignores late results and cleans late listeners.
for (const fails of [false, true]) {
  const peer = base(); peer.capabilities.gitlab = true;
  h = harness(peer); await h.start();
  const pendingSave = deferred(); h.control.write = () => pendingSave.promise;
  let peerReads = 0;
  h.control.read = async () => { peerReads++; return peer; };
  h.select("代码审查提供商").props.onChange({ target: { value: "gitlab" } });
  const saveSignal = h.writes[0][3];
  h.events["code-review-provider-preferences-changed"]();
  h.events["code-review-provider-preferences-changed"]();
  await flush(); h.render();
  assert.equal(saveSignal.aborted, false, "peer notifications must not silently cancel the user's save");
  assert.equal(peerReads, 0, "coalesce peer refreshes until save settles");
  if (fails) pendingSave.reject(Error("save conflict"));
  else { peer.preferences.gitHostingProvider = "gitlab"; pendingSave.resolve(peer); }
  await flush(); h.render();
  assert.equal(peerReads, 1);
  if (fails) {
    assert.match(h.text(), /save conflict/, "peer refresh retains failure and explicit retry");
    assert.ok(h.nodes().some(node => node.type === "button" && h.text(node) === "重试"));
  } else assert.equal(h.select("代码审查提供商").props.value, "gitlab");
  h.unmount();
}
h = harness(); await h.start(); const writing = deferred(); h.control.write = () => writing.promise;
h.select("GitHub 实例").props.onChange({ target: { value: "default" } });
const signal = h.writes[0][3]; const reading = deferred(); h.control.read = () => reading.promise;
h.render("other-host"); assert.equal(h.select("代码审查提供商"), undefined, "mask before effect cleanup"); h.effects();
assert.equal(signal.aborted, true); await flush(); writing.resolve(base()); await flush(); h.render();
assert.equal(h.select("代码审查提供商"), undefined); h.unmount(); const before = h.snapshot(); reading.resolve(base()); await flush();
assert.equal(h.snapshot(), before); assert.equal(h.stopped(), 6);
h = harness(); const registration = deferred(); h.control.listen = () => registration.promise;
h.render(); h.effects(); h.unmount(); let lateStops = 0; registration.resolve(() => { lateStops++; }); await flush(); assert.equal(lateStops, 3);

// Failed subscriptions remain visible and user retry re-registers; account events clear old capability snapshots.
h = harness(); h.control.listen = async () => { throw Error("event unavailable"); }; await h.start();
assert.match(h.text(), /同步失败/); assert.ok(h.select("代码审查提供商"));
h.control.listen = async (name, handler) => { h.events[name] = handler; return () => {}; };
h.nodes().find(node => node.type === "button" && h.text(node) === "重试同步").props.onClick(); h.render(); h.effects(); await flush(); h.render();
assert.doesNotMatch(h.text(), /同步失败/);
const accountRead = deferred(); h.control.read = () => accountRead.promise;
h.events["app-server:notification"]({ method: "account/updated" }); h.render();
assert.equal(h.select("代码审查提供商"), undefined); h.unmount(); accountRead.resolve(base()); await flush();
console.log("PASS review provider production UI: gates, preserved unknown values, real connection identity, single-flight/readback, failures, scope/account isolation and listener cleanup");

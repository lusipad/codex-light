import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const transpile = text => ts.transpileModule(text, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const remote = {};
vm.runInNewContext(transpile(fs.readFileSync("src/remoteReview.ts", "utf8")), { exports: remote, URL });
const target = remote.parseRemotePullRequestUrl("https://GitHub.com/Owner/Repo/pull/0007?tab=files#discussion");
assert.equal(target.url, "https://github.com/owner/repo/pull/7");
for (const url of ["http://github.com/o/r/pull/1", "https://u@github.com/o/r/pull/1", "https://github.com:443/o/r/pull/1",
  "https://github.com/o/r/pull/0", "https://github.com/o/r/pull/9007199254740992", "https://github.com/o/r/issues/1",
  "https://github.com/o/../r/pull/1", "https://github.com/o/r/pull/1/files", "https://github.com/o/r/pull/1\n?x=1",
  "https://github.com/o%2Fr/r/pull/1", "https://github.com\\o/r/pull/1"]) assert.throws(() => remote.parseRemotePullRequestUrl(url), /链接/);
const result = () => ({ pullRequest: { ...target }, account: { hostId: "local", hostname: "github.com", login: "reviewer" },
  metadata: { status: "success", headRevision: "head-a", additions: 1, deletions: 0, changedFiles: 1, createdAt: "2026-11-04T00:00:00Z", authorLogin: "author" },
  summary: { status: "success", headRevision: "head-a", title: "Real PR title", state: "open", baseBranch: "main", headBranch: "feature", isDraft: false },
  description: "PR description", diff: { headRevision: "head-a", unifiedDiff: "diff --git a/file.ts b/file.ts\n+fixed" } });
assert.equal(remote.parseRemotePullRequest(result(), target.url).summary.title, "Real PR title");
for (const mutate of [data => { data.pullRequest.number = 8; }, data => { data.account.hostname = "other.test"; },
  data => { data.account.connection = { connectorId: "missing-link" }; }, data => { data.diff.headRevision = "old-head"; },
  data => { data.summary.headRevision = "old-head"; }, data => { data.description = null; }, data => { data.metadata.additions = -1; },
  data => { data.diff = { status: "error" }; }]) {
  const data = result(); mutate(data); assert.throws(() => remote.parseRemotePullRequest(data, target.url), /数据不完整/);
}
const empty = result(); empty.diff.unifiedDiff = "";
assert.equal(remote.parseRemotePullRequest(empty, target.url).diff.unifiedDiff, "", "only successful empty diff is empty");
const nativeFixtureIndex = process.argv.indexOf("--native-fixture");
if (nativeFixtureIndex >= 0) {
  const native = JSON.parse(fs.readFileSync(process.argv[nativeFixtureIndex + 1], "utf8"));
  assert.equal(remote.parseRemotePullRequest(native, native.pullRequest.url).diff.headRevision, native.metadata.headRevision);
  console.log("PASS actual Rust service fixture output is accepted by the production TypeScript parser");
}

function component(file, name, dependencies, initialProps, sourceOverride) {
  let slots = [], cursor = 0, pending = [], props = initialProps, tree;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }), Fragment: "fragment", memo: fn => fn,
    useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo: fn => fn(), useId: () => "fixture-component",
    useEffect: (fn, deps) => { const i = cursor++; const old = slots[i]; if (!old || deps.some((value, index) => value !== old.deps[index]))
      pending.push(() => { old?.stop?.(); slots[i] = { deps, stop: fn() }; }); },
  };
  const exports = {};
  vm.runInNewContext(transpile(sourceOverride ?? fs.readFileSync(file, "utf8")), { exports, AbortController, URL, setTimeout, clearTimeout,
    require: key => key === "react" ? react : key.endsWith(".css") ? {} : dependencies(key, react) });
  const render = next => { if (next) props = { ...props, ...next }; cursor = 0; tree = exports[name](props); return tree; };
  const effects = () => { const queue = pending; pending = []; queue.forEach(fn => fn()); };
  const walk = node => !node || typeof node !== "object" ? [] : [node, ...node.children.flatMap(walk)];
  const content = node => node == null || typeof node === "boolean" ? "" : typeof node === "object" ? node.children.map(content).join(" ") : String(node);
  const nodes = (node = tree) => walk(node);
  const text = (node = tree) => content(node);
  return { render, effects, nodes, text, unmount: () => slots.forEach(slot => slot?.stop?.()),
    start: async () => { render(); effects(); await flush(); render(); effects(); },
    button: name => nodes().find(node => node.type === "button" && text(node).trim() === name) };
}
const identity = { accountId: "a", userId: "u", generation: 1 };
function surface(url = target.url) {
  const events = {}, reads = [], opened = [];
  const control = { read: async () => result(), listen: async (name, handler) => { events[name] = handler; return () => { delete events[name]; }; } };
  let h;
  h = component("src/components/RemoteReviewView.tsx", "RemoteReviewView", key => {
    if (key === "../bridge") return { tauriListen: (...args) => control.listen(...args) };
    if (key === "../remoteReview") return remote;
    if (key === "../chatgptService") return { serviceIdentity: async () => identity,
      readRemotePullRequest: (...args) => { reads.push(args); return control.read(...args); } };
    if (key === "../webLinks") return { openWebLink: async (url, valid) => { if (valid()) opened.push(url); } };
    return { MarkdownView: "MarkdownView", PinnedReviewChanges: "PinnedReviewChanges" };
  }, { url, scope: "account-a", onOpenUrl: next => h.render({ url: next }), onBack() {} });
  return Object.assign(h, { events, reads, control, opened });
}
let h = surface(""); await h.start(); assert.equal(h.reads.length, 0); assert.match(h.text(), /打开 Pull Request 后/); h.unmount();
h = surface(); await h.start(); assert.match(h.text(), /Real PR title/);
assert.equal(h.nodes().find(node => node.type === "MarkdownView").props.remoteContent, true);
assert.equal(h.nodes().find(node => node.type === "PinnedReviewChanges").props.url, target.url);
assert.equal(h.reads[0][1], identity); h.unmount();
h = surface(); const first = deferred(); h.control.read = () => first.promise; await h.start();
const oldSignal = h.reads[0][2]; const second = deferred(); h.control.read = () => second.promise;
h.render({ scope: "account-b" }); assert.doesNotMatch(h.text(), /Real PR title/); h.effects(); await flush();
assert.equal(oldSignal.aborted, true);
const newer = result(); newer.summary.title = "Account B PR"; second.resolve(newer); await flush(); h.render();
first.resolve(result()); await flush(); h.render(); assert.match(h.text(), /Account B PR/); assert.doesNotMatch(h.text(), /Real PR title/);
const identityRead = deferred(); h.control.read = () => identityRead.promise;
h.events["app-server:notification"]({ method: "account/updated" }); h.render(); assert.doesNotMatch(h.text(), /Account B PR/);
h.unmount(); identityRead.resolve(result()); await flush(); h.render(); assert.doesNotMatch(h.text(), /Real PR title/);
h = surface(); h.control.read = async () => { throw Error("repository SSO unavailable"); }; await h.start();
assert.match(h.text(), /repository SSO unavailable/); assert.equal(h.nodes().some(node => node.type === "pre"), false);
assert.doesNotMatch(h.text(), /没有差异/);
h.control.read = async () => empty; h.button("重新读取").props.onClick(); h.render(); h.effects(); await flush(); h.render();
assert.ok(h.nodes().some(node => node.type === "PinnedReviewChanges")); h.unmount();
h = surface(); const late = deferred(); h.control.listen = () => late.promise; h.render(); h.effects(); h.unmount();
let lateStops = 0; late.resolve(() => lateStops++); await flush(); assert.equal(lateStops, 3); assert.equal(h.reads.length, 0);

const sha = letter => letter.repeat(40);
const pinned = () => ({ pullRequest: { ...target }, account: result().account, metadata: { ...result().metadata, headRevision: sha("b") },
  snapshotId: "snapshot-1", snapshot: { baseRevision: sha("a"), headRevision: sha("b"), mergeBaseRevision: sha("c"), commits: [
    { sha: sha("b"), parentSha: sha("d"), title: "Current commit" }, { sha: sha("d"), parentSha: null, title: "Root commit" }] },
  comparison: { baseRevision: sha("c"), headRevision: sha("b") }, diff: { headRevision: sha("b"), unifiedDiff: "fixed comparison" } });
assert.equal(remote.parsePinnedReviewComparison(pinned(), target.url, null, null).comparison.baseRevision, sha("c"));
for (const mutate of [data => { data.snapshotId = ""; }, data => { data.snapshot.commits = {}; },
  data => { data.snapshot.mergeBaseRevision = "invalid"; }, data => { data.comparison.baseRevision = sha("a"); },
  data => { data.diff.headRevision = sha("e"); }, data => { data.metadata.headRevision = sha("e"); },
  data => { data.account.hostname = "other.test"; }, data => { data.snapshot.commits.push(data.snapshot.commits[0]); }]) {
  const data = pinned(); mutate(data); assert.throws(() => remote.parsePinnedReviewComparison(data, target.url, null, null));
}
assert.throws(() => remote.parsePinnedReviewComparison(pinned(), target.url, "old-snapshot", null));
assert.throws(() => remote.parsePinnedReviewComparison(pinned(), target.url, "snapshot-1", sha("d")), /固定提交/);
const file = { ...pinned(), file: { status: "unavailable" } };
assert.equal(remote.parsePinnedReviewFile(file, target.url, "snapshot-1", null).file.status, "unavailable");
assert.throws(() => remote.parsePinnedReviewFile({ ...file, file: { status: "success", headContent: "" } }, target.url, "snapshot-1", null));
const pinnedFixtureIndex = process.argv.indexOf("--pinned-fixtures");
if (pinnedFixtureIndex >= 0) {
  const directory = process.argv[pinnedFixtureIndex + 1];
  const actual = JSON.parse(fs.readFileSync(`${directory}/comparison-readback.json`, "utf8"));
  remote.parsePinnedReviewComparison(actual, actual.pullRequest.url, null, null);
  const actualFile = JSON.parse(fs.readFileSync(`${directory}/file-readback.json`, "utf8"));
  remote.parsePinnedReviewFile(actualFile, actualFile.pullRequest.url, actual.snapshotId, null);
  console.log("PASS actual Rust pinned comparison and file outputs cross production TypeScript boundary");
}
function pinnedSurface() {
  const reads = [], control = { read: async () => pinned() };
  const source = process.argv.includes("--network-invalidation-baseline")
    ? fs.readFileSync("src/components/PinnedReviewChanges.tsx", "utf8").replace(".test(code)", ".test(String(cause))") : undefined;
  const view = component("src/components/PinnedReviewChanges.tsx", "PinnedReviewChanges", key => {
    if (key === "./PrivateReviewPanel") return { PrivateReviewPanel: "PrivateReviewPanel" };
    if (key === "./RemoteRevisionFiles") return { RemoteRevisionFiles: props => props.value.diff.unifiedDiff };
    assert.equal(key, "../chatgptService"); return { serviceIdentity: async () => identity,
      readPinnedReviewComparison: (...args) => { reads.push(args); return control.read(...args); } };
  }, { url: target.url, scope: "account-a" }, source);
  return Object.assign(view, { reads, control });
}
h = pinnedSurface(); await h.start(); assert.match(h.text(), /fixed comparison/);
assert.equal(h.nodes().find(node => node.type === "option" && node.props.value === sha("d")).props.disabled, true);
assert.equal(h.reads[0][3], null, "initial reads acquire a fresh host snapshot");
h.control.read = async () => { throw "network_error: temporary connection failure"; };
h.button("刷新").props.onClick(); await flush(); h.render(); assert.match(h.text(), /fixed comparison/); assert.match(h.text(), /temporary connection failure/);
h.control.read = async (...args) => { const next = pinned(); next.comparison.baseRevision = sha("d"); next.diff.unifiedDiff = "single commit"; return next; };
h.nodes().find(node => node.type === "select").props.onChange({ target: { value: sha("b") } }); await flush(); h.render();
assert.equal(h.reads.at(-1)[3], "snapshot-1"); assert.equal(h.reads.at(-1)[4], sha("b")); assert.match(h.text(), /single commit/);
assert.equal(h.nodes().find(node => node.type === "select").props.value, sha("b"));
const refreshed = pinned(); refreshed.snapshotId = "snapshot-2"; refreshed.diff.unifiedDiff = "new snapshot";
h.control.read = async () => refreshed; h.button("刷新").props.onClick(); await flush(); h.render();
assert.equal(h.nodes().find(node => node.type === "select").props.value, ""); assert.match(h.text(), /new snapshot/);
h.control.read = async () => { throw "github_account_unavailable: selected account changed"; };
h.button("刷新").props.onClick(); await flush(); h.render(); assert.doesNotMatch(h.text(), /new snapshot/); h.unmount();
let providerErrors = ["unauthorized: ChatGPT authentication rejected", "forbidden: ChatGPT service access denied"];
if (pinnedFixtureIndex >= 0 && fs.existsSync(`${process.argv[pinnedFixtureIndex + 1]}/provider-error-readback.json`))
  providerErrors = JSON.parse(fs.readFileSync(`${process.argv[pinnedFixtureIndex + 1]}/provider-error-readback.json`, "utf8")).map(item => item.error);
assert.ok(providerErrors.some(message => message.startsWith("unauthorized:")) && providerErrors.some(message => message.startsWith("forbidden:")));
for (const denied of [...providerErrors.filter(message => /^(unauthorized|forbidden):/.test(message)), "此 Pull Request 与当前选择的 GitHub 实例不符。", "GitHub 连接数据无效。"]) {
  h = pinnedSurface(); await h.start(); assert.match(h.text(), /fixed comparison/);
  h.control.read = async () => { throw process.argv.includes("--provider-error-baseline") ? denied.replace(/^[^:]+: /, "") : denied; };
  h.button("刷新").props.onClick(); await flush(); h.render();
  assert.doesNotMatch(h.text(), /fixed comparison/, "bootstrap access denial must clear the old comparison"); h.unmount();
}
for (const message of providerErrors.filter(message => message.startsWith("network_error:"))) {
  h = pinnedSurface(); await h.start(); h.control.read = async () => { throw message; };
  h.button("刷新").props.onClick(); await flush(); h.render(); assert.match(h.text(), /fixed comparison/); h.unmount();
}
h = pinnedSurface(); const pendingComparison = deferred(); h.control.read = () => pendingComparison.promise; await h.start();
const pendingSignal = h.reads[0][2]; h.render({ scope: "account-b" }); h.effects(); assert.equal(pendingSignal.aborted, true);
h.unmount(); pendingComparison.resolve(pinned()); await flush(); h.render(); assert.doesNotMatch(h.text(), /fixed comparison/);
console.log("PASS pinned comparison: merge-base/head identity, root disabled, refresh failure keeps snapshot, commit binding and scope/late-response isolation");

// A remote description must not open local paths, run code or load local images, including nested Markdown.
let localActions = 0;
const markdownProps = { content: "[local](file:///C:/secret) ![local](file:///C:/secret.png) **[unsafe](javascript:alert)**\n\n| A |\n| --- |\n| [file](file:///C:/secret) |\n\n```bash\necho untrusted\n```",
  remoteContent: true, onOpenFile: () => localActions++, onRunCommand: () => localActions++ };
h = component("src/components/MarkdownView.tsx", "MarkdownView", () => ({}), markdownProps); await h.start();
assert.equal(h.nodes().some(node => node.type === "img"), false);
assert.equal(h.nodes().some(node => node.type === "a"), false);
assert.equal(h.nodes().some(node => node.type === "button" && /运行/.test(h.text(node))), false);
assert.equal(localActions, 0); h.unmount();
h = component("src/components/MarkdownView.tsx", "MarkdownView", () => ({}), {
  content: "[web](https://github.com/o/r) ![web](https://example.test/image.png)", remoteContent: true }); await h.start();
assert.equal(h.nodes().filter(node => node.type === "a").length, 1); assert.equal(h.nodes().filter(node => node.type === "img").length, 1); h.unmount();
h = component("src/components/MarkdownView.tsx", "MarkdownView", () => ({}), { content: "```bash\necho local\n```", onRunCommand: () => localActions++ }); await h.start();
assert.ok(h.nodes().some(node => node.type === "button" && node.props.onClick?.toString().includes("onRunCommand")), "ordinary local message action remains available"); h.unmount();

// The old PR details dialog must not bypass the unavailable exact-remote-review guard.
const preferences = {};
vm.runInNewContext(transpile(fs.readFileSync("src/reviewPreferences.ts", "utf8")), { exports: preferences,
  require: key => key === "react" ? {} : {} });
let localReviews = 0;
const baseline = process.argv.includes("--legacy-baseline") ? execFileSync("git", ["show", "07d98eb:src/components/CodeReviewView.tsx"], { encoding: "utf8" }) : undefined;
h = component("src/components/CodeReviewView.tsx", "CodeReviewView", key => key === "../reviewPreferences" ? preferences : key === "../bridge" ? {
  tauriInvoke: async command => command === "gh_status" ? { is_installed: true, is_authenticated: true }
    : [{ number: 7, title: "Fixture PR", state: "open", is_draft: false, head_ref_name: "feature", url: target.url }],
} : { MarkdownView: "MarkdownView" }, { workspacePath: "D:/private/repo", onStartReview: () => localReviews++ }, baseline);
await h.start(); h.button("GitHub Pull Requests").props.onClick(); h.render(); h.effects(); await flush(); h.render();
h.button("详情 / 检出").props.onClick(); h.render();
const reviewButtons = h.nodes().filter(node => node.type === "button" && /私人 PR 审查|深度审查/.test(h.text(node)));
assert.ok(reviewButtons.length >= 2); reviewButtons.at(-1).props.onClick(); await flush(); h.render();
assert.equal(localReviews, 0, "PR dialog cannot turn a remote PR into a local branch review");
assert.match(h.text(), /固定远程提交比较/); h.unmount();

// Exercise the actual rail action and App action rather than just checking that a route string exists.
let navigated;
h = component("src/components/NavigationRail.tsx", "NavigationRail", () => ({}), {
  activeRoute: "home", sidebarCollapsed: false, unreadInboxCount: 0, appServerConnected: true,
  onNavigate: route => { navigated = route; }, onToggleSidebar() {}, onOpenUsage() {}, onCommand() {},
});
await h.start(); h.nodes().find(node => node.type === "button" && node.props.title === "代码审查").props.onClick();
assert.equal(navigated, "code-review"); h.unmount();
const appSource = fs.readFileSync("src/App.tsx", "utf8");
const appAst = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let openAction;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(appAst) === "openRemotePullRequest") openAction = node.initializer.getText(appAst);
  ts.forEachChild(node, visit);
}
visit(appAst); assert.ok(openAction);
let openedUrl, openedRoute;
const actionExports = {};
vm.runInNewContext(transpile(`export const open = ${openAction};`), { exports: actionExports,
  parseRemotePullRequestUrl: remote.parseRemotePullRequestUrl,
  setRemotePullRequestUrl: url => { openedUrl = url; }, setActiveRoute: route => { openedRoute = route; } });
actionExports.open("https://github.com/Owner/Repo/pull/7#comment");
assert.equal(openedUrl, target.url); assert.equal(openedRoute, "code-review");
assert.throws(() => actionExports.open("https://github.com/o/r/issues/8")); assert.equal(openedUrl, target.url);
console.log("PASS remote PR surface: URL and account/head validation, loading/failure/retry, scope/cancellation/listener cleanup, remote Markdown isolation and legacy PR dialog guard");

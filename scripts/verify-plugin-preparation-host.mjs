import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
} }).outputText;
const plain = value => JSON.parse(JSON.stringify(value));
const plugins = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync("src/plugins.ts", "utf8")), {
  exports: plugins.exports, require: () => ({ callAppServer() { throw Error("Unmocked protocol write"); } }),
});
const flows = { exports: {} };
const directory = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync("src/pluginDirectory.ts", "utf8")), { exports: directory.exports, require: () => ({}) });
vm.runInNewContext(compile(fs.readFileSync("src/pluginPreparationFlow.ts", "utf8")), { exports: flows.exports, require: name => name === "./pluginDirectory" ? directory.exports : plugins.exports });
const ast = ts.createSourceFile("SkillsMcpView.tsx", fs.readFileSync("src/components/SkillsMcpView.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const expressions = new Map(); let verification, retirementEffect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("preparationFlows.current.forEach") &&
      node.arguments[0]?.getText(ast).includes("flow.detailRequest")) retirementEffect = node.arguments[0];
  if (ts.isVariableDeclaration(node) && ["handleInstallPlugin", "activateDirectoryPrompt"].includes(node.name.getText(ast))) expressions.set(node.name.getText(ast), node.initializer);
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "PluginPreparationPanel") {
    verification = node.attributes.properties.find(property => property.name?.getText(ast) === "onVerify")?.initializer.expression;
  }
  ts.forEachChild(node, visit);
}
visit(ast); assert.ok(verification, "the actual preparation panel must consume the final verification flow");
const identity = { accountId: "original-account", userId: "original-user", generation: 3 };
const plugin = { id: "sample@original", name: "sample", installed: false, enabled: true,
  source: { type: "local", path: "D:/original/sample" }, authPolicy: "ON_INSTALL", installPolicy: "AVAILABLE", availability: "AVAILABLE",
  interface: { defaultPrompt: ["original prompt"] } };
const marketplace = { name: "original", path: "D:/original", plugins: [plugin] };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function mount({ policy = "ON_INSTALL", capture = async () => identity, confirmed = true, subject = plugin,
  apps = [{ id: "ack-app", name: "App" }], installedSource = subject.source } = {}) {
  const calls = []; let preparations = {};
  const context = {
    ...plugins.exports, ...flows.exports,
    pluginActionRef: { current: new Set() }, pluginContextRef: { current: 5 }, detailRequestRef: { current: 2 },
    pluginMountedRef: { current: true }, preparationViewRef: { current: { tab: "plugins", detail: plugin.id } },
    preparationReads: { current: new Set() }, preparationFlows: { current: new Map() }, preparationAttemptRef: { current: 0 },
    installUncertaintyRef: { current: new Map() }, installScope: "original-scope", pluginMode: "browse", installedData: null,
    activeWorkspaceRoot: "D:/workspace", connectionIdentity: "account+service", manageOnly: false, managementHostId: "local",
    unsupportedDirectoryHost: () => false,
    isPluginContextCurrent: value => context.pluginMountedRef.current && context.pluginContextRef.current === value,
    setBusyPluginIds() {}, resetBrowseCache() {}, loadBrowsePlugins: async () => {}, loadRemoteSkills: async () => null,
    updateInstallUncertainty: (_scope, _id, pending) => calls.push(["uncertain", pending]),
    notify: (...args) => calls.push(["notice", ...args]),
    setPluginPreparations: update => { preparations = update(preparations); },
    serviceIdentity: capture,
    installPlugin: async reference => { calls.push(["install", reference]); return { authPolicy: policy, appsNeedingAuth: apps }; },
    loadInstalledPlugins: async () => confirmed ? { marketplaces: [{ ...marketplace, plugins: [{ ...subject, installed: true, source: installedSource }] }] } : { marketplaces: [] },
    detail: { summary: subject }, detailLoading: false, detailError: null,
    detailContextRef: { current: { plugin: subject, marketplace } },
    directoryInstalled: [],
    handleTogglePlugin: async value => ({ ...value, enabled: true }),
    onTryPlugin: async (_plugin, text, guard) => { calls.push(["draft", text, guard]); return true; },
    readPluginConnectionFinal: async (options, original) => { calls.push(["final", plain(options), original]); return { kind: "ready" }; },
    AbortController, console,
  };
  const callback = name => vm.runInNewContext(compile(`(${expressions.get(name).getText(ast)})`), context);
  context.handleInstallPlugin = callback("handleInstallPlugin");
  const activate = callback("activateDirectoryPrompt");
  return { context, calls, activate, preparation: () => preparations[subject.id],
    commitPreparationRetirement: () => {
      if (retirementEffect) vm.runInNewContext(compile(`(${retirementEffect.getText(ast)})`), context)();
    },
    install: text => context.handleInstallPlugin(subject, marketplace, text),
    verify: () => {
      context.id = subject.id; context.preparation = preparations[subject.id];
      return vm.runInNewContext(compile(`(${verification.getText(ast)})`), context)();
    } };
}
{
  const view = mount();
  await assert.rejects(view.activate("original prompt"), /安装或应用连接尚未确认/);
  const preparation = view.preparation();
  assert.equal(preparation.flow.prompt, "original prompt");
  assert.equal(preparation.flow.identity, identity);
  assert.equal(preparation.flow.requestId, view.calls.find(call => call[0] === "install")[1].installAttemptId);
  await view.verify();
  assert.equal(view.calls.find(call => call[0] === "final")[2], identity);
  assert.deepEqual(view.calls.find(call => call[0] === "final")[1], { requiresAppSetup: true, requestedConnectorId: "ack-app" });
  assert.equal(view.calls.filter(call => call[0] === "draft").length, 1);
  assert.equal(preparation.flow.consumed, true);
  await view.verify(); assert.equal(view.calls.filter(call => call[0] === "draft").length, 1);
}
{
  const view = mount({ policy: "ON_USE" }); await view.activate("original prompt");
  assert.equal(view.calls.some(call => call[0] === "final"), false, "ordinary ON_USE preserves its immediate draft path");
  assert.equal(view.calls.filter(call => call[0] === "draft").length, 1);
  assert.equal(view.preparation().flow.consumed, true, "checking after the fast path cannot re-dispatch its original prompt");
}
for (const change of [context => context.pluginContextRef.current++, context => context.detailRequestRef.current++,
  context => { context.preparationViewRef.current = { tab: "plugins", detail: plugin.id }; }]) {
  const view = mount(); await view.install("original prompt"); change(view.context);
  await assert.rejects(view.verify(), /请求已失效/);
  assert.equal(view.calls.some(call => call[0] === "final" || call[0] === "draft"), false);
}
{
  const read = deferred(), view = mount({ capture: () => read.promise });
  const pending = view.install("original prompt"); view.context.pluginContextRef.current++; read.resolve(identity); await pending;
  assert.equal(view.calls.some(call => call[0] === "install" || call[0] === "uncertain"), false,
    "leaving during identity capture must neither install nor record an unknown write");
}
{
  const view = mount({ capture: async () => { throw Error("service identity unavailable"); } });
  await view.install("original prompt");
  assert.equal(view.calls.filter(call => call[0] === "install").length, 1, "local/API installation remains possible");
  assert.equal(view.preparation().flow.identity, null);
  await assert.rejects(view.verify(), /原账号/);
  assert.equal(view.calls.some(call => call[0] === "final" || call[0] === "draft"), false);
}
{
  const view = mount({ confirmed: false }); await view.install("original prompt");
  await assert.rejects(view.verify(), /安装结果尚未确认/);
  assert.equal(view.calls.some(call => call[0] === "final" || call[0] === "draft"), false);
}
for (const apps of [[], [{ id: "ack-app", name: "App" }]]) {
  const browser = { ...plugin, name: "browser", id: "browser@original" };
  const view = mount({ subject: browser, apps });
  await assert.rejects(view.activate("original prompt"), /安装或应用连接尚未确认/);
  assert.equal(view.preparation().flow.browserPreparationRequired, true);
  await assert.rejects(view.verify(), /浏览器扩展准备/);
  assert.equal(view.calls.some(call => call[0] === "draft" || call[0] === "final"), false);
}
{
  const view = mount({ subject: { ...plugin, name: "chrome", id: "chrome@original", authPolicy: "ON_USE" }, policy: "ON_USE", apps: [] });
  await view.activate("original prompt");
  assert.equal(view.calls.filter(call => call[0] === "draft").length, 1, "browser name alone never changes ordinary ON_USE behavior");
}
{
  const browser = { ...plugin, name: "browser", id: "browser@original", source: { type: "git", url: "https://example.test/repo" } };
  const view = mount({ subject: browser, installedSource: { type: "local", path: "D:/installed/browser" }, apps: [] });
  await assert.rejects(view.activate("original prompt"), /安装或应用连接尚未确认/);
  assert.equal(view.preparation().flow.browserPreparationRequired, true, "directory source must not replace the fresh installed local source");
  assert.equal(view.calls.some(call => call[0] === "draft"), false);
}
{
  const browser = { ...plugin, name: "browser", id: "browser@original" };
  const view = mount({ subject: browser, installedSource: { type: "git", url: "https://example.test/repo" }, apps: [] });
  await view.activate("original prompt");
  assert.equal(view.preparation().flow.browserPreparationRequired, false, "fresh nonlocal installation does not enter the local extension probe branch");
  assert.equal(view.calls.filter(call => call[0] === "draft").length, 1);
}
const lifecycleFailures = [];
async function lifecycleCase(name, run) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { lifecycleFailures.push(name); console.error(`FAIL ${name}: ${error.stack}`); }
}
await lifecycleCase("fast-path rejected handoff retires its actual guard and can retry", async () => {
  const subject = { ...plugin, installed: true, authPolicy: "ON_USE" };
  const view = mount({ subject, policy: "ON_USE", apps: [] });
  let accepted = false, guard, attempts = 0;
  view.context.onTryPlugin = async (_plugin, prompt, origin) => {
    attempts++; guard = origin;
    assert.equal(prompt, "original prompt");
    assert.ok(origin, "the actual fast-path host call must carry an origin guard");
    assert.equal(origin.isCurrent(), true, "the handoff token is live while the host decides");
    return accepted;
  };
  assert.equal(await view.activate("original prompt"), false);
  assert.equal(guard.isCurrent(), false, "false must invalidate any deferred host continuation immediately");
  view.context.detailRequestRef.current++;
  assert.equal(guard.isCurrent(), false, "changing detail cannot revive the rejected continuation");
  accepted = true;
  assert.equal(await view.activate("original prompt"), true);
  assert.equal(attempts, 2, "a new explicit use can retry the retained original prompt");
  assert.equal(guard.isCurrent(), false, "settled accepted token is retired too");
});
await lifecycleCase("fast-path success permits the expected origin unmount", async () => {
  const subject = { ...plugin, installed: true, authPolicy: "ON_USE" };
  const view = mount({ subject, policy: "ON_USE", apps: [] });
  view.context.onTryPlugin = async (_plugin, _prompt, origin) => {
    assert.ok(origin); assert.equal(origin.isCurrent(), true);
    view.context.pluginMountedRef.current = false;
    return true;
  };
  assert.equal(await view.activate("original prompt"), true);
});
for (const change of ["detail", "tab", "reload"]) await lifecycleCase(`actual commit retires pending required-app signal on ${change}`, async () => {
  const view = mount(), pendingRead = deferred(); let signal;
  await view.install("original prompt");
  view.context.readPluginConnectionFinal = async (_options, _identity, originalSignal) => {
    signal = originalSignal; return pendingRead.promise;
  };
  const pending = view.verify();
  for (let turn = 0; turn < 40 && !signal; turn++) await Promise.resolve();
  assert.ok(signal, "the actual panel path must have reached the pending final read");
  if (change === "tab") view.context.preparationViewRef.current = { tab: "skills", detail: plugin.id };
  else {
    view.context.detailRequestRef.current++;
    if (change === "detail") view.context.preparationViewRef.current = { tab: "plugins", detail: null };
  }
  view.commitPreparationRetirement();
  const abortedAtCommit = signal.aborted;
  pendingRead.resolve({ kind: "ready" });
  await assert.rejects(pending, /请求已失效/);
  assert.equal(abortedAtCommit, true, "retiring local detail/tab must abort the real signal before a backend retry");
  assert.equal(view.calls.some(call => call[0] === "draft"), false);
});
await lifecycleCase("manual accepted handoff survives normal commit retirement", async () => {
  const view = mount(); await view.install("original prompt");
  view.context.onTryPlugin = async (_plugin, _prompt, origin) => {
    assert.equal(origin.isCurrent(), true);
    view.context.pluginMountedRef.current = false;
    view.context.preparationViewRef.current = { tab: "home", detail: null };
    view.commitPreparationRetirement();
    return true;
  };
  await view.verify(); assert.equal(view.preparation().flow.consumed, true);
});
assert.deepEqual(lifecycleFailures, [], "actual host lifecycle regressions must pass");
console.log("PASS actual install/prompt/panel wiring: ACK required-app identity, exact original attempt/prompt, ON_USE fast path, confirmed inventory, unavailable identity, context/detail/ABA cancellation and one draft without turn writes");

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Reuse the existing real install/prompt/panel harness without running its cases.
const harnessSource = fs.readFileSync('scripts/verify-plugin-preparation-host.mjs', 'utf8');
const harnessAst = ts.createSourceFile('host.mjs', harnessSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = [];
for (const statement of harnessAst.statements) {
  if (ts.isBlock(statement)) break;
  if (!ts.isImportDeclaration(statement)) declarations.push(statement.getFullText(harnessAst));
}
const harness = vm.runInNewContext(`(() => { ${declarations.join('\n')} return { mount, compile, ast, plugin, deferred }; })()`,
  { assert, fs, vm, ts, AbortController, console });
let toggle, refreshEffect, closeDetail;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(harness.ast) === 'handleToggleDetail') toggle = node.initializer;
  if (ts.isVariableDeclaration(node) && node.name.getText(harness.ast) === 'closeManagedDetail') closeDetail = node.initializer;
  if (ts.isCallExpression(node) && node.expression.getText(harness.ast) === 'useEffect' &&
      node.arguments[0]?.getText(harness.ast).includes('window.addEventListener("focus", refresh)')) refreshEffect = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(harness.ast); assert.ok(toggle); assert.ok(refreshEffect); assert.ok(closeDetail);
function integration() {
  const host = harness.mount(), read = harness.deferred(), urls = [];
  let focus;
  Object.assign(host.context, {
    detailKey: 'original-detail', pluginKey: () => 'original-detail',
    setDetailKey() {}, setDetail() {}, setDetailError() {}, setDetailLoading() {},
    readPlugin: () => read.promise,
    directoryPluginInstallation: () => ({ plugin: harness.plugin }), pluginDetailMatchesReference: () => true,
    loadServicePlugins: async () => {}, loadManagement: async () => {}, loadApps: async () => {},
    window: { addEventListener(name, callback) { if (name === 'focus') focus = callback; }, removeEventListener() {} },
    tauriListen: async () => () => {}, onNavigationGuardChange: undefined,
    updateDirectoryUrl: (...args) => urls.push(args), managementBase: () => '/settings/plugins-settings',
    pluginManagementRootUrl: () => '/settings/plugins-settings',
  });
  const callback = node => vm.runInNewContext(harness.compile(`(${node.getText(harness.ast)})`), host.context);
  host.context.handleToggleDetail = callback(toggle);
  const cleanup = callback(refreshEffect)();
  return { host, read, urls, focus: () => focus(), close: callback(closeDetail), cleanup,
    resolveDetail: () => read.resolve({ summary: harness.plugin, marketplaceName: 'original', marketplacePath: 'D:/original' }) };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

{
  const test = integration(), ack = harness.deferred();
  const originalInstall = test.host.context.installPlugin;
  test.host.context.installPlugin = async (...args) => {
    const result = await originalInstall(...args); // Keep the real harness write record and ACK data.
    await ack.promise;
    return result;
  };
  const installing = test.host.install('original prompt');
  for (let i = 0; i < 40 && !test.host.calls.some(call => call[0] === 'install'); i++) await Promise.resolve();
  assert.equal(test.host.calls.filter(call => call[0] === 'install').length, 1);
  assert.equal(test.host.context.preparationFlows.current.size, 0, 'the ACK has not yet created a preparation flow');
  assert.equal(test.host.context.pluginActionRef.current.has(harness.plugin.id), true, 'the original install is still in flight');
  test.focus(); test.host.commitPreparationRetirement();
  ack.resolve(); await installing;
  test.resolveDetail(); await flush(); test.host.commitPreparationRetirement();
  const flow = test.host.preparation().flow;
  assert.equal(flow.controller.signal.aborted, false,
    'passive focus before the installation ACK must not retire the flow created by that original ACK');
  assert.equal(flow.requestId, test.host.calls.find(call => call[0] === 'install')[1].installAttemptId);
  assert.equal(flow.prompt, 'original prompt');
  await test.host.verify(); await test.host.verify();
  assert.equal(test.host.calls.filter(call => call[0] === 'install').length, 1);
  assert.equal(test.host.calls.filter(call => call[0] === 'final').length, 1);
  assert.equal(test.host.calls.filter(call => call[0] === 'draft').length, 1);
  assert.equal(test.host.calls.find(call => call[0] === 'draft')[1], 'original prompt');
  assert.equal(flow.consumed, true); assert.equal(test.urls.length, 0);
  test.cleanup();
}

{
  const test = integration(); await test.host.install('original prompt');
  const flow = test.host.preparation().flow, originalRequest = flow.requestId;
  test.focus(); test.host.commitPreparationRetirement();
  test.resolveDetail(); await flush(); test.host.commitPreparationRetirement();
  assert.equal(flow.controller.signal.aborted, false,
    'returning from the provider to the same detail must preserve the original preparation intent');
  assert.equal(flow.requestId, originalRequest); assert.equal(flow.prompt, 'original prompt');
  assert.equal(test.urls.length, 0, 'a passive return read must not navigate');
  await test.host.verify(); await test.host.verify();
  assert.equal(test.host.calls.filter(call => call[0] === 'install').length, 1);
  assert.equal(test.host.calls.filter(call => call[0] === 'final').length, 1);
  const drafts = test.host.calls.filter(call => call[0] === 'draft');
  assert.equal(drafts.length, 1); assert.equal(drafts[0][1], 'original prompt');
  assert.equal(flow.consumed, true);
  test.cleanup();
}
for (const action of ['manual reload', 'close detail', 'change tab', 'change detail']) {
  const test = integration(); await test.host.install('original prompt'); const flow = test.host.preparation().flow;
  let pending;
  if (action === 'manual reload') pending = test.host.context.handleToggleDetail(harness.plugin,
    test.host.context.detailContextRef.current.marketplace, { reload: true });
  else if (action === 'close detail') test.close(true);
  else if (action === 'change tab') test.host.context.preparationViewRef.current = { tab: 'skills', detail: harness.plugin.id };
  else test.host.context.detailRequestRef.current++;
  test.host.commitPreparationRetirement();
  assert.equal(flow.controller.signal.aborted, true, `${action} remains a real cancellation boundary`);
  await assert.rejects(test.host.verify(), /请求已失效/);
  assert.equal(test.host.calls.some(call => call[0] === 'final' || call[0] === 'draft'), false);
  test.resolveDetail(); if (pending) await pending; await flush(); test.cleanup();
}
console.log('PASS actual focus refresh/install/detail retirement/panel callbacks: passive same-source return before/after installation ACK preserves one original draft; manual reload/close/tab/detail cancel; one install, final reads only, no turn/model/HTTP calls.');

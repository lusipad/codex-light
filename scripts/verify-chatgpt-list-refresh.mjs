import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const ast = ts.createSourceFile('App.tsx', fs.readFileSync('src/App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const effects = [];
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') effects.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);
const visibility = effects.find(node => node.arguments[0]?.getText(ast).includes('const onVisible'));
const updated = effects.find(node => node.arguments[0]?.getText(ast).includes('chatListUpdatedAt.current ='));
assert.ok(visibility && updated, 'actual source refresh and successful-data clock effects exist');
const evaluate = (node, context) => vm.runInNewContext(ts.transpileModule(`(${node.getText(ast)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText, context)();

function fixture({ age = 300_000, accessAge = 60_000, hidden = false, loading = false, loaded = true, retired = false } = {}) {
  const listeners = new Map(), calls = [], now = 1_000_000;
  const context = {
    Date: { now: () => now }, document: { visibilityState: hidden ? 'hidden' : 'visible' },
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => {
      assert.equal(listeners.get(name), fn); listeners.delete(name);
    } },
    chatListScope: 'owner-host', chatListScopeRef: { current: retired ? 'retired' : 'owner-host' },
    currentChatListAccess: { loading, checkedAt: now - accessAge },
    chatServerList: { loaded, refresh: () => { calls.push('refresh'); return Promise.resolve(true); } },
    chatListUpdatedAt: { current: { scope: 'owner-host', time: now - age } },
    setChatListAccessRetry: updater => { assert.equal(updater(4), 5); calls.push('access'); },
  };
  const cleanup = evaluate(visibility.arguments[0], context);
  return { context, calls, listeners, cleanup, visible: () => listeners.get('visibilitychange')() };
}
for (const options of [{ hidden: true }, { retired: true }, { age: 299_999, accessAge: 59_999 }]) {
  const f = fixture(options); f.visible(); assert.deepEqual(f.calls, []); f.cleanup(); assert.equal(f.listeners.size, 0);
}
{
  const f = fixture(); f.visible(); assert.deepEqual(f.calls, ['access', 'refresh']); f.cleanup();
  assert.equal(f.listeners.size, 0);
}
{
  const f = fixture({ age: 299_999 }); f.visible(); assert.deepEqual(f.calls, ['access']); f.cleanup();
  const g = fixture({ accessAge: 59_999 }); g.visible(); assert.deepEqual(g.calls, ['refresh']); g.cleanup();
  const loading = fixture({ loading: true }); loading.visible(); assert.deepEqual(loading.calls, ['refresh']); loading.cleanup();
  const initial = fixture({ loaded: false }); initial.visible(); assert.deepEqual(initial.calls, ['access']); initial.cleanup();
}
{
  const f = fixture(); evaluate(updated.arguments[0], f.context);
  assert.equal(f.context.chatListUpdatedAt.current.time, 1_000_000);
  assert.equal(f.context.chatListUpdatedAt.current.scope, 'owner-host');
  f.context.chatServerList.loaded = false; f.context.chatListUpdatedAt.current = null;
  evaluate(updated.arguments[0], f.context); assert.equal(f.context.chatListUpdatedAt.current, null); f.cleanup();
  const dependencies = updated.arguments[1].getText(ast);
  assert.ok(dependencies.includes('chatServerList.pages') && dependencies.includes('chatServerList.loaded'));
  assert.equal(dependencies.includes('chatServerList.error'), false, 'failed refresh cannot reset the successful-data age');
}
console.log('PASS 4 actual App visibility refresh groups: source event, separate 1m/5m stale clocks, hidden/scope/loading fences, successful data age and listener cleanup; no timers, HTTP or model');

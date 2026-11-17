import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { mount } from './verify-sidebar-projects.mjs';

const ast = ts.createSourceFile('App.tsx', fs.readFileSync('src/App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = []; const visit = node => { nodes.push(node); ts.forEachChild(node, visit); }; visit(ast);
const variable = name => nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name)?.initializer;
const compile = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const evaluate = (node, context) => { assert.ok(node, 'actual App expression exists'); return vm.runInNewContext(compile(`(${node.getText(ast)})`), context); };
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
function pure(name) {
  const exports = {};
  vm.runInNewContext(compile(fs.readFileSync(`src/${name}.ts`, 'utf8')), { exports, URL, require: dependency => {
    assert.equal(dependency, './chatgptConversationHistory'); return pure('chatgptConversationHistory');
  } }); return exports;
}
const routes = pure('chatgptRoutes'), merge = pure('chatgptSidebarConversations');
const sidebar = nodes.find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'CodexSidebar');
function sidebarProp(name, context) {
  const prop = sidebar.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(ast) === name);
  return evaluate(prop?.initializer?.expression, context);
}
const identity = { userId: 'user-A', accountId: 'account-A', generation: 4 };
function fixture() {
  const calls = [], access = deferred(), paths = [];
  const location = { href: 'https://app.test/', pathname: '/', search: '' };
  const context = { ...routes, ...merge, AbortController, Date, JSON,
    modelAccountIdentity: 'owner-A', workHostIdentity: 'host-A', shareAccessRevision: 1,
    committedWorkOwner: { current: 'owner-A' }, committedWorkHost: { current: 'host-A' },
    appServerStatus: { connected: true }, isQuickChatWindow: false, isThreadWindow: false,
    chatListAccess: null, chatListAccessRetry: 0,
    chatListScopeRef: { current: null }, chatSidebarRowsRef: { current: null },
    chatListAccessRef: { current: null }, chatConversationIdentityRef: { current: null },
    chatEntry: { owner: 'owner-A', identity }, workHomeSession: null,
    chatServerList: { loaded: false, loading: null, error: null, nextOffset: null, items: [],
      retry: () => calls.push(['retry']), loadMore: () => calls.push(['more']) },
    chatConversation: { conversations: [], open: id => { calls.push(['open', id]); return true; },
      reset: () => { calls.push(['reset']); context.chatConversation.conversations = []; } },
    chatDrafts: { 'memory-A': 'keep draft' },
    chatDraftValues: { current: { 'memory-A': 'keep draft' } }, chatDraftRevisions: { current: new Map() },
    chatHistoryRetry: 0, setChatHistoryRetry: update => { context.chatHistoryRetry = update(context.chatHistoryRetry); },
    refreshAccount: () => { calls.push(['refreshAccount']); },
    setChatDrafts: value => { context.chatDrafts = value; },
    navigationRequestRef: { current: 3 }, threadRequestRef: { current: 5 },
    activeThreadIdRef: { current: 'native-A' }, activeRouteRef: { current: 'home' },
    personalizationNavigationGuardRef: { current: null },
    window: { location, history: { state: {}, replaceState: (_state, _title, path) => {
      paths.push(path); const url = new URL(path, 'https://app.test'); Object.assign(location, { href: url.href, pathname: url.pathname, search: url.search });
    } } },
    serviceErrorMessage: error => error.message,
    readChatgptConversationAccess: signal => { calls.push(['access', signal]); return access.promise; },
    setChatListAccess: update => { context.chatListAccess = typeof update === 'function' ? update(context.chatListAccess) : update; },
    setChatListAccessRetry: update => { context.chatListAccessRetry = update(context.chatListAccessRetry); },
    setActiveThreadId: id => calls.push(['activeThread', id]),
    setChatHistoryLocation: url => calls.push(['historyLocation', url]),
    commitActiveRoute: route => calls.push(['route', route]),
  };
  for (const name of ['chatListScope', 'currentChatListAccess', 'chatSidebarConversations', 'chatConversationIdentity']) Object.defineProperty(context, name, {
    get: () => name === 'chatSidebarConversations' ? evaluate(variable(name).arguments[0], context)() : evaluate(variable(name), context),
  });
  context.chatListScopeRef.current = context.chatListScope;
  const accessEffect = nodes.find(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
    && node.arguments[0]?.getText(ast).includes('readChatgptConversationAccess(request.signal)'));
  const rowsEffect = nodes.find(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'useLayoutEffect'
    && node.arguments[0]?.getText(ast).includes('chatSidebarRowsRef.current = current'));
  const principalEffects = ['chatListAccessRef.current = currentChatListAccess', 'chatConversationIdentityRef.current = chatConversationIdentity'].map(text =>
    nodes.find(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'useLayoutEffect' && node.arguments[0]?.getText(ast).includes(text)));
  context.writeChatDraft = evaluate(variable('writeChatDraft').arguments[0], context);
  return { context, calls, paths, access, location,
    start: () => evaluate(accessEffect?.arguments[0], context)(),
    commitRows: () => evaluate(rowsEffect?.arguments[0], context)(),
    options: () => evaluate(variable('chatServerList').arguments[0], context),
    click: id => { for (const effect of principalEffects) evaluate(effect?.arguments[0], context)();
      evaluate(rowsEffect?.arguments[0], context)(); evaluate(variable('openChatgptConversation'), context)(id); },
    props: () => Object.fromEntries(['chatgptConversations', 'chatgptListState', 'onRetryChatgptList', 'onLoadMoreChatgptList']
      .map(name => [name, sidebarProp(name, context)])),
  };
}
const groups = [], test = (name, run) => groups.push([name, run]);
test('actual capability effect and list hook options wait for an enabled identity; ordinary include=false', async () => {
  const f = fixture(), cleanup = f.start();
  assert.equal(f.context.chatListAccess.loading, true); assert.equal(f.options().identity, null);
  assert.equal(f.options().includeProjectConversations, false);
  f.access.resolve({ status: 'enabled', identity }); await flush();
  assert.deepEqual(plain(f.options().identity), identity); assert.equal(f.options().ownerKey, f.context.chatListScope);
  cleanup();
});
test('owner, host, feature revision and cleanup retire an in-flight capability result', async () => {
  for (const change of [f => { f.context.modelAccountIdentity = 'owner-B'; }, f => { f.context.workHostIdentity = 'host-B'; },
    f => { f.context.shareAccessRevision++; }, (_f, cleanup) => cleanup()]) {
    const f = fixture(), cleanup = f.start(); change(f, cleanup); f.context.chatListScopeRef.current = f.context.chatListScope;
    f.access.resolve({ status: 'enabled', identity }); await flush();
    assert.equal(f.options().identity, null); assert.equal(f.context.chatListAccess.access, null); cleanup();
  }
});
test('access error and disabled state never masquerade as a loaded empty list', async () => {
  const f = fixture(), cleanup = f.start(); f.access.reject(Error('permission unavailable')); await flush();
  assert.equal(f.options().identity, null); let props = f.props(); assert.equal(props.chatgptListState.loaded, false);
  assert.equal(props.chatgptListState.error, 'permission unavailable'); props.onRetryChatgptList();
  assert.equal(f.context.chatListAccessRetry, 1); assert.equal(f.calls.some(([kind]) => kind === 'retry'), false);
  f.context.chatListAccess = { scope: f.context.chatListScope, loading: false, access: { status: 'disabled', identity: null }, error: null };
  assert.equal(f.props().chatgptListState, undefined); cleanup();
});
test('disconnected, quick-chat and thread windows perform no capability request or list read', () => {
  for (const change of [f => { f.context.appServerStatus.connected = false; }, f => { f.context.isQuickChatWindow = true; },
    f => { f.context.isThreadWindow = true; }]) {
    const f = fixture(); change(f); f.start();
    assert.deepEqual(f.calls, []); assert.equal(f.options().identity, null); assert.equal(f.props().chatgptListState, undefined);
  }
});
const item = (id = 'server-A', gizmoId = 'g-p-project') => ({ id, gizmoId, title: 'server title', raw: {}, updatedAt: null, preview: null });
test('server-only row reaches its exact project route and cold read location without a memory record', () => {
  const f = fixture(); f.context.chatServerList.items = [item()]; f.click('server-A');
  assert.deepEqual(f.paths, ['/g/g-p-project/c/server-A']); assert.equal(f.calls.some(([kind]) => kind === 'open'), false);
  assert.ok(f.calls.some(([kind, url]) => kind === 'historyLocation' && url === f.location.href));
  assert.equal(f.context.activeThreadIdRef.current, null); assert.equal(f.context.activeRouteRef.current, 'chatgpt-thread');
});
test('listed memory record opens canonical client ID and preserves its draft', () => {
  const f = fixture(); f.context.chatServerList.items = [item()]; f.context.chatConversation.conversations = [{ clientId: 'memory-A', serverId: 'server-A',
    projectId: 'g-p-project', isTemporaryChat: false, title: 'local', messages: [], pending: false }];
  assert.equal(f.context.chatSidebarConversations.length, 1); f.click('server-A');
  assert.ok(f.calls.some(([kind, id]) => kind === 'open' && id === 'memory-A')); assert.equal(f.context.chatDrafts['memory-A'], 'keep draft');
});
test('fresh same-principal generation cannot reopen a retired memory record instead of cold history', () => {
  for (const existingDraft of [undefined, 'new server draft']) {
    const f = fixture(); f.context.chatEntry = { owner: 'owner-A', identity: { ...identity, generation: 7 } };
    f.context.chatListAccess = { scope: f.context.chatListScope, loading: false, error: null,
      access: { status: 'enabled', identity: { ...identity, generation: 8 } } };
    f.context.chatServerList.items = [item('server-X', null)];
    f.context.chatConversation.conversations = [{ clientId: 'memory-A', serverId: 'server-X', projectId: null,
      isTemporaryChat: false, title: 'old principal generation', messages: [], pending: false }];
    if (existingDraft !== undefined) f.context.chatDraftValues.current['server-X'] = existingDraft;
    Object.assign(f.location, { href: 'https://app.test/c/server-X', pathname: '/c/server-X' });
    f.click('server-X');
    assert.equal(f.calls.some(([kind]) => kind === 'open'), false,
      'known-fresh generation8 must not select a cached generation7 consumer; force identity-bound cold history');
    assert.deepEqual(f.paths, ['/c/server-X']); assert.ok(f.calls.some(([kind]) => kind === 'reset'));
    assert.ok(f.calls.some(([kind]) => kind === 'historyLocation')); assert.equal(f.context.chatHistoryRetry, 1, 'same URL still triggers cold-read effect');
    assert.equal(f.context.chatDraftValues.current['server-X'], existingDraft ?? 'keep draft');
    assert.equal(f.context.chatConversation.conversations.length, 0, 'cold effect cannot short-circuit into old memory');
  }
  for (const change of [fresh => { fresh.accountId = 'account-B'; }, fresh => { fresh.userId = 'user-B'; }]) {
    const f = fixture(), fresh = { ...identity, generation: 8 }; change(fresh);
    f.context.chatListAccess = { scope: f.context.chatListScope, loading: false, error: null, access: { status: 'enabled', identity: fresh } };
    f.context.chatServerList.items = [item('server-X', null)];
    f.context.chatConversation.conversations = [{ clientId: 'memory-A', serverId: 'server-X', projectId: null,
      isTemporaryChat: false, title: 'foreign principal', messages: [], pending: false }];
    f.click('server-X'); assert.deepEqual(f.calls, [['refreshAccount']]); assert.deepEqual(f.paths, []);
    assert.equal(f.context.chatDraftValues.current['server-X'], undefined); assert.equal(f.context.chatHistoryRetry, 0);
  }
});
test('declined or retired deferred navigation cannot open, clear native state or change URL', () => {
  for (const change of [f => { f.context.committedWorkOwner.current = 'owner-B'; }, f => { f.context.committedWorkHost.current = 'host-B'; },
    f => { f.context.navigationRequestRef.current++; }, f => { f.location.href += '#later'; },
    f => { f.context.shareAccessRevision++; f.context.chatListScopeRef.current = f.context.chatListScope; }]) {
    const f = fixture(); f.context.chatServerList.items = [item()]; let pending;
    f.context.personalizationNavigationGuardRef.current = action => { pending = action; return false; };
    f.click('server-A'); assert.deepEqual(f.paths, []); assert.deepEqual(f.calls, []);
    change(f); pending(); assert.deepEqual(f.paths, []); assert.deepEqual(f.calls, []); assert.equal(f.context.activeThreadIdRef.current, 'native-A');
  }
});
test('deferred action uses committed latest rows, retires removal and cleanup, and applies once', () => {
  for (const retire of [f => { f.context.chatServerList.items = []; f.commitRows(); }, f => { f.commitRows()(); }]) {
    const f = fixture(); f.context.chatServerList.items = [item()]; let pending;
    f.context.personalizationNavigationGuardRef.current = action => { pending = action; return false; };
    f.click('server-A'); retire(f); pending(); assert.deepEqual(f.calls, []); assert.deepEqual(f.paths, []);
  }
  const f = fixture(); f.context.chatServerList.items = [item()]; let pending;
  f.context.personalizationNavigationGuardRef.current = action => { pending = action; return false; };
  f.click('server-A'); f.context.chatServerList.items = [item('server-A', 'g-p-updated')]; f.commitRows();
  pending(); pending(); assert.deepEqual(f.paths, ['/g/g-p-updated/c/server-A']);
});
const all = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(all)] : [];
const text = node => node && typeof node === 'object' ? node.children.map(text).join('') : typeof node === 'string' ? node : '';
const hasRecentEmpty = tree => all(tree).some(node => node.type === 'div' && node.props.className === 'sidebar-project-empty'
  && node.props.style?.paddingLeft === 12 && text(node) === '暂无聊天');
test('actual Sidebar loading, errors, pagination and true empty state follow real App props', async () => {
  const f = fixture(); let props = f.props(); const view = mount({ threads: [], ...props });
  assert.ok(text(view.render()).includes('正在加载聊天')); assert.equal(hasRecentEmpty(view.render()), false);
  f.context.chatListAccess = { scope: f.context.chatListScope, loading: false, error: null, access: { status: 'enabled', identity } };
  Object.assign(f.context.chatServerList, { loaded: true, nextOffset: 20 }); Object.assign(view.props, f.props());
  let button = all(view.render()).find(node => node.type === 'button' && text(node) === '加载更多聊天'); assert.ok(button); button.props.onClick();
  assert.ok(f.calls.some(([kind]) => kind === 'more')); assert.equal(hasRecentEmpty(view.render()), false);
  f.context.chatServerList.error = 'page failed'; Object.assign(view.props, f.props());
  button = all(view.render()).find(node => node.type === 'button' && text(node) === '重试'); assert.ok(button); button.props.onClick();
  assert.ok(f.calls.some(([kind]) => kind === 'retry')); assert.ok(text(view.render()).includes('page failed'));
  f.context.chatServerList.loading = 'more'; Object.assign(view.props, f.props());
  assert.equal(all(view.render()).find(node => node.type === 'button' && text(node) === '重试').props.disabled, true);
  Object.assign(f.context.chatServerList, { error: null, loading: null, nextOffset: null }); Object.assign(view.props, f.props());
  assert.ok(hasRecentEmpty(view.render())); view.unmount();
});
let failed = 0;
for (const [name, run] of groups) try { await run(); console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}`, error); }
assert.equal(failed, 0, `${failed}/${groups.length} actual Chat list App/Sidebar groups failed`);
console.log(`PASS ${groups.length} actual App/Sidebar Chat list groups; controlled service boundaries, no live account/native/pixel claim`);

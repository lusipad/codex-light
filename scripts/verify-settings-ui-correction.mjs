import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the production settings wrapper; child services remain in their own focused regressions.
const source = fs.readFileSync('src/components/SettingsView.tsx', 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const nodes = node => node && typeof node === 'object' ? [node, ...(node.children ?? []).flatMap(nodes)] : [];
const content = node => typeof node === 'string' ? node : node && typeof node === 'object' ? (node.children ?? []).map(content).join('') : '';
const slugs = ['general-settings', 'notifications', 'import', 'profile', 'appearance', 'account', 'archived-chats', 'voice', 'storage',
  'agent', 'personalization', 'pets', 'keyboard-shortcuts', 'usage', 'plugins-settings', 'computer-use', 'appshots', 'browser-use',
  'hooks-settings', 'connections', 'cloud-settings', 'codex-cloud', 'code-review', 'git-settings', 'local-environments', 'worktrees'];
function mount(section) {
  const hooks = [], effects = [], calls = [], children = new Map(); let cursor = 0, tree;
  const react = { Fragment: 'fragment', createElement: (type, props, ...items) => ({ type, props: props ?? {}, children: items.flat(Infinity) }),
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }]; },
    useRef(value) { return hooks[cursor++] ??= { current: value }; },
    useCallback(fn) { cursor++; return fn; }, useMemo(fn) { cursor++; return fn(); },
    useEffect(fn) { const i = cursor++; if (!(i in hooks)) { hooks[i] = true; effects.push(fn); } },
  };
  const module = { exports: {} };
  const props = { initialSection: section, appServerStatus: { connected: true, binaryPath: 'codex', userAgent: 'test' }, models: [],
    activeWorkspaceRoot: 'D:/isolated', accountIdentity: 'isolated-account', archiveViewProps: {}, appearanceState: {}, notificationState: {},
    keyboardState: {}, gitPreferencesState: {}, codeReviewPreferencesState: {}, petPreferencesState: {}, externalImportsState: {},
    composerEnterBehavior: 'enter', composerEnterSaving: false, composerEnterError: null,
    followUp: { mode: 'steer', saving: false, error: '', onChange: value => calls.push(['follow-up', value]) },
    onSetComposerEnterBehavior: value => calls.push(['enter', value]), onConfigUpdated() {}, onRestartAppServer() {},
    onTogglePetVisible() {}, onRunEnvironmentCommand() {}, onNavigationGuardChange: guard => { props.guard = guard; },
  };
  vm.runInNewContext(code, { exports: module.exports, console, setTimeout: () => 1, clearTimeout() {},
    navigator: { userAgent: 'Windows' }, document: { documentElement: { style: { removeProperty() {}, setProperty() {} } } },
    require(name) {
      if (name === 'react') return react;
      if (name.endsWith('/bridge')) return { isTauriRuntime: () => false, tauriInvoke: async (...args) => { calls.push(args); return null; }, tauriListen: async () => () => {} };
      if (name.endsWith('/config')) return { configRead: async () => { calls.push(['config/read']); return { config: {} }; }, getConfigValue: () => null, setConfigKeys: async () => { calls.push(['config/write']); } };
      return new Proxy({}, { get(_, key) { if (!children.has(key)) children.set(key, Object.defineProperty(() => null, 'name', { value: key })); return children.get(key); } });
    },
  });
  const render = () => { cursor = 0; tree = module.exports.SettingsView(props); return tree; };
  render(); for (const effect of effects.splice(0)) effect(); render();
  return { props, calls, render, all: () => nodes(tree), by: fn => nodes(tree).find(fn), child: name => nodes(tree).find(n => n.type === children.get(name)) };
}
const cases = [], test = (name, fn) => cases.push([name, fn]);
test('Every section delegates persistence without unrelated wrapper reads/writes or global save controls', () => {
  for (const slug of slugs) { const page = mount(slug);
    assert.equal(page.calls.length, 0, `${slug} must not load legacy CLI/theme/preferences from settings wrapper`);
    assert.equal(page.all().some(n => n.type === 'button' && /保存更改|保存当前配置|放弃未保存修改|刷新配置/.test(content(n))), false, slug);
  }
});
test('Appearance is one dedicated instant-save surface', () => {
  const page = mount('appearance'); assert.equal(page.all().filter(n => n.type?.name === 'AppearanceSettings').length, 1);
  assert.equal(page.child('AppearanceSettings').props.state, page.props.appearanceState);
  assert.equal(page.all().some(n => /theme-swatch/.test(n.props.className ?? '')), false);
});
test('General keeps real external-open and Enter consumers without debug/reset cards', () => {
  const page = mount('general-settings'); assert.ok(page.child('GeneralOpenPreferences'));
  const followUp = page.by(n => n.props.id === 'follow-up-mode');
  assert.equal(followUp.props.value, 'steer');
  assert.deepEqual(Array.from(followUp.props.options, option => option.label), ['排队', '引导']);
  followUp.props.onChange('queue');
  assert.deepEqual(page.calls.at(-1), ['follow-up', 'queue']);
  assert.equal(page.child('NotificationSettings')?.props.state, page.props.notificationState, 'local notification group belongs in General');
  assert.equal(mount('notifications').child('NotificationSettings'), undefined, 'account notification route cannot reuse local preferences');
  assert.ok(mount('notifications').child('AccountNotificationSettings'), 'account notification route delegates its own remote settings');
  const remote = mount('notifications');
  assert.equal(remote.child('AccountNotificationSettings').props.connected, true);
  remote.props.appServerStatus = { ...remote.props.appServerStatus, connected: false }; remote.render();
  assert.equal(remote.child('AccountNotificationSettings').props.connected, false, 'pass current connection state without decoding scope');
  assert.doesNotMatch(content(page.render()), /App-Server|恢复出厂|自定义 Codex CLI/);
  const enter = page.by(n => n.props.id === 'composer-enter-behavior');
  assert.equal(enter.type.name, 'GeneralPreferenceSelect');
  enter.props.onChange('cmdAlways'); assert.deepEqual(page.calls, [['follow-up', 'queue'], ['enter', 'cmdAlways']]);
  page.props.composerEnterSaving = true; page.render();
  assert.equal(page.by(n => n.props.id === 'composer-enter-behavior').props.disabled, true);
  page.props.composerEnterError = '写入失败'; page.render(); assert.ok(page.by(n => n.props.role === 'alert' && content(n) === '写入失败'));
});
test('Search has official semantics, scoped find, clear and empty-result feedback', () => {
  const page = mount('general-settings');
  const search = page.by(n => n.props.role === 'searchbox');
  assert.ok(search); assert.equal(search.props.placeholder, '搜索'); assert.equal(search.props.autoFocus, true);
  let focused = 0, selected = 0, prevented = 0;
  search.props.ref.current = { focus() { focused++; }, select() { selected++; } };
  const shell = page.by(n => n.props.className === 'settings-center-shell');
  const event = { key: 'f', ctrlKey: true, nativeEvent: {}, preventDefault() { prevented++; }, stopPropagation() {} };
  shell.props.onKeyDown(event); assert.deepEqual([focused, selected, prevented], [1, 1, 1]);
  shell.props.onKeyDown({ ...event, nativeEvent: { isComposing: true } }); assert.equal(prevented, 1);
  search.props.onChange({ target: { value: '不存在的分区' } }); page.render();
  assert.ok(page.by(n => n.props.role === 'status' && content(n) === '未找到结果'));
  page.by(n => n.props['aria-label'] === '清除设置搜索').props.onClick(); page.render();
  assert.equal(page.by(n => n.props.role === 'searchbox').props.value, ''); assert.equal(focused, 2);
  search.props.onChange({ target: { value: '提示音' } }); page.render();
  assert.deepEqual(page.all().filter(n => n.props['data-settings-panel-slug']).map(n => n.props['data-settings-panel-slug']), ['general-settings'], 'local sound search leads to its actual General group');
});
test('Navigation uses current official Chinese and preserves all routes plus aliases', () => {
  const page = mount('appearance');
  const groupTitles = page.all().filter(n => n.props.className === 'settings-nav-group-title').map(content);
  assert.deepEqual(groupTitles, ['个人', '集成', '编码']);
  for (const label of ['常规', '通知', '导入', '外观', '个性化', '虚拟宠物', '语音', 'Git', '环境', '连接', '云端偏好设置', 'Codex 云端']) {
    assert.ok(page.by(n => n.type === 'button' && content(n) === label), label);
  }
  assert.equal(page.all().filter(n => /settings-nav-item/.test(n.props.className ?? '')).length, slugs.length);
  const search = page.by(n => n.type === 'input'); search.props.onChange({ target: { value: 'git' } }); page.render();
  assert.ok(page.all().filter(n => /settings-nav-item/.test(n.props.className ?? '')).length < slugs.length);
  assert.ok(mount('providers-models').child('AgentSettings')); assert.ok(mount('experimental').child('GeneralOpenPreferences'));
  const cloud = mount('codex-cloud');
  assert.equal(cloud.child('CloudEnvironmentsView').props.embedded, true);
  assert.equal(cloud.all().filter(n => n.props.className === 'panel-page-header').length, 0, 'cloud workface owns its list/detail heading');
});
test('Dedicated state, service scopes and navigation guards survive wrapper correction', () => {
  const page = mount('worktrees'); assert.ok(page.child('WorktreeSettings')); assert.doesNotMatch(content(page.render()), /尚未接入实际执行器/);
  const review = mount('code-review'); assert.equal(review.child('CodeReviewSettings').props.state, review.props.codeReviewPreferencesState);
  assert.ok(review.child('CodeReviewSettings').props.providerScope.includes('isolated-account'));
  const profile = mount('profile'); const guard = () => false;
  profile.child('ProfileSettings').props.onNavigationGuardChange(guard);
  profile.by(n => n.type === 'button' && content(n) === 'Git').props.onClick(); profile.render(); assert.ok(profile.child('ProfileSettings'));
  profile.child('ProfileSettings').props.onNavigationGuardChange(null);
  profile.by(n => n.type === 'button' && content(n) === 'Git').props.onClick(); profile.render(); assert.ok(profile.child('GitSettings'));
  assert.equal(profile.calls.length, 0);
});
test('Grouped navigation arrows activate adjacent visible buttons without wrapping', () => {
  const page = mount('general-settings'); const nav = page.by(n => n.props.className === 'settings-nav-groups');
  const sequence = page.all().filter(n => /settings-nav-item/.test(n.props.className ?? ''));
  const activated = []; const buttons = sequence.map((node, index) => ({ focus: () => activated.push(['focus', index]), click: () => node.props.onClick() }));
  let prevented = 0;
  const event = (key, index) => ({ key, nativeEvent: {}, preventDefault: () => prevented++, target: { closest: () => buttons[index] }, currentTarget: { querySelectorAll: () => buttons } });
  nav.props.onKeyDown(event('ArrowDown', 0)); page.render(); assert.ok(page.child('AccountNotificationSettings')); assert.deepEqual(activated, [['focus', 1]]);
  nav.props.onKeyDown(event('ArrowUp', 0)); page.render(); assert.equal(page.child('NotificationSettings'), undefined); assert.equal(activated.length, 1);
  nav.props.onKeyDown(event('Tab', 0)); assert.equal(prevented, 2);
});
let failed = 0;
for (const [name, run] of cases) { try { run(); console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); } }
if (failed) process.exitCode = 1; else console.log('PASS production settings shell correction (not visual/native/full settings acceptance)');

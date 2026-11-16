import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/components/GeneralPreferenceSelect.tsx', 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const flatten = node => !node || typeof node !== 'object' ? [] : [node, ...(node.children ?? []).flatMap(flatten)];
function mount(overrides = {}) {
  let cursor = 0, tree, focus = null;
  const hooks = [], effects = [], calls = [], listeners = new Map();
  const geometry = { top: 100, bottom: 132, right: 500 };
  const events = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => {
    if (listeners.get(name) === fn) listeners.delete(name);
  } };
  const react = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState(initial) { const i = cursor++; hooks[i] ??= initial; return [hooks[i], value => { hooks[i] = value; }]; },
    useRef(value) { return hooks[cursor++] ??= { current: value }; },
    useEffect(fn, deps) { const i = cursor++, previous = hooks[i];
      if (!previous || deps.some((dep, j) => dep !== previous.deps[j])) {
        effects.push(() => { previous?.cleanup?.(); hooks[i] = { deps, cleanup: fn() }; });
      }
    } };
  const module = { exports: {} };
  react.useLayoutEffect = react.useEffect;
  vm.runInNewContext(code, { exports: module.exports, document: { body: {}, ...events },
    window: { innerWidth: 800, innerHeight: 600, ...events }, require(name) {
    if (name === 'react') return react;
    if (name === 'react-dom') return { createPortal: child => child };
    return new Proxy({}, { get: (_, key) => key });
  } });
  const props = { id: 'fixture', label: '测试偏好', value: 'a', options: [
    { value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }], onChange: value => calls.push(value), ...overrides };
  const render = () => {
    cursor = 0; tree = module.exports.GeneralPreferenceSelect(props);
    const all = flatten(tree), items = all.filter(n => ['menuitemradio', 'menuitem'].includes(n.props.role));
    const buttons = items.map((item, index) => ({ focus: () => { focus = index; } }));
    for (const node of all) {
      if (node.props.ref && typeof node.props.ref === 'object') node.props.ref.current = {
        focus: () => { focus = 'trigger'; }, contains: target => target === 'inside',
        querySelectorAll: () => buttons,
        getBoundingClientRect: () => geometry, offsetWidth: 220, offsetHeight: 80,
      };
    }
    for (const effect of effects.splice(0)) effect();
    return tree;
  };
  render();
  return { props, calls, render, all: () => flatten(tree), focus: () => focus, listeners, geometry };
}
const trigger = view => view.all().find(n => n.props.id === 'fixture');
const menu = view => view.all().find(n => n.props.role === 'menu');
const key = key => ({ key, nativeEvent: {}, preventDefault() {}, stopPropagation() {} });
{
  const external = { current: null }, view = mount({ triggerRef: external });
  assert.equal(trigger(view).props.ref, external);
  trigger(view).props.onClick(); view.render(); menu(view).props.onKeyDown(key('Escape'));
  assert.equal(view.focus(), 'trigger', 'shared menu restores the supplied trigger ref');
}
{
  const view = mount(); assert.equal(trigger(view).props['aria-expanded'], false);
  trigger(view).props.onClick(); view.render(); assert.ok(menu(view));
  const items = view.all().filter(n => n.props.role === 'menuitemradio');
  assert.equal(items[0].props['aria-checked'], true); assert.equal(items[1].props['aria-checked'], false);
  items[1].props.onClick(); view.render(); assert.deepEqual(view.calls, ['b']); assert.equal(menu(view), undefined);
  assert.equal(view.focus(), 'trigger');
}
{
  const view = mount(); trigger(view).props.onKeyDown(key('ArrowDown')); view.render(); assert.equal(view.focus(), 0);
  const event = key('End'); event.target = { closest: () => null }; menu(view).props.onKeyDown(event); assert.equal(view.focus(), 1);
  menu(view).props.onKeyDown(key('Escape')); view.render(); assert.equal(menu(view), undefined); assert.equal(view.focus(), 'trigger');
}
{
  const view = mount(); trigger(view).props.onKeyDown(key('ArrowUp')); view.render(); assert.equal(view.focus(), 1);
  view.all()[0].props.onBlur({ currentTarget: { contains: target => target === 'inside' }, relatedTarget: 'inside' });
  view.render(); assert.ok(menu(view));
  view.all()[0].props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null }); view.render(); assert.equal(menu(view), undefined);
}
for (const props of [{ disabled: true }, { options: [] }]) {
  const view = mount(props); assert.equal(trigger(view).props.disabled, true);
  trigger(view).props.onClick(); view.render(); assert.equal(menu(view), undefined);
}
{
  const view = mount(); trigger(view).props.onClick(); view.render();
  view.all().find(n => n.props.role === 'menuitemradio').props.onClick(); assert.deepEqual(view.calls, []);
}
console.log('PASS general preference production menu: checked state, one-shot selection, same-value no write, keyboard opening/navigation, Escape focus return, outside blur, disabled/empty');
{
  let reselected = 0;
  const view = mount({ onReselect: () => { reselected++; } });
  trigger(view).props.onClick(); view.render();
  view.all().find(n => n.props.role === 'menuitemradio').props.onClick();
  assert.equal(reselected, 1); assert.deepEqual(view.calls, []);
  view.props.disabled = true; view.render(); trigger(view).props.onClick(); view.render();
  assert.equal(menu(view), undefined); assert.equal(reselected, 1);
}

{
  const view = mount(); trigger(view).props.onKeyDown({ ...key('ArrowDown'), nativeEvent: { isComposing: true } });
  view.render(); assert.equal(menu(view), undefined);
  trigger(view).props.onClick(); view.render(); view.render();
  const before = view.focus(); menu(view).props.onKeyDown({ ...key('End'), nativeEvent: { keyCode: 229 } });
  assert.equal(view.focus(), before);
  assert.equal(menu(view).props.style.left, 280);
  view.geometry.top = 570; view.geometry.bottom = 602;
  view.listeners.get('scroll')(); view.render(); assert.equal(menu(view).props.style.top, 486);
  view.geometry.right = 790; view.listeners.get('resize')(); view.render(); assert.equal(menu(view).props.style.left, 570);
  view.listeners.get('pointerdown')({ target: 'inside' }); view.render(); assert.ok(menu(view));
  view.listeners.get('pointerdown')({ target: 'non-focusable-outside' }); view.render(); assert.equal(menu(view), undefined);
  assert.equal(view.listeners.size, 0, 'close must remove pointer, resize and capture-scroll listeners');
}
console.log('PASS portal menu: composing keys ignored, measured viewport positioning, bottom flip, scroll/resize updates, non-focusable outside click, listener cleanup');

{
  const view = mount({ options: [{ value: 'a', label: 'Same project', title: 'C:/alpha' }, { value: 'b', label: 'Same project', title: 'C:/beta' }], value: 'a' });
  trigger(view).props.onClick(); view.render();
  const items = view.all().filter(node => node.props.role === 'menuitemradio');
  assert.deepEqual(items.map(item => item.props.title), ['C:/alpha', 'C:/beta']);
  items[1].props.onClick();
  assert.deepEqual(view.calls, ['b'], 'same-label choices retain distinct identities');
}

// Render the real consumer: options must remain service-derived, not a replacement static list.
{
  const fixture = { platform: 'windows', preferredTarget: 'cursor', targets: [{ id: 'cursor', label: 'Cursor' }],
    preferredShell: 'powershell', shells: [{ id: 'powershell', label: 'PowerShell' }, { id: 'commandPrompt', label: 'CMD' }] };
  const input = fs.readFileSync('src/components/GeneralOpenPreferences.tsx', 'utf8');
  const module = { exports: {} }; let cursor = 0;
  const Component = () => null;
  const react = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: initial => [cursor++ === 0 ? fixture : initial, () => {}], useRef: value => ({ current: value }), useEffect() {} };
  vm.runInNewContext(ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText, {
    exports: module.exports, require(name) { return name === 'react' ? react
      : name.endsWith('/GeneralPreferenceSelect') ? { GeneralPreferenceSelect: Component } : { tauriInvoke() {} }; },
  });
  const all = flatten(module.exports.GeneralOpenPreferences());
  assert.equal(all.some(node => node.type === 'select'), false);
  const controls = all.filter(node => node.type === Component);
  assert.equal(controls.length, 2);
  assert.equal(controls[0].props.value, fixture.preferredTarget);
  assert.equal(JSON.stringify(controls[0].props.options), JSON.stringify([{ value: 'cursor', label: 'Cursor' }]));
  assert.equal(controls[1].props.value, fixture.preferredShell);
  assert.equal(controls[1].props.options.length, 2);
  assert.equal(controls.every(control => control.props.disabled), true, 'loading disables service changes');
  const changes = [];
  cursor = 0;
  const off = flatten(module.exports.GeneralOpenPreferences({ bottomPanelLauncher: {
    visible: false, busy: false, save: value => changes.push(value),
  } }));
  const toggle = off.find(node => node.props.role === 'switch');
  assert.equal(toggle.props.checked, false);
  assert.ok(!off.some(node => node.props.className === 'terminal-location-options'));
  toggle.props.onChange({ target: { checked: true } });
  assert.deepEqual(changes, [true]);
  cursor = 0;
  const on = flatten(module.exports.GeneralOpenPreferences({ bottomPanelLauncher: { visible: true, busy: false } }));
  assert.ok(on.some(node => node.props.className === 'terminal-location-options'));
}
console.log('PASS general production consumer: service options, confirmed values, loading lock, custom menu replacing native selects');
{
  const view = mount({ plainItems: true, value: 'b' });
  trigger(view).props.onClick(); view.render();
  const items = view.all().filter(node => node.props.role === 'menuitem');
  assert.equal(items.length, 2, 'MCP enum uses official plain items, not radio options');
  assert.equal(view.focus(), 0, 'plain menu opens at the first item rather than selecting a radio value');
  assert.ok(items.every(node => node.props['aria-checked'] === undefined));
  assert.equal(flatten(menu(view)).some(node => node.type === 'Check'), false);
  items[0].props.onClick(); view.render(); assert.deepEqual(view.calls, ['a']);
  assert.equal(view.focus(), 'trigger');
}
console.log('PASS plain enum items preserve shared keyboard/focus behavior without radio selection decoration');

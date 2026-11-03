import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync('src/components/DiffDrawer.tsx', 'utf8');
const ast = ts.createSourceFile('DiffDrawer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let tree, directoryOpen, directorySelect, searchOpen, searchSelect;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'WorkspaceFileTree') tree = node;
  if (ts.isJsxOpeningElement(node)) {
    const attr = name => node.attributes.properties.find(a => ts.isJsxAttribute(a) && a.name.getText(ast) === name)?.initializer;
    if (attr('aria-label')?.getText(ast) === '{item.name}') {
      directoryOpen = attr('onDoubleClick')?.expression;
      directorySelect = attr('onClick')?.expression;
    }
    if (attr('aria-label')?.getText(ast) === '{hit.relPath}') {
      searchOpen = attr('onDoubleClick')?.expression;
      searchSelect = attr('onClick')?.expression;
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const compile = code => ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
assert.ok(tree && directoryOpen && directorySelect && searchOpen && searchSelect);
function mount(width = 250, parentWidth = 1000) {
  const values = [], captured = [], drag = { current: null };
  const context = { useRef: () => drag, React: { createElement: (type, props, ...children) => ({ type, props, children }) } };
  const result = vm.runInNewContext(compile(`${tree.getText(ast)}\nWorkspaceFileTree`), context)({ width, onResize: value => values.push(value), children: null });
  const handle = result.children[0].props;
  const target = { parentElement: { parentElement: { clientWidth: parentWidth } }, setPointerCapture: id => captured.push(id), releasePointerCapture: id => captured.push(-id) };
  const pointer = x => ({ clientX: x, pointerId: 7, currentTarget: target, preventDefault() {} });
  return { values, captured, handle, target, pointer };
}
{
  const view = mount();
  view.handle.onPointerMove(view.pointer(1)); assert.deepEqual(view.values, [], 'hover cannot resize');
  view.handle.onPointerDown(view.pointer(500));
  view.handle.onPointerMove(view.pointer(450)); assert.equal(view.values.at(-1), 300, 'left-edge drag left grows right tree');
  view.handle.onPointerMove(view.pointer(0)); assert.equal(view.values.at(-1), 600, 'drag respects parent 60 percent');
  view.handle.onPointerMove(view.pointer(600)); assert.equal(view.values.at(-1), 200, 'tree stops at minimum before collapse');
  view.handle.onPointerMove(view.pointer(660)); assert.equal(view.values.at(-1), 0, 'drag below threshold hides tree');
  view.handle.onPointerUp(view.pointer(660));
  const count = view.values.length; view.handle.onPointerMove(view.pointer(400));
  assert.equal(view.values.length, count, 'pointer release stops resize');
  assert.deepEqual(view.captured, [7, -7]);
}
{
  const view = mount(250, 500);
  view.handle.onPointerDown(view.pointer(500)); view.handle.onLostPointerCapture();
  view.handle.onPointerMove(view.pointer(300)); assert.deepEqual(view.values, [], 'lost capture cancels drag');
  let prevented = 0;
  const key = value => ({ key: value, currentTarget: view.target, preventDefault: () => prevented++ });
  view.handle.onKeyDown(key('ArrowLeft')); assert.equal(view.values.at(-1), 266);
  view.handle.onKeyDown(key('ArrowRight')); assert.equal(view.values.at(-1), 234);
  view.handle.onKeyDown(key('Enter')); assert.equal(prevented, 2, 'unrelated key remains untouched');
}
{
  const events = [];
  const context = { item: { path: 'root/a.ts', name: 'a.ts', isDirectory: false }, hit: { absPath: 'root/b.ts' },
    setSelectedTreePath: path => events.push(['select', path]), openFilePreview: path => events.push(['open', path]),
    setExplorerDraft: () => {}, setCurrentDir: path => events.push(['directory', path]) };
  const run = node => vm.runInNewContext(compile(`(${node.getText(ast)})`), context)();
  run(directorySelect); assert.deepEqual(events, [['select', 'root/a.ts']], 'single click preserves current editor');
  run(directoryOpen); assert.deepEqual(events.at(-1), ['open', 'root/a.ts']);
  context.item.isDirectory = true; run(directoryOpen); assert.deepEqual(events.at(-1), ['directory', 'root/a.ts']);
  run(searchSelect); assert.deepEqual(events.at(-1), ['select', 'root/b.ts']);
  run(searchOpen); assert.deepEqual(events.at(-1), ['open', 'root/b.ts']);
}
console.log('PASS actual shared tree callbacks: left resize, min/max/collapse, capture cleanup, keyboard and selection/open separation; official paired pixels and native pointer input unverified');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 };
function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: options }).outputText, { exports });
  return exports;
}
const projects = load('src/sidebarProjects.ts'), roots = load('src/hooksSettingsModel.ts');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const ast = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback, passedRoots, passedSearchRoots, openFile, passedRequest;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'workbenchWorkspaceRoots') callback = node.initializer.arguments[0];
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'openPreviewFile') openFile = node.initializer.arguments[0];
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    if (node.tagName.getText(ast) === 'DiffDrawer') {
      passedRoots = node.attributes.properties.find(p => p.name?.getText(ast) === 'workspaceRoots');
      passedRequest = node.attributes.properties.find(p => p.name?.getText(ast) === 'previewRequestId');
    }
    if (node.tagName.getText(ast) === 'QuickSearchModal') passedSearchRoots = node.attributes.properties.find(p => p.name?.getText(ast) === 'workspaceRoots');
  }
  ts.forEachChild(node, visit);
}
visit(ast); assert.ok(callback); assert.equal(passedRoots.initializer.expression.getText(ast), 'workbenchWorkspaceRoots');
assert.equal(passedSearchRoots.initializer.expression.getText(ast), 'workbenchWorkspaceRoots');
const membership = {
  selectedProjectId: 'unrelated', threadProjectAssignments: { a: { projectKind: 'local', projectId: 'mine' } },
  workspaceProjectAssignments: {}, projectlessThreadIds: [], localProjects: [
    { id: 'mine', rootPaths: ['D:/mine', 'D:/secondary'], name: 'Mine', createdAt: 1 },
    { id: 'unrelated', rootPaths: ['D:/private-other'], name: 'Other', createdAt: 2 },
  ],
};
function run(overrides = {}) {
  const context = { ...projects, ...roots, activeWorkspace: { path: 'D:/mine' }, activeThreadId: 'a',
    activeThreadObj: { id: 'a', cwd: 'D:/mine' }, workspaces: [{ id: 'global', path: 'D:/global' }],
    sidebarProjectMembership: membership, workspaceHints: {}, ...overrides };
  return Array.from(vm.runInNewContext(`(${callback.getText(ast)})()`, context));
}
assert.deepEqual(run(), ['D:/mine', 'D:/secondary']);
assert.deepEqual(run({ activeWorkspace: { path: 'D:/mine-worktree' } }), ['D:/mine', 'D:/secondary', 'D:/mine-worktree']);
assert.deepEqual(run({ activeThreadObj: null }), ['D:/mine'], 'unloaded thread cannot inherit selected unrelated project');
assert.deepEqual(run({ sidebarProjectMembership: { ...membership, threadProjectAssignments: {}, projectlessThreadIds: ['a'] } }), ['D:/mine']);
assert.deepEqual(run({ activeWorkspace: null }), []);
assert.deepEqual(run({ activeThreadId: null, activeThreadObj: null }), ['D:/mine']);
assert.equal(passedRequest.initializer.expression.getText(ast), 'previewRequestId');
let request = 0;
const opened = [];
const open = vm.runInNewContext(ts.transpileModule(`(${openFile.getText(ast)})`, { compilerOptions: options }).outputText, {
  setSelectedReviewFinding: value => assert.equal(value, null),
  setSelectedPreviewFile: file => opened.push(file),
  setPreviewRequestId: update => { request = update(request); },
  setShowRightDrawer: value => assert.equal(value, true),
});
open('D:/mine/same.ts'); open('D:/mine/same.ts');
assert.equal(request, 2, 'same path click creates a fresh retry request');
assert.equal(opened.length, 2);
console.log('PASS actual App workspace roots follow the active thread project, exclude global/unrelated roots and preserve cwd');

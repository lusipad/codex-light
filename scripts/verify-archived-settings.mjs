import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const read = path => fs.readFileSync(path, "utf8");
const view = read("src/components/SettingsView.tsx"), app = read("src/App.tsx");
assert.ok(!view.includes('"threads_meta_get"') && !view.includes("setArchivedThreads"), "ARS01: settings must use the real shared archive list instead of legacy local metadata");
assert.ok(!view.includes('"thread_archive_toggle"') && !view.includes('"thread_delete"'), "ARS02/03: settings must share App lifecycle handlers");
const parse = (name, source) => ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const ast = parse("SettingsView.tsx", view);
let archiveBranch, archiveChild;
function walk(node) {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && node.left.getText(ast) === 'activeSection === "archived-chats"') archiveBranch = node;
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "ArchiveView") archiveChild = node;
  ts.forEachChild(node, walk);
}
walk(ast);
assert.ok(archiveBranch && archiveChild, "ARS01: dedicated setting embeds shared ArchiveView");
assert.ok(archiveBranch.getText(ast).includes(archiveChild.getText(ast)));
const archiveViewProps = { refreshToken: "2:true", onSelectThread() {}, onUnarchive() {}, onDelete() {}, onDeleteAll() {}, onShowToast() {} };
const ArchiveView = Symbol("ArchiveView");
const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
const tree = vm.runInNewContext(compile(`(${archiveBranch.getText(ast)})`), { activeSection: "archived-chats", archiveViewProps, React, ArchiveView });
const child = tree.children[0];
assert.equal(child.type, ArchiveView);
for (const [key, value] of Object.entries(archiveViewProps)) assert.equal(child.props[key], value, `ARS02/04: ${key} forwarded without changing identity`);
assert.equal(vm.runInNewContext(compile(`(${archiveBranch.getText(ast)})`), { activeSection: "storage", archiveViewProps, React, ArchiveView }), false);
const appAst = parse("App.tsx", app);
let settings, standalone;
function find(node) {
  if (ts.isJsxSelfClosingElement(node)) {
    if (node.tagName.getText(appAst) === "SettingsView") settings = node;
    if (node.tagName.getText(appAst) === "ArchiveView") standalone = node;
  }
  ts.forEachChild(node, find);
}
find(appAst);
const props = settings.attributes.properties.find(p => p.name?.getText(appAst) === "archiveViewProps").initializer.expression;
const bindings = { archiveRefreshTick: 63, appServerStatus: { connected: true }, selectThread() {}, handleUnarchiveThread() {}, handleDeleteArchivedThread() {}, handleDeleteAllArchivedThreads() {}, showAppToast() {} };
const shared = vm.runInNewContext(compile(`(${props.getText(appAst)})`), bindings);
for (const [key, value] of Object.entries(shared)) {
  const attribute = standalone.attributes.properties.find(p => p.name?.getText(appAst) === key);
  assert.ok(attribute, `ARS04: standalone archive has ${key}`);
  assert.equal(vm.runInNewContext(compile(`(${attribute.initializer.expression.getText(appAst)})`), bindings), value, `ARS02-04: both entry points use identical ${key}`);
}
assert.ok(!view.includes("handleSaveVisual") && !view.includes("saveBanner"), "ARS05: archive manages its own refresh and actions without generic saves/banners");
console.log("PASS ARS01-05: production settings JSX forwards shared archive callbacks and refresh identity; no legacy metadata list or duplicate write paths");

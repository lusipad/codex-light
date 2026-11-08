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
const archivedCloudTasks = { source: "actual-settings-hook-state" };
const archivedConversations = { source: "actual-conversation-hook-state" };
const archivedDurableChats = { source: "actual-durable-hook-state" };
const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
const tree = vm.runInNewContext(compile(`(${archiveBranch.getText(ast)})`), { activeSection: "archived-chats", archiveViewProps, archivedCloudTasks, archivedConversations, archivedDurableChats, React, ArchiveView });
const child = tree.children[0];
assert.equal(child.type, ArchiveView);
assert.equal(child.props.surface, "settings", "ARS01: settings explicitly selects its researched surface");
assert.equal(child.props.cloudArchive, archivedCloudTasks, "ARS01: settings forwards the live source state");
assert.equal(child.props.conversationArchive, archivedConversations, "ARS07: settings forwards the live conversation state");
assert.equal(child.props.durableArchive, archivedDurableChats, "ARS08: settings forwards the durable archive state");
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
const bindings = { workspaces: [{ id: "root", path: "C:/project" }], sidebarProjectMembership: { localProjects: [{ id: "project", name: "Project" }] }, workspaceHints: { thread: "C:/project" }, archiveRefreshTick: 63, appServerStatus: { connected: true }, selectThread() {}, handleUnarchiveThread() {}, handleDeleteArchivedThread() {}, handleDeleteAllArchivedThreads() {}, showAppToast() {} };
const shared = vm.runInNewContext(compile(`(${props.getText(appAst)})`), bindings);
for (const [key, binding] of [["workspaces", "workspaces"], ["projectMembership", "sidebarProjectMembership"], ["workspaceHints", "workspaceHints"]]) {
  assert.equal(shared[key], bindings[binding], `ARS04: settings receives current ${key} by identity`);
}
assert.ok(!standalone.attributes.properties.some(p => p.name?.getText(appAst) === "surface"), "ARS04: global archive retains its default surface");
assert.ok(!standalone.attributes.properties.some(p => p.name?.getText(appAst) === "cloudArchive"), "ARS04: global archive is not coupled to cloud queries");
assert.ok(!standalone.attributes.properties.some(p => p.name?.getText(appAst) === "conversationArchive"), "ARS07: global archive does not consume conversation source state");
for (const [key, value] of Object.entries(shared)) {
  if (["workspaces", "projectMembership", "workspaceHints", "onDurableRestored", "onOpenDurableChat", "onDeleteProject"].includes(key)) continue;
  const attribute = standalone.attributes.properties.find(p => p.name?.getText(appAst) === key);
  assert.ok(attribute, `ARS04: standalone archive has ${key}`);
  assert.equal(vm.runInNewContext(compile(`(${attribute.initializer.expression.getText(appAst)})`), bindings), value, `ARS02-04: both entry points use identical ${key}`);
}
assert.ok(!view.includes("handleSaveVisual") && !view.includes("saveBanner"), "ARS05: archive manages its own refresh and actions without generic saves/banners");
console.log("PASS ARS01-05: production settings JSX forwards shared archive callbacks and refresh identity; no legacy metadata list or duplicate write paths");

let cloudHook;
function findHook(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "archivedCloudTasks") cloudHook = node.initializer;
  ts.forEachChild(node, findHook);
}
findHook(ast); assert.ok(cloudHook);
for (const [activeSection, connected] of [["archived-chats", true], ["general-settings", true], ["archived-chats", false]]) {
  let received;
  vm.runInNewContext(compile(`(${cloudHook.getText(ast)})`), { activeSection, connectionIdentity: "connection", accountIdentity: "account", appServerStatus: { connected }, useArchivedCloudTasks: value => { received = value; } });
  assert.equal(received.enabled, activeSection === "archived-chats");
  assert.equal(received.connected, connected);
  assert.equal(received.scope, JSON.stringify(["connection", "account"]));
}
console.log("PASS ARS06: real settings hook binding uses active section, current connection and account scope");

let conversationHook;
function findConversationHook(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "archivedConversations") conversationHook = node.initializer;
  ts.forEachChild(node, findConversationHook);
}
findConversationHook(ast); assert.ok(conversationHook);
for (const [activeSection, connected] of [["archived-chats", true], ["general-settings", true], ["archived-chats", false]]) {
  let received;
  vm.runInNewContext(compile(`(${conversationHook.getText(ast)})`), { activeSection, connectionIdentity: "connection", accountIdentity: "account", appServerStatus: { connected }, useArchivedConversations: value => { received = value; } });
  assert.equal(received.enabled, activeSection === "archived-chats");
  assert.equal(received.connected, connected);
  assert.equal(received.scope, JSON.stringify(["connection", "account"]));
}
console.log("PASS ARS07: conversation hook binds current settings scope, account and connection only");

let durableHook;
function findDurableHook(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "archivedDurableChats") durableHook = node.initializer;
  ts.forEachChild(node, findDurableHook);
}
findDurableHook(ast); assert.ok(durableHook);
for (const [activeSection, connected] of [["archived-chats", true], ["general-settings", true], ["archived-chats", false]]) {
  const received = vm.runInNewContext(compile(`(${durableHook.getText(ast)})`), {
    activeSection, connectionIdentity: "connection", accountIdentity: "account", appServerStatus: { connected },
    useArchivedDurableChats: value => value,
  });
  assert.equal(received.enabled, activeSection === "archived-chats");
  assert.equal(received.connected, connected);
  assert.equal(received.scope, JSON.stringify(["connection", "account"]));
}
console.log("PASS ARS08: durable archive source and actions are scoped to settings");

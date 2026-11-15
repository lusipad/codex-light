import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = path => fs.readFileSync(path, "utf8");
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const source = read("src/components/HotkeyWindow.tsx");
assert.ok(!/setTimeout|callAppServer|tauriInvoke|已收到：|回复已生成|\/resume/.test(source), "no independent transport, timer, pseudo commands or fake success");
let effects = [], refs = [], cursor = 0, closed = 0, opened = 0, created = 0, focused = 0, restored = 0, scrolled = 0;
class Element { isConnected = true; focus() { restored++; } }
const previous = new Element();
const document = { activeElement: previous };
const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useRef: value => refs[cursor++] ??= { current: value }, useEffect: effect => effects.push(effect) };
React.default = React;
const textModule = {};
vm.runInNewContext(compile(read("src/threadText.ts")), { exports: textModule });
const mod = {};
vm.runInNewContext(compile(source), { exports: mod, document, HTMLElement: Element,
  require: name => name === "react" ? React : name === "../threadText" ? textModule : name === "./MarkdownView" ? { MarkdownView: "MarkdownView" } : {} });
const composer = { type: "SharedComposer", props: {}, children: [] }, approvals = { type: "SharedApprovals", props: {}, children: [] };
const props = { threadId: "t1", turns: [{ id: "turn1", status: "running", items: [
  { id: "u1", type: "userMessage", content: [{ type: "text", text: "真实用户内容" }] },
  { id: "a1", type: "agentMessage", text: "部分" },
] }], isStreaming: true, loading: false, error: null, composer, approvals,
  onNewChat: () => created++, onClose: () => closed++, onOpenMainApp: () => opened++ };
let tree;
const render = () => { cursor = 0; effects = []; tree = mod.HotkeyWindow(props); };
const nodes = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(nodes)] : [];
const contents = () => nodes(tree).filter(n => n.type === "MarkdownView").map(n => n.props.content);
render();
props.native = true; props.title = "真实工作区"; render();
assert.ok(JSON.stringify(tree).includes("真实工作区"), "native detail header uses its real title");
assert.ok(!JSON.stringify(tree).includes("隐藏后继续运行，未发送草稿"), "no permanent implementation banner in native chat");
assert.deepEqual(contents(), ["真实用户内容", "部分"]);
assert.ok(nodes(tree).includes(composer) && nodes(tree).includes(approvals), "render the same production composer and approval nodes");
assert.equal(tree.props["data-thread-id"], "t1");
props.turns = [{ ...props.turns[0], status: "completed", items: [...props.turns[0].items.slice(0, 1), { id: "a1", type: "agentMessage", text: "部分更新完成" }] }];
props.isStreaming = false; render();
assert.deepEqual(contents(), ["真实用户内容", "部分更新完成"]);
assert.ok(!JSON.stringify(tree).includes("正在运行"), "only real streaming state controls running status");
props.error = "history failed"; props.loading = true; render();
assert.match(JSON.stringify(tree), /history failed/); assert.match(JSON.stringify(tree), /正在加载会话/);
const button = label => nodes(tree).find(n => n.type === "button" && n.props["aria-label"] === label);
button("开始新对话").props.onClick(); button("在主窗口中打开").props.onClick(); button("关闭弹出窗口").props.onClick();
assert.equal(created, 1); assert.equal(opened, 1); assert.equal(closed, 1);
const key = (patch = {}) => ({ key: "Escape", nativeEvent: {}, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...patch });
tree.props.onKeyDown(key({ nativeEvent: { isComposing: true } }));
tree.props.onKeyDown(key({ nativeEvent: { keyCode: 229 } }));
tree.props.onKeyDown(key({ defaultPrevented: true })); assert.equal(closed, 1);
for (const modifier of ["metaKey", "ctrlKey", "altKey", "shiftKey"]) tree.props.onKeyDown(key({ [modifier]: true }));
assert.equal(closed, 1, "official dismissal ignores modified Escape");
const escape = key(); tree.props.onKeyDown(escape); assert.equal(closed, 2); assert.ok(escape.prevented && escape.stopped);
refs[0].current = { querySelector: () => ({ focus: () => focused++ }) };
refs[1].current = { scrollIntoView: () => scrolled++ };
const cleanup = effects[0](); effects[1](); assert.equal(focused, 1); assert.equal(scrolled, 1);
cleanup(); assert.equal(restored, 1);
const first = { getClientRects: () => [1], focus: () => focused++ }, last = { getClientRects: () => [1], focus: () => restored++ };
refs[0].current.querySelectorAll = () => [first, last]; document.activeElement = last;
const tab = key({ key: "Tab" }); tree.props.onKeyDown(tab); assert.ok(tab.prevented); assert.equal(focused, 2);
document.activeElement = first; tree.props.onKeyDown(key({ key: "Tab", shiftKey: true })); assert.equal(restored, 2);
console.log("PASS QC01/QC04 production JSX: structured user content, live updates, real status/errors, callbacks, IME/Escape, focus restoration and Tab boundary");

const app = read("src/App.tsx"), ast = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const helpers = new Map();
function visit(node) { if (ts.isVariableDeclaration(node) && ["renderThreadComposer", "renderApprovals"].includes(node.name.getText(ast))) helpers.set(node.name.getText(ast), node.initializer.getText(ast)); ts.forEachChild(node, visit); }
visit(ast);
let sends = 0, interrupts = 0, responses = 0;
const context = { React, ComposerBox: "ComposerBox", ApprovalCenter: "ApprovalCenter", handleSendMessage: () => sends++, handleInterruptTurn: () => interrupts++, handleRespondServerRequest: () => responses++,
  keyboardState: { bindings: [{ command: "composer.submit", key: "Ctrl+Enter" }] }, queueBusy: false,
  modelSelection: { selectionPending: false, selectionDisabledReason: "", serviceTier: "swift", recentModelConfigurations: [] },
  sendStartPendingRef: { current: new Set() }, threadRequestRef: { current: "t1" } };
Object.assign(context, { contextUsageVisible: false, activeThreadId: null, threadComposerWorkspace: null,
  gitStatus: null, gitBranches: [], useWorktree: false, workspaceFiles: [], workspaceFileHits: [] });
for (const helper of helpers.values()) for (const match of helper.matchAll(/=\{([a-zA-Z][a-zA-Z0-9]*)\}/g)) context[match[1]] ??= `shared:${match[1]}`;
const sharedComposer = vm.runInNewContext(compile(`(${helpers.get("renderThreadComposer")})`), context)();
const sharedApprovals = vm.runInNewContext(compile(`(${helpers.get("renderApprovals")})`), context)();
sharedComposer.props.onSendMessage(); sharedComposer.props.onInterruptTurn(); sharedApprovals.props.onRespond();
assert.equal(sends, 1); assert.equal(interrupts, 1); assert.equal(responses, 1);
for (const key of ["promptInput", "models", "permissionMode", "attachedFiles", "reasoningEffort"]) assert.equal(sharedComposer.props[key], `shared:${key}`);
assert.equal(sharedApprovals.props.requests, "shared:activePendingRequests");
assert.equal(sharedApprovals.props.responseStates, "shared:requestResponses");
assert.equal(sharedComposer.props.keyBindings, context.keyboardState.bindings, "quick chat shares the production keyboard bindings");
assert.equal(sharedComposer.props.submissionDisabled, false);
assert.equal(sharedComposer.props.serviceTier, context.modelSelection.serviceTier);
assert.equal(sharedComposer.props.recentModelConfigurations, context.modelSelection.recentModelConfigurations);
context.modelSelection.selectionPending = true;
assert.equal(vm.runInNewContext(compile(`(${helpers.get("renderThreadComposer")})`), context)().props.submissionDisabled, true, "model save disables the shared composer");
context.modelSelection.selectionPending = false;
context.queueBusy = true;
assert.equal(vm.runInNewContext(compile(`(${helpers.get("renderThreadComposer")})`), context)().props.submissionDisabled, true, "queue work disables the shared composer");
context.queueBusy = false; context.sendStartPendingRef.current.add("t1");
assert.equal(vm.runInNewContext(compile(`(${helpers.get("renderThreadComposer")})`), context)().props.submissionDisabled, true, "a pending send disables the shared composer");
assert.match(app, /composer=\{renderThreadComposer\(\)\}/);
assert.match(app, /approvals=\{renderApprovals\(\)\}/);
assert.match(app, /!showPopoutModal && renderThreadComposer\(\)/);
assert.match(app, /!showPopoutModal && renderApprovals\(\)/);
const home = app.slice(app.indexOf('<div className="home-composer-dock">'), app.indexOf('/* ── Active Local Conversation'));
assert.match(home, /!showPopoutModal &&/);
const popout = app.slice(app.lastIndexOf("<HotkeyWindow"), app.indexOf("<MiniPetWidget"));
assert.ok(!popout.includes("selectThread("), "main continuation must not re-resume the already active thread");
assert.ok(!read("src/main.tsx").includes("<HotkeyWindow"), "legacy utility URL must initialize the real App transport/state owner");
console.log("PASS QC02/QC03 production composer/approval callbacks and shared state; singleton placement and same-thread main continuation");

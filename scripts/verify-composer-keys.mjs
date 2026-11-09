import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { mountProjectContext } from "./verify-new-thread-project-context.mjs";

const source = fs.readFileSync(new URL("../src/components/ComposerBox.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("ComposerBox.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleKeyDown") handler = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast); assert.ok(handler);
let sent = 0, queued = 0, prevented = 0;
const context = vm.createContext({
  isStreaming: true, autocompleteMode: null, composerEnterBehavior: "enter", promptInput: "hello",
  submissionDisabled: false, keyBindings: [], commandId: id => `composer.${id.slice(9)}`,
  cloudActive: false, followUpMode: "steer",
  acceleratorFromEvent: e => `${e.ctrlKey || e.metaKey ? "Ctrl+" : ""}${e.shiftKey ? "Shift+" : ""}${e.key}`,
  normalizeAccelerator: value => value.toLowerCase(),
  onSendMessage: () => sent++, onQueueMessage: () => queued++,
});
const keyDown = vm.runInContext(ts.transpileModule(`(${handler})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
const press = (options = {}) => {
  sent = 0; queued = 0; prevented = 0;
  keyDown({ key: "Enter", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, nativeEvent: {}, preventDefault: () => prevented++, ...options });
  return [sent, queued, prevented];
};
assert.deepEqual(press({ ctrlKey: true }), [0, 1, 1], "running Ctrl+Enter must enqueue rather than Steer");
assert.deepEqual(press(), [1, 0, 1]);
assert.deepEqual(press({ metaKey: true }), [0, 1, 1]);
assert.deepEqual(press({ altKey: true }), [0, 0, 0], "Alt+Enter must not silently send");
assert.deepEqual(press({ shiftKey: true }), [0, 0, 0]);
assert.deepEqual(press({ ctrlKey: true, shiftKey: true }), [0, 0, 0]);
console.log("PASS Enter preference: send, invert-to-queue and modifier exclusions");

context.followUpMode = "queue";
assert.deepEqual(press(), [0, 1, 1], "queue mode changes the ordinary running submission");
assert.deepEqual(press({ ctrlKey: true }), [1, 0, 1], "inversion steers exactly one submission");
assert.deepEqual(press(), [0, 1, 1], "inversion does not change the preference");
context.cloudActive = true;
assert.deepEqual(press(), [1, 0, 1], "local mode cannot route cloud input to the local queue");
context.cloudActive = false;
context.followUpMode = "steer";

context.composerEnterBehavior = "cmdAlways";
assert.deepEqual(press(), [0, 0, 0]);
assert.deepEqual(press({ ctrlKey: true }), [1, 0, 1]);
assert.deepEqual(press({ ctrlKey: true, shiftKey: true }), [0, 1, 1]);
assert.deepEqual(press({ metaKey: true, shiftKey: true }), [0, 1, 1]);
assert.deepEqual(press({ ctrlKey: true, altKey: true }), [0, 0, 0]);
assert.deepEqual(press({ shiftKey: true }), [0, 0, 0]);
console.log("PASS Ctrl+Enter preference: send, Ctrl+Shift+Enter queue and newline");

for (const mode of ["enter", "cmdIfMultiline", "cmdAlways"]) {
  context.composerEnterBehavior = mode;
  const modifiers = mode === "enter" ? { ctrlKey: true } : { ctrlKey: true, shiftKey: true };
  assert.deepEqual(press({ ...modifiers, nativeEvent: { isComposing: true } }), [0, 0, 0]);
  assert.deepEqual(press({ ...modifiers, nativeEvent: { keyCode: 229 } }), [0, 0, 0]);
  assert.deepEqual(press({ ...modifiers, repeat: true }), [0, 0, 1]);
}
console.log("PASS composition and held modifier shortcuts never submit");
context.isStreaming = false; context.composerEnterBehavior = "cmdAlways";
assert.deepEqual(press({ ctrlKey: true, shiftKey: true }), [0, 0, 0], "idle composer cannot enqueue via follow-up inversion");
assert.deepEqual(press({ ctrlKey: true }), [1, 0, 1]);
console.log("PASS idle composer retains send behavior without queuing");

context.keyBindings = [{ command: "composer.submit", key: null }];
assert.deepEqual(press({ ctrlKey: true }), [0, 0, 0], "cleared submit releases legacy Ctrl+Enter");
context.keyBindings = [{ command: "composer.submit", key: "Ctrl+L" }];
assert.deepEqual(press({ ctrlKey: true }), [0, 0, 0], "custom submit releases old key");
context.keyBindings = [{ command: "composer.queue", key: null }];
context.isStreaming = true;
assert.deepEqual(press({ ctrlKey: true, shiftKey: true }), [0, 0, 0], "cleared queue releases inversion");
context.composerEnterBehavior = "enter";
context.keyBindings = [{ command: "composer.submit", key: "Ctrl+Enter" }];
assert.deepEqual(press({ ctrlKey: true }), [0, 0, 0], "custom submit must reach dispatcher instead of old queue inversion");
context.keyBindings = [];
context.submissionDisabled = true;
assert.deepEqual(press({ ctrlKey: true }), [0, 0, 1], "pending submission cannot repeat");
context.submissionDisabled = false;
assert.deepEqual(press({ repeat: true }), [0, 0, 1], "held Enter cannot resend");
console.log("PASS changed/cleared submit and queue release legacy keys; pending/repeat blocked");

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const appAst = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const sendBindings = new Map();
function checkWiring(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(appAst) === "ComposerBox") {
    const prop = name => node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(appAst) === name);
    assert.equal(prop("followUpMode")?.initializer?.expression?.getText(appAst), "followUpMode");
    assert.equal(prop("onQueueMessage")?.initializer?.expression?.getText(appAst), "handleEnqueueFollowup");
    sendBindings.set(prop("variant").initializer.text, prop("onSendMessage").initializer.expression.getText(appAst));
  }
  ts.forEachChild(node, checkWiring);
}
checkWiring(appAst); assert.equal(sendBindings.size, 2);
const localSend = () => assert.fail("active Cloud Home cannot submit to the local chat");
const sendContext = { handleSendMessage: localSend, homeCloud: { active: false } };
assert.equal(vm.runInNewContext(sendBindings.get("thread"), sendContext), localSend);
assert.equal(vm.runInNewContext(sendBindings.get("home"), sendContext), localSend);
const cloudSession = { threadId: "cloud" };
const routes = [];
Object.assign(sendContext, {
  homeCloud: { active: true, send: apply => apply(cloudSession) },
  navigationRequestRef: { current: 1 },
  activeRouteRef: { current: "home" },
  setCloudDraft: draft => assert.equal(draft.session, cloudSession),
  setActiveRoute: route => routes.push(route),
  refreshCloudRecentRef: { current: null },
});
assert.equal(vm.runInNewContext(sendBindings.get("home"), sendContext)(), true);
assert.deepEqual(routes, ["cloud-draft"]);
assert.equal(vm.runInNewContext(sendBindings.get("thread"), sendContext), localSend);
assert.ok(!source.includes("Alt+Enter 加入队列"));
console.log("PASS both actual App composers use the real queue handler without false Alt+Enter hints");

let sendClick;
function findSendButton(node) {
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === "button" &&
      node.attributes.properties.some(p => p.name?.getText(ast) === "className" &&
        p.initializer?.text === "send-action-btn")) {
    sendClick = node.attributes.properties.find(p => p.name?.getText(ast) === "onClick")?.initializer?.expression;
  }
  ts.forEachChild(node, findSendButton);
}
findSendButton(ast);
assert.ok(sendClick, "execute the actual production send button binding");
for (const scenario of ["success", "failure", "edited", "attachment"]) {
  const view = mountProjectContext({
    threadId: "existing",
    turn: () => {
      if (scenario === "failure") throw Error("fixture send denied");
      if (scenario === "edited") view.state.promptInput = "new draft";
      return { turn: { id: "accepted" } };
    },
  });
  if (scenario === "attachment") {
    view.context.attachedFiles = [{ id: "file", name: "file.txt", path: "D:/fixture/file.txt", kind: "file" }];
  }
  const click = vm.runInNewContext(ts.transpileModule(`(${sendClick.getText(ast)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { onSendMessage: view.send });
  await click({ type: "click" });
  const starts = view.calls.filter(([method]) => method === "turn/start");
  assert.equal(starts.length, 1, "a mouse click submits exactly once");
  assert.equal(starts[0][1].input[0].text, "hello", "click events cannot replace message text");
  if (scenario === "attachment") {
    assert.equal(view.context.pendingAttachmentSaveRef.current.clearComposer, true,
      "mouse send must allow successful attachment-save snapshot cleanup");
  } else {
    assert.equal(view.state.promptInput, scenario === "failure" ? "hello" : scenario === "edited" ? "new draft" : "",
      `mouse send ${scenario} must apply the same draft cleanup as keyboard send`);
  }
}
console.log("PASS production mouse send binding: successful cleanup, failure/late-edit preservation and attachment save cleanup (L2)");

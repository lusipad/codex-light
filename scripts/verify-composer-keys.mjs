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

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const appAst = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let composers = 0;
function checkWiring(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(appAst) === "ComposerBox") {
    composers++;
    const prop = node.attributes.properties.find(p => p.name?.getText(appAst) === "onQueueMessage");
    assert.equal(prop?.initializer?.expression?.getText(appAst), "handleEnqueueFollowup");
    const sendProp = node.attributes.properties.find(p => p.name?.getText(appAst) === "onSendMessage");
    assert.equal(sendProp?.initializer?.expression?.getText(appAst), "handleSendMessage");
  }
  ts.forEachChild(node, checkWiring);
}
checkWiring(appAst); assert.equal(composers, 2);
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

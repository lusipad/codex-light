import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { mountProjectContext } from "./verify-new-thread-project-context.mjs";

const appSource = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const attachmentSource = ts.createSourceFile("threadAttachments.ts", fs.readFileSync("src/threadAttachments.ts", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const appDeclarations = new Map(), attachmentDeclarations = new Map();
function collect(node, ast, declarations) {
  if (ts.isVariableDeclaration(node)) declarations.set(node.name.getText(ast), node.initializer);
  if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.getText(ast), node);
  ts.forEachChild(node, child => collect(child, ast, declarations));
}
collect(appSource, appSource, appDeclarations);
collect(attachmentSource, attachmentSource, attachmentDeclarations);
const compile = text => ts.transpileModule(`(${text})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const evaluate = (declarations, name, context, callback = false) => {
  const value = declarations.get(name);
  assert.ok(value, `production ${name} must exist`);
  if (callback) return vm.runInNewContext(compile(value.arguments[0].getText(appSource)), context);
  const declaration = value.getText(attachmentSource).replace(/^export\s+/, "");
  const output = ts.transpileModule(`${declaration}\n${name}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return vm.runInNewContext(output, context);
};
const plain = value => JSON.parse(JSON.stringify(value));

const context = { attachmentScopeRef: { current: "home" }, composerAttachmentDrafts: {} };
context.setComposerAttachmentDrafts = update => {
  context.composerAttachmentDrafts = update(context.composerAttachmentDrafts);
};
const identityKey = attachmentDeclarations.get("attachmentIdentityKey").getText(attachmentSource).replace(/^export\s+/, "");
const mergeItems = attachmentDeclarations.get("mergeAttachmentItems").getText(attachmentSource).replace(/^export\s+/, "");
context.mergeAttachmentItems = vm.runInNewContext(ts.transpileModule(
  `${identityKey}\n${mergeItems}\nmergeAttachmentItems`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText, context);
const setScoped = evaluate(appDeclarations, "setScopedAttachedFiles", context, true);
const moveHome = evaluate(appDeclarations, "moveHomeAttachmentsToThread", context, true);
const add = (scope, item) => setScoped(scope, current => context.mergeAttachmentItems(current, [item]));
const file = id => ({ id, name: `${id}.txt`, path: `D:/drafts/${id}.txt`, kind: "file" });

add("home", file("home"));
add("thread:a", file("a"));
add("thread:b", file("b"));
assert.deepEqual(plain(context.composerAttachmentDrafts), {
  home: [file("home")], "thread:a": [file("a")], "thread:b": [file("b")],
}, "home and each thread keep separate attachment drafts");

context.attachmentScopeRef.current = "thread:a";
setScoped(context.attachmentScopeRef.current, files => files.filter(item => item.id !== "a"));
assert.deepEqual(plain(context.composerAttachmentDrafts["thread:a"] ?? []), [], "removal updates only the active composer scope");
assert.deepEqual(plain(context.composerAttachmentDrafts["thread:b"]), [file("b")]);

moveHome("new");
assert.equal(context.composerAttachmentDrafts.home, undefined, "first-send handoff consumes the home attachment draft once");
assert.deepEqual(plain(context.composerAttachmentDrafts["thread:new"]), [file("home")]);
assert.deepEqual(plain(context.composerAttachmentDrafts["thread:a"] ?? []), []);
assert.deepEqual(plain(context.composerAttachmentDrafts["thread:b"]), [file("b")]);

const sharedAttachment = { ...file("shared"), path: "D:/drafts/shared.txt", id: "d:/drafts/shared.txt", persisted: true };
context.composerAttachmentDrafts = {
  "thread:a": [sharedAttachment],
  "thread:b": [{ ...sharedAttachment, persisted: false }],
};
context.attachmentScopeRef.current = "thread:a";
context.attachedFiles = [sharedAttachment];
context.activeThreadId = "a";
context.setScopedAttachedFiles = setScoped;
context.setAttachedFiles = update => setScoped(context.attachmentScopeRef.current, update);
let finishRemoval;
context.removeThreadAttachment = (threadId, item) => {
  assert.equal(threadId, "a", "persisted removal targets the thread where it started");
  assert.equal(item.id, sharedAttachment.id);
  return new Promise(resolve => { finishRemoval = resolve; });
};
context.showAppToast = () => {};
const removeAttachment = evaluate(appDeclarations, "handleRemoveAttachedFile", context, true);
const pendingRemoval = removeAttachment(sharedAttachment.id);
context.attachmentScopeRef.current = "thread:b";
context.activeThreadId = "b";
finishRemoval();
await pendingRemoval;
assert.deepEqual(plain(context.composerAttachmentDrafts["thread:a"] ?? []), [], "completed removal clears its original scope");
assert.deepEqual(plain(context.composerAttachmentDrafts["thread:b"]), [{ ...sharedAttachment, persisted: false }],
  "a late persisted-removal response must not clear the newly active thread's same-path draft");

for (const scenario of ["edited", "left", "readded", "failure"]) {
  const sent = file("sent");
  const added = file("added");
  const replacement = { ...sent };
  context.composerAttachmentDrafts = { "thread:a": [sent] };
  context.attachmentScopeRef.current = "thread:a";
  context.activeThreadIdRef = { current: "a" };
  context.pendingAttachmentSaveRef = {
    current: { threadId: "a", clearComposer: true, prompt: "sent prompt", files: [sent] },
  };
  const prompts = { a: "sent prompt", b: "other prompt" };
  context.setThreadPrompt = (threadId, update) => { prompts[threadId] = update(prompts[threadId]); };
  const notices = [];
  context.showAppToast = (...args) => notices.push(args);
  let finishSave;
  context.persistThreadAttachments = (threadId, files) => {
    assert.equal(threadId, "a", "save must target the thread where the message was sent");
    assert.equal(files[0], sent, "save must use the sent snapshot");
    return new Promise(resolve => { finishSave = resolve; });
  };
  const flush = evaluate(appDeclarations, "flushPendingAttachmentSave", context, true);
  const pendingSave = flush("a");
  assert.equal(context.pendingAttachmentSaveRef.current, null, "the pending save is consumed once");
  if (scenario === "left") {
    context.attachmentScopeRef.current = "thread:b";
    context.activeThreadIdRef.current = "b";
    context.composerAttachmentDrafts["thread:b"] = [added];
  } else if (scenario === "readded") {
    setScoped("thread:a", [replacement]);
  } else {
    add("thread:a", added);
    prompts.a = "new prompt";
  }
  finishSave({ errors: scenario === "failure" ? [{ message: "fixture save denied" }] : [] });
  await pendingSave;
  if (scenario === "left") {
    assert.deepEqual(plain(context.composerAttachmentDrafts["thread:a"] ?? []), [],
      "sent snapshot must be cleared from the original thread even after navigation");
    assert.deepEqual(plain(context.composerAttachmentDrafts["thread:b"]), [added]);
    assert.equal(prompts.a, "");
    assert.equal(prompts.b, "other prompt");
  } else if (scenario === "readded") {
    assert.equal(context.composerAttachmentDrafts["thread:a"][0], replacement,
      "removing and readding the same path creates a new draft that a late save must preserve");
  } else {
    assert.deepEqual(plain(context.composerAttachmentDrafts["thread:a"] ?? []),
      scenario === "failure" ? [sent, added] : [added],
      "late save must preserve attachments added while persistence was pending");
    assert.equal(prompts.a, "new prompt");
    assert.equal(notices.length, scenario === "failure" ? 1 : 0);
  }
}

for (const scenario of ["added", "left", "failure", "unchanged"]) {
  context.composerAttachmentDrafts = {};
  context.attachmentScopeRef.current = "thread:a";
  let finishTurn;
  const view = mountProjectContext({
    threadId: "a",
    turn: () => new Promise((resolve, reject) => { finishTurn = scenario === "failure" ? reject : resolve; }),
  });
  const prompts = { a: "hello", b: "other prompt" };
  Object.assign(view.context, {
    attachmentScopeRef: context.attachmentScopeRef,
    setAttachedFiles: update => setScoped(context.attachmentScopeRef.current, update),
    setThreadPrompt: (threadId, update) => {
      prompts[threadId] = typeof update === "function" ? update(prompts[threadId]) : update;
    },
  });
  const pendingSend = view.send();
  assert.equal(typeof finishTurn, "function", "the production callback must reach turn/start");
  const added = file("after-send");
  if (scenario !== "unchanged") add("thread:a", added);
  if (scenario === "left") {
    view.context.threadRequestRef.current++;
    view.context.activeThreadIdRef.current = "b";
    context.attachmentScopeRef.current = "thread:b";
    add("thread:b", file("other"));
  }
  finishTurn(scenario === "failure" ? Error("fixture turn/start denied") : { turn: { id: "accepted" } });
  await pendingSend;
  const request = view.calls.find(([method]) => method === "turn/start")[1];
  assert.deepEqual(request.input, [{ type: "text", text: "hello" }],
    "a pending text-only request must not retroactively include a new attachment");
  assert.deepEqual(plain(context.composerAttachmentDrafts["thread:a"] ?? []),
    scenario === "unchanged" ? [] : [added],
    "text-only send completion must preserve attachments added after its empty snapshot");
  assert.equal(prompts.a, ["failure", "left"].includes(scenario) ? "hello" : "");
  assert.equal(view.calls.filter(([method]) => method === "turn/start").length, 1);
  assert.equal(view.calls.some(([method]) => method === "thread/start"), false);
  if (scenario === "left") {
    assert.deepEqual(plain(context.composerAttachmentDrafts["thread:b"]), [file("other")]);
    assert.equal(prompts.b, "other prompt");
  }
}

{
  const attachment = file("home-first-send");
  context.composerAttachmentDrafts = { home: [attachment] };
  context.attachmentScopeRef.current = "home";
  context.setScopedAttachedFiles = setScoped;
  context.setAttachedFiles = update => setScoped(context.attachmentScopeRef.current, update);
  const view = mountProjectContext({
    turn: () => { throw Error("fixture turn/start denied"); },
  });
  Object.assign(view.context, {
    attachedFiles: [attachment],
    attachmentScopeRef: context.attachmentScopeRef,
    setAttachedFiles: context.setAttachedFiles,
    moveHomeAttachmentsToThread: threadId => {
      moveHome(threadId);
      context.attachmentScopeRef.current = `thread:${threadId}`;
    },
  });

  await view.send();
  assert.deepEqual(plain(context.composerAttachmentDrafts.home ?? []), [],
    "first-send handoff consumes the home scope before turn/start");
  assert.deepEqual(plain(context.composerAttachmentDrafts["thread:created"]), [attachment],
    "failed first send retains the handed-off attachment on its created thread");
  assert.equal(view.calls.find(([method]) => method === "turn/start")[1].input[1].path, attachment.path,
    "first turn carries the handed-off attachment path");
  assert.equal(view.context.pendingAttachmentSaveRef.current, null,
    "a rejected turn must not leave a pending attachment save for a later turn");
}

console.log("PASS production text-only send callback: pending attachment addition, navigation, failure and unchanged completion preserve draft ownership (L2)");
console.log("PASS production attachment draft state: per-home/thread scope, removal race isolation, and one-time home-to-created-thread handoff (L2)");
console.log("PASS production attachment save callback: sent-snapshot cleanup, late edits, navigation, same-path readd and failure preservation (L2)");
console.log("PASS production first-send callback: failed home attachment handoff remains owned by the created thread (L2)");

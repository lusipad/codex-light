import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { mountProjectContext } from "./verify-new-thread-project-context.mjs";

const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 };
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/appshotContext.ts", "utf8"), { compilerOptions }).outputText, { exports });
const plain = value => JSON.parse(JSON.stringify(value));
const shot = { id: "capture-one", context: { appName: 'Editor "One"', bundleIdentifier: "private.editor", windowTitle: "Private window",
  axTree: "<private> & text", imagePath: null, imageName: "one.png", imageDataUrl: "data:image/png;base64,aGVsbG8=" } };
const inline = { id: "ordinary-image", kind: "image", name: "普通图片.png", path: "data:image/png;base64,b3JkaW5hcnk=", imageDataUrl: "data:image/png;base64,b3JkaW5hcnk=" };
const source = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name, context) {
  let node;
  function visit(value) {
    if (ts.isVariableDeclaration(value) && value.name.getText(source) === name) node = value.initializer.arguments[0];
    ts.forEachChild(value, visit);
  }
  visit(source);
  assert.ok(node, `production ${name} exists`);
  return vm.runInNewContext(ts.transpileModule(`(${node.getText(source)})`, { compilerOptions }).outputText, context);
}

for (const mode of ["start", "steer", "queue"]) {
  const view = mountProjectContext({ threadId: "thread-a" });
  const drafts = { "account:thread:thread-a": [shot] };
  const context = Object.assign(view.context, exports, {
    appshots: drafts["account:thread:thread-a"], appshotScope: "account:thread:thread-a", modelAccountIdentity: "account",
    composerAppshotDrafts: drafts,
    setComposerAppshotDrafts(update) { context.composerAppshotDrafts = update(context.composerAppshotDrafts); },
    queueMutationThreadsRef: { current: new Set() },
    setQueueMutationVersion() {}, refreshThreadQueue: async () => {},
  });
  context.executionIdentityRef.current = "account";
  context.attachedFiles = [inline];
  // The first assertion fails on the old production sender even with a valid capture context.
  context.setScopedAppshots = (key, update) => {
    const current = context.composerAppshotDrafts[key] ?? [];
    context.composerAppshotDrafts[key] = typeof update === "function" ? update(current) : update;
  };
  if (source.text.includes("const clearSentAppshots")) context.clearSentAppshots = callback("clearSentAppshots", context);
  if (source.text.includes("const moveHomeAppshotsToThread")) context.moveHomeAppshotsToThread = callback("moveHomeAppshotsToThread", context);
  const original = context.callAppServer;
  const sent = [];
  context.callAppServer = async (method, params) => {
    if (["turn/start", "turn/steer", "thread/queue/add"].includes(method)) {
      sent.push([method, plain(params)]);
      return method === "thread/queue/add" ? { queuedSubmission: { id: "queued" } } : method === "turn/steer" ? { turnId: "running-turn" } : { turn: { id: "accepted" } };
    }
    return original(method, params);
  };
  if (mode === "steer") { context.isStreaming = true; context.activeTurnIdRef.current = "running-turn"; }
  await (mode === "queue" ? callback("handleEnqueueFollowup", context)() : view.send());
  assert.equal(sent.length, 1, `${mode} reaches exactly one existing execution boundary`);
  assert.equal(sent[0][1].input[0].text, exports.buildAppshotPrompt("hello", [shot.context]), `${mode} sends escaped application context before the real prompt`);
  assert.deepEqual(sent[0][1].input.slice(1), [{ type: "image", url: inline.imageDataUrl }, { type: "image", url: shot.context.imageDataUrl }], `${mode} retains ordinary image before the real Appshot without inventing local filenames`);
  assert.equal("appshots" in sent[0][1] || "axTree" in sent[0][1], false, "no invented turn fields");
  assert.deepEqual(context.composerAppshotDrafts["account:thread:thread-a"] ?? [], [], `${mode} consumes only its confirmed snapshot`);
}

{
  const attachments = {}, calls = [];
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/threadAttachments.ts", "utf8"), { compilerOptions }).outputText, {
    exports: attachments,
    require: name => {
      assert.equal(name, "./bridge");
      return { callAppServer: async (method, params) => {
        calls.push([method, plain(params)]);
        return { attachment: { id: "registered", attachmentType: params.attachmentType, identityKey: params.identityKey,
          payload: params.payload, createdAt: 1 }, outcome: "created" };
      } };
    },
  });
  const localFile = { id: "local", name: "notes.txt", kind: "file", path: "D:/private/notes.txt" };
  const result = await attachments.persistThreadAttachments("thread-a", [inline, localFile]);
  assert.equal(calls.length, 1, "inline image URI never enters filesystem attachment registration");
  assert.equal(calls[0][1].payload.path, localFile.path, "real local files keep existing persistence");
  assert.equal(result.attachments[0], inline);
  assert.deepEqual(plain(result.errors), []);
}

{
  const textModule = {}, historyModule = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/threadText.ts", "utf8"), { compilerOptions }).outputText, { exports: textModule });
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/appshotHistory.ts", "utf8"), { compilerOptions }).outputText, {
    exports: historyModule, require: name => name === "./threadText" ? textModule : name === "./appshotContext" ? exports : assert.fail(name),
  });
  const input = [{ type: "text", text: exports.buildAppshotPrompt("Read this window", [shot.context]) },
    { type: "image", url: inline.imageDataUrl }, { type: "image", url: shot.context.imageDataUrl }];
  const restored = historyModule.restoreAppshotHistory({ type: "userMessage", content: input });
  assert.equal(restored.uncertain, false);
  let edit;
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.attributes.properties.some(property => ts.isJsxAttribute(property) && property.name.getText(source) === "title" && property.initializer?.text === "重新填入输入框编辑")) {
      edit = node.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText(source) === "onClick").initializer.expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(edit, "production edit-message handler exists");
  const state = {};
  let serial = 0;
  vm.runInNewContext(ts.transpileModule(`(${edit.getText(source)})`, { compilerOptions }).outputText, {
    userText: restored.text, userAppshots: restored.appshots, userImages: restored.nonAppshotImageUrls,
    appshotScope: "fixture-account:thread:thread-a", crypto: { randomUUID: () => `restored-${++serial}` },
    setPromptInput: value => { state.prompt = value; },
    retireAppshotCapture: scope => { state.retiredScope = scope; },
    setScopedAppshots: (_scope, value) => { state.appshots = value; },
    setAttachedFiles: value => { state.files = value; },
    createAttachedFileItem() { assert.fail("an inline URI must never be turned into a local file"); },
    composerTextareaRef: { current: { focus() {} } }, showAppToast() {},
  })();
  const view = mountProjectContext({ threadId: "thread-a" });
  Object.assign(view.context, { promptInput: state.prompt, attachedFiles: state.files, appshots: state.appshots });
  await view.send();
  const sent = view.calls.find(([method]) => method === "turn/start");
  assert.deepEqual(sent[1].input, input, "actual history → edit handler → sender retains ordinary image, Appshot image, AX and visible prompt");
}

for (const scenario of ["failure", "unknown", "added", "account-changed"]) {
  let finish;
  const view = mountProjectContext({ threadId: "thread-a", turn: () => new Promise((resolve, reject) => {
    finish = scenario === "failure" ? reject : resolve;
  }) });
  const scope = "fixture-account:thread:thread-a";
  const context = Object.assign(view.context, { appshots: [shot], appshotScope: scope,
    composerAppshotDrafts: { [scope]: [shot] },
    setComposerAppshotDrafts(update) { context.composerAppshotDrafts = update(context.composerAppshotDrafts); },
  });
  context.setScopedAppshots = callback("setScopedAppshots", context);
  context.clearSentAppshots = callback("clearSentAppshots", context);
  const pending = view.send();
  for (let step = 0; step < 40 && !finish; step++) await Promise.resolve();
  assert.equal(typeof finish, "function", "production turn request reached the declared boundary");
  const added = { ...shot, id: "after-request" };
  if (scenario === "added") context.setScopedAppshots(scope, items => [...items, added]);
  if (scenario === "account-changed") context.executionIdentityRef.current = "another-account";
  finish(scenario === "failure" ? Error("private fixture rejected") : scenario === "unknown" ? {} : { turn: { id: "accepted-old-account" } });
  await pending;
  assert.deepEqual(plain(context.composerAppshotDrafts[scope] ?? []), scenario === "added" ? [added] : [shot],
    "failed/unknown/foreign-account confirmation retains the snapshot; success keeps newer additions");
  if (scenario === "account-changed") assert.notEqual(view.state.activeTurnId, "accepted-old-account", "late old-account ACK cannot replace the new account's active turn");
}

for (const response of [{}, null, { turnId: "another-turn" }, { turn: { id: "running-turn" } }]) {
  const view = mountProjectContext({ threadId: "thread-a" });
  const scope = "fixture-account:thread:thread-a";
  const context = Object.assign(view.context, { appshots: [shot], appshotScope: scope,
    composerAppshotDrafts: { [scope]: [shot] },
    setComposerAppshotDrafts(update) { context.composerAppshotDrafts = update(context.composerAppshotDrafts); },
  });
  context.setScopedAppshots = callback("setScopedAppshots", context);
  context.clearSentAppshots = callback("clearSentAppshots", context);
  context.isStreaming = true;
  context.activeTurnIdRef.current = "running-turn";
  context.attachedFiles = [inline];
  view.state.attachedFiles = [inline];
  const requests = [];
  context.callAppServer = async (method, params) => { requests.push([method, params]); return response; };
  assert.notEqual(await view.send(), true, "unknown or mismatched Steer acknowledgement cannot report accepted");
  assert.equal(requests.length, 1, "unconfirmed Steer is never automatically resent or replaced by a new turn");
  assert.equal(requests[0][0], "turn/steer");
  assert.equal(view.state.promptInput, "hello", "unconfirmed Steer retains the prompt");
  assert.deepEqual(plain(context.composerAppshotDrafts[scope]), [shot], "unconfirmed Steer retains the Appshot");
  assert.deepEqual(plain(view.state.attachedFiles), [inline], "unconfirmed Steer retains ordinary attachments");
  assert.ok(view.calls.some(([method, message]) => method === "toast" && message.includes("结果未确认")), "unconfirmed Steer is visible to the user");
}

for (const mode of ["steer", "queue"]) {
  const view = mountProjectContext({ threadId: "thread-a" });
  const scope = "fixture-account:thread:thread-a";
  const context = Object.assign(view.context, { appshots: [shot], appshotScope: scope,
    composerAppshotDrafts: { [scope]: [shot] }, queueMutationThreadsRef: { current: new Set() },
    setQueueMutationVersion() {}, refreshThreadQueue: async () => {},
    setComposerAppshotDrafts(update) { context.composerAppshotDrafts = update(context.composerAppshotDrafts); },
  });
  context.setScopedAppshots = callback("setScopedAppshots", context);
  context.clearSentAppshots = callback("clearSentAppshots", context);
  let finish;
  context.callAppServer = async () => new Promise(resolve => { finish = resolve; });
  if (mode === "steer") { context.isStreaming = true; context.activeTurnIdRef.current = "running-turn"; }
  const operation = mode === "steer" ? view.send() : callback("handleEnqueueFollowup", context)();
  for (let step = 0; step < 40 && !finish; step++) await Promise.resolve();
  assert.equal(typeof finish, "function");
  context.executionIdentityRef.current = "another-account";
  finish(mode === "queue" ? { queuedSubmission: { id: "late-queue" } } : {});
  await operation;
  assert.deepEqual(plain(context.composerAppshotDrafts[scope] ?? []), [shot], `${mode} late ACK cannot consume an old-account draft`);
  assert.equal(view.state.promptInput, "hello", `${mode} late ACK cannot clear the newly selected account's prompt`);
}

{
  const other = { ...shot, id: "newer-capture" };
  const context = { modelAccountIdentity: "account-a", composerAppshotDrafts: {
    "account-a:home": [shot], "account-a:thread:target": [other], "account-b:home": [other],
  } };
  context.setComposerAppshotDrafts = update => { context.composerAppshotDrafts = update(context.composerAppshotDrafts); };
  context.setScopedAppshots = callback("setScopedAppshots", context);
  const move = callback("moveHomeAppshotsToThread", context);
  move("target"); move("target");
  assert.deepEqual(plain(context.composerAppshotDrafts["account-a:thread:target"]), [other, shot], "home handoff happens once and retains the existing target draft");
  assert.equal(context.composerAppshotDrafts["account-a:home"], undefined);
  assert.deepEqual(plain(context.composerAppshotDrafts["account-b:home"]), [other], "another account's home capture is untouched");
  context.appshotCaptureGenerations = { current: {} };
  context.setAppshotCaptureRevision = () => {};
  context.retireAppshotCapture = callback("retireAppshotCapture", context);
  const clear = callback("clearSentAppshots", context);
  const replacement = { ...shot };
  context.setScopedAppshots("account-a:thread:target", current => [...current, replacement]);
  clear("account-a:thread:target", [shot], 0);
  assert.deepEqual(plain(context.composerAppshotDrafts["account-a:thread:target"]), [other, replacement], "late confirmation does not discard a newly added or same-ID reattached capture");
  clear("account-a:thread:target", [shot], 0);
  assert.deepEqual(plain(context.composerAppshotDrafts["account-a:thread:target"]), [other, replacement], "duplicate confirmation does not consume new data");
  assert.equal(context.appshotCaptureGenerations.current["account-a:thread:target"], 1, "duplicate ACK cannot retire a newer draft generation");
  clear("account-a:thread:target", [], 0);
  assert.equal(context.appshotCaptureGenerations.current["account-a:thread:target"], 1, "late ACK of the old generation preserves replacements");
  clear("account-a:thread:target", [], 1);
  assert.equal(context.appshotCaptureGenerations.current["account-a:thread:target"], 2, "confirmed empty snapshot still retires pending capture");
  const beforeAck = { id: "completed-after-send", context: shot.context, capture: { scope: "account-a:thread:target", generation: 2 } };
  const newerDraft = { id: "new-generation", context: shot.context, capture: { scope: "account-a:thread:target", generation: 3 } };
  const migratedScope = { id: "different-origin", context: shot.context, capture: { scope: "account-a:home", generation: 2 } };
  context.setScopedAppshots("account-a:thread:target", [beforeAck, newerDraft, migratedScope]);
  clear("account-a:thread:target", [], 2);
  assert.deepEqual(plain(context.composerAppshotDrafts["account-a:thread:target"]), [newerDraft, migratedScope],
    "capture completed between send and ACK must leave with its original generation, preserving other generations and origins");
}
console.log("PASS: real start/steer/queue callbacks preserve Appshot text/image inputs and consume confirmed draft snapshots");

{
  let handlers;
  function visit(node) {
    if (ts.isBinaryExpression(node) && node.left.getText(source) === "shortcutHandlersRef.current" && ts.isObjectLiteralExpression(node.right)) handlers = node.right;
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(handlers);
  for (const open of [false, true]) for (const command of ["zoom-in", "zoom-out", "zoom-reset"]) {
    const calls = [], applied = [];
    const context = { dispatchImagePreviewZoom: value => { calls.push(plain(value)); return open; },
      applyZoom: value => applied.push(value), zoomRef: { current: 1.2 } };
    const action = handlers.properties.find(property => property.name?.text === command).initializer;
    vm.runInNewContext(ts.transpileModule(`(${action.getText(source)})`, { compilerOptions }).outputText, context)();
    assert.deepEqual(calls, [command === "zoom-reset" ? { type: "reset-zoom" } : { type: "step-zoom", delta: command === "zoom-in" ? 1 : -1 }]);
    assert.deepEqual(applied, open ? [] : [command === "zoom-reset" ? 1 : 1.2 + (command === "zoom-in" ? 0.1 : -0.1)],
      "image preview consumes zoom; a closed preview retains ordinary App zoom");
    calls.length = 0; applied.length = 0;
    Object.assign(context, { keyboardState: { capturing: { current: false } }, shortcutHandlersRef: { current: {} }, projectMoveConfirmation: null });
    await callback("handleAppCommand", context)(command);
    assert.equal(calls.length, 1, "native menu fallback also delegates to the owning preview");
    assert.equal(applied.length, open ? 0 : 1, "native commands preserve the same preview-versus-App boundary");
  }
}
console.log("PASS: image preview zoom commands do not change application zoom while a preview owns the command");

{
  let keyHandler;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "onKeyDown" && node.initializer?.getText(source).includes("matcher.reset()")) keyHandler = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source); assert.ok(keyHandler, "actual global keydown entry exists");
  const shortcuts = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/shortcuts.ts", "utf8"), { compilerOptions }).outputText, { exports: shortcuts });
  for (const [key, expected] of [["=", { type: "step-zoom", delta: 1 }], ["-", { type: "step-zoom", delta: -1 }], ["0", { type: "reset-zoom" }]]) {
    for (const open of [false, true]) for (const composing of [false, true]) {
      const calls = []; let prevented = 0;
      const handler = vm.runInNewContext(ts.transpileModule(`(${keyHandler.getText(source)})`, { compilerOptions }).outputText, {
        keyboardState: { capturing: { current: false } }, focusedElement: null,
        document: { querySelector: () => ({}) }, matcher: { reset() {} }, SHORTCUTS: shortcuts.SHORTCUTS,
        dispatchImagePreviewZoom(command) { calls.push(plain(command)); return open; },
      });
      handler({ key, ctrlKey: true, altKey: false, metaKey: false, shiftKey: false, isComposing: composing,
        preventDefault() { prevented++; }, target: {} });
      assert.deepEqual(calls, composing ? [] : [expected], "modal keydown routes zoom to the real preview owner");
      assert.equal(prevented, !composing && open ? 1 : 0, "unrelated modal and IME behavior remain unchanged");
    }
  }
}
console.log("PASS: actual modal keydown dispatch reaches preview zoom without bypassing IME or unrelated modal guards");

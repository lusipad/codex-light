import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const ast = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = []; const visit = node => { nodes.push(node); ts.forEachChild(node, visit); }; visit(ast);
const variable = name => nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name)?.initializer;
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const evaluate = (node, context) => { assert.ok(node, "actual App expression exists"); return vm.runInNewContext(compile(`(${node.getText(ast)})`), context); };
const callback = (name, context) => evaluate(variable(name)?.arguments[0], context);
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };
const identity = { accountId: "chat-account", userId: "chat-user", generation: 7 };
const selection = { slug: "chat", thinkingEffort: null, versionId: "latest" };
function pure(file) {
  const exports = {};
  vm.runInNewContext(compile(fs.readFileSync(`src/${file}.ts`, "utf8")), { exports, URL, require: name => {
    if (name === "./workRunLocation") return pure("workRunLocation");
    assert.equal(name, "./chatgptService"); return { readChatgptService: () => assert.fail("pure catalog must not perform HTTP") };
  } }); return exports;
}
const catalogApi = pure("workModelCatalog"), routeApi = pure("chatgptRoutes");
function actualConversation(f) {
  const modules = new Map(), requests = []; let id = 0;
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    vm.runInNewContext(compile(fs.readFileSync(`src/${file}.ts`, "utf8")), { exports, Date, AbortController,
      crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}` },
      require: name => {
        if (name === "react") return {};
        if (name === "./chatgptTextClient") return { submitChatgptText: input => { const done = deferred(); requests.push({ input, done }); return done.promise; }, stopChatgptText: async () => {} };
        assert.ok(["./chatgptMessages", "./chatgptStreamState"].includes(name), `controlled controller dependency ${name}`);
        return load(name.slice(2));
      } }); return exports;
  }
  const controller = load("useChatgptTextConversation").createChatgptTextConversationController(() => ({ identity,
    ownerKey: '["owner","host"]', onOptimisticStart: f.context.navigateOptimisticChat,
    onAccepted: f.context.acceptChatPrompt, onRestore: f.context.restoreChatPrompt }));
  const sync = () => Object.assign(f.context.chatConversation, controller.getStateSnapshot(), { send: controller.send,
    stop: controller.stop, open: controller.open, newConversation: controller.newConversation });
  controller.subscribe(sync); sync(); return { controller, requests };
}
function fixture() {
  const calls = [], paths = [], notices = [], state = { home: "source draft", drafts: {}, entry: null, route: "home" };
  const catalog = { defaultModelSlug: "chat", modelConfigBySlug: { chat: { isWorkModeModel: false }, wm: { isWorkModeModel: true } },
    options: [{ slug: "chat", thinkingEffort: null }, { slug: "wm", thinkingEffort: null }], internalOptions: [], chatAlphaOptions: [], categories: [],
    versionOptions: [{ id: "latest", slugs: ["chat", "wm"], options: [{ slug: "chat", thinkingEffort: null }, { slug: "wm", thinkingEffort: null }], modelSlugByLane: {} }],
    sliderSettings: [], defaultThinkingEffortByModelSlug: {}, disabledVersionSlugs: [] };
  const target = { status: "ready", identity, location: "local", selectedChatGptProjectId: null, orchestration: { accountInfo: { plan: "plus" } } };
  const controls = { prepare: null, stream: null, optimistic: true, ready: { status: "ready", identity, target, catalog, selection, isWorkModel: false } };
  const location = { pathname: "/", search: "", href: "https://app.test/" };
  const context = { ...catalogApi, ...routeApi, AbortController, Intl, Date, Object,
    window: { location, history: { state: { source: true }, replaceState: (_state, _title, path) => {
      paths.push(path); const url = new URL(path, "https://app.test"); Object.assign(location, { pathname: url.pathname, search: url.search, href: url.href });
    } } },
    modelAccountIdentity: "owner", workHostIdentity: "host", committedWorkOwner: { current: "owner" }, committedWorkHost: { current: "host" },
    activeRoute: "home", activeRouteRef: { current: "home" }, activeThreadId: null, activeThreadIdRef: { current: null },
    threadRequestRef: { current: 2 }, navigationRequestRef: { current: 4 }, homePromptRevisionRef: { current: 5 },
    chatStart: { current: null }, chatSubmission: { current: new Map() }, chatDrafts: state.drafts,
    chatDraftValues: { current: state.drafts }, chatDraftRevisions: { current: new Map() },
    chatPreparing: { current: false }, chatPreparationTicket: { current: 0 }, chatPreparingState: false,
    promptInput: state.home, attachedFiles: [], appshots: [], workHomeSession: { key: "home-key", target, owner: "owner" },
    workHomeModels: { selection, loading: false, pending: false, isWorkModel: false }, chatEntry: null,
    appServerStatus: { connected: true, appServerVersion: "0.165.0" },
    homeCloud: { active: false }, workHomeModelCommitting: { current: false }, workModelCommitting: { current: new Map() },
    workHomePickerRef: { current: { isWorkModel: false } },
    setChatDrafts: update => { state.drafts = typeof update === "function" ? update(state.drafts) : update; context.chatDrafts = state.drafts; },
    setPromptDrafts: update => { const drafts = typeof update === "function" ? update({ home: state.home }) : update; state.home = drafts.home ?? ""; context.promptInput = state.home; },
    setChatEntry: entry => { state.entry = entry; context.chatEntry = entry; },
    setChatPreparingState: value => { context.chatPreparingState = value; },
    setActiveThreadId: value => { context.activeThreadId = value; },
    setActiveRoute: route => { calls.push(["route", route]); state.route = route; context.activeRoute = route; context.activeRouteRef.current = route; },
    commitActiveRoute: route => { calls.push(["routeCommit", route]); state.route = route; context.activeRoute = route; },
    personalizationNavigationGuardRef: { current: null },
    serviceErrorMessage: error => error?.message ?? String(error), showAppToast: (...args) => notices.push(args),
    readWorkHomeModelPreparation: async (...args) => { calls.push(["prepare", args[0]]); return controls.prepare ? controls.prepare.promise : controls.ready; },
    readWorkModelCatalog: async owner => { calls.push(["catalog", owner]); return catalog; },
    callAppServer: async (...args) => { calls.push(["CLI", ...args]); throw Error("Chat must not reach CLI"); },
    tauriInvoke: async (...args) => { calls.push(["native", ...args]); throw Error("Chat must not reach native thread action"); },
    chatConversation: { conversation: null, conversations: [], newConversation: () => { calls.push(["newChat"]); },
      send: input => { calls.push(["chatSend", plain(input)]); if (controls.optimistic) context.navigateOptimisticChat("local-chatgpt:client"); return controls.stream?.promise ?? Promise.resolve(true); },
      stop: async () => { calls.push(["chatStop"]); }, open: id => { calls.push(["chatOpen", id]); return id === "known-chat"; },
      selectModel: value => { calls.push(["chatModel", value]); return true; } },
  };
  for (const name of ["setThreadPrompt", "writeChatDraft", "acceptChatPrompt", "restoreChatPrompt", "navigateOptimisticChat", "handleSendChatgptText", "handleSendMessage", "handleInterruptTurn", "handleTogglePlanMode"])
    context[name] = callback(name, context);
  return { context, state, calls, paths, notices, controls, target, catalog, location,
    cli: () => calls.filter(([kind]) => kind === "CLI" || kind === "native"), sends: () => calls.filter(([kind]) => kind === "chatSend") };
}
const groups = [], test = (name, run) => groups.push([name, run]);

test("home non-Work goes through actual Chat preparation and optimistic project route, never CLI", async () => {
  for (const project of [null, "g-p/project"]) {
    const f = fixture(); f.target.selectedChatGptProjectId = project; await f.context.handleSendMessage();
    assert.equal(f.sends().length, 1); assert.equal(f.cli().length, 0); assert.equal(f.calls[0][0], "prepare");
    assert.equal(f.sends()[0][1].selection.slug, "chat"); assert.equal(f.sends()[0][1].projectId, project);
    assert.equal(f.paths[0], routeApi.chatgptConversationPath({ id: "local-chatgpt:client", projectId: project, temporary: false }));
    assert.equal(f.context.activeThreadIdRef.current, null); assert.equal(f.state.route, "chatgpt-thread");
    assert.equal(f.state.home, "source draft", "optimistic insertion is not HTTP acceptance and cannot clear source draft");
  }
});

test("actual preflight rejects unavailable/Work/changed selection and late owner/host without dispatch", async () => {
  for (const mode of ["not-ready", "work", "changed", "owner", "host", "attachment"]) {
    const f = fixture();
    if (mode === "not-ready") f.controls.ready.status = "not-ready";
    if (mode === "work") f.controls.ready.isWorkModel = true;
    if (mode === "changed") f.controls.ready.selection = { ...selection, slug: "unavailable" };
    if (mode === "attachment") f.context.attachedFiles = [{}];
    if (mode === "owner" || mode === "host") {
      f.controls.prepare = deferred(); const sending = f.context.handleSendMessage(); await flush();
      f.context[mode === "owner" ? "committedWorkOwner" : "committedWorkHost"].current = "retired";
      f.controls.prepare.resolve(f.controls.ready); await sending;
    } else await f.context.handleSendMessage();
    assert.equal(f.sends().length, 0, mode); assert.equal(f.cli().length, 0, mode); assert.equal(f.state.home, "source draft"); assert.equal(f.paths.length, 0);
  }
  const equivalent = fixture(); equivalent.controls.ready.selection = { versionId: "latest", thinkingEffort: null, slug: "chat" };
  await equivalent.context.handleSendMessage(); assert.equal(equivalent.sends().length, 1, "selection property order is not model identity");
});

test("late navigation cannot be stolen and prepare lock is released before full response stream", async () => {
  const f = fixture(); f.controls.prepare = deferred(); const sending = f.context.handleSendMessage(); await flush();
  f.context.navigationRequestRef.current++; f.location.pathname = "/settings"; f.context.activeRouteRef.current = "settings";
  f.controls.prepare.resolve(f.controls.ready); await sending;
  assert.equal(f.paths.length, 0); assert.equal(f.state.route, "home"); assert.equal(f.cli().length, 0);
  const pending = fixture(); pending.controls.stream = deferred(); const first = pending.context.handleSendMessage(); await flush();
  assert.equal(pending.sends().length, 1); assert.equal(pending.context.chatPreparing.current, false, "prepare lifetime must not cover the whole SSE stream");
  pending.controls.stream.resolve(true); await first;
});

test("per-client/home accept and restore require owner plus unchanged revisions, including ABA", async () => {
  const f = fixture(); await f.context.handleSendMessage(); const id = "local-chatgpt:client";
  f.context.acceptChatPrompt("source draft", id); assert.equal(f.state.home, ""); assert.equal(f.state.drafts[id], "");
  f.context.restoreChatPrompt("source draft", id); assert.equal(f.state.home, "source draft"); assert.equal(f.state.drafts[id], "source draft");
  for (const mode of ["accept-aba", "restore-aba", "owner"]) {
    const h = fixture(); await h.context.handleSendMessage();
    if (mode === "accept-aba") { h.context.writeChatDraft(id, "new"); h.context.writeChatDraft(id, "source draft"); h.context.setThreadPrompt(null, "new"); h.context.setThreadPrompt(null, "source draft"); h.context.acceptChatPrompt("source draft", id); }
    if (mode === "restore-aba") { h.context.acceptChatPrompt("source draft", id); h.context.writeChatDraft(id, "new"); h.context.writeChatDraft(id, ""); h.context.setThreadPrompt(null, "new"); h.context.setThreadPrompt(null, ""); h.context.restoreChatPrompt("source draft", id); }
    if (mode === "owner") { h.context.committedWorkOwner.current = "retired"; h.context.acceptChatPrompt("source draft", id); }
    assert.equal(h.state.drafts[id], mode === "restore-aba" ? "" : "source draft", mode);
    assert.equal(h.state.home, mode === "restore-aba" ? "" : "source draft", mode);
  }
  const isolated = fixture(); await isolated.context.handleSendMessage(); isolated.context.writeChatDraft("other-client", "other draft");
  isolated.context.acceptChatPrompt("source draft", id); assert.equal(isolated.state.drafts["other-client"], "other draft");
});

test("late home preparation cannot replace the already-open different Chat conversation", async () => {
  const f = fixture(), { controller, requests } = actualConversation(f);
  f.context.chatStart.current = { owner: "owner", prompt: "existing conversation", navigation: f.context.navigationRequestRef.current,
    location: "/", homeRevision: null, draftRevision: null, projectId: null };
  const previous = controller.send({ prompt: "existing conversation", selection }); await flush();
  const previousId = controller.getSnapshot().clientId;
  f.context.setActiveRoute("home"); f.context.navigationRequestRef.current++; f.location.pathname = "/"; f.location.search = "";
  f.controls.prepare = deferred(); const sending = f.context.handleSendMessage(); await flush();
  f.context.navigationRequestRef.current++; f.context.activeRoute = "chatgpt-thread"; f.context.activeRouteRef.current = "chatgpt-thread";
  f.location.pathname = routeApi.chatgptConversationPath({ id: previousId, projectId: null, temporary: false });
  controller.open(previousId);
  f.controls.prepare.resolve(f.controls.ready); await flush();
  const effect = nodes.find(node => ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect"
    && node.arguments[0]?.getText(ast).includes("conversation.serverId ?? conversation.clientId"));
  evaluate(effect.arguments[0], f.context)();
  const actualId = controller.getSnapshot()?.clientId, actualPath = f.location.pathname;
  const records = controller.getConversations();
  for (const request of requests) request.done.resolve({ status: "transport-complete" });
  await previous; await sending;
  assert.equal(actualId, previousId, "old home send may run in background but cannot change the selected conversation");
  assert.equal(actualPath, routeApi.chatgptConversationPath({ id: previousId, projectId: null, temporary: false }), "server-id projection must not indirectly steal the newer Chat route");
  assert.equal(requests.length, 2, "declining late navigation must not silently discard the authorized new Chat send");
  assert.equal(records.length, 2); assert.equal(records.find(record => record.clientId !== previousId)?.messages[0].text, "source draft");
  assert.equal(requests[1].input.body.conversation_id, undefined); assert.equal(requests[1].input.body.parent_message_id, "client-created-root");
});

test("actual Home Composer enables ready Chat independently of native Work preparation", async () => {
  const f = fixture(), home = nodes.find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "ComposerBox"
    && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "variant" && attribute.initializer?.text === "home"));
  assert.ok(home, "real Home Composer exists");
  const attribute = name => home.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(ast) === name)?.initializer?.expression;
  Object.assign(f.context, { workMessagePreparation: null, queueBusy: true, modelSelection: { selectionPending: true, selectionDisabledReason: "ordinary native only" },
    sendStartPendingRef: { current: new Set() } });
  assert.equal(evaluate(attribute("chatgptMode"), f.context), true);
  assert.equal(evaluate(attribute("submissionDisabled"), f.context), false, "ready Chat does not require Work native preparation or native model readiness");
  assert.equal(evaluate(attribute("onSendMessage"), f.context), f.context.handleSendMessage);
  f.context.workHomeModels.error = "actual chat model error"; assert.equal(evaluate(attribute("selectionError"), f.context), "actual chat model error");
  for (const block of ["loading", "pending", "preparing", "unknown", "disconnected"]) {
    const h = fixture(); Object.assign(h.context, { workMessagePreparation: null, queueBusy: false, modelSelection: {}, sendStartPendingRef: { current: new Set() } });
    if (block === "loading" || block === "pending") h.context.workHomeModels[block] = true;
    if (block === "preparing") h.context.chatPreparingState = true;
    if (block === "unknown") h.context.workHomeModels.isWorkModel = null;
    if (block === "disconnected") h.context.appServerStatus.connected = false;
    assert.equal(evaluate(attribute("submissionDisabled"), h.context), true, block);
  }
});

test("actual Chat sidebar and Composer handlers stay separate from native thread actions", async () => {
  const f = fixture(); f.context.activeRouteRef.current = "chatgpt-thread"; f.context.activeRoute = "chatgpt-thread";
  f.context.chatConversation.conversation = { clientId: "known-chat", model: selection, projectId: null, pending: false, deliveryUnknown: false };
  f.context.chatEntry = { identity, owner: "owner", catalog: f.catalog, plan: "plus" };
  f.context.writeChatDraft("known-chat", "followup");
  const open = evaluate(variable("openChatgptConversation"), f.context); open("missing"); assert.equal(f.state.route, "home");
  open("known-chat"); assert.equal(f.state.route, "chatgpt-thread");
  Object.assign(f.context, { React: { createElement: (type, props) => ({ type, props }) }, ComposerBox: "ComposerBox", composerEnterBehavior: "enter", followUpMode: "queue", keyboardState: { bindings: {} } });
  const composer = evaluate(variable("renderChatgptComposer"), f.context)();
  assert.equal(composer.props.chatgptMode, true); composer.props.onPromptInputChange("updated followup");
  assert.equal(f.state.drafts["known-chat"], "updated followup");
  composer.props.onQueueMessage(); assert.equal(f.sends().length, 0, "unsupported Chat queue must not pretend to submit a normal turn");
  assert.equal(f.state.drafts["known-chat"], "updated followup");
  assert.equal(await composer.props.workModelPicker.onCommit({ slug: "wm", thinkingEffort: null }), false);
  assert.equal(await composer.props.workModelPicker.onCommit(selection), true);
  assert.equal(f.calls.filter(([kind]) => kind === "chatModel").length, 1);
  await f.context.handleSendMessage(); assert.equal(f.sends().length, 1); assert.equal(f.sends()[0][1].prompt, "updated followup");
  await f.context.handleInterruptTurn(); assert.equal(f.calls.filter(([kind]) => kind === "chatStop").length, 1); assert.equal(f.cli().length, 0);
  const sidebar = nodes.find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "CodexSidebar");
  const attribute = name => sidebar.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(ast) === name)?.initializer?.expression;
  assert.equal(evaluate(attribute("onOpenChatgptConversation"), { openChatgptConversation: open }), open);
});

test("actual sidebar navigation guard defers every mutation and retires stale approvals", async () => {
  for (const mode of ["cancel", "approve", "owner", "host", "navigation", "location"]) {
    const f = fixture(); let pending, asked = 0;
    f.context.activeRouteRef.current = "settings"; f.context.activeRoute = "settings"; f.state.route = "settings";
    f.context.activeThreadIdRef.current = "native-before"; f.context.activeThreadId = "native-before";
    f.context.personalizationNavigationGuardRef.current = action => { asked++; pending = action; return false; };
    const open = evaluate(variable("openChatgptConversation"), f.context); open("known-chat");
    assert.equal(asked, 1); assert.equal(f.calls.filter(([kind]) => kind === "chatOpen").length, 0);
    assert.equal(f.context.activeThreadIdRef.current, "native-before"); assert.equal(f.context.threadRequestRef.current, 2); assert.equal(f.state.route, "settings");
    if (mode === "cancel") continue;
    if (mode === "owner") f.context.committedWorkOwner.current = "retired";
    if (mode === "host") f.context.committedWorkHost.current = "retired";
    if (mode === "navigation") f.context.navigationRequestRef.current++;
    if (mode === "location") f.location.href = "https://app.test/other";
    pending(); pending();
    assert.equal(asked, 1, "approval must not ask the same guard again");
    if (mode === "approve") {
      assert.equal(f.calls.filter(([kind]) => kind === "chatOpen").length, 1); assert.equal(f.state.route, "chatgpt-thread");
      assert.equal(f.context.activeThreadIdRef.current, null); assert.equal(f.context.threadRequestRef.current, 3);
    } else {
      assert.equal(f.calls.filter(([kind]) => kind === "chatOpen").length, 0, mode); assert.equal(f.state.route, "settings");
      assert.equal(f.context.activeThreadIdRef.current, "native-before"); assert.equal(f.context.threadRequestRef.current, 2);
    }
  }
});

test("Chat route directly fences native Plan, queue, steering and review entrypoints", async () => {
  const leaks = [];
  for (const [name, args] of [["handleTogglePlanMode", []], ["handleSteerTurn", ["native followup"]], ["handleStartServerQueue", []],
    ["handleEnqueueFollowup", []], ["handleCancelQueuedFollowup", [{ id: "queue-item" }]], ["handleStartCodeReview", [{ kind: "uncommitted" }]]]) {
    const f = fixture(); Object.assign(f.context, { activeRouteRef: { current: "chatgpt-thread" }, activeThreadId: "stale-native", activeThreadIdRef: { current: "stale-native" },
      activeTurnIdRef: { current: "stale-turn" }, followupQueue: [{ id: "queue-item", text: "native followup" }],
      queueMutationThreadsRef: { current: new Set() }, steeredQueueItemsRef: { current: new Map() }, threadRequestRef: { current: 1 },
      executionIdentityRef: { current: "owner" }, reviewStartPendingRef: { current: false }, activeWorkspace: { path: "C:/native" },
      workPermissionRevision: { current: 3 }, planModeRef: { current: false },
      setPlanMode: () => assert.fail("Chat route mutated native Plan"), applyCollaborationMode: () => assert.fail("Chat route wrote native mode"),
      setQueueMutationVersion() {}, readWorkThreadProvenance: async () => null, workThreadContexts: { current: new Map() }, threadsRef: { current: [] },
      isCurrentThreadRequest: () => true, setQueueNotice() {}, setFollowupQueue() {}, setReviewBusy() {}, setPromptInput() {}, setAttachedFiles() {},
      appshotCaptureGenerations: { current: {} }, appshotScope: "native", reviewContextRef: { current: { cwd: "C:/native", route: "chatgpt-thread" } },
      isStreaming: false, workspaceHintsRef: { current: { "stale-native": "C:/native" } }, attachmentIdentityKey: value => value,
      getModelConfiguration: () => ({ model: "native-model", reasoningEffort: null, serviceTier: null }),
      resolveExecutionContext: async () => ({ config: {}, policy: { approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly", networkAccess: false }, sandbox: "read-only" } }),
      persistThreadAttachments: async () => ({ errors: [] }), buildAppshotPrompt: text => text, appshotImageInputs: () => [],
      crypto: { randomUUID: () => "native-message" }, buildQuickReviewPrompt: text => text,
      threadExecutionPoliciesRef: { current: new Map([["stale-native", { approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly", networkAccess: false } }]]) },
      selectThread: async id => { f.calls.push(["native", "selectThread", id]); f.context.reviewContextRef.current = { cwd: "C:/native", route: "thread" }; },
      permissionMode: "custom", reviewResultsRef: { current: { begin: () => "review-attempt", startUnconfirmed() {} } },
    });
    await callback(name, f.context)(...args);
    if (f.cli().length) leaks.push([name, f.cli().map(call => call[1])]);
    assert.equal(f.context.workPermissionRevision.current, 3);
  }
  assert.deepEqual(leaks, [], "a retained native id is never a Chat execution target");
});

let failures = 0;
for (const [name, run] of groups) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack}`); }
}
console.log(`ChatGPT actual App AST/VM: ${groups.length - failures}/${groups.length} groups; controlled service/controller boundaries, no DOM/native GUI/HTTP/model claimed.`);
process.exitCode = failures ? 1 : 0;

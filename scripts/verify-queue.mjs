import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import crypto from "node:crypto";

const timelineJs = ts.transpileModule(fs.readFileSync(new URL("../src/threadTimeline.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { isCurrentThreadRequest } = await import(`data:text/javascript;base64,${Buffer.from(timelineJs).toString("base64")}`);
const appshotJs = ts.transpileModule(fs.readFileSync(new URL("../src/appshotContext.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { buildAppshotPrompt, appshotImageInputs } = await import(`data:text/javascript;base64,${Buffer.from(appshotJs).toString("base64")}`);

const source = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callback = name => {
  let found;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(found, name);
  return ts.transpileModule(`(${found})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
};
const until = async predicate => {
  for (let index = 0; index < 40 && !predicate(); index++) await Promise.resolve();
  assert.ok(predicate(), "production asynchronous queue stage must actually be reached");
};
let queue = [], draft = "hello", toasts = [], calls = [], rpc;
const appshotClears = [];
const ctx = vm.createContext({
  console, Date, Set, Map, crypto, isCurrentThreadRequest, buildAppshotPrompt, appshotImageInputs,
  executionIdentityRef: { current: "account-a" }, appshots: [], appshotScope: "account-a:thread:a",
  appshotCaptureGenerations: { current: {} },
  clearSentAppshots: (scope, snapshot) => appshotClears.push({ scope, snapshot }),
  activeThreadId: "a", activeThreadIdRef: { current: "a" }, activeTurnIdRef: { current: "turn-a" }, threadRequestRef: { current: 1 },
  readWorkThreadProvenance: async () => null, workThreadContexts: { current: new Map() }, threadsRef: { current: [] },
  queueListRequestRef: { current: 0 }, queueMutationThreadsRef: { current: new Set() }, steeredQueueItemsRef: { current: new Map() },
  followupQueue: queue, promptInput: draft, attachedFiles: [], isStreaming: false,
  persistThreadAttachments: async () => ({ errors: [] }),
  setAttachedFiles: value => { ctx.attachedFiles = typeof value === "function" ? value(ctx.attachedFiles) : value; },
  setFollowupQueue: value => { queue = typeof value === "function" ? value(queue) : value; ctx.followupQueue = queue; },
  setQueueMutationVersion: () => {}, setQueueNotice: () => {},
  setPromptInput: value => { draft = typeof value === "function" ? value(draft) : value; },
  showAppToast: (...args) => toasts.push(args),
  callAppServer: async (method, params) => { calls.push([method, params]); return rpc(method, params); },
});
ctx.refreshThreadQueue = vm.runInContext(callback("refreshThreadQueue"), ctx);
rpc = async (_, p) => p.cursor ? { data: [{ id: "q2", clientUserMessageId: "c2", input: [{ type: "text", text: "two" }] }], nextCursor: null }
  : { data: [{ id: "q1", clientUserMessageId: "c1", input: [{ type: "text", text: "one" }, { type: "mention", path: "x" }] }], nextCursor: "next" };
await ctx.refreshThreadQueue("a");
assert.equal(queue.length, 2, "read every queue page");
assert.equal(queue[0].input.length, 2, "retain complete server input");
assert.equal(queue[0].clientUserMessageId, "c1");
console.log("PASS queue pagination and server identities/input");
let release;
rpc = () => new Promise(resolve => { release = resolve; });
const late = ctx.refreshThreadQueue("a");
ctx.activeThreadIdRef.current = "b"; ctx.threadRequestRef.current++;
release({ data: [{ id: "stale", input: [] }] }); await late;
assert.equal(queue[0].id, "q1", "old thread result cannot overwrite current queue");
ctx.activeThreadIdRef.current = "a"; ctx.threadRequestRef.current++;
rpc = async () => { throw Error("list failed"); }; await ctx.refreshThreadQueue("a");
assert.equal(queue.length, 2, "list failure retains queue");
console.log("PASS late response isolation and failure preservation");
let firstListRelease;
rpc = () => new Promise(resolve => { firstListRelease = resolve; });
const oldList = ctx.refreshThreadQueue("a");
rpc = async () => ({ data: [{ id: "new", clientUserMessageId: "new-client", input: [{ type: "text", text: "new" }] }] });
await ctx.refreshThreadQueue("a");
firstListRelease({ data: [{ id: "old", clientUserMessageId: "old-client", input: [] }] }); await oldList;
assert.equal(queue[0].id, "new", "older list for same thread cannot overwrite newer list");
queue = [{ id: "q1", clientUserMessageId: "c1", input: [{ type: "text", text: "one" }, { type: "mention", path: "x" }], text: "one" }, { id: "q2", clientUserMessageId: "c2", input: [], text: "two" }];
ctx.followupQueue = queue;
console.log("PASS same-thread list response order");
for (const name of ["handleSteerTurn", "handleStartServerQueue", "handleEnqueueFollowup", "handleCancelQueuedFollowup"]) ctx[name] = vm.runInContext(callback(name), ctx);
calls = []; rpc = async () => { throw Error("steer rejected"); };
await ctx.handleSteerTurn("hello");
assert.deepEqual(calls.map(c => c[0]), ["turn/steer"], "steer rejection must not dispatch another task");
console.log("PASS steer failure never silently queues or starts");
calls = []; rpc = async method => { if (method === "turn/steer") return { turnId: "turn-a" }; throw Error("delete failed"); };
await ctx.handleSteerTurn("one", queue[0]);
assert.equal(calls[0][1].clientUserMessageId, "c1");
assert.equal(calls[0][1].input.length, 2);
assert.equal(calls[1][0], "thread/queue/delete");
const count = calls.length;
await ctx.handleSteerTurn("one", queue[0]); await ctx.handleStartServerQueue();
assert.equal(calls.length, count, "accepted queue steer cannot be sent again after delete failure");
assert.equal(queue.length, 2);
rpc = async method => method === "thread/queue/delete" ? { deleted: true } : { data: [] };
await ctx.handleCancelQueuedFollowup(queue[0]);
assert.equal(queue.length, 0);
console.log("PASS queue steer preserves input, cleans original and blocks resend on cleanup failure");
calls = []; draft = "old"; ctx.promptInput = draft;
rpc = () => new Promise(resolve => { release = resolve; });
const enqueuing = ctx.handleEnqueueFollowup();
await ctx.handleEnqueueFollowup(); await until(() => calls.length === 1); assert.equal(calls.length, 1, "duplicate enqueue blocked");
draft = "new"; rpc = async () => ({ data: [] });
release({ queuedSubmission: { id: "created", clientUserMessageId: "client", input: [] } }); await enqueuing;
assert.equal(draft, "new", "newly typed draft must survive old enqueue completion");
console.log("PASS enqueue duplicate guard and draft preservation");
calls = []; queue = []; ctx.followupQueue = queue;
await ctx.handleStartServerQueue(); assert.equal(calls.length, 0, "empty queue must never start null ID");
queue = [{ id: "cleanup", clientUserMessageId: "cleanup-client", input: [{ type: "text", text: "cleanup" }], text: "cleanup" }]; ctx.followupQueue = queue;
rpc = async () => { throw Error("delete refused"); };
await ctx.handleCancelQueuedFollowup(queue[0]); assert.equal(queue.length, 1, "failed deletion remains visible");
calls = [];
rpc = method => method === "turn/steer" ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ deleted: true });
const switchingSteer = ctx.handleSteerTurn(queue[0].text, queue[0]);
ctx.activeThreadIdRef.current = "b"; ctx.threadRequestRef.current++;
queue = [{ id: "b", text: "B" }]; ctx.followupQueue = queue;
release({ turnId: "turn-a" }); await switchingSteer;
assert.equal(calls[1][0], "thread/queue/delete"); assert.equal(calls[1][1].threadId, "a", "late successful steer must clean original thread queue");
assert.equal(queue[0].id, "b", "late steer cleanup must not replace B queue");
console.log("PASS empty start, failed cancel and late steer cleanup isolation");
assert.ok(!source.includes(".catch(() => setFollowupQueue((prev) => prev.slice(1)))"), "rendered cancel must not fake success");
assert.match(source, /handleSteerTurn\(followupQueue\[0\]\.text, followupQueue\[0\]\)/);
assert.match(source, /handleCancelQueuedFollowup\(followupQueue\[0\]\)/);
console.log("PASS actual queue buttons use server-aware handlers");
const buttonDisabled = label => {
  let expression;
  const visit = node => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "button" && node.children.some(child => ts.isJsxText(child) && child.text.trim() === label)) {
      expression = node.openingElement.attributes.properties.find(attr => attr.name?.getText(ast) === "disabled")?.initializer.expression.getText(ast);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(expression, `${label} disabled state`); return expression;
};
const startDisabled = buttonDisabled("立即发送"), steerDisabled = buttonDisabled("引导到当前轮 (Steer)"), cancelDisabled = buttonDisabled("取消");
const renderCtx = vm.createContext({ queueBusy: false, activeThreadId: "a", isStreaming: true, followupQueue: [{ id: "accepted" }], steeredQueueItemsRef: { current: new Map([["a:accepted", "accepted"]]) } });
assert.equal(vm.runInContext(startDisabled, renderCtx), true);
assert.equal(vm.runInContext(steerDisabled, renderCtx), true);
assert.equal(vm.runInContext(cancelDisabled, renderCtx), false, "accepted steer still permits cleanup");
renderCtx.queueBusy = true;
assert.equal(vm.runInContext(cancelDisabled, renderCtx), true);
console.log("PASS actual JSX blocks accepted resend and duplicate cleanup");
ctx.activeThreadIdRef.current="a";ctx.threadRequestRef.current++;
const uncertain={id:"uncertain",clientUserMessageId:"uncertain-client",input:[{type:"text",text:"uncertain"}],text:"uncertain"};
queue=[uncertain];ctx.followupQueue=queue;calls=[];rpc=async()=>{throw Error("steer timed out")};
await ctx.handleSteerTurn(uncertain.text,uncertain);
assert.equal(ctx.steeredQueueItemsRef.current.get("a:uncertain"),"unknown");
const uncertainCalls=calls.length;await ctx.handleSteerTurn(uncertain.text,uncertain);await ctx.handleStartServerQueue();
assert.equal(calls.length,uncertainCalls,"unknown queue Steer must not be sent again");
console.log("PASS unconfirmed queue Steer blocks repeat start and Steer");
let queueBar;
const className=node=>ts.isJsxElement(node)?node.openingElement.attributes.properties.find(attr=>attr.name?.getText(ast)==="className")?.initializer?.text:undefined;
const findBar=node=>{if(className(node)==="floating-up-next-bar")queueBar=node;ts.forEachChild(node,findBar)};findBar(ast);assert.ok(queueBar);
let interactive=false;
for(let parent=queueBar.parent;parent;parent=parent.parent)if(className(parent)==="floating-composer-inner")interactive=true;
assert.equal(interactive,true,"queue controls must be inside the existing pointer-enabled composer surface");
console.log("PASS queue controls live inside the interactive composer surface");

ctx.steeredQueueItemsRef.current.clear();
ctx.activeThreadIdRef.current = "a";
ctx.followupQueue = [{ id: "live", clientUserMessageId: "live-client", input: [{ type: "text", text: "live" }], text: "live" }];
ctx.isStreaming = true; calls = [];
rpc = async method => method === "turn/steer" ? { turnId: "turn-a" } : method === "thread/queue/delete" ? { deleted: true } : { data: [] };
await ctx.handleStartServerQueue();
assert.deepEqual(calls.map(c => c[0]), ["turn/steer", "thread/queue/delete", "thread/queue/list"], "send now while running must steer and clean the queue");
ctx.isStreaming = false;
console.log("PASS running send-now uses Steer instead of starting another turn");

const image = { id: "image", name: "test.png", path: "C:/isolated/test.png", kind: "image" };
const file = { id: "file", name: "notes.txt", path: "C:/isolated/notes.txt", kind: "file" };
ctx.promptInput = "with files"; draft = ctx.promptInput; ctx.attachedFiles = [image, file]; calls = [];
rpc = async method => method === "thread/queue/add" ? { queuedSubmission: { id: "attachments" } } : { data: [] };
await ctx.handleEnqueueFollowup();
assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1].input)), [{ type: "text", text: "with files" }, { type: "localImage", path: image.path }, { type: "mention", name: file.name, path: file.path }], "queued input must contain all attachments");
assert.equal(ctx.attachedFiles.length, 0);
assert.equal(draft, "");
ctx.promptInput = ""; ctx.attachedFiles = [image]; calls = [];
await ctx.handleEnqueueFollowup();
assert.equal(calls[0][1].input[0].type, "localImage", "attachment-only queue is supported");
ctx.followupQueue = [{ id: "image-only", clientUserMessageId: "image-client", input: [{ type: "localImage", path: image.path }], text: "" }];
ctx.isStreaming = true; calls = [];
rpc = async method => method === "turn/steer" ? { turnId: "turn-a" } : method === "thread/queue/delete" ? { deleted: true } : { data: [] };
await ctx.handleStartServerQueue();
assert.equal(calls[0][0], "turn/steer", "attachment-only queue can steer an active turn");
assert.equal(calls[0][1].input[0].path, image.path);
ctx.isStreaming = false;
console.log("PASS enqueue preserves full input including attachment-only messages");

ctx.promptInput = "keep"; draft = "keep"; ctx.attachedFiles = [file]; calls = [];
ctx.persistThreadAttachments = async () => ({ errors: [{ message: "save refused" }] });
await ctx.handleEnqueueFollowup();
assert.equal(calls.length, 0, "attachment persistence failure cannot enqueue partial input");
assert.equal(draft, "keep"); assert.equal(ctx.attachedFiles.length, 1);
let attachmentSaveEntered = false;
ctx.persistThreadAttachments = () => new Promise(resolve => { attachmentSaveEntered = true; release = resolve; });
const saving = ctx.handleEnqueueFollowup();
await until(() => attachmentSaveEntered);
ctx.activeThreadIdRef.current = "b"; ctx.threadRequestRef.current++;
release({ errors: [] }); await saving;
assert.equal(calls.length, 0, "switching thread while saving must not dispatch into old thread");
ctx.activeThreadIdRef.current = "a"; ctx.threadRequestRef.current++;
ctx.persistThreadAttachments = async () => ({ errors: [] });
rpc = async () => { throw Error("enqueue refused"); };
calls = []; await ctx.handleEnqueueFollowup();
assert.equal(draft, "keep"); assert.equal(ctx.attachedFiles.length, 1, "queue error preserves original attachments");
rpc = () => new Promise(resolve => { release = resolve; });
const sendingFiles = ctx.handleEnqueueFollowup();
await until(() => calls.some(([method]) => method === "thread/queue/add"));
const newFiles = [image]; ctx.attachedFiles = newFiles; draft = "new draft";
rpc = async () => ({ data: [] }); release({ queuedSubmission: { id: "old-files" } }); await sendingFiles;
assert.equal(ctx.attachedFiles, newFiles, "late enqueue cannot clear new attachments");
assert.equal(draft, "new draft");
console.log("PASS attachment failures, thread switch and new draft preservation");

ctx.attachedFiles = []; ctx.promptInput = "old account draft"; draft = ctx.promptInput; calls = [];
let enqueueDispatched;
const enqueueReady = new Promise(resolve => { enqueueDispatched = resolve; });
rpc = () => new Promise(resolve => { release = resolve; enqueueDispatched(); });
const oldAccountEnqueue = ctx.handleEnqueueFollowup();
await enqueueReady;
assert.equal(calls[0][0], "thread/queue/add");
const clearsBeforeAccountChange = appshotClears.length;
ctx.executionIdentityRef.current = "account-b";
ctx.appshotScope = "account-b:thread:a";
draft = "new account draft";
release({ queuedSubmission: { id: "old-account-ack" } }); await oldAccountEnqueue;
assert.equal(draft, "new account draft", "old-account queue acknowledgement cannot clear the new account draft");
assert.equal(appshotClears.length, clearsBeforeAccountChange, "old-account queue acknowledgement cannot clear appshots in a new scope");
assert.equal(calls.length, 1, "old-account queue acknowledgement cannot refresh the new account queue");
console.log("PASS old account queue acknowledgement preserves new account scope");

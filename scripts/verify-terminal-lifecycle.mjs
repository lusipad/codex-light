import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/components/TerminalDock.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("TerminalDock.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const effects = [];
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") effects.push(node.arguments[0]);
  ts.forEachChild(node, visit);
}
visit(ast);
const compile = node => ts.transpileModule(`(${node.getText(ast)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const subscription = effects.find(node => node.getText(ast).includes('"terminal:data"'));
const creation = effects.find(node => node.getText(ast).includes('"terminal_create_or_attach"'));
assert.ok(subscription && creation, "production effects must exist");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const outputModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(new URL("../src/terminalOutput.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText, { exports: outputModule.exports, TextEncoder, TextDecoder });
const snapshot = (text, id = "term-1") => ({
  sessionId: id, generation: "generation-1", replayLog: text,
  startOffset: 0, endOffset: new TextEncoder().encode(text).length, exited: false,
});
function mount() {
  const listeners = [], terminals = [], timers = new Set(), requests = [], resizeHandlers = new Set();
  let observerDisconnected = 0;
  const context = {
    open: true, tabs: [{ id: "term-1", cwd: "repo-A", shell: "powershell.exe" }],
    activeTabId: "term-1", cwd: "repo-A", fontSize: 13, selectedShell: "powershell.exe",
    containerRef: { current: { appendChild() {} } }, xtermMapRef: { current: new Map() },
    subscriptionsReadyRef: { current: Promise.resolve(false) },
    createTerminalOutput: outputModule.exports.createTerminalOutput,
    terminalAppearance: () => ({fontFamily: 'Consolas', fontSize: 12, theme: {background: '#111111', foreground: '#eeeeee'}}),
    setCommandError(value) { context.error = value; },
    listen(name, handler) { const pending = deferred(); listeners.push({ name, handler, ...pending }); return pending.promise; },
    invoke(method, args) { const pending = deferred(); requests.push({ method, args, ...pending }); return pending.promise; },
    setTimeout(callback) { timers.add(callback); return callback; },
    clearTimeout(callback) { timers.delete(callback); },
    document: { createElement: () => ({ style: {}, removed: false, events: new Map(), addEventListener(name, fn) { this.events.set(name, fn); }, removeEventListener(name) { this.events.delete(name); }, remove() { this.removed = true; } }) },
    window: {
      addEventListener(name, fn) { resizeHandlers.add(fn); },
      removeEventListener(name, fn) { resizeHandlers.delete(fn); },
    },
    ResizeObserver: class { observe() {} disconnect() { observerDisconnected++; } },
    FitAddon: class { fit() {} },
    Terminal: class {
      constructor(options) { this.options = options; this.writes = []; this.disposals = 0; this.parsed = []; terminals.push(this); }
      loadAddon() {} open(el) { this.el = el; this.textarea = {}; } attachCustomKeyEventHandler(fn) { this.keyHandler = fn; } onData(fn) { this.input = fn; } onKey(fn) { this.userKey = fn; return {dispose() {}}; }
      write(text, callback) { assert.equal(this.disposals, 0, "cannot write disposed terminal"); this.writes.push(text); if (callback) this.parsed.push(callback); }
      writeln(text) { this.write(text); }
      dispose() { this.disposals++; }
    },
  };
  return {
    context, listeners, terminals, timers, requests, resizeHandlers,
    subscription: vm.runInNewContext(compile(subscription), context),
    creation: vm.runInNewContext(compile(creation), context),
    disconnected: () => observerDisconnected,
  };
}
{
  const view = mount(), cleanup = view.subscription(), released = [];
  cleanup();
  view.listeners.forEach((entry, index) => entry.resolve(() => released.push(index)));
  await flush();
  assert.deepEqual(released, [0, 1], "TL01: late registration immediately unsubscribes");
}
for (const outcome of ["resolve", "reject"]) {
  const view = mount(), cleanupSubscriptions = view.subscription();
  let released = 0;
  view.listeners.forEach(entry => entry.resolve(() => released++));
  await flush();
  const cleanupView = view.creation();
  await flush();
  const entry = view.context.xtermMapRef.current.get("term-1");
  assert.equal(view.requests[0].method, "terminal_create_or_attach");
  assert.equal(view.timers.size, 1);
  cleanupSubscriptions();
  cleanupView();
  assert.equal(released, 2, "TL02: release both event subscriptions");
  assert.equal(entry.term.disposals, 1);
  assert.equal(entry.el.removed, true);
  assert.equal(view.context.xtermMapRef.current.size, 0);
  view.listeners[0].handler({ payload: { sessionId: "term-1", data: "late event" } });
  view.listeners[1].handler({ payload: { sessionId: "term-1" } });
  if (outcome === "resolve") view.requests[0].resolve(snapshot("late replay"));
  else view.requests[0].reject(Error("late launch failure"));
  await flush();
  assert.deepEqual(entry.term.writes, [], "TL03: late events and attach results cannot write disposed views");
  assert.equal(view.timers.size, 0, "TL04: clear fit timer");
  assert.equal(view.resizeHandlers.size, 0);
  assert.equal(view.disconnected(), 1);
}
{
  const view = mount(), cleanupSubscriptions = view.subscription();
  view.listeners.forEach(entry => entry.resolve(() => {}));
  await flush();
  const cleanupFirst = view.creation();
  await flush();
  cleanupFirst();
  view.context.tabs.push({ id: "term-2", cwd: "repo-B", shell: "cmd.exe" });
  view.context.activeTabId = "term-2";
  const cleanupSecond = view.creation();
  await flush();
  view.requests[0].resolve(snapshot("first tab output"));
  await flush();
  assert.deepEqual(view.terminals[0].writes, ["first tab output"], "tab switch retains its live terminal output");
  assert.deepEqual(view.terminals[1].writes, [], "cannot write replay into another tab");
  cleanupSecond();
  cleanupSubscriptions();
  assert.equal(view.timers.size, 0);
}
console.log("PASS TL01–TL04 production terminal effects: late subscriptions, view disposal, late attach/event suppression and timer/observer cleanup");
{
  const view = mount(), cleanup = view.subscription(), cleanupView = view.creation();
  await flush();
  assert.equal(view.requests.length, 0, "TO02: no session starts before both listeners");
  view.listeners[0].resolve(() => {});
  await flush();
  assert.equal(view.requests.length, 0);
  view.listeners[1].resolve(() => {});
  await flush();
  const entry = view.context.xtermMapRef.current.get("term-1");
  view.terminals[0].input("replay-generated response");
  assert.equal(view.requests.length, 1, "hydration suppresses terminal-generated input");
  view.listeners[0].handler({ payload: {
    sessionId: "term-1", generation: "generation-1", startOffset: 4, endOffset: 8, data: "tail",
  } });
  view.requests[0].resolve(snapshot("head"));
  let ready = false;
  entry.ready.then(value => { ready = value; });
  await flush();
  assert.deepEqual(view.terminals[0].writes, ["head", "tail"], "TO03: early live event follows snapshot once");
  assert.equal(ready, false, "ready waits for actual xterm parse callback");
  view.terminals[0].input("still replaying");
  assert.equal(view.requests.length, 1);
  view.terminals[0].parsed.shift()();
  await flush();
  assert.equal(ready, true);
  view.terminals[0].input("user input");
  assert.equal(view.requests[1].args.data, "user input");
  cleanup(); cleanupView();
}
{
  const view = mount(), cleanup = view.subscription(), cleanupView = view.creation();
  view.listeners[0].reject(Error("listener unavailable"));
  view.listeners[1].resolve(() => {});
  await flush();
  assert.equal(view.requests.length, 0, "listener failure must never create an unobserved session");
  assert.match(view.context.error, /listener unavailable/);
  assert.equal(await view.context.xtermMapRef.current.get("term-1").ready, false);
  cleanup(); cleanupView();
}
console.log("PASS TO02–TO03 listener readiness, failure, pre-attach buffering and parser-based input hydration");
{
  const view = mount(), cleanup = view.subscription(), cleanupView = view.creation();
  view.listeners.forEach(entry => entry.resolve(() => {}));
  await flush();
  const term = view.terminals[0];
  term.userKey({key:"before attach"}); term.input("before attach");
  assert.equal(view.requests.length, 1, "TU04: even user input waits for successful attach");
  view.requests[0].resolve(snapshot("replaying"));
  await flush();
  assert.equal(term.options.disableStdin, false, "TU04: attached replay does not block user typing");
  term.input("ANSI auto reply");
  assert.equal(view.requests.length, 1, "TU04: replay-generated input is filtered");
  for (const inputType of ["insertText", "deleteContentBackward", "insertCompositionText"]) {
    const ignoredEvent = {target:term.textarea, eventPhase:1, inputType, data:"ignored"};
    term.el.events.get("input")(ignoredEvent);
    ignoredEvent.eventPhase=0;
    term.input("ANSI after ignored input");
    assert.equal(view.requests.length,1,"TU04: ignored DOM input cannot mark a later ANSI response as user input");
  }
  term.userKey({key:"typed during replay"}); term.input("typed during replay");
  assert.equal(view.requests[1].args.data, "typed during replay", "TU04: explicit user input is preserved");
  term.input("another ANSI auto reply");
  assert.equal(view.requests.length, 2, "TU04: user marker is consumed once");
  term.parsed.shift()();
  await flush();
  term.input("live auto reply");
  assert.equal(view.requests[2].args.data, "live auto reply", "TU04: live protocol replies remain enabled");
  cleanup(); cleanupView();
  term.userKey({key:"late user input"}); term.input("late user input");
  assert.equal(view.requests.length, 3, "TU04: released renderers cannot write");
}
console.log("PASS TU04: user typing during replay, generated response filtering, one-shot classification and released-session guard");
{
  // Exercise the installed xterm implementation, including branches that do
  // not emit onData. A callback-only fake would miss the stale-marker defect.
  const xtermSource=fs.readFileSync(new URL("../node_modules/@xterm/xterm/src/browser/Terminal.ts",import.meta.url),"utf8");
  const xtermAst=ts.createSourceFile("Terminal.ts",xtermSource,ts.ScriptTarget.Latest,true);
  let inputMethod;
  function findInput(node) {
    if(ts.isMethodDeclaration(node)&&node.name.getText(xtermAst)==="_inputEvent") inputMethod=node;
    ts.forEachChild(node,findInput);
  }
  findInput(xtermAst);assert.ok(inputMethod);
  const inputBody=ts.transpileModule(`(function(ev) ${inputMethod.body.getText(xtermAst)})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const processInput=vm.runInNewContext(inputBody,{});
  const clipboardSource=fs.readFileSync(new URL("../node_modules/@xterm/xterm/src/browser/Clipboard.ts",import.meta.url),"utf8");
  const clipboardAst=ts.createSourceFile("Clipboard.ts",clipboardSource,ts.ScriptTarget.Latest,true);
  const clipboardFunctions=clipboardAst.statements.filter(node=>ts.isFunctionDeclaration(node)&&["prepareTextForTerminal","bracketTextForPaste","paste","handlePasteEvent"].includes(node.name.text));
  const clipboardModule={};
  vm.runInNewContext(ts.transpileModule(clipboardFunctions.map(node=>node.getText(clipboardAst)).join("\n"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:clipboardModule});
  const view=mount(),cleanup=view.subscription(),cleanupView=view.creation();
  view.listeners.forEach(entry=>entry.resolve(()=>{}));await flush();
  view.requests[0].resolve(snapshot("pending parser"));await flush();
  const term=view.terminals[0];
  const xterm={_keyPressHandled:false,_keyDownSeen:false,optionsService:{rawOptions:{screenReaderMode:false}},coreService:{triggerDataEvent:data=>term.input(data)},cancel(){}};
  for(const state of [{inputType:"deleteContentBackward"},{inputType:"insertText",handled:true},{inputType:"insertText",composed:true,keyDown:true}]) {
    const e={target:term.textarea,eventPhase:1,data:"ignored",composed:false,...state};
    xterm._keyPressHandled=!!state.handled;xterm._keyDownSeen=!!state.keyDown;
    term.el.events.get("input")(e);e.eventPhase=2;
    assert.equal(processInput.call(xterm,e),false);
    e.eventPhase=0;term.input("\x1b[0n");
    assert.equal(view.requests.length,1,"TU04: real xterm ignored-input branch cannot leak a replay response");
  }
  xterm._keyPressHandled=false;xterm._keyDownSeen=false;
  const accepted={target:term.textarea,eventPhase:1,data:"中文🙂",inputType:"insertText",composed:false};
  term.el.events.get("input")(accepted);accepted.eventPhase=2;
  assert.equal(processInput.call(xterm,accepted),true);accepted.eventPhase=0;
  assert.equal(view.requests[1].args.data,"中文🙂","TU04: real xterm accepted input is preserved during replay");
  const core={triggerDataEvent:data=>term.input(data),decPrivateModes:{bracketedPasteMode:true}};
  for(const text of [null,"粘贴\n下一行"]) {
    const e={target:term.textarea,eventPhase:1,clipboardData:text==null?null:{getData:()=>text},stopPropagation(){}};
    term.el.events.get("paste")(e);e.eventPhase=2;
    clipboardModule.handlePasteEvent(e,term.textarea,core,{rawOptions:{}});e.eventPhase=0;
    term.input("\x1b[0n");
    assert.equal(view.requests.length,text==null?2:3,"TU04: no-data paste cannot leak replay responses; actual paste stays writable");
  }
  assert.equal(view.requests[2].args.data,"\x1b[200~粘贴\r下一行\x1b[201~","TU04: installed xterm paste normalization and brackets remain intact");
  cleanup();cleanupView();
}
console.log("PASS TU04 real xterm input/paste paths: ignored-event isolation, accepted Chinese input, empty clipboard and bracketed paste during replay");
{
  const compositionSource=fs.readFileSync(new URL("../node_modules/@xterm/xterm/src/browser/input/CompositionHelper.ts",import.meta.url),"utf8");
  const compositionAst=ts.createSourceFile("CompositionHelper.ts",compositionSource,ts.ScriptTarget.Latest,true);
  const methods=[];
  function findComposition(node){
    if(ts.isMethodDeclaration(node)&&["compositionstart","compositionend","_finalizeComposition"].includes(node.name.getText(compositionAst))) methods.push(node.getText(compositionAst));
    ts.forEachChild(node,findComposition);
  }
  findComposition(compositionAst);
  const timers=[];
  const composition=vm.runInNewContext(ts.transpileModule(`new (class {${methods.join("\n")}})()`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{setTimeout:callback=>timers.push(callback)});
  const view=mount(),cleanup=view.subscription(),cleanupView=view.creation();
  view.listeners.forEach(entry=>entry.resolve(()=>{}));await flush();
  view.requests[0].resolve(snapshot("pending parser"));await flush();
  const term=view.terminals[0];term.textarea.value="";
  Object.assign(composition,{_textarea:term.textarea,_compositionView:{classList:{add(){},remove(){}}},_compositionPosition:{start:0,end:0},_coreService:{triggerDataEvent:data=>term.input(data)}});
  const start={target:term.textarea,eventPhase:1};
  term.el.events.get("compositionstart")?.(start);composition.compositionstart();start.eventPhase=0;
  term.textarea.value="中文";composition._compositionPosition.end=2;
  const end={target:term.textarea,eventPhase:1};
  term.el.events.get("compositionend")?.(end);composition.compositionend();end.eventPhase=0;
  term.input("\x1b[0n");assert.equal(view.requests.length,1,"TU04: awaiting asynchronous IME never authorizes ANSI");
  timers.shift()();
  assert.equal(view.requests[1]?.args.data,"中文","TU04: installed xterm asynchronous composition survives replay outside DOM dispatch");
  term.input("中文");assert.equal(view.requests.length,2,"TU04: composition text credential is consumed only once");
  // A second composition can start before the previous finalize timer runs.
  const dispatchStart=()=>{
    const event={target:term.textarea,eventPhase:1};
    term.el.events.get("compositionstart")(event);composition.compositionstart();event.eventPhase=0;
  };
  const dispatchEnd=()=>{
    const event={target:term.textarea,eventPhase:1};
    term.el.events.get("compositionend")(event);composition.compositionend();event.eventPhase=0;
  };
  term.textarea.value="";dispatchStart();
  term.textarea.value="第一段";composition._compositionPosition.end=3;dispatchEnd();
  dispatchStart();timers.shift()();
  assert.equal(view.requests[2]?.args.data,"第一段","TU04: new composition cannot overwrite previous pending text");
  term.textarea.value="第一段第二段";composition._compositionPosition.end=6;dispatchEnd();timers.shift()();
  assert.equal(view.requests[3]?.args.data,"第二段","TU04: new composition has its own exact text range");
  term.textarea.value="";dispatchStart();term.textarea.value="已取消";dispatchEnd();
  composition._isSendingComposition=false;timers.shift()();
  await flush();
  for(const callback of [...view.timers]){view.timers.delete(callback);callback();}
  term.input("已取消");
  assert.equal(view.requests.length,4,"TU04: canceled/expired composition never grants a lasting matching-text permission");
  cleanup();cleanupView();
}
console.log("PASS TU04 installed xterm asynchronous composition callback during replay");
{
  const view = mount(), cleanup = view.subscription(), cleanupView = view.creation();
  view.listeners.forEach(entry => entry.resolve(() => {}));
  await flush();
  const entry = view.context.xtermMapRef.current.get("term-1");
  view.requests[0].resolve(snapshot("pending parse"));
  await flush();
  cleanup(); cleanupView();
  assert.equal(await entry.ready, false, "disposing during hydration releases pending command waiters");
  view.terminals[0].parsed.shift()();
  view.terminals[0].input("late parsed response");
  assert.equal(view.requests.length, 1, "late parse cannot re-enable input for disposed views");
}

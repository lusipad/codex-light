import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const hooks = [], effects = [];
let cursor = 0, invoke = async () => null;
const react = {
  createElement: (tag, props, ...children) => ({ tag, props: props ?? {}, children: children.flat(Infinity) }),
  useState(initial) {
    const i = cursor++;
    if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial;
    return [hooks[i], value => hooks[i] = typeof value === "function" ? value(hooks[i]) : value];
  },
  useRef(initial) { const i = cursor++; return hooks[i] ??= { current: initial }; },
  useCallback(fn) { cursor++; return fn; },
  useEffect(fn, deps) {
    const i = cursor++, previous = hooks[i];
    if (!previous || deps.some((value, j) => value !== previous.deps[j])) {
      previous?.cleanup?.(); hooks[i] = { deps };
      effects.push(() => hooks[i].cleanup = fn());
    }
  },
};
const mod = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync("src/notificationPreferences.ts", "utf8")), {
  exports: mod.exports, require: name => name === "react" ? react : { tauriInvoke: (...args) => invoke(...args) },
});
const {
  NOTIFICATION_DEFAULTS: defaults, normalizeNotificationValue: normalize, shouldNotify,
  notificationRequestCategory, shouldNotifyTurn, createNotificationDispatcher, useNotificationPreferences,
} = mod.exports;
assert.equal(normalize("notifications-turn-mode", "never"), "unfocused");
for (const key of ["notifications-permissions-enabled", "notifications-questions-enabled", "notifications-dot-enabled"]) {
  assert.equal(normalize(key, false), false);
  assert.equal(normalize(key, "false"), true);
}
assert.equal(normalize("notifications-sound", { fileName: "../bad.wav", name: "bad" }), "default");
const custom = { fileName: `codex-custom-${"a".repeat(64)}.wav`, name: "custom" };
assert.equal(normalize("notifications-sound", custom), custom);
for (const mode of ["off", "unfocused", "always"]) for (const focused of [false, true]) for (const visible of [false, true]) {
  const prefs = { ...defaults, "notifications-turn-mode": mode };
  assert.equal(shouldNotify(prefs, "turn", focused, visible), mode === "always" || mode === "unfocused" && !focused);
  for (const category of ["permission", "question"]) {
    assert.equal(shouldNotify(prefs, category, focused, visible), !(focused && visible), `${category} independent from ${mode}`);
  }
  assert.equal(shouldNotify(prefs, "dot", focused, visible), !focused);
}
assert.equal(shouldNotify({ ...defaults, "notifications-permissions-enabled": false }, "permission", false, false), false);
assert.equal(shouldNotify({ ...defaults, "notifications-questions-enabled": false }, "question", false, false), false);
assert.equal(shouldNotify({ ...defaults, "notifications-dot-enabled": false }, "dot", false, false), false);
for (const method of ["item/tool/requestUserInput", "tool/requestUserInput", "ask_user"]) {
  assert.equal(notificationRequestCategory({ method }), "question");
}
assert.equal(notificationRequestCategory({ method: "custom", params: { questions: [] } }), "question");
assert.equal(notificationRequestCategory({ method: "item/commandExecution/requestApproval" }), "permission");
for (const params of [{ turn: { status: "failed" } }, { turn: { status: "interrupted" } },
  { hasPendingContinuation: true }, { automationNotificationDecision: "DONT_NOTIFY" },
  { heartbeatAssistantMessage: { decision: "DONT_NOTIFY" } }]) assert.equal(shouldNotifyTurn(params), false);
assert.equal(shouldNotifyTurn({ turn: { status: "completed" } }), true);
console.log("PASS NT01-NT03: independent defaults, mode/focus/visibility matrix, question classification and quiet/cancelled turns");

let preferences = { ...defaults, "notifications-sound": "none" }, focused = false, visible = false;
const sent = [], sounds = [], errors = [];
let send = async (...args) => { sent.push(args); };
const dispatch = createNotificationDispatcher({
  preferences: () => preferences, focused: () => focused, visible: () => visible,
  send: (...args) => send(...args),
  play: sound => { if (sound !== "none") sounds.push(sound); }, onError: error => errors.push(error),
});
const event = id => ({ id, category: "turn", title: "done", body: "body" });
await Promise.all([dispatch(event("duplicate")), dispatch(event("duplicate"))]);
assert.equal(sent.length, 1); assert.equal(sounds.length, 0, "none leaves desktop notification enabled");
let valid = true;
const cancelled = dispatch({ ...event("cancelled"), category: "question", valid: () => valid });
valid = false; await cancelled; assert.equal(sent.length, 1, "request resolved before async send");
const refocused = dispatch(event("refocused")); focused = true;
await refocused; assert.equal(sent.length, 1, "recheck focus immediately before send");
focused = false;
for (let i = 0; i < 1001; i++) await dispatch(event(`bounded-${i}`));
const count = sent.length;
await dispatch(event("duplicate")); assert.equal(sent.length, count + 1, "oldest ID evicted from bounded dedupe");
send = async () => { throw Error("notification unavailable"); };
await dispatch(event("failure")); assert.match(String(errors[0]), /unavailable/);
console.log("PASS NT04: duplicate/recent ID bound, late cancellation/focus, sound:none and observable send failure");

const claims = new Set(), nativeSent = [], nativeSounds = [], nativeErrors = [];
let nativeValid = true, resolveClaim;
const nativeDependencies = {
  // Deliberately stale/disabled renderer preferences and focus: native decision wins.
  preferences: () => ({ ...defaults, "notifications-turn-mode": "off" }),
  focused: () => true, visible: () => true,
  nativeClaim: async event => {
    if (claims.has(event.id)) return null;
    claims.add(event.id);
    return { sound: "classic" };
  },
  send: async title => { nativeSent.push(title); },
  play: sound => nativeSounds.push(sound), onError: error => nativeErrors.push(error),
};
const firstWindow = createNotificationDispatcher(nativeDependencies);
const secondWindow = createNotificationDispatcher(nativeDependencies);
await Promise.all([firstWindow(event("shared-native")), secondWindow(event("shared-native"))]);
assert.equal(nativeSent.length, 1, "host claim governs all renderers despite stale preferences");
assert.deepEqual(nativeSounds, ["classic"]);
const waitingWindow = createNotificationDispatcher({
  ...nativeDependencies, nativeClaim: () => new Promise(resolve => { resolveClaim = resolve; }),
});
const late = waitingWindow({ ...event("native-late"), valid: () => nativeValid });
await Promise.resolve();
nativeValid = false; resolveClaim({ sound: "default" }); await late;
assert.equal(nativeSent.length, 1, "resolved while waiting for host cannot send or play");
assert.equal(nativeSounds.length, 1);
await createNotificationDispatcher({
  ...nativeDependencies, nativeClaim: async () => { throw Error("host unavailable"); },
})(event("native-error"));
assert.match(String(nativeErrors[0]), /host unavailable/);
assert.equal(nativeSent.length, 1, "host failure cannot fall back to duplicate renderer delivery");
console.log("PASS CN01/CN04/CN05: multiple dispatchers, native preference authority, late resolution and visible host failure");

const render = () => {
  cursor = 0;
  const state = useNotificationPreferences();
  for (const effect of effects.splice(0)) effect();
  return state;
};
const flush = () => new Promise(setImmediate);
const store = { ...defaults }, calls = [];
invoke = () => new Promise(() => {});
let state = render();
assert.equal(await state.save("notifications-turn-mode", "always"), false, "initial read blocks writes");
// Restart a clean harness so all five in-flight reads can complete deterministically.
for (const hook of hooks) hook?.cleanup?.();
hooks.length = 0;
invoke = async (method, args) => {
  calls.push([method, args]);
  if (method === "desktop_state_set") store[args.key] = args.value;
  return store[args.key];
};
state = render(); await flush(); state = render();
assert.equal(state.ready, true);
await state.save("notifications-turn-mode", "off"); state = render();
assert.equal(state.preferences["notifications-turn-mode"], "off");
assert.ok(calls.some(([method, args]) => method === "desktop_state_set" && args.key === "notifications-turn-mode"));
invoke = async () => { throw Error("disk denied"); };
assert.equal(await state.save("notifications-turn-mode", "always"), false);
state = render(); assert.equal(state.preferences["notifications-turn-mode"], "off"); assert.match(state.error, /保存通知设置失败/);
invoke = async (method, args) => {
  if (method === "desktop_state_set") { store[args.key] = args.value; return; }
  throw Error("readback unavailable");
};
assert.equal(await state.save("notifications-sound", "none"), true);
state = render(); assert.equal(state.preferences["notifications-sound"], "none"); assert.match(state.error, /已保存，但读取确认失败/);
invoke = async (_, args) => store[args.key];
state.reload(); state = render(); await flush(); state = render();
assert.equal(state.error, null); assert.equal(state.preferences["notifications-turn-mode"], "off");
let rejectWrite;
invoke = () => new Promise((_, reject) => { rejectWrite = reject; });
const writing = state.save("notifications-questions-enabled", false);
assert.equal(await state.save("notifications-turn-mode", "always"), false, "concurrent save blocked");
rejectWrite(Error("denied")); await writing;
state = render(); assert.equal(state.preferences["notifications-questions-enabled"], true);
console.log("PASS NT05: production hook read/write/readback, rollback, partial success, retry and concurrent save guard");

const componentMod = { exports: {} };
const previews = [], saves = [];
vm.runInNewContext(compile(fs.readFileSync("src/components/NotificationSettings.tsx", "utf8")), {
  exports: componentMod.exports, require: name => name === "react" ? react : name.includes("notificationPreferences")
    ? mod.exports : name.includes("sound") ? { playNotificationChime: (...args) => previews.push(args) }
      : { tauriInvoke: (...args) => invoke(...args) },
});
cursor = 0;
const tree = componentMod.exports.NotificationSettings({ state: {
  ...state, preferences: defaults, busy: false, save: (...args) => { saves.push(args); },
} });
const nodes = [];
function walk(node) { if (!node || typeof node !== "object") return; nodes.push(node); node.children?.forEach(walk); }
walk(tree);
nodes.find(node => node.props.id === "notification-turn-mode").props.onChange({ target: { value: "always" } });
nodes.find(node => node.props.id === "notifications-questions-enabled").props.onChange({ target: { checked: false } });
nodes.find(node => node.props.id === "notifications-sound").props.onChange({ target: { value: "none" } });
assert.deepEqual(saves, [["notifications-turn-mode", "always"], ["notifications-questions-enabled", false], ["notifications-sound", "none"]]);
nodes.find(node => node.children.includes("试听声音")).props.onClick(); assert.equal(previews.length, 1);
let tested = false; invoke = async method => { tested = method === "show_desktop_notification"; };
await nodes.find(node => node.children.includes("发送测试通知")).props.onClick(); assert.equal(tested, true);
console.log("PASS NT06: production settings JSX change, preview and native test-notification callbacks");

const appSource = fs.readFileSync("src/App.tsx", "utf8");
const appAst = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let requestListener;
function findListener(node) {
  if (ts.isCallExpression(node) && node.expression.getText(appAst) === "tauriListen" &&
      node.arguments[0]?.text === "app-server:server-request") requestListener = node.arguments[1];
  ts.forEachChild(node, findListener);
}
findListener(appAst); assert.ok(requestListener);
const pendingRef = { current: [] }, notified = [];
const pendingRequestKey = req => JSON.stringify([req.generation, req.id]);
const listener = vm.runInNewContext(compile(`(${requestListener.getText(appAst)})`), {
  pendingRequestRevisionRef: { current: 0 }, pendingRequestsRef: pendingRef,
  setPendingRequests: value => { pendingRef.current = value; }, setInboxItems: () => {},
  pendingRequestKey, requestThreadId: req => req.params?.threadId,
  notificationRequestCategory, notificationContextRef: { current: { ready: true } }, notify: event => notified.push(event),
  isThreadWindow: false, isQuickChatWindow: false,
});
listener({ id: 1, generation: 1, method: "item/tool/requestUserInput", params: { threadId: "background" } });
assert.equal(notified[0].category, "question"); assert.equal(notified[0].threadId, "background");
assert.doesNotMatch(notified[0].body, /requestUserInput|ask_user/);
assert.equal(notified[0].valid(), true);
pendingRef.current = []; assert.equal(notified[0].valid(), false, "resolved request invalidates the real App event");
listener({ id: 1, generation: 2, method: "item/commandExecution/requestApproval", params: { threadId: "background" } });
assert.equal(notified[1].category, "permission"); assert.notEqual(notified[0].id, notified[1].id);
assert.doesNotMatch(notified[1].body, /requestApproval/);
assert.doesNotMatch(appSource, /notifyPrefsRef|notifyChime|sendDesktopNotification/);
console.log("PASS NT07: production server-request handler classifies, scopes, rechecks validity and preserves generation identity");

let nativeOptionsNode, automationFinished;
function findNativeNotifications(node) {
  if (ts.isCallExpression(node)) {
    if (node.expression.getText(appAst) === "createNotificationDispatcher") nativeOptionsNode = node.arguments[0];
    if (node.expression.getText(appAst) === "tauriListen" && node.arguments[0]?.text === "automation:run-finished")
      automationFinished = node.arguments[1];
  }
  ts.forEachChild(node, findNativeNotifications);
}
findNativeNotifications(appAst);
assert.ok(nativeOptionsNode); assert.ok(automationFinished);
for (const windowKind of ["main", "thread", "quick"]) {
  const nativeCalls = [], automationEvents = [];
  let inboxWrites = 0, toasts = 0;
  const options = vm.runInNewContext(compile(`(${nativeOptionsNode.getText(appAst)})`), {
    tauriInvoke: async (method, args) => { nativeCalls.push([method, args]); return { sound: "none" }; },
    showAppToast: () => {}, notificationSoundTheme: () => null,
  });
  await options.nativeClaim({ ...event("app-host-claim"), threadId: "t" });
  assert.equal(nativeCalls[0][0], "notification_claim");
  assert.equal(nativeCalls[0][1].eventId, "app-host-claim");
  assert.equal(nativeCalls[0][1].threadId, "t");
  await options.send("title", "body");
  assert.equal(nativeCalls[1][0], "show_desktop_notification");
  const callback = vm.runInNewContext(compile(`(${automationFinished.getText(appAst)})`), {
    disposed: false, isThreadWindow: windowKind === "thread", isQuickChatWindow: windowKind === "quick",
    showAppToast: () => toasts++, setInboxItems: () => inboxWrites++, refreshThreads: () => {},
    notify: value => automationEvents.push(value), notificationContextRef: { current: { ready: true } }, shouldNotifyTurn,
  });
  callback({ id: "job", finishedAt: 42, status: "completed", threadId: "t" });
  assert.equal(automationEvents.length, 1, `${windowKind} can compete after main closes`);
  assert.equal(automationEvents[0].valid(), true);
  assert.equal(inboxWrites, windowKind === "main" ? 1 : 0);
  assert.equal(toasts, windowKind === "main" ? 1 : 0);
}
console.log("PASS CN06: actual App host claim/send callbacks and all-window automation delivery retain single main inbox/toast");

const audioMod = { exports: {} }, contexts = [], timers = new Map();
let timerId = 0;
const audioWindow = { AudioContext: class {
  constructor() { this.currentTime = 0; this.closed = false; contexts.push(this); }
  createOscillator() {
    const parameter = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    return { frequency: parameter, connect() {}, start() {}, stop() {} };
  }
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  async close() { this.closed = true; }
} };
vm.runInNewContext(compile(fs.readFileSync("src/sound.ts", "utf8")), {
  exports: audioMod.exports, window: audioWindow,
  setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
});
const play = audioMod.exports.playNotificationChime;
play("done", "default"); play("done", "classic");
assert.equal(contexts[0].closed, true, "next sound interrupts previous sound");
assert.equal(timers.size, 1);
for (const fn of timers.values()) fn();
assert.equal(contexts[1].closed, true, "finished audio context released");
play("done", "none"); assert.equal(contexts.length, 2);
audioWindow.AudioContext = undefined;
assert.throws(() => play("done", "default"), /不支持音频/);
console.log("PASS NT08: production audio does not overlap, releases contexts, honors none and exposes unavailable audio");

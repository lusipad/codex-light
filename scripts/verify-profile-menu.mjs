import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function createResultsTracker() {
  const findings = {}, results = {};
  const options = { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/reviewFindings.ts", "utf8"), options).outputText, { exports: findings });
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/reviewResults.ts", "utf8"), options).outputText, {
    exports: results, require: () => findings,
  });
  return results.createReviewResults(() => {});
}

// Execute the production component/handlers. Browser popover defaults and native
// focus movement are intentionally verified separately in the built application.
const source = fs.readFileSync("src/components/NavigationRail.tsx", "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const all = node => node && typeof node === "object" ? [node, ...node.children.flatMap(all)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "string" ? node : "";

function mount(accountInfo, overrides = {}) {
  let cursor = 0, active = null, opened = false;
  const hooks = [], calls = [], frames = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useId: () => "test",
    useRef: value => { const i = cursor++; return hooks[i] ??= { current: value }; },
    useState: initial => { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }]; },
  };
  const module = { exports: {} };
  const document = { get activeElement() { return active; }, getElementById: () => popover };
  vm.runInNewContext(code, {
    exports: module.exports, require: name => name === "react" ? react : {},
    document, window: { innerHeight: 900 }, requestAnimationFrame: callback => frames.push(callback),
  });
  const props = {
    activeRoute: "home", sidebarCollapsed: false, unreadInboxCount: 0, appServerConnected: true, accountInfo,
    onNavigate: route => calls.push(["navigate", route]), onOpenUsage: () => calls.push(["usage"]),
    onCommand: command => calls.push(["command", command]), onTogglePet: () => calls.push(["pet"]),
    ...overrides,
  };
  const render = () => {
    cursor = 0;
    return module.exports.NavigationRail(props);
  };
  const nodes = () => all(render());
  const menu = () => nodes().find(n => n.props["aria-label"] === "个人资料菜单");
  const items = () => menu().children.filter(n => n?.type === "button" && !n.props.disabled);
  const triggerNode = () => nodes().find(n => n.props["aria-label"] === "打开个人资料菜单");
  const trigger = {
    focus: () => { active = trigger; calls.push(["trigger-focus"]); },
    getBoundingClientRect: () => ({ right: 52, top: 850 }),
    getAttribute: name => name === "popovertarget" ? "test-profile" : null,
  };
  const buttonElements = () => items().map((node, index) => ({
    node, index, focus() { active = this; },
    closest: () => popover,
  }));
  let buttons = buttonElements();
  const popover = {
    id: "test-profile",
    matches: selector => selector === ":popover-open" && opened,
    contains: element => buttons.includes(element),
    querySelectorAll: () => buttons,
    querySelector: () => buttons[0],
    showPopover: () => { opened = true; },
    hidePopover: () => { opened = false; },
  };
  triggerNode().props.ref(trigger);
  const key = (handler, key, currentTarget = popover) => {
    let prevented = false, stopped = false;
    handler({ key, currentTarget, preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
    return { prevented, stopped };
  };
  const toggle = state => {
    opened = state === "open";
    menu().props.onToggle({ currentTarget: popover, nativeEvent: { newState: state } });
  };
  return { render, menu, items, triggerNode, trigger, popover, buttons, key, toggle, calls, props,
    flush: () => { for (const frame of frames.splice(0)) frame(); },
    get active() { return active; }, focus: element => { active = element; } };
}

const chat = mount({ account: { type: "chatgpt", email: "parity@example.invalid", planType: "plus" }, requiresOpenaiAuth: true });
assert.ok(text(chat.menu()).includes("parity@example.invalid"), "profile must use real account/read identity");
assert.ok(!text(chat.menu()).includes("Codex Native"));
assert.ok(!text(chat.menu()).includes("app-server"));
assert.ok(text(chat.menu()).includes("使用情况"));
for (const [type, label] of [["apiKey", "已通过 API 密钥登录"], ["amazonBedrock", "已使用 Amazon Bedrock 登录"]]) {
  const view = mount({ account: { type }, requiresOpenaiAuth: false });
  assert.ok(text(view.menu()).includes(label), type);
  assert.ok(!text(view.menu()).includes("使用情况"), "non-ChatGPT must not advertise ChatGPT usage");
}
for (const info of [null, { account: null, requiresOpenaiAuth: true }]) {
  const view = mount(info);
  assert.ok(text(view.menu()).includes("设置"));
  assert.ok(!text(view.menu()).includes("Codex Native"));
  assert.ok(!text(view.menu()).includes("使用情况"));
}
const disconnected = mount(chat.props.accountInfo, { appServerConnected: false });
assert.ok(!text(disconnected.menu()).includes("parity@example.invalid"), "disconnected identity must not look current");

const pointerOpen = mount(chat.props.accountInfo);
pointerOpen.focus(pointerOpen.trigger);
pointerOpen.toggle("open");
pointerOpen.key(pointerOpen.triggerNode().props.onKeyDown, "ArrowDown", pointerOpen.trigger);
assert.equal(pointerOpen.active, pointerOpen.buttons[0], "ArrowDown must enter an already pointer-open menu too");

chat.focus(chat.trigger);
assert.equal(chat.key(chat.triggerNode().props.onKeyDown, "ArrowDown", chat.trigger).prevented, true);
chat.toggle("open"); chat.flush();
assert.equal(chat.active, chat.buttons[0]);
assert.equal(chat.triggerNode().props["aria-expanded"], true);
chat.focus({});
chat.key(chat.menu().props.onKeyDown, "ArrowUp");
assert.equal(chat.active, chat.buttons.at(-1), "ArrowUp from outside starts at last item");
chat.key(chat.menu().props.onKeyDown, "ArrowDown");
assert.equal(chat.active, chat.buttons[0]);
chat.key(chat.menu().props.onKeyDown, "End");
assert.equal(chat.active, chat.buttons.at(-1));
chat.key(chat.menu().props.onKeyDown, "Home");
assert.equal(chat.active, chat.buttons[0]);
assert.equal(chat.key(chat.menu().props.onKeyDown, "Escape").stopped, true);
assert.equal(chat.active, chat.trigger);
chat.toggle("closed");
assert.equal(chat.triggerNode().props["aria-expanded"], false);

const outside = {};
chat.focus(outside); chat.toggle("closed"); chat.flush();
assert.equal(chat.active, outside, "light dismiss must not steal outside focus");
chat.key(chat.triggerNode().props.onKeyDown, "ArrowDown", chat.trigger);
chat.toggle("open");
chat.toggle("closed"); chat.focus(outside); chat.flush();
assert.equal(chat.active, outside, "queued opening focus must not run after close");
chat.toggle("open"); chat.focus(chat.buttons[0]);
assert.equal(chat.key(chat.menu().props.onKeyDown, "Tab").prevented, false, "Tab must retain browser focus traversal");
chat.toggle("closed"); chat.focus(outside); chat.flush();
assert.equal(chat.active, outside);

for (const [label, expected] of [["使用情况", ["usage"]], ["显示 Mini", ["pet"]], ["设置", ["navigate", "settings"]]]) {
  const view = mount(chat.props.accountInfo);
  view.toggle("open");
  const item = view.items().find(n => text(n).startsWith(label));
  item.props.onClick({ currentTarget: { closest: () => view.popover } });
  view.toggle("closed"); view.focus(outside); view.flush();
  assert.deepEqual(view.calls, [expected]);
  assert.equal(view.active, outside);
}
console.log("PASS profile identity, account variants, keyboard navigation, dismissal focus and single-dispatch actions (L2)");

const appSource = fs.readFileSync("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let refresh, updated, disconnectedBlock;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "refreshAccount") refresh = node.initializer.arguments[0].getText(ast);
  if (ts.isIfStatement(node) && node.expression.getText(ast) === "method === NOTIFICATION.ACCOUNT_UPDATED") updated = node.thenStatement.getText(ast);
  if (ts.isIfStatement(node) && node.expression.getText(ast) === "!status.connected") disconnectedBlock = node.thenStatement.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(refresh && updated, "test must execute the real account refresh and notification handlers");
const reads = [], accountWrites = [], limitsWrites = [];
const context = vm.createContext({
  reviewReconnectRevision: 0, reviewResultsRef: { current: createResultsTracker() },
  accountReadRequestRef: { current: 0 },
  pendingRequestRevisionRef: { current: 0 }, setPendingRequests() {}, setRequestResponses() {},
  setAccountInfo: value => accountWrites.push(value),
  setRateLimits: value => limitsWrites.push(value),
  callAppServer: method => method === "account/read"
    ? new Promise((resolve, reject) => reads.push({ resolve, reject }))
    : Promise.resolve({ source: "limits" }),
  console: { warn() {} },
});
const transpile = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInContext(transpile(`var refreshAccount = ${refresh}; var handleUpdated = () => ${updated}; var handleDisconnect = () => ${disconnectedBlock};`), context);
const older = context.refreshAccount(), newer = context.refreshAccount();
reads[1].resolve({ account: { type: "apiKey" }, requiresOpenaiAuth: false });
await newer;
reads[0].resolve({ account: { type: "chatgpt", email: "old@example.invalid" }, requiresOpenaiAuth: true });
await older;
assert.equal(accountWrites.length, 1, "older account read must not overwrite newer identity");
assert.equal(accountWrites[0].account.type, "apiKey");
context.handleUpdated();
assert.equal(accountWrites.at(-1), null, "account notification must clear old identity immediately");
assert.equal(reads.length, 3, "account notification must re-read instead of merging authMode into stale identity");
reads[2].reject(new Error("isolated failure"));
await new Promise(resolve => setImmediate(resolve));
assert.equal(accountWrites.at(-1), null, "failure must not revive the previous identity");
assert.ok(limitsWrites.length);
const inFlight = context.refreshAccount();
context.handleDisconnect();
const disconnectedWrites = accountWrites.length;
reads[3].resolve({ account: { type: "apiKey" }, requiresOpenaiAuth: false });
await inFlight;
assert.equal(accountWrites.length, disconnectedWrites, "read started before disconnect must not republish identity");
assert.equal(accountWrites.at(-1), null);
console.log("PASS actual account refresh/notification callbacks: stale read rejection, identity invalidation and read failure (L2)");

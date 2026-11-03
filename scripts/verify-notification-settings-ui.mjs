import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute production JSX callbacks and effects. This replay is not native/UI pixel evidence.
const source = ts.transpileModule(fs.readFileSync("src/components/NotificationSettings.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const custom = { fileName: `codex-custom-${"a".repeat(64)}.wav`, name: "中文提示音.mp3" };
function mount() {
  const hooks = [], effects = [], listeners = new Map();
  let cursor = 0, tree, focuses = 0, stops = 0;
  const calls = [], writes = [], plays = [];
  let permission = async () => ({ status: "enabled" });
  let imported = async () => custom;
  let play = async () => {};
  let openSettings = async () => {};
  let save = async (key, value) => { state.preferences[key] = value; return true; };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], v => hooks[i] = typeof v === "function" ? v(hooks[i]) : v]; },
    useRef(initial) { const i = cursor++; return hooks[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++, old = hooks[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) { old?.cleanup?.(); hooks[i] = { deps }; effects.push(() => hooks[i].cleanup = fn()); } },
  };
  const state = { preferences: { "notifications-turn-mode": "unfocused", "notifications-permissions-enabled": true,
    "notifications-questions-enabled": true, "notifications-dot-enabled": true, "notifications-sound": "default" }, busy: false, error: null,
    async save(key, value) { writes.push({ key, value }); return save(key, value); }, reload() {},
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { exports: module.exports, require(name) {
    if (name === "react") return react;
    if (name === "../bridge") return { tauriInvoke: async command => { calls.push(command); if (command === "notification_permission_read") return permission(); if (command === "notification_settings_open") return openSettings(); throw Error(command); } };
    if (name === "../sound") return { importNotificationSound: () => imported(), playNotificationChime: (...args) => { plays.push(args); return play(); }, stopNotificationSound: async () => { stops++; } };
    return {};
  }, window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) } });
  const walk = node => node && typeof node === "object" ? [node, ...node.children.flatMap(walk)] : [];
  const text = node => typeof node === "string" ? node : node && typeof node === "object" ? node.children.map(text).join("") : "";
  const render = () => {
    cursor = 0; tree = module.exports.NotificationSettings({ state });
    for (const node of walk(tree)) if (node.props.ref) node.props.ref.current = { focus() { assert.equal(!!node.props.disabled, false, "restore focus only after the control is enabled"); focuses++; } };
    for (const effect of effects.splice(0)) effect();
    return tree;
  };
  const find = predicate => walk(render()).find(predicate);
  const select = () => find(node => node.props.id === "notifications-sound");
  const button = label => find(node => node.type === "button" && text(node) === label);
  const alerts = () => walk(render()).filter(node => node.props.role === "alert").map(text).join(" ");
  render();
  return { state, render, find, select, button, alerts, calls, writes, plays, listeners,
    get stops() { return stops; }, get focuses() { return focuses; },
    openSettings: fn => openSettings = fn, permission: fn => permission = fn, imported: fn => imported = fn, play: fn => play = fn, save: fn => save = fn,
    unmount() { for (const hook of hooks) hook?.cleanup?.(); },
  };
}
const controls = mount(); await flush(); controls.render();
const turnMode = () => controls.find(node => node.props.id === "notification-turn-mode");
turnMode().props.onChange({ target: { value: "off" } }); await flush();
assert.deepEqual(controls.writes.at(-1), { key: "notifications-turn-mode", value: "off" }, "actual turn-mode callback saves selected mode");
assert.equal(turnMode().props.value, "off", "turn-mode control reflects confirmed preference");
for (const key of ["notifications-questions-enabled", "notifications-dot-enabled"]) {
  const checkbox = () => controls.find(node => node.props.id === key);
  checkbox().props.onChange({ target: { checked: false } }); await flush();
  assert.deepEqual(controls.writes.at(-1), { key, value: false }, `${key} actual callback saves false, independently of turn off`);
  assert.equal(checkbox().props.checked, false);
  checkbox().props.onChange({ target: { checked: true } }); await flush();
  assert.deepEqual(controls.writes.at(-1), { key, value: true }, `${key} actual callback saves true`);
  assert.equal(checkbox().props.checked, true);
}
assert.equal(controls.state.preferences["notifications-turn-mode"], "off", "question/Dot toggles do not change turn notification mode");
assert.equal(controls.state.preferences["notifications-permissions-enabled"], true, "unrelated permission preference remains unchanged");
controls.unmount();
const page = mount(); await flush(); page.render();
assert.deepEqual(page.calls, ["notification_permission_read"], "mount queries real OS status without opening settings");
assert.equal(page.button("发送测试通知"), undefined, "no unsupported test-notification action");
assert.ok(page.select().children.some(option => option.props?.value === "import"));
const denied = deferred(), enabled = deferred();
page.permission(() => denied.promise); const oldQuery = page.listeners.get("focus")();
page.permission(() => enabled.promise); const newQuery = page.listeners.get("focus")();
enabled.resolve({ status: "enabled" }); await newQuery;
denied.resolve({ status: "disabled" }); await oldQuery; page.render();
assert.equal(page.select().props.disabled, false, "late permission result cannot overwrite newer focus refresh");
page.permission(async () => ({ status: "disabled" })); await page.listeners.get("focus")();
assert.equal(page.select().props.disabled, true);
page.permission(async () => ({ status: "unknown" })); await page.listeners.get("focus")();
assert.ok(page.find(node => node.type === "p" && node.children.includes("无法确认 Windows 通知权限状态")), "unknown is not reported as enabled");
assert.equal(page.button("打开 Windows 设置"), undefined, "unknown does not invent a system-settings entry");
page.permission(async () => ({ status: "not-determined" })); await page.listeners.get("focus")();
await page.button("打开 Windows 设置").props.onClick();
assert.equal(page.calls.filter(call => call === "notification_settings_open").length, 1);
page.openSettings(async () => { throw Error("denied"); });
await page.button("打开 Windows 设置").props.onClick();
assert.match(page.alerts(), /无法打开 Windows 设置.*denied/);
page.permission(async () => { throw Error("unavailable"); }); await page.listeners.get("focus")();
assert.equal(page.select().props.disabled, false, "permission failure remains unknown rather than disabling preferences");
assert.equal(page.button("打开 Windows 设置"), undefined);
assert.ok(page.find(node => node.props.id === "notifications-dot-enabled"), "official Dot preference is retained without inventing events");
page.imported(async () => null);
await page.select().props.onChange({ target: { value: "import" } }); await flush(); page.render();
assert.equal(page.writes.length, 0, "cancelled native picker cannot change preference");
assert.equal(page.state.preferences["notifications-sound"], "default");
const imported = deferred(); page.imported(() => imported.promise);
page.select().props.onChange({ target: { value: "import" } }); await flush(); page.render();
assert.equal(page.select().props.disabled, true, "pending import blocks duplicate selection");
imported.resolve(custom); await flush(); page.render();
assert.equal(page.state.preferences["notifications-sound"], custom);
assert.equal(page.select().props.value, "custom");
assert.ok(page.focuses > 0, "picker completion restores enabled sound control focus");
assert.deepEqual(page.writes[0], { key: "notifications-sound", value: custom });
await flush(); page.render();
assert.equal(page.plays.length, 1, "confirmed custom import previews exactly once");
assert.equal(page.plays[0][1], custom);
assert.equal(page.button("试听声音"), undefined, "no unofficial preview button");
page.save(async () => false);
page.imported(async () => ({ ...custom, name: "another.wav" }));
await page.select().props.onChange({ target: { value: "import" } }); await flush(); page.render();
assert.equal(page.state.preferences["notifications-sound"], custom, "unconfirmed save cannot select the imported sound");
assert.match(page.alerts(), /无法更改通知提示音/);
page.imported(async () => { throw Error("invalid audio"); });
await page.select().props.onChange({ target: { value: "import" } }); await flush();
assert.match(page.alerts(), /无法导入此提示音.*invalid audio/);
const preview = deferred(); page.play(() => preview.promise);
page.save(async (key, value) => { page.state.preferences[key] = value; return true; });
await page.select().props.onChange({ target: { value: "classic" } }); await flush(); page.render(); await flush();
assert.equal(page.plays.at(-1)[1], "classic", "ordinary sound selection previews after successful save");
page.state.preferences["notifications-sound"] = "none"; const stoppedBefore = page.stops; page.render();
assert.ok(page.stops > stoppedBefore, "changing selection cancels active audio");
preview.reject(Error("old preview")); await flush();
assert.doesNotMatch(page.alerts(), /old preview/, "stale preview error cannot contaminate new selection");
assert.equal(page.button("试听声音"), undefined);
page.unmount(); assert.equal(page.listeners.size, 0, "focus listener released on unmount");
const gone = mount(); await flush(); gone.render();
const lateImport = deferred(); gone.imported(() => lateImport.promise);
gone.select().props.onChange({ target: { value: "import" } }); await flush();
gone.unmount(); lateImport.resolve(custom); await flush();
assert.equal(gone.writes.length, 0, "picker completion after leaving page cannot save");
assert.ok(gone.stops >= 2, "unmount stops playback");
console.log("Notification settings UI: permission/focus races, true save/cancel/failure, async preview and unmount replay passed");

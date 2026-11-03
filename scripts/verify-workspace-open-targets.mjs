import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(fs.readFileSync("src/workspaceOpenTargets.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const plain = value => JSON.parse(JSON.stringify(value));
function mount(initial = { threadId: "chat-a", cwd: "D:/stale" }) {
  let cursor = 0, value, props = initial;
  const hooks = [], cleanups = [], calls = [], errors = [];
  const react = {
    useState: initial => { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], next => { hooks[i] = next; }]; },
    useRef: initial => { const i = cursor++; return hooks[i] ??= { current: initial }; },
    useCallback: (fn, deps) => { const i = cursor++; if (!hooks[i] || deps.some((d, n) => d !== hooks[i].deps[n])) hooks[i] = { fn, deps }; return hooks[i].fn; },
    useEffect: (fn, deps) => { const i = cursor++; if (!hooks[i] || deps.some((d, n) => d !== hooks[i][n])) { hooks[i] = deps; cleanups[i]?.(); cleanups[i] = fn(); } },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { exports: module.exports, require: name => name === "react" ? react : {
    tauriInvoke: (command, args) => new Promise((resolve, reject) => calls.push({ command, args, resolve, reject })),
  } });
  const render = next => { props = next ?? props; cursor = 0; value = module.exports.useWorkspaceOpenTargets({ ...props, onError: error => errors.push(error) }); return value; };
  render();
  return { render, calls, errors, unmount: () => cleanups.forEach(fn => fn?.()) };
}
const result = (cwd = "D:/latest") => ({ cwd, preferredTarget: "editor", targets: [
  { id: "files", label: "Files", executable: "explorer.exe" },
  { id: "hidden", label: "Hidden", executable: "hidden.exe", hidden: true },
  { id: "missing", label: "Missing", executable: "missing.exe", available: false },
  { id: "editor", label: "Editor", executable: "editor.exe", available: true },
] });

const menu = mount();
menu.render().onMenuOpenChange(true);
assert.equal(menu.render().items[0].disabled, true);
assert.deepEqual(plain(menu.calls[0].args), { threadId: "chat-a", cwd: null }, "thread root must resolve in backend, not activeWorkspace");
menu.calls[0].resolve(result()); await settle();
assert.deepEqual(plain(menu.render().items.map(({ id, checked }) => ({ id, checked }))), [
  { id: "open_target:files", checked: false }, { id: "open_target:editor", checked: true },
], "metadata ordering, visibility, availability and preference preserved");
// The real shared menu closes synchronously before dispatching the selected ID.
menu.render().onMenuOpenChange(false);
const opening = menu.render().openTarget("editor");
void menu.render().openTarget("editor");
assert.equal(menu.calls.length, 2, "synchronous duplicate click must not launch twice");
assert.equal(menu.calls[1].command, "desktop_open_workspace");
assert.deepEqual(plain(menu.calls[1].args), { threadId: "chat-a", cwd: null, target: "editor" }, "opening re-resolves latest root without cached query cwd");
menu.calls[1].reject(new Error("target disappeared")); await opening;
assert.match(menu.errors[0], /target disappeared/);
await menu.render().openTarget("unknown");
assert.equal(menu.calls.length, 2, "explicit unknown ID cannot fall back");
assert.equal(menu.errors.length, 2);

menu.render().onMenuOpenChange(true);
menu.calls[2].reject(new Error("offline")); await settle();
assert.match(menu.render().items[0].label, /失败/);
assert.equal(menu.render().items[0].disabled, true);
menu.render().onMenuOpenChange(false); menu.render().onMenuOpenChange(true);
menu.calls[3].resolve({ ...result(), targets: [] }); await settle();
assert.equal(menu.render().items, null, "empty directory must not invent an editor or internal terminal");
menu.unmount();

const stale = mount();
stale.render().onMenuOpenChange(true); stale.render().onMenuOpenChange(false);
stale.calls[0].resolve(result()); await settle();
assert.equal(stale.render().items[0].disabled, true, "closed query must be ignored");
stale.render().onMenuOpenChange(true);
const old = stale.render().openTarget;
stale.render({ threadId: "chat-b", cwd: "E:/other" }).onMenuOpenChange(true);
await old("editor");
assert.equal(stale.calls.length, 3, "old closure cannot launch even before new query resolves");
stale.calls[1].resolve(result()); await settle();
assert.equal(stale.render().items[0].disabled, true, "old thread query cannot populate current thread");
stale.calls[2].resolve(result("E:/worktree")); await settle();
await old("editor");
assert.equal(stale.calls.length, 3, "stale handlers cannot open the new context targets");
const late = stale.render().openTarget("editor");
stale.render({ threadId: null, cwd: "F:/standalone" }).onMenuOpenChange(true);
assert.deepEqual(plain(stale.calls[4].args), { threadId: null, cwd: "F:/standalone" });
stale.calls[3].reject(new Error("old context failure")); await late;
assert.equal(stale.errors.length, 0, "late error cannot report into another context");
stale.unmount(); stale.calls[4].reject(new Error("unmounted")); await settle();
assert.equal(stale.errors.length, 0);

const success = mount({ cwd: "D:/project" });
success.render().onMenuOpenChange(true); success.calls[0].resolve(result()); await settle();
const done = success.render().openTarget("files"); success.calls[1].resolve(); await done;
assert.equal(success.errors.length, 0, "successful request does not manufacture an error or success toast");
success.unmount();

const switched = mount();
switched.render().onMenuOpenChange(true); switched.calls[0].resolve(result()); await settle();
const oldSelection = switched.render().openTarget;
switched.render({ threadId: "chat-c", cwd: "D:/new-project" });
await oldSelection("editor");
assert.equal(switched.calls.length, 1, "a previously valid detection cannot authorize an old-context closure");
assert.equal(switched.render().items[0].disabled, true, "context switches hide the old targets immediately");
switched.unmount();
await switched.render().openTarget("editor");
assert.equal(switched.calls.length, 1, "unmounted selections cannot invoke the backend");

for (const invalid of [null, {}, { ...result(), targets: {} }, { ...result(), targets: [null] },
  { ...result(), targets: [{ id: {}, label: "Invalid", executable: "app.exe" }] },
  { ...result(), targets: [{ id: "bad", label: [], executable: "app.exe" }] },
  { ...result(), targets: [{ id: "bad", label: "Bad", executable: null }] },
  { ...result(), targets: [{ id: "bad", label: "Bad", executable: "app.exe", available: "yes" }] },
  { ...result(), targets: [result().targets[0], result().targets[0]] }]) {
  const malformed = mount(); malformed.render().onMenuOpenChange(true);
  malformed.calls[0].resolve(invalid); await settle();
  assert.match(malformed.render().items[0].label, /失败/, "invalid IPC metadata becomes query error, not render-time crash");
  await malformed.render().openTarget("bad");
  assert.equal(malformed.calls.length, 1, "invalid metadata cannot authorize a target");
  malformed.unmount();
}

const windows = mount({ threadId: "windows-chat", cwd: "C:/project" });
windows.render().onMenuOpenChange(true);
windows.calls[0].resolve({ cwd: "C:/project", preferredTarget: "fileManager", targets: [
  { id: "systemDefault", label: "系统默认应用", executable: "", kind: "systemDefault", hidden: true, available: true },
  { id: "fileManager", label: "文件资源管理器", executable: "C:/Windows/explorer.exe", kind: "fileManager", hidden: false, available: true },
] });
await settle();
assert.deepEqual(plain(windows.render().items), [{ id: "open_target:fileManager", label: "文件资源管理器", type: "radio", checked: true }], "real Windows metadata permits the hidden system-association target's empty executable");
windows.render().onMenuOpenChange(false);
const windowsOpen = windows.render().openTarget("fileManager");
assert.equal(windows.calls[1].command, "desktop_open_workspace");
assert.equal(windows.calls[1].args.target, "fileManager");
windows.calls[1].resolve(); await windowsOpen;
assert.equal(windows.errors.length, 0);
windows.unmount();
console.log("PASS actual workspace target hook: dynamic metadata, thread/latest-root request, loading/error/retry/empty, close and context races, explicit selection, duplicate prevention and genuine failures (L2)");

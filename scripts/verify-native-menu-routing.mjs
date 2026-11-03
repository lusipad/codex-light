import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const listeners = [], callbacks = new Map();
let label = "main", next = 0;
global.window = { __TAURI_INTERNALS__: {
  metadata: { get currentWebview() { return { label }; }, get currentWindow() { return { label }; } },
  transformCallback: callback => { callbacks.set(++next, callback); return next; },
  invoke: async (command, args) => {
    assert.equal(command, "plugin:event|listen");
    listeners.push(args); return listeners.length;
  },
} };
const bridge = { isTauriRuntime: () => true,
  tauriListen: async (event, callback) => require("@tauri-apps/api/event").listen(event, event => callback(event.payload)) };
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/nativeShell.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports, console, require: name => name === "./bridge" ? bridge : require(name) });
const selected = [];
await exports.installNativeMenuHandler({ "new-chat": () => selected.push("main") });
label = "thread-a"; await exports.installNativeMenuHandler({ "new-chat": () => selected.push("thread-a") });
assert.deepEqual(listeners.map(listener => listener.target), [{ kind: "WebviewWindow", label: "main" }, { kind: "WebviewWindow", label: "thread-a" }],
  "execute installed Tauri API: menu subscriptions must not use its default Any target");
// Mirror the documented Any match in the Rust event dispatcher; only thread-a should act.
for (const listener of listeners) if (listener.target.kind === "Any" || listener.target.label === "thread-a") {
  callbacks.get(listener.handler)({ payload: { id: "new-chat" } });
}
assert.deepEqual(selected, ["thread-a"]);
await exports.installTrayHandler({ "new-chat": () => {} });
assert.equal(listeners.at(-1).target.kind, "Any", "tray and backend global broadcast subscriptions remain global");
delete global.window;
console.log("PASS native menu uses actual installed Tauri window-scoped subscriptions, target window acts once, tray stays global; native OS routing still requires runtime verification.");

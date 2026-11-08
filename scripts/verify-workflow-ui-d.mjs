import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const all = node => node && typeof node === "object" ? [node, ...(node.children || []).flatMap(all)] : [];
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const exports = {}, hooks = [];
let cursor = 0, tree, closed = 0, selected = 0;
const react = { Fragment: "fragment", createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState(value) { const i = cursor++; if (!(i in hooks)) hooks[i] = value; return [hooks[i], next => { hooks[i] = typeof next === "function" ? next(hooks[i]) : next; }]; },
  useRef(value) { const i = cursor++; return hooks[i] ??= { current: value }; },
  useMemo(fn) { cursor++; return fn(); }, useCallback(fn) { cursor++; return fn; }, useEffect() { cursor++; },
};
vm.runInNewContext(compile(fs.readFileSync("src/components/QuickSearchModal.tsx", "utf8")), {
  exports, console, require: id => id === "react" ? react : id === "lucide-react" ? new Proxy({}, { get: (_, name) => String(name) }) :
    id.endsWith("slashCommands") ? { SLASH_COMMANDS: [] } : id === "../bridge" ? { isTauriRuntime: () => true } : {},
});
const props = { open: true, mode: "root", initialQuery: { value: "" }, threads: [{ id: "thread-a", name: "Existing conversation" }], skills: [],
  onClose() { closed++; }, onSelectThread(id) { assert.equal(id, "thread-a"); selected++; },
  onStartNewChat() {}, onTriggerCommand() {}, onNavigateRoute() {}, onNavigateSettings() {}, onSearchFiles() {}, onSearchChats() {},
};
const render = () => { cursor = 0; tree = exports.QuickSearchModal(props); };
render();
let dialog = all(tree).find(node => node.props.role === "dialog");
assert.equal(dialog?.props["aria-label"], "命令菜单", "named production command dialog");
assert.equal(all(tree).find(node => node.type === "input").props.placeholder, "搜索聊天或运行命令");
assert.ok(!/\((?:Quick actions|Chats|Skills|Files|Settings)\)/.test(text(tree)), "current Chinese presentation has no invented English suffixes");
all(tree).find(node => node.type === "input").props.onChange({ target: { value: "Existing" } }); render();
dialog = all(tree).find(node => node.props.role === "dialog");
const row = all(tree).find(node => node.props.className?.includes("quick-search-row") && text(node).includes("Existing conversation"));
assert.ok(row, "real existing conversation is retained among results");
row.props.onClick(); assert.equal(selected, 1); assert.equal(closed, 1);
const key = patch => ({ key: "Escape", nativeEvent: {}, preventDefault() {}, ...patch });
dialog.props.onKeyDown(key({ nativeEvent: { isComposing: true } })); assert.equal(closed, 1);
dialog.props.onKeyDown(key({})); assert.equal(closed, 2);
props.mode = "files"; render();
assert.equal(all(tree).find(node => node.type === "input").props.placeholder, "搜索文件");
props.initialQuery = { value: "src/测试.rs" }; render();
const searchInput = () => all(tree).find(node => node.type === "input");
assert.equal(searchInput().props.value, "src/测试.rs", "shortcut seed replaces the old draft on the first render");
searchInput().props.onChange({ target: { value: "edited" } }); render();
assert.equal(searchInput().props.value, "edited");
props.initialQuery = { value: "src/测试.rs" }; render();
assert.equal(searchInput().props.value, "src/测试.rs", "a repeated opening can restore the same seed");
props.mode = "root"; props.initialQuery = { value: "" }; render();
assert.equal(searchInput().props.value, "", "root opening never leaks a files seed");
props.mode = "chats"; render();
assert.equal(searchInput().props.placeholder, "搜索聊天");
assert.ok(!all(tree).some(node => node.props.className === "quick-search-scope-trigger"), "chat-only mode hides the file scope selector");
const chatRows = all(tree).filter(node => node.props.className?.split(" ").includes("quick-search-row"));
assert.equal(chatRows.length, 1);
assert.match(text(chatRows[0]), /Existing conversation/);
console.log("PASS WFD08 production command dialog: current Chinese scopes, real selection, close and IME boundary");

const appSource = fs.readFileSync("src/App.tsx", "utf8");
const app = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let themeCallback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === "cycleTheme") themeCallback = node.initializer.arguments[0].getText(app);
  ts.forEachChild(node, visit);
}
visit(app);
const routes = [], sections = [], writes = [];
await vm.runInNewContext(compile(`(${themeCallback})`), { console,
  setSettingsInitialSection: value => sections.push(value), setActiveRoute: value => routes.push(value),
  tauriInvoke: (...args) => { writes.push(args); throw new Error("legacy theme path must never run"); },
  showAppToast() {}, applyColorTheme() { throw new Error("legacy tokens must never override appearance preferences"); },
})();
assert.deepEqual(routes, ["settings"]); assert.deepEqual(sections, ["appearance"]); assert.deepEqual(writes, []);
assert.ok(!appSource.includes('key: "colorTheme"'), "startup and commands cannot reapply legacy colorTheme after current appearance");
assert.ok(!fs.readFileSync("src/components/AppTitleBar.tsx", "utf8").includes('id: "toggle-theme"'), "unproven palette cycle is absent from normal menu");
console.log("PASS WFD01/23 legacy theme event opens real appearance settings without writing or overriding current preferences");

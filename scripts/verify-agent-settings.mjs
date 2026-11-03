import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const transpile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
let active;
const document = { activeElement: null, listeners: new Map(),
  addEventListener(name, handler) { this.listeners.set(name, handler); },
  removeEventListener(name, handler) { if (this.listeners.get(name) === handler) this.listeners.delete(name); },
};
const react = {
  Fragment: Symbol("Fragment"),
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState(initial) {
    const host = active, index = host.index++;
    if (!(index in host.slots)) host.slots[index] = initial;
    return [host.slots[index], value => { host.slots[index] = typeof value === "function" ? value(host.slots[index]) : value; }];
  },
  useRef(initial) {
    const host = active, index = host.index++;
    return host.slots[index] ||= { current: initial };
  },
  useEffect(callback, deps) {
    const host = active, index = host.index++, previous = host.effects[index];
    if (!previous || !deps || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
      previous?.cleanup?.(); host.effects[index] = { deps, callback };
      host.pending.push(index);
    }
  },
};
function load(path, imports, extra = "") {
  const exports = {};
  vm.runInNewContext(transpile(fs.readFileSync(path, "utf8")) + extra, {
    exports, document, require: name => name === "react" ? react : name.endsWith(".css") ? {} : imports[name],
  });
  return exports;
}
const core = load("src/agentConfiguration.ts", {
  "./bridge": {}, "./config": { getConfigValue: (raw, key) => key.split(".").reduce((value, part) => value?.[part], raw) },
});
let state, receivedOptions;
const mod = load("src/components/AgentSettings.tsx", {
  "../agentConfiguration": { useAgentConfiguration: options => { receivedOptions = options; return state; } },
  "./Icons": { CheckIcon: () => null, ChevronDownIcon: () => null, ExternalWindowIcon: () => null },
}, "\nexports.ConfigurationMenu = ConfigurationMenu;");
const nodes = node => node && typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : [];
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
function harness(Component, initialProps) {
  const host = { slots: [], effects: [], pending: [], index: 0, props: initialProps };
  host.render = (props = host.props) => {
    host.props = props; host.index = 0; host.pending = []; active = host;
    host.tree = Component(props);
    return host.tree;
  };
  host.flush = () => { for (const index of host.pending) host.effects[index].cleanup = host.effects[index].callback(); host.pending = []; };
  host.unmount = () => host.effects.forEach(effect => effect.cleanup?.());
  host.render(); host.flush(); return host;
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const scopes = [
  { id: "project:test", kind: "project", label: "test", filePath: "C:/isolated/test/.codex/config.toml", version: "p1", config: {}, disabledReason: null, cwd: "C:/isolated/test" },
  { id: "user", kind: "user", label: "用户配置", filePath: "C:/isolated/config.toml", version: "u1", config: {}, disabledReason: null },
  { id: "managed", kind: "managed", label: "管理员配置", filePath: null, version: null, config: {}, disabledReason: null },
];
let data = { snapshot: { config: { approval_policy: "on-failure", sandbox_mode: "workspace-write", sandbox_workspace_write: { network_access: true } }, origins: {}, layers: [] }, requirements: null, serverVersion: "0.166.0-alpha.5.1", scopes };
const changes = [], selections = [];
let opened = 0, reloaded = 0, refreshed = 0;
function reset(scope = scopes[0]) {
  state = { data, scopes, scope, selectedScopeId: scope.id, fields: core.agentConfigurationFields(data, scope), loading: false,
    pendingKey: null, errors: {}, selectScope: id => selections.push(id),
    change: async (key, value) => { changes.push([key, value]); return true; },
    openConfig: async () => { opened++; }, reload: async () => { reloaded++; } };
}
reset();
const ui = harness(mod.AgentSettings, { cwd: "C:/isolated/test", accountIdentity: "account-one", onConfigUpdated: () => { refreshed++; } });
const control = key => nodes(ui.tree).find(node => node.props.id === `agent-${key}`);
const visibleLabels = () => nodes(ui.tree).filter(node => node.type === "label").map(text);
assert.deepEqual(visibleLabels(), ["批准策略", "沙盒设置", "允许网络访问", "网页搜索", "输出详细程度", "推理摘要"]);
assert.equal(receivedOptions.cwd, "C:/isolated/test"); assert.equal(receivedOptions.accountIdentity, "account-one");
assert.equal(nodes(ui.tree).some(node => /保存更改|默认模型|推理强度|审批审查方/.test(text(node))), false);
const scopeMenu = () => nodes(ui.tree).find(node => node.props.id === "agent-config-scope");
assert.deepEqual(Array.from(scopeMenu().props.options, option => option.group), ["项目配置", "全局配置", "全局配置"]);
scopeMenu().props.onSelect("user"); assert.deepEqual(selections, ["user"]);
nodes(ui.tree).find(node => node.type === "button" && text(node).includes("打开 config.toml")).props.onClick();
await settle(); assert.equal(opened, 1);
control("model_verbosity").props.onSelect("high"); await settle();
assert.deepEqual(changes.at(-1), ["model_verbosity", "high"]); assert.equal(refreshed, 1);
control("sandbox_workspace_write.network_access").props.onClick(); await settle();
assert.deepEqual(changes.at(-1), ["sandbox_workspace_write.network_access", false]);
assert.equal(control("sandbox_workspace_write.network_access").props["aria-checked"], true, "no optimistic toggle before verified readback");
state.change = async () => false; state.errors.model_verbosity = "version conflict";
control("model_verbosity").props.onSelect("low"); await settle(); ui.render(); ui.flush();
assert.equal(refreshed, 2); assert.equal(control("model_verbosity").props.value, null);
assert.ok(nodes(ui.tree).some(node => node.props.role === "alert" && text(node) === "version conflict"));
assert.match(control("model_verbosity").props.describedBy, /-error/);
console.log("PASS AS-B01/B02: actual configuration JSX order, independent scope/open route, immediate writes, verified-only refresh and failure retains value");

state.pendingKey = "web_search"; ui.render(); ui.flush();
assert.equal(control("web_search").props.disabled, true); assert.equal(control("model_verbosity").props.disabled, false);
assert.equal(scopeMenu().props.disabled, true);
for (const scope of [scopes[2], { ...scopes[0], disabledReason: "project is not trusted" }]) {
  reset(scope); ui.render(); ui.flush();
  for (const field of state.fields.filter(field => field.visible)) assert.equal(control(field.key).props.disabled, true);
}
reset(); state.loading = true; ui.render(); ui.flush();
for (const field of state.fields.filter(field => field.visible)) assert.equal(control(field.key).props.disabled, true);
data = { ...data, snapshot: { ...data.snapshot, config: { ...data.snapshot.config, sandbox_mode: "read-only", approval_policy: { granular: { sandbox_approval: false } } } } };
reset(); ui.render(); ui.flush();
assert.equal(visibleLabels().includes("允许网络访问"), false); assert.equal(control("approval_policy").props.disabled, true);
state.errors._load = "cannot read config"; ui.render(); ui.flush();
nodes(ui.tree).find(node => node.type === "button" && text(node) === "重新加载").props.onClick(); await settle(); assert.equal(reloaded, 1);
let release;
state.change = () => new Promise(resolve => { release = resolve; });
const refreshBefore = refreshed;
control("model_verbosity").props.onSelect("high"); ui.unmount(); release(true); await settle();
assert.equal(refreshed, refreshBefore, "unmount invalidates pending application refresh");
console.log("PASS AS-B03/B04: field pending, managed/project/load locks, complex policy preservation, network condition, reload and late refresh protection");

const menuOptions = [{ value: "on-request", label: "按请求" }, { value: "never", label: "从不请求审批" }];
const picked = [];
const menu = harness(mod.ConfigurationMenu, { id: "approval", label: "批准策略", value: "on-failure", options: menuOptions, disabled: false, onSelect: value => picked.push(value) });
const trigger = () => nodes(menu.tree).find(node => node.props.id === "approval");
assert.match(text(trigger()), /失败时/);
let focused = "", prevented = 0, stopped = 0;
const element = name => ({ focus() { focused = name; document.activeElement = this; } });
const triggerElement = element("trigger"), itemElements = menuOptions.map(option => element(option.value));
const attach = () => {
  trigger().props.ref.current = triggerElement;
  const popup = nodes(menu.tree).find(node => node.props.role === "menu");
  if (popup) popup.props.ref.current = { querySelectorAll: () => itemElements };
  nodes(menu.tree)[0].props.ref.current = { contains: target => target === triggerElement || itemElements.includes(target) };
};
const keyEvent = (key, isComposing = false) => ({ key, nativeEvent: { isComposing }, preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
trigger().props.onKeyDown(keyEvent("ArrowDown", true)); menu.render(); attach(); menu.flush();
assert.equal(trigger().props["aria-expanded"], false);
trigger().props.onKeyDown(keyEvent("ArrowDown")); menu.render(); attach(); menu.flush();
assert.equal(focused, "on-request");
const popup = () => nodes(menu.tree).find(node => node.props.role === "menu");
assert.deepEqual(nodes(popup()).filter(node => node.props.role === "menuitemradio").map(text), ["按请求", "从不请求审批"]);
popup().props.onKeyDown(keyEvent("End")); assert.equal(focused, "never");
popup().props.onKeyDown(keyEvent("ArrowDown")); assert.equal(focused, "on-request");
popup().props.onKeyDown(keyEvent("Escape", true)); menu.render(); attach(); menu.flush(); assert.ok(popup());
popup().props.onKeyDown(keyEvent("Escape")); menu.render(); attach(); menu.flush();
assert.equal(focused, "trigger"); assert.equal(popup(), undefined); assert.equal(stopped, 1);
trigger().props.onClick(); menu.render(); attach(); menu.flush();
nodes(popup()).filter(node => node.props.role === "menuitemradio")[1].props.onClick();
menu.render(); attach(); menu.flush(); assert.deepEqual(picked, ["never"]); assert.equal(focused, "trigger");
trigger().props.onClick(); menu.render(); attach(); menu.flush();
const beforeTab = prevented; popup().props.onKeyDown(keyEvent("Tab")); menu.render(); attach(); menu.flush();
assert.equal(prevented, beforeTab, "Tab preserves native traversal"); assert.equal(popup(), undefined);
trigger().props.onClick(); menu.render(); attach(); menu.flush();
document.listeners.get("pointerdown")({ target: {} }); menu.render(); attach(); menu.flush(); assert.equal(popup(), undefined);
menu.unmount(); assert.equal(document.listeners.size, 0);
console.log("PASS AS-B05: production menu legacy display-only, keyboard loop, IME, Escape focus, native Tab, selection and outside/unmount cleanup");

const parent = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
assert.match(parent, /<AgentSettings\b/);
assert.ok(!parent.includes("handleSaveVisual"), "dedicated settings must not expose generic configuration writes");
console.log("PASS AS-B06: dedicated configuration page remains in settings without generic save actions; hook and host scopes verified separately");

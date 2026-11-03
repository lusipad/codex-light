import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/components/PluginPreparationPanel.tsx", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function mount(apps = [{ id: "app", name: "App", installUrl: "https://example.com/connect" }], policy = "ON_INSTALL") {
  const slots = [], effects = [], calls = [];
  let cursor = 0, initial = true, tree, mounted = true, refreshes = 0;
  const react = {
    createElement: (tag, props, ...children) => ({ tag, props: props ?? {}, children: children.flat(Infinity) }),
    useState(value) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = value;
      return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; if (mounted) render(); }];
    },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useEffect(effect) { cursor++; if (initial) effects.push(effect); },
  };
  const exports = {};
  const request = (method, args) => { const pending = deferred(); calls.push({ method, args, ...pending }); return pending.promise; };
  vm.runInNewContext(compiled, { exports, URL,
    require(name) {
      if (name === "react") return { ...react, default: react };
      if (name === "../bridge") return { tauriInvoke: request };
      if (name === "../plugins") return { readPluginPreparationState: args => request("read", args) };
      throw Error(name);
    },
  });
  function render() {
    cursor = 0;
    tree = exports.PluginPreparationPanel({
      name: "Plugin", result: { authPolicy: policy, appsNeedingAuth: apps },
      onRefresh: async () => { refreshes++; },
    });
  }
  render(); initial = false;
  const cleanups = effects.map(effect => effect());
  function all(node, predicate) {
    if (!node || typeof node !== "object") return [];
    return [...(predicate(node) ? [node] : []), ...(node.children ?? []).flatMap(child => all(child, predicate))];
  }
  function text(node = tree) {
    return typeof node === "string" ? node : (node?.children ?? []).map(text).join("");
  }
  return {
    calls, exports, text,
    buttons: label => all(tree, node => node.tag === "button" && text(node) === label),
    unmount() { mounted = false; cleanups.forEach(cleanup => cleanup?.()); },
    get refreshes() { return refreshes; },
  };
}
{
  const f = mount();
  for (const value of [null, "", "javascript:alert(1)", "http://example.com", "https://user:secret@example.com", "https://example.com\n"]) {
    assert.equal(f.exports.pluginInstallLink(value), null);
  }
  assert.equal(f.exports.pluginInstallLink("https://example.com/connect?q=a&state=b"), "https://example.com/connect?q=a&state=b");
  const open = f.buttons("连接")[0].props.onClick;
  const first = open(), second = open();
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve(); await first; await second;
  assert.match(f.text(), /等待检查/);
  assert.doesNotMatch(f.text(), /已连接|准备完成/);
  const check = f.buttons("检查连接状态")[0].props.onClick;
  check(); check();
  assert.equal(f.calls.filter(call => call.method === "read").length, 1);
  f.calls[1].resolve({ source: "catalog", catalog: [{ id: "app", isAccessible: true }], installed: [{ id: "app", enabled: true, callable: false }] });
  await flush();
  assert.match(f.text(), /可访问/);
  assert.match(f.text(), /尚不可调用/);
  assert.match(f.text(), /授权结果仍待确认/);
  assert.equal(f.refreshes, 1);
}
{
  const f = mount([{ id: "a", name: "A", installUrl: "javascript:bad" }, { id: "b", name: "B", installUrl: null }], "ON_USE");
  assert.match(f.text(), /使用时连接/);
  assert.equal(f.buttons("连接").length, 2);
  assert(f.buttons("连接").every(button => button.props.disabled));
  f.buttons("检查连接状态")[0].props.onClick();
  f.calls[0].reject(Error("denied")); await flush();
  assert.match(f.text(), /denied/);
  assert.doesNotMatch(f.text(), /可访问|可调用/);
  f.buttons("检查连接状态")[0].props.onClick();
  f.buttons("收起连接准备")[0].props.onClick();
  f.calls[1].resolve({ catalog: [], installed: [] }); await flush();
  assert.equal(f.buttons("继续连接").length, 1, "Late read must not reopen collapsed panel");
}
{
  const f = mount();
  f.buttons("检查连接状态")[0].props.onClick();
  f.unmount();
  f.calls[0].resolve({ catalog: [], installed: [] }); await flush();
  assert.equal(f.refreshes, 0, "Unmounted or replaced attempt does not refresh another context");
}
console.log("PI UI: actual preparation component links, single-flight, fact separation, retry, collapse and unmount passed");

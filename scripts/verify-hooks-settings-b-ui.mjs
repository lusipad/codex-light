import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

export const makeHook = (id, extra = {}) => ({ id, cwd: "workspace", name: id, currentHash: `hash-${id}`, event: "preToolUse", source: "user", handlerType: "command", command: "echo normalized", enabled: true, trustStatus: "trusted", raw: { key: id, command: "  echo exact\nnext  " }, ...extra });
export function hookData(hooks, diagnostics = []) {
  const groups = [...new Set(hooks.map(hook => hook.cwd))].map(cwd => ({ cwd, hooks: hooks.filter(hook => hook.cwd === cwd), warnings: [], errors: [] }));
  groups.push(...diagnostics);
  return { hooks, groups, warnings: groups.flatMap(group => group.warnings.map(message => ({ cwd: group.cwd, message }))), errors: groups.flatMap(group => group.errors) };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
export function createHooksHarness(options = {}) {
  let slots = [], effects = [], scheduled = [], cursor = 0, changed = false, tree, focused = "", updates = 0;
  let fixture = options.data ?? hookData([]), read = options.read ?? (async () => fixture), write = options.write ?? (async (_, selected, change) => {
    fixture = hookData(fixture.hooks.map(hook => selected.some(item => item.id === hook.id && item.cwd === hook.cwd) ? { ...hook, ...(change === "trust" ? { trustStatus: "trusted" } : { enabled: change }) } : hook)); return fixture;
  });
  const calls = [], frames = [], props = { activeWorkspaceRoot: "workspace", connectionIdentity: "connected:A" };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { changed = true; updates++; } slots[index] = next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useEffect(callback, deps) { const index = cursor++, old = effects[index]; if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps[i]))) scheduled.push(() => { old?.cleanup?.(); effects[index] = { deps, cleanup: callback() }; }); },
  };
  const load = (file, imports) => {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
      { exports, require: name => name === "react" ? react : name === "lucide-react" ? new Proxy({}, { get: (_, key) => String(key) }) : name.endsWith(".css") ? {} : imports[name], requestAnimationFrame: callback => frames.push(callback) });
    return exports;
  };
  const model = fs.existsSync("src/hooksSettingsModel.ts") ? load("src/hooksSettingsModel.ts", {}) : {};
  const { HooksSettings } = load("src/components/HooksSettings.tsx", { "../hooksSettingsModel": model, "../hooksClient": { listHooks: roots => { calls.push(["read", roots]); return read(roots); } },
    "../hookState": { writeHookState: (...args) => { calls.push(["write", ...args]); return write(...args); } }, "../bridge": { tauriInvoke: async (...args) => { calls.push(["open-file", ...args]); } } });
  const nodes = node => node && typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : [];
  const text = node => typeof node === "string" || typeof node === "number" ? String(node) : (node?.children || []).map(text).join("");
  const modal = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const render = () => {
    let loops = 0;
    do { assert.ok(loops++ < 15); cursor = 0; changed = false; tree = HooksSettings(props);
      for (const node of nodes(tree)) {
        const element = node.type === "dialog" ? modal : { focus() { focused = node.props["aria-label"] || text(node); } };
        if (typeof node.props.ref === "function") node.props.ref(element); else if (node.props.ref) node.props.ref.current = element;
      }
      scheduled.splice(0).forEach(effect => effect());
    } while (changed);
    frames.splice(0).forEach(callback => callback()); return tree;
  };
  return { props, calls, nodes, text, modal, render,
    get tree() { return tree; }, get focused() { return focused; }, get updates() { return updates; },
    async tick() { for (let index = 0; index < 25; index++) await Promise.resolve(); render(); },
    source(source, cwd = "", pluginId) { const key = JSON.stringify([source, cwd, pluginId]); const node = nodes(tree).find(node => node.props["data-hook-source"] === key); assert.ok(node, `source ${key}`); return node; },
    button(label) { const node = nodes(tree).find(node => node.type === "button" && text(node).trim() === label); assert.ok(node, `button ${label}`); return node; },
    toggle(id) { const node = nodes(tree).find(node => node.props["data-hook-toggle"] === id); assert.ok(node, `toggle ${id}`); return node; },
    row(id) { const node = nodes(tree).find(node => node.props["data-hook-row"] === id); assert.ok(node, `row ${id}`); return node; },
    setData(value) { fixture = value; }, setRead(value) { read = value; }, setWrite(value) { write = value; },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); },
  };
}

export async function verifyHooksUI() {
  const user = [makeHook("untrusted", { trustStatus: "untrusted", statusMessage: "Review me" }), makeHook("trusted", { event: "stop", enabled: false }), makeHook("modified", { trustStatus: "modified", event: "stop", displayOrder: -1 }), makeHook("managed", { source: "system", trustStatus: "managed", isManaged: true, enabled: false, event: "sessionStart" })];
  const other = makeHook("other-plugin", { source: "plugin", pluginId: "other", trustStatus: "untrusted" });
  const h = createHooksHarness({ data: hookData([...user, other]) }); h.render(); await h.tick();
  assert.ok(!h.nodes(h.tree).some(node => node.props["data-hook-toggle"]), "index must not flatten all editable hooks");
  const source = h.source("user"); source.props.onClick({ currentTarget: { focus() {} } }); h.render();
  assert.equal(h.modal.open, true);
  const untrusted = h.toggle("untrusted"); assert.equal(untrusted.props["aria-checked"], false); assert.equal(untrusted.props.disabled, true);
  untrusted.props.onClick(); assert.equal(h.calls.filter(call => call[0] === "write").length, 0, "untrusted handler cannot bypass review even when invoked directly");
  const untrustedSwitch = h.nodes(h.tree).find(node => node.props.role === "switch" && node.props["aria-label"] === "1 - Review me");
  assert.equal(untrustedSwitch.type, "span"); assert.equal(untrustedSwitch.props.tabIndex, 0); assert.equal(untrusted.props["aria-hidden"], true); assert.equal(untrusted.props.role, undefined);
  const managedSource = h.source("admin");
  h.button("关闭").props.onClick(); h.render(); managedSource.props.onClick({ currentTarget: { focus() {} } }); h.render();
  const managed = h.toggle("managed"); assert.equal(managed.props["aria-checked"], true); assert.equal(managed.props.disabled, true);
  const managedSwitch = h.nodes(h.tree).find(node => node.props.role === "switch" && node.props["aria-checked"] === true); assert.equal(managedSwitch.type, "span"); assert.equal(managedSwitch.props.tabIndex, 0); assert.match(managedSwitch.props.title, /始终处于开启/);
  assert.ok(!h.text(h.tree).includes("信任此定义")); h.button("关闭").props.onClick(); h.render();
  h.source("user").props.onClick({ currentTarget: { focus() {} } }); h.render();
  assert.equal(h.row("untrusted").props["aria-expanded"], false); h.row("untrusted").props.onClick(); h.render();
  assert.equal(h.row("untrusted").props["aria-expanded"], true); assert.ok(h.text(h.tree).includes("  echo exact\nnext  "));
  assert.match(h.text(h.tree), /1 - Review me/); assert.match(h.text(h.tree), /Hook 在沙盒外运行，可能存在安全风险/);
  h.button("全部信任").props.onClick(); await h.tick();
  const trustedWrite = h.calls.find(call => call[0] === "write");
  assert.deepEqual([...trustedWrite[2].map(hook => hook.id)].sort(), ["modified", "untrusted"]);
  assert.equal(trustedWrite[3], "trust"); assert.equal(trustedWrite[4].isCurrent(), true);
  assert.equal(h.toggle("untrusted").props.disabled, false); assert.equal(h.toggle("untrusted").props["aria-checked"], true);
  h.button("关闭").props.onClick(); h.render(); assert.equal(h.modal.open, false);
  assert.match(h.focused, /用户配置/); h.unmount();
  console.log("PASS HB-UI01/02: source index/drawer, collapsed review, raw command, untrusted and managed switch invariants, current-source cross-event trust-all and returned focus");

  const later = deferred(), f = createHooksHarness({ data: hookData([makeHook("old"), other]), write: () => later.promise }); f.render(); await f.tick();
  f.source("user").props.onClick({ currentTarget: { focus() {} } }); f.render();
  f.toggle("old").props.onClick(); f.toggle("old").props.onClick(); f.render(); assert.equal(f.calls.filter(call => call[0] === "write").length, 1);
  const action = f.calls.find(call => call[0] === "write"); f.button("关闭").props.onClick(); f.render(); assert.equal(action[4].isCurrent(), false);
  f.source("plugin", "", "other").props.onClick({ currentTarget: { focus() {} } }); f.render();
  later.resolve(hookData([makeHook("WRONG_SOURCE")])); await f.tick(); assert.ok(!f.text(f.tree).includes("WRONG_SOURCE"));
  f.props.connectionIdentity = "connected:B"; f.setRead(async () => hookData([makeHook("new-source", { source: "project", cwd: "next" })])); f.props.activeWorkspaceRoot = "next"; f.render(); await f.tick();
  assert.equal(f.modal.open, false); assert.ok(f.source("project", "next")); assert.equal(f.calls.at(-1)[1][0], "next"); f.unmount();
  console.log("PASS HB-UI03: mutation single-flight, close invalidates write continuation, source isolation and root/connection epochs close stale drawers");

  const stale = deferred(), lifetime = createHooksHarness({ read: () => stale.promise }); lifetime.render(); lifetime.unmount(); const before = lifetime.updates;
  stale.resolve(hookData([makeHook("late")])); await lifetime.tick(); assert.equal(lifetime.updates, before);
  const retry = createHooksHarness({ read: async () => { throw Error("disconnected"); } }); retry.render(); await retry.tick(); assert.match(retry.text(retry.tree), /disconnected/);
  retry.setRead(async () => hookData([])); retry.button("重新加载钩子").props.onClick(); await retry.tick(); assert.ok(!retry.text(retry.tree).includes("disconnected")); assert.match(retry.text(retry.tree), /未找到钩子/); retry.unmount();
  console.log("PASS HB-UI04: unmount late-read isolation, visible load failure and real retry clear stale errors without executing hooks");

  const roots = createHooksHarness({ data: hookData([makeHook("r1", { source: "project", cwd: "root-one" }), makeHook("r2", { source: "project", cwd: "root-two" }), makeHook("not-a-root", { source: "project", cwd: "outside" })]) });
  roots.props.workspaceRoots = ["root-one", "root-two"]; roots.props.activeWorkspaceRoot = "root-one"; roots.render(); await roots.tick();
  assert.deepEqual([...roots.calls[0][1]], ["root-one", "root-two"]); roots.source("project", "root-two").props.onClick(); roots.render();
  assert.ok(!roots.nodes(roots.tree).some(node => node.props["data-hook-source"] === JSON.stringify(["project", "outside", null])));
  roots.toggle("r2").props.onClick(); await roots.tick(); assert.deepEqual([...roots.calls.find(call => call[0] === "write")[1]], ["root-one", "root-two"]);
  roots.props.workspaceRoots = ["root-two"]; roots.render(); await roots.tick(); assert.equal(roots.modal.open, false); assert.deepEqual([...roots.calls.at(-1)[1]], ["root-two"]);
  roots.props.workspaceRoots = []; roots.render(); await roots.tick(); const reads = roots.calls.filter(call => call[0] === "read").length;
  roots.button("重新加载钩子").props.onClick(); await roots.tick(); assert.equal(roots.calls.filter(call => call[0] === "read").length, reads); assert.equal(roots.button("重新加载钩子").props.disabled, true); roots.unmount();
  console.log("PASS HB-UI05: full registered root set used for reads and writes, non-root project entries rejected, root-list changes invalidate drawers, empty roots never query session fallback");

  const details = createHooksHarness({ data: hookData([
    makeHook("mcp", { handlerType: "mcpTool", matcher: "", timeoutSec: 0, raw: { key: "mcp", server: "server.with.dot", tool: "tool.with.dot" } }),
    makeHook("prompt", { handlerType: "prompt", raw: { key: "prompt", prompt: "PRIVATE_PROMPT_NOT_A_DETAIL_FIELD" } }),
    makeHook("agent", { handlerType: "agent", raw: { key: "agent", prompt: "PRIVATE_AGENT_NOT_A_DETAIL_FIELD" }, sourcePath: "C:/isolated/hooks.json" }),
  ]) }); details.render(); await details.tick(); details.source("user").props.onClick(); details.render();
  details.row("mcp").props.onClick(); details.render(); assert.match(details.text(details.tree), /MCP 服务器/); assert.match(details.text(details.tree), /server.with.dot/); assert.match(details.text(details.tree), /tool.with.dot/); assert.match(details.text(details.tree), /匹配器/); assert.match(details.text(details.tree), /0 秒/);
  details.row("prompt").props.onClick(); details.render(); assert.equal(details.row("mcp").props["aria-expanded"], false); assert.match(details.text(details.tree), /处理程序提示/); assert.ok(!details.text(details.tree).includes("PRIVATE_PROMPT"));
  details.row("agent").props.onClick(); details.render(); assert.match(details.text(details.tree), /处理程序智能体/); assert.ok(!details.text(details.tree).includes("PRIVATE_AGENT"));
  details.nodes(details.tree).find(node => node.props["aria-label"]?.startsWith("打开配置文件")).props.onClick(); await details.tick();
  assert.equal(details.calls.find(call => call[0] === "open-file")[1], "open_path_external");
  const modal = details.nodes(details.tree).find(node => node.type === "dialog"); let prevented = false; modal.props.onCancel({ preventDefault() { prevented = true; } }); details.render(); assert.equal(prevented, true); assert.equal(details.modal.open, false); details.unmount();
  console.log("PASS HB-UI06: event-local accordion, exact MCP fields/empty matcher/zero timeout, prompt/agent labels, explicit local file IPC and Escape closure");

  const diagnostics = createHooksHarness({ data: hookData([], [{ cwd: "workspace", hooks: [], warnings: ["unsupported definition"], errors: [{ cwd: "workspace", path: "hooks.json", message: "bad format" }] }]) });
  diagnostics.render(); await diagnostics.tick(); diagnostics.source("unknown").props.onClick(); diagnostics.render();
  assert.equal(diagnostics.modal.open, true); assert.ok(!diagnostics.text(diagnostics.tree).includes("bad format"));
  diagnostics.button("此源有 2 个钩子加载问题").props.onClick(); diagnostics.render(); assert.match(diagnostics.text(diagnostics.tree), /unsupported definition/); assert.match(diagnostics.text(diagnostics.tree), /hooks.json：bad format/);
  assert.ok(!diagnostics.nodes(diagnostics.tree).some(node => node.type === "button" && diagnostics.text(node) === "全部信任")); diagnostics.unmount();
  const failure = createHooksHarness({ data: hookData([makeHook("conflict")]), write: async () => { throw Error("CAS conflict"); } }); failure.render(); await failure.tick(); failure.source("user").props.onClick(); failure.render();
  failure.toggle("conflict").props.onClick(); await failure.tick(); assert.match(failure.text(failure.tree), /CAS conflict/); assert.equal(failure.toggle("conflict").props["aria-checked"], true); assert.ok(!failure.text(failure.tree).includes("已保存"));
  const inside = failure.nodes(failure.nodes(failure.tree).find(node => node.type === "dialog")); inside.find(node => node.type === "button" && failure.text(node) === "重新加载钩子").props.onClick(); await failure.tick(); assert.ok(!failure.text(failure.tree).includes("CAS conflict")); failure.unmount();
  console.log("PASS HB-UI07: diagnostic-only sources remain inspectable, failed writes preserve real state without success and retry is reachable inside the modal");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyHooksUI();

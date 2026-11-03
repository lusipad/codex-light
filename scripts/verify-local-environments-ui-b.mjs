import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import path from "node:path";
const deferred = () => { let resolve; const promise = new Promise(a => { resolve = a; }); return { promise, resolve }; };
export function createEnvironmentHarness() {
  let cursor = 0, slots = [], effects = [], scheduled = [], changed = false, tree, guard, updates = 0, focused = "";
  const calls = [], frames = [], windows = new Map(), selections = new Map(), stored = new Map();
  const lifecycle = { script: "echo default", darwin: null, linux: null, win32: null };
  const environment = { version: 2, name: "Existing", setup: lifecycle, cleanup: null, actions: [{ name: "Test", command: "echo test\necho done", icon: "test", platform: null }] };
  const snapshot = (cwd, name = "environment.toml", inherited = false) => ({ path: `${cwd}/.codex/environments/${name}`, fileName: name, files: [name], exists: true, content: `original-${cwd}-${name}`, expectedContent: `original-${cwd}-${name}`, schemaError: null, environment: structuredClone(environment), cwd, workspaceRoot: cwd, inherited });
  const first = snapshot("C:/one"), second = snapshot("C:/two"); stored.set(first.path, first); stored.set(second.path, second);
  const props = { cwd: "C:/one", projects: [{ path: "C:/one", name: "Same" }, { path: "C:/two", name: "Same" }], connectionIdentity: "connected:A", onRunCommand: (...args) => calls.push(["run", ...args]), onAddProject: () => calls.push(["add-project"]), onNavigationGuardChange: next => { guard = next; } };
  let handler;
  const invoke = async (method, args) => {
    calls.push([method, args]); if (handler) { const override = handler(method, args); if (override !== undefined) return override; }
    if (method === "local_environments_list") return { environments: [...stored.values()].filter(item => item.workspaceRoot === args.cwd), nextFileName: "environment-2.toml", defaultPath: args.cwd === "C:/one" ? first.path : second.path };
    if (method === "local_environment_read_config") return stored.get(args.configPath);
    if (method === "local_environment_selection_get") return selections.get(args.cwd) ?? { configPath: null, explicit: false };
    if (method === "local_environment_select") { const next = { configPath: args.configPath, explicit: true }; selections.set(args.cwd, next); return next; }
    if (method === "local_environment_save_config") { const current = args.configPath ? stored.get(args.configPath) : null; if (current && current.content !== args.expectedContent) throw Error("conflict: 文件已被其他程序修改，草稿已保留"); const next = { ...snapshot(args.cwd, args.configPath?.split("/").at(-1) ?? "environment-2.toml"), environment: args.environment, content: JSON.stringify(args.environment), expectedContent: JSON.stringify(args.environment) }; stored.set(next.path, next); return next; }
    if (method === "local_environment_action_config") return "echo checked action";
    throw Error(`unexpected ${method}`);
  };
  const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { changed = true; updates++; } slots[index] = next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useEffect(callback, deps) { const index = cursor++, old = effects[index]; if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps[i]))) scheduled.push(() => { old?.cleanup?.(); effects[index] = { deps, cleanup: callback() }; }); },
  };
  const window = { addEventListener: (name, callback) => windows.set(name, callback), removeEventListener: name => windows.delete(name) };
  const load = (file, imports) => { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { exports, require: name => name === "react" ? react : name === "lucide-react" ? new Proxy({}, { get: (_, key) => String(key) }) : name.endsWith(".css") ? {} : imports[name], window, requestAnimationFrame: callback => frames.push(callback) }); return exports; };
  const client = load("src/localEnvironments.ts", { "./bridge": { tauriInvoke: invoke } });
  const { LocalEnvironmentSettings } = load("src/components/LocalEnvironmentSettings.tsx", { "../localEnvironments": client, "../bridge": { tauriInvoke: invoke } });
  const nodes = node => node && typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : [];
  const text = node => typeof node === "string" || typeof node === "number" ? String(node) : (node?.children || []).map(text).join("");
  const modal = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const render = () => { let count = 0; do { assert.ok(count++ < 15); cursor = 0; changed = false; tree = LocalEnvironmentSettings(props); for (const node of nodes(tree)) { const element = node.type === "dialog" ? modal : { focus() { focused = node.props["aria-label"] || text(node); } }; if (typeof node.props.ref === "function") node.props.ref(element); else if (node.props.ref) node.props.ref.current = element; } scheduled.splice(0).forEach(effect => effect()); } while (changed); frames.splice(0).forEach(callback => callback()); return tree; };
  return { props, client, first, second, snapshot, stored, selections, calls, nodes, text, modal, render,
    get tree() { return tree; }, get guard() { return guard; }, get updates() { return updates; }, get focused() { return focused; },
    async tick() { for (let index = 0; index < 45; index++) await Promise.resolve(); render(); },
    button(label) { const node = nodes(tree).find(node => node.type === "button" && text(node).trim() === label); assert.ok(node, `button ${label}`); return node; },
    input(label) { const node = nodes(tree).find(node => node.props["aria-label"] === label); assert.ok(node, `input ${label}`); return node; },
    project(cwd) { const node = nodes(tree).find(node => node.props["data-project-open"] === cwd); assert.ok(node, `project ${cwd}`); return node; },
    open(configPath) { const node = nodes(tree).find(node => node.props["data-environment-open"] === configPath); assert.ok(node, `environment ${configPath}`); node.props.onClick(); render(); },
    change(label, value) { this.input(label).props.onChange({ target: { value } }); render(); },
    setHandler(value) { handler = value; }, unmount() { effects.forEach(effect => effect?.cleanup?.()); },
  };
}
export async function verifyLocalEnvironmentsUI() {
  const model = createEnvironmentHarness();
  const pure = model.client.environmentDraft(); pure.name = "  中文  "; pure.setup.script = "  echo \"quoted\"\nnext  "; pure.setup.darwin = { script: "" }; pure.cleanup.linux = { script: " cleanup\nraw " }; pure.actions = [{ id: "empty", name: " ", command: "", icon: "tool", platform: null }];
  const encoded = model.client.environmentFromDraft(pure); assert.equal(encoded.name, "中文"); assert.equal(encoded.setup.script, pure.setup.script); assert.equal(encoded.setup.darwin, null); assert.equal(encoded.cleanup.linux.script, " cleanup\nraw "); assert.equal(encoded.actions.length, 0);
  assert.equal(model.client.lifecyclePreview(encoded.setup, "win32"), pure.setup.script); pure.actions[0].name = "Incomplete"; assert.match(model.client.environmentDraftError(pure), /名字和命令/);
  model.setHandler(method => method === "local_environment_selection_get" ? { explicit: true, configPath: "wrong" } : undefined);
  await assert.rejects(() => model.client.selectLocalEnvironment("C:/one", null), /读回不一致/);
  assert.equal(model.calls.filter(call => call[0] === "local_environment_select").length, 1);
  console.log("PASS ENV-BMODEL: exact script preservation, trim-only names, empty sections/rows, default platform fallback, incomplete action validation and actual selection readback");
  const h = createEnvironmentHarness(); h.render(); await h.tick();
  assert.equal(h.nodes(h.tree).filter(node => node.props["data-project-open"]).length, 2, "same project names retain distinct registered path identities");
  assert.ok(!h.nodes(h.tree).some(node => node.props["aria-label"] === "环境 TOML"));
  h.project("C:/one").props.onClick(); h.render(); h.open(h.first.path); await h.tick(); h.button("编辑").props.onClick(); h.render();
  h.change("环境名称", "  Custom  "); h.change("设置脚本", "echo quoted \"value\"\nnext line");
  h.change("设置脚本平台", "win32"); h.change("设置脚本", "Write-Output Windows"); h.button("添加操作").props.onClick(); h.render();
  h.change("操作 2 名称", "  Build  "); h.change("操作 2 脚本", "npm run build\necho ready"); h.change("操作 2 平台", "linux");
  h.button("保存").props.onClick(); await h.tick();
  const saved = h.calls.find(call => call[0] === "local_environment_save_config")[1];
  assert.equal(saved.expectedContent, h.first.content); assert.equal(saved.environment.name, "Custom"); assert.equal(saved.environment.version, 2); assert.equal(saved.environment.setup.script, "echo quoted \"value\"\nnext line"); assert.equal(saved.environment.setup.win32.script, "Write-Output Windows"); assert.equal(saved.environment.actions[1].command, "npm run build\necho ready"); assert.equal(saved.environment.cleanup, null);
  assert.equal(h.selections.get("C:/one").configPath, h.first.path); assert.match(h.text(h.tree), /已保存本地环境/); h.unmount();
  console.log("PASS ENV-BUI01: all-project identity index, structured default/platform/action form, exact original CAS and saved selection readback");

  const guarded = createEnvironmentHarness(); guarded.render(); await guarded.tick(); guarded.project("C:/one").props.onClick(); guarded.render(); guarded.open(guarded.first.path); await guarded.tick(); guarded.button("编辑").props.onClick(); guarded.render(); guarded.change("环境名称", "unsaved");
  let navigated = 0; assert.equal(guarded.guard(() => { navigated++; }), false); guarded.render(); assert.equal(guarded.modal.open, true); guarded.button("继续编辑").props.onClick(); guarded.render(); assert.equal(navigated, 0); assert.equal(guarded.input("环境名称").props.value, "unsaved");
  const beforeReload = guarded.calls.length; guarded.button("重新读取").props.onClick(); guarded.render(); guarded.button("继续编辑").props.onClick(); await guarded.tick(); assert.equal(guarded.calls.length, beforeReload, "canceling reload never discards the draft or re-reads it");
  assert.equal(guarded.guard(() => { navigated++; }), false); guarded.render(); guarded.button("放弃").props.onClick(); guarded.render(); assert.equal(navigated, 1); guarded.unmount(); assert.equal(guarded.guard, null);
  console.log("PASS ENV-BUI02: dirty navigation uses real confirmation, continue retains draft, explicit discard runs one pending navigation and unmount clears guard");

  const conflict = createEnvironmentHarness(); conflict.render(); await conflict.tick(); conflict.project("C:/one").props.onClick(); conflict.render(); conflict.open(conflict.first.path); await conflict.tick(); conflict.button("编辑").props.onClick(); conflict.render(); conflict.change("环境名称", "Keep draft");
  conflict.stored.set(conflict.first.path, { ...conflict.first, content: "externally changed" }); conflict.button("保存").props.onClick(); await conflict.tick(); assert.match(conflict.text(conflict.tree), /conflict/); assert.equal(conflict.input("环境名称").props.value, "Keep draft"); assert.equal(conflict.calls.filter(call => call[0] === "local_environment_select").length, 0);
  conflict.stored.set(conflict.first.path, conflict.first); conflict.setHandler(method => method === "local_environment_select" ? Promise.reject(Error("selection denied")) : undefined); conflict.button("保存").props.onClick(); await conflict.tick();
  assert.match(conflict.text(conflict.tree), /已保存环境文件，但无法选中它/); assert.equal(conflict.stored.get(conflict.first.path).environment.name, "Keep draft");
  const savedCount = conflict.calls.filter(call => call[0] === "local_environment_save_config").length;
  conflict.setHandler(undefined); conflict.button("重试选择").props.onClick(); await conflict.tick(); assert.equal(conflict.calls.filter(call => call[0] === "local_environment_save_config").length, savedCount); assert.equal(conflict.selections.get("C:/one").configPath, conflict.first.path); conflict.unmount();
  console.log("PASS ENV-BUI03: conflict keeps original CAS/draft, file save and selection failure remain distinct, selection retry never rewrites the file");

  const running = createEnvironmentHarness(); running.render(); await running.tick(); running.project("C:/one").props.onClick(); running.render(); running.open(running.first.path); await running.tick();
  running.button("显示 Test 的完整命令").props.onClick(); running.render(); assert.match(running.text(running.tree), /echo test\necho done/);
  running.button("运行 Test").props.onClick(); await running.tick(); const checked = running.calls.find(call => call[0] === "local_environment_action_config"); assert.equal(checked[1].expectedContent, running.first.content); assert.equal(checked[1].configPath, running.first.path); assert.deepEqual(running.calls.find(call => call[0] === "run").slice(1), ["C:/one", "echo checked action"]);
  const lateAction = deferred(); running.setHandler(method => method === "local_environment_action_config" ? lateAction.promise : undefined); running.button("运行 Test").props.onClick(); running.button("运行 Test").props.onClick(); assert.equal(running.calls.filter(call => call[0] === "local_environment_action_config").length, 2);
  running.unmount(); const oldUpdates = running.updates; lateAction.resolve("LATE_COMMAND"); await running.tick(); assert.equal(running.updates, oldUpdates); assert.equal(running.calls.filter(call => call[0] === "run").length, 1);
  console.log("PASS ENV-BUI04: action summary expansion, exact saved definition identity, real checked action queue, single-flight and late-unmount command suppression");

  const reconnect = createEnvironmentHarness(); reconnect.render(); await reconnect.tick(); reconnect.project("C:/one").props.onClick(); reconnect.render(); reconnect.open(reconnect.first.path); await reconnect.tick(); reconnect.button("编辑").props.onClick(); reconnect.render(); reconnect.change("环境名称", "survives reconnect");
  reconnect.props.connectionIdentity = "connected:B"; reconnect.render(); await reconnect.tick(); assert.equal(reconnect.input("环境名称").props.value, "survives reconnect"); reconnect.button("保存").props.onClick(); await reconnect.tick(); assert.equal(reconnect.stored.get(reconnect.first.path).environment.name, "survives reconnect"); reconnect.unmount();
  const lateRead = deferred(), switching = createEnvironmentHarness(); switching.setHandler((method, args) => method === "local_environment_read_config" && args.cwd === "C:/one" ? lateRead.promise : undefined); switching.render(); await switching.tick(); switching.project("C:/one").props.onClick(); switching.render(); switching.open(switching.first.path);
  switching.button("环境").props.onClick(); switching.render(); switching.project("C:/two").props.onClick(); switching.render(); switching.open(switching.second.path); await switching.tick(); lateRead.resolve({ ...switching.first, environment: { ...switching.first.environment, name: "WRONG_LATE_PROJECT" } }); await switching.tick(); assert.ok(!switching.text(switching.tree).includes("WRONG_LATE_PROJECT")); switching.unmount();
  console.log("PASS ENV-BUI05: reconnect preserves dirty drafts with original version, late detail reads never replace another project's view");

  const selection = createEnvironmentHarness(); const ancestor = { ...selection.snapshot("C:/parent", "ancestor.toml", true), workspaceRoot: "C:/one" }; selection.stored.set(ancestor.path, ancestor); selection.render(); await selection.tick(); selection.project("C:/one").props.onClick(); selection.render();
  assert.ok(!selection.nodes(selection.tree).some(node => node.props["data-environment-open"] === ancestor.path)); selection.button("继承环境（1）").props.onClick(); selection.render(); assert.ok(selection.nodes(selection.tree).some(node => node.props["data-environment-open"] === ancestor.path));
  selection.open(ancestor.path); await selection.tick(); selection.button("运行 Test").props.onClick(); await selection.tick();
  const inheritedAction = selection.calls.find(call => call[0] === "local_environment_action_config"); assert.equal(inheritedAction[1].cwd, "C:/one"); assert.equal(inheritedAction[1].configPath, ancestor.path); assert.equal(inheritedAction[1].expectedContent, ancestor.content); assert.deepEqual(selection.calls.find(call => call[0] === "run").slice(1), ["C:/parent", "echo checked action"]);
  selection.button("环境").props.onClick(); selection.render();
  selection.change("项目环境 C:/one", "__none__"); await selection.tick(); assert.deepEqual(selection.selections.get("C:/one"), { configPath: null, explicit: true });
  selection.button("创建本地环境").props.onClick(); selection.render(); selection.change("环境名称", "new config"); selection.button("添加操作").props.onClick(); selection.render(); selection.change("操作 1 名称", "Incomplete"); assert.equal(selection.button("保存").props.disabled, true);
  selection.change("操作 1 脚本", "echo new"); selection.button("保存").props.onClick(); await selection.tick(); assert.equal(selection.calls.find(call => call[0] === "local_environment_save_config")[1].configPath, null); assert.ok(selection.stored.has("C:/one/.codex/environments/environment-2.toml")); assert.equal(selection.stored.get(selection.first.path).environment.name, "Existing"); selection.unmount();
  console.log("PASS ENV-BUI06: inherited configurations are distinct, explicit none is persisted, incomplete actions block save, new configurations use null creation identity without overwriting existing files");
  const unknownSelection = createEnvironmentHarness(); unknownSelection.setHandler(method => method === "local_environment_selection_get" ? Promise.reject(Error("selection read failed")) : undefined); unknownSelection.render(); await unknownSelection.tick(); unknownSelection.project("C:/one").props.onClick(); unknownSelection.render();
  assert.equal(unknownSelection.input("项目环境 C:/one").props.value, "__unknown__"); assert.equal(unknownSelection.input("项目环境 C:/one").props.disabled, true); assert.ok(!unknownSelection.text(unknownSelection.tree).includes("当前选择")); assert.equal(unknownSelection.calls.filter(call => call[0] === "local_environment_select").length, 0); unknownSelection.unmount();
  console.log("PASS ENV-BUI07: a failed selection read is unknown, never inferred as default or explicit none and never causes automatic persistence");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyLocalEnvironmentsUI();

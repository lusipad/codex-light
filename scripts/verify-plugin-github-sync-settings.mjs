import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync("src/components/PluginGithubSyncSettings.tsx", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = node => typeof node === "string" ? node : !node || typeof node !== "object" ? "" : [node.props?.children].flat(Infinity).map(text).join("");
const event = patch => ({ preventDefault() {}, stopPropagation() {}, nativeEvent: {}, ...patch });
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
function fixture() {
  let cursor = 0, dirty = true, effects = [], tree, saves = 0, cancels = 0, reloads = 0, more = 0, stops = 0, saved = 0, save = async () => true, stopResult = true;
  const slots = [], queries = [], toggles = [], baseline = [1];
  let props = { connectionIdentity: "c", parent: { identity: { accountId: "a", userId: "u", generation: 1 }, appId: "github", routeAppId: null }, status: { user_connection_details: { backing_link_id: "link", connection_instance_id: "instance" } }, disabled: false, onDisable: () => { stops++; return stopResult; }, onSaved: () => saved++ };
  let state = { scope: "a:github:link:instance", snapshot: {}, repositories: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: `org/repo${i + 1}`, description: `description${i + 1}` })), selectedIds: [1], dirty: false,
    loading: false, searching: false, loadingMore: false, pending: false, blocked: false, uncertain: false, error: null, saveError: null, pageError: null, query: "", nextToken: null };
  const react = { useId: () => "github-test", useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { const value = typeof next === "function" ? next(slots[i]) : next; if (!Object.is(value, slots[i])) { slots[i] = value; dirty = true; } }]; },
    useLayoutEffect(run, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((v, index) => v !== old.deps[index])) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: run() }; }); },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
    if (name === "lucide-react") return { Loader2: "Loader2" };
    if (name === "../pluginGithubSyncState") return { usePluginGithubSync: (...args) => { assert.deepEqual(args, [props.connectionIdentity, props.parent, props.status]); return { state,
      reload: async () => { reloads++; }, submitQuery: async query => { queries.push(query); state = { ...state, query }; dirty = true; }, loadMore: async () => { more++; },
      toggle: id => { toggles.push(id); const ids = state.selectedIds.includes(id) ? state.selectedIds.filter(v => v !== id) : [...state.selectedIds, id]; state = { ...state, selectedIds: ids, dirty: ids.length !== baseline.length || ids.some(id => !baseline.includes(id)) }; dirty = true; },
      cancel: () => { cancels++; state = { ...state, selectedIds: [...baseline], dirty: false }; dirty = true; }, save: () => { saves++; return save(); },
    }; } };
    if (name.endsWith(".css")) return {}; throw Error(name);
  } });
  function render() { for (let turn = 0; dirty; turn++) { assert.ok(turn < 20); dirty = false; cursor = 0; tree = exports.PluginGithubSyncSettings(props); const batch = effects; effects = []; batch.forEach(run => run()); } return tree; }
  return { queries, toggles, get tree() { return render(); }, get saves() { return saves; }, get cancels() { return cancels; }, get reloads() { return reloads; }, get more() { return more; }, get stops() { return stops; }, get saved() { return saved; },
    find(fn) { return nodes(render()).find(fn); }, button(label) { return this.find(n => n.type === "button" && text(n) === label); }, get input() { return this.find(n => n.props.type === "search"); }, get boxes() { return nodes(render()).filter(n => n.props.type === "checkbox"); },
    submit() { this.find(n => n.type === "form").props.onSubmit(event()); render(); }, state(patch) { state = { ...state, ...patch }; dirty = true; render(); }, update(patch) { props = { ...props, ...patch }; dirty = true; render(); }, saveWith(fn) { save = fn; }, denyStop() { stopResult = false; }, unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
{
  const f = fixture(); assert.match(text(f.tree), /已同步的代码仓库.*最多选择 5 个代码仓库/); assert.equal(f.input.props.name, "repository-search"); assert.equal(f.button("保存"), undefined);
  f.input.props.onChange({ target: { value: "  repo query  " } }); assert.equal(f.queries.length, 0); f.submit(); await flush(); assert.deepEqual(f.queries, ["repo query"]);
  f.boxes[1].props.onChange(); assert.equal(f.button("保存").props.disabled, false); f.input.props.onChange({ target: { value: "another" } }); f.submit(); await flush(); assert.equal(f.boxes[1].props.checked, true, "query changes retain selection draft");
  f.button("取消").props.onClick(); assert.equal(f.cancels, 1); assert.equal(f.saves, 0); assert.equal(f.button("保存"), undefined); f.unmount();
}
{
  const f = fixture(); f.state({ selectedIds: [1, 2, 3, 4, 5], dirty: true }); assert.equal(f.boxes[5].props.disabled, true); assert.equal(f.boxes[0].props.disabled, false);
  f.boxes[5].props.onChange(); assert.equal(f.toggles.length, 0); f.boxes[0].props.onChange(); assert.deepEqual(f.toggles, [1]); assert.equal(f.boxes[5].props.disabled, false); f.unmount();
}
{
  const f = fixture(); f.state({ selectedIds: [], dirty: true }); const button = f.button("保存"); button.props.onClick(); button.props.onClick(); await flush(); assert.equal(f.stops, 1); assert.equal(f.saves, 0);
  f.denyStop(); f.button("保存").props.onClick(); await flush(); assert.match(text(f.tree), /当前无法禁用同步/); assert.equal(f.saves, 0); f.unmount();
}
{
  const request = deferred(), f = fixture(); f.state({ selectedIds: [2], dirty: true }); f.saveWith(() => request.promise); const button = f.button("保存"); button.props.onClick(); button.props.onClick(); assert.equal(f.saves, 1);
  assert.ok(f.button("取消").props.disabled); f.button("取消").props.onClick(); assert.equal(f.cancels, 0); request.resolve(true); await flush(); assert.equal(f.saved, 1); f.unmount();
}
{
  const f = fixture(); f.state({ selectedIds: [2], dirty: true, saveError: "error" }); assert.match(text(f.tree), /无法保存已同步的代码仓库。请重试/);
  f.state({ uncertain: true, blocked: true }); assert.match(text(f.tree), /保存结果尚未确认/); f.button("保存").props.onClick(); f.button("取消").props.onClick(); assert.equal(f.saves, 0); assert.equal(f.cancels, 0);
  f.button("重新读取").props.onClick(); await flush(); assert.equal(f.reloads, 1); assert.equal(f.saves, 0); f.unmount();
}
{
  const f = fixture(); f.state({ nextToken: "" }); assert.ok(f.button("加载更多代码仓库")); f.button("加载更多代码仓库").props.onClick(); f.button("加载更多代码仓库").props.onClick(); await flush(); assert.equal(f.more, 1);
  f.state({ pageError: "page failed", nextToken: "next" }); assert.match(text(f.tree), /无法加载插件设置/); f.button("重试").props.onClick(); await flush(); assert.equal(f.more, 1); assert.equal(f.reloads, 1, "page recovery resets the cursor by rereading configuration and the submitted query's first page");
  f.state({ error: "read error" }); assert.equal(f.boxes.length, 0); f.button("重试").props.onClick(); await flush(); assert.equal(f.reloads, 2); f.unmount();
}
{
  const f = fixture(); f.tree; f.input.props.onChange({ target: { value: "中文" } }); f.find(n => n.type === "form").props.onCompositionStart(); f.submit(); assert.equal(f.queries.length, 0);
  let prevented = 0; f.find(n => n.type === "form").props.onKeyDown(event({ key: "Enter", nativeEvent: { keyCode: 229 }, preventDefault: () => prevented++ })); assert.equal(prevented, 1);
  f.find(n => n.type === "form").props.onCompositionEnd(); f.submit(); await flush(); assert.deepEqual(f.queries, ["中文"]); f.unmount();
}
{
  const request = deferred(), f = fixture(); f.state({ selectedIds: [2], dirty: true }); const oldToggle = f.boxes[0], oldKey = f.tree.key; f.saveWith(() => request.promise); f.button("保存").props.onClick();
  f.update({ connectionIdentity: "other" }); assert.notEqual(f.tree.key, oldKey); f.update({ connectionIdentity: "c" }); oldToggle.props.onChange(); assert.equal(f.toggles.length, 0); request.resolve(true); await flush(); assert.equal(f.saved, 0);
  const toggle = f.boxes[0]; f.unmount(); toggle.props.onChange(); assert.equal(f.toggles.length, 0);
}
{
  const f = fixture(); f.state({ dirty: true, selectedIds: [2] }); const checkbox = f.boxes[0], save = f.button("保存"), cancel = f.button("取消");
  f.update({ disabled: true }); checkbox.props.onChange(); save.props.onClick(); cancel.props.onClick(); f.submit(); assert.equal(f.toggles.length, 0); assert.equal(f.saves, 0); assert.equal(f.cancels, 0); assert.equal(f.queries.length, 0); f.unmount();
}
{
  const f = fixture(); f.state({ dirty: true, selectedIds: [2] }); f.saveWith(async () => false); f.button("保存").props.onClick(); await flush(); assert.equal(f.saved, 0); assert.equal(f.boxes[1].props.checked, true);
  f.saveWith(async () => { throw Error("failure"); }); f.button("保存").props.onClick(); await flush(); assert.match(text(f.tree), /无法保存已同步的代码仓库。请重试/); assert.equal(f.saved, 0); f.unmount();
}
{
  const f = fixture(); f.state({ repositories: [], selectedIds: [], dirty: false }); assert.match(text(f.tree), /未找到代码仓库/); assert.equal(f.button("保存"), undefined); f.state({ loading: true }); assert.ok(f.find(n => n.props.role === "status")); f.unmount();
}
console.log("Plugin GitHub sync panel: submitted search and IME, persistent drafts, five-repository boundary, cancel/no-write, zero-selection parent confirmation, verified save notification, unknown/read/page recovery and scope/ABA/DOM isolation passed.");

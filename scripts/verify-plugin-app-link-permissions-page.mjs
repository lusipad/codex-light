import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync("src/components/PluginAppLinkPermissionsPage.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = node => typeof node === "string" ? node : !node || typeof node !== "object" ? "" : [node.props?.children].flat(Infinity).map(text).join("");
const event = patch => ({ preventDefault() {}, stopPropagation() {}, nativeEvent: {}, ...patch });
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
const options = ["always_ask", "ask_before_writes", "review_important_actions", "full_access"].map((value, i) => ({ value, label: ["始终询问", "允许使用只读工具", "允许使用低风险工具", "允许使用所有工具"][i], description: `实际描述${i}` }));
function fixture() {
  let cursor = 0, dirty = true, effects = [], tree, retry = 0, retryFailed = 0, clears = 0, accepted = true;
  let save = async () => true; const slots = [], writes = [], selected = [], unavailable = [], document = { title: "old" };
  let props = { connectionIdentity: "a", pluginId: "p", appId: "app", selectedLinkId: null, onRoot() {}, onPlugin() {}, onSelectLink: id => { selected.push(id); if (accepted) props = { ...props, selectedLinkId: id }; dirty = true; return accepted; }, onUnavailable: kind => unavailable.push(kind) };
  const snapshot = { appId: "resolved-A", access: "allowed", defaultValue: "review_important_actions", defaultError: null, details: { pluginName: "真实插件" }, accounts: [
    { linkId: "one", permission: null, identity: "one@example.test", nickname: "Work", avatarUrl: "https://example.test/avatar.png", editable: true },
    { linkId: "two", permission: "always_ask", identity: "two@example.test", nickname: null, avatarUrl: "javascript:alert(1)", editable: true },
  ] };
  let state = { scope: "a:p:app", snapshot, loading: false, error: null, unavailable: null, pending: false, blocked: false, failedLinkIds: [], pendingLinkIds: [], refreshError: null };
  const react = { useId: () => "test", useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; dirty = true; }]; },
    useEffect(run, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((value, index) => value !== old.deps[index])) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: run() }; }); },
    useLayoutEffect(run, deps) { react.useEffect(run, deps); },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, document, URL, require(name) {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
    if (name === "lucide-react") return { ArrowLeft: "ArrowLeft", ChevronRight: "ChevronRight" };
    if (name === "../pluginAppLinkPermissions") return { pluginAppPermissionAccounts: snapshot => snapshot.accounts, pluginAppLinkPermissionOptions: options };
    if (name === "../bridge") return { tauriInvoke: async () => { throw Error("test never opens external URLs"); } };
    if (name === "../pluginAppLinkPermissionsState") return { usePluginAppLinkPermissions: (...args) => { assert.deepEqual(args, [props.connectionIdentity, props.pluginId, props.appId]); return { state, reload: async () => { retry++; }, retryFailed: async () => { retryFailed++; return true; }, change: (...args) => { writes.push(args); return save(); }, clearErrors: () => clears++ }; } };
    if (name.endsWith(".css")) return {}; throw Error(name);
  } });
  function render() { for (let turn = 0; dirty; turn++) { assert.ok(turn < 20); dirty = false; cursor = 0; tree = exports.PluginAppLinkPermissionsPage(props); const batch = effects; effects = []; batch.forEach(run => run()); } return tree; }
  return { snapshot, writes, selected, unavailable, document, get retry() { return retry; }, get retryFailed() { return retryFailed; }, get clears() { return clears; }, get tree() { return render(); },
    get radio() { return nodes(render()).filter(node => node.type === "input" && node.props.type === "radio"); },
    find(predicate) { return nodes(render()).find(predicate); }, button(label) { return this.find(node => node.type === "button" && text(node) === label); },
    update(patch) { props = { ...props, ...patch }; dirty = true; render(); }, state(patch) { state = { ...state, ...patch }; dirty = true; render(); }, rerender() { dirty = true; render(); },
    rejectSelection() { accepted = false; }, saveWith(callback) { save = callback; }, unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
{
  const f = fixture(), before = f.find(node => node.type === 'img'), image = { style: {} };
  before.props.onError({ currentTarget: image }); assert.equal(image.style.display, 'none');
  f.snapshot.accounts[0].avatarUrl = 'https://example.test/recovered.png'; f.rerender();
  assert.notEqual(f.find(node => node.type === 'img').key, before.key, 'a new avatar URL must remount the failed DOM image instead of retaining its hidden style');
  f.unmount();
}
{
  const f = fixture(); assert.equal(f.document.title, "old"); f.tree; assert.equal(f.document.title, "权限");
  assert.match(text(f.tree), /插件设置.*真实插件.*权限/); assert.ok(!text(f.tree).includes("查看详情")); assert.equal(f.radio.length, 0, "mixed defaults to account list");
  assert.equal(nodes(f.tree).filter(n => n.type === "img").length, 1, "unsafe avatar URLs are not loaded");
  f.find(n => n.props.role === "switch").props.onClick(); assert.equal(f.writes.length, 0); assert.equal(f.radio.length, 4); assert.ok(f.radio.every(n => !n.props.checked));
  assert.match(text(f.tree), /这些账户的权限不同/); assert.match(text(f.tree), /风险较高/); assert.match(text(f.tree), /默认/);
  f.radio[3].props.onClick(event()); await flush(); assert.deepEqual(f.writes[0], [["one", "two"], "full_access"]); f.unmount(); assert.equal(f.document.title, "old");
}
{
  const f = fixture(); f.snapshot.accounts[1].permission = null; f.tree; assert.equal(f.radio.length, 4); assert.equal(f.radio[2].props.checked, true);
  assert.equal(f.button("重置为默认设置"), undefined); f.radio[2].props.onClick(event()); await flush(); assert.equal(f.writes.length, 1, "checked inherited default still creates raw override");
  assert.equal(f.radio[2].props.onChange, undefined, "one input gesture cannot dispatch both change and click"); f.snapshot.accounts[0].permission = "full_access"; f.snapshot.accounts[1].permission = "full_access"; f.rerender();
  f.radio[3].props.onClick(event()); assert.equal(f.writes.length, 1, "matching raw overrides do not write again");
  f.button("重置为默认设置").props.onClick(); await flush(); assert.equal(f.writes[1][1], null); f.unmount();
}
{
  const f = fixture(); f.tree; f.find(n => n.type === "button" && n.props.className === "palp-account" && text(n).includes("one@example.test")).props.onClick(); assert.equal(f.selected.at(-1), "one"); assert.equal(f.radio.length, 4);
  f.button("返回已关联账户").props.onClick(); assert.equal(f.selected.at(-1), null); assert.equal(f.radio.length, 0, "return explicitly retains list mode");
  f.update({ selectedLinkId: "missing" }); assert.equal(f.radio.length, 4); assert.equal(f.find(n => n.type === "fieldset").props.disabled, true); f.radio[0].props.onClick(event()); assert.equal(f.writes.length, 0);
  f.unmount();
}
{
  const f = fixture(); f.snapshot.accounts[1].editable = false; f.tree;
  const row = f.find(n => n.type === "button" && n.props.className === "palp-account" && text(n).includes("two@example.test")); assert.equal(row.props.disabled, true); row.props.onClick(); assert.equal(f.selected.length, 0);
  f.find(n => n.props.role === "switch").props.onClick(); assert.equal(f.find(n => n.type === "fieldset").props.disabled, true); assert.match(text(f.tree), /无法更改一个或多个账户的权限/); f.unmount();
}
{
  const f = fixture(); f.tree; f.state({ failedLinkIds: ["two"], refreshError: "refresh" }); assert.match(text(f.tree), /无法保存 1 个账户的权限/); f.button("重试").props.onClick(); await flush(); assert.equal(f.retryFailed, 1); assert.equal(f.retry, 0);
  f.state({ failedLinkIds: [], refreshError: "refresh", blocked: true }); f.button("重试").props.onClick(); await flush(); assert.equal(f.retry, 1); assert.equal(f.writes.length, 0); f.unmount();
}
for (const failedLinkIds of [[], ["two"]]) {
  const f = fixture(); f.tree; f.state({ failedLinkIds, pendingLinkIds: ["one"], blocked: true, refreshError: null, error: null });
  assert.match(text(f.tree), /账户权限保存结果尚未确认，请重新读取后核对。/);
  if (failedLinkIds.length) assert.match(text(f.tree), /无法保存 1 个账户的权限/);
  assert.equal(nodes(f.tree).filter(n => n.props.role === "alert").length, 1, "unknown and failed counts share one recovery panel");
  f.button("重新读取").props.onClick(); await flush(); assert.equal(f.retry, 1); assert.equal(f.retryFailed, 0); assert.equal(f.writes.length, 0); f.unmount();
}
{
  const f = fixture(); f.update({ selectedLinkId: "one" }); const request = deferred(); f.saveWith(() => request.promise); f.tree;
  const radio = f.radio[0]; radio.props.onClick(event()); radio.props.onClick(event()); assert.equal(f.writes.length, 1); assert.equal(f.find(n => n.type === "fieldset").props.disabled, true); assert.equal(f.button("返回已关联账户").props.disabled, true);
  request.resolve(true); await flush(); f.state({ pending: true }); assert.equal(f.find(n => n.type === "fieldset").props.disabled, true); f.unmount();
}
{
  const f = fixture(); f.update({ selectedLinkId: "one" }); f.tree; f.rejectSelection(); f.button("返回已关联账户").props.onClick(); assert.equal(f.radio.length, 4);
  const old = f.radio[0]; f.update({ connectionIdentity: "b" }); f.update({ connectionIdentity: "a" }); old.props.onClick(event()); assert.equal(f.writes.length, 0);
  const current = f.radio[0]; f.unmount(); current.props.onClick(event()); assert.equal(f.writes.length, 0);
}
{
  const f = fixture(); f.tree; f.state({ snapshot: null, loading: true }); assert.ok(f.find(n => n.props.role === "status")); f.state({ loading: false, error: "load failed" }); assert.match(text(f.tree), /无法加载插件设置/);
  f.state({ unavailable: "plugin" }); assert.deepEqual(f.unavailable, ["plugin"]); f.unmount();
}
{
  const f = fixture(); f.update({ selectedLinkId: "one" }); f.tree; let prevented = 0, stopped = 0;
  f.tree.props.onKeyDown(event({ key: "ArrowRight", nativeEvent: { keyCode: 229 }, preventDefault: () => prevented++, stopPropagation: () => stopped++ }));
  f.tree.props.onKeyDown(event({ key: "Enter", nativeEvent: { isComposing: true }, preventDefault: () => prevented++, stopPropagation: () => stopped++ }));
  assert.equal(prevented, 2); assert.equal(stopped, 2); assert.equal(f.writes.length, 0);
  const old = f.radio[0]; f.update({ selectedLinkId: "two" }); f.update({ selectedLinkId: "one" }); old.props.onClick(event()); assert.equal(f.writes.length, 0);
  const link = f.find(n => n.type === "a"); assert.equal(link.props.href, "https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt#:~:text=App%20permission%20settings%20determine");
  assert.ok(f.radio.every(n => n.props.name === f.radio[0].props.name && n.props.type === "radio"), "native same-name radios preserve platform focus and arrow semantics"); f.unmount();
}
{
  const f = fixture(); f.tree;
  f.state({ snapshot: { ...f.snapshot, access: 'unavailable' }, error: '账户列表读取失败', blocked: true });
  assert.equal(f.find(node => node.props.role === 'switch'), undefined, 'unknown account eligibility must not render the permission editor or account mode controls');
  assert.equal(f.radio.length, 0); assert.ok(f.button('重试')); assert.equal(f.writes.length, 0); f.unmount();
}
{
  const f = fixture(); f.update({ appId: null }); f.tree;
  const oldRow = f.find(n => n.type === "button" && n.props.className === "palp-account" && text(n).includes("one@example.test"));
  const rootA = f.tree.key;
  f.find(n => n.props.role === "switch").props.onClick(); const oldRadio = f.radio[0]; assert.equal(f.radio.length, 4);
  const b = { ...f.snapshot, appId: "resolved-B" }; f.state({ snapshot: b });
  assert.notEqual(f.tree.key, rootA, 'resolved app replacement must retire the physical input subtree, not only old callbacks');
  const rootB = f.tree.key;
  assert.equal(f.radio.length, 0, "implicit canonical app change resets the previous app's local uniform override");
  oldRow.props.onClick(); oldRadio.props.onClick(event()); assert.equal(f.selected.length, 0); assert.equal(f.writes.length, 0);
  f.find(n => n.props.role === "switch").props.onClick(); const bRadio = f.radio[0];
  f.state({ snapshot: { ...b } }); assert.equal(f.radio.length, 4, "same resolved app refresh preserves the user's mode");
  assert.equal(f.tree.key, rootB, 'same app refresh preserves the actual control subtree');
  f.state({ snapshot: { ...f.snapshot } }); assert.equal(f.radio.length, 0);
  oldRow.props.onClick(); oldRadio.props.onClick(event()); bRadio.props.onClick(event()); assert.equal(f.selected.length, 0); assert.equal(f.writes.length, 0, "A to B to A never revives retired handlers");
  f.unmount();
}
{
  const f = fixture(), request = deferred(); f.update({ appId: null }); f.state({ snapshot: null, loading: true });
  f.state({ snapshot: f.snapshot, loading: false }); assert.equal(f.writes.length, 0, "first canonical resolution is read-only");
  f.find(n => n.props.role === "switch").props.onClick(); f.saveWith(() => request.promise); const radio = f.radio[0];
  radio.props.onClick(event()); radio.props.onClick(event()); assert.equal(f.writes.length, 1);
  f.state({ snapshot: { ...f.snapshot, appId: "resolved-B" } });
  const row = f.find(n => n.type === "button" && n.props.className === "palp-account"); assert.equal(row.props.disabled, false, "old local flight does not lock a newly resolved app");
  request.resolve(true); await flush(); assert.equal(f.radio.length, 0); assert.equal(f.writes.length, 1); f.unmount();
}
console.log("Plugin app link permission page: mixed/uniform modes, exact targets, raw overrides/reset, four options, busy/single flight, failed-only versus read recovery, safe avatars, denied navigation, stale/ABA/unmount handlers passed.");

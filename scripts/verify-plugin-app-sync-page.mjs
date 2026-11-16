import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync("src/components/PluginAppSyncPage.tsx", "utf8"), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = node => typeof node === "string" ? node : !node || typeof node !== "object" ? "" : [node.props?.children].flat(Infinity).map(text).join("");
const event = patch => ({ preventDefault() {}, stopPropagation() {}, nativeEvent: {}, ...patch });
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
const status = (extra = {}) => ({ user_connection_details: { auth_status: "user_connected", connection_instance_id: "instance", backing_link_id: "link", connector_id: "app", activation_status: "activated", last_full_sync_completed_at: "2026-11-10T01:00:00Z", last_delta_sync_completed_at: "2026-11-11T01:00:00Z", ...extra } });
function fixture() {
  let cursor = 0, dirty = true, effects = [], tree, restores = 0, focuses = 0, retry = 0, updated = 0, save = async () => true;
  const slots = [], writes = [], redirects = [], modal = { showModal() { this.open = true; }, close() { this.open = false; }, getBoundingClientRect: () => ({ left: 20, right: 520, top: 20, bottom: 420 }) };
  const snapshot = { identity: { accountId: "account", userId: "user", generation: 1 }, routeAppId: null, appId: "app", details: { pluginName: "真实插件" }, account: { id: "account", structure: "personal" }, statuses: [status()] };
  let state = { snapshot, loading: false, pending: false, blocked: false, error: null, unavailable: false, uncertain: false };
  let props = { connectionIdentity: "connection", pluginId: "plugin", appId: null, selectedLinkId: "link", onRoot() {}, onPlugin() {}, onUnavailable: () => redirects.push(true), onUpdated: () => updated++ };
  const react = { useId: () => "sync-test", useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { const value = typeof next === "function" ? next(slots[i]) : next; if (!Object.is(value, slots[i])) { slots[i] = value; dirty = true; } }]; },
    useEffect(run, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((value, index) => value !== old.deps[index])) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: run() }; }); },
    useLayoutEffect(run, deps) { react.useEffect(run, deps); },
  };
  const exports = {}, document = { title: "old", documentElement: { lang: "zh-CN" }, activeElement: { isConnected: true, focus: () => restores++ } };
  vm.runInNewContext(source, { exports, document, Intl, Date, require(name) {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
    if (name === "./Icons") return { CloseIcon: "CloseIcon" };
    if (name === "lucide-react") return { Loader2: "Loader2" };
    if (name === "../pluginAppSyncState") return { usePluginAppSync: (...args) => { assert.deepEqual(args, [props.connectionIdentity, props.pluginId, props.appId, props.selectedLinkId]); return { state, reload: async () => { retry++; }, disable: item => { writes.push(item); return save(item); } }; } };
    if (name === "../pluginAppSync") return {
      pluginAppSyncBadge: value => ({ label: value === "activated" ? "已同步" : value === "activating" || value === "partially_activated" ? "正在同步" : "未同步", variant: value === "activated" ? "success" : "outline" }),
      pluginAppSyncUpdatedAt: item => item.user_connection_details.last_full_sync_completed_at ?? item.user_connection_details.last_delta_sync_completed_at ?? null,
      pluginAppSyncCanDisable: (item, account, id) => item.user_connection_details.auth_status === "user_connected" && account?.id === id && (item.user_connection_details.connection_instance_id.length > 0 || account.structure === "personal" && item.user_connection_details.backing_link_id != null),
    };
    if (name.endsWith(".css")) return {}; throw Error(name);
  } });
  function render() { for (let turn = 0; dirty; turn++) { assert.ok(turn < 25); dirty = false; cursor = 0; tree = exports.PluginAppSyncPage(props);
    for (const node of nodes(tree)) if (node.props.ref) node.props.ref.current = node.type === "dialog" ? modal : { focus: () => focuses++ };
    const batch = effects; effects = []; batch.forEach(run => run()); } return tree; }
  return { snapshot, writes, redirects, modal, document, get tree() { return render(); }, get restores() { return restores; }, get focuses() { return focuses; }, get retry() { return retry; },
    get updated() { return updated; }, get dialog() { return nodes(render()).find(n => n.type === "dialog"); }, get checkbox() { return nodes(render()).find(n => n.props.type === "checkbox"); },
    find(fn) { return nodes(render()).find(fn); }, buttons(label) { return nodes(render()).filter(n => n.type === "button" && text(n) === label); },
    open() { this.buttons("禁用同步")[0].props.onClick(); render(); }, ack() { this.checkbox.props.onChange({ target: { checked: true } }); render(); },
    submit() { this.find(n => n.type === "form").props.onSubmit(event()); render(); },
    state(patch) { state = { ...state, ...patch }; dirty = true; render(); }, update(patch) { props = { ...props, ...patch }; dirty = true; render(); }, saveWith(callback) { save = callback; }, unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
{
  const f = fixture(); f.tree; assert.equal(f.document.title, "同步"); assert.match(text(f.tree), /插件设置.*真实插件.*同步/); assert.match(text(f.tree), /已同步/);
  assert.match(text(f.tree), /同步的内容可用于回答问题和查找信息/);
  assert.ok(!/开始同步|重新同步|查看详情|应用于所有账户|返回已关联账户|已同步的代码仓库/.test(text(f.tree)));
  const date = f.find(n => n.type === "time"); assert.equal(date.props.dateTime, "2026-11-10T01:00:00.000Z");
  assert.equal(text(date), new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date("2026-11-10T01:00:00Z")));
  f.open(); assert.ok(f.modal.open); assert.match(text(f.dialog), /停止同步此账户并移除其已同步内容？其他已关联账户不会受到影响/);
  assert.equal(f.buttons("禁用同步").at(-1).props.disabled, true); f.submit(); assert.equal(f.writes.length, 0); f.buttons("取消")[0].props.onClick(); assert.equal(f.dialog, undefined); assert.equal(f.writes.length, 0); assert.equal(f.restores, 1); f.unmount();
}
{
  const request = deferred(), f = fixture(); f.saveWith(() => request.promise); f.tree; f.open(); f.ack(); f.submit(); f.submit(); assert.equal(f.writes.length, 1);
  assert.equal(f.buttons("取消")[0].props.disabled, true); f.buttons("取消")[0].props.onClick(); f.dialog.props.onCancel(event()); assert.ok(f.dialog);
  request.resolve(true); await flush(); assert.equal(f.dialog, undefined); assert.equal(f.updated, 1); f.unmount();
}
{
  const f = fixture(); f.saveWith(async () => false); f.tree; f.open(); f.ack(); f.submit(); await flush(); assert.ok(f.dialog); assert.equal(f.checkbox.props.checked, true);
  f.state({ error: "无法禁用同步。请重试" }); assert.match(text(f.dialog), /无法禁用同步。请重试/);
  f.state({ uncertain: true, blocked: true }); assert.match(text(f.dialog), /同步操作结果尚未确认/); f.submit(); assert.equal(f.writes.length, 1);
  f.buttons("重新读取")[0].props.onClick(); await flush(); assert.equal(f.retry, 1); assert.equal(f.writes.length, 1); assert.equal(f.updated, 0); f.unmount();
}
{
  const f = fixture(); f.state({ snapshot: { ...f.snapshot, statuses: [status({ auth_status: "admin_connected" })] } }); assert.match(text(f.tree), /由管理员管理/); assert.equal(f.buttons("禁用同步").length, 0);
  f.state({ snapshot: { ...f.snapshot, account: { id: "other", structure: "personal" } } }); assert.equal(f.buttons("禁用同步")[0].props.disabled, true);
  f.state({ snapshot: { ...f.snapshot, statuses: [] } }); assert.match(text(f.tree), /未同步/); assert.equal(f.buttons("禁用同步").length, 0); f.unmount();
}
{
  const f = fixture(); f.tree; const oldRow = f.buttons("禁用同步")[0]; f.open(); f.ack(); const oldSubmit = f.find(n => n.type === "form"), oldDialog = f.dialog;
  const aKey = f.tree.key; f.state({ snapshot: { ...f.snapshot, appId: "B" } }); assert.notEqual(f.tree.key, aKey); assert.equal(f.dialog, undefined);
  oldRow.props.onClick(); oldSubmit.props.onSubmit(event()); assert.equal(f.dialog, undefined); assert.equal(f.writes.length, 0);
  f.state({ snapshot: { ...f.snapshot } }); oldRow.props.onClick(); oldSubmit.props.onSubmit(event()); assert.equal(f.dialog, undefined); assert.equal(f.writes.length, 0);
  f.open(); f.ack(); oldDialog.props.onCancel(event()); assert.ok(f.dialog); const form = f.find(n => n.type === "form"); f.unmount(); form.props.onSubmit(event()); assert.equal(f.writes.length, 0);
}
{
  const f = fixture(); f.tree; f.open(); f.ack(); let prevented = 0; f.dialog.props.onCompositionStart(); f.submit(); f.dialog.props.onCancel(event()); assert.equal(f.writes.length, 0); assert.ok(f.dialog);
  f.dialog.props.onKeyDown(event({ key: "Enter", nativeEvent: { keyCode: 229 }, preventDefault: () => prevented++ })); assert.equal(prevented, 1); f.dialog.props.onCompositionEnd();
  f.dialog.props.onKeyDown(event({ key: "Escape" })); assert.equal(f.dialog, undefined); f.unmount();
}
{
  const firstRequest = deferred(), secondRequest = deferred(), f = fixture(); f.saveWith(() => firstRequest.promise); f.tree; f.open(); f.ack(); f.submit();
  f.state({ snapshot: { ...f.snapshot, appId: "B" } }); f.saveWith(() => secondRequest.promise); f.open(); f.ack(); f.submit();
  firstRequest.resolve(true); await flush(); assert.ok(f.dialog, "old confirmed write must not dismiss the newer app's dialog"); assert.equal(f.buttons("取消")[0].props.disabled, true); assert.equal(f.updated, 0);
  secondRequest.resolve(true); await flush(); assert.equal(f.dialog, undefined); assert.equal(f.writes.length, 2); assert.equal(f.updated, 1); f.unmount();
}
{
  const f = fixture(); f.tree; f.open(); let focused, prevented = 0;
  const control = () => ({ getClientRects: () => [{}], focus() { focused = this; } }); const first = control(), last = control();
  const element = { querySelectorAll: () => [first, last], contains: value => [first, last].includes(value), ownerDocument: { activeElement: first } };
  f.dialog.props.onKeyDown(event({ key: "Tab", shiftKey: true, currentTarget: element, preventDefault: () => prevented++ })); assert.equal(focused, last);
  element.ownerDocument.activeElement = last; f.dialog.props.onKeyDown(event({ key: "Tab", currentTarget: element, preventDefault: () => prevented++ })); assert.equal(focused, first); assert.equal(prevented, 2);
  f.buttons("取消")[0].props.onClick(); f.open(); assert.equal(f.checkbox.props.checked, false, "reopening confirmation resets acknowledgement"); f.unmount();
}
console.log("Plugin app sync page: real status-only surface, dates, admin/eligibility gates, acknowledged destructive confirmation, cancel/pending/failure/unknown recovery, scope/ABA/DOM retirement and IME passed.");

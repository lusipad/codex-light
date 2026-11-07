import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const walk = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(walk)] : [];
const text = node => typeof node === "string" ? node : node && typeof node === "object" ? (node.children ?? []).map(text).join("") : "";
const accessibleText = node => node?.props?.["aria-hidden"] === "true" ? "" : typeof node === "string" ? node : node && typeof node === "object" ? (node.children ?? []).map(accessibleText).join("") : "";
const candidate = (id, source = "users") => ({ kind: source === "external" ? "email" : source === "users" ? "user" : "group", target: source === "external" ? { kind: "email", email: id } : { kind: source === "users" ? "user" : "group", id }, label: id, source });
function harness() {
  const hooks = [], effects = [], instances = [], events = new Map(), portals = [], actions = []; let cursor = 0, renders = 0;
  const classes = new Set();
  const state = { canShowInvites: true, canInvite: true, context: { workspace: true, teamsAllowed: true } }, container = { classList: { contains: value => classes.has(value), add: value => classes.add(value), remove: value => classes.delete(value) }, clientLeft: 0, clientTop: 0, getBoundingClientRect: () => ({ left: 384, top: 100 }) };
  const box = { left: 408, right: 872, top: 180, bottom: 216, width: 464 }, document = { activeElement: null }, window = { innerWidth: 1280, innerHeight: 800,
    addEventListener: (name, fn) => events.set(name, fn), removeEventListener: (name, fn) => { if (events.get(name) === fn) events.delete(name); } };
  document.addEventListener = window.addEventListener; document.removeEventListener = window.removeEventListener;
  class Search {
    query = ""; focused = false; open = false; candidates = []; loading = { users: false, groups: false, teams: false }; errors = { users: null, groups: null, teams: null }; listeners = new Set(); attached = 0; disposed = 0;
    constructor(value) { this.state = value; instances.push(this); }
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit() { this.listeners.forEach(fn => fn()); }
    attach() { this.attached++; } dispose() { this.disposed++; }
    setQuery(raw) { this.query = raw; this.open = Boolean(raw.trim()) || this.focused && this.state.context.teamsAllowed; this.emit(); }
    setFocused(value) { this.focused = value; this.open = value && (Boolean(this.query.trim()) || this.state.context.teamsAllowed); this.emit(); }
    close() { this.query = ""; this.focused = false; this.open = false; this.emit(); }
    select(value) { if (!this.state.canInvite) return Promise.resolve(false); this.query = ""; this.open = false; actions.push({ kind: "select", candidate: value }); this.emit(); return Promise.resolve(false); }
    retry(kind) { actions.push({ kind: "retry", source: kind }); }
  }
  const React = { default: null, Fragment: "fragment",
    createElement(type, props, ...children) { const node = { type, props: props ?? {}, children: children.flat(Infinity) }; const element = { offsetHeight: 200, contains: value => value === element, closest: () => null, querySelectorAll: () => [], getBoundingClientRect: () => box, focus() { document.activeElement = node; } }; if (props?.ref) props.ref.current = element; return node; },
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial; return [hooks[i], value => { hooks[i] = typeof value === "function" ? value(hooks[i]) : value; renders++; }]; },
    useRef(initial) { const i = cursor++; return hooks[i] ?? (hooks[i] = { current: initial }); },
    useMemo(fn, deps) { const i = cursor++, old = hooks[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) hooks[i] = { value: fn(), deps }; return hooks[i].value; },
    useId() { const i = cursor++; return hooks[i] ?? (hooks[i] = `invite-${i}`); },
    useEffect(fn, deps) { const i = cursor++, old = hooks[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) { hooks[i] = { deps, fn, cleanup: old?.cleanup }; effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn(); }); } },
  }; React.default = React; React.useLayoutEffect = React.useEffect;
  const exports = {}; vm.runInNewContext(compile("src/components/SiteSharingInviteInput.tsx"), { exports, document, window, Node: Object, require: name => {
    if (name === "react") return React;
    if (name === "react-dom") return { createPortal(child, target) { portals.push({ child, target }); return child; } };
    if (name === "lucide-react") return { LoaderCircle: "svg", Users: "svg", UserRound: "svg" };
    if (name === "../siteSharingInvitationSearch") return { SiteSharingInvitationSearch: Search };
    if (name.endsWith(".css")) return {};
    throw Error(name);
  } });
  return { state, instances, events, portals, actions, box, window, document, container,
    render(props = { state, portalContainer: container }) { cursor = 0; const tree = exports.SiteSharingInviteInput(props); while (effects.length) effects.shift()(); return tree; },
    unmount() { hooks.forEach(h => h?.cleanup?.()); }, get renders() { return renders; },
    replayEffects() { hooks.forEach(h => { if (h?.fn) { h.cleanup?.(); h.cleanup = h.fn(); } }); },
  };
}
const input = tree => walk(tree).find(n => n.type === "input");
const key = (name, extras = {}) => { const result = { key: name, nativeEvent: {}, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extras }; return result; };
let passed = 0; const failed = [];
async function check(name, run) { try { await run(); passed++; console.log(`PASS ${name}`); } catch (error) { failed.push(name); console.error(`FAIL ${name}`, error); } }
await check("real input uses controller raw query, source placeholders and no forced autofocus/chips", async () => {
  const h = harness(); let tree = h.render(); assert.equal(input(tree).props.role, "combobox"); assert.equal(input(tree).props["aria-autocomplete"], "list"); assert.equal(Boolean(input(tree).props.autoFocus), false); assert.equal(input(tree).props.placeholder, "添加成员或团队"); input(tree).props.onChange({ currentTarget: { value: "  Raw text " } }); tree = h.render(); assert.equal(h.instances[0].query, "  Raw text "); assert.equal(input(tree).props.value, "  Raw text "); assert.equal(h.actions.length, 0);
  h.state.context.workspace = false; tree = h.render(); assert.equal(input(tree).props.placeholder, "输入电子邮箱地址"); h.state.context.workspace = true; h.state.context.teamsAllowed = false; tree = h.render(); assert.equal(input(tree).props.placeholder, "添加用户或群组"); h.unmount();
});
await check("teams/groups/people group order, stable active descendant and anchor width portal instead of420", async () => {
  const h = harness(); h.render(); const s = h.instances[0]; s.candidates = [candidate("person"), candidate("group", "groups"), candidate("team", "teams"), candidate("guest@actual.invalid", "external")]; s.setQuery("x"); h.render(); const tree = h.render(); const options = walk(tree).filter(n => n.props.role === "option"); assert.deepEqual(options.map(accessibleText), ["team", "group", "person", "guest@actual.invalid"]); assert.ok(input(tree).props["aria-activedescendant"]); assert.equal(options.some(n => n.props.id === input(tree).props["aria-activedescendant"]), true);
  assert.equal(h.portals.at(-1).target, h.container); const list = walk(tree).find(n => n.props.role === "listbox"); assert.equal(list.props.style.width, h.box.width); assert.notEqual(list.props.style.width, 420); assert.equal(input(tree).props["aria-controls"], list.props.id); h.unmount();
});
await check("arrows wrap and Enter selects exact current candidate without form default; Tab never invites", async () => {
  const h = harness(); let tree = h.render(); const s = h.instances[0], first = candidate("first"), second = candidate("second"); s.candidates = [first, second]; s.setQuery("x"); tree = h.render(); const down = key("ArrowDown"); input(tree).props.onKeyDown(down); tree = h.render(); assert.equal(down.prevented, true); const enter = key("Enter"); input(tree).props.onKeyDown(enter); assert.equal(enter.prevented && enter.stopped, true); assert.equal(h.actions[0].candidate, second);
  s.setQuery("x"); tree = h.render(); const tab = key("Tab"); input(tree).props.onKeyDown(tab); assert.equal(tab.prevented, false); assert.equal(h.actions.length, 1); h.unmount();
});
await check("IME Enter never selects; Escape closes only suggestions, clears query, stops propagation", async () => {
  const h = harness(); h.render(); const s = h.instances[0]; s.candidates = [candidate("actual")]; s.setQuery("x"); let tree = h.render(); for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }]) { input(tree).props.onKeyDown(key("Enter", { nativeEvent })); } assert.equal(h.actions.length, 0); assert.equal(s.query, "x"); const escape = key("Escape"); input(tree).props.onKeyDown(escape); assert.equal(escape.prevented && escape.stopped, true); assert.equal(s.query, ""); assert.equal(s.open, false); h.unmount();
});
await check("loading is not fake empty, independent errors retain options and Retry selects only its source", async () => {
  const h = harness(); h.render(); const s = h.instances[0]; s.setQuery("x"); s.loading.users = true; let tree = h.render(); assert.equal(text(tree).includes("没有匹配的用户或群组"), false); s.candidates = [candidate("actual")]; s.errors.groups = "failure"; s.errors.users = "failure"; s.loading.teams = true; tree = h.render(); assert.match(text(tree), /用户加载失败/); assert.match(text(tree), /无法加载群组/); assert.match(text(tree), /正在加载你的团队/); assert.equal(walk(tree).filter(n => n.props.role === "option").length, 1); walk(tree).find(n => n.props["aria-label"] === "重试群组搜索").props.onClick({ preventDefault() {} }); assert.deepEqual(h.actions.at(-1), { kind: "retry", source: "groups" }); h.unmount();
});
await check("disabled/hidden entry cannot select and controller lifecycle cleans up popup listeners", async () => {
  const h = harness(); h.render(); const s = h.instances[0]; s.candidates = [candidate("actual")]; s.setQuery("x"); h.render(); h.state.canInvite = false; let tree = h.render(); assert.equal(input(tree).props.disabled, true); input(tree).props.onKeyDown(key("Enter")); assert.equal(h.actions.length, 0); h.state.canShowInvites = false; tree = h.render(); assert.equal(input(tree), undefined); h.unmount(); assert.equal(s.disposed, 1); assert.equal(h.events.has("pointerdown"), false); assert.equal(h.events.has("resize"), false); assert.equal(h.events.has("scroll"), false);
});
await check("outside/Tab preserve raw draft, Escape clears, option click prevents default without creating chips", async () => {
  const h = harness(); h.render(); const s = h.instances[0], item = candidate("actual"); s.candidates = [item]; s.setQuery("  draft  "); let tree = h.render(); h.events.get("pointerdown")({ target: {} }); tree = h.render(); assert.equal(s.query, "  draft  "); assert.equal(s.open, false); assert.equal(h.events.has("pointerdown"), false);
  input(tree).props.onFocus(); tree = h.render(); const option = walk(tree).find(n => n.props.role === "option"), click = key("click"); option.props.onClick(click); assert.equal(click.prevented, true); assert.equal(h.actions.length, 1); assert.equal(h.actions[0].candidate, item); assert.equal(s.query, ""); tree = h.render(); assert.equal(walk(tree).some(n => n.props.role === "option"), false); assert.equal(input(tree).props.value, ""); h.unmount();
});
await check("highlight tracks target identity through reorder, removed highlight falls back to first", async () => {
  const h = harness(); h.render(); const s = h.instances[0], first = candidate("first"), second = candidate("second"), third = candidate("third"); s.candidates = [first, second]; s.setQuery("x"); let tree = h.render(); input(tree).props.onKeyDown(key("ArrowDown")); tree = h.render(); const selectedId = input(tree).props["aria-activedescendant"];
  s.candidates = [second, first, third]; tree = h.render(); assert.equal(input(tree).props["aria-activedescendant"], selectedId); s.candidates = [third, first]; tree = h.render(); const active = walk(tree).find(n => n.props.id === input(tree).props["aria-activedescendant"]); assert.equal(accessibleText(active), "third"); h.unmount();
});
await check("popup flips within viewport, uses anchor width and releases class/listeners on portal loss", async () => {
  const h = harness(); h.render(); const s = h.instances[0]; s.candidates = [candidate("actual")]; s.setQuery("x"); h.box.top = 680; h.box.bottom = 716; h.render(); let tree = h.render(); let list = walk(tree).find(n => n.props.role === "listbox"); assert.equal(list.props.style.width, 464); assert.ok(list.props.style.top + 100 < h.box.top); assert.equal(h.container.classList.contains("site-sharing-invite-open"), true);
  h.box.left = -20; h.events.get("resize")(); tree = h.render(); list = walk(tree).find(n => n.props.role === "listbox"); assert.equal(list.props.style.left + 384, 6); tree = h.render({ state: h.state, portalContainer: null }); assert.equal(walk(tree).some(n => n.props.role === "listbox"), false); assert.equal(h.container.classList.contains("site-sharing-invite-open"), false); assert.equal(h.events.size, 0); h.unmount();
});
await check("typing after Escape reopens suggestions without requiring an extra DOM focus event", async () => {
  const h = harness(); let tree = h.render(); const s = h.instances[0]; input(tree).props.onFocus(); s.candidates = [candidate("actual")]; s.setQuery("first"); tree = h.render(); input(tree).props.onKeyDown(key("Escape")); tree = h.render(); assert.equal(s.focused, false); input(tree).props.onChange({ currentTarget: { value: "next" } }); assert.equal(s.focused, true); tree = h.render(); assert.equal(input(tree).props["aria-expanded"], true); h.unmount();
});
await check("effect setup/cleanup/setup reattaches the same pure controller and releases final subscription", async () => {
  const h = harness(); h.render(); const s = h.instances[0]; h.replayEffects(); assert.equal(h.instances.length, 1); assert.equal(s.attached, 2); assert.equal(s.disposed, 1); assert.equal(s.listeners.size, 1); s.candidates = [candidate("actual")]; s.setQuery("x"); const tree = h.render(); input(tree).props.onKeyDown(key("Enter")); assert.equal(h.actions.length, 1); h.unmount(); assert.equal(s.disposed, 2); assert.equal(s.listeners.size, 0); assert.equal(h.events.size, 0);
});
await check("Escape from trailing and popup Retry buttons closes suggestions and returns input focus without dismissing parent", async () => {
  for (const fromPopup of [false, true]) { const h = harness(); h.render(); const s = h.instances[0]; s.setQuery("query"); s.errors.groups = "failed"; s.errors.users = "failed"; const tree = h.render();
    const owner = walk(tree).find(n => fromPopup ? n.props.role === "listbox" : n.props.className === "site-sharing-invite-field"), escape = key("Escape");
    owner.props.onKeyDown(escape); assert.equal(escape.prevented && escape.stopped, true); assert.equal(s.open, false); assert.equal(s.query, ""); assert.equal(h.document.activeElement.type, "input"); assert.equal(h.actions.length, 0); h.unmount();
  }
});
assert.equal(failed.length, 0, failed.join("; "));
console.log(`PASS actual SiteSharingInviteInput: ${passed} groups; explicit controller boundary; no HTTP/native/pixel claim`);

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync("src/components/PluginManagementToolbar.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const css = fs.readFileSync("src/components/PluginManagementToolbar.css", "utf8");
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const tabs = [{ id: "plugins", label: "插件", count: 2 }, { id: "apps", label: "应用", count: 3 },
  { id: "mcp", label: "MCP", count: 0 }, { id: "skills", label: "技能", count: 4 }, { id: "marketplaces", label: "市场", count: 1 }];
function fixture(initialWide = true, withObserver = true) {
  let cursor = 0, dirty = true, effects = [], tree, focused = 0, wide = initialWide;
  const slots = [], listeners = new Map(), observers = [], mediaListeners = new Set(), selected = [], queries = [];
  let props = { tabs, selected: "plugins", query: "existing", onSelect: id => selected.push(id), onQueryChange: value => queries.push(value) };
  class Element { constructor(tagName = "DIV", editable = false) { this.tagName = tagName; this.isContentEditable = editable; } }
  const media = { get matches() { return wide; }, addEventListener: (name, fn) => { assert.equal(name, "change"); mediaListeners.add(fn); }, removeEventListener: (name, fn) => mediaListeners.delete(fn) };
  const buttons = tabs.map((tab, index) => ({ id: tab.id, offsetLeft: index * 80, offsetWidth: 80 }));
  const container = { scrollLeft: 0, clientWidth: 160,
    querySelector: () => buttons.find(button => button.id === props.selected), querySelectorAll: () => buttons.filter(button => props.tabs.some(tab => tab.id === button.id)) };
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], value => { const next = typeof value === "function" ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useEffect(run, deps) { const i = cursor++, previous = slots[i]; if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: run() }; }); },
  };
  react.useLayoutEffect = react.useEffect;
  const exports = {};
  vm.runInNewContext(source, { exports, HTMLElement: Element,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === "lucide-react") return { Search: "Search" };
      return {};
    },
    window: { matchMedia: query => { assert.equal(query, "(min-width: 1024px)"); return media; },
      addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); } },
    ResizeObserver: withObserver ? class {
      constructor(fn) { this.fn = fn; this.observed = []; this.disconnected = false; observers.push(this); }
      observe(element) { this.observed.push(element); } disconnect() { this.disconnected = true; }
    } : undefined,
  });
  function render() {
    for (let turns = 0; dirty; turns++) {
      assert.ok(turns < 20); dirty = false; cursor = 0; tree = exports.PluginManagementToolbar(props);
      for (const node of nodes(tree)) if (node.props.ref) node.props.ref.current = node.type === "input" ? { focus: () => focused++ } : container;
      const pending = effects; effects = []; pending.forEach(run => run());
    }
    return tree;
  }
  return { get tree() { return render(); }, get focused() { return focused; }, Element, container, buttons, listeners, observers, mediaListeners, selected, queries,
    update(patch) { props = { ...props, ...patch }; dirty = true; return render(); },
    resize(nextWide) { wide = nextWide; for (const fn of mediaListeners) fn(); return render(); },
    key(patch = {}) { let prevented = 0; const event = { key: "f", ctrlKey: true, target: new Element(), preventDefault() { prevented++; }, ...patch }; listeners.get("keydown")?.(event); return prevented; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
{
  const f = fixture();
  const group = nodes(f.tree).find(node => node.props.role === "group"), buttons = nodes(group).filter(node => node.type === "button");
  assert.equal(group.props["aria-label"], "管理扩展程序"); assert.equal(buttons.length, 5);
  assert.equal(nodes(f.tree).some(node => ["tablist", "tab"].includes(node.props.role)), false);
  assert.ok(buttons.every(button => button.props.type === "button" && !("tabIndex" in button.props) && !("onKeyDown" in button.props)));
  assert.deepEqual(buttons.map(button => button.props["aria-pressed"]), [true, false, false, false, false]);
  buttons[1].props.onClick(); assert.deepEqual(f.selected, ["apps"]); assert.deepEqual(f.queries, []);
  const input = nodes(f.tree).find(node => node.type === "input");
  assert.equal(input.props.value, "existing"); assert.equal(input.props["aria-label"], "搜索插件");
  input.props.onChange({ target: { value: "中文 query" } }); assert.deepEqual(f.queries, ["中文 query"]);
  f.update({ selected: "apps", query: "中文 query" });
  assert.equal(nodes(f.tree).find(node => node.type === "input").props.placeholder, "搜索应用");
  assert.equal(nodes(f.tree).find(node => node.type === "input").props.value, "中文 query", "category does not reset controlled query");
  group.props.onWheel({ deltaX: 0, deltaY: 25, currentTarget: f.container }); assert.equal(f.container.scrollLeft, 25);
  group.props.onWheel({ deltaX: 4, deltaY: 25, currentTarget: f.container }); assert.equal(f.container.scrollLeft, 29, "source uses horizontal delta before vertical delta");
  f.update({ selected: "marketplaces" }); assert.equal(f.container.scrollLeft, 240);
  const observer = f.observers.at(-1); assert.equal(observer.observed.length, 6, "container and every segmented button are measured");
  f.container.clientWidth = 100; observer.fn(); assert.equal(f.container.scrollLeft, 300);
  f.update({ selected: "plugins" }); assert.equal(f.container.scrollLeft, 0); assert.ok(observer.disconnected);
  observer.fn(); assert.equal(f.container.scrollLeft, 0, "disconnected observer cannot scroll stale selection");
  f.unmount(); assert.ok(f.observers.every(item => item.disconnected)); assert.equal(f.mediaListeners.size, 0); assert.equal(f.listeners.size, 0);
}
{
  const f = fixture(); f.tree;
  assert.equal(f.key(), 1); assert.equal(f.focused, 1);
  assert.equal(f.key({ ctrlKey: false, metaKey: true, key: "F" }), 1); assert.equal(f.focused, 2);
  for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) assert.equal(f.key({ target: new f.Element(tag) }), 0);
  assert.equal(f.key({ target: new f.Element("SPAN", true) }), 0);
  assert.equal(f.key({ isComposing: true }), 0); assert.equal(f.key({ keyCode: 229 }), 0);
  assert.equal(f.key({ ctrlKey: false }), 0); assert.equal(f.key({ key: "g" }), 0); assert.equal(f.focused, 2);
  f.resize(false); assert.equal(nodes(f.tree).filter(node => node.type === "input").length, 0); assert.equal(f.listeners.size, 0); assert.equal(f.key(), 0);
  f.resize(true); assert.equal(nodes(f.tree).filter(node => node.type === "input").length, 1); assert.equal(f.key(), 1);
  f.unmount();
}
{
  const f = fixture(false, false); assert.equal(nodes(f.tree).filter(node => node.type === "input").length, 0);
  f.update({ selected: "skills" }); assert.equal(f.container.scrollLeft, 160, "selected item remains visible without ResizeObserver");
  f.resize(true); assert.equal(nodes(f.tree).find(node => node.type === "input").props.placeholder, "搜索技能");
  f.update({ selected: "mcp" }); assert.equal(nodes(f.tree).find(node => node.type === "input").props.placeholder, "搜索 MCP 服务器");
  f.update({ selected: "marketplaces" }); assert.equal(nodes(f.tree).find(node => node.type === "input").props.placeholder, "搜索市场"); f.unmount();
}
assert.match(css, /\.pmt-segments\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto[^}]*overflow-y:\s*hidden/);
assert.match(css, /\.pmt-search\s*\{[^}]*width:\s*224px/);
console.log("Plugin management toolbar: production group/buttons, controlled query, responsive search, guarded find, measured selected visibility and cleanup passed.");

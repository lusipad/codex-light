import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync("src/components/PluginInstalledStrip.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const css = fs.readFileSync("src/components/PluginInstalledStrip.css", "utf8");
const item = id => ({ key: id, plugin: { id, name: id, interface: { displayName: `Plugin ${id}` } }, href: `/plugins/${id}` });
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
function fixture() {
  let cursor = 0, dirty = true, effects = [], tree, width = 88;
  const slots = [], listeners = new Map(), observers = [], open = [], managed = [];
  let props = { items: Array.from({ length: 8 }, (_, i) => item(String(i))), onOpen: (...args) => open.push(args), onManage: () => managed.push(true) };
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => {
      const next = typeof value === "function" ? value(slots[i]) : value;
      if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; }
    }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(run, deps) { const i = cursor++, previous = slots[i];
      if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) effects.push(() => {
        previous?.cleanup?.(); slots[i] = { deps, cleanup: run() };
      });
    },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === "../plugins") return { pluginDisplayName: plugin => plugin.interface?.displayName || plugin.name };
    if (name === "./PluginLogo") return { PluginLogo: "PluginLogo" };
    if (name === "lucide-react") return { Settings2: "Settings2" };
    return {};
  }, window: {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
  }, ResizeObserver: class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(element) { this.element = element; }
    disconnect() { this.disconnected = true; }
  } });
  function render(commit = true) {
    if (commit && effects.length) {
      for (const node of nodes(tree)) if (node.props.ref) node.props.ref.current = { getBoundingClientRect: () => ({ width }) };
      const pending = effects; effects = []; pending.forEach(effect => effect());
    }
    for (let turns = 0; dirty; turns++) {
      assert.ok(turns < 20); dirty = false; cursor = 0; tree = exports.PluginInstalledStrip(props);
      if (!commit) break;
      for (const node of nodes(tree)) if (node.props.ref) node.props.ref.current = { getBoundingClientRect: () => ({ width }) };
      const pending = effects; effects = []; pending.forEach(effect => effect());
    }
    return tree;
  }
  return { exports, observers, listeners, open, managed, get tree() { return render(); },
    beforeEffects() { return render(false); },
    update(patch) { props = { ...props, ...patch }; dirty = true; return render(); },
    resize(value, observer = true) { width = value;
      if (observer) observers.at(-1).callback([{ contentRect: { width } }]); else listeners.get("resize")?.();
      return render();
    },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
{
  const f = fixture(), layout = f.exports.pluginInstalledStripLayout;
  for (const [width, count, visible, remaining] of [[null, 8, 0, 8], [0, 8, 0, 8], [43, 8, 0, 8], [44, 8, 0, 8],
    [88, 8, 1, 7], [352, 8, 8, 0], [396, 8, 8, 0], [44, 1, 1, 0], [0, 0, 0, 0]]) {
    const actual = layout(width, count); assert.equal(actual.visible, visible); assert.equal(actual.remaining, remaining);
  }
}
{
  const f = fixture();
  assert.equal(nodes(f.beforeEffects()).filter(node => node.type === "PluginLogo").length, 0, "unmeasured width does not draw ordinary or overflow logos");
  let links = nodes(f.tree).filter(node => node.type === "a" && node.props.className === "pis-slot");
  assert.equal(links.length, 2); assert.equal(links[0].props.href, "/plugins/0");
  assert.equal(links[1].props["aria-label"], "另有 7 个已连接插件");
  assert.deepEqual(nodes(links[1]).filter(node => node.type === "PluginLogo").map(node => node.props.plugin.id), ["1", "2", "3", "4"], "overflow uses the first four remaining plugin identities");
  const click = { button: 0 }, middle = { button: 1 }, other = { button: 2 };
  links[0].props.onClick(click); links[0].props.onAuxClick(middle); links[0].props.onAuxClick(other);
  assert.equal(f.open.length, 2); assert.equal(f.open[0][0].key, "0"); assert.equal(f.open[0][1], click); assert.equal(f.open[1][1], middle);
  assert.equal(f.managed.length, 0, "plugin links navigate to details, never management or installation");
  let prevented = 0;
  links[1].props.onClick({ button: 0, preventDefault() { prevented++; } });
  assert.equal(prevented, 1); assert.equal(f.managed.length, 1);
  links[1].props.onClick({ button: 0, ctrlKey: true, preventDefault() { throw Error("modified link must retain browser semantics"); } });
  assert.equal(f.managed.length, 1);
  f.resize(352); assert.equal(nodes(f.tree).filter(node => node.type === "a" && node.props.className === "pis-slot").length, 8);
  f.resize(43, false); assert.equal(nodes(f.tree).filter(node => node.type === "a" && node.props.className === "pis-slot").length, 1);
  f.update({ items: [item("new-a"), item("new-b")] });
  links = nodes(f.tree).filter(node => node.type === "a" && node.props.className === "pis-slot");
  assert.deepEqual(nodes(links[0]).filter(node => node.type === "PluginLogo").map(node => node.props.plugin.id), ["new-a", "new-b"], "item changes never retain old overflow identities");
  f.update({ onManage: undefined }); assert.equal(nodes(f.tree).filter(node => node.type === "a").length, 0, "without management the source still reserves overflow capacity");
  f.unmount(); assert.equal(f.listeners.size, 0); assert.ok(f.observers.every(observer => observer.disconnected));
}
{
  const f = fixture(); f.update({ loading: true });
  assert.equal(f.tree.props.role, "status"); assert.equal(nodes(f.tree).filter(node => node.props?.className === "pis-skeleton").length, 3);
  assert.equal(nodes(f.tree).filter(node => node.type === "a").length, 0);
  f.update({ loading: false, error: "Inventory unavailable" }); assert.equal(f.tree.props.role, "alert"); assert.equal(f.tree.props.children, "Inventory unavailable");
  f.update({ error: null, items: [] }); assert.equal(f.tree, null);
  f.update({ items: [item("returned")] }); assert.equal(nodes(f.tree).filter(node => node.type === "PluginLogo").length, 1);
  const previous = f.observers.at(-1); f.update({ loading: true });
  assert.ok(previous.disconnected); previous.callback([{ contentRect: { width: 1000 } }]);
  assert.equal(f.tree.props.role, "status", "late observer after cleanup cannot revive stale contents"); f.unmount();
}
assert.match(css, /\.pis-slot\s*\{[^}]*flex:\s*0 0 44px/);
assert.match(css, /\.pis-tile, \.pis-skeleton\s*\{[^}]*width:\s*36px/);
assert.match(css, /\.pis-mini-logo\s*\{[^}]*width:\s*13px/);
assert.match(css, /:hover \.pis-tile\s*\{[^}]*translateY\(-4px\)/);
assert.match(css, /:focus-visible \.pis-tile\s*\{[^}]*transform:\s*none/);
assert.match(css, /\.pis-row\s*\{[^}]*overflow:\s*visible/);
assert.match(css, /prefers-reduced-motion:\s*reduce/);
assert.doesNotMatch(css, /overflow-x:\s*(?:auto|scroll)|transition-delay/);
console.log("Plugin installed strip: production capacity, measured lifecycle, overflow identity, link actions, states and focus geometry passed.");

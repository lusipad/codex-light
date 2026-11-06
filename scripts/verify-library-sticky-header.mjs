import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Actual component/hooks; explicit DOM geometry and observer boundaries.
// This does not execute browser layout, native focus or official account gates.
const source = fs.readFileSync("src/components/LibraryStickyHeader.tsx", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
} }).outputText;
const walk = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(walk)] : [];
function setup(newLayout = false, actions = "controls", navigation = "tabs", parentCommitAfterLayout = false) {
  let cursor = 0, tree;
  const hooks = [], effects = [], passiveEffects = [], resize = [], mutations = [], writes = [], listeners = new Map();
  const effect = queue => (callback, deps) => { const i = cursor++, old = hooks[i];
    if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) {
      hooks[i] = { deps, cleanup: old?.cleanup }; queue.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = callback(); });
    }
  };
  class Observer {
    constructor(callback, list) { this.callback = callback; this.targets = []; this.disconnects = 0; list.push(this); }
    observe(target, options) { this.targets.push({ target, options }); }
    disconnect() { this.targets = []; this.disconnects++; }
  }
  const React = { Fragment: "fragment", createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useRef: initial => { const i = cursor++; return hooks[i] ??= { current: initial }; },
    useState: initial => { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = value; }]; },
    useLayoutEffect: effect(effects), useEffect: effect(passiveEffects),
  }; React.default = React;
  const style = () => ({ values: {}, setProperty(key, value) { this.values[key] = value; writes.push([key, value]); }, removeProperty(key) { delete this.values[key]; writes.push([key, null]); } });
  const container = { scrollTop: parentCommitAfterLayout ? 108 : 0, getBoundingClientRect: () => ({ top: 100 }),
    addEventListener: (type, callback, options) => { assert.equal(type, "scroll"); assert.equal(options.passive, true); listeners.set(type, callback); },
    removeEventListener: (type, callback) => { if (listeners.get(type) === callback) listeners.delete(type); } };
  const body = { getBoundingClientRect: () => ({ top: 150 }) };
  const props = { title: "资料库", actions, navigation, newLayout, scrollContainerRef: { current: parentCommitAfterLayout ? null : container }, bodyRef: { current: parentCommitAfterLayout ? null : body } };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => {
    if (name === "react") return React; if (name.endsWith(".css")) return {}; assert.fail(name);
  }, ResizeObserver: class extends Observer { constructor(callback) { super(callback, resize); } },
  MutationObserver: class extends Observer { constructor(callback) { super(callback, mutations); } },
  getComputedStyle: node => ({ paddingTop: "16px", paddingInlineStart: "12px", marginBottom: "8px", top: "-16px", ...node.computed }),
  });
  const dom = new Map();
  const render = () => {
    cursor = 0; tree = exports.LibraryStickyHeader(props);
    for (const node of walk(tree)) {
      const name = node.props.className;
      if (!name) continue;
      let element = dom.get(name);
      if (!element) { element = { style: style(), attributes: {}, offsetLeft: 48, offsetHeight: 60,
        rect: { top: 80, bottom: 180, height: 100 }, getBoundingClientRect() { return this.rect; },
        removeAttribute(key) { delete this.attributes[key]; }, toggleAttribute(key, value) { if (value) this.attributes[key] = ""; else delete this.attributes[key]; },
        querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
        querySelectorAll(selector) { return walk(this.tree).filter(item => item.props?.className?.split(" ").includes(selector.slice(1))).map(item => dom.get(item.props.className)).filter(Boolean); },
      }; dom.set(name, element); }
      element.tree = node; if (node.props.ref) node.props.ref.current = element;
    }
    const title = dom.get("library-sticky-title"), content = dom.get("library-sticky-title-content");
    if (content) content.parentElement = title;
    while (effects.length) effects.shift()();
    // React commits the ancestor host ref after child layout effects. Passive
    // effects run only after the complete tree, including sibling body refs.
    props.scrollContainerRef.current = container;
    props.bodyRef.current = body;
    while (passiveEffects.length) passiveEffects.shift()();
    return tree;
  };
  render();
  const shell = () => dom.get("library-sticky-shell");
  return { props, render, resize, mutations, writes, listeners, dom, shell,
    scroll(value) { container.scrollTop = value; listeners.get("scroll")?.(); },
    unmount() { for (const hook of hooks) hook?.cleanup?.(); },
  };
}

for (const newLayout of [false, true]) {
  const lateParent = setup(newLayout, "controls", "tabs", true);
  assert.equal(lateParent.listeners.size, 1, "ancestor scroll ref attaches after child layout effects and still receives exactly one listener");
  const mounted = lateParent.render();
  assert.equal(walk(mounted).find(node => node.props.className === "library-sticky-shell").props["data-scrolled"], true, "initial existing scroll position synchronizes before any new scroll event");
  if (!newLayout) assert.equal(lateParent.shell().style.values["--header-scroll-position"], "108px");
  else assert.equal(lateParent.shell().style.values["--header-background-top-inset"], "20px");
  lateParent.scroll(0); const top = lateParent.render();
  assert.equal(walk(top).find(node => node.props.className === "library-sticky-shell").props["data-scrolled"], undefined);
  lateParent.unmount(); assert.equal(lateParent.listeners.size, 0);
}

let h = setup();
assert.equal(h.resize.length, 1);
assert.deepEqual(h.resize[0].targets.map(entry => entry.target), [h.dom.get("library-sticky-content"), h.dom.get("library-sticky-title")]);
h.resize[0].callback();
assert.equal(h.shell().style.values["--header-content-start"], "60px");
assert.equal(h.shell().style.values["--header-collapse-offset"], "76px");
assert.equal(h.shell().attributes["data-collapsible"], "");
h.dom.get("library-sticky-title").offsetHeight = 120; h.resize[0].callback();
assert.equal(h.shell().style.values["--header-collapse-offset"], "136px", "wrapped/localized titles remeasure instead of using a fixed scroll threshold");
h.mutations[0].callback();
assert.equal(h.resize[0].targets.length, 2);
assert.deepEqual({ ...h.mutations[0].targets[0].options }, { childList: true, characterData: true, subtree: true });
h.shell().offsetHeight = 200; h.scroll(40);
assert.equal(h.shell().style.values["--header-scroll-position"], "40px");
assert.equal(h.shell().style.values["--header-scroll-overlap"], "68px", "overlap uses rect height ratio plus computed bottom margin");
let tree = h.render();
assert.equal(walk(tree).find(node => node.props.className === "library-sticky-shell").props["data-scrolled"], true);
h.scroll(0); tree = h.render();
assert.equal(walk(tree).find(node => node.props.className === "library-sticky-shell").props["data-scrolled"], undefined);
const inside = walk(tree).find(node => node.props.className === "library-sticky-navigation");
assert.ok(inside.children.includes("tabs"), "legacy navigation stays inside measured sticky shell");
assert.equal(walk(tree).find(node => node.props.className === "library-sticky-external-navigation"), undefined);
const oldResize = h.resize[0], oldMutation = h.mutations[0];
h.unmount(); assert.equal(h.listeners.size, 0); assert.equal(oldResize.targets.length, 0); assert.equal(oldMutation.targets.length, 0);
const afterCleanup = h.writes.length; oldResize.callback(); oldMutation.callback();
assert.equal(h.writes.length, afterCleanup, "queued callbacks cannot write to a discarded page");
assert.equal(oldResize.targets.length, 0, "late mutation must not reconnect observers after unmount");

h = setup(false, null, null); h.resize[0].callback();
assert.equal(h.shell().attributes["data-collapsible"], undefined, "missing real toolbar does not falsely mark the title collapsible"); h.unmount();
h = setup(true); assert.equal(h.resize.length, 2);
assert.deepEqual(h.resize[1].targets.map(entry => entry.target), [h.props.scrollContainerRef.current, h.shell()]);
h.resize[0].callback(); h.resize[1].callback();
assert.equal(h.shell().style.values["--header-background-top-inset"], "20px", "current 1x adaptation uses positive geometric inset, not DPI rounding");
h.scroll(1); tree = h.render();
assert.equal(walk(tree).find(node => node.props.className === "library-sticky-shell").props["data-scrolled"], true);
assert.equal(h.shell().style.values["--header-scroll-overlap"], undefined, "new layout must not apply legacy title sliding writes");
h.shell().rect = { top: 90, bottom: 190, height: 100 }; h.scroll(1); tree = h.render();
assert.equal(walk(tree).find(node => node.props.className === "library-sticky-shell").props["data-scrolled"], undefined, "nonzero scroll alone is insufficient before new-layout sticky boundary");
h.shell().rect = { top: 120, bottom: 220, height: 100 }; h.resize[1].callback();
assert.equal(h.shell().style.values["--header-background-top-inset"], "0px");
tree = h.render();
assert.equal(walk(tree).find(node => node.props.className === "library-sticky-navigation").children.filter(Boolean).length, 0);
assert.ok(walk(tree).find(node => node.props.className === "library-sticky-external-navigation").children.includes("tabs"));
const backgroundObserver = h.resize[1]; h.unmount();
assert.equal(backgroundObserver.targets.length, 0);
assert.equal(h.shell().style.values["--header-background-top-inset"], undefined);
const finalWrites = h.writes.length; backgroundObserver.callback(); assert.equal(h.writes.length, finalWrites);

h = setup(); h.resize[0].callback(); h.scroll(40);
const previousListener = h.listeners.get("scroll");
assert.equal(h.shell().style.values["--header-scroll-position"], "40px");
h.props.newLayout = true; h.render();
assert.notEqual(h.listeners.get("scroll"), previousListener, "layout changes replace the old branch listener instead of accumulating it");
assert.equal(h.listeners.size, 1);
assert.equal(h.shell().style.values["--header-scroll-position"], undefined);
assert.equal(h.shell().style.values["--header-scroll-overlap"], undefined);
const afterSwitch = h.writes.length; previousListener(); assert.equal(h.writes.length, afterSwitch);
const switchedObserver = h.resize[1]; assert.equal(switchedObserver.targets.length, 2);
h.props.newLayout = false; h.render();
assert.equal(switchedObserver.targets.length, 0);
assert.equal(h.listeners.size, 1); h.unmount(); assert.equal(h.listeners.size, 0);

const css = fs.readFileSync("src/components/LibraryStickyHeader.css", "utf8");
assert.match(css, /top:\s*calc\(-1\s*\*\s*var\(--header-collapse-offset\)\)/);
assert.match(css, /data-collapsible\].*\.library-sticky-actions\s*\{[^}]*position:\s*sticky/s);
assert.match(css, /data-library-new-layout\].*\.library-sticky-title-content\s*\{\s*transform:\s*none/s);
assert.match(css, /@container[^\n]*767px/);
const pageCss = fs.readFileSync("src/components/LibraryView.css", "utf8");
assert.match(pageCss, /\.library-workspace\s*>\s*\.library-view-container\s*\{[^}]*padding:\s*0\s*;/, "official N scrollport has no legacy padding that shifts the sticky threshold");
assert.match(pageCss, /\.library-workspace \.library-sticky-content[^}]*padding-inline:\s*48px/s, "official browse gutter belongs to content wrappers, not the scrollport");
assert.match(pageCss, /max-width:\s*1440px/, "extraWide wrappers retain the official maximum width");
console.log("PASS 18I actual Header JSX/hooks: dynamic geometry, mutation re-observation, old/new scroll branches, navigation ownership, missing toolbar, late-callback guards and observer/listener cleanup; CSS branch source checks only, no GUI/pixel claim");

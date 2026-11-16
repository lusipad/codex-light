import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

let slots = [], effects = [], queued = [], cursor = 0, dirty = false;
let theme = "light", systemDark = false, observerCallback, mediaCallback;
let disconnected = 0, mediaRemoved = 0;
const media = {
  get matches() { return systemDark; },
  addEventListener(_event, callback) { mediaCallback = callback; },
  removeEventListener() { mediaRemoved++; },
};
const react = {
  Fragment: "Fragment",
  createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat(Infinity) }; },
  useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
  useState(value) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value;
    return [slots[index], next => {
      const value = typeof next === "function" ? next(slots[index]) : next;
      if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; }
    }];
  },
  useEffect(callback, deps) {
    const index = cursor++, previous = effects[index];
    if (!previous || deps.some((value, index) => value !== previous.deps[index])) queued.push(() => {
      previous?.cleanup?.();
      effects[index] = { deps, cleanup: callback() };
    });
  },
};
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/PluginTemplateRows.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText, {
  exports, URL, Set,
  document: { documentElement: { getAttribute: () => theme } },
  window: { matchMedia: () => media },
  MutationObserver: class {
    constructor(callback) { observerCallback = callback; }
    observe() {}
    disconnect() { disconnected++; }
  },
  require(name) {
    if (name === "react") return react;
    if (name === "lucide-react") return { Ban: "Ban", ExternalLink: "ExternalLink", Plug: "Plug" };
    if (name.endsWith(".css")) return {};
    throw Error(`Unexpected side-effect import ${name}`);
  },
});

const nodes = node => !node || typeof node !== "object" ? [] : [node, ...(node.children || []).flatMap(nodes)];
const text = node => typeof node === "string" ? node : !node || typeof node !== "object" ? "" : (node.children || []).map(text).join("");
const event = () => ({ prevented: 0, stopped: 0, preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; } });
function render(component, props) {
  let tree, passes = 0;
  do {
    assert.ok(passes++ < 10, "render converges");
    dirty = false;
    cursor = 0;
    tree = component(props);
    queued.splice(0).forEach(run => run());
  } while (dirty);
  return tree;
}
function resetHooks() {
  effects.forEach(effect => effect?.cleanup?.());
  slots = []; effects = []; queued = []; cursor = 0; dirty = false;
}

const template = (templateId, materializedAppIds = []) => ({ templateId, name: `Template ${templateId}`, materializedAppIds, description: "One line description" });
const templates = [template("one"), template("materialized", ["actual-app"]), template("disabled"), template("two")];
const calls = [];
let finish;
let props = {
  templates,
  managementUrl: id => id === "disabled" ? null : `https://chatgpt.com/plugins/real-plugin?template=${id}`,
  onManage: id => { calls.push(id); return new Promise(resolve => { finish = resolve; }); },
};
const component = exports.PluginTemplateRows;
let tree = render(component, props);
const rows = tree => nodes(tree).filter(node => node.props["data-app-template"]);
const manageLinks = tree => nodes(tree).filter(node => node.type === "a");
assert.deepEqual(rows(tree).map(row => row.props["data-app-template"]), ["one", "disabled", "two"]);
for (const row of rows(tree)) {
  assert.equal(row.type, "div");
  assert.equal(row.props.onClick, undefined, "row never navigates");
  assert.equal(row.props.role, undefined);
  assert.equal(row.props.tabIndex, undefined, "an inert template row does not become a focus target");
  assert.ok(nodes(row).filter(node => node.type === "a" || node.type === "button").length <= 1);
}
assert.deepEqual(manageLinks(tree).map(text), ["管理应用", "管理应用"]);
assert.equal(nodes(tree).filter(node => node.type === "button").length, 0);
const unavailable = rows(tree)[1];
assert.ok(unavailable.props.className.includes("ptr-unavailable"));
const disabledGlyph = nodes(unavailable).find(node => node.props.role === "img");
assert.equal(disabledGlyph.props["aria-label"], "已被管理员禁用");
assert.equal(disabledGlyph.props.title, "已被管理员禁用");
assert.equal(disabledGlyph.props.tabIndex, undefined);
const click = event(), first = manageLinks(tree)[0];
const pending = first.props.onClick(click);
await first.props.onClick(event());
assert.equal(click.prevented, 1);
assert.equal(click.stopped, 1);
assert.deepEqual(calls, ["one"], "synchronous lock prevents double dispatch");
tree = render(component, props);
assert.equal(manageLinks(tree)[0].props["aria-disabled"], true);
assert.equal(manageLinks(tree)[0].props["aria-busy"], true);
assert.equal(manageLinks(tree)[0].props.tabIndex, -1);
finish(); await pending;
tree = render(component, props);
assert.equal(manageLinks(tree)[0].props["aria-busy"], undefined);
assert.ok(!text(tree).includes("成功"), "open ACK never becomes setup success");
const auxiliary = event();
first.props.onAuxClick(auxiliary);
assert.equal(auxiliary.prevented, 1, "auxiliary click cannot navigate renderer directly");
assert.equal(calls.length, 1);

props = { ...props, busyTemplateId: "one" };
render(component, props);
await first.props.onClick(event());
assert.equal(calls.length, 1, "old link reads current parent busy state");
props = { ...props, busyTemplateId: null, managementUrl: () => null };
render(component, props);
await first.props.onClick(event());
assert.equal(calls.length, 1, "old link cannot use revoked eligibility");
props = { ...props, managementUrl: id => `https://chatgpt.com/plugins/${id}`, templates: [template("one", ["real-app"])] };
assert.equal(rows(render(component, props)).length, 0);
await first.props.onClick(event());
assert.equal(calls.length, 1, "old link cannot manage a materialized template");
props = { ...props, templates: [template("one")], onManage: async () => { throw Error("parent reports bridge error"); } };
tree = render(component, props);
await assert.rejects(manageLinks(tree)[0].props.onClick(event()), /parent reports bridge error/);
tree = render(component, props);
assert.equal(manageLinks(tree)[0].props["aria-busy"], undefined, "failure releases lock for parent retry");
props = { ...props, onManage: async id => { calls.push(id); } };
tree = render(component, props);
await manageLinks(tree)[0].props.onClick(event());
assert.deepEqual(calls, ["one", "one"]);
for (const reason of [null, "NOT_CONFIGURED_FOR_WORKSPACE", "NO_ACTIVE_WORKSPACE"]) {
  props = { ...props, templates: [{ ...template("one"), reason }] };
  assert.equal(manageLinks(render(component, props)).length, 1, "reason never grants or denies URL qualification");
}

resetHooks();
let logoProps = { template: { ...template("logo"), logoUrl: "https://assets.example/light.png", logoUrlDark: "https://assets.example/dark.png" } };
let logo = render(exports.PluginTemplateLogo, logoProps);
const image = tree => nodes(tree).find(node => node.type === "img");
assert.equal(image(logo).props.src, logoProps.template.logoUrl);
assert.equal(image(logo).props.alt, "");
theme = "dark"; observerCallback();
logo = render(exports.PluginTemplateLogo, logoProps);
assert.equal(image(logo).props.src, logoProps.template.logoUrlDark);
image(logo).props.onError();
logo = render(exports.PluginTemplateLogo, logoProps);
assert.equal(image(logo).props.src, logoProps.template.logoUrl, "real alternate asset after image failure");
image(logo).props.onError();
logo = render(exports.PluginTemplateLogo, logoProps);
assert.equal(image(logo), undefined);
assert.ok(nodes(logo).some(node => node.type === "Plug"));
logoProps = { template: { ...logoProps.template, logoUrl: "https://assets.example/new.png" } };
logo = render(exports.PluginTemplateLogo, logoProps);
assert.ok(image(logo), "asset identity change permits new image");
theme = null; systemDark = false; mediaCallback();
logo = render(exports.PluginTemplateLogo, logoProps);
assert.equal(image(logo).props.src, logoProps.template.logoUrl);
for (const logoUrl of ["file:///private/icon.png", "javascript:alert(1)", "data:image/png;base64,a", "http://assets.example/a", "https://user:password@assets.example/a", "https://assets.example/a\n"]) {
  logoProps = { template: { ...template("unsafe"), logoUrl } };
  assert.equal(image(render(exports.PluginTemplateLogo, logoProps)), undefined, "unsafe decoration never loads");
}
resetHooks();
assert.equal(disconnected, 1);
assert.equal(mediaRemoved, 1);
console.log("Plugin template rows passed production JSX filtering, actions, pending, revoked eligibility and logo replay.");

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const plain = value => JSON.parse(JSON.stringify(value));
const added = [], constructed = [];
let rejectFont = false;
class LocalFont {
  constructor(alias, source) { constructed.push({ alias, source }); this.alias = alias; if (rejectFont) throw Error("missing local face"); }
  async load() { return this; }
}
const theme = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync("src/appearanceTheme.ts", "utf8")), {
  exports: theme.exports, require: () => ({}), FontFace: LocalFont, document: { fonts: { add: font => added.push(font) } },
});
const api = theme.exports;
assert.equal(api.firstThemeFontFamily('"A, B", serif'), "A, B");
assert.equal(api.firstThemeFontFamily('"A\\\" B", serif'), 'A" B');
const face = { family: "Example", fullName: "Example Bold", postscriptName: "Example-Bold" };
assert.equal(api.themeFontFamily('"Example", serif', face), '"Codex selected Example-Bold", "Example", serif');
assert.equal(api.themeFontFamily('"Other", serif', face), '"Other", serif', "stale face cannot affect a different family");
const selected = { fonts: { ui: '"Example", serif', code: null, uiFace: face } };
await Promise.all([api.loadThemeFonts([selected]), api.loadThemeFonts([selected])]);
assert.equal(constructed.length, 1); assert.equal(added.length, 1);
assert.equal(constructed[0].source, 'local("Example-Bold"), local("Example Bold")');
await api.loadThemeFonts([selected]); assert.equal(constructed.length, 1, "loaded alias is reused");
rejectFont = true;
const missing = { fonts: { ui: "Missing", code: null, uiFace: { ...face, family: "Missing", postscriptName: "Missing-Bold" } } };
await api.loadThemeFonts([missing]); const failedAttempts = constructed.length;
rejectFont = false; await api.loadThemeFonts([missing]); assert.equal(constructed.length, failedAttempts + 1, "failed aliases do not poison the load cache");
assert.equal(api.themeVariables({ ...api.defaultChromeTheme("dark"), fonts: { ui: '"Example", serif', code: null } }, "dark")["--font-sans"],
  '"Example", serif, sans-serif', "CSS fallback lists remain lists, not a quoted literal family");

const catalog = [
  { family: "Example", faces: [{ ...face, styleName: "Bold", isMonospaced: false }, { family: "Example", fullName: "Example Regular", postscriptName: "Example-Regular", styleName: "Regular", isMonospaced: false }] },
  { family: "Mono", faces: [{ family: "Mono", fullName: "Mono Regular", postscriptName: "Mono-Regular", styleName: "Regular", isMonospaced: true }] },
  { family: "Mixed", faces: [{ ...face, isMonospaced: true }, { ...face, postscriptName: "Mixed-Proportional", isMonospaced: false }] },
];
let pendingDirectory = false, returnedCatalog = catalog;
const system = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync("src/systemFonts.ts", "utf8")), {
  exports: system.exports, require: name => name === "./appearanceTheme" ? api : {},
});
assert.equal(system.exports.selectedSystemFont('"eXample", serif', undefined, catalog).face.postscriptName, "Example-Bold", "first face is not necessarily Regular");
assert.equal(system.exports.selectedSystemFont("Example", { ...face, family: "Other" }, catalog).face.postscriptName, "Example-Bold");
assert.equal(system.exports.fontFamilyAllowed(catalog[2], true), false, "every face must be monospaced");

const fontCode = compile(fs.readFileSync("src/components/AppearanceFontPicker.tsx", "utf8") + "\nexport { CustomFontMenu };\n");
const nodes = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(nodes)] : [];
function mount(name, props) {
  const hooks = []; let cursor = 0, tree;
  const react = { Fragment: "fragment", createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial;
      return [hooks[i], value => { hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }]; },
    useRef: value => hooks[cursor++] ??= { current: value }, useEffect() {}, useLayoutEffect() {} };
  const mod = { exports: {} };
  vm.runInNewContext(fontCode, { exports: mod.exports, document: { body: {} }, require: dependency => dependency === "react" ? react
    : dependency === "react-dom" ? { createPortal: value => value }
    : dependency.endsWith("appearanceTheme") ? api
    : dependency.endsWith("systemFonts") ? { ...system.exports, useSystemFonts: () => ({ pending: pendingDirectory, families: returnedCatalog }) }
    : dependency.endsWith("GeneralPreferenceSelect") ? { GeneralPreferenceSelect: function GeneralPreferenceSelect() {} } : {} });
  const render = () => { cursor = 0; tree = mod.exports[name](props); }; render();
  return { render, all: () => nodes(tree), by: predicate => nodes(tree).find(predicate) };
}
const changes = [], props = { id: "font", label: "字体", styleLabel: "样式", value: '"Example"', face: undefined, disabled: false,
  onChange: (...args) => changes.push(args) };
const picker = mount("AppearanceFontPicker", props);
const familyMenu = () => picker.by(node => node.props.id === "font");
const styleMenu = () => picker.by(node => node.props.id === "font-style");
assert.deepEqual(plain(familyMenu().props.options.map(item => item.value)), ["", "Example", "Mono", "Mixed"], "native directory order is preserved");
assert.equal(styleMenu().props.value, "Example-Bold");
familyMenu().props.onChange("Mono"); assert.deepEqual(plain(changes.at(-1)), ['"Mono"', null], "family selection clears old face metadata");
styleMenu().props.onChange("Example-Regular"); assert.deepEqual(plain(changes.at(-1)), ['"Example"', { family: "Example", fullName: "Example Regular", postscriptName: "Example-Regular" }]);
styleMenu().props.onChange("Example-Bold"); assert.equal(changes.at(-1)[1], undefined, "first face is represented without metadata");
props.monospace = true; picker.render();
assert.deepEqual(plain(familyMenu().props.options.map(item => item.value)), ["", "Mono"]); assert.equal(styleMenu().props.disabled, true);
props.value = null; props.content = true; picker.render(); assert.equal(familyMenu().props.options[0].label, "与界面字体相同");
props.content = false; props.value = "monospace"; picker.render();
assert.equal(familyMenu().props.value, "", "generic CSS family selects the System menu item");
familyMenu().props.onReselect(); assert.deepEqual(plain(changes.at(-1)), [null, null], "System reselect clears imported generic CSS and face");
pendingDirectory = true; picker.render(); assert.ok(picker.by(node => node.props.role === "status"));
pendingDirectory = false; returnedCatalog = null; picker.render();
assert.ok(picker.by(node => typeof node.type === "function" && node.type.name === "CustomFontMenu"));
assert.equal(styleMenu().props.disabled, true);
const customChanges = [], fallback = mount("CustomFontMenu", { label: "字体", defaultLabel: "系统", value: "Old", disabled: false, onChange: value => customChanges.push(value) });
fallback.by(node => node.props["aria-haspopup"] === "menu").props.onClick(); fallback.render();
const input = () => fallback.by(node => node.type === "input");
input().props.onChange({ target: { value: '"Example", serif' } }); fallback.render();
input().props.onCompositionStart(); fallback.by(node => node.type === "form").props.onSubmit({ preventDefault() {} }); assert.equal(customChanges.length, 0);
input().props.onCompositionEnd(); fallback.by(node => node.type === "form").props.onSubmit({ preventDefault() {} });
assert.deepEqual(customChanges, ['"Example", serif']);
const sameChanges = [], sameFamily = mount("CustomFontMenu", { label: "字体", defaultLabel: "系统", value: "Arial", hasFace: true, disabled: false, onChange: value => sameChanges.push(value) });
sameFamily.by(node => node.props["aria-haspopup"] === "menu").props.onClick(); sameFamily.render();
sameFamily.by(node => node.type === "form").props.onSubmit({ preventDefault() {} });
assert.deepEqual(sameChanges, ["Arial"], "custom value clears a previous nondefault face even when family text is unchanged");
const genericChanges = [], genericFallback = mount("CustomFontMenu", { label: "字体", defaultLabel: "系统", value: "system-ui", disabled: false, onChange: value => genericChanges.push(value) });
genericFallback.by(node => node.props["aria-haspopup"] === "menu").props.onClick(); genericFallback.render();
const genericDefault = genericFallback.by(node => node.props.role === "menuitemradio");
assert.equal(genericDefault.props["aria-checked"], true);
genericDefault.props.onClick(); assert.deepEqual(genericChanges, [null]);
// Shared directory request is cached per window; abandoned subscribers cannot update.
let resolveDirectory, reads = 0, active;
const subscriptions = [];
const hookReact = {
  useState(initial) { const store = active; if (!store.value) store.value = initial; return [store.value, next => { store.value = next; }]; },
  useEffect(run) { subscriptions.push(run()); },
};
const hookModule = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync("src/systemFonts.ts", "utf8")), { exports: hookModule.exports,
  require: name => name === "react" ? hookReact : name === "./appearanceTheme" ? api
    : { tauriInvoke: () => { reads++; return new Promise(resolve => { resolveDirectory = resolve; }); } } });
const abandoned = {}, current = {};
active = abandoned; hookModule.exports.useSystemFonts(); active = current; hookModule.exports.useSystemFonts();
assert.equal(reads, 1); subscriptions[0](); resolveDirectory(catalog); await new Promise(setImmediate);
assert.equal(abandoned.value.pending, true); assert.equal(current.value.pending, false);
assert.deepEqual(plain(current.value.families), catalog);
console.log("PASS AGF02-07: font family/face/default/monospace, directory fallback and IME, CSS lists and local face load/dedup/retry (L2, not native/pixel parity)");

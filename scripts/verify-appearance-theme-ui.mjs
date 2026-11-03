import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// L2: execute production TSX callbacks and hooks with controlled persistence/clipboard/DOM.
// This is not a native-window or official screenshot comparison.
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const engineModule = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync("src/appearanceTheme.ts", "utf8")), {
  exports: engineModule.exports, require: () => ({}), console,
});
const engine = engineModule.exports;
const code = compile(fs.readFileSync("src/components/AppearanceSettings.tsx", "utf8") +
  "\nexport { ThemeCard, ThemeTextField, ThemeImportDialog, ThemeContrast };\n");
const nodes = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(nodes)] : [];
const content = node => typeof node === "string" ? node : node && typeof node === "object" ? (node.children ?? []).map(content).join("") : "";
const flush = () => new Promise(setImmediate);
let loadPreset = async () => engine.defaultChromeTheme("dark"), clipboard = async () => true;
const presets = [{ id: "codex", label: "Codex" }, { id: "dracula", label: "Dracula" }];
function mount(component, props, { document = { activeElement: null, body: {} } } = {}) {
  const hooks = [], effects = [], cleanups = new Map();
  let cursor = 0, tree;
  const react = {
    Fragment: "fragment", createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial;
      return [hooks[i], value => { hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }]; },
    useRef(value) { return hooks[cursor++] ??= { current: value }; },
    useEffect(fn, deps) { const i = cursor++; if (!hooks[i] || deps.some((value, n) => value !== hooks[i][n])) {
      hooks[i] = deps; effects.push(() => { cleanups.get(i)?.(); cleanups.set(i, fn()); });
    } },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { exports: module.exports, document, console, require: name => {
    if (name === "react") return react;
    if (name === "react-dom") return { createPortal: value => value };
    if (name.endsWith("appearanceTheme")) return { ...engine, themePresets: () => presets, loadThemePreset: (...args) => loadPreset(...args) };
    if (name.endsWith("clipboard")) return { copyTextToClipboard: text => clipboard(text) };
    return { parseAppearanceFontSize: (_, text) => Number(text) };
  } });
  const render = () => { cursor = 0; tree = module.exports[component](props); return tree; };
  const runEffects = () => { for (const effect of effects.splice(0)) effect(); };
  const by = predicate => nodes(tree).find(predicate);
  render(); runEffects();
  return { render, runEffects, by, all: () => nodes(tree), document, dispose: () => { for (const cleanup of cleanups.values()) cleanup?.(); } };
}
function createState() {
  const calls = [];
  const state = { variant: "dark", busy: false, error: null,
    preferences: { appearanceTheme: "system", sansFontSize: 16, codeFontSize: 18, "reduced-motion-preference": "on",
      appearanceLightChromeTheme: engine.defaultChromeTheme("light"), appearanceDarkChromeTheme: engine.defaultChromeTheme("dark"),
      appearanceLightCodeThemeId: "codex", appearanceDarkCodeThemeId: "dracula" },
    save: async (key, value) => { calls.push([key, value]); return "saved"; },
    saveTheme: async (variant, theme, id) => { calls.push([variant, theme, id]); return "saved"; }, reload() {},
  };
  return { state, calls };
}
const { state, calls } = createState();
state.preferences.appearanceDarkChromeTheme = { ...state.preferences.appearanceDarkChromeTheme, surface: "#112233", accent: "#aabbcc", contrast: 10,
  fonts: { ui: "Custom UI", code: "Custom Code", content: "Custom Content", uiFace: { family: "Custom UI", fullName: "Custom UI Bold", postscriptName: "CustomUI-Bold" } } };
const page = mount("AppearanceSettings", { state });
assert.deepEqual(page.all().filter(node => typeof node.type === "function" && node.type.name === "ThemeCard").map(node => node.props.variant), ["dark"]);
page.by(node => node.props["aria-controls"] === "appearance-advanced").props.onClick(); page.render();
page.by(node => node.props.id === "appearance-separate").props.onChange({ target: { checked: true } }); page.render();
assert.deepEqual(page.all().filter(node => typeof node.type === "function" && node.type.name === "ThemeCard" && !node.props.advanced).map(node => node.props.variant), ["light", "dark"]);
assert.equal(calls.length, 0, "separate display never writes/copies theme data");
await page.by(node => node.type === "button" && content(node) === "重置为默认设置").props.onClick(); await flush(); page.render();
assert.equal(calls.length, 5);
const darkReset = calls.find(call => call[0] === "dark");
assert.equal(darkReset[1].surface, "#112233"); assert.equal(darkReset[1].accent, "#aabbcc");
assert.equal(darkReset[1].fonts.ui, "Custom UI"); assert.equal(darkReset[1].fonts.uiFace, undefined);
assert.equal(darkReset[1].fonts.code, null); assert.equal(darkReset[1].contrast, 60); assert.equal(darkReset[2], "dracula");
assert.deepEqual(calls.slice(2).map(call => [...call]), [["sansFontSize", 14], ["codeFontSize", 12], ["reduced-motion-preference", "system"]]);
assert.equal(page.all().filter(node => node.props.role === "alert").length, 0);
state.saveTheme = async () => "unconfirmed";
await page.by(node => node.type === "button" && content(node) === "重置为默认设置").props.onClick(); await flush(); page.render();
assert.ok(page.by(node => node.props.role === "alert" && content(node).includes("部分外观设置无法重置")));
page.dispose();

// Official setCodeThemeId applies only the seed colors; advanced values are not preset defaults.
for (const variant of ["light", "dark"]) {
  const presetData = createState();
  const themeKey = variant === "light" ? "appearanceLightChromeTheme" : "appearanceDarkChromeTheme";
  const custom = { ...engine.defaultChromeTheme(variant), contrast: 27, opaqueWindows: true,
    fonts: { ui: "Custom UI", code: "Custom Code", content: "Custom Content",
      uiFace: { family: "Custom UI", fullName: "Custom UI Bold", postscriptName: "CustomUI-Bold" },
      codeFace: { family: "Custom Code", fullName: "Custom Code Italic", postscriptName: "CustomCode-Italic" },
      contentFace: { family: "Custom Content", fullName: "Custom Content Medium", postscriptName: "CustomContent-Medium" } } };
  presetData.state.preferences[themeKey] = custom;
  const presetCard = mount("ThemeCard", { state: presetData.state, variant, showTitle: true, editRevision: { current: 0 } });
  let resolvePreset;
  loadPreset = () => new Promise(resolve => { resolvePreset = resolve; });
  const selection = presetCard.by(node => node.type === "select").props.onChange({ target: { value: "dracula" } });
  // A newer confirmed read can arrive during lazy loading without a local editing revision.
  const latest = { ...custom, contrast: 31, fonts: { ...custom.fonts, content: "Latest Content" } };
  presetData.state.preferences[themeKey] = latest; presetCard.render();
  const seed = { ...engine.defaultChromeTheme(variant), accent: "#123456", ink: "#abcdef", surface: "#203040",
    semanticColors: { diffAdded: "#112233", diffRemoved: "#445566", skill: "#778899" } };
  resolvePreset(seed); await selection;
  const [, savedTheme, savedId] = presetData.calls.at(-1);
  assert.equal(savedTheme.contrast, 31, `${variant} preset must preserve the latest advanced contrast`);
  assert.equal(savedTheme.opaqueWindows, true, `${variant} preset must preserve opaque windows`);
  assert.equal(JSON.stringify(savedTheme.fonts), JSON.stringify(latest.fonts), `${variant} preset must preserve every font and face`);
  for (const key of ["accent", "ink", "surface"]) assert.equal(savedTheme[key], seed[key]);
  assert.equal(JSON.stringify(savedTheme.semanticColors), JSON.stringify(seed.semanticColors));
  assert.equal(savedTheme.accentSource, "custom"); assert.equal(savedId, "dracula");
  presetCard.dispose();
}

const cardData = createState(), revision = { current: 0 };
const card = mount("ThemeCard", { state: cardData.state, variant: "dark", showTitle: true, editRevision: revision });
let release;
loadPreset = () => new Promise(resolve => { release = resolve; });
const changing = card.by(node => node.type === "select").props.onChange({ target: { value: "dracula" } }); card.render();
await card.by(node => typeof node.type === "function" && node.props.label === "深色 强调色").props.onSave("#123456");
release(engine.defaultChromeTheme("dark")); await changing; card.render();
assert.equal(cardData.calls.length, 1, "late preset cannot overwrite subsequent color edit");
assert.equal(cardData.calls[0][1].accent, "#123456"); assert.equal(cardData.calls[0][1].accentSource, "custom");
const advancedCard = mount("ThemeCard", { state: cardData.state, variant: "dark", advanced: true, showTitle: true, editRevision: revision });
const loading = card.by(node => node.type === "select").props.onChange({ target: { value: "dracula" } });
await advancedCard.by(node => typeof node.type === "function" && node.props.label === "深色 代码字体").props.onSave("Consolas");
release(engine.defaultChromeTheme("dark")); await loading;
assert.equal(cardData.calls.length, 2, "advanced font edit also invalidates pending visual-card preset");
loadPreset = async () => { throw Error("offline"); };
await card.by(node => node.type === "select").props.onChange({ target: { value: "dracula" } }); card.render();
assert.ok(card.by(node => node.props.role === "alert" && content(node) === "无法应用主题"));
loadPreset = async () => engine.defaultChromeTheme("dark");
await card.by(node => node.type === "select").props.onChange({ target: { value: "codex" } }); card.render();
assert.equal(cardData.calls.at(-1)[2], "codex");
clipboard = async () => false;
await card.by(node => node.props["aria-label"] === "复制深色主题").props.onClick(); card.render();
assert.ok(card.by(node => node.props.role === "alert" && content(node) === "复制主题失败"));
assert.ok(!card.by(node => node.props.role === "status" && content(node).includes("已复制")));
clipboard = async text => { assert.equal(engine.parseTheme(text, "dark", ["codex", "dracula"]).variant, "dark"); return true; };
await card.by(node => node.props["aria-label"] === "复制深色主题").props.onClick(); card.render();
assert.ok(card.by(node => node.props.role === "status" && content(node) === "已复制深色主题"));
card.by(node => node.props["aria-label"] === "导入深色主题").props.onClick(); card.render();
let modal = card.by(node => typeof node.type === "function" && node.type.name === "ThemeImportDialog");
const count = cardData.calls.length;
assert.equal(await modal.props.onImport("bad"), false);
assert.equal(await modal.props.onImport(engine.serializeTheme({ variant: "light", theme: engine.defaultChromeTheme("light"), codeThemeId: "codex" })), false);
assert.equal(cardData.calls.length, count, "invalid or wrong-variant imports cannot write");
cardData.state.saveTheme = async () => "unconfirmed";
assert.equal(await modal.props.onImport(engine.serializeTheme({ variant: "dark", theme: engine.defaultChromeTheme("dark"), codeThemeId: "codex" })), false);
card.render(); assert.ok(card.by(node => typeof node.type === "function" && node.type.name === "ThemeImportDialog"), "unconfirmed import stays open");
cardData.state.saveTheme = async () => "saved";
assert.equal(await modal.props.onImport(engine.serializeTheme({ variant: "dark", theme: engine.defaultChromeTheme("dark"), codeThemeId: "codex" })), true);
card.render(); assert.ok(!card.by(node => typeof node.type === "function" && node.type.name === "ThemeImportDialog"));
card.dispose(); advancedCard.dispose();

const edits = [], field = mount("ThemeTextField", { label: "深色 背景", value: "#181818", color: true, disabled: false, onSave: value => edits.push(value) });
const input = () => field.by(node => node.type === "input" && node.props.type === "text");
input().props.onChange({ target: { value: "#bad" } }); field.render(); input().props.onBlur(); field.render();
assert.equal(edits.length, 0); assert.equal(input().props["aria-invalid"], true);
input().props.onChange({ target: { value: "#123456" } }); field.render();
input().props.onKeyDown({ key: "Enter", nativeEvent: { isComposing: true }, preventDefault() {} });
assert.equal(edits.length, 0, "IME Enter cannot persist a partial edit");
input().props.onKeyDown({ key: "Enter", nativeEvent: {}, preventDefault() {} }); assert.deepEqual(edits, ["#123456"]);
input().props.onKeyDown({ key: "Escape", nativeEvent: {} }); field.render(); assert.equal(input().props.value, "#181818");
field.dispose();

let restored = 0, closed = 0, focused = "";
const first = { focus: () => { focused = "first"; } }, last = { focus: () => { focused = "last"; } };
const fakeDocument = { activeElement: { focus: () => { restored++; } }, body: {} };
const dialog = mount("ThemeImportDialog", { variant: "light", busy: false, onClose: () => closed++, onImport: async () => false }, { document: fakeDocument });
dialog.by(node => node.props.role === "dialog").props.ref.current = { querySelectorAll: () => [first, last], focus() {} };
fakeDocument.activeElement = last;
let prevented = false;
dialog.by(node => node.props.role === "dialog").props.onKeyDown({ key: "Tab", shiftKey: false, preventDefault: () => { prevented = true; } });
assert.equal(prevented, true); assert.equal(focused, "first");
fakeDocument.activeElement = first;
dialog.by(node => node.props.role === "dialog").props.onKeyDown({ key: "Tab", shiftKey: true, preventDefault() {} }); assert.equal(focused, "last");
dialog.by(node => node.props.role === "dialog").props.onKeyDown({ key: "Escape", nativeEvent: {}, preventDefault() {}, stopPropagation() {} });
assert.equal(closed, 1); dialog.dispose(); assert.equal(restored, 1);
console.log("PASS AB03/04/06/07: production appearance TSX replay, mode-only display, exact Advanced reset, light/dark preset preserves latest fonts/faces/contrast/opaque, shared revision races, preset failure, import validation/unconfirmed retention, clipboard failure, color/IME validation, dialog Tab/Escape/focus (L2; not native/pixel parity)");

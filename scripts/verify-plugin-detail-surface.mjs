import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync("src/components/PluginDirectoryDetail.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;
const exports = {}, slots = [], observers = [], externalCalls = [];
let index = 0, effects = [], dirty = true, disposed = 0;
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useId: () => "detail-id",
  useRef: value => { const i = index++; return slots[i] ??= { current: value }; },
  useState(value) { const i = index++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; dirty = true; }]; },
  useEffect(run, deps) { const i = index++, old = slots[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: run() }; }); },
};
vm.runInNewContext(source, { exports, URL, require: name => name === "react" ? { ...react, default: react } : name === "../bridge" ? {
  tauriInvoke: async (...args) => { externalCalls.push(args); },
} : {},
  ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { disposed++; } },
  getComputedStyle: () => ({ lineHeight: "20px", fontSize: "13px" }),
  window: { addEventListener() {}, removeEventListener() {} },
  document: { fonts: { ready: Promise.resolve(), addEventListener() {}, removeEventListener() {} } },
});
const detail = { marketplaceName: "market", summary: { id: "id", name: "name", version: "1", interface: {} }, skills: [], apps: [], hooks: [], mcpServers: [] };
const model = patch => exports.pluginDetailPresentation({ ...detail, ...patch });
assert.equal(model({}).title, "name");
const filled = model({ description: " fallback ", summary: { ...detail.summary, localVersion: " 2 ", interface: { displayName: "Title", shortDescription: " short ", longDescription: " long ", defaultPrompt: ["  exact prompt  ", " ", "next"], developerName: " Dev " } } });
assert.equal(filled.title, "Title"); assert.equal(filled.tagline, "short"); assert.equal(filled.description, "long");
assert.deepEqual(Array.from(filled.prompts), ["exact prompt", "next"]);
assert.equal(filled.information.find(row => row.label === "版本").value, "2");
assert.equal(filled.information.at(-1).value, "不可用");
assert.equal(model({ summary: { id: "id", name: "name", interface: {} } }).information.length, 0, "empty interface does not invent Information");
assert.equal(model({ summary: { id: "id", name: "name", version: "1" } }).information.length, 0, "version without interface must not invent Information");
assert.equal(model({ description: "same", summary: { ...detail.summary, interface: { shortDescription: "same" } } }).description, "", "tagline must not repeat in body");
assert.equal(model({ summary: { id: "id", name: "name", interface: { websiteUrl: "javascript:alert(1)" } } }).information.length, 0, "unsafe URL is not an external action");
const node = { scrollHeight: 400, scrollIntoView: () => node.scrolled = true };
let identity = "first", hook;
function render() { for (let count = 0; dirty; count++) { assert.ok(count < 20); dirty = false; index = 0; hook = exports.usePluginDetailExpansion(identity, 15); hook.ref.current = node; const runs = effects; effects = []; runs.forEach(run => run()); } return hook; }
assert.equal(render().overflowing, true); assert.equal(hook.maxHeight, 300);
hook.toggle(); assert.equal(render().expanded, true); hook.toggle(); assert.equal(render().expanded, false); assert.equal(node.scrolled, true);
node.scrollHeight = 200; observers.at(-1).callback(); assert.equal(render().overflowing, false);
identity = "second"; dirty = true; render(); assert.ok(disposed > 0, "identity change disconnects observer");
for (const slot of slots) slot?.cleanup?.(); assert.ok(disposed >= 2, "unmount disconnects observer");
slots.length = 0; effects = []; dirty = true;
let resolvePrompt, calls = [];
let props = { detail: { ...detail, summary: { ...detail.summary, interface: { defaultPrompt: [" exact prompt ", "other"] } } }, actions: "real action", included: "real included",
  onActivatePrompt: (text, position) => { calls.push([text, position]); return new Promise(resolve => { resolvePrompt = resolve; }); } };
let tree;
function renderSurface(patch) {
  if (patch) { props = { ...props, ...patch }; dirty = true; }
  for (let count = 0; dirty; count++) { assert.ok(count < 20); dirty = false; index = 0; tree = exports.PluginDirectoryDetail(props); const runs = effects; effects = []; runs.forEach(run => run()); }
  return tree;
}
function nodes(node, type) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, type));
  return [...(node.type === type ? [node] : []), ...nodes(node.props?.children, type)];
}
renderSurface();
let buttons = nodes(tree, "button");
assert.equal(buttons.length, 2); assert.equal(buttons[0].props.disabled, false);
buttons[0].props.onClick(); buttons[1].props.onClick();
assert.deepEqual(calls, [["exact prompt", 0]], "callback receives original normalized source text and index, duplicate click is single-flight");
renderSurface(); assert.ok(nodes(tree, "button").every(button => button.props.disabled));
resolvePrompt(true); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); renderSurface(); assert.equal(nodes(tree, "button")[0].props.disabled, false);
renderSurface({ promptDisabledReason: "not supported" }); nodes(tree, "button")[0].props.onClick(); assert.equal(calls.length, 1);
renderSurface({ promptDisabledReason: undefined, onActivatePrompt: async () => { throw new Error("draft failed"); } });
nodes(tree, "button")[0].props.onClick(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); renderSurface();
assert.equal(nodes(tree, "p").find(node => node.props.role === "alert").props.children[0], "Error: draft failed", "rejected callback is visible");
renderSurface({ detail: { ...props.detail, summary: { ...props.detail.summary, id: "new" } } });
assert.equal(nodes(tree, "p").filter(node => node.props.role === "alert").length, 0, "entity change clears stale failure");
assert.equal(typeof tree.props.onClick, "function", "detail links must use the real native external-link command");
let prevented = 0;
const linkEvent = href => ({ target: { closest: () => ({ getAttribute: () => href }) },
  currentTarget: { contains: () => true }, preventDefault() { prevented++; } });
await tree.props.onClick(linkEvent("https://example.test/help"));
assert.equal(prevented, 1); assert.equal(externalCalls[0][0], "review_link_open");
assert.equal(externalCalls[0][1].url, "https://example.test/help");
await tree.props.onClick(linkEvent("javascript:alert(1)"));
assert.equal(prevented, 2); assert.equal(externalCalls.length, 1, "unsafe links never reach native open");
for (const slot of slots) slot?.cleanup?.();
console.log("Plugin detail priorities, information, measured expansion cleanup, and prompt single-flight passed.");

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = text => ts.transpileModule(text, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const math = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync("src/appearanceColor.ts", "utf8")), { exports: math.exports });
const golden = JSON.parse(fs.readFileSync("scripts/fixtures/appearance-color-official.json", "utf8"));
for (const { hex, hsv: { h, s, v } } of golden.hex) assert.equal(JSON.stringify(math.exports.hexToHsv(hex)), JSON.stringify({ h, s, v }));
for (const { hex, hsv } of golden.hsv) assert.equal(math.exports.hsvToHex(hsv), hex);

// Execute actual slider callbacks; browser tests cover real capture, layout and focus.
let hooks = [], cursor = 0, tree, effects = [];
const effect = (run, deps) => {
  const i = cursor++;
  if (!hooks[i] || deps.some((value, n) => value !== hooks[i][n])) { hooks[i] = deps; effects.push(run); }
};
const react = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState: initial => { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial;
    return [hooks[i], value => { hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }]; },
  useRef: value => hooks[cursor++] ??= { current: value }, useEffect: effect, useLayoutEffect: effect, Fragment: "fragment" };
const component = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync("src/components/AppearanceColorPicker.tsx", "utf8")), {
  exports: component.exports, document: { body: {}, addEventListener() {}, removeEventListener() {} },
  window: { addEventListener() {}, removeEventListener() {} }, require: name => name === "react" ? react : name === "react-dom"
    ? { createPortal: value => value } : name.endsWith("appearanceColor") ? math.exports : {},
});
const changes = [], props = { label: "背景选择器", value: "#ff0000", disabled: false, onChange: value => changes.push(value) };
const render = () => { cursor = 0; tree = component.exports.AppearanceColorPicker(props); for (const run of effects.splice(0)) run(); };
const nodes = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(nodes)] : [];
const by = predicate => nodes(tree).find(predicate);
render(); by(node => node.type === "button").props.onClick(); render();
const hue = () => by(node => node.props["aria-label"] === "Hue");
const saturation = () => by(node => node.props["aria-label"] === "Color");
const key = (control, name) => control().props.onKeyDown({ key: name, nativeEvent: {}, preventDefault() {}, stopPropagation() {} });
key(hue, "ArrowRight"); render(); assert.equal(hue().props["aria-valuenow"], 18); assert.equal(changes.at(-1), "#ff4d00");
key(saturation, "ArrowDown"); render(); assert.equal(changes.at(-1), "#f24900");
key(saturation, "ArrowLeft"); render(); assert.equal(changes.at(-1), "#f2510c");
const calls = changes.length;
props.disabled = true; render(); key(hue, "ArrowRight"); assert.equal(changes.length, calls);
props.disabled = false; render();
let captured = false;
const target = { getBoundingClientRect: () => ({ left: 10, top: 10, width: 136, height: 100 }),
  focus() {}, setPointerCapture() { captured = true; }, hasPointerCapture: () => captured, releasePointerCapture() { captured = false; } };
const pointer = { currentTarget: target, clientX: -100, clientY: 500, pointerId: 1, button: 0, preventDefault() {} };
saturation().props.onPointerDown(pointer); render(); assert.equal(changes.at(-1), "#000000");
saturation().props.onPointerMove({ ...pointer, clientX: 999, clientY: -1 }); render(); assert.equal(changes.at(-1), "#ff4d00");
saturation().props.onPointerUp({ ...pointer, clientX: 999, clientY: -1 }); assert.equal(captured, false);
render(); render();
assert.equal(hue().props["aria-valuenow"], 0, "a failed/unconfirmed gesture restores authoritative readback after release");
console.log(`PASS appearance color: ${golden.hex.length + golden.hsv.length} official conversion samples; slider keyboard, disabled, pointer capture and clamping (L2, not native/pixel parity)`);

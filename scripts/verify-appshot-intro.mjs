import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const descendants = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(descendants)] : [];
const text = node => typeof node === "string" ? node : (node?.children ?? []).map(text).join("");
function mount() {
  let current = true, accepted = 0, cancelled = 0, nextId = 0;
  const effects = [], cleanup = [];
  const document = { activeElement: null };
  class Element {
    isConnected = true;
    ownerDocument = document;
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    getBoundingClientRect() { return { left: 100, top: 100, right: 500, bottom: 400 }; }
    querySelectorAll() { return descendants(tree).filter(node => node.type === "button").map(node => node.element); }
  }
  const previous = new Element(); previous.focus();
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useRef: current => ({ current }), useId: () => `intro-${++nextId}`,
    useLayoutEffect: effect => effects.push(effect),
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/AppshotIntroDialog.tsx", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports: module.exports, document, HTMLElement: Element, require: name => {
    if (name === "react") return react;
    assert.ok(name.endsWith(".css")); return {};
  } });
  const tree = module.exports.AppshotIntroDialog({ isCurrent: () => current, onAccept: () => accepted++, onClose: () => cancelled++ });
  for (const node of descendants(tree)) {
    node.element = new Element();
    if (node.props.ref) node.props.ref.current = node.element;
  }
  effects.forEach(effect => cleanup.push(effect()));
  return { tree, document, previous, find: predicate => descendants(tree).find(predicate),
    get accepted() { return accepted; }, get cancelled() { return cancelled; },
    retire() { current = false; }, unmount() { cleanup.forEach(callback => callback?.()); } };
}
const event = (patch = {}) => ({ nativeEvent: {}, preventDefault() {}, stopPropagation() {}, ...patch });
const ime = mount();
assert.equal(text(ime.find(node => node.type === "h2")), "启用应用快照");
assert.ok(text(ime.tree).includes("它们会包含窗口中的所有文本，包括滚动到可见区域外的内容。"));
const cancelButton = ime.find(node => node.type === "button" && text(node) === "取消");
assert.equal(cancelButton.props.type, "button"); assert.equal(ime.document.activeElement, cancelButton.element);
ime.tree.props.onCompositionStart();
ime.find(node => node.type === "form").props.onSubmit(event());
ime.tree.props.onKeyDown(event({ key: "Escape", nativeEvent: { isComposing: true } }));
assert.equal(ime.accepted, 0); assert.equal(ime.cancelled, 0);
ime.tree.props.onCompositionEnd();
ime.find(node => node.type === "form").props.onSubmit(event());
ime.find(node => node.type === "form").props.onSubmit(event());
ime.tree.props.onClose();
assert.equal(ime.accepted, 1); assert.equal(ime.cancelled, 0, "closing after submit cannot also cancel");
ime.unmount(); assert.equal(ime.document.activeElement, ime.previous);

const escape = mount(); escape.tree.props.onKeyDown(event({ key: "Escape" }));
escape.tree.props.onCancel(event()); assert.equal(escape.cancelled, 1); assert.equal(escape.accepted, 0); escape.unmount();
const focus = mount(); const buttons = descendants(focus.tree).filter(node => node.type === "button");
buttons.at(-1).element.focus();
focus.tree.props.onKeyDown(event({ key: "Tab", currentTarget: focus.tree.element }));
assert.equal(focus.document.activeElement, buttons[0].element);
focus.tree.props.onKeyDown(event({ key: "Tab", shiftKey: true, currentTarget: focus.tree.element }));
assert.equal(focus.document.activeElement, buttons.at(-1).element);
focus.retire(); focus.find(node => node.type === "form").props.onSubmit(event());
assert.equal(focus.accepted, 0, "retired identity/scope cannot accept");
focus.document.activeElement = null; focus.unmount(); assert.equal(focus.document.activeElement, null, "retired scope cannot steal focus");
console.log("Appshot intro: actual Chinese copy, cancel, submit once, IME guards, Tab loop, stale lifecycle and focus cleanup passed (component harness; physical IME/native dialog not verified).");

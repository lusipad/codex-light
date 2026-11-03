import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const all = node => node && typeof node === "object" ? [node, ...(node.children || []).flatMap(all)] : [];
function mount(name, initial) {
  const hooks = [], effects = [], listeners = new Set(), elements = new Map(), cache = new Map();
  let cursor = 0, active = null, tree, focused = true;
  const props = { ...initial };
  const react = {
    Fragment: "fragment",
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(value) { const i = cursor++; if (!(i in hooks)) hooks[i] = value; return [hooks[i], value => { hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }]; },
    useRef(value) { const i = cursor++; return hooks[i] ??= { current: value }; },
    useMemo(fn) { cursor++; return fn(); },
    useLayoutEffect() { cursor++; },
    useEffect(fn, deps) { const i = cursor++, prev = hooks[i]; if (!prev || deps.some((v, j) => v !== prev.deps[j])) { prev?.cleanup?.(); hooks[i] = { deps }; effects.push(() => { hooks[i].cleanup = fn(); }); } },
  };
  const doc = { get activeElement() { return active; }, hasFocus: () => focused, addEventListener() {}, removeEventListener() {} };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { exports, document: doc, console, Promise,
      window: { addEventListener(type, fn) { if (type === "codex:keyboard-command") listeners.add(fn); }, removeEventListener(type, fn) { listeners.delete(fn); } },
      require: id => id === "react" ? react : id.endsWith("Icons") ? new Proxy({}, { get: (_, key) => String(key) }) :
        id.includes("ComposerAutocomplete") ? { getAutocompleteItems: () => [] } :
        id.includes("ModelSelector") || id.includes("AttachmentChip") ? {} :
        id.endsWith("/bridge") ? { isTauriRuntime: () => false } : id.endsWith("/fsClient") ? { baseNameFsPath: p => p.split("/").at(-1) } :
        load(path.resolve(path.dirname(file), id + ".ts")),
    }, { filename: file });
    return exports;
  }
  const Component = load(path.resolve("src/components", name + ".tsx"))[name];
  function resolve(node) {
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") return resolve(node.type({ ...node.props, children: node.children }));
    node.children = node.children.map(resolve); return node;
  }
  function element(node) {
    if (!elements.has(node)) elements.set(node, { node, disabled: !!node.props.disabled,
      focus() { active = this; },
      click() { node.props.onClick?.(); },
      get dataset() { return { keyboardApproval: node.props["data-keyboard-approval"] }; },
      contains(target) { return all(node).some(child => element(child) === target); },
      closest(selector) {
        const parents = all(tree).filter(parent => all(parent).includes(node)).reverse();
        return parents.map(element).find(el => selector === "[data-keyboard-approval]" ? !!el.node.props["data-keyboard-approval"] :
          selector === "fieldset:disabled" ? el.node.type === "fieldset" && el.node.props.disabled :
          (selector.includes("input") && ["input", "textarea"].includes(el.node.type)) || ["dialog", "menu"].includes(el.node.props.role)) || null;
      },
      querySelector(selector) { const cls = selector.slice(1); const found = all(node).find(n => n.props.className?.split(" ").includes(cls)); return found ? element(found) : null; },
    });
    return elements.get(node);
  }
  function render() {
    cursor = 0; tree = resolve(Component(props));
    for (const node of all(tree)) if (node.props.ref) { const ref = node.props.ref; typeof ref === "function" ? ref(element(node)) : ref.current = element(node); }
    effects.splice(0).forEach(fn => fn());
  }
  render();
  return { props, render, focus(predicate) { active = predicate ? element(all(tree).find(predicate)) : null; },
    setFocused(value) { focused = value; }, find: predicate => all(tree).find(predicate),
    command(id) { const e = { detail: { id }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; for (const fn of listeners) fn(e); return e.defaultPrevented; },
  };
}
let sent = 0, queued = 0, changed = [], attached = 0, toggled = 0;
const composer = mount("ComposerBox", {
  dictationSessionKey: "chat-a", composerEnterBehavior: "enter", variant: "thread", promptInput: "hello", isStreaming: true,
  activeWorkspace: null, workspaces: [], gitStatus: null, gitBranches: [], useWorktree: false,
  permissionMode: "ask", attachedFiles: [], models: [{ id: "runtime", isDefault: true, supportedReasoningEfforts: ["low", "high"] }],
  selectedModelId: "runtime", reasoningEffort: "low", skills: [], workspaceFiles: [], workspaceFileHits: [],
  onSendMessage: () => { sent++; }, onQueueMessage: () => { queued++; }, onPromptInputChange: text => changed.push(text),
  onAttachFiles: () => { attached++; }, onToggleFastMode: () => { toggled++; }, onSelectReasoningEffort: value => changed.push(value),
});
assert.equal(composer.command("composer-submit"), false, "unfocused composer cannot receive app commands");
composer.focus(n => n.type === "textarea");
assert.equal(composer.command("composer-steer"), true); assert.equal(sent, 1); assert.equal(queued, 0);
assert.equal(composer.command("composer-steer"), false, "same-tick duplicate blocked");
await Promise.resolve();
assert.equal(composer.command("composer-queue"), true); assert.equal(queued, 1); assert.equal(sent, 1);
await Promise.resolve();
composer.props.submissionDisabled = true; composer.render(); composer.focus(n => n.type === "textarea");
assert.equal(composer.command("composer-submit"), false);
composer.props.submissionDisabled = false; composer.render(); composer.focus(n => n.type === "textarea");
composer.find(n => n.type === "textarea").props.onCompositionStart();
assert.equal(composer.command("composer-submit"), false, "IME composition cannot submit via custom binding");
composer.find(n => n.type === "textarea").props.onCompositionEnd();
assert.equal(composer.command("composer-toggle-fast-mode"), false, "unsupported runtime fast mode is not invented");
assert.equal(toggled, 0);
assert.equal(composer.command("composer-increase-reasoning-effort"), true); assert.equal(changed.at(-1), "high");
assert.equal(composer.command("composer-clear"), true); assert.equal(changed.at(-1), "");
assert.equal(composer.command("composer-add-files"), true); assert.equal(attached, 1);
assert.equal(composer.command("composer-add-photos"), false, "file picker cannot masquerade as photo-filtered picker");
composer.setFocused(false); assert.equal(composer.command("composer-submit"), false);
console.log("PASS production Composer commands: focus/IME/pending/duplicates; real steer vs queue callbacks; runtime effort/fast capability");

const responses = [];
const request = { id: 19, generation: 7, method: "item/commandExecution/requestApproval", params: { threadId: "chat-a", command: "echo fixture" } };
const approval = mount("ApprovalCenter", { requests: [request], onRespond: (...args) => responses.push(args), onRespondError() {}, responseStates: {} });
assert.equal(approval.command("approval-approve"), false);
approval.focus(n => n.props["data-keyboard-approval"]);
assert.equal(approval.command("approval-approve"), true);
assert.equal(responses.length, 1); assert.equal(responses[0][0], 19); assert.equal(responses[0][1].decision, "accept"); assert.equal(responses[0][2], 7);
assert.equal(approval.command("approval-decline"), false, "cannot double-send same generation");
request.generation = 8; approval.render(); approval.focus(n => n.props["data-keyboard-approval"]);
assert.equal(approval.command("approval-decline"), true); assert.equal(responses.at(-1)[1].decision, "decline"); assert.equal(responses.at(-1)[2], 8);
request.generation = 9; request.responseDeliveryUnknown = true; approval.render(); approval.focus(n => n.props["data-keyboard-approval"]);
assert.equal(approval.command("approval-approve"), false, "unknown delivery cannot resend");
request.responseDeliveryUnknown = false;
const key = approval.find(n => n.props["data-keyboard-approval"]).props["data-keyboard-approval"];
approval.props.responseStates = { [key]: { sending: true } }; approval.render(); approval.focus(n => n.props["data-keyboard-approval"]);
assert.equal(approval.command("approval-approve"), false, "sending response cannot repeat");
approval.props.responseStates = {}; request.params.proposedExecpolicyAmendment = ["echo"]; approval.render(); approval.focus(n => n.type === "input");
assert.equal(approval.command("approval-approve"), false, "approval text/form controls keep their own keys");
console.log("PASS production ApprovalCenter commands: focused card only, actual decision/generation, duplicate/sending/unknown/input guards");

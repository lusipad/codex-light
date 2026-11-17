import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true };
const source = fs.readFileSync("src/components/UserMessageBubble.tsx", "utf8");
const nodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
const textOf = node => node && typeof node === "object" ? node.children.map(textOf).join("") : typeof node === "string" ? node : "";
const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) });

const MarkdownView = () => {};
function mount(initialText = "short", initialHeight = 24, elements = [], codeBlocks = [], contentTop = 0) {
  let cursor = 0, text = initialText, height = initialHeight, width = 400, lineHeight = "24px";
  const hooks = [], effects = [], cleanups = new Map(), observers = [], listeners = new Map();
  const content = {
    get clientWidth() { return width; }, get scrollHeight() { return height; }, get offsetHeight() { return height; },
    getBoundingClientRect: () => ({ top: contentTop, bottom: height + contentTop, left: 0, right: width, height }),
    querySelectorAll: selector => selector.includes("data-markdown-copy") ? codeBlocks : elements,
    contains: element => elements.includes(element),
  };
  const clip = {
    ...content,
    getBoundingClientRect: () => ({ top: 0, bottom: Math.min(height, 456), left: 0, right: width, height: Math.min(height, 456) }),
  };
  const react = {
    createElement,
    useId: () => "fixture-content",
    useRef(value) { return hooks[cursor++] ??= { current: value }; },
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], update => { hooks[index] = typeof update === "function" ? update(hooks[index]) : update; }];
    },
    useLayoutEffect(callback, deps) {
      const index = cursor++;
      if (!hooks[index] || deps.some((value, i) => !Object.is(value, hooks[index][i]))) {
        hooks[index] = deps;
        effects.push(() => { cleanups.get(index)?.(); cleanups.set(index, callback()); });
      }
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: options }).outputText, {
    exports: module.exports,
    require(name) {
      if (name === "react") return react;
      if (name === "react-dom") return { flushSync: callback => callback() };
      if (name === "./Icons") return { ChevronDownIcon() {} };
      if (name === "./MarkdownView") return { MarkdownView };
      throw Error(name);
    },
    window: {
      getComputedStyle: () => ({ lineHeight, fontSize: "16px" }),
      addEventListener: (name, handler) => listeners.set(name, handler),
      removeEventListener: (name, handler) => { if (listeners.get(name) === handler) listeners.delete(name); },
    },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe(element) { assert.equal(element, content); }
      disconnect() { this.disconnected = true; }
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
  });
  function render() {
    cursor = 0;
    const tree = module.exports.UserMessageBubble({ text });
    for (const node of nodes(tree)) if (node.props.ref) {
      node.props.ref.current = node.props.className === "user-message-content" ? clip : content;
    }
    return tree;
  }
  function flush() { let tree = render(); while (effects.length) { effects.shift()(); tree = render(); } return tree; }
  return {
    render: flush, observers, listeners,
    printEvent(name) { listeners.get(name)?.(); return flush(); },
    resize(nextHeight, nextWidth = width, nextLineHeight = lineHeight) {
      height = nextHeight; width = nextWidth; lineHeight = nextLineHeight;
      for (const observer of [...observers].filter(observer => !observer.disconnected)) observer.callback();
      return flush();
    },
    changeText(nextText) { text = nextText; return flush(); },
    unmount() { for (const cleanup of cleanups.values()) cleanup?.(); },
  };
}
const button = tree => nodes(tree).find(node => node.type === "button");
const body = tree => nodes(tree).find(node => node.props.className === "user-message-content");
{
  const original = "long print message";
  const view = mount(original, 960);
  assert.equal(button(view.render()).props["data-markdown-copy"], "exclude", "UD01: disclosure text is excluded from Markdown copy");
  assert.equal(button(view.render()).props["aria-expanded"], false);
  const printed = view.printEvent("beforeprint");
  assert.equal(body(printed).props.style, undefined, "UD01: print reveals the complete message");
  assert.equal(button(printed), undefined, "UD01: print has no interactive disclosure");
  assert.equal(nodes(printed).some(node => node.props.className === "user-message-ellipsis"), false);
  assert.equal(nodes(body(printed)).find(node => node.type === MarkdownView).props.content, original);
  assert.equal(button(view.printEvent("afterprint")).props["aria-expanded"], false, "UD01: print does not change the user's collapsed choice");
  button(view.render()).props.onClick();
  view.printEvent("beforeprint");
  assert.equal(button(view.printEvent("afterprint")).props["aria-expanded"], true, "UD02: an expanded message stays expanded after printing");
  view.unmount();
  assert.equal(view.listeners.size, 0, "UD03: print listeners are released on unmount");
  console.log("PASS UD01–UD03 production user message print: full content, prior expansion restored, copy exclusions and listener cleanup");
}
{
  const view = mount();
  assert.equal(button(view.render()), undefined, "UM01: short message has no expansion control");
  assert.equal(body(view.resize(481)).props.style, undefined, "UM01: one-pixel tolerance does not fold 20 lines");
  assert.equal(button(view.resize(482)).props["aria-expanded"], false, "UM02: content over 20 lines is collapsed");
  assert.equal(body(view.render()).props.style.maxHeight, "456px", "UM02: show 19 body lines plus an ellipsis");
  assert.equal(textOf(button(view.render())), "显示更多");
  const collapsed = view.render();
  button(collapsed).props.onClick();
  assert.equal(button(view.render()).props["aria-expanded"], true);
  assert.equal(body(view.render()).props.style, undefined);
  assert.equal(textOf(button(view.render())), "收起");
  button(view.render()).props.onClick();
  assert.equal(button(view.render()).props["aria-expanded"], false, "UM03: same button collapses full content");
  button(view.render()).props.onClick();
  assert.equal(button(view.changeText("changed")).props["aria-expanded"], false, "UM04: a new text does not inherit old expansion");
  assert.ok(view.observers[0].disconnected, "UM04: content change replaces the measurement subscription");
  assert.equal(button(view.resize(24, 800)), undefined, "UM05: wider layout can become uncollapsible");
  assert.equal(body(view.resize(700, 200, "normal")).props.style.maxHeight, "456px", "UM05: normal line-height uses computed font size times 1.5");
  view.unmount();
  assert.ok(view.observers.every(observer => observer.disconnected), "UM06: observers are disposed");
}
{
  const original = Array.from({ length: 40 }, (_, index) => `line-${index}`).join("\n");
  const view = mount(original, 960);
  const markdown = nodes(body(view.render())).find(node => node.type === MarkdownView);
  assert.equal(markdown.props.content, original, "UM07: collapse passes complete text to the production Markdown renderer");
  assert.equal(markdown.props.variant, "user-message");
}

{
  const element = (top, bottom, anchor = false, initial = {}) => {
    const attrs = new Map(Object.entries(initial));
    return {
      attrs, getBoundingClientRect: () => ({ top, bottom, left: 0, right: 100 }),
      matches: () => anchor, hasAttribute: name => attrs.has(name), getAttribute: name => attrs.get(name) ?? null,
      setAttribute: (name, value) => attrs.set(name, value), removeAttribute: name => attrs.delete(name),
      toggleAttribute(name, value) { if (value) attrs.set(name, ""); else attrs.delete(name); },
    };
  };
  const hidden = element(600, 624, true);
  const partialLink = element(450, 474, true);
  const partialButton = element(450, 474, false, { "aria-hidden": "false" });
  const existingInert = element(20, 40, false, { inert: "" });
  const view = mount("long rich text", 960, [hidden, partialLink, partialButton, existingInert]);
  view.render();
  assert.ok(hidden.attrs.has("inert"));
  assert.equal(hidden.attrs.get("aria-hidden"), "true");
  assert.ok(!partialLink.attrs.has("inert"), "RC05: a partly visible link remains available");
  assert.ok(partialButton.attrs.has("inert"), "RC05: a partly clipped non-link cannot receive focus");
  button(view.render()).props.onClick();
  view.render();
  assert.ok(!hidden.attrs.has("inert"));
  assert.ok(!hidden.attrs.has("aria-hidden"));
  assert.equal(partialButton.attrs.get("aria-hidden"), "false", "RC05: expansion restores original aria-hidden");
  assert.ok(existingInert.attrs.has("inert"), "RC05: expansion never clears pre-existing inert");
  view.unmount();
  assert.ok(view.observers.every(observer => observer.disconnected));
  const blocks = [{ getBoundingClientRect: () => ({ top: 400, bottom: 700 }) }];
  const codeView = mount("long fenced code", 1000, [], blocks);
  assert.equal(body(codeView.render()).props.style.maxHeight, "700px", "RC06: do not cut through a code block");
  codeView.unmount();
  const offsetView = mount("heading shifts the content origin", 1000, [], blocks, 18);
  assert.equal(body(offsetView.render()).props.style.maxHeight, "700px", "RC06: heading margins cannot shift the clip origin and hide code");
  offsetView.unmount();
}

const appSource = fs.readFileSync("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let navigation, copy, edit;
function visit(node) {
  if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(prop =>
    ts.isJsxAttribute(prop) && prop.name.getText(ast) === "className" && prop.initializer?.text === "thread-user-message-navigation-rail")) {
    navigation = node.parent;
  }
  if (ts.isArrowFunction(node) && node.getText(ast).includes('copyThreadText(userText, "✓ 已复制提问内容")')) copy = node;
  if (ts.isArrowFunction(node) && node.getText(ast).includes("setPromptInput(userText)") && node.getText(ast).includes("已载入输入框")) edit = node;
  ts.forEachChild(node, visit);
}
visit(ast);
const evaluate = (node, context) => vm.runInNewContext(ts.transpileModule(`(${node.getText(ast)})`, { compilerOptions: options }).outputText, context);
assert.ok(navigation && copy && edit);
{
  let target, copied, edited, retired;
  const original = "full\n".repeat(40);
  const context = {
    React: { createElement }, activeThreadId: "a", bookmarkedTurnIds: {},
    turns: [], extractTextFromItem: item => item.text,
    document: { getElementById: id => { target = id; return { scrollIntoView() {} }; } },
    copyThreadText: async value => { copied = value; }, userText: original,
    userAppshots: [], userImages: [], appshotScope: "fixture:thread:a",
    setScopedAppshots() {}, setAttachedFiles() {},
    retireAppshotCapture: scope => { retired = scope; },
    setPromptInput: value => { edited = value; }, composerTextareaRef: { current: { focus() {} } }, showAppToast() {},
  };
  context.turns = Array.from({ length: 3 }, (_, i) => ({ id: `t${i}`, items: [{ type: "userMessage", text: `prompt${i}` }, { type: "agentMessage", text: "private response preview" }] }));
  assert.equal(evaluate(navigation, context), false, "UM08: rail is hidden below four user prompts");
  context.turns.push({ id: "t3", items: [{ type: "user", text: "legacy prompt" }] });
  const buttons = nodes(evaluate(navigation, context)).filter(node => node.type === "button");
  assert.equal(buttons.length, 4);
  assert.ok(buttons.every(node => !node.props.title.includes("private response preview")), "UM08: preview contains the prompt, not assistant output");
  buttons[3].props.onClick();
  assert.equal(target, "turn-user-t3", "UM09: navigation works even without an assistant response");
  await evaluate(copy, context)();
  evaluate(edit, context)();
  assert.equal(copied, original, "UM10: copy receives full text independent of folding");
  assert.equal(edited, original, "UM10: composer refill receives full text independent of folding");
  assert.equal(retired, "fixture:thread:a", "editing even without existing Appshots retires the old pending capture generation");
}
console.log("PASS UM01-UM10 production message presentation: measured folding, text reset, resize, cleanup, prompt navigation and full-text actions (L2)");

{
  const findSource = fs.readFileSync("src/components/ThreadFindBar.tsx", "utf8");
  const findAst = ts.createSourceFile("ThreadFindBar.tsx", findSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let scroll;
  function visitFind(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(findAst) === "scrollToMatch") scroll = node.initializer.arguments[0];
    ts.forEachChild(node, visitFind);
  }
  visitFind(findAst);
  const order = [];
  const context = {
    matchesRef: { current: [{ elementId: "turn-user-match" }] },
    highlightTimerRef: { current: null }, lastHighlightedElementRef: { current: null },
    clearTimeout() {}, setTimeout: () => 1,
    document: { getElementById: () => ({
      querySelector(selector) {
        if (selector === "[data-command-expand][aria-expanded='false']") return null;
        assert.equal(selector, "[data-user-message-expand][aria-expanded='false']");
        return { click: () => order.push("expand") };
      },
      scrollIntoView: () => order.push("scroll"), classList: { add() {}, remove() {} },
    }) },
  };
  vm.runInNewContext(ts.transpileModule(`(${scroll.getText(findAst)})`, { compilerOptions: options }).outputText, context)(0);
  assert.deepEqual(order, ["expand", "scroll"], "UM11: searching a hidden line reveals the full prompt before scrolling");
}
console.log("PASS UM11 production find navigation reveals folded prompts before scrolling (L2)");

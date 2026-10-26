import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync(new URL("../src/clipboard.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ES2022 },
}).outputText;
const { copyTextToClipboard } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
let attached = new Set();
let selected;
let fallbackResult;
const fallback = {
  createElement: () => ({ style: {}, select() { selected = this.value; }, remove() { attached.delete(this); } }),
  body: { appendChild: element => attached.add(element) },
  execCommand: command => { assert.equal(command, "copy"); return fallbackResult(); },
};
const setup = clipboard => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: fallback });
};
try {
  let release;
  let finished = false;
  setup({ writeText: text => { assert.equal(text, "中文\ncode"); return new Promise(resolve => { release = resolve; }); } });
  const pending = copyTextToClipboard("中文\ncode").then(value => { finished = true; return value; });
  await Promise.resolve();
  assert.equal(finished, false, "must await actual clipboard completion");
  release();
  assert.equal(await pending, true);
  assert.equal(attached.size, 0);
  console.log("PASS clipboard pending waits for actual success");

  setup({ writeText: async () => { throw new Error("denied"); } });
  fallbackResult = () => true;
  assert.equal(await copyTextToClipboard("fallback 中文"), true);
  assert.equal(selected, "fallback 中文");
  assert.equal(attached.size, 0);
  console.log("PASS rejected Clipboard API falls back and removes textarea");

  fallbackResult = () => false;
  assert.equal(await copyTextToClipboard("denied"), false);
  assert.equal(attached.size, 0);
  console.log("PASS rejected fallback never reports success");

  fallbackResult = () => { throw new Error("unavailable"); };
  assert.equal(await copyTextToClipboard("throws"), false);
  assert.equal(attached.size, 0);
  console.log("PASS throwing fallback removes textarea and permits retry");

  setup(undefined);
  fallbackResult = () => true;
  assert.equal(await copyTextToClipboard("no Clipboard API"), true);
  assert.equal(attached.size, 0);
  console.log("PASS absent Clipboard API can use fallback");

  // Execute the real message button callbacks; no duplicated UI implementation.
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const appAst = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const callbacks = new Map();
  let copyThreadText, copyAll;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(appAst) === "copyThreadText") copyThreadText = node.initializer.arguments[0].getText(appAst);
    if (ts.isVariableDeclaration(node) && node.name.getText(appAst) === "handleCopyAllConversation") copyAll = node.initializer.arguments[0].getText(appAst);
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(appAst) === "button") {
      const title = node.attributes.properties.find(attr => attr.name?.getText(appAst) === "title")?.initializer?.text;
      const click = node.attributes.properties.find(attr => attr.name?.getText(appAst) === "onClick")?.initializer?.expression;
      if (click && ["复制提问内容", "复制全部回答 Markdown"].includes(title)) callbacks.set(title, click.getText(appAst));
    }
    ts.forEachChild(node, visit);
  };
  visit(appAst);
  assert.equal(callbacks.size, 2);
  const compile = (names, expression) => new Function(...names, ts.transpileModule(`return (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
  for (const [title, callback] of callbacks) {
    let release;
    const notifications = [], copiedTexts = [];
    const write = text => { copiedTexts.push(text); return new Promise(resolve => { release = resolve; }); };
    const toast = (...args) => notifications.push(args);
    const copy = copyThreadText ? compile(["copyTextToClipboard", "showAppToast"], copyThreadText)(write, toast) : undefined;
    const click = compile(["navigator", "showAppToast", "userText", "messages", "extractTextFromItem", "copyThreadText"], callback)(
      { clipboard: { writeText: write } }, toast, "结构化用户消息", [{text:"回答 Markdown"}], item => item.text, copy,
    );
    const pending = click();
    assert.equal(notifications.length, 0, `${title} must not announce success before clipboard completion`);
    release(false);
    await pending;
    assert.equal(notifications.some(([, kind]) => kind === "success"), false, `${title} must not report failed copies as success`);
    assert.equal(copiedTexts[0], title === "复制提问内容" ? "结构化用户消息" : "回答 Markdown");
    notifications.length = 0;
    const success = click();
    release(true);
    await success;
    assert.equal(notifications[0][1], "success");
    console.log(`PASS actual App ${title} awaits clipboard and handles failure`);
  }

  const textJs = ts.transpileModule(readFileSync(new URL("../src/threadText.ts", import.meta.url), "utf8"), {compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText;
  const {extractTextFromItem} = await import(`data:text/javascript;base64,${Buffer.from(textJs).toString("base64")}`);
  let exported = true;
  let allText;
  const copyAllClick = compile(["turns","showAppToast","copyThreadText","setShowExportPopover","extractTextFromItem"],copyAll)(
    [{items:[{type:"userMessage",content:[{type:"text",text:"结构化提问"}]},{type:"agentMessage",text:"完整回答"}]}],
    ()=>{}, async text=>{allText=text;return false}, value=>{exported=value}, extractTextFromItem,
  );
  await copyAllClick();
  assert.match(allText,/\[用户\]:\n结构化提问/);assert.match(allText,/\[Codex\]:\n完整回答/);
  assert.equal(exported,true,"failed whole-chat copy must keep the export popover available");
  console.log("PASS actual whole-chat copy preserves structured messages and failure recovery");

  const selectionSource = readFileSync(new URL("../src/components/TextSelectionToolbar.tsx", import.meta.url), "utf8");
  const selectionAst = ts.createSourceFile("TextSelectionToolbar.tsx", selectionSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let selectionClick;
  const findSelection = node => {
    if (ts.isJsxOpeningElement(node) && node.attributes.properties.some(attr => attr.name?.getText(selectionAst) === "title" && attr.initializer?.text === "复制选中文本")) {
      selectionClick = node.attributes.properties.find(attr => attr.name?.getText(selectionAst) === "onClick").initializer.expression.getText(selectionAst);
    }
    ts.forEachChild(node, findSelection);
  };
  findSelection(selectionAst);assert.ok(selectionClick);
  for (const outcome of [false, true, "reject", "new-selection", "unmounted"]) {
    let release, copied = false, timers = 0;
    const pendingRef = {current:false}, mountedRef = {current:true}, textRef = {current:"选区内容"};
    const write = text => { assert.equal(text,"选区内容"); return new Promise((resolve,reject) => { release = () => outcome === "reject" ? reject(Error("denied")) : resolve(outcome !== false); }); };
    const click = compile(["onCopy","copyTextToClipboard","selectedText","copied","copyingRef","setCopying","mountedRef","selectedTextRef","setCopied","copyTimerRef","clearTimeout","setTimeout","setPosition","window"], selectionClick)(
      write, write, "选区内容", false, pendingRef, ()=>{}, mountedRef, textRef, value=>{copied=value}, {current:null}, ()=>{}, ()=>{timers++;return 1}, ()=>{}, {},
    );
    const task = click();
    assert.equal(copied,false);assert.equal(timers,0);
    await click(); // A repeated click while pending must not call the writer again.
    if(outcome === "new-selection") textRef.current="新选区";
    if(outcome === "unmounted") mountedRef.current=false;
    release();await task;
    assert.equal(copied,outcome===true);assert.equal(timers,outcome===true?1:0);
    assert.equal(pendingRef.current,false);
    console.log(`PASS actual selection copy ${outcome}`);
  }
} finally {
  for (const [key, descriptor] of [["navigator", navigatorDescriptor], ["document", documentDescriptor]]) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}

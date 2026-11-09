import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/components/TerminalDock.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("TerminalDock.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let tabHandler, actionsHandler, appearance, appearanceEffect, clearTerminal, closeTerminal, moveDock, startResize, resizeDock;
const fontButtons={};
const dragHandlers = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast)==="clearActiveTerminal") clearTerminal=node.initializer;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast)==="closeTerminalTab") closeTerminal=node.initializer;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast)==="moveActiveDock") moveDock=node.initializer;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast)==="handleStartResize") startResize=node.initializer;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast)==="handleDockResize") resizeDock=node.initializer;
  if (ts.isVariableDeclaration(node) && ["startTabDrag", "trackTabDrag", "cancelTabDrag", "finishTabDrag"].includes(node.name.getText(ast))) {
    dragHandlers[node.name.getText(ast)] = node.initializer;
  }
  if (ts.isFunctionDeclaration(node) && node.name?.text === "terminalDropPosition") dragHandlers.terminalDropPosition = node;
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes("observer.observe(document.documentElement")) appearanceEffect=node.arguments[0];
  if (ts.isFunctionDeclaration(node) && node.name?.text === "terminalAppearance") appearance = node;
  if (ts.isJsxOpeningElement(node)) {
    const text = node.getText(ast);
    for (const [name,title] of [["decrease","缩小终端字号"],["increase","放大终端字号"]]) {
      if (text.includes(`title="${title}"`)) {
        const attrs=node.attributes.properties;
        fontButtons[name]={
          click:attrs.find(a=>ts.isJsxAttribute(a)&&a.name.text==="onClick")?.initializer.expression,
          disabled:attrs.find(a=>ts.isJsxAttribute(a)&&a.name.text==="disabled")?.initializer.expression,
        };
      }
    }
    const callback = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.text === "onKeyDown")?.initializer;
    if (callback && ts.isJsxExpression(callback)) {
      if (text.includes('role="tab"')) tabHandler = callback.expression;
      if (text.includes('className="terminal-session-actions"')) actionsHandler = callback.expression;
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(tabHandler && actionsHandler && appearance);
const compile = node => ts.transpileModule(`(${node.getText(ast)})`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const selected = [], closed = [], focused = [];
const context = {
  t:{id:"a"}, dockTabs:[{id:"a"},{id:"b"},{id:"c"}], dockPosition:"bottom",
  tabDragRef:{current:null},
  setActiveTabId:id=>selected.push(id), closeTerminalTab:id=>closed.push(id),
  document:{getElementById:id=>({focus:()=>focused.push(["terminal-tab-a","terminal-tab-b","terminal-tab-c"].indexOf(id))})},
  setActionsOpen:value=>{context.actionsOpen=value;}, actionsTriggersRef:{current:new Map([["bottom",{focus:()=>focused.push("actions")} ]])},
};
const key = vm.runInNewContext(compile(tabHandler), context);
const event = (key, composing=false) => ({key,nativeEvent:{isComposing:composing},preventDefault(){this.prevented=true;},stopPropagation(){}});
for (const [input,target,index] of [["ArrowRight","b",1],["ArrowLeft","c",2],["End","c",2],["Home","a",0]]) {
  const e = event(input); key(e);
  assert.equal(selected.at(-1),target); assert.equal(focused.at(-1),index); assert.equal(e.prevented,true);
}
const before=selected.length;
key(event("ArrowRight",true)); key({...event("Delete"),keyCode:229});
assert.equal(selected.length,before); assert.equal(closed.length,0);
key(event("Delete")); assert.deepEqual(closed,["a"]);
const escape=vm.runInNewContext(compile(actionsHandler),context);
escape(event("Escape",true)); assert.equal(context.actionsOpen,undefined);
escape(event("Escape")); assert.equal(context.actionsOpen,false); assert.equal(focused.at(-1),"actions");

const firstTab = { id: "a" }, secondTab = { id: "b", dockPosition: "right" };
const dock = {
  activeTabId: "a", tabs: [firstTab, secondTab],
  setTabs(update) { dock.tabs = update(dock.tabs); },
  dockResizeRef: { current: null }, captured: [], bothSides:false,
  widths:{left:360,right:360},
  setDockWidths(update) { dock.widths = update(dock.widths); }, setDockHeight(height) { dock.height = height; },
};
vm.runInNewContext(compile(moveDock), dock)("left");
assert.equal(dock.tabs[0].dockPosition, "left");
assert.equal(dock.tabs[1], secondTab, "moving one tab keeps the other tab and its placement");
const start = vm.runInNewContext(compile(startResize), dock);
const resize = vm.runInNewContext(compile(resizeDock), dock);
const grip = {
  parentElement: { offsetWidth: 360, offsetHeight: 260, parentElement: { clientWidth: 900, clientHeight: 700 } },
  setPointerCapture(id) { dock.captured.push(id); },
};
for (const [position, event, expected] of [
  ["left", {clientX: 440, clientY: 500}, 400],
  ["right", {clientX: 360, clientY: 500}, 400],
  ["bottom", {clientX: 400, clientY: 460}, 300],
]) {
  dock.dockPosition = position;
  dock.sideDock = position !== "bottom";
  start({ currentTarget: grip, button: 0, pointerId: 2, clientX: 400, clientY: 500, preventDefault() {} }, position);
  resize({ ...event, pointerId: 2 });
  assert.equal(dock.sideDock ? dock.widths[position] : dock.height, expected, `dragging the ${position} splitter expands it toward the chat`);
  resize({ clientX: position === "left" ? 2000 : 0, clientY: 0, pointerId: 2 });
  assert.equal(dock.sideDock ? dock.widths[position] : dock.height, dock.sideDock ? 450 : 560);
}
assert.deepEqual(dock.captured, [2, 2, 2]);
dock.bothSides = true;
start({ currentTarget: grip, button: 0, pointerId: 2, clientX: 400, clientY: 500, preventDefault() {} }, "left");
resize({ clientX: 2000, clientY: 500, pointerId: 2 });
assert.equal(dock.widths.left, 240, "two side docks reserve space for the chat");
assert.equal(dock.widths.right, 450, "resizing one side preserves the other side's stored width");

const bounds = {left:100, top:50, right:900, bottom:650, width:800, height:600};
const drag = {
  ...dock, tabDragRef:{current:null}, suppressTabClickRef:{current:false}, preview:null, moved:[],
  requestAnimationFrame:callback=>callback(), document:{getElementById:()=>null},
  setDropPreview(value) { drag.preview = typeof value === "function" ? value(drag.preview) : value; },
  moveActiveDock(position, tabId) { drag.moved.push([position, tabId]); },
};
for (const [name,node] of Object.entries(dragHandlers)) drag[name] = vm.runInNewContext(compile(node), drag);
const pointer = (x,y,id=1) => ({
  pointerId:id, clientX:x, clientY:y, button:0, isPrimary:true, pointerType:"mouse",
  currentTarget:{closest:()=>({getBoundingClientRect:()=>bounds}),setPointerCapture(){}},
});
drag.startTabDrag(pointer(500,630),"b");
drag.trackTabDrag(pointer(503,631));
assert.equal(drag.preview,null, "a click with small movement does not enter drag mode");
drag.finishTabDrag(pointer(503,631));
assert.equal(drag.suppressTabClickRef.current,false);
for (const [x,y,position] of [[160,300,"left"],[860,300,"right"],[540,600,"bottom"]]) {
  drag.startTabDrag(pointer(500,630),"b");
  drag.trackTabDrag(pointer(x,y,9));
  assert.equal(drag.preview,null,"another pointer does not control the drag");
  drag.trackTabDrag(pointer(x,y));
  assert.equal(drag.preview.position,position);
  drag.finishTabDrag(pointer(x,y));
  assert.deepEqual(drag.moved.at(-1),[position,"b"]);
  assert.equal(drag.preview,null);
  assert.equal(drag.suppressTabClickRef.current,true);
}
for (const [x,y] of [[500,300],[950,300]]) {
  drag.startTabDrag(pointer(500,630),"b");
  drag.trackTabDrag(pointer(x,y));
  assert.equal(drag.preview.position,null,"center and outside are not valid drop targets");
  drag.finishTabDrag(pointer(x,y));
}
drag.startTabDrag(pointer(500,630),"b");
drag.trackTabDrag(pointer(860,300));
vm.runInNewContext(compile(tabHandler),drag)(event("Escape"));
drag.finishTabDrag(pointer(860,300));
assert.equal(drag.preview,null);
assert.equal(drag.moved.length,3,"cancelled or invalid drags never move a tab");

const values={"--font-mono":'"Custom Mono", monospace',"--font-code-size":"18px","--bg-primary":"#ffffff","--text-primary":"#111111","--selection-bg":"#abcdef"};
const read=vm.runInNewContext(compile(appearance),{getComputedStyle:()=>({getPropertyValue:key=>values[key]||""})});
const result=read({});
assert.equal(result.fontFamily,values["--font-mono"]); assert.equal(result.fontSize,18);
assert.equal(result.theme.background,"#ffffff"); assert.equal(result.theme.cursor,"#111111");
const requests=[], fontListeners=new Map(), renderer={term:{options:{},cols:90,rows:25},fit:{fit(){renderer.fits=(renderer.fits||0)+1;}},ready:Promise.resolve(true)};
let observerCallback, disconnected=false;
const appearanceContext={
  dockContainersRef:{current:new Map([["bottom",{}]])},xtermMapRef:{current:new Map([["same-session",renderer]])},
  terminalAppearance:()=>read({}),setFontSize:size=>{appearanceContext.fontSize=size;},
  invoke:(method,args)=>{requests.push({method,args});return Promise.resolve();},
  MutationObserver:class{constructor(callback){observerCallback=callback;}observe(){}disconnect(){disconnected=true;}},
  document:{documentElement:{},fonts:{addEventListener:(name,fn)=>fontListeners.set(name,fn),removeEventListener:name=>fontListeners.delete(name)}},
};
const stop=vm.runInNewContext(compile(appearanceEffect),appearanceContext)();
await Promise.resolve(); await Promise.resolve();
assert.equal(renderer.term.options.fontFamily,values["--font-mono"]);
values["--font-code-size"]="24px";values["--bg-primary"]="#000000";
observerCallback(); await Promise.resolve();await Promise.resolve();
assert.equal(renderer.term.options.fontSize,24);assert.equal(renderer.term.options.theme.background,"#000000");
fontListeners.get("loadingdone")();await Promise.resolve();await Promise.resolve();
assert.ok(renderer.fits>=3);assert.ok(requests.every(item=>item.method==="terminal_resize"&&item.args.sessionId==="same-session"));
stop();assert.equal(disconnected,true);assert.equal(fontListeners.size,0);
let released=0,cleared=0;
const tabContext={
  tabs:[{id:"a"},{id:"b"}],activeTabId:"a",
  tabDragRef:{current:null},
  xtermMapRef:{current:new Map([["a",{releaseInput(){released++;},term:{clear(){cleared++;},dispose(){}},output:{dispose(){}},cancelHydration(){},el:{remove(){}}}]])},
  invoke:()=>Promise.resolve(),setTabs:()=>{},setActiveTabId:()=>{},
};
vm.runInNewContext(compile(clearTerminal),tabContext)();
assert.equal(cleared,1);assert.equal(released,0,"TU05: clearing output keeps input classification listeners");
vm.runInNewContext(compile(closeTerminal),tabContext)("a");
assert.equal(released,1,"TU05: closing a tab releases input classification listeners");
for (const initial of [8,10,12,20,24]) {
  for (const direction of ["decrease","increase"]) {
    const fontContext={fontSize:initial,setFontSize:update=>{fontContext.fontSize=update(fontContext.fontSize);}};
    vm.runInNewContext(compile(fontButtons[direction].click),fontContext)();
    const expected=direction==="decrease"?Math.max(8,initial-1):Math.min(24,initial+1);
    assert.equal(fontContext.fontSize,expected,`TU03: ${direction} remains monotonic at ${initial}px`);
    assert.ok(fontButtons[direction].disabled,"TU03: boundary has a disabled expression");
    fontContext.fontSize=initial;
    const disabled=vm.runInNewContext(compile(fontButtons[direction].disabled),fontContext);
    assert.equal(disabled,direction==="decrease"?initial<=8:initial>=24);
  }
}
console.log("PASS TU01–TU03 production callbacks: tab navigation/wrap/close, IME guard, disclosure Escape/focus and applied appearance tokens");

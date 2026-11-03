import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = fs.readFileSync("src/components/GeneralOpenPreferences.tsx", "utf8");
const ast = ts.createSourceFile("GeneralOpenPreferences.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let load, save;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") load = node.arguments[0];
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "savePreference") save = node.initializer;
  ts.forEachChild(node, visit);
}
visit(ast);
const compile = node => ts.transpileModule(`(${node.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const flush = () => new Promise(setImmediate);
const fixture = { platform:"windows",targets:[{id:"cursor",label:"Cursor"}],preferredTarget:"cursor",shells:[{id:"powershell",label:"PowerShell"},{id:"commandPrompt",label:"CMD"}],preferredShell:"powershell" };
function mount(invoke) {
  const calls=[];
  const context={preferences:fixture,busy:false,pending:{current:false},alive:{current:true},error:null,
    tauriInvoke(method,args){calls.push([method,args]);return invoke(method,args);},
    setPreferences(value){context.preferences=value;},setBusy(value){context.busy=value;},setError(value){context.error=value;}};
  return { context,calls,load:vm.runInNewContext(compile(load),context),save:vm.runInNewContext(compile(save),context) };
}
{
 const pending=deferred();const view=mount(()=>pending.promise);const cleanup=view.load();cleanup();pending.resolve(fixture);await flush();assert.equal(view.context.alive.current,false);assert.equal(view.context.busy,true);
}
{
 const view=mount(async method=>{if(method==="desktop_open_preferences")return {...fixture,preferredShell:"commandPrompt"};});
 await view.save("shell","commandPrompt");assert.equal(view.calls[0][0],"desktop_open_preference_set");assert.equal(view.calls[0][1].value,"commandPrompt");assert.equal(view.calls[1][0],"desktop_open_preferences");assert.equal(view.context.preferences.preferredShell,"commandPrompt");assert.equal(view.context.error,null);
}
{
 const view=mount(async()=>{throw Error("disk denied");});await view.save("target","cursor");assert.equal(view.context.preferences,fixture);assert.match(view.context.error,/更新打开偏好失败/);assert.equal(view.context.busy,false);
}
{
 const view=mount(async()=>fixture);await view.save("shell","commandPrompt");assert.match(view.context.error,/已保存，但读取确认失败/);assert.match(view.context.error,/读回不一致/);assert.equal(view.context.preferences.preferredShell,"powershell");
}
{
 const gate=deferred();const view=mount(async method=>method==="desktop_open_preference_set"?gate.promise:fixture);const writing=view.save("target","cursor");await view.save("shell","powershell");assert.equal(view.calls.length,1);gate.resolve();await writing;assert.equal(view.context.pending.current,false);
}
assert.match(source,/preferences\?\.platform === "windows"/);
assert.match(source,/默认文件打开位置/);assert.match(source,/默认打开文件和文件夹的位置/);
console.log("PASS GT01/GT02/GT06: production load/save, unmount protection, real readback, synchronous write lock, write failure and mismatch (L2)");
const terminal=fs.readFileSync("src/components/TerminalDock.tsx","utf8");
const terminalAst=ts.createSourceFile("TerminalDock.tsx",terminal,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let add;
function findAdd(node){if(ts.isVariableDeclaration(node)&&node.name.getText(terminalAst)==="addNewTerminal")add=node.initializer;ts.forEachChild(node,findAdd);}findAdd(terminalAst);
const old={id:"running",shell:"powershell",cwd:"D:/fixture",title:"old"};
const ctx={tabs:[old],selectedShell:"",shellOptions:fixture.shells,cwd:"D:/fixture",crypto:{randomUUID:()=>"new"},setTabs(fn){ctx.tabs=fn(ctx.tabs);},setActiveTabId(id){ctx.activeTabId=id;}};
const addTab=vm.runInNewContext(ts.transpileModule(`(${add.getText(terminalAst)})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
addTab();assert.equal(ctx.tabs[0],old);assert.equal(ctx.tabs[1].shell,"");assert.equal(ctx.activeTabId,"new");
ctx.selectedShell="commandPrompt";ctx.crypto.randomUUID=()=>"explicit";addTab();assert.equal(ctx.tabs[2].shell,"commandPrompt");assert.equal(ctx.tabs[0].shell,"powershell");
console.log("PASS GT05: new default terminal defers global preference to backend; explicit override and running tabs preserved (L2)");

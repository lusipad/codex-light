import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const appshotJs=ts.transpileModule(fs.readFileSync(new URL("../src/appshotContext.ts",import.meta.url),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {buildAppshotPrompt,appshotImageInputs}=await import(`data:text/javascript;base64,${Buffer.from(appshotJs).toString("base64")}`);

const source=fs.readFileSync(new URL("../src/App.tsx",import.meta.url),"utf8");
const ast=ts.createSourceFile("App.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let steerBranch;
const find=node=>{if(ts.isIfStatement(node)&&node.expression.getText(ast)==="isStreaming && activeThreadId")steerBranch=node.getText(ast);ts.forEachChild(node,find)};
find(ast);assert.ok(steerBranch);
const compile=(env,code)=>new Function(...Object.keys(env),ts.transpileModule(`return (async()=>{${code}; return "normal-flow";});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(env));
let calls=[];
const env={isStreaming:true,activeThreadId:"a",activeTurnIdRef:{current:"turn-a"},threadRequestRef:{current:1},activeThreadIdRef:{current:"a"},
 executionIdentityRef:{current:"account-a"},appshots:[],appshotScope:"account-a:thread:a",clearSentAppshots(){},buildAppshotPrompt,appshotImageInputs,
 isCurrentThreadRequest:(request,current,thread,active)=>request===current&&thread===active,
 steerSendPendingRef:{current:new Set()},
 attachedFiles:[],nativeInputs:[{type:"text",text:"保持原输入"}],overrideText:undefined,promptInput:"保持原输入",
 persistThreadAttachments:async()=>({errors:[]}),callAppServer:async(method)=>{calls.push(method);throw Error("response timed out")},
 setPromptInput(){},setAttachedFiles(){},showAppToast(){},
};
const result=await compile(env,steerBranch)();
assert.notEqual(result,"normal-flow","unconfirmed Steer must not fall through to a new turn");
assert.deepEqual(calls,["turn/steer"]);
console.log("PASS actual streaming send never starts a new turn after unconfirmed Steer");

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
const setup=(overrides={})=>{
 let draft="保持原输入", attachments=[];
 const calls=[], notices=[],appshotClears=[];
 const context={...env,executionIdentityRef:{current:"account-a"},clearSentAppshots:(scope,snapshot)=>appshotClears.push({scope,snapshot}),activeTurnIdRef:{current:"turn-a"},threadRequestRef:{current:1},activeThreadIdRef:{current:"a"},steerSendPendingRef:{current:new Set()},
  attachedFiles:attachments,callAppServer:async(method,params)=>{calls.push({method,params});return {turnId:"turn-a"}},
  setPromptInput:value=>{draft=typeof value==="function"?value(draft):value},setAttachedFiles:value=>{attachments=typeof value==="function"?value(attachments):value},
  showAppToast:(...args)=>notices.push(args),...overrides};
 return {context,calls,notices,appshotClears,run:compile(context,steerBranch),get draft(){return draft},edit:text=>{draft=text}};
};
const saved=deferred();const afterSave=setup({persistThreadAttachments:()=>saved.promise});
const oldSave=afterSave.run();afterSave.context.threadRequestRef.current++;afterSave.context.activeThreadIdRef.current="b";afterSave.edit("B草稿");saved.resolve({errors:[]});await oldSave;
assert.equal(afterSave.calls.length,0);assert.equal(afterSave.draft,"B草稿");
console.log("PASS leaving during attachment save prevents stale Steer dispatch");
const received=deferred();const afterSend=setup({callAppServer:()=>received.promise});
const oldSend=afterSend.run();await Promise.resolve();afterSend.context.threadRequestRef.current++;afterSend.context.activeThreadIdRef.current="b";afterSend.edit("B的新输入");received.resolve({turnId:"turn-a"});await oldSend;
assert.equal(afterSend.draft,"B的新输入");
console.log("PASS late accepted Steer cannot clear another thread's draft");
const accepted=deferred();let sends=0;const duplicate=setup({callAppServer:()=>{sends++;return accepted.promise}});
const sending=duplicate.run();await Promise.resolve();await duplicate.run();assert.equal(sends,1);duplicate.edit("同会话新草稿");accepted.resolve({turnId:"turn-a"});await sending;
assert.equal(duplicate.draft,"同会话新草稿");assert.equal(duplicate.context.steerSendPendingRef.current.size,0);
console.log("PASS duplicate pending send is blocked and edited draft survives success");
const success=setup();await success.run();assert.equal(success.draft,"");assert.equal(success.calls[0].params.expectedTurnId,"turn-a");assert.equal(typeof success.calls[0].params.clientUserMessageId,"string");
const missingTurn=setup();missingTurn.context.activeTurnIdRef.current=null;await missingTurn.run();assert.equal(missingTurn.calls.length,0);assert.equal(missingTurn.draft,"保持原输入");
const attachmentFailure=setup({persistThreadAttachments:async()=>({errors:[{message:"fixture persistence failed"}]})});await attachmentFailure.run();assert.equal(attachmentFailure.calls.length,0);assert.equal(attachmentFailure.draft,"保持原输入");
console.log("PASS successful Steer clears only unchanged input; invalid turn and attachment failure preserve it");

const accountAck=deferred();const accountChange=setup({callAppServer:()=>accountAck.promise});
const oldAccountSend=accountChange.run();await Promise.resolve();
accountChange.context.executionIdentityRef.current="account-b";accountChange.context.appshotScope="account-b:thread:a";accountChange.edit("新账号草稿");
accountAck.resolve({turnId:"turn-a"});await oldAccountSend;
assert.equal(accountChange.draft,"新账号草稿","old-account Steer acknowledgement cannot clear the new account draft");
assert.equal(accountChange.appshotClears.length,0,"old-account Steer acknowledgement cannot clear appshots in a new scope");
assert.equal(accountChange.notices.length,0);
console.log("PASS old account Steer acknowledgement preserves new account scope");

let interrupt;
const findInterrupt=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==="handleInterruptTurn")interrupt=node.initializer.arguments[0].getText(ast);ts.forEachChild(node,findInterrupt)};findInterrupt(ast);assert.ok(interrupt);
let interruptRequests=0;
const interruptEnv={...env,activeRouteRef:{current:"cloud-draft"},activeThreadIdRef:{current:"a"},activeTurnIdRef:{current:"turn-a"},threadRequestRef:{current:1},workActiveSend:{current:null},workSendPreparing:{current:null},pendingTurnIdRef:{current:null},setIsStreaming:()=>{throw Error("must await completion event")},callAppServer:async()=>{interruptRequests++;throw Error("interrupt timed out")}};
let warnings=0;interruptEnv.showAppToast=()=>{warnings++};
const stop=new Function(...Object.keys(interruptEnv),ts.transpileModule(`return (${interrupt});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(interruptEnv));
await stop();assert.equal(interruptRequests,0,"cloud draft must never interrupt a local turn");assert.equal(warnings,0);
interruptEnv.activeRouteRef.current="thread";
await stop();assert.equal(interruptRequests,1);assert.equal(warnings,1);
const workSend=new AbortController(),workPreparation=new AbortController();
interruptEnv.workActiveSend.current=workSend;interruptEnv.workSendPreparing.current=workPreparation;interruptEnv.pendingTurnIdRef.current="turn-a";
await stop();assert.equal(workSend.signal.aborted,true);assert.equal(workPreparation.signal.aborted,true);assert.equal(interruptRequests,1,"a pending Work turn must not interrupt a different server turn");
interruptEnv.workActiveSend.current=null;interruptEnv.workSendPreparing.current=null;
interruptEnv.activeThreadIdRef.current=null;await stop();assert.equal(interruptRequests,1);assert.equal(warnings,1);
console.log("PASS interrupt errors are visible without faking turn completion");

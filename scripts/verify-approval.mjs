import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const source = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("App.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let requestsExpression;
const visit = node => {
  if(ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "ApprovalCenter") {
    requestsExpression = node.attributes.properties.find(attr=>attr.name?.getText(ast)==="requests").initializer.expression.getText(ast);
  }
  ts.forEachChild(node,visit);
};
visit(ast);assert.ok(requestsExpression);
const requests=[{id:1,generation:1,method:"item/commandExecution/requestApproval",params:{threadId:"a"}},{id:2,generation:1,method:"item/tool/requestUserInput",params:{threadId:"b"}}];
const displayed=new Function("pendingRequests","activeThreadId","activePendingRequests",`return (${requestsExpression});`)(requests,"b",requests.filter(r=>r.params.threadId==="b"));
assert.deepEqual(displayed.map(r=>r.id),[2],"B must not render A's approval");
console.log("PASS actual App approval surface is scoped to active thread");

const helperJs=ts.transpileModule(fs.readFileSync(new URL("../src/approvalRequests.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText;
const {pendingRequestKey,requestThreadId,requestsForThread}=await import(`data:text/javascript;base64,${Buffer.from(helperJs).toString("base64")}`);
assert.deepEqual(requestsForThread(requests,"a").map(r=>r.id),[1]);
assert.deepEqual(requestsForThread(requests,null),[]);
assert.equal(requestThreadId({params:{conversationId:"legacy"}}),"legacy");
assert.notEqual(pendingRequestKey({id:7,generation:1}),pendingRequestKey({id:"7",generation:1}));
assert.notEqual(pendingRequestKey({id:7,generation:1}),pendingRequestKey({id:7,generation:2}));
console.log("PASS thread scope, legacy conversation and typed generation identity");

const compile=(names,expression)=>new Function(...names,ts.transpileModule(`return (${expression});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText);
const declaration=(tree,name)=>{let expression;const find=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(tree)===name)expression=node.initializer;ts.forEachChild(node,find)};find(tree);assert.ok(expression,name);return expression};
const response=declaration(ast,"submitServerResponse").arguments[0].getText(ast);
const pending=[{...requests[0],notificationNonce:"approval-first",responseDeliveryUnknown:false}];
let rows=pending, states={}, writes=0, release, revision={current:0}, refreshes=0, refreshAvailable=true;
const updating = update=>{rows=update(rows)};
const flags=update=>{states=update(states)};
const inFlight={current:new Set()};
let invoke=()=>{writes++;return new Promise(resolve=>{release=resolve})};
const responseCalls=[],notificationHides=[];
const invokeCommand=(command,args)=>{
 if(command==="desktop_notification_hide") { notificationHides.push(args.id);return Promise.resolve(); }
 assert.equal(command,"app_server_respond","only actual protocol response writes count toward duplicate protection");
 responseCalls.push(args);return invoke(command,args);
};
const handler=compile(["pendingRequestsRef","activeThreadIdRef","pendingRequestKey","requestThreadId","respondingRequestsRef","setRequestResponses","tauriInvoke","pendingRequestRevisionRef","setPendingRequests","refreshPendingRequests","notificationRequestCategory","showAppToast"],response)(
 {get current(){return rows}},{current:"a"},pendingRequestKey,requestThreadId,inFlight,flags,invokeCommand,revision,updating,async()=>{refreshes++;if(refreshAvailable)rows=rows.map(r=>({...r,responseDeliveryUnknown:false}))},
 ()=>"permission",message=>{throw Error(message)},
);
const first=handler(1,1,{decision:"accept"},null);
assert.equal(rows.length,1,"pending card must remain until write completes");
assert.equal(states[pendingRequestKey(rows[0])].sending,true);
await handler(1,1,{decision:"decline"},null);assert.equal(writes,1,"pending duplicate blocked");
release();await first;assert.equal(rows.length,0);assert.equal(inFlight.current.size,0);
assert.deepEqual(notificationHides,["permission-1:number:1-approval-first"],"successful response retracts its exact nonce notification");
rows=pending;invoke=async()=>{writes++;throw Error("no stdin")};
await handler(1,1,{decision:"accept"},null);
assert.equal(rows.length,1);assert.match(states[pendingRequestKey(rows[0])].error,/no stdin/);assert.equal(refreshes,1);
assert.equal(rows[0].responseDeliveryUnknown,false,"fresh backend may confirm that nothing was sent");
refreshAvailable=false;await handler(1,1,{},null);assert.equal(rows[0].responseDeliveryUnknown,true,"without a fresh snapshot delivery must remain unknown");
const before=writes;rows=[{...pending[0],responseDeliveryUnknown:true}];await handler(1,1,{},null);assert.equal(writes,before);
rows=[{...pending[0],params:{threadId:"b"}}];await handler(1,1,{},null);assert.equal(writes,before);
rows=pending;await handler(1,0,{},null);assert.equal(writes,before);
await handler(1,1,{},null,"approval-old");assert.equal(writes,before,"stale nonce cannot respond to a reused id/generation");
invoke=async()=>{writes++};
await handler(1,1,{decision:"accept"},null,"approval-first");
assert.equal(writes,before+1,"matching nonce retains the real response path");
assert.equal(responseCalls.at(-1).notificationNonce,"approval-first","native action nonce reaches the backend guard");
assert.equal(rows.length,0);
console.log("PASS actual App response waits, blocks duplicates, preserves failure and rejects stale/unknown/background actions");

const refresh=declaration(ast,"refreshPendingRequests").arguments[0].getText(ast);
let releaseList, listCalls=0, visibleRows=[];
const listRevision={current:0};
const refreshRequests=compile(["pendingRequestRevisionRef","tauriInvoke","setPendingRequests"],refresh)(listRevision,()=>{
 listCalls++;return listCalls===1?new Promise(resolve=>{releaseList=resolve}):Promise.resolve([]);
},value=>{visibleRows=value});
const refreshing=refreshRequests();listRevision.current++;releaseList(pending);await refreshing;await Promise.resolve();
assert.equal(listCalls,2);assert.deepEqual(visibleRows,[],"stale list must not resurrect resolved requests");
console.log("PASS actual pending refresh discards an outdated response and resynchronizes");

const cardSource=fs.readFileSync(new URL("../src/components/ApprovalCenter.tsx",import.meta.url),"utf8");
const cardAst=ts.createSourceFile("ApprovalCenter.tsx",cardSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const userInput=declaration(cardAst,"UserInputCard");
let submit,keydown;
const findInput=node=>{
 if(ts.isVariableDeclaration(node)&&node.name.getText(cardAst)==="submit")submit=node.initializer.getText(cardAst);
 if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(cardAst)==="input")keydown=node.attributes.properties.find(attr=>attr.name?.getText(cardAst)==="onKeyDown")?.initializer?.expression?.getText(cardAst);
 ts.forEachChild(node,findInput);
};findInput(userInput);assert.ok(submit);assert.ok(keydown);
for(const canSubmit of [false,true]) {
 let calls=0;
 const send=compile(["canSubmit","questions","freeform","answers","onRespond","request","userInputResponse"],submit)(canSubmit,[{id:"q"}],{q:canSubmit?"中文答复":""},{},()=>{calls++},{id:5},answers=>({answers}));
 const key=compile(["submit"],keydown)(send);
 for(const nativeEvent of [{isComposing:true,keyCode:13},{isComposing:false,keyCode:229}]) key({key:"Enter",nativeEvent,preventDefault(){},stopPropagation(){}});
 assert.equal(calls,0,"IME must not submit");
 key({key:"Enter",nativeEvent:{isComposing:false,keyCode:13},preventDefault(){},stopPropagation(){}});
 assert.equal(calls,canSubmit?1:0,"Enter must obey same submit validity as button");
 send();assert.equal(calls,canSubmit?2:0);
}
console.log("PASS actual user input handles IME, keyCode229 and empty Enter");

// Render actual cards with the installed React runtime; no new test dependency.
for(const ext of [".ts",".tsx"])Module._extensions[ext]=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
Module._extensions[".css"]=()=>{};
const require=createRequire(import.meta.url);
const {createElement}=require("react");const {renderToStaticMarkup}=require("react-dom/server");
const {ApprovalCenter}=require(fileURLToPath(new URL("../src/components/ApprovalCenter.tsx",import.meta.url)));
const render=props=>renderToStaticMarkup(createElement(ApprovalCenter,{requests:pending,onRespond(){},onRespondError(){},...props}));
assert.match(render({responseStates:{[pendingRequestKey(pending[0])]:{sending:true}}}),/<fieldset disabled=""/);
assert.match(render({requests:[{...pending[0],responseDeliveryUnknown:true}]}),/无法确认响应是否已送达/);
assert.match(render({responseStates:{[pendingRequestKey(pending[0])]:{error:"发送失败"}}}),/role="alert"/);
console.log("PASS actual approval cards expose sending/error/unknown-delivery state");

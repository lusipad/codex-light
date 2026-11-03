import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const load = (file, dependencies = {}) => {
  const module = {exports:{}};
  vm.runInNewContext(compile(fs.readFileSync(file,"utf8")), {exports:module.exports, require:name => dependencies[name] ?? {}});
  return module.exports;
};
const protocol = load("src/protocol.ts");
const delivery = load("src/notificationPreferences.ts");
const output=[];
let status="submitted";
const dispatch=delivery.createNotificationDispatcher({
  preferences:()=>delivery.NOTIFICATION_DEFAULTS,focused:()=>false,visible:()=>false,
  send:async()=>{output.push("send");return{status};},play:async()=>{output.push("play");},onError:error=>{throw error;},
});
const delivered={id:"shared-id",category:"turn",title:"done",body:"",accountKey:"one"};
await dispatch(delivered);await dispatch(delivered);await dispatch({...delivered,accountKey:"two"});
assert.deepEqual(output,["send","play","send","play"],"same-account duplicate suppressed; account epoch permits a distinct event");
status="suppressed";output.length=0;await dispatch({...delivered,id:"disabled"});
assert.deepEqual(output,["send"],"OS suppression must not play sound");
const helpers = load("src/notificationActions.ts", {"./protocol":protocol});
const approval = {id:7,generation:3,notificationNonce:"request-instance",method:"item/commandExecution/requestApproval",params:{threadId:"thread"}};
assert.equal(helpers.notificationApprovalActions(approval).length,3);
assert.deepEqual(JSON.parse(JSON.stringify(helpers.notificationApprovalResponse(approval,"approve-for-session"))),{decision:"acceptForSession"});
for (const method of ["item/permissions/requestApproval","unknown","execCommandApproval"]) {
  assert.equal(helpers.notificationApprovalActions({...approval,method}),undefined);
  assert.equal(helpers.notificationApprovalResponse({...approval,method},"approve"),null);
}
assert.equal(helpers.notificationApprovalResponse({...approval,responseDeliveryUnknown:true},"approve"),null);
assert.equal(helpers.notificationApprovalResponse(approval,"open"),null);

const source=fs.readFileSync("src/App.tsx","utf8");
const ast=ts.createSourceFile("App.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let action;
function visit(node) {
  if(ts.isBinaryExpression(node)&&node.left.getText(ast)==="notificationNativeActionRef.current") action=node.right.getText(ast);
  ts.forEachChild(node,visit);
}
visit(ast); assert.ok(action,"production native notification listener action exists");
const events=[];
const context={
  notificationAccountRef:{current:"epoch"},activeThreadIdRef:{current:"thread"},pendingRequestsRef:{current:[approval]},respondingRequestsRef:{current:new Set()},
  pendingRequestKey:r=>`${r.generation}:${typeof r.id}:${r.id}`,requestThreadId:r=>r.params.threadId,
  notificationApprovalResponse:helpers.notificationApprovalResponse,
  selectThread:async id=>{events.push(["navigate",id]);context.activeThreadIdRef.current=id;},
  submitServerResponse:async(...args)=>events.push(["respond",...args]),
  document:{getElementById:id=>({focus:()=>events.push(["focus",id]),scrollIntoView:()=>events.push(["scroll",id])})},
};
const handle=vm.runInNewContext(compile(`(${action})`),context);
const event={kind:"activated",action:"open",payload:{accountKey:"epoch",hostId:"local",threadId:"thread",requestId:"3:number:7",requestNonce:"request-instance"}};
await handle(event);
assert.ok(events.some(entry=>entry[0]==="focus"),"body click navigates and focuses request without attempting approval");
assert.equal(events.filter(entry=>entry[0]==="respond").length,0);
events.length=0; await handle({...event,action:"approve"});
assert.equal(events.filter(entry=>entry[0]==="respond").length,1);
assert.equal(events.find(entry=>entry[0]==="respond")[3].decision,"accept");
events.length=0;context.pendingRequestsRef.current=[{...approval,notificationNonce:"new-instance"}];
await handle({...event,action:"approve"});
assert.equal(events.filter(entry=>entry[0]==="respond").length,0,"old notification cannot approve a reused request id in the same connection");
events.length=0;context.pendingRequestsRef.current=[];await handle({...event,action:"approve"});
assert.equal(events.filter(entry=>entry[0]==="respond").length,0,"resolved request is never approved");
events.length=0;context.notificationAccountRef.current="new-epoch";await handle(event);
assert.equal(events.length,0,"old account payload cannot navigate or approve");
context.notificationAccountRef.current="epoch";
context.selectThread=async()=>{context.notificationAccountRef.current="new-epoch";};
await handle({...event,action:"approve"});assert.equal(events.length,0,"account switch during navigation invalidates action");
console.log("Notification delivery: actual native click/open routing, current request/action vocabulary, account epoch and late resolution passed");

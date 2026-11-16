import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const view=()=>({hostId:"local",server:"private_settings",pluginId:"one",title:"真实设置",readTool:"read",updateTool:"update",tools:[{name:"read",inputSchema:{type:"object"}},{name:"update",inputSchema:{type:"object"}}]});
function harness(handler){const calls=[],warnings=[],exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/pluginSettingsRuntime.ts","utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,console:{warn:(...args)=>warnings.push(args)},require:name=>{assert.equal(name,"./bridge");return{callAppServer:async(method,params)=>{calls.push([method,params]);return handler?handler(method,params,calls):method==="thread/start"?{thread:{id:"private-thread",ephemeral:true}}:{content:[],structuredContent:{values:{enabled:true}}};}};}});return{calls,warnings,acquire:exports.acquirePluginSettingsRuntime};}
const tick=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
{
 const h=harness(),first=h.acquire("account-session-A",view()),second=h.acquire("account-session-A",{...view(),server:"other",tools:[{name:"read"},{name:"update"}]});
 assert.equal(h.calls.length,0,"acquire does not start a model or ephemeral context before a tool call");
 await Promise.all([first.call("read",{}),second.call("read",{})]);
 assert.equal(h.calls.filter(([m])=>m==="thread/start").length,1,"same host/identity shares creation");
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0][1])),{ephemeral:true,permissions:":read-only",threadSource:"mcp_extension_host"});
 assert.deepEqual(h.calls.filter(([m])=>m==="mcpServer/tool/call").map(([,p])=>[p.server,p.threadId,p.tool]).sort((a,b)=>a[0].localeCompare(b[0])),[["other","private-thread","read"],["private_settings","private-thread","read"]]);
 first.dispose();first.dispose();await tick();assert.equal(h.calls.filter(([m])=>m==="thread/unsubscribe").length,0,"another lease still uses context");
 await assert.rejects(()=>first.call("update",{set:{enabled:false}}),/关闭/);
 second.dispose();await tick();assert.equal(h.calls.filter(([m])=>m==="thread/unsubscribe").length,1);
 assert.equal(h.calls.at(-1)[1].threadId,"private-thread");
}
{
 const created=defer(),h=harness(method=>method==="thread/start"?created.promise:{}),lease=h.acquire("session",view());
 const call=lease.call("read",{});lease.dispose();created.resolve({thread:{id:"late",ephemeral:true}});await assert.rejects(()=>call,/关闭/);await tick();
 assert.equal(h.calls.filter(([m])=>m==="mcpServer/tool/call").length,0,"disposed startup never dispatches a tool");
 assert.equal(h.calls.filter(([m])=>m==="thread/unsubscribe").length,1,"late created real ID is released");
}
{
 const result=defer(),h=harness(method=>method==="thread/start"?{thread:{id:"busy",ephemeral:true}}:method==="mcpServer/tool/call"?result.promise:{}),lease=h.acquire("session",view());
 const call=lease.call("update",{set:{enabled:false}});await tick();lease.dispose();await tick();assert.equal(h.calls.filter(([m])=>m==="thread/unsubscribe").length,0,"retire waits for in-flight tool");
 result.resolve({content:[],isError:false});await assert.rejects(()=>call,/关闭/);await tick();assert.equal(h.calls.filter(([m])=>m==="thread/unsubscribe").length,1);
}
{
 const h=harness(),a=h.acquire("A",view()),b=h.acquire("B",view());await a.call("read",{});await b.call("read",{});assert.equal(h.calls.filter(([m])=>m==="thread/start").length,2,"different connection/account identities never share a context");a.dispose();b.dispose();await tick();
}
{
 const h=harness();assert.throws(()=>h.acquire("session",{...view(),hostId:"remote"}),/本机/);assert.throws(()=>h.acquire("session",{...view(),server:"codex_apps"}),/普通/);assert.throws(()=>h.acquire(" ",view()),/身份/);
 const lease=h.acquire("session",view());await assert.rejects(()=>lease.call("not-declared",{}),/工具/);assert.equal(h.calls.length,0,"no context created for untrusted tool");lease.dispose();
 const blocked=h.acquire("session",{...view(),tools:[{name:"read",_meta:{"openai/fileParams":false}},{name:"update"}]});await assert.rejects(()=>blocked.call("read",{}),/文件参数/);assert.equal(h.calls.length,0,"presence of file metadata blocks even false/null");blocked.dispose();
}
{
 const h=harness(method=>{if(method==="thread/start")return{thread:{id:"one",ephemeral:true}};if(method==="mcpServer/tool/call")throw Error("Transport closed");return{};}),lease=h.acquire("session",view());
 await assert.rejects(()=>lease.call("update",{set:{enabled:false}}),/Transport closed/);assert.equal(h.calls.filter(([m])=>m==="mcpServer/tool/call").length,1,"write failure is not automatically replayed");assert.equal(h.calls.filter(([m])=>m.includes("reload")).length,0,"no invented recovery RPC");lease.dispose();await tick();
}
{
 let starts=0;const h=harness(method=>{if(method==="thread/start"){if(++starts===1)throw Error("startup failed");return{thread:{id:"recovered",ephemeral:true}};}return{content:[],isError:true};}),lease=h.acquire("session",view());
 await assert.rejects(()=>lease.call("read",{}),/startup failed/);assert.equal(h.calls.length,1);const response=await lease.call("read",{});assert.equal(response.isError,true,"tool-level errors remain truthful raw response for caller parser");lease.dispose();await tick();assert.equal(h.calls.filter(([m])=>m==="thread/start").length,2,"only explicit next action retries failed creation");
}
{
 const h=harness(method=>method==="thread/start"?{thread:{id:"cleanup",ephemeral:true}}:method==="thread/unsubscribe"?Promise.reject(Error("release failed")):{content:[]});const lease=h.acquire("session",view());await lease.call("read",{});lease.dispose();await tick();assert.equal(h.warnings.length,1,"cleanup failure is observed rather than an unhandled rejection");
}
{
 const h=harness(method=>method==="thread/start"?{thread:{id:"unexpected-normal",ephemeral:false}}:{}),lease=h.acquire("session",view());
 await assert.rejects(()=>lease.call("read",{}),/临时会话响应无效/);await tick();
 assert.equal(h.calls.filter(([m])=>m==="mcpServer/tool/call").length,0);
 assert.equal(h.calls.filter(([m])=>m==="thread/unsubscribe").length,1,"bad startup response with a real ID still releases the created subscription");
 await assert.rejects(()=>lease.call("read",{}),/关闭/);lease.dispose();
}
{
 const startup=defer();let starts=0;const h=harness(method=>method==="thread/start"?(++starts===1?startup.promise:{thread:{id:"fresh",ephemeral:true}}):{content:[]});
 const old=h.acquire("session",view()),pending=old.call("read",{});old.dispose();const fresh=h.acquire("session",view());await fresh.call("read",{});
 startup.resolve({thread:{id:"retired",ephemeral:true}});await assert.rejects(()=>pending,/关闭/);await tick();
 assert.equal(h.calls.filter(([m,p])=>m==="mcpServer/tool/call"&&p.threadId==="retired").length,0);
 assert.equal(h.calls.filter(([m,p])=>m==="thread/unsubscribe"&&p.threadId==="retired").length,1);
 await fresh.call("read",{});fresh.dispose();await tick();
 assert.equal(h.calls.filter(([m,p])=>m==="mcpServer/tool/call"&&p.threadId==="fresh").length,2,"retired late arrival cannot delete or pollute replacement context");
}
console.log("Plugin settings runtime: exact ephemeral parameters, shared scoped leases, late/in-flight release, trusted tools, no automatic write replay and cleanup failures passed.");

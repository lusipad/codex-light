// Real isolated MCP structured settings protocol: no account, network service or model turn.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-plugin-settings-"));
const evidence = path.join(".ref/parity/12/whole-page/actual/plugin-settings-r2-20261116/runtime-protocol", `${Date.now()}-${process.pid}`);
fs.mkdirSync(evidence, { recursive: true });
const fixture = path.join(home, "fixture.cjs"), state = path.join(home, "settings.json");
fs.writeFileSync(state, JSON.stringify({enabled:true,label:"私有设置",count:2}));
fs.writeFileSync(fixture, `const fs=require("node:fs"),readline=require("node:readline"),state=process.argv[2];
const tools=[{name:"read_settings",inputSchema:{type:"object",properties:{}},annotations:{readOnlyHint:true}},{name:"update_settings",inputSchema:{type:"object",properties:{set:{type:"object"}},required:["set"]},annotations:{readOnlyHint:false}}];
const schema={type:"object",properties:{enabled:{type:"boolean",title:"开关"},label:{type:"string",title:"文本",minLength:1},count:{type:"integer",title:"数量",minimum:0,maximum:5}}};
readline.createInterface({input:process.stdin}).on("line",line=>{let q=JSON.parse(line);if(q.id==null)return;let result={};
if(q.method==="initialize")result={protocolVersion:"2024-11-05",capabilities:{tools:{},extensions:{"openai/settings":{readTool:"read_settings",updateTool:"update_settings"}}},serverInfo:{name:"structured-fixture",version:"1"}};
else if(q.method==="tools/list")result={tools};
else if(q.method==="resources/list")result={resources:[]};
else if(q.method==="resources/templates/list")result={resourceTemplates:[]};
else if(q.method==="tools/call"){let values=JSON.parse(fs.readFileSync(state,"utf8"));
if(q.params.name==="read_settings")result={content:[],structuredContent:{schema,values,layout:[{kind:"group",title:"基础",items:[{kind:"property",property:"enabled"}]}]}};
else if(q.params.name==="update_settings"){const changes=q.params.arguments?.set;if(!changes||Array.isArray(changes)||Object.keys(changes).length!==1||Object.keys(changes).some(k=>!Object.hasOwn(values,k)))result={isError:true,content:[{type:"text",text:"Invalid private update"}]};else {values={...values,...changes};fs.writeFileSync(state,JSON.stringify(values));result={content:[],structuredContent:{values}};}}
else result={isError:true,content:[{type:"text",text:"Unknown private tool"}]};}
process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:q.id,result})+"\\n");});`);
fs.writeFileSync(path.join(home,"config.toml"), `[mcp_servers.structured_fixture]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(fixture)}, ${JSON.stringify(state)}]\n`);
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const options={shell:binary.endsWith(".cmd"),windowsHide:true,cwd:home,env:{...process.env,CODEX_HOME:home,OPENAI_API_KEY:"",CODEX_API_KEY:"",CHATGPT_BASE_URL:"",OPENAI_BASE_URL:""}};
const version=spawnSync(binary,["--version"],{...options,encoding:"utf8"});
const calls=[],notifications=[],pending=new Map();let child,buffer="",stderr="",failure=null,nextId=0,threadId=null;
async function rpc(method,params){
  assert.ok(["initialize","mcpServerStatus/list","thread/start","mcpServer/tool/call","thread/unsubscribe"].includes(method),"isolated methods only; no model turns");
  const id=++nextId,entry={id,method,params};calls.push(entry);let timer;
  try { const response=await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error(`${method} timed out`)),30000);pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n");});entry.response=response;assert.equal(response.error,undefined,`${method}: ${JSON.stringify(response.error)}`);return response.result; }
  catch(error){entry.error=String(error);throw error;}finally{clearTimeout(timer);pending.delete(id);}
}
try {
  assert.equal(version.status,0,version.stderr);
  child=spawn(binary,["app-server","--listen","stdio://"],{...options,stdio:["pipe","pipe","pipe"]});
  child.stderr.on("data",data=>{stderr+=data;});child.stdout.setEncoding("utf8");
  child.stdout.on("data",data=>{buffer+=data;let end;while((end=buffer.indexOf("\n"))>=0){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(!line)continue;try{let message=JSON.parse(line);if(message.id!=null&&pending.has(message.id))pending.get(message.id).resolve(message);else notifications.push(message);}catch(error){for(const item of pending.values())item.reject(error);}}});
  child.on("error",error=>{for(const item of pending.values())item.reject(error);});child.on("exit",()=>{for(const item of pending.values())item.reject(Error("private app-server exited"));});
  await rpc("initialize",{clientInfo:{name:"codex-native-plugin-settings-probe",version:"0.2.0"},capabilities:{experimentalApi:true}});
  const status=await rpc("mcpServerStatus/list",{serverName:"structured_fixture",detail:"full",cursor:null,limit:100});
  const actual=status.data.find(row=>row.name==="structured_fixture");assert.ok(actual);assert.equal(actual.serverCapabilities.extensions["openai/settings"].readTool,"read_settings");assert.ok(actual.tools.read_settings);assert.ok(actual.tools.update_settings);
  const created=await rpc("thread/start",{ephemeral:true,permissions:":read-only",threadSource:"mcp_extension_host"});threadId=created.thread.id;assert.equal(created.thread.ephemeral,true);assert.ok(threadId);
  const call=(tool,args)=>rpc("mcpServer/tool/call",{server:"structured_fixture",threadId,tool,arguments:args});
  const before=await call("read_settings",{});assert.equal(before.isError??false,false);assert.equal(before.structuredContent.schema.properties.enabled.type,"boolean");assert.equal(before.structuredContent.values.enabled,true);
  const written=await call("update_settings",{set:{enabled:false}});assert.equal(written.isError??false,false);assert.equal(written.structuredContent.values.enabled,false);
  const after=await call("read_settings",{});assert.equal(after.structuredContent.values.enabled,false);assert.equal(after.structuredContent.values.label,"私有设置");assert.equal(JSON.parse(fs.readFileSync(state,"utf8")).enabled,false);
  const rejected=await call("update_settings",{set:{unknown:true}});assert.equal(rejected.isError,true);
  const recovered=await call("read_settings",{});assert.equal(recovered.structuredContent.values.enabled,false);assert.equal(Object.hasOwn(recovered.structuredContent.values,"unknown"),false);
  await rpc("thread/unsubscribe",{threadId});threadId=null;
  console.log(`PASS ${version.stdout.trim()} exact official ephemeral permissions/threadSource, advertised structured settings, actual update/readback, failure/readback and unsubscribe; zero model turns.`);
} catch(error){failure=String(error);process.exitCode=1;console.error(error);}finally{
  if(threadId&&child?.exitCode==null){try{await rpc("thread/unsubscribe",{threadId});}catch(error){stderr+=`\ncleanup: ${error}`;}}
  if(child && child.exitCode==null)await new Promise(resolve=>{let timer=setTimeout(()=>{child.kill();resolve();},3000);child.once("exit",()=>{clearTimeout(timer);resolve();});child.stdin.end();});
  fs.writeFileSync(path.join(evidence,"result.json"),JSON.stringify({binary,binarySha256:fs.existsSync(binary)?crypto.createHash("sha256").update(fs.readFileSync(binary)).digest("hex"):null,version:version.stdout.trim(),versionStatus:version.status,isolatedHome:home,calls,notifications,stderr,failure,modelTurns:0,externalServices:0,exactOfficialStart:{ephemeral:true,permissions:":read-only",threadSource:"mcp_extension_host"}},null,2));
  console.log(`Evidence: ${evidence}`);
}

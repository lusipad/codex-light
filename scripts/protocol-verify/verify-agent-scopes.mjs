// Read-only discovery in an isolated CODEX_HOME; never authenticates or creates a turn.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-agent-scope-"));
const project = path.join(home, "project");
fs.mkdirSync(path.join(project,".codex"),{recursive:true});
assert.equal(spawnSync("git",["init",project],{windowsHide:true}).status,0);
const projectFile=path.join(project,".codex","config.toml");
fs.writeFileSync(projectFile,'# Keep project heading\nmodel_verbosity = "low" # keep value note\n\n[sandbox_workspace_write]\n# Keep network heading\nnetwork_access = false\n');
fs.writeFileSync(path.join(home,"config.toml"),'# Keep global heading\nmodel_verbosity = "high"\n\n[projects.'+JSON.stringify(project.toLowerCase())+']\ntrust_level = "trusted"\n');
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const options = {
  shell: binary.endsWith(".cmd"), windowsHide: true,
  env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" },
};
const version = spawnSync(binary, ["--version"], { ...options, encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
const child = spawn(binary, ["app-server", "--listen", "stdio://"], { ...options, stdio: ["pipe", "pipe", "pipe"] });
const pending = new Map(), calls = [];
let nextId = 0, buffer = "", errorOutput = "", failure = null;
child.stderr.on("data", data => { errorOutput = (errorOutput + data).slice(-4000); });
child.stdout.setEncoding("utf8");
child.stdout.on("data", data => {
  buffer += data;
  let end;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id != null) pending.get(message.id)?.resolve(message);
  }
});
child.on("error", error => { for (const item of pending.values()) item.reject(error); });
child.on("exit", () => { for (const item of pending.values()) item.reject(Error("app-server exited before response")); });
async function rpc(method, params) {
  assert.ok(["initialize", "config/read", "configRequirements/read", "config/batchWrite", "config/value/write"].includes(method), "probe is restricted to isolated config verification");
  const id = ++nextId;
  let timer;
  try {
    const response = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error(`${method} timeout`)), 20000);
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
    calls.push({ method, params, response });
    assert.equal(response.error, undefined, `${method}: ${JSON.stringify(response.error)}`);
    return response.result;
  } finally { clearTimeout(timer); pending.delete(id); }
}
try {
  await rpc("initialize",{clientInfo:{name:"codex-agent-scope-probe",version:"0.1.0"},capabilities:{experimentalApi:true}});
  const read=()=>rpc('config/read',{includeLayers:true,cwd:project});
  const snapshot=await read();
  const layer=snapshot.layers.find(layer=>layer.name.type==='project');
  assert.ok(layer,'trusted project layer must exist');
  assert.ok(!layer.disabledReason,'test project must be enabled');
  assert.equal(snapshot.config.model_verbosity,'low');
  const projectBefore=fs.readFileSync(projectFile,'utf8');
  await assert.rejects(()=>rpc('config/value/write',{keyPath:'model_verbosity',value:'medium',mergeStrategy:'upsert',filePath:projectFile,expectedVersion:layer.version}),/configLayerReadonly/);
  assert.equal(fs.readFileSync(projectFile,'utf8'),projectBefore,'rejected project RPC leaves file unchanged');
  const user=snapshot.layers.find(layer=>layer.name.type==='user');
  let revision=user.version;
  const edits=[['model_verbosity','medium'],['sandbox_workspace_write.network_access',true],['model_reasoning_summary','concise'],['web_search','indexed'],['approval_policy','on-request'],['sandbox_mode','workspace-write']];
  for(const [keyPath,value] of edits){
    await rpc('config/value/write',{keyPath,value,mergeStrategy:'upsert',filePath:user.name.file,expectedVersion:revision,reloadUserConfig:true});
    const updated=await read(),saved=updated.layers.find(layer=>layer.name.type==='user');
    revision=saved.version;
    const current=keyPath.split('.').reduce((v,key)=>v?.[key],saved.config);assert.equal(current,value);
  }
  await assert.rejects(()=>rpc('config/value/write',{keyPath:'model_verbosity',value:'high',mergeStrategy:'upsert',filePath:user.name.file,expectedVersion:user.version}),/version|conflict|changed/i);
  const inherited=await read();assert.equal(inherited.config.model_verbosity,'low','project remains separate from the saved user value');
  const disk=fs.readFileSync(user.name.file,'utf8');assert.match(disk,/# Keep global heading/);
  await rpc('config/value/write',{keyPath:'model_verbosity',value:null,mergeStrategy:'replace',filePath:user.name.file,expectedVersion:revision,reloadUserConfig:true});
  const cleared=await read();assert.equal(cleared.layers.find(layer=>layer.name.type==='user').config.model_verbosity,undefined);
  fs.unlinkSync(projectFile);const withoutFile=await read();
  assert.equal(withoutFile.layers.find(layer=>layer.name.type==='project')?.config.model_verbosity,undefined);
  console.log('PASS real scoped config: trusted project precedence and explicit project RPC rejection without file change; six user settings including nested network/summary/indexed, comment preservation, stale CAS rejection, null deletion, missing project layer observation; zero model turns');
} catch(error){failure=String(error);process.exitCode=1;console.error(error);}
finally{
 if(child.exitCode==null)await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},3000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.stdin.end();});
 const directory='.ref/parity/16.06/actual/16-06B/protocol';fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,'protocol-agent-scopes.json'),JSON.stringify({version:version.stdout.trim(),isolatedHome:home,project,modelTurns:0,calls,failure,errorOutput},null,2));
}

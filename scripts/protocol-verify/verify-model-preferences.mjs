// Writes only isolated temporary configuration; never authenticates or creates a turn.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-model-preferences-"));
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const options = {
  shell: binary.endsWith(".cmd"), windowsHide: true,
  env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" },
};
const version = spawnSync(binary, ["--version"], { ...options, encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
let child;
const observations = [], notifications = [];
const pending = new Map(), calls = [];
let nextId = 0, buffer = "", errorOutput = "", failure = null;
function launch() {
  buffer = "";
  child = spawn(binary, ["app-server", "--listen", "stdio://"], { ...options, stdio: ["pipe", "pipe", "pipe"] });
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
    else notifications.push(message);
  }
});
child.on("error", error => { for (const item of pending.values()) item.reject(error); });
child.on("exit", () => { for (const item of pending.values()) item.reject(Error("app-server exited before response")); });
}
async function stop() {
  if (!child || child.exitCode != null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve(); }, 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.stdin.end();
  });
}
async function initialize() {
  launch();
  await rpc("initialize", {clientInfo:{name:"codex-native-model-preferences-probe",version:"0.1.0"},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({jsonrpc:"2.0",method:"initialized",params:{}})+"\n");
}
async function rpc(method, params) {
  assert.ok(["initialize", "config/read", "configRequirements/read", "config/batchWrite", "thread/start", "thread/settings/update", "thread/resume", "thread/read", "thread/delete", "thread/inject_items"].includes(method), "probe is restricted to isolated config verification");
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
  await initialize();
  const read=()=>rpc("config/read",{includeLayers:true});
  const before=await read();
  const user=snapshot=>snapshot.layers.find(layer=>layer.name.type==='user'&&!layer.name.profile);
  const original=user(before);
  assert.ok(path.resolve(original.name.file).startsWith(path.resolve(home)+path.sep));
  const write=(edits,layer)=>rpc('config/batchWrite',{edits:Object.entries(edits).map(([keyPath,value])=>({keyPath,value,mergeStrategy:'replace'})),filePath:layer.name.file,expectedVersion:layer.version,reloadUserConfig:true});
  const requirements=await rpc('configRequirements/read',{});
  assert.equal((await write({model:'probe-model',model_reasoning_effort:'high',service_tier:'priority'},original)).status,'ok');
  const root=await read();assert.equal(root.config.model,'probe-model');assert.equal(root.config.model_reasoning_effort,'high');assert.equal(root.config.service_tier,'priority');
  await assert.rejects(()=>write({model:'stale-model'},original));
  await assert.rejects(()=>write({'profile':'probe'},user(root)),/legacy config selector/);
  await assert.rejects(()=>write({'profiles.probe.model':'profile-model'},user(root)),/configValidationError/);
  const profile=await read();
  const recent=[{model:'profile-model',reasoningEffort:'medium',serviceTier:null}];
  await assert.rejects(()=>write({'desktop.composer-recent-model-configurations-v1':recent},user(profile)),/valid TOML value/);
  await write({service_tier:'default'},user(profile));
  const standard=await read();assert.equal(standard.config.service_tier,'default');
  await write({model:null,model_reasoning_effort:null,service_tier:null},user(standard));
  const final=await read(); assert.equal(final.config.model,null); assert.equal(final.config.model_reasoning_effort,null); assert.equal(final.config.service_tier,null);
  const thread=await rpc('thread/start',{cwd:home,model:'probe-model'});
  const threadId=thread.thread.id;
  await rpc('thread/settings/update',{threadId,model:'changed-model',effort:'high',serviceTier:'priority'});
  await assert.rejects(()=>rpc('thread/resume',{threadId}),/no rollout found/);
  await rpc('thread/settings/update',{threadId,serviceTier:null});
  const metadata=await rpc('thread/read',{threadId,includeTurns:false}); assert.equal(metadata.thread.id,threadId); assert.equal(metadata.thread.model,'changed-model'); assert.equal(metadata.thread.reasoningEffort,'high');
  // Offline fixture materializes a rollout; no assistant or model execution is requested.
  await rpc('thread/inject_items',{threadId,items:[{type:'message',role:'user',content:[{type:'input_text',text:'Offline model preference persistence probe fixture. No model execution.'}]}]});
  const sample=(phase,result,expected)=>{
    const actual={model:result.model,reasoningEffort:result.reasoningEffort,serviceTier:result.serviceTier};
    observations.push({phase,actual,expected,matchesExpected:JSON.stringify(actual)===JSON.stringify(expected)});
    assert.equal(actual.model,expected.model);
    assert.equal(actual.reasoningEffort,expected.reasoningEffort);
    return actual;
  };
  for(const tier of ['priority','fast','default',null]) {
    await rpc('thread/settings/update',{threadId,model:'persisted-probe-model',effort:'medium',serviceTier:tier});
    const expected={model:'persisted-probe-model',reasoningEffort:'medium',serviceTier:tier};
    sample('live-resume-'+String(tier),await rpc('thread/resume',{threadId}),expected);
    await stop();await initialize();
    sample('cold-resume-'+String(tier),await rpc('thread/resume',{threadId}),expected);
  }
  assert.ok(!notifications.some(event=>event.method==='turn/started'),'probe must not request or observe model turns');
  assert.doesNotMatch(fs.readFileSync(original.name.file,'utf8'),/probe-model/);
  console.log('PASS isolated model preferences: root config, user version CAS, null key deletion, legacy profile and nested-null TOML refusal, thread settings model/effort readback and tier live/cold resume observations with offline-injected rollout; empty thread resume unavailable; zero model turns');
} catch (error) {
  failure = String(error); process.exitCode = 1; console.error(error);
} finally {
  await stop();
  const directory = ".ref/parity/16.05/actual/16-05B/protocol";
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "protocol-model-preferences.json"), JSON.stringify({
    version: version.stdout.trim(), isolatedHome: home, calls, observations, notifications, fixtureKind:"offline-injected-context-no-model-turn", failure, errorOutput, modelTurns: 0,
  }, null, 2));
}

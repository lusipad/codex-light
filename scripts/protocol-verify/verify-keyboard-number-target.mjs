// Writes only isolated temporary configuration; never authenticates or creates a turn.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-keyboard-number-target-"));
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
  assert.ok(["initialize", "config/read", "configRequirements/read", "config/batchWrite"].includes(method), "probe is restricted to isolated config verification");
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
  await rpc("initialize", {clientInfo:{name:"codex-native-number-target-probe",version:"0.1.0"},capabilities:{experimentalApi:true}});
  const read=()=>rpc("config/read",{includeLayers:true});
  const before=await read();
  const user=snapshot=>snapshot.layers.find(layer=>layer.name.type==='user'&&!layer.name.profile);
  const original=user(before);
  assert.ok(path.resolve(original.name.file).startsWith(path.resolve(home)+path.sep));
  const write=(value,layer)=>rpc('config/batchWrite',{edits:[{keyPath:'desktop.primary-number-shortcut-target',value,mergeStrategy:'replace'}],filePath:layer.name.file,expectedVersion:layer.version,reloadUserConfig:true});
  assert.equal((await write('sidebar',original)).status,'ok');
  const sidebar=await read();assert.equal(sidebar.config.desktop['primary-number-shortcut-target'],'sidebar');
  assert.equal((await write('tabs',user(sidebar))).status,'ok');
  const tabs=await read();assert.equal(tabs.config.desktop['primary-number-shortcut-target'],'tabs');
  await assert.rejects(()=>write('sidebar',original));
  assert.equal((await read()).config.desktop['primary-number-shortcut-target'],'tabs');
  assert.match(fs.readFileSync(original.name.file,'utf8'),/primary-number-shortcut-target\s*=\s*"tabs"/);
  console.log('PASS real isolated desktop number target: tabs/sidebar write and readback, explicit user layer/version, stale update rejected, disk content; zero model turns');
} catch (error) {
  failure = String(error); process.exitCode = 1; console.error(error);
} finally {
  if (child.exitCode == null) await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve(); }, 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.stdin.end();
  });
  const directory = ".ref/parity/16.03/actual/16-03B/protocol";
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "protocol-keyboard-number-target.json"), JSON.stringify({
    version: version.stdout.trim(), isolatedHome: home, calls, failure, errorOutput, modelTurns: 0,
  }, null, 2));
}

// Writes only isolated temporary configuration; never authenticates or creates a turn.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-appearance-preferences-"));
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
  await rpc("initialize", {
    clientInfo: { name: "codex-native-appearance-preferences-probe", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  const read = () => rpc("config/read", { includeLayers: true });
  const before = await read();
  const user = before.layers.find(layer => layer.name.type === "user" && !layer.name.profile);
  assert.ok(user?.name.file && user.version);
  assert.ok(path.resolve(user.name.file).startsWith(path.resolve(home) + path.sep));
  const requirements = await rpc("configRequirements/read", {});
  const edit = { keyPath: "desktop.appearanceTheme", value: "dark", mergeStrategy: "replace" };
  const written = await rpc("config/batchWrite", { edits: [edit], filePath: user.name.file, expectedVersion: user.version, reloadUserConfig: true });
  assert.equal(written.status, "ok");
  const after = await read();
  assert.equal(after.config.desktop.appearanceTheme, "dark");
  const theme = {accent:'#339cff',accentSource:'custom',contrast:60,fonts:{code:null,ui:null},ink:'#ffffff',opaqueWindows:false,semanticColors:{diffAdded:'#112233',diffRemoved:'#445566',skill:'#778899'},surface:'#181818'};
  const extra = {appearanceLightChromeTheme:theme, appearanceDarkChromeTheme:theme, appearanceLightCodeThemeId:'codex',appearanceDarkCodeThemeId:'codex',sansFontSize:15,codeFontSize:13,'reduced-motion-preference':'on'};
  const currentUser = after.layers.find(layer => layer.name.type === 'user' && !layer.name.profile);
  await assert.rejects(()=>rpc('config/batchWrite',{edits:[{keyPath:'desktop.appearanceDarkChromeTheme',value:theme,mergeStrategy:'replace'}],filePath:currentUser.name.file,expectedVersion:currentUser.version,reloadUserConfig:true}), /configValidationError/);
  const batch = await rpc('config/batchWrite',{edits:Object.entries(extra).map(([key,value])=>({keyPath:'desktop.'+key,value:JSON.parse(JSON.stringify(value,(_key,v)=>v===null?undefined:v)),mergeStrategy:'replace'})),filePath:currentUser.name.file,expectedVersion:currentUser.version,reloadUserConfig:true});
  assert.equal(batch.status,'ok');
  const themeRead = await read();
  for(const [key,value] of Object.entries(extra)) assert.deepEqual(themeRead.config.desktop[key],JSON.parse(JSON.stringify(value,(_key,v)=>v===null?undefined:v)));
  const afterUser = themeRead.layers.find(layer => layer.name.type === "user" && !layer.name.profile);
  assert.equal(afterUser.config.desktop.appearanceTheme, "dark");
  assert.notEqual(afterUser.version, user.version);
  await assert.rejects(() => rpc("config/batchWrite", { edits: [{ ...edit, value: "light" }], filePath: user.name.file, expectedVersion: user.version, reloadUserConfig: true }));
  assert.equal((await read()).config.desktop.appearanceTheme, "dark");
  await rpc("config/batchWrite", { edits: [{ ...edit, value: null }], filePath: user.name.file, expectedVersion: afterUser.version, reloadUserConfig: true });
  const cleared = await read();
  assert.equal(cleared.layers.find(layer => layer.name.type === "user" && !layer.name.profile).config.desktop?.appearanceTheme, undefined);
  console.log("PASS real config: all eight desktop keys, nested theme null conversion, user layer/version, write/readback, stale version rejection and null removal; zero model turns");
} catch (error) {
  failure = String(error); process.exitCode = 1; console.error(error);
} finally {
  if (child.exitCode == null) await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve(); }, 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.stdin.end();
  });
  const directory = ".ref/parity/16.02/actual/16-02B/protocol";
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "protocol-appearance-preferences.json"), JSON.stringify({
    version: version.stdout.trim(), isolatedHome: home, calls, failure, errorOutput, modelTurns: 0,
  }, null, 2));
}

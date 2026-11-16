// Real detail metadata, installed skill ownership and logo bytes in a private CODEX_HOME; zero model turns.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-plugin-detail-r2c-"));
const home = path.join(directory, "home"), workspace = path.join(directory, "workspace"), market = path.join(directory, "market");
const marketplacePath = path.join(market, ".agents", "plugins", "marketplace.json");
const marketplaceName = "private-detail-market";
const names = ["detail-ready", "detail-available"];
for (const location of [home, workspace, path.dirname(marketplacePath)]) fs.mkdirSync(location, { recursive: true });
for (const name of names) {
  const root = path.join(market, "plugins", name);
  fs.mkdirSync(path.join(root, ".codex-plugin"), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'inspect'), {recursive:true});
  fs.mkdirSync(path.join(root, 'assets'), {recursive:true});
  fs.writeFileSync(path.join(root,'assets','logo.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jgAAAAABJRU5ErkJggg==','base64'));
  fs.writeFileSync(path.join(root,'skills','inspect','SKILL.md'),'---\nname: inspect\ndescription: Private read-only preview fixture\n---\n\n# Private skill\n\nRead this private fixture only.\n');
  fs.writeFileSync(path.join(root, '.codex-plugin', 'plugin.json'), JSON.stringify({name,version:'1.0.0',description:'Private detail fixture',skills:'./skills/',interface:{displayName:name==='detail-ready'?'详情就绪测试':'详情未装测试',shortDescription:'私有测试插件，仅用于界面与草稿验证',longDescription:Array.from({length:28},(_,i)=>'第 '+(i+1)+' 段：这是私有插件的真实说明，供展开、收起与长内容布局检查。').join('\n\n'),developerName:'Private Fixture',category:'Productivity',capabilities:['Read','Draft'],websiteURL:'https://example.test/',privacyPolicyURL:'https://example.test/privacy',termsOfServiceURL:'https://example.test/terms',logo:'./assets/logo.png',defaultPrompt:['检查当前项目，先列出计划；不要执行任何修改。','仅整理当前项目的问题清单。']}}));
}
fs.writeFileSync(marketplacePath, JSON.stringify({ name: marketplaceName, owner: { name: "Local fixture" }, plugins: names.map(name => ({ name, source: { source: "local", path: `./plugins/${name}` } })) }));
const configFile = path.join(home, "config.toml");
fs.writeFileSync(configFile, '# Private fixture heading\n[plugins.sibling]\nenabled = false\nunknown_fixture = "preserve"\n');
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const options = { cwd: workspace, shell: binary.endsWith(".cmd"), windowsHide: true, env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" } };
const version = spawnSync(binary, ["--version"], { ...options, encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
const child = spawn(binary, ["app-server", "--listen", "stdio://"], { ...options, stdio: ["pipe", "pipe", "pipe"] });
let nextId = 0, buffer = "", stderr = "";
const pending = new Map();
child.stderr.on("data", data => { stderr = (stderr + data).slice(-6000); });
child.stdout.setEncoding("utf8");
child.stdout.on("data", data => {
  buffer += data; let end;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1); if (!line) continue;
    let message; try { message = JSON.parse(line); } catch { continue; }
    if (message.id != null) pending.get(message.id)?.resolve(message);
  }
});
child.on("error", error => { for (const item of pending.values()) item.reject(error); });
child.on("exit", () => { for (const item of pending.values()) item.reject(Error("server exited")); });
async function rpc(method, params) {
  assert.notEqual(method, "turn/start");
  const id = ++nextId; let timer;
  try {
    const response = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error(`${method} timed out`)), 20000);
      pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
    assert.equal(response.error, undefined, `${method}: ${JSON.stringify(response.error)}\n${stderr}`);
    return response.result;
  } finally { clearTimeout(timer); pending.delete(id); }
}

try {
 await rpc('initialize',{clientInfo:{name:'private-plugin-detail-capability',version:'0.1.0'},capabilities:{experimentalApi:true}});
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'initialized',params:{}})+'\n');
 await rpc('marketplace/add',{source:market});
 const read=await rpc('plugin/read',{pluginName:names[0],marketplacePath});
 assert.equal(read.plugin.summary.interface.displayName,'详情就绪测试');
 assert.equal(read.plugin.summary.interface.defaultPrompt.length,2);
 assert.ok(read.plugin.summary.interface.longDescription.includes('第 28 段'));
 assert.equal(read.plugin.skills.length,1);
 await rpc('plugin/install',{pluginName:names[0],marketplacePath,installAttemptId:'private-detail-fixture'});
 const installed=await rpc('plugin/installed',{cwds:[workspace]});
 const skillRows=await rpc('skills/list',{cwds:[workspace],forceReload:true});
 assert.ok(installed.marketplaces.flatMap(m=>m.plugins).some(p=>p.name===names[0]&&p.installed&&p.enabled));
 assert.ok(skillRows.data.flatMap(x=>x.skills).some(s=>s.name.includes('inspect')));
 fs.mkdirSync('.ref', {recursive:true});
 fs.writeFileSync('.ref/protocol-plugin-detail-verification.json',JSON.stringify({directory,home,workspace,market,marketplacePath,names,version:version.stdout.trim(),read,installed,skillRows,modelTurns:0},null,2));
 const image=await rpc('fs/readFile',{path:read.plugin.summary.interface.logo});
 assert.ok(Buffer.from(image.dataBase64,'base64').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
 const installedSkill=skillRows.data.flatMap(x=>x.skills).find(s=>s.name.includes('inspect'));
 const contents=await rpc('fs/readFile',{path:installedSkill.path});
 assert.ok(Buffer.from(contents.dataBase64,'base64').toString('utf8').includes('Read this private fixture only.'));
 console.log('PASS real private detail: interface/prompt/description, logo fs bytes, installed plugin and skill identity/content; zero model turns');
} finally {if(child.exitCode==null)await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill();resolve()},3000);child.once('exit',()=>{clearTimeout(timer);resolve()});child.stdin.end()});}

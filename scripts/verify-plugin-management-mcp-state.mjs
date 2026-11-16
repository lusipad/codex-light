import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const load = (file, imports = {}) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: name => { if (name in imports) return imports[name]; throw Error(`Unexpected import ${name}`); } });
  return exports;
};
const mapping = load("src/pluginManagementMcp.ts");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const plugin = () => ({ summary: { id:"tool@market",name:"tool",version:"1",availability:"AVAILABLE" }, apps:[],mcpServers:["mcp_One"] });
function harness(options = {}) {
  let slots=[],cursor=0,effects=[],scheduled=[],output,config={mcp_servers:{"actual.key":{name:"One",enabled:true}}};
  const calls=[], props={detail:plugin(),identity:"connection-A:market-A",cwd:"C:/first-root",onConfigUpdated:async()=>{calls.push(["updated"]);}};
  const react={
    useRef(value){const index=cursor++;return slots[index]??(slots[index]={current:value});},
    useState(value){const index=cursor++;if(!(index in slots))slots[index]=value;return[slots[index],next=>{slots[index]=typeof next==='function'?next(slots[index]):next;}];},
    useEffect(callback,deps){const index=cursor++,old=effects[index];if(!old||deps.some((value,i)=>value!==old.deps[i]))scheduled.push(()=>{old?.cleanup?.();effects[index]={deps,cleanup:callback()};});},
  };
  const api={
    read:async(cwd,layers)=>{calls.push(["read",cwd,layers]);return {config};},
    write:async(key,value,strategy)=>{calls.push(["write",key,value,strategy]);config={mcp_servers:{"actual.key":{name:"One",enabled:value}}};},
    apps:async()=>[],...options,
  };
  const {usePluginManagementMcp:hook}=load("src/pluginManagementMcpState.ts",{"react":react,"./config":{configRead:(...args)=>api.read(...args),configValueWrite:(...args)=>api.write(...args)},"./plugins":{listAllApps:(...args)=>api.apps(...args)},"./pluginManagementMcp":mapping});
  const render=()=>{cursor=0;output=hook(props.detail,props.identity,props.cwd,props.onConfigUpdated);for(const run of scheduled.splice(0))run();return output;};
  const tick=async()=>{for(let i=0;i<12;i++){await Promise.resolve();render();}};
  render();return {calls,props,api,render,tick,get state(){return output;},get config(){return config;},set config(value){config=value;},unmount(){for(const entry of effects)entry?.cleanup?.();}};
}
{
  const h=harness();await h.tick();
  assert.equal(h.state.snapshot.rows[0].configKey,"actual.key");
  assert.deepEqual(h.calls[0],["read","C:/first-root",true]);
  const gate=deferred(),original=h.api.write;
  h.api.write=async(...args)=>{await gate.promise;return original(...args);};
  const row=h.state.snapshot.rows[0];const pending=h.state.toggle(row,false);
  h.render();assert.equal(h.state.snapshot.rows[0].enabled,false,"optimistic visible state");
  assert.equal(h.state.snapshot.pending,"actual.key");
  await h.state.toggle(h.state.snapshot.rows[0],true);gate.resolve();await pending;await h.tick();
  assert.equal(h.calls.filter(item=>item[0]==="write").length,1,"single flight includes inverse repeated clicks");
  assert.deepEqual(h.calls.find(item=>item[0]==="write"),["write",'mcp_servers."actual.key".enabled',false,"upsert"]);
  assert.equal(h.state.snapshot.rows[0].enabled,false);assert.equal(h.state.snapshot.error,null);
  assert.equal(h.calls.filter(item=>item[0]==="updated").length,1);
  h.unmount();await h.state.toggle(h.state.snapshot.rows[0],true);assert.equal(h.calls.filter(item=>item[0]==="write").length,1);
}
{
  const h=harness();await h.tick();const baseRead=h.api.read,baseWrite=h.api.write;
  h.api.write=async(...args)=>{await baseWrite(...args);h.api.read=async()=>{throw Error("readback offline");};};
  await h.state.toggle(h.state.snapshot.rows[0],false);await h.tick();
  assert.equal(h.state.snapshot.uncertain,true);assert.match(h.state.snapshot.error,/无法确认配置结果/);
  await h.state.toggle(h.state.snapshot.rows[0],false);assert.equal(h.calls.filter(item=>item[0]==="write").length,1);
  h.api.read=baseRead;await h.state.retry();await h.tick();assert.equal(h.state.snapshot.rows[0].enabled,false);
  assert.equal(h.calls.filter(item=>item[0]==="write").length,1,"recovery only reads, never repeats the write");h.unmount();
}
{
  const h=harness({write:async()=>{throw Error("rejected");}});await h.tick();
  await h.state.toggle(h.state.snapshot.rows[0],false);await h.tick();assert.equal(h.state.snapshot.rows[0].enabled,true);assert.match(h.state.snapshot.error,/rejected/);h.unmount();
}
{
  const h=harness();await h.tick();const write=h.api.write;
  h.api.write=async(...args)=>{await write(...args);throw Error("response lost");};
  await h.state.toggle(h.state.snapshot.rows[0],false);await h.tick();assert.equal(h.state.snapshot.error,null,"actual readback confirms delivered write despite missing response");h.unmount();
}
{
  const h=harness();await h.tick();h.props.detail={...h.props.detail,summary:{...h.props.detail.summary,availability:"DISABLED_BY_ADMIN"}};h.render();await h.tick();
  await h.state.toggle(h.state.snapshot.rows[0],false);assert.equal(h.calls.filter(item=>item[0]==="write").length,0);h.unmount();
}
{
  const gate=deferred(),h=harness();await h.tick();const original=h.api.read;
  h.api.read=async()=>gate.promise;const stale=h.state.retry();
  h.props.identity="connection-B:market-B";h.props.cwd="C:/second-root";h.api.read=original;h.render();await h.tick();
  gate.resolve({config:{mcp_servers:{wrong:{name:"One",enabled:false}}}});await stale;await h.tick();
  assert.equal(h.state.snapshot.rows[0].configKey,"actual.key","late read cannot replace another context");
  const oldToggle=h.state.toggle,oldRow=h.state.snapshot.rows[0];h.props.identity="connection-A:market-A";h.render();await h.tick();await oldToggle(oldRow,false);
  assert.equal(h.calls.filter(item=>item[0]==="write").length,0,"stale action cannot write after scope change");h.unmount();
}
{
  const h=harness();await h.tick();h.props.detail={...h.props.detail,mcpServers:["missing"]};h.render();await h.tick();await h.state.toggle(h.state.snapshot.rows[0],false);
  assert.equal(h.calls.filter(item=>item[0]==="write").length,0,"unresolved declaration cannot create a config entry");h.unmount();
}
{
  const h=harness({apps:async()=>{throw Error("app service unavailable");}});await h.tick();
  assert.equal(h.state.snapshot.rows[0].configKey,"actual.key","application service failure retains real config fallback");
  assert.equal(h.state.snapshot.uncertain,false);assert.match(h.state.snapshot.error,/应用目录读取失败/);
  await h.state.toggle(h.state.snapshot.rows[0],false);await h.tick();assert.equal(h.state.snapshot.rows[0].enabled,false);h.unmount();
}
{
  const h=harness({apps:async()=>[{id:"connector_app",name:"One"}]});await h.tick();
  assert.equal(h.state.snapshot.rows[0].kind,"app","complete directory has priority even without a detail.apps declaration");
  await h.state.toggle(h.state.snapshot.rows[0],false);assert.equal(h.calls.filter(item=>item[0]==="write").length,0,"app mapping cannot write a generic config toggle");h.unmount();
}
{
  const gate=deferred(),h=harness({apps:async()=>gate.promise});await h.tick();
  assert.equal(h.state.snapshot.loading,false,"slow app directory must not block the independent local config read");
  assert.equal(h.state.snapshot.rows[0].configKey,"actual.key");
  await h.state.toggle(h.state.snapshot.rows[0],false);await h.tick();assert.equal(h.state.snapshot.rows[0].enabled,false);
  gate.resolve([{id:"connector_app",name:"One"}]);await h.tick();
  assert.equal(h.state.snapshot.rows[0].kind,"app","later app metadata remaps the existing declaration without repeating the config write");
  assert.equal(h.calls.filter(item=>item[0]==="write").length,1);h.unmount();
}
{
  const h=harness();await h.tick();const gate=deferred(),write=h.api.write;
  h.api.write=async(...args)=>{await gate.promise;await write(...args);};
  const pending=h.state.toggle(h.state.snapshot.rows[0],false);
  h.props.identity="connection-B";h.render();await h.tick();
  h.props.identity="connection-A:market-A";h.render();await h.tick();
  gate.resolve();await pending;await h.tick();
  assert.equal(h.calls.filter(item=>item[0]==="updated").length,0,"A-B-A does not revive an old completion callback");h.unmount();
}
console.log("Plugin management MCP state: exact writes, optimistic state, single-flight, readback recovery, rejection, admin, missing key, full-directory precedence, service failure and scope/ABA isolation passed.");

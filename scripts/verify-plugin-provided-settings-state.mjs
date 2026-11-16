import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const load=(file,imports)=>{const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,console:{warn(){}},require:name=>{if(name in imports)return imports[name];throw Error(name);}});return exports;};
const parser=load('src/pluginProvidedSettings.ts',{});
function harness() {
 let slots=[],cursor=0,effects=[],scheduled=[],output,identity='account-A',values={enabled:true,count:2};const calls=[];
 const view={hostId:'local',server:'actual-server',pluginId:'actual-plugin',title:'Actual',readTool:'read_settings',updateTool:'update_settings',tools:[
  {name:'read_settings',inputSchema:{type:'object',properties:{}}},{name:'update_settings',inputSchema:{type:'object',properties:{set:{type:'object'}}}},
  {name:'act',title:'Actual action',inputSchema:{type:'object',properties:{}}},
  {name:'required',inputSchema:{type:'object',required:['target']}},
  {name:'ui',inputSchema:{type:'object'},_meta:{ui:{resourceUri:'ui://fixture/action.html'}}},
  {name:'file',inputSchema:{type:'object'},_meta:{'openai/fileParams':undefined}},
 ]};
 const definition=()=>({schema:{type:'object',properties:{enabled:{type:'boolean',title:'Enabled'},count:{type:'integer',title:'Count',minimum:1,maximum:5}}},values:{...values}});
 const behavior={read:async()=>({structuredContent:definition()}),update:async args=>{values={...values,...args.set};return {structuredContent:{values:{...values}}};},action:async()=>({content:[{type:'text',text:'Actual tool result'}]})};
 const bridge={callAppServer:async(method,params)=>{calls.push([method,params]);if(method==='thread/start')return {thread:{id:'private-thread-'+calls.length,ephemeral:true}};if(method==='thread/unsubscribe')return {};if(method==='mcpServer/tool/call'){if(params.tool===view.readTool)return behavior.read(params.arguments);if(params.tool===view.updateTool)return behavior.update(params.arguments);return behavior.action(params.tool);}throw Error(method);}};
 const runtime=load('src/pluginSettingsRuntime.ts',{'./bridge':bridge});
 const react={useRef(value){const i=cursor++;return slots[i]??(slots[i]={current:value});},useState(value){const i=cursor++;if(!(i in slots))slots[i]=value;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useEffect(callback,deps){const i=cursor++,old=effects[i];if(!old||deps.some((value,j)=>value!==old.deps[j]))scheduled.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:callback()};});}};
 const {usePluginProvidedSettingsView:hook}=load('src/pluginProvidedSettingsState.ts',{'react':react,'./pluginSettingsRuntime':runtime,'./pluginProvidedSettings':parser});
 const render=()=>{cursor=0;output=hook(view,identity);for(const run of scheduled.splice(0))run();return output;};const tick=async()=>{for(let i=0;i<18;i++){await Promise.resolve();render();}};
 render();return {calls,behavior,view,render,tick,get state(){return output;},get values(){return values;},set identity(value){identity=value;},unmount(){for(const entry of effects)entry?.cleanup?.();},toolCalls:name=>calls.filter(([method,params])=>method==='mcpServer/tool/call'&&params.tool===name)};
}
{
 const h=harness();await h.tick();assert.equal(h.state.definition.values.enabled,true);assert.equal(h.calls[0][0],'thread/start');assert.equal(h.calls[0][1].permissions,':read-only');
 await h.state.change('enabled',true);assert.equal(h.toolCalls('update_settings').length,0);await h.state.change('count',2.5);assert.equal(h.toolCalls('update_settings').length,0);
 await h.state.change('enabled',false);await h.tick();assert.equal(h.state.definition.values.enabled,false);assert.equal(h.state.error,null);assert.equal(h.calls.filter(([method])=>method==='thread/start').length,1,'read and write reuse a private context');
 assert.deepEqual(JSON.parse(JSON.stringify(h.toolCalls('update_settings')[0][1].arguments)),{set:{enabled:false}});
 const ids=h.calls.filter(([method])=>method==='mcpServer/tool/call').map(([,params])=>params.threadId);assert.equal(new Set(ids).size,1);
 h.unmount();await h.tick();assert.equal(h.calls.filter(([method])=>method==='thread/unsubscribe').length,1);
}
{
 const h=harness();await h.tick();h.behavior.update=async()=>({isError:true,content:[{type:'text',text:'Rejected'}]});await h.state.change('enabled',false);await h.tick();assert.equal(h.state.definition.values.enabled,true);assert.ok(h.state.error);assert.equal(h.toolCalls('read_settings').length,2,'failed update still rereads actual settings');
 await h.state.reload();await h.tick();assert.equal(h.toolCalls('update_settings').length,1,'retry never replays update');assert.equal(h.state.error,null);h.unmount();
}
{
 const h=harness();await h.tick();const read=h.behavior.read;h.behavior.update=async()=>{h.behavior.read=async()=>{throw Error('readback failed');};return {structuredContent:{values:{enabled:false,count:2}}};};
 await h.state.change('enabled',false);await h.tick();assert.equal(h.state.definition,null);assert.ok(h.state.error);h.behavior.read=read;await h.state.reload();await h.tick();assert.equal(h.toolCalls('update_settings').length,1);h.unmount();
}
{
 const h=harness();await h.tick();const gate=deferred(),update=h.behavior.update;h.behavior.update=async args=>{await gate.promise;return update(args);};const pending=h.state.change('enabled',false);h.render();assert.equal(h.state.pending.name,'enabled');await h.state.change('count',3);await h.state.runAction('act');assert.equal(h.toolCalls('update_settings').length,1);assert.equal(h.toolCalls('act').length,0);gate.resolve();await pending;await h.tick();h.unmount();
}
{
 const h=harness();await h.tick();for(const name of ['required','ui','file','missing']){assert.equal(h.state.actionAvailable(name),false);await h.state.runAction(name);assert.equal(h.toolCalls(name).length,0);}
 await h.state.runAction('act');await h.tick();assert.equal(h.state.actionResults.act.text,'Actual tool result');h.behavior.action=async()=>({content:[{type:'text',text:''}]});await h.state.runAction('act');await h.tick();assert.equal(h.state.actionResults.act.text,'已完成','empty first text uses official completed feedback');h.behavior.action=async()=>({isError:true});await h.state.runAction('act');await h.tick();assert.match(h.state.actionResults.act.error,/无法完成/);h.unmount();
}
{
 const h=harness();await h.tick();const gate=deferred();h.behavior.update=async()=>gate.promise;const pending=h.state.change('enabled',false);const oldChange=h.state.change;await h.tick();assert.equal(h.toolCalls('update_settings').length,1,'write has reached the transport before switching');
 h.identity='account-B';h.render();await h.tick();h.identity='account-A';h.render();await h.tick();const before=h.toolCalls('read_settings').length;gate.resolve({structuredContent:{values:{enabled:false}}});await pending;await h.tick();assert.equal(h.state.definition.values.enabled,true);assert.equal(h.toolCalls('read_settings').length,before,'retired write cannot dispatch readback into a new context');await oldChange('count',3);assert.equal(h.toolCalls('update_settings').length,1);h.unmount();
}
{
 const h=harness();await h.tick();const gate=deferred(),read=h.behavior.read;h.behavior.read=async()=>gate.promise;const pending=h.state.reload();await h.state.reload();assert.equal(h.toolCalls('read_settings').length,2,'manual read is single-flight');await h.state.change('enabled',false);assert.equal(h.toolCalls('update_settings').length,0);gate.resolve(await read());await pending;await h.tick();h.unmount();
}
console.log('Plugin provided settings state + real runtime: trusted private context, exact one-field writes, success/failure readback, read-only retry, single-flight, actions and scope/ABA cleanup passed.');

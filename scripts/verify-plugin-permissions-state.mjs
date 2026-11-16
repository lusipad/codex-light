import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const allowed=(value='review_important_actions')=>({identity:{accountId:'a',userId:'u',generation:1},access:'allowed',value});
function harness(options={}) {
 let slots=[],cursor=0,effects=[],scheduled=[],output,identity='account-A';const calls=[];
 const api={read:async()=>allowed(),write:async(_snapshot,value)=>({snapshot:allowed(value),confirmed:true}),...options};
 const react={useRef(value){const i=cursor++;return slots[i]??(slots[i]={current:value});},useState(value){const i=cursor++;if(!(i in slots))slots[i]=value;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useEffect(callback,deps){const i=cursor++,old=effects[i];if(!old||deps.some((value,j)=>value!==old.deps[j]))scheduled.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:callback()};});}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/pluginPermissionsState.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,AbortController,require:name=>name==='react'?react:name==='./pluginPermissions'?{loadPluginPermissions:async signal=>{calls.push(['read',signal]);return api.read(signal);},savePluginPermission:async(...args)=>{calls.push(['write',...args]);return api.write(...args);}}:undefined});
 const render=()=>{cursor=0;output=exports.usePluginPermissions(identity);for(const run of scheduled.splice(0))run();return output;};
 const tick=async()=>{for(let i=0;i<10;i++){await Promise.resolve();render();}};
 render();return {api,calls,render,tick,get state(){return output;},set identity(value){identity=value;},unmount(){for(const entry of effects)entry?.cleanup?.();}};
}
{
 const h=harness();await h.tick();await h.state.change('review_important_actions');assert.equal(h.calls.filter(item=>item[0]==='write').length,0);
 const gate=deferred();h.api.write=async(_before,value)=>{await gate.promise;return {snapshot:allowed(value),confirmed:true};};
 const pending=h.state.change('always_ask');h.render();assert.equal(h.state.state.pending,true);assert.equal(h.state.state.snapshot.value,'review_important_actions','global picker awaits server readback rather than inventing success');
 await h.state.change('ask_before_writes');assert.equal(h.calls.filter(item=>item[0]==='write').length,1);gate.resolve();await pending;await h.tick();assert.equal(h.state.state.snapshot.value,'always_ask');assert.equal(h.state.state.blocked,false);h.unmount();
}
{
 const h=harness({write:async()=>({snapshot:null,confirmed:false})});await h.tick();await h.state.change('always_ask');await h.tick();assert.equal(h.state.state.blocked,true);
 await h.state.change('always_ask');assert.equal(h.calls.filter(item=>item[0]==='write').length,1);h.api.read=async()=>allowed('always_ask');await h.state.reload();await h.tick();assert.equal(h.state.state.snapshot.value,'always_ask');assert.equal(h.state.state.blocked,false);assert.equal(h.calls.filter(item=>item[0]==='write').length,1,'unknown result only refreshes; never repeats PATCH');h.unmount();
}
{
 const h=harness({write:async()=>{throw Error('failure');}});await h.tick();await h.state.change('always_ask');await h.tick();assert.equal(h.state.state.blocked,true);assert.match(h.state.state.error,/无法保存权限/);h.unmount();
}
{
 const h=harness({read:async()=>{throw Error('offline');}});await h.tick();assert.equal(h.state.state.snapshot,null);assert.equal(h.state.state.blocked,true);assert.match(h.state.state.error,/无法加载权限/);await h.state.change('always_ask');assert.equal(h.calls.filter(item=>item[0]==='write').length,0);h.unmount();
}
{
 const gate=deferred(),h=harness({read:async()=>gate.promise});await h.tick();h.identity='account-B';h.api.read=async()=>allowed('ask_before_writes');h.render();await h.tick();gate.resolve(allowed('always_ask'));await h.tick();assert.equal(h.state.state.snapshot.value,'ask_before_writes','old account response cannot overwrite new snapshot');h.unmount();
}
{
 const gate=deferred(),h=harness();await h.tick();const oldChange=h.state.change;h.api.write=async()=>gate.promise;const pending=h.state.change('always_ask');
 h.identity='account-B';h.render();await h.tick();h.identity='account-A';h.render();await h.tick();gate.resolve({snapshot:allowed('always_ask'),confirmed:true});await pending;await h.tick();
 assert.equal(h.state.state.snapshot.value,'review_important_actions','A-B-A does not revive old completion');await oldChange('ask_before_writes');assert.equal(h.calls.filter(item=>item[0]==='write').length,1,'stale render handler is retired');h.unmount();
}
{
 const h=harness({read:async()=>({identity:null,access:'denied',value:null})});await h.tick();await h.state.change('always_ask');assert.equal(h.calls.filter(item=>item[0]==='write').length,0);h.unmount();
}
console.log('Plugin permissions state: real readback, single-flight, failed/unknown read-only recovery, denial, account switch and A-B-A isolation passed.');

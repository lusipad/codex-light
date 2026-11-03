import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compilerOptions={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true,resolveJsonModule:true};
const theme={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/appearanceTheme.ts','utf8'),{compilerOptions}).outputText,{
 exports:theme.exports,require:name=>JSON.parse(fs.readFileSync('src/'+name.replace(/^\.\//,''),'utf8')),console,
});
const source=ts.transpileModule(fs.readFileSync('src/appearancePreferences.ts','utf8'),{compilerOptions}).outputText;
const clone=value=>JSON.parse(JSON.stringify(value));
const css=fs.readFileSync('src/styles.css','utf8');
assert.match(css.match(/\.markdown-body \.code-block-pre \{[^}]+\}/)[0],/color: var\(--code-foreground/,'unclassified code text consumes preset foreground in light and dark themes');
const bus=new Set(),store={},writes=[];
let fail=()=>false,readFail=false;
function host(){
 const hooks=[],effects=[],styles=new Map(),media=new Map();let cursor=0,result,alive=true;
 const root={dataset:{},style:{setProperty:(key,value)=>styles.set(key,value)}};
 const query=q=>{if(!media.has(q))media.set(q,{matches:q.includes('dark'),listeners:new Set(),addEventListener(_,fn){this.listeners.add(fn);},removeEventListener(_,fn){this.listeners.delete(fn);}});return media.get(q);};
 const react={
  useState(initial){const i=cursor++;if(!(i in hooks))hooks[i]=typeof initial==='function'?initial():initial;return[hooks[i],value=>hooks[i]=typeof value==='function'?value(hooks[i]):value];},
  useRef(initial){const i=cursor++;return hooks[i]??={current:initial};},useCallback(fn){cursor++;return fn;},
  useEffect(fn,deps){const i=cursor++,old=hooks[i];if(!old||deps.some((value,j)=>value!==old.deps[j])){old?.cleanup?.();hooks[i]={deps};effects.push(()=>hooks[i].cleanup=fn());}},
 };
 const own=new Set();
 const invoke=async(method,args)=>{
  if(method==='appearance_preferences_read'){if(readFail)throw Error('read unavailable');return clone(store);}
  assert.equal(method,'appearance_preference_write');writes.push(clone(args));
  if(fail(args))throw Error('injected write failure');
  store[args.key]=clone(args.value);
  for(const listener of bus)if(!own.has(listener))listener({key:args.key});
 };
 const mod={exports:{}};
 vm.runInNewContext(source,{exports:mod.exports,require:name=>name==='react'?react:name==='./appearanceTheme'?theme.exports:{tauriInvoke:invoke,tauriListen:async(_,fn)=>{bus.add(fn);own.add(fn);return()=>{bus.delete(fn);own.delete(fn);};}},window:{matchMedia:query},document:{documentElement:root},console});
 return {
  render(){assert.ok(alive);cursor=0;result=mod.exports.useAppearancePreferences();for(const effect of effects.splice(0))effect();return result;},
  get state(){return result;},styles,root,
  close(){for(const hook of hooks)hook?.cleanup?.();alive=false;},
 };
}
const flush=()=>new Promise(setImmediate);
const first=host(),second=host();first.render();second.render();await flush();first.render();second.render();
const dark=theme.exports.defaultChromeTheme('dark'),light=theme.exports.defaultChromeTheme('light');
const changed={...dark,surface:'#102030',accent:'#f08020',accentSource:'custom'};
assert.equal(await first.state.saveTheme('dark',changed,'codex'),'saved');first.render();
assert.equal(first.state.preferences.appearanceDarkChromeTheme.surface,'#102030');
assert.equal(first.styles.get('--bg-main'),'#102030','theme reaches real background consumer variable');
second.render();await flush();second.render();assert.equal(second.state.preferences.appearanceDarkChromeTheme.surface,'#102030','other window reloads real storage');
assert.equal(await first.state.saveTheme('light',{...light,surface:'#eeeedd'},'codex'),'saved');first.render();
assert.equal(store.appearanceDarkChromeTheme.surface,'#102030','inactive variant is preserved');
// Enqueue snapshots without a render; execution must use the latest committed ref.
const one=first.state.saveTheme('dark',{...changed,ink:'#eeeeee'},'codex');
const two=first.state.saveTheme('dark',{...changed,ink:'#dddddd'},'codex');
assert.equal(await one,'saved');assert.equal(await two,'saved');first.render();
assert.equal(store.appearanceDarkChromeTheme.ink,'#dddddd');
const previous=clone(store.appearanceDarkChromeTheme);
fail=args=>args.key==='appearanceDarkCodeThemeId';
const preset=theme.exports.themePresets('dark').find(item=>item.id!=='codex');assert.ok(preset);
assert.equal(await first.state.saveTheme('dark',{...changed,surface:'#203040'},preset.id),'failed');first.render();
assert.deepEqual(store.appearanceDarkChromeTheme,previous,'second write failure restores first committed theme');
assert.match(first.state.error,/保存主题失败/);
// Failed compensation must retain and expose the actual partial write.
let themeWrite=0;
fail=args=>args.key==='appearanceDarkCodeThemeId'||(args.key==='appearanceDarkChromeTheme'&&++themeWrite===2);
assert.equal(await first.state.saveTheme('dark',{...changed,surface:'#304050'},preset.id),'unconfirmed');first.render();
assert.equal(first.state.preferences.appearanceDarkChromeTheme.surface,'#304050');assert.match(first.state.error,/恢复失败/);
fail=()=>false;readFail=true;
assert.equal(await first.state.saveTheme('dark',changed,'codex'),'unconfirmed');first.render();assert.match(first.state.error,/重新读取失败/);
readFail=false;first.state.reload();first.render();await flush();first.render();assert.equal(first.state.error,null);
const count=writes.length;
assert.equal(await first.state.saveTheme('dark',{...changed,accent:'red'},'codex'),'failed');assert.equal(writes.length,count);
store.appearanceDarkCodeThemeId='linear';
first.state.reload();first.render();await flush();first.render();
assert.equal(first.state.preferences.appearanceDarkCodeThemeId,'linear','unimplemented official preset is preserved on read');
assert.equal(await first.state.saveTheme('dark',changed,'linear'),'saved','color-only edit preserves the existing unavailable preset');first.render();
assert.equal(store.appearanceDarkCodeThemeId,'linear');
assert.equal(await first.state.saveTheme('dark',changed,'invented'),'failed','new unsupported preset cannot be selected');
const serialized=theme.exports.serializeTheme({variant:'dark',theme:changed,codeThemeId:'codex'});
assert.throws(()=>theme.exports.parseTheme(serialized,'light',['codex']));
first.close();second.close();assert.equal(bus.size,0,'window listeners released');
console.log('PASS AB01/AB05/AB08 state: independent variants, actual style values, ordered theme writes, partial compensation/readback errors, two-window refresh and listener cleanup (controlled production hook; not native UI)');

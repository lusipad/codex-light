import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = fs.readFileSync("src/appearancePreferences.ts", "utf8");
const code = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const effects=[], hooks=[], media=new Map(), values=new Map(),attributes={};
let cursor=0, invoke=async()=>null, rendered;
const root={style:{setProperty:(k,v)=>values.set(k,v)},dataset:attributes};
function query(q){if(!media.has(q))media.set(q,{matches:q.includes("color-scheme"),listeners:new Set(),addEventListener(_,fn){this.listeners.add(fn);},removeEventListener(_,fn){this.listeners.delete(fn);}});return media.get(q);}
const react={
 useState(initial){const i=cursor++;if(!(i in hooks))hooks[i]=typeof initial==="function"?initial():initial;return[hooks[i],v=>hooks[i]=typeof v==="function"?v(hooks[i]):v];},
 useRef(initial){const i=cursor++;return hooks[i]??={current:initial};},useCallback(fn){cursor++;return fn;},
 useEffect(fn,deps){const i=cursor++,previous=hooks[i];if(!previous||deps.some((d,j)=>d!==previous.deps[j])){previous?.cleanup?.();hooks[i]={deps};effects.push(()=>hooks[i].cleanup=fn());}},
};
const mod={exports:{}};
vm.runInNewContext(code,{exports:mod.exports,require:name=>name==="react"?react:{tauriInvoke:(...args)=>invoke(...args)},document:{documentElement:root},window:{matchMedia:query},console});
const {normalizeAppearanceValue,parseAppearanceFontSize,useAppearancePreferences}=mod.exports;
assert.equal(normalizeAppearanceValue("appearanceTheme","bad"),"system");
assert.equal(normalizeAppearanceValue("sansFontSize",18),14);assert.equal(normalizeAppearanceValue("codeFontSize",7),12);
assert.equal(parseAppearanceFontSize("sansFontSize","15.5"),15.5);assert.equal(parseAppearanceFontSize("sansFontSize","99"),null);
assert.equal(parseAppearanceFontSize("codeFontSize",""),null);
const render=()=>{cursor=0;rendered=useAppearancePreferences();for(const effect of effects.splice(0))effect();return rendered;};
const flush=()=>new Promise(setImmediate);
const store={appearanceTheme:"system",sansFontSize:14,codeFontSize:12,"reduced-motion-preference":"system"},calls=[];
let releaseInitial;
const initialGate=new Promise(resolve=>releaseInitial=resolve);
invoke=async()=>initialGate;
render();
assert.equal(await rendered.save("sansFontSize",15),"failed","initial read prevents writes");
releaseInitial(null);await flush();
invoke=async(method,args)=>{calls.push([method,args]);if(method==="desktop_state_set")store[args.key]=args.value;return store[args.key];};
render();rendered.reload();render();await flush();render();assert.equal(root.dataset.theme,"dark");assert.equal(values.get("--font-ui-size"),"14px");assert.equal(values.get("--font-code-size"),"12px");
const system=query("(prefers-color-scheme: dark)");system.matches=false;for(const fn of system.listeners)fn();assert.equal(root.dataset.theme,"light");
await rendered.save("appearanceTheme","dark");render();system.matches=false;for(const fn of system.listeners)fn();assert.equal(root.dataset.theme,"dark");
await rendered.save("sansFontSize",16);render();assert.equal(values.get("--font-ui-scale"),String(16/14));assert.equal(values.get("--font-code-size"),"12px");
await rendered.save("codeFontSize",20);render();assert.equal(values.get("--font-code-size"),"20px");assert.equal(values.get("--font-ui-size"),"16px");
await rendered.save("reduced-motion-preference","on");render();assert.equal(root.dataset.reducedMotion,"true");
await rendered.save("reduced-motion-preference","off");render();assert.equal(root.dataset.reducedMotion,"false");
invoke=async()=>{throw Error("disk denied");};await rendered.save("appearanceTheme","light");render();assert.equal(root.dataset.theme,"dark");assert.match(rendered.error,/保存失败/);

let rejectWrite;const writeGate=new Promise((_,reject)=>rejectWrite=reject);let writeCount=0;
invoke=async(method,args)=>{if(method==='desktop_state_set'){writeCount++;return writeGate;}return store[args.key];};
const numericPending=rendered.save('sansFontSize',15);render();assert.equal(values.get('--font-ui-size'),'15px','numeric changes are optimistic');
assert.equal(await rendered.save('appearanceTheme','light'),'failed');assert.equal(writeCount,1,'single lock prevents overlapping writes');
rejectWrite(Error('denied'));assert.equal(await numericPending,'failed');render();assert.equal(values.get('--font-ui-size'),'16px','failed numeric write rolls back');
invoke=async(method,args)=>{if(method==='desktop_state_set'){store[args.key]=args.value;return;}throw Error('confirmation unavailable');};
assert.equal(await rendered.save('codeFontSize',22),'unconfirmed');render();assert.equal(values.get('--font-code-size'),'22px');assert.match(rendered.error,/已保存，但读取确认失败/);
rendered.reload();render();await flush();render();assert.match(rendered.error,/读取外观设置失败/);
invoke=async(_,args)=>store[args.key];
rendered.reload();render();await flush();render();assert.equal(rendered.error,null);assert.equal(rendered.preferences.codeFontSize,22);
let releaseLate;
const lateGate=new Promise(resolve=>releaseLate=resolve);
invoke=async()=>lateGate;
rendered.reload();render();
for(const hook of hooks)hook?.cleanup?.();assert.equal(system.listeners.size,0);assert.equal(query("(prefers-reduced-motion: reduce)").listeners.size,0);
const snapshot=JSON.stringify(hooks);
releaseLate(15);await flush();assert.equal(JSON.stringify(hooks),snapshot,"unmounted late reads cannot change state");
console.log("PASS AP01-AP05: production hook persistence/readback, real style writes, system changes/override, separate fonts, reduced motion, failure retention and listener cleanup (L2)");
const fieldSource=fs.readFileSync('src/components/AppearanceSettings.tsx','utf8');
const fieldAst=ts.createSourceFile('AppearanceSettings.tsx',fieldSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let commit;
function findCommit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(fieldAst)==='commit')commit=node.initializer;ts.forEachChild(node,findCommit);}findCommit(fieldAst);
for(const result of ['saved','unconfirmed','failed']){
 let displayed='20',writes=0;const context={committing:{current:false},state:{busy:false,save:async()=>{writes++;return result;}},setting:'codeFontSize',draft:'20',saved:12,parseAppearanceFontSize,setDraft:value=>displayed=value};
 const execute=vm.runInNewContext(ts.transpileModule(`(${commit.getText(fieldAst)})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 await execute();assert.equal(displayed,result==='failed'?'12':'20',`field must reflect ${result}`);assert.equal(writes,1);
}
console.log('PASS AP03 field partial-success regression: confirmed and unconfirmed writes keep the new displayed size; write failure restores old size');

const css=fs.readFileSync('src/styles.css','utf8');
for(const selector of ['.markdown-body .inline-code','.markdown-body .code-block-pre','.diff-code-container','.file-editor-textarea','.code-editor-textarea','.command-exec-command','.command-exec-body','.approval-command-block code','.approval-raw-json','.mcp-call-result','.workbench-artifact-pre']){
 const start=css.indexOf(selector+' {');assert.ok(start>=0,selector);const block=css.slice(start,css.indexOf('}',start));assert.match(block,/font-size: var\(--font-code-size\)/,selector+' consumes independent code size');
}
assert.match(css,/\[data-reduced-motion="true"\] \*/);
assert.match(css,/--bg-primary: var\(--palette-bg-primary/);
console.log('PASS appearance consumer declarations: independent chat/diff/tool/approval/editor code size and reduced-motion CSS (L1; computedStyle unverified)');

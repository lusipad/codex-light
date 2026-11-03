import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
const transpile = source => ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
function moduleAt(path,require=()=>({})) {const exports={};let source=fs.readFileSync(path,'utf8');if(path==='src/components/RemoteRevisionFiles.tsx'&&process.argv.includes('--patch-binding-baseline'))source=source.replace(', value.diff.unifiedDiff]',']');vm.runInNewContext(transpile(source),{exports,require,URL,AbortController,TextEncoder,TextDecoder,Uint8Array,crypto:{randomUUID},navigator:{userAgent:'fixture',userAgentData:{brands:[{brand:'Fixture',version:'1'}],platform:'Windows'}},localStorage:{getItem:()=> 'fixture-device'}});return exports;}
const parser=moduleAt('src/remoteDiffPaths.ts');
const remote=moduleAt('src/remoteReview.ts');
const patch=(base='a/file.ts',head='b/file.ts')=>`diff --git a/file.ts b/file.ts\n--- ${base}\n+++ ${head}\n@@ -1,2 +1,2 @@\n unchanged\n-old\n+new\n`;
let paths=parser.parseRemoteDiffFiles(patch());assert.equal(paths[0].basePath,'file.ts');assert.equal(paths[0].headPath,'file.ts');
assert.equal(parser.matchesRemoteFilePatch(patch(),'unchanged\nold\n','unchanged\nnew\n'),true);
assert.equal(parser.matchesRemoteFilePatch(patch(),'wrong\nold\n','unchanged\nnew\n'),false);
assert.equal(parser.matchesRemoteFilePatch(patch(),'unchanged\nold\ntail','unchanged\nnew\nwrong'),false);
assert.equal(parser.matchesRemoteFilePatch('@@ -1,0 +2 @@\n+insert\n','a\nb\n','a\ninsert\nb\n'),true);
assert.equal(parser.matchesRemoteFilePatch('@@ -2 +1,0 @@\n-remove\n','a\nremove\nb\n','a\nb\n'),true);
assert.equal(parser.matchesRemoteFilePatch('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file','a','b'),true);
assert.equal(parser.parseRemoteDiffFiles('diff --git a/old b/new\nsimilarity index 100%\nrename from old\nrename to new\n')[0].headPath,'new');
assert.equal(parser.parseRemoteDiffFiles('diff --git a/old b/new\nrename from old\nrename to new\n--- a/old\n+++ b/new\n@@ -1 +1 @@\n-a\n+b\n')[0].unavailable,false);
assert.equal(parser.parseRemoteDiffFiles(patch('"a/\\344\\270\\255.txt"','"b/\\344\\270\\255.txt"'))[0].headPath,'中.txt');
for(const path of ['b/../secret','b/C:/secret','"b/\\777.txt"','"b/\\303.txt"','"b/\\q.txt"','b//wrong'])assert.equal(parser.parseRemoteDiffFiles(patch('a/safe',path))[0].unavailable,true,path);
assert.equal(parser.parseRemoteDiffFiles('diff --git a/file b/file\nBinary files a/file and b/file differ')[0].unavailable,true);
const sha=c=>c.repeat(40),url='https://github.com/o/r/pull/1',identity={accountId:'a',userId:'u',generation:1};
const comparison=()=>({snapshotId:'snapshot-1',pullRequest:{hostname:'github.com',owner:'o',repository:'r',number:1,url},account:{hostId:'local',hostname:'github.com',login:'reviewer'},metadata:{status:'success',headRevision:sha('b'),additions:1,deletions:1,changedFiles:1,createdAt:'2026-11-04',authorLogin:null},snapshot:{baseRevision:sha('a'),mergeBaseRevision:sha('c'),headRevision:sha('b')},comparison:{baseRevision:sha('c'),headRevision:sha('b')},diff:{headRevision:sha('b'),unifiedDiff:patch()}});
function surface(value=comparison()) {
 const calls=[],control={body:()=>({...value,file:{status:'success',baseContent:'unchanged\nold\n',headContent:'unchanged\nnew\n'}})};
 const client=moduleAt('src/chatgptService.ts',key=>key==='./remoteReview'?remote:{tauriInvoke:async(command,args)=>{calls.push({command,args});if(command==='chatgpt_service_identity')return identity;if(command==='chatgpt_service_cancel')return;return {requestId:args.request.requestId,identity,body:await control.body(args)};}});
 let slots=[],cursor=0,pending=[],tree,props={url,scope:'account-a',value,commitSha:null};
 const react={createElement:(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)}),Fragment:'fragment',useMemo:fn=>fn(),useRef:initial=>{const i=cursor++;return slots[i]??={current:initial};},useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useEffect:(fn,deps)=>{const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))pending.push(()=>{old?.stop?.();slots[i]={deps,stop:fn()};});}};
 const component=moduleAt('src/components/RemoteRevisionFiles.tsx',key=>key==='react'?react:key==='../chatgptService'?client:key==='../remoteDiffPaths'?parser:{});
 const render=next=>{props={...props,...next};cursor=0;tree=component.RemoteRevisionFiles(props);};
 const effects=()=>{const queue=pending;pending=[];queue.forEach(fn=>fn());};
 const walk=node=>!node||typeof node!=='object'?[]:[node,...node.children.flatMap(walk)];
 const text=node=>node==null||typeof node==='boolean'?'':typeof node==='object'?node.children.map(text).join(' '):String(node);
 const nodes=()=>walk(tree),button=()=>nodes().find(n=>n.type==='button'&&n.props['aria-expanded']!==undefined);
 render();effects();render();
 return {calls,control,render,effects,nodes,button,text:()=>text(tree),unmount:()=>slots.forEach(s=>s?.stop?.())};
}
let h=surface();assert.equal(h.calls.length,0,'collapsed files must not read');await h.button().props.onClick();await flush();h.render();
let read=h.calls.find(c=>c.command==='code_review_revision_file_read');assert.equal(read.args.basePath,'file.ts');assert.equal(read.args.headPath,'file.ts');assert.equal(read.args.snapshotId,'snapshot-1');assert.match(h.text(),/unchanged\nnew/);h.unmount();
// A refreshed diff can reorder or replace files without changing the snapshot ID.
// Never reuse per-index full content across a different patch, even before effects run.
for(const diff of [patch('a/other.ts','b/other.ts')+patch(),patch().replace('-old\n+new','-old\n+updated')]){
 h=surface();h.button().props.onClick();await flush();h.render();assert.match(h.text(),/unchanged\nnew/);
 const v=comparison();v.diff.unifiedDiff=diff;h.render({value:v});assert.doesNotMatch(h.text(),/unchanged\nnew/);assert.equal(h.button().props['aria-expanded'],false);h.effects();h.render();assert.doesNotMatch(h.text(),/unchanged\nnew/);h.unmount();
}
for(const [base,head,baseContent,headContent] of [[null,'new.txt','','new\n'],['old.txt',null,'old\n','']]){
 const v=comparison();v.diff.unifiedDiff=`diff --git a/file b/file\n--- ${base?'a/'+base:'/dev/null'}\n+++ ${head?'b/'+head:'/dev/null'}\n${base?'@@ -1 +0,0 @@\n-old\n':'@@ -0,0 +1 @@\n+new\n'}`;
 h=surface(v);h.control.body=()=>({...v,file:{status:'success',baseContent,headContent}});h.button().props.onClick();await flush();h.render();read=h.calls.find(c=>c.command==='code_review_revision_file_read');assert.equal(read.args.basePath,base);assert.equal(read.args.headPath,head);assert.match(h.text(),/此版本不存在文件/);h.unmount();
}
h=surface();h.control.body=()=>({...comparison(),file:{status:'unavailable',reason:'binary'}});h.button().props.onClick();await flush();h.render();assert.match(h.text(),/完整文件不可用/);assert.equal(h.nodes().some(n=>n.type==='pre'),false);h.unmount();
h=surface();h.control.body=()=>{throw Error('network failed');};h.button().props.onClick();await flush();h.render();assert.match(h.text(),/network failed/);h.control.body=()=>({...comparison(),file:{status:'success',baseContent:'unchanged\nold\n',headContent:'unchanged\nnew\n'}});h.nodes().find(n=>n.type==='button'&&n.children.includes('重试读取文件')).props.onClick();await flush();h.render();assert.match(h.text(),/unchanged\nnew/);h.unmount();
for(const change of [{scope:'account-b'},{url:'https://github.com/o/r/pull/2'},{commitSha:sha('d')},{value:{...comparison(),snapshotId:'snapshot-2'}}]){
 h=surface();let resolve;h.control.body=()=>new Promise(r=>resolve=r);h.button().props.onClick();await flush();h.render();h.render(change);assert.doesNotMatch(h.text(),/unchanged/);h.effects();assert.ok(h.calls.some(c=>c.command==='chatgpt_service_cancel'));resolve({...comparison(),file:{status:'success',baseContent:'unchanged\nold\n',headContent:'unchanged\nnew\n'}});await flush();h.render();assert.doesNotMatch(h.text(),/unchanged/);h.unmount();
}
for(const [base,head] of [['old name.txt','new name.txt'],['中.txt','中.txt']]){
 const v=comparison();v.diff.unifiedDiff=`diff --git a/old b/new\nrename from ${base}\nrename to ${head}\n`;
 h=surface(v);h.control.body=()=>({...v,file:{status:'success',baseContent:'same\n',headContent:'same\n'}});h.button().props.onClick();await flush();h.render();read=h.calls.find(c=>c.command==='code_review_revision_file_read');assert.equal(read.args.basePath,base);assert.equal(read.args.headPath,head);assert.match(h.text(),/same/);h.unmount();
}
h=surface();let collapseResolve;h.control.body=()=>new Promise(r=>collapseResolve=r);h.button().props.onClick();await flush();h.render();h.button().props.onClick();assert.ok(h.calls.some(c=>c.command==='chatgpt_service_cancel'));collapseResolve({...comparison(),file:{status:'success',baseContent:'unchanged\nold\n',headContent:'unchanged\nnew\n'}});await flush();h.render();assert.doesNotMatch(h.text(),/unchanged/);h.unmount();
h=surface();h.control.body=()=>({...comparison(),file:{status:'success',baseContent:'wrong\nold\n',headContent:'unchanged\nnew\n'}});h.button().props.onClick();await flush();h.render();assert.match(h.text(),/不匹配/);assert.equal(h.nodes().some(n=>n.type==='pre'),false);h.unmount();
console.log('PASS production diff paths, full-content/hunk agreement, lazy component + real client mocked IPC, addition/deletion, unavailable, retry, scope cancellation and late response isolation');

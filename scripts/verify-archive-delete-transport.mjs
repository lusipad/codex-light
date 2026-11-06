import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const identity={accountId:'fixture-account',userId:'fixture-user',generation:7};
const calls=[]; let sequence=0, mismatch=null, status='accepted', pending=null, rejection=null;
const module={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/chatgptService.ts','utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText,{exports:module.exports,require(name){return name.endsWith('/bridge')?{
  tauriInvoke:async(command,args)=>{
    calls.push({command,args});
    if(command==='chatgpt_service_cancel')return;
    if(pending)await new Promise(resolve=>{pending.resolve=resolve;});
    if(rejection)throw rejection;
    return {requestId:mismatch==='request'?'old':args.request.requestId,
      identity:mismatch==='identity'?{...identity,generation:6}:identity,status};
  },
}:{};},navigator:{userAgent:'fixture',userAgentData:{platform:'Windows',brands:[{brand:'Chromium',version:'140'}]}},
  localStorage:{getItem:()=> 'fixture-device'},crypto:{randomUUID:()=>`fixture-${++sequence}`},TextEncoder});
const restore=module.exports.deleteCloudArchiveItem;
assert.equal(typeof restore,'function','DCT01: source-specific archive mutation client is required');
const signal=()=>new AbortController().signal;
for(const source of ['cloud-task','chatgpt-conversation']){
  assert.equal(await restore(source,'same/id',identity,signal()),'accepted');
  const last=calls.at(-1); assert.equal(last.command,'archive_delete');
  assert.deepEqual(Object.keys(last.args.request).sort(),['expectedIdentity','profile','requestId','source','targetId']);
  assert.equal(last.args.request.source,source); assert.equal(last.args.request.targetId,'same/id');
  assert.equal(last.args.request.expectedIdentity,identity);
}
const before=calls.length;
for(const [source,id] of [['local','id'],['cloud-task',''],['cloud-task','  '],['cloud-task','..'],['cloud-task','.'],
  ['cloud-task','bad\n'],['cloud-task','bad\u0085'],['cloud-task','中'.repeat(683)],['chatgpt-conversation',null]]){
  await assert.rejects(restore(source,id,identity,signal()));
}
const preCancelled=new AbortController();preCancelled.abort();
await assert.rejects(restore('cloud-task','a',identity,preCancelled.signal));
assert.equal(calls.length,before,'DCT02 invalid targets/pre-cancel send zero IPC');
for(const kind of ['request','identity']){
  mismatch=kind;
  await assert.rejects(restore('cloud-task','a',identity,signal()),error=>error.code==='archive_write_unknown');
}
mismatch=null;
for(const invalid of [undefined,null,'confirmed','failed',200]){
  status=invalid;
  await assert.rejects(restore('cloud-task','a',identity,signal()),error=>error.code==='archive_write_unknown');
}
status='already-absent';
assert.equal(await restore('chatgpt-conversation','a',identity,signal()),'already-absent');
status='accepted';
for(const code of ['forbidden','not_found','archive_write_unknown']){
  rejection={code,message:'fixture'};
  await assert.rejects(restore('cloud-task','a',identity,signal()),error=>error.code===code);
}
rejection=null;
pending={}; const late=new AbortController(), restoring=restore('cloud-task','a',identity,late.signal);
await Promise.resolve();late.abort();assert.equal(calls.at(-1).command,'chatgpt_service_cancel');
pending.resolve();await assert.rejects(restoring,error=>error.code==='archive_write_unknown');pending=null;
pending={}; rejection={code:'cancelled',message:'host rejected before dispatch'};
const knownCancel=new AbortController(), neverSent=restore('cloud-task','a',identity,knownCancel.signal);
await Promise.resolve();knownCancel.abort();pending.resolve();
await assert.rejects(neverSent,error=>error.code==='cancelled');pending=null;rejection=null;
assert.match(module.exports.serviceErrorMessage({code:'archive_write_unknown'}),/刷新|重新读取/);
console.log('PASS DCT01–05: fixed delete IPC, source/target validation, accepted/already-absent envelopes, preserved host failures and cancellation uncertainty; zero HTTP');

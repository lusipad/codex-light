import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
let response;const calls=[];const service={readChatgptService:async(...args)=>{calls.push(args);if(response instanceof Error)throw response;return response;}};
const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/workProjectAccess.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:module.exports,require:()=>service,Error,Map,Set});const m=module.exports;
const identity={accountId:'a',userId:'u',generation:3},signal=new AbortController().signal;
const project=(id='g-p-one',extra={})=>({gizmo:{id,display:{name:'One'},share_recipient:'private',memory_scope:'global',sharing:{subjects:[]},...extra},files:[]});
const input={identity,gate288:true,routeProjectId:null,selectedChatGptProjectId:null,selectedWorkProject:null,localProjects:{status:'value',value:{}},pendingBackingCount:0,activeLockedProjectId:null,cachedSelectedProject:undefined,provisioningHostAvailable:false,provisionPermission:null};
assert.equal((await m.readWorkProjectAccess({...input,gate288:null,localProjects:{status:'missing'}},signal)).project.cloudUnavailableReason,null);assert.equal(calls.length,0);
assert.equal((await m.readWorkProjectAccess({...input,selectedWorkProject:undefined},signal)).project,null);
const owner={accountId:'a',userId:'u',projectId:'g-p-one'},local={id:'local-one',chatGptBacking:owner};
response=project();let result=await m.readWorkProjectAccess({...input,selectedWorkProject:{type:'local',projectId:'local-one'},localProjects:{status:'value',value:{one:local}}},signal);
assert.equal(result.project.cloudUnavailableReason,null);assert.equal(result.backingProjectId,'g-p-one');assert.equal(calls.at(-1)[0],'work_project');assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1)[1])),{projectId:'g-p-one'});
result=await m.readWorkProjectAccess({...input,selectedWorkProject:{type:'local',projectId:'local-one'},localProjects:{status:'value',value:{one:local,two:{id:'local-two',chatGptBacking:owner}}}},signal);assert.equal(result.backingProjectId,null);assert.equal(result.project.cloudUnavailableReason,'project-incompatible');
result=await m.readWorkProjectAccess({...input,selectedWorkProject:{type:'local',projectId:'local-one'},localProjects:undefined},signal);assert.deepEqual(Array.from(result.missingInputs),['local-projects']);
result=await m.readWorkProjectAccess({...input,selectedChatGptProjectId:'g-p-one'},signal);assert.deepEqual(Array.from(result.missingInputs),['selected-project-cache']);
result=await m.readWorkProjectAccess({...input,selectedWorkProject:{type:'local',projectId:'local-one'},selectedChatGptProjectId:'g-p-one',localProjects:{status:'value',value:{}},pendingBackingCount:1},signal);assert.equal(result.project.cloudUnavailableReason,null,'owned pending short-circuits unavailable cache');
response=project('g-p-one',{gizmo_snorlax_type:'locked_chats'});result=await m.readWorkProjectAccess({...input,routeProjectId:'g-p-one'},signal);assert.equal(result.project.locked,true);assert.equal(result.project.cloudUnavailableReason,'unsupported-project-type');
result=await m.readWorkProjectAccess({...input,routeProjectId:'g-p-one',activeLockedProjectId:'g-p-one'},signal);assert.equal(result.project.cloudUnavailableReason,null);
assert.equal(m.workProjectUnavailableReason(project('g-p-one',{share_recipient:'workspace',gizmo_snorlax_type:'locked_chats',memory_scope:'project_v2'})),'shared-project');
assert.equal(m.workProjectUnavailableReason(project('g-p-one',{memory_scope:'project_v2'})),'project-only-memory');
assert.throws(()=>m.parseWorkProject({gizmo:{id:'g-p-one',display:{name:'One'}},files:null}));
assert.equal(m.projectProvisionPermission({isCurrentAccountLoading:false,isWorkspaceAccount:true,isWorkspaceSettingsLoading:false,isWorkspaceSettingsError:false,shouldCheckWorkspaceSettings:true,workspacePermissions:null}),'allowed');
assert.equal(m.projectProvisionPermission({isCurrentAccountLoading:false,isWorkspaceAccount:true,isWorkspaceSettingsLoading:false,isWorkspaceSettingsError:false,shouldCheckWorkspaceSettings:true,workspacePermissions:undefined}),'unavailable');
const controller=new AbortController();controller.abort();const before=calls.length;await assert.rejects(()=>m.readWorkProjectAccess(input,controller.signal));assert.equal(calls.length,before);
console.log('PASS Work project: owner/unique backing, fixed reader, no-project/missing distinction, pending, locked, classifier and permission semantics');
const countBefore=calls.length;
result=await m.readWorkProjectAccess({...input,selectedWorkProject:{type:'local',projectId:'local-one'},gate288:false,localProjects:{status:'missing'}},signal);
assert.equal(result.project.cloudUnavailableReason,'project-incompatible');assert.equal(calls.length,countBefore);
result=await m.readWorkProjectAccess({...input,selectedWorkProject:{type:'local',projectId:'local-one'},localProjects:{status:'value',value:{one:{id:'local-one',chatGptBacking:{...owner,userId:'other'}}}}},signal);
assert.equal(result.backingProjectId,null);assert.equal(result.project.cloudUnavailableReason,'project-incompatible');
response=project();result=await m.readWorkProjectAccess({...input,selectedWorkProject:{type:'local',projectId:'g-p-one'},routeProjectId:'g-p-one',pendingBackingCount:null},signal);
assert.equal(result.project.cloudUnavailableReason,null);assert.equal(result.missingInputs.length,0,'valid base does not require pending to be read');
response=new Error('HTTP 403');result=await m.readWorkProjectAccess({...input,routeProjectId:'g-p-one'},signal);
assert.equal(result.project.cloudUnavailableReason,'project-incompatible');assert.match(result.queryError,/403/);
response=project('g-p-one',{gizmo_snorlax_type:'locked_chats'});result=await m.readWorkProjectAccess({...input,routeProjectId:'g-p-one',selectedWorkProject:{type:'local',projectId:'g-p-one'},pendingBackingCount:1},signal);
assert.equal(result.project.cloudUnavailableReason,'unsupported-project-type','pending cannot override inaccessible locked project');
const cached=project('g-p-one',{memory_scope:'project_v2'});cached.isCachedSidebarProject=true;
assert.equal(m.workProjectUnavailableReason(cached),'project-incompatible');
assert.equal(m.workProjectUnavailableReason(project('g-p-one',{share_recipient:undefined,sharing:{subjects:['someone']}})),'project-incompatible');
console.log('PASS source short-circuits: false gate/no unnecessary reads, foreign owner, unknown pending, query error, locked precedence and cache reasons');

result=await m.readWorkProjectAccess({...input,selectedWorkProject:{type:'local',projectId:'local-one'},localProjects:{status:'missing'}},signal);
assert.equal(result.project.cloudUnavailableReason,'project-incompatible','confirmed missing root local-projects defaults to empty map per HP14; unread remains undefined');
// HP14 uses root LOCAL_PROJECTS ?? {}; confirmed null is absent, not unread.
result=await m.readWorkProjectAccess({...input,selectedWorkProject:{type:'local',projectId:'local-one'},localProjects:{status:'value',value:null}},signal);
assert.equal(result.project.cloudUnavailableReason,'project-incompatible');
assert.equal(result.missingInputs.length,0);
const mismatchedCache=project('g-p-other');
result=await m.readWorkProjectAccess({...input,selectedChatGptProjectId:'g-p-one',cachedSelectedProject:mismatchedCache},signal);
assert.equal(result.project.cloudUnavailableReason,'project-incompatible','cache candidate must match selected ChatGPT project ID');
const localSelection={type:'local',projectId:'local-one'};
for(const localProjects of [undefined,{status:'invalid',value:null},{status:'value',value:undefined}]) {
  result=await m.readWorkProjectAccess({...input,selectedWorkProject:localSelection,localProjects},signal);
  assert.deepEqual(Array.from(result.missingInputs),['local-projects']);
}
const provisioning={...input,selectedWorkProject:localSelection,localProjects:{status:'value',value:{'local-one':{id:'local-one'}}},provisioningHostAvailable:true,provisionPermission:'allowed'};
result=await m.readWorkProjectAccess(provisioning,signal);assert.equal(result.project.cloudUnavailableReason,null);
result=await m.readWorkProjectAccess({...provisioning,provisionPermission:null},signal);assert.deepEqual(Array.from(result.missingInputs),['provision-permission']);
for(const extra of [{retiredChatGptBacking:{}},{chatGptBackingRecoveryPending:true},{chatGptBackingCreation:{accountId:'other',userId:'u'}}]) {
  result=await m.readWorkProjectAccess({...provisioning,localProjects:{status:'value',value:{'local-one':{id:'local-one',...extra}}}},signal);
  assert.equal(result.project.cloudUnavailableReason,'project-incompatible');
}
result=await m.readWorkProjectAccess({...provisioning,localProjects:{status:'value',value:{'local-one':{id:'local-one',chatGptBackingCreation:{accountId:'a',userId:'u'}}}}},signal);assert.equal(result.project.cloudUnavailableReason,null);
response=project('g-p-one',{memory_scope:'project_v2'});const previousCalls=calls.length;
result=await m.readWorkProjectAccess({...input,gate288:false,routeProjectId:'g-p-one'},signal);
assert.equal(calls.length,previousCalls+1);assert.equal(result.queryProjectId,'g-p-one');assert.equal(result.project.cloudUnavailableReason,null,'gate false still queries route, while P remains null');
for(const [cache,reason]of [[project(),'allowed'],[project('g-p-one',{share_recipient:'workspace'}),'project-incompatible'],[null,'project-incompatible']]) {
  result=await m.readWorkProjectAccess({...input,selectedChatGptProjectId:'g-p-one',cachedSelectedProject:cache},signal);
  assert.equal(result.project.cloudUnavailableReason,reason==='allowed'?null:reason);
}
const lateController=new AbortController();service.readChatgptService=async()=>{lateController.abort();return project();};
await assert.rejects(()=>m.readWorkProjectAccess({...input,routeProjectId:'g-p-one'},lateController.signal));
console.log('PASS null/missing/unread, provisioning positive/negative, gate query, cache identity and read-time cancellation');

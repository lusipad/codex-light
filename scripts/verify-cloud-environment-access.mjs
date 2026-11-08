import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const identity={accountId:'cloud-account',userId:'cloud-user',generation:2};
const clone=v=>JSON.parse(JSON.stringify(v));
const hash=k=>{let n=0;for(const c of k)n=(Math.imul(n,31)+c.charCodeAt(0))>>>0;return String(n)};
function fixture(){
 const calls=[];let serial=0;const c={plan:'business',structure:'workspace',auth:'chatgpt',gates:{'3769444934':true,'1355972088':true},settings:{permissions:['chatgpt.workspace.feature.allow-codex-access.access'],beta_settings:{wham_access:false}},compact:false,hashed:false,payload:p=>p,accounts:b=>b,identity:()=>clone(identity)};
 const bridge={callAppServer:async(method,params)=>{calls.push({method});if(method==='config/read'){assert.deepEqual(clone(params),{cwd:null,includeLayers:false});return {config:{model_provider:c.provider}};}assert.equal(method,'account/read');return{account:{type:c.auth},workspaceRouting:{chatgptAccountId:identity.accountId}}},tauriInvoke:async(command,args)=>{calls.push({command,args:clone(args)});if(command==='chatgpt_service_identity')return c.identity();if(command==='chatgpt_service_cancel')return;if(command==='cloud_service_access')return{identity:clone(identity),gateEvidence:'incomplete'};if(command==='share_thread_access')return{statsigPayload:JSON.stringify(c.payload({has_updates:true,response_format:c.compact?'init-v2':'init-v1',user:{userID:identity.userId,customIDs:{account_id:identity.accountId}},feature_gates:Object.fromEntries(Object.entries(c.gates).map(([k,v])=>[c.hashed?hash(k):k,{[c.compact?'v':'value']:v}]))}))};assert.equal(command,'chatgpt_service_read');const r=args.request;return{requestId:r.requestId,identity:clone(r.expectedIdentity),body:r.operation==='share_accounts'?c.accounts({account_ordering:[identity.accountId],accounts:{[identity.accountId]:{account:{account_id:identity.accountId,account_user_id:'membership',account_user_role:'account-member',structure:c.structure,plan_type:c.plan,is_zdr:false},can_access_with_session:true}}}):r.operation==='cloud_workspace_settings'?c.settings:assert.fail('unexpected operation '+r.operation)}}};
 const modules=new Map();function load(file){if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,AbortController,crypto:{randomUUID:()=>`cloud-${++serial}`},navigator:{userAgent:'Offline cloud test',userAgentData:{brands:[{brand:'Chromium',version:'140'}],platform:'Windows'}},localStorage:{getItem:()=> 'device'},require:n=>n==='./bridge'?bridge:load(`src/${n.slice(2)}.ts`)});return exports;}
 const exists=fs.existsSync('src/cloudEnvironmentAccess.ts'),api=load(exists?'src/cloudEnvironmentAccess.ts':'src/chatgptService.ts');return{c,calls,read:(checkExecution=false)=> (api.readCloudEnvironmentAccess??api.cloudServiceAccess)(new AbortController().signal,checkExecution),settingsReads:()=>calls.filter(x=>x.args?.request?.operation==='cloud_workspace_settings')};
}
let passed=0;async function test(n,f){await f();console.log('PASS',n);passed++}
await test('official workspace allow permission grants cloud independently of manage permission',async()=>{const h=fixture(),a=await h.read();assert.equal(a.available,true);assert.equal(a.canManage,false);assert.equal(a.rbacEnabled,true);assert.equal(h.settingsReads().length,1);assert.deepEqual(clone(h.settingsReads()[0].args.request.params),{});});
await test('exact six personal plans bypass workspace read and cannot manage',async()=>{for(const plan of ['free','go','plus','prolite','pro','promax']){const h=fixture();h.c.plan=plan;h.c.structure='personal';h.c.gates={'3769444934':true};const a=await h.read();assert.equal(a.available,true);assert.equal(a.canManage,false);assert.equal(h.settingsReads().length,0);}});
await test('rollout disabled grants page and manages nonpersonal plans without workspace HTTP',async()=>{for(const plan of ['free','business']){const h=fixture();h.c.plan=plan;h.c.gates={'3769444934':false};const a=await h.read();assert.equal(a.available,true);assert.equal(a.rbacEnabled,false);assert.equal(a.canManage,plan==='business');assert.equal(h.settingsReads().length,0);}});
await test('RBAC and legacy wham branch stay distinct; manage requires cloud allow',async()=>{for(const permission of [true,false])for(const allow of [true,false]){const h=fixture();h.c.gates['1355972088']=permission;h.c.settings={permissions:['chatgpt.workspace.feature.codex-manage-workspace-environments.access',...(allow?['chatgpt.workspace.feature.allow-codex-access.access']:[])],beta_settings:{wham_access:allow}};const a=await h.read();assert.equal(a.available,allow);assert.equal(a.canManage,allow);}});
await test('permission rollout rejects absent gate and malformed required settings rather than upgrading HTTP success',async()=>{for(const mode of ['missing-gate','missing-permissions','bad-permissions','missing-beta','bad-beta']){const h=fixture();if(mode==='missing-gate')delete h.c.gates['1355972088'];if(mode==='missing-permissions')h.c.settings={};if(mode==='bad-permissions')h.c.settings.permissions=[42];if(mode==='missing-beta'){h.c.gates['1355972088']=false;h.c.settings={};}if(mode==='bad-beta'){h.c.gates['1355972088']=false;h.c.settings.beta_settings={wham_access:'true'};}await assert.rejects(h.read());}});
await test('full identity-bound V1/V2 hashed snapshots accepted, partial/foreign/delta rejected',async()=>{const h=fixture();h.c.compact=true;h.c.hashed=true;assert.equal((await h.read()).available,true);for(const mode of ['account','user','delta','incomplete','missing']){const f=fixture();f.c.payload=p=>{if(mode==='account')p.user.customIDs.account_id='other';if(mode==='user')p.user.userID='other';if(mode==='delta')p.is_delta=true;if(mode==='incomplete')p.has_updates=false;if(mode==='missing')p.feature_gates={};return p;};await assert.rejects(f.read());}});
await test('raw selected membership and ChatGPT auth required; final generation rejects late response',async()=>{for(const mode of ['array','deactivated','session','auth','identity']){const h=fixture();if(mode==='array')h.c.accounts=()=>({accounts:[],account_ordering:[]});if(mode==='deactivated')h.c.accounts=b=>{b.accounts[identity.accountId].account.is_deactivated=true;return b};if(mode==='session')h.c.accounts=b=>{b.accounts[identity.accountId].can_access_with_session=false;return b};if(mode==='auth')h.c.auth='apiKey';if(mode==='identity'){let calls=0;h.c.identity=()=>({...identity,generation:++calls===1?2:3});}await assert.rejects(h.read());}});
await test('create eligibility and direct experience are independently confirmed', async () => {
  const h = fixture();
  h.c.gates['375130565'] = true;
  assert.equal((await h.read()).canCreate, true);
  assert.equal((await h.read()).directCreate, null);
  h.c.gates['3620782482'] = false;
  assert.equal((await h.read()).directCreate, false);
  h.c.compact = true; h.c.hashed = true;
  h.c.gates['3620782482'] = true;
  assert.equal((await h.read()).directCreate, true);
  h.c.settings = { permissions: [] };
  assert.equal((await h.read()).canCreate, false);
});
await test('composer requires the cloud gate and checks the effective provider when enforced', async () => {
  const h=fixture();
  h.c.gates['3683713372']=false;
  assert.equal((await h.read(true)).canStartChat,false);
  h.c.gates['375130565']=true;
  assert.equal((await h.read(true)).canStartChat,true);
  assert.ok(!h.calls.some(call=>call.method==='config/read'));
  delete h.c.gates['3683713372'];
  assert.equal((await h.read(true)).canStartChat,false);
  h.c.gates['3683713372']=true;
  h.c.provider='custom';
  assert.equal((await h.read(true)).canStartChat,false);
  assert.equal((await h.read()).canStartChat,undefined);
  h.c.provider='openai';
  assert.equal((await h.read(true)).canStartChat,true);
  delete h.c.provider;
  assert.equal((await h.read(true)).canStartChat,true);
});
console.log(`PASS ${passed} cloud access groups; actual wrapper/raw accounts, offline bridge, no HTTP`);

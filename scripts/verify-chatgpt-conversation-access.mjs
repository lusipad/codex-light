import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const clone=value=>JSON.parse(JSON.stringify(value));
const identity={accountId:'chat-account',userId:'chat-user',generation:4};
const hash=key=>{let h=0;for(let i=0;i<key.length;i++)h=(Math.imul(h,31)+key.charCodeAt(i))>>>0;return String(h)};
function fixture(){
  const calls=[];let serial=0;const controller=new AbortController();
  const c={auth:'chatgpt',plan:'free',gate:false,compact:false,hashed:false,
    featurePages:[{data:[],nextCursor:null}],settings:{permissions:[]},identity:()=>clone(identity),
    accounts:value=>value,payload:value=>value,envelope:value=>value,after:()=>{},account:value=>value,fail:null};
  const bridge={callAppServer:async(method,params)=>{
    calls.push({method,params:clone(params)});if(c.fail===method)throw Error('fixture read failed');let result;
    if(method==='getAuthStatus'){assert.deepEqual(clone(params),{includeToken:false,refreshToken:false});result={authMethod:c.auth};}
    else if(method==='account/read'){assert.deepEqual(clone(params),{refreshToken:false});result=c.account({account:{type:'chatgpt'},workspaceRouting:{chatgptAccountId:identity.accountId}});}
    else if(method==='experimentalFeature/list'){result=c.featurePages[params.cursor==null?0:Number(params.cursor)];}
    else throw Error('unexpected protocol method');
    c.after(method);return result;
  },tauriInvoke:async(command,args)=>{
    calls.push({command,args:clone(args)});let result;
    if(command==='chatgpt_service_identity')result=c.identity();
    else if(command==='chatgpt_service_cancel')return;
    else if(command==='share_thread_access'){
      assert.deepEqual(clone(args.request.expectedIdentity),identity);assert.equal('conversationId'in args.request,false);
      result={statsigPayload:JSON.stringify(c.payload({has_updates:true,response_format:c.compact?'init-v2':'init-v1',user:{userID:identity.userId,customIDs:{account_id:identity.accountId}},feature_gates:{[c.hashed?hash('770071981'):'770071981']:{[c.compact?'v':'value']:c.gate}}}))};
    }else{
      assert.equal(command,'chatgpt_service_read');const request=args.request;assert.deepEqual(clone(request.params),{});assert.deepEqual(clone(request.expectedIdentity),identity);
      if(c.fail===request.operation)throw Error('fixture service read failed');const body=request.operation==='share_accounts'?c.accounts({account_ordering:['selected-alias'],accounts:{'selected-alias':{account:{account_id:identity.accountId,plan_type:c.plan}}}}):request.operation==='gpts_workspace_settings'?c.settings:(()=>{throw Error('unexpected remote read')})();
      result=c.envelope({requestId:request.requestId,identity:clone(identity),body});
    }
    c.after(command);return result;
  }};
  const modules=new Map();
  function load(file){if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
      {exports,AbortController,crypto:{randomUUID:()=>`chat-access-${++serial}`},navigator:{userAgent:'Offline fixture',userAgentData:{brands:[{brand:'Chromium',version:'140'}],platform:'Windows'}},localStorage:{getItem:()=> 'fixture-device'},require:name=>name==='./bridge'?bridge:load(`src/${name.slice(2)}.ts`)},{filename:file});return exports;}
  return {c,calls,controller,read:()=>load('src/chatgptConversationAccess.ts').readChatgptConversationAccess(controller.signal),reads:()=>calls.filter(call=>call.command==='chatgpt_service_read').map(call=>call.args.request)};
}
let passed=0;async function test(name,run){await run();passed++;console.log('PASS',name)}
await test('strict Chat account uses raw selected inventory and gate false without workspace or GPT gates',async()=>{
  const h=fixture(),result=await h.read();assert.deepEqual(clone(result),{identity,status:'enabled'});
  assert.deepEqual(h.reads().map(r=>r.operation),['share_accounts']);assert.equal(h.calls.filter(c=>c.command==='share_thread_access').length,1);
});

await test('all exact supported plans and unknown/case/usage plans do not borrow Work or RPC plan',async()=>{
  const plans=['free','go','plus','pro','promax','prolite','free_workspace','team','self_serve_business_prolite','sci','rosalind_academic','business','enterprise_cbp_trial','enterprise_cbp_view_only','finserv','law','ent26','education','edu_plus','edu_pro','quorum','enterprise','hc','hc_consumption','deprecated_enterprise','edu','deprecated_edu','k12'];
  for(const plan of plans){const h=fixture();h.c.plan=plan;h.c.account=v=>({...v,account:{...v.account,planType:'wrong-rpc-plan'}});assert.equal((await h.read()).status,'enabled');assert.equal(h.reads().length,1);}
  for(const plan of ['FREE','future-plan','self_serve_business_usage_based','enterprise_cbp_usage_based','enterprise_cbp_automation']){const h=fixture();h.c.plan=plan;h.c.account=v=>({...v,account:{...v.account,planType:'plus'}});const r=await h.read();assert.equal(r.status,'disabled');assert.equal(r.reason,'unsupported-plan');assert.equal(h.calls.some(c=>c.command==='share_thread_access'),false);}
});
await test('only strict chatgpt auth starts identity or services; malformed auth throws',async()=>{
  for(const auth of [null,'apiKey','chatgptAuthTokens','unknown']){const h=fixture();h.c.auth=auth;const r=await h.read();assert.equal(r.status,'disabled');assert.equal(r.identity,null);assert.equal(h.calls.length,1);}
  for(const auth of [undefined,17,{}]){const h=fixture();h.c.auth=auth;await assert.rejects(h.read(),/认证状态不完整/);assert.equal(h.calls.length,1);}
});
await test('full V1/V2 numeric-hashed gate supports identity-bound snapshots and never extra GPT gates',async()=>{
  for(const compact of [false,true])for(const hashed of [false,true]){const h=fixture();h.c.compact=compact;h.c.hashed=hashed;assert.equal((await h.read()).status,'enabled');}
  for(const mutate of [p=>({...p,user:{...p.user,userID:'foreign'}}),p=>({...p,user:{...p.user,customIDs:{account_id:'foreign'}}}),p=>({...p,is_delta:true}),p=>({...p,isDelta:'false'}),p=>({...p,live_overlay:{}}),p=>({...p,has_updates:false}),p=>({...p,response_format:'future'}),p=>({...p,feature_gates:{}}),p=>({...p,feature_gates:{'770071981':{value:'false'}}})]){
    const h=fixture();h.c.payload=mutate;await assert.rejects(h.read(),/快照|资格/);
  }
});
await test('permission gate false never reads workspace; true only exact permission plans require service permission',async()=>{
  for(const plan of ['business','enterprise','team','free']){
    const h=fixture();h.c.plan=plan;h.c.gate=false;h.c.fail='gpts_workspace_settings';assert.equal((await h.read()).status,'enabled');assert.equal(h.reads().some(r=>r.operation==='gpts_workspace_settings'),false);
  }
  for(const plan of ['business','enterprise','enterprise_cbp_trial','enterprise_cbp_view_only','deprecated_enterprise','hc','hc_consumption','finserv','law','ent26','education','edu_plus','edu_pro','edu','deprecated_edu','k12','quorum']){
    const h=fixture();h.c.plan=plan;h.c.gate=true;assert.equal((await h.read()).reason,'workspace-permission-denied');h.c.settings={permissions:['chatgpt.workspace.feature.desktop-app-chat.access']};assert.equal((await h.read()).status,'enabled');
  }
  for(const plan of ['team','self_serve_business_prolite','free','plus']){const h=fixture();h.c.plan=plan;h.c.gate=true;h.c.fail='gpts_workspace_settings';assert.equal((await h.read()).status,'enabled');assert.equal(h.reads().some(r=>r.operation==='gpts_workspace_settings'),false);}
  for(const settings of [{}, {permissions:null}, {permissions:[]}]){const h=fixture();h.c.plan='business';h.c.gate=true;h.c.settings=settings;assert.equal((await h.read()).status,'disabled');}
  for(const settings of [null,[],{permissions:'chatgpt.workspace.feature.desktop-app-chat.access'},{permissions:[17]}]){const h=fixture();h.c.plan='business';h.c.gate=true;h.c.settings=settings;await assert.rejects(h.read(),/权限格式/);}
});
await test('real experimentalFeatureListAll exhausts pages and explicit false beats absent default',async()=>{
  const h=fixture();h.c.featurePages=[{data:[{name:'other',enabled:true,stage:'beta'}],nextCursor:'1'},{data:[{name:'in_app_chat',enabled:false,stage:'beta'}],nextCursor:null}];
  assert.equal((await h.read()).reason,'experimental-disabled');assert.deepEqual(h.calls.filter(c=>c.method==='experimentalFeature/list').map(c=>c.params.cursor),[null,'1']);
  const duplicate=fixture();duplicate.c.featurePages=[{data:[{name:'in_app_chat',enabled:true,stage:'beta'},{name:'in_app_chat',enabled:false,stage:'beta'}],nextCursor:null}];assert.equal((await duplicate.read()).status,'enabled','source uses first find');
  for(const pages of [[{data:[],nextCursor:'1'},{data:[],nextCursor:'1'}],[{data:[],nextCursor:'1'},{data:[{name:'in_app_chat',enabled:'false',stage:'beta'}],nextCursor:null}]]){const bad=fixture();bad.c.featurePages=pages;await assert.rejects(bad.read(),/游标重复|格式无效/);}
});
await test('ordering aliases and first eligible account do not require unrelated member fields',async()=>{
  const h=fixture();h.c.accounts=()=>({account_ordering:['null','foreign','disabled','session','chosen'],accounts:{null:null,foreign:{account:{account_id:'other'}},disabled:{account:{account_id:identity.accountId,is_deactivated:true}},session:{account:{account_id:identity.accountId},can_access_with_session:false},chosen:{account:{account_id:identity.accountId,plan_type:'free'}}}});assert.equal((await h.read()).status,'enabled');
  const missing=fixture();missing.c.accounts=()=>({account_ordering:['foreign'],accounts:{foreign:{account:{account_id:'other'}}}});assert.equal((await missing.read()).reason,'missing-account');
  for(const accounts of [null,[],{accounts:{},account_ordering:null},{accounts:{chosen:{account:{account_id:identity.accountId}}},account_ordering:['chosen']}]){const bad=fixture();bad.c.accounts=()=>accounts;await assert.rejects(bad.read(),/清单不完整|计划尚未确认/);}
});
await test('read failures and wrong envelopes throw for error/retry rather than disabling or enabling',async()=>{
  for(const fail of ['getAuthStatus','account/read','share_accounts','experimentalFeature/list','gpts_workspace_settings']){const h=fixture();h.c.fail=fail;h.c.plan='business';h.c.gate=true;await assert.rejects(h.read());}
  const h=fixture();h.c.envelope=value=>({...value,identity:{...identity,generation:5}});await assert.rejects(h.read(),/账号发生变化/);
});
await test('account user generation routing and strict auth are fenced after async reads',async()=>{
  for(const field of ['accountId','userId','generation']){const h=fixture();let count=0;h.c.identity=()=>++count===1?clone(identity):{...identity,[field]:field==='generation'?5:'foreign'};await assert.rejects(h.read(),/账号发生变化/);}
  const routing=fixture();let accountReads=0;routing.c.account=v=>++accountReads===1?v:{...v,workspaceRouting:{chatgptAccountId:'foreign'}};await assert.rejects(routing.read(),/账号发生变化|路由/);
  const auth=fixture();auth.c.after=name=>{if(name==='share_thread_access')auth.c.auth='chatgptAuthTokens'};await assert.rejects(auth.read(),/认证方式发生变化/);
  const bad=fixture();bad.c.account=v=>({...v,workspaceRouting:{chatgptAccountId:'foreign'}});await assert.rejects(bad.read(),/账号发生变化|路由/);assert.equal(bad.reads().length,0);
});
await test('abort fences both entry and late bootstrap without writes or fake IDs',async()=>{
  const initial=fixture();initial.controller.abort();await assert.rejects(initial.read());assert.equal(initial.calls.length,0);
  const late=fixture();late.c.after=name=>{if(name==='share_thread_access')late.controller.abort()};await assert.rejects(late.read());assert.equal(late.reads().some(r=>r.operation==='gpts_workspace_settings'),false);
  assert.ok(late.calls.every(c=>!c.method||!c.method.includes('/set')));assert.ok(late.calls.every(c=>!c.command||!c.command.includes('write')));
});
console.log(`PASS ${passed} Chat access groups; isolated bridge, no service/model/config writes`);

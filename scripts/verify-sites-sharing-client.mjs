import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const identity = { accountId: 'account', userId: 'global-user', generation: 2 }, clone = value => structuredClone(value);
const policy = () => ({ access_mode: 'custom', users: [{ account_user_id: 'member', role: 'owner', email: 'owner@example.invalid' }], groups: [], available_access_modes: ['custom', 'workspace_all', 'public'] });
function fixture() {
  const calls = [], cache = new Map(); let serial = 0;
  const c = { identity: () => clone(identity), envelope: result => result, write: () => ({ status: 'accepted' }), account: () => ({ account: { type: 'chatgpt', email: 'OWNER@example.invalid' }, workspaceRouting: { chatgptAccountId: 'account' } }), read: operation => operation === 'share_accounts' ? {
    account_ordering: ['other', 'account'], accounts: { other: { account: { account_id: 'other' } }, account: { account: { account_id: 'account', account_user_id: 'member', account_user_role: 'standard-user', structure: 'workspace', plan_type: 'team', is_zdr: false } } },
  } : operation === 'sites_share_access' ? policy() : { live_url: 'https://preferred.example.invalid/exact' } };
  const bridge = { tauriInvoke: async (command, args) => { calls.push({ command, args }); if (command === 'chatgpt_service_identity') return c.identity(); if (command === 'chatgpt_service_cancel') return; const request = args.request;
    return c.envelope({ requestId: request.requestId, identity: clone(identity), body: await (command === 'chatgpt_service_sites_settings' ? c.write(request) : c.read(request.operation, request.params)) }); } };
  function load(file) { if (cache.has(file)) return cache.get(file); const exports = {}; cache.set(file, exports); const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(code, { exports, URL, AbortController, crypto: { randomUUID: () => `sharing-${++serial}` }, localStorage: { getItem: () => 'fixture-device' }, navigator: { userAgent: 'fixture', userAgentData: { platform: 'Windows', brands: [{ brand: 'Fixture', version: '1' }] } }, require: name => {
      if (name === './bridge') return bridge; if (name === './config') return { accountRead: async () => c.account() }; if (name === './remoteReview') return {}; return load(`src/${name.replace('./', '')}.ts`);
    } }); return exports; }
  return { api: load('src/sitesSharingClient.ts'), c, calls, signal: new AbortController().signal, access: { identity, enabled: true, workspace: false, editable: false, pinned: false, collectionPreview: false, slugChangeAllowed: false, sharingManagementAllowed: false, externalSharingAllowed: false }, writes: () => calls.filter(entry => entry.command === 'chatgpt_service_sites_settings'), reads: () => calls.filter(entry => entry.command === 'chatgpt_service_read') };
}
let groups = 0; async function test(name, fn) { await fn(); groups++; console.log('PASS', name); }
await test('current bound member is selected from raw map, independent of first ordering and Sites list capability', async () => {
  const h = fixture(), result = await h.api.readSiteSharingContext(h.access, h.signal);
  assert.equal(result.memberId, 'member'); assert.equal(result.email, 'OWNER@example.invalid'); assert.equal(result.workspace, true);
  assert.deepEqual(h.reads().map(entry => entry.args.request.operation), ['share_accounts']);
});
await test('missing auth email permits real member identity; foreign active account and API auth refuse', async () => {
  const h = fixture(); h.c.account = () => ({ account: { type: 'chatgpt' } }); assert.equal((await h.api.readSiteSharingContext(h.access, h.signal)).email, null);
  h.c.account = () => ({ account: { type: 'chatgpt' }, workspaceRouting: { chatgptAccountId: 'foreign' } }); await assert.rejects(h.api.readSiteSharingContext(h.access, h.signal));
  h.c.account = () => ({ account: { type: 'apiKey' } }); await assert.rejects(h.api.readSiteSharingContext(h.access, h.signal));
});
await test('policy and preferred live URL use two fixed independent reads, preserving raw opaque site id', async () => {
  const h = fixture(), id = 'site /?中'; assert.equal((await h.api.readSiteSharingPolicy(h.access, id, h.signal)).accessMode, 'custom');
  assert.equal(await h.api.readSiteSharingUrl(h.access, id, h.signal), 'https://preferred.example.invalid/exact');
  assert.deepEqual(clone(h.reads().map(entry => [entry.args.request.operation, entry.args.request.params])), [['sites_share_access', { id }], ['sites_preferred_live_url', { id }]]);
  h.c.read = () => null; assert.equal(await h.api.readSiteSharingPolicy(h.access, id, h.signal), null);
});
await test('write preserves accepted/pending/explicit null ACK and sends only typed access_mode mutation', async () => {
  const h = fixture(); for (const result of [null, { status: 'accepted', opaque: 'kept' }, { status: 'pending' }]) { h.c.write = () => result;
    assert.deepEqual(clone(await h.api.writeSiteSharingMode(h.access, 'site', 'workspace_all', h.signal)), result); }
  for (const entry of h.writes()) assert.deepEqual(clone(entry.args.request.mutation), { operation: 'share_access', access_mode: 'workspace_all' });
  assert.equal(h.reads().length, 0, 'write client does not hide a GET or automatically replay mutation');
});
await test('bad ACK or wrong identity remains unconfirmed and never automatically replays PATCH', async () => {
  for (const result of [undefined, {}, [], { status: 'success' }]) { const h = fixture(); h.c.write = () => result;
    await assert.rejects(h.api.writeSiteSharingMode(h.access, 'site', 'public', h.signal), error => error.code === 'site_sharing_unconfirmed'); assert.equal(h.writes().length, 1); }
  const h = fixture(); h.c.envelope = result => ({ ...result, identity: { ...identity, generation: 9 } });
  await assert.rejects(h.api.writeSiteSharingMode(h.access, 'site', 'public', h.signal), error => error.code === 'site_sharing_unconfirmed'); assert.equal(h.writes().length, 1);
});
await test('known service refusal preserves status, network ambiguity remains unknown, neither performs hidden reads', async () => {
  const h = fixture(); h.c.write = () => { throw { code: 'forbidden', status: 403 }; };
  await assert.rejects(h.api.writeSiteSharingMode(h.access, 'site', 'public', h.signal), error => error.status === 403 && error.code === 'forbidden');
  h.c.write = () => { throw { code: 'sites_settings_unknown', status: 500 }; };
  await assert.rejects(h.api.writeSiteSharingMode(h.access, 'site', 'public', h.signal), error => error.code === 'site_sharing_unconfirmed'); assert.equal(h.reads().length, 0);
});
await test('disabled entry, invalid mode and cancellation before call dispatch make zero service requests', async () => {
  const h = fixture(); h.access.enabled = false;
  await assert.rejects(h.api.readSiteSharingPolicy(h.access, 'site', h.signal)); await assert.rejects(h.api.writeSiteSharingMode(h.access, 'site', 'public', h.signal)); assert.equal(h.calls.length, 0);
  h.access.enabled = true; await assert.rejects(h.api.writeSiteSharingMode(h.access, 'site', 'admins_only', h.signal)); assert.equal(h.calls.length, 0);
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(h.api.readSiteSharingContext(h.access, aborted.signal)); await assert.rejects(h.api.writeSiteSharingMode(h.access, 'site', 'public', aborted.signal)); assert.equal(h.calls.length, 0);
});
await test('late account change cannot confirm a policy read or a successful mutation', async () => {
  const h = fixture(); h.c.read = () => { h.c.identity = () => ({ ...identity, generation: 3 }); return policy(); };
  await assert.rejects(h.api.readSiteSharingPolicy(h.access, 'site', h.signal), /账号/);
  h.c.identity = () => clone(identity); h.c.write = () => { h.c.identity = () => ({ ...identity, generation: 3 }); return null; };
  await assert.rejects(h.api.writeSiteSharingMode(h.access, 'site', 'custom', h.signal), error => error.code === 'site_sharing_unconfirmed'); assert.equal(h.writes().length, 1);
});
await test('member wrapper preserves null, role_id and pending ACK with exact typed recipient/email mutations', async()=>{
  const h=fixture();for(const result of [null,{status:'accepted',role_id:'role-site-editor',opaque:'kept'},{status:'pending',role_id:'role-site-viewer'}]){h.c.write=()=>result;assert.deepEqual(clone(await h.api.writeSiteSharingMember(h.access,'site /?中',{kind:'user',id:'member /?中'},'editor',h.signal)),result);}
  await h.api.writeSiteSharingMember(h.access,'site',{kind:'group',id:'group /?中'},null,h.signal);await h.api.writeSiteSharingMember(h.access,'site',{kind:'email',email:'Guest@Example.invalid'},null,h.signal);
  assert.deepEqual(clone(h.writes().at(-2).args.request.mutation),{operation:'share_recipient',recipient:'group /?中',recipient_type:'group',role:null});assert.deepEqual(clone(h.writes().at(-1).args.request.mutation),{operation:'share_email_remove',email:'Guest@Example.invalid'});assert.equal(h.reads().length,0);
});
await test('external gate uses exact source plans and loaded permissions while editor gate stays independent',async()=>{
  const plans=['business','enterprise','enterprise_cbp_usage_based','enterprise_cbp_automation','enterprise_cbp_trial','enterprise_cbp_view_only','deprecated_enterprise','hc','hc_consumption','finserv','law','ent26','education','edu_plus','edu_pro','edu','deprecated_edu','k12','quorum'];
  for(const plan of [...plans,'team','free'])for(const owner of [false,true]){const h=fixture(),read=h.c.read;h.access.sharingManagementAllowed=true;h.access.externalSharingAllowed=true;h.c.read=(operation,params)=>{if(operation==='sites_workspace_settings')return{permissions:[]};const value=read(operation,params);if(operation==='share_accounts'){value.accounts.account.account.plan_type=plan;value.accounts.account.account.account_user_role=owner?'account-owner':'standard-user';}return value;};const c=await h.api.readSiteSharingContext(h.access,h.signal);assert.equal(c.canManageEditors,true);assert.equal(c.sharingManagementAllowed,true);assert.equal(c.canInviteExternal,!plans.includes(plan)||owner);assert.equal(c.externalPermissionError,null);assert.equal(h.reads().filter(r=>r.args.request.operation==='sites_workspace_settings').length,plans.includes(plan)?1:0);}
});
await test('workspace permission grants nonowner, missing/error cannot grant owner and does not block existing member capability',async()=>{for(const settings of [{permissions:['chatgpt.workspace.feature.sites.invite_external.access']},{},null,'failure']){const h=fixture(),read=h.c.read;h.access.sharingManagementAllowed=true;h.access.externalSharingAllowed=true;h.c.read=(operation,params)=>{if(operation==='sites_workspace_settings'){if(settings==='failure')throw Error('permission unavailable');return settings;}const value=read(operation,params);if(operation==='share_accounts'){value.accounts.account.account.plan_type='business';value.accounts.account.account.account_user_role=settings?.permissions?'standard-user':'account-owner';}return value;};const c=await h.api.readSiteSharingContext(h.access,h.signal);assert.equal(c.canInviteExternal,Array.isArray(settings?.permissions));assert.equal(c.canManageEditors,true);assert.equal(c.externalPermissionError===null,Array.isArray(settings?.permissions));assert.equal(c.memberId,'member');}});
await test('external gate false avoids settings even for owner; personal listed plan never borrows workspace permissions',async()=>{for(const workspace of [false,true]){const h=fixture(),read=h.c.read;h.access.externalSharingAllowed=!workspace;h.c.read=(operation,params)=>{const value=read(operation,params);if(operation==='share_accounts'){Object.assign(value.accounts.account.account,{structure:workspace?'workspace':'personal',plan_type:'business',account_user_role:'account-owner'});}return value;};const c=await h.api.readSiteSharingContext(h.access,h.signal);assert.equal(c.canInviteExternal,false);assert.equal(c.canManageEditors,false);assert.equal(h.reads().some(r=>r.args.request.operation==='sites_workspace_settings'),false);}});
await test('member invalid role/target combinations never dispatch; malformed ACK stays unknown once',async()=>{const h=fixture();for(const [target,role]of [[{kind:'email',email:'guest@example.invalid'},'editor'],[{kind:'email',email:'guest@example.invalid'},'viewer'],[{kind:'group',id:'group'},'editor'],[{kind:'user',id:''},null]])await assert.rejects(h.api.writeSiteSharingMember(h.access,'site',target,role,h.signal));assert.equal(h.writes().length,0);for(const result of [undefined,{},[],{status:'success'}]){h.c.write=()=>result;await assert.rejects(h.api.writeSiteSharingMember(h.access,'site',{kind:'user',id:'member'},null,h.signal),e=>e.code==='site_sharing_unconfirmed');}assert.equal(h.writes().length,4);assert.equal(h.reads().length,0);});
await test('member known refusal and unknown result preserve error classification without hidden replay',async()=>{const h=fixture();h.c.write=()=>{throw{code:'forbidden',status:403}};await assert.rejects(h.api.writeSiteSharingMember(h.access,'site',{kind:'user',id:'member'},null,h.signal),e=>e.code==='forbidden'&&e.status===403);h.c.write=()=>{throw{code:'sites_settings_unknown',status:500}};await assert.rejects(h.api.writeSiteSharingMember(h.access,'site',{kind:'user',id:'member'},'viewer',h.signal),e=>e.code==='site_sharing_unconfirmed'&&e.cause.code==='sites_settings_unknown');assert.equal(h.writes().length,2);assert.equal(h.reads().length,0);});
await test('member cancellation and late identity reject accepted ACK without another write',async()=>{const h=fixture(),controller=new AbortController();let release;h.c.write=()=>new Promise(resolve=>release=resolve);const work=h.api.writeSiteSharingMember(h.access,'site',{kind:'user',id:'member'},null,controller.signal);for(let i=0;i<12&&!release;i++)await Promise.resolve();assert.ok(release);controller.abort();release({status:'accepted'});await assert.rejects(work,e=>e.code==='site_sharing_unconfirmed');assert.equal(h.calls.filter(c=>c.command==='chatgpt_service_cancel').length,1);h.c.write=()=>{h.c.identity=()=>({...identity,generation:4});return null;};await assert.rejects(h.api.writeSiteSharingMember(h.access,'site',{kind:'group',id:'group'},null,h.signal),e=>e.code==='site_sharing_unconfirmed');assert.equal(h.writes().length,2);});
console.log(`PASS ${groups} Sites sharing client/actual wrapper groups; explicit offline bridge; not HTTP/native/pixel acceptance`);

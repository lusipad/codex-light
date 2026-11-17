import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const identity = { accountId: 'work-account', userId: 'work-user', generation: 2 };
const clone = value => JSON.parse(JSON.stringify(value));
const surfaces = { supportedSurface: true, workCloudSupportedSurface: true };
function fixture() {
  const calls = []; let serial = 0;
  const c = { plan: 'business', auth: 'chatgpt', gates: { '1463309241': true, '1625797156': true }, compact: false, hashed: false,
    workspace: { admin_work_mode_enabled: true, admin_work_local_enabled: false, beta_settings: { wham_local_access: false } },
    workspaceError: null, payload: value => value, identity: () => clone(identity), after: () => {}, account: value => value };
  const bridge = {
    callAppServer: async (method, params) => {
      calls.push({ method, params: clone(params) }); assert.equal(method, 'account/read'); assert.deepEqual(clone(params), { refreshToken: false });
      const value = c.account({ account: { type: c.auth, planType: c.plan }, workspaceRouting: { chatgptAccountId: identity.accountId } });
      c.after(method); return value;
    },
    tauriInvoke: async (command, args) => {
      calls.push({ command, args: clone(args) });
      if (command === 'chatgpt_service_identity') return c.identity();
      if (command === 'chatgpt_service_cancel') return;
      let result;
      if (command === 'share_thread_access') {
        assert.deepEqual(clone(args.request.expectedIdentity), identity);
        const hash = key => { let n = 0; for (const ch of key) n = (Math.imul(n, 31) + ch.charCodeAt(0)) >>> 0; return String(n); };
        result = { statsigPayload: JSON.stringify(c.payload({ has_updates: true, response_format: c.compact ? 'init-v2' : 'init-v1',
          user: { userID: identity.userId, customIDs: { account_id: identity.accountId } },
          feature_gates: Object.fromEntries(Object.entries(c.gates).map(([key, value]) => [c.hashed ? hash(key) : key, { [c.compact ? 'v' : 'value']: value }])) })) };
      } else {
        assert.equal(command, 'chatgpt_service_read'); const r = args.request;
        assert.equal(r.operation, 'cloud_workspace_settings'); assert.deepEqual(clone(r.params), {});
        assert.deepEqual(clone(r.expectedIdentity), identity);
        if (c.workspaceError) throw c.workspaceError;
        result = { requestId: r.requestId, identity: clone(identity), body: c.workspace };
      }
      c.after(command); return result;
    },
  };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
      { exports, AbortController, crypto: { randomUUID: () => `work-${++serial}` }, navigator: { userAgent: 'Offline Work test',
        userAgentData: { brands: [{ brand: 'Chromium', version: '140' }], platform: 'Windows' } }, localStorage: { getItem: () => 'offline-device' },
        require: name => name === './bridge' ? bridge : load(`src/${name.slice(2)}.ts`) }, { filename: file });
    return exports;
  }
  return { c, calls, api: load('src/workAccess.ts'), read: (s = surfaces, signal = new AbortController().signal) => load('src/workAccess.ts').readLocalWorkAccess(signal, s) };
}
let passed = 0;
async function test(name, run) { await run(); console.log('PASS', name); ++passed; }
await test('real reader uses auth plan, explicit surfaces and workspace GET without inventory permissions', async () => {
  const h = fixture(), result = await h.read();
  assert.equal(result.combined.status, 'allowed'); assert.equal(result.combined.accountId, identity.accountId);
  assert.ok(!h.calls.some(call => call.args?.request?.operation === 'share_accounts'));
});
const input = overrides => ({ accountId: 'a', plan: 'business', authMethod: 'chatgpt', authLoading: false,
  accountInfoLoading: false, accountInfoError: false, ...surfaces, ...overrides });
const query = overrides => ({ isLoading: false, isError: false, adminWorkLocalEnabled: true,
  adminWorkModeEnabled: true, whamLocalAccess: false, whamAccess: false, ...overrides });
const allow = accountId => ({ status: 'allowed', accountId });
const deny = reason => ({ status: 'denied', reason });
await test('A/V source precedence covers surfaces, auth, loading, missing accounts, query states and strict booleans', async () => {
  const { api } = fixture();
  const cases = [
    [{ supportedSurface: false, authLoading: true, authMethod: null }, query(), deny('unsupported-surface')],
    [{ authLoading: true, authMethod: null }, query(), { status: 'loading' }],
    [{ authMethod: 'apiKey', accountInfoError: true }, query(), allow(null)],
    [{ accountInfoError: true }, query(), { status: 'error', source: 'account-info' }],
    [{ accountInfoLoading: true, plan: null }, query(), { status: 'loading' }],
    [{ accountId: null }, query(), deny('missing-account')],
    [{ plan: 'plus' }, null, allow('a')],
    [{}, null, { status: 'loading' }],
    [{}, query({ isLoading: true, isError: true }), { status: 'loading' }],
    [{}, query({ isError: true }), { status: 'error', source: 'workspace-settings' }],
    [{}, query({ whamLocalAccess: true }), allow('a')],
    [{}, query({ whamLocalAccess: null }), deny('workspace-disabled')],
    [{ accountInfoLoading: true }, query({ whamLocalAccess: true }), { status: 'loading' }],
    [{ accountInfoLoading: true, plan: 'plus' }, query({ isLoading: true }), allow('a')],
  ];
  for (const [overrides, workspace, expected] of cases) assert.deepEqual(clone(api.projectWorkBase(input(overrides), workspace).local), expected);
  for (const auth of ['chatgptAuthTokens', 'copilot', 'apiKey', null]) {
    const result = api.projectWorkBase(input({ authMethod: auth, plan: 'plus' }), null);
    assert.deepEqual(clone(result.workCloud), deny('unsupported-auth'));
    assert.deepEqual(clone(result.workLocal), auth === 'copilot' ? deny('unsupported-auth') : allow(auth === 'chatgptAuthTokens' ? 'a' : null));
  }
  assert.equal(api.needsWorkWorkspace(input({ plan: 'plus' })), false);
  assert.equal(api.needsWorkWorkspace(input({ supportedSurface: false, workCloudSupportedSurface: true })), true);
  assert.equal(api.needsWorkWorkspace(input({ accountInfoLoading: true })), false);
});
await test('organization 146 modern admin fields and legacy local access remain independent', async () => {
  const { api } = fixture();
  for (const modern of [false, true]) for (const cloud of [false, true]) for (const local of [false, true]) for (const legacy of [false, true]) {
    const r = api.projectWorkAccess(input(), query({ adminWorkModeEnabled: cloud, adminWorkLocalEnabled: local, whamLocalAccess: legacy, whamAccess: !legacy }), { gate146: modern, gate162: null });
    assert.deepEqual(clone(r.workCloud), (modern ? cloud : legacy) ? allow('a') : deny('workspace-disabled'));
    assert.deepEqual(clone(r.workLocal), (modern ? local : legacy) ? allow('a') : deny('workspace-disabled'));
    assert.equal(r.combined.status, (modern ? cloud || local : legacy) ? 'allowed' : 'denied');
    assert.deepEqual(clone(r.missingGates), []);
  }
});
await test('all six personal plans obey free/go short circuits and personal cloud rollout order', async () => {
  const { api } = fixture();
  for (const plan of ['free', 'go', 'plus', 'prolite', 'pro', 'promax']) for (const modern of [false, true]) for (const rollout of [false, true]) {
    const result = api.projectWorkAccess(input({ plan }), null, { gate146: modern, gate162: rollout });
    assert.deepEqual(clone(result.workLocal), allow('a'));
    assert.deepEqual(clone(result.workCloud), plan === 'free' || plan === 'go' ? deny(`${plan}-plan`) : rollout ? allow('a') : deny('rollout-disabled'));
    assert.equal(result.combined.status, 'allowed');
  }
  for (const plan of ['free', 'go']) {
    const r = api.projectWorkAccess(input({ plan }), null, { gate146: null, gate162: null });
    assert.equal(r.combined.status, 'allowed'); assert.deepEqual(clone(r.missingGates), []);
  }
});
await test('two surfaces are independent; missing gates do not become legacy false', async () => {
  const { api } = fixture();
  const cloudOnly = api.projectWorkAccess(input({ plan: 'plus', supportedSurface: false, workCloudSupportedSurface: true }), null, { gate146: null, gate162: true });
  assert.deepEqual(clone(cloudOnly.workCloud), allow('a')); assert.equal(cloudOnly.workLocal, null); assert.equal(cloudOnly.combined.status, 'allowed');
  const localOnly = api.projectWorkAccess(input({ plan: 'plus', workCloudSupportedSurface: false }), null, { gate146: true, gate162: null });
  assert.deepEqual(clone(localOnly.workCloud), deny('unsupported-surface')); assert.equal(localOnly.workLocal.status, 'allowed');
  const unknown = api.projectWorkAccess(input(), query({ whamLocalAccess: true }), { gate146: null, gate162: null });
  assert.equal(unknown.workCloud, null); assert.equal(unknown.workLocal, null); assert.equal(unknown.combined, null);
  assert.deepEqual(clone(unknown.missingGates), ['1463309241']);
  const knownLocal = api.projectWorkAccess(input({ plan: 'plus' }), null, { gate146: true, gate162: null });
  assert.equal(knownLocal.workCloud, null); assert.equal(knownLocal.combined.status, 'allowed');
});
await test('z all sixteen combinations preserve allowed account, error source and left denial', async () => {
  const { api } = fixture();
  const left = [allow('left'), { status: 'loading' }, { status: 'error', source: 'account-info' }, deny('free-plan')];
  const right = [allow('right'), { status: 'loading' }, { status: 'error', source: 'workspace-settings' }, deny('go-plan')];
  const expected = [
    [left[0], left[0], left[0], left[0]],
    [right[0], { status: 'loading' }, { status: 'loading' }, { status: 'loading' }],
    [right[0], { status: 'loading' }, left[2], left[2]],
    [right[0], { status: 'loading' }, right[2], left[3]],
  ];
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) assert.deepEqual(clone(api.mergeWorkAccess(left[a], right[b])), expected[a][b]);
  for (const known of [left[1], left[2], left[3]]) { assert.equal(api.mergeWorkAccess(null, known), null); assert.equal(api.mergeWorkAccess(known, null), null); }
  assert.equal(api.mergeWorkAccess(null, null), null); assert.equal(api.mergeWorkAccess(null, right[0]), right[0]);
});
await test('personal reader omits workspace and only requests gate bootstrap on reached branches', async () => {
  for (const plan of ['free', 'go', 'plus', 'prolite', 'pro', 'promax']) {
    const h = fixture(); h.c.plan = plan; h.c.workspaceError = Error('must never read workspace');
    assert.equal((await h.read()).combined.status, 'allowed');
    assert.equal(h.calls.filter(x => x.args?.request?.operation === 'cloud_workspace_settings').length, 0);
    assert.equal(h.calls.filter(x => x.command === 'share_thread_access').length, ['free', 'go'].includes(plan) ? 0 : 1);
  }
  const h = fixture(); h.c.plan = 'new-nonempty-org-plan'; assert.equal((await h.read()).combined.status, 'allowed');
});
await test('full V1/V2 gate hashes bind identity and missing/delta snapshots stay unknown', async () => {
  for (const compact of [false, true]) for (const hashed of [false, true]) {
    const h = fixture(); Object.assign(h.c, { compact, hashed }); delete h.c.gates['1625797156'];
    assert.equal((await h.read()).combined.status, 'allowed');
  }
  for (const mode of ['missing', 'account', 'user', 'delta', 'incomplete', 'format', 'bad-gate']) {
    const h = fixture(); h.c.workspace.beta_settings.wham_local_access = true;
    if (mode === 'missing') delete h.c.gates['1463309241'];
    if (mode === 'bad-gate') h.c.gates['1463309241'] = 'false';
    h.c.payload = value => { if (mode === 'account') value.user.customIDs.account_id = 'other'; if (mode === 'user') value.user.userID = 'other';
      if (mode === 'delta') value.is_delta = true; if (mode === 'incomplete') delete value.has_updates; if (mode === 'format') value.response_format = 'future'; return value; };
    assert.equal((await h.read()).combined, null, mode);
  }
});
await test('workspace fields are strict only for their consumed branch, with no permission gate', async () => {
  const h = fixture(); h.c.workspace.permissions = 123; h.c.workspace.beta_settings.wham_access = 'irrelevant-invalid';
  assert.equal((await h.read()).combined.status, 'allowed');
  h.c.workspace.admin_work_mode_enabled = 'true'; h.c.workspace.admin_work_local_enabled = false;
  assert.deepEqual(clone((await h.read()).combined), { status: 'error', source: 'workspace-settings' });
  for (const raw of [undefined, null, false]) {
    const denied = fixture(); denied.c.workspace = { admin_work_mode_enabled: raw, admin_work_local_enabled: raw };
    assert.equal((await denied.read()).combined.status, 'denied');
  }
  for (const malformed of [true, false, [], 'bad', 1]) {
    const legacy = fixture(); legacy.c.gates['1463309241'] = false; legacy.c.workspace.beta_settings = malformed;
    assert.deepEqual(clone((await legacy.read()).combined), { status: 'error', source: 'workspace-settings' });
  }
});
await test('401/403/404 and network refusal cannot reuse a prior allowed workspace', async () => {
  const h = fixture(); assert.equal((await h.read()).combined.status, 'allowed');
  for (const status of [401, 403, 404, 'network_policy']) {
    h.c.workspaceError = Object.assign(Error('workspace unavailable'), { status });
    assert.deepEqual(clone((await h.read()).combined), { status: 'error', source: 'workspace-settings' });
  }
  h.c.workspaceError = null; assert.equal((await h.read()).combined.status, 'allowed');
});
await test('actual reader rejects unsupported auth and requires explicit surfaces without HTTP', async () => {
  for (const auth of ['apiKey', 'amazonBedrock', 'chatgptAuthTokens', 'copilot', null]) {
    const h = fixture(); h.c.auth = auth;
    await assert.rejects(h.read(), error => error.code === 'unsupported_auth');
    assert.equal(h.calls.length, 1);
  }
  const h = fixture(); await assert.rejects(h.read({ supportedSurface: true })); assert.equal(h.calls.length, 0);
});
await test('identity, relevant auth/plan/route changes and cancellation reject late allow', async () => {
  for (const invalid of [{ ...identity, userId: 1 }, { ...identity, userId: '' }, { ...identity, generation: -1 }]) {
    const h = fixture(); h.c.plan = 'free'; h.c.identity = () => invalid;
    await assert.rejects(h.read(), error => error.code === 'account_changed');
    assert.equal(h.calls.filter(call => call.command === 'share_thread_access' || call.command === 'chatgpt_service_read').length, 0);
  }
  for (const field of ['accountId', 'userId', 'generation']) {
    const h = fixture(); h.c.after = command => { if (command === 'chatgpt_service_read') h.c.identity = () => ({ ...identity, [field]: field === 'generation' ? 3 : 'changed' }); };
    await assert.rejects(h.read(), error => error.code === 'account_changed');
  }
  for (const field of ['plan', 'auth', 'route']) {
    const h = fixture(); let reads = 0;
    h.c.account = value => { if (++reads === 2) { if (field === 'plan') value.account.planType = 'plus'; if (field === 'auth') value.account.type = 'apiKey'; if (field === 'route') value.workspaceRouting.chatgptAccountId = 'other'; } return value; };
    await assert.rejects(h.read(), error => error.code === 'account_changed');
  }
  const h = fixture(); let reads = 0; h.c.account = value => ({ ...value, account: { ...value.account, email: `unrelated-${++reads}` } });
  assert.equal((await h.read()).combined.status, 'allowed');
  const cancelled = fixture(), controller = new AbortController(); controller.abort(); await assert.rejects(cancelled.read(surfaces, controller.signal)); assert.equal(cancelled.calls.length, 0);
  const active = fixture(), pending = new AbortController(); active.c.after = command => { if (command === 'chatgpt_service_read') pending.abort(); };
  await assert.rejects(active.read(surfaces, pending.signal));
  for (const outcome of ['abort', 'user', 'generation']) {
    const personal = fixture(), request = new AbortController(); personal.c.plan = 'plus';
    personal.c.after = command => {
      if (command !== 'share_thread_access') return;
      if (outcome === 'abort') request.abort();
      else personal.c.identity = () => ({ ...identity, ...(outcome === 'user' ? { userId: 'other-user' } : { generation: 3 }) });
    };
    await assert.rejects(personal.read(surfaces, request.signal), error => outcome === 'abort' ? request.signal.aborted : error.code === 'account_changed');
    assert.equal(personal.calls.filter(call => call.command === 'share_thread_access').length, 1);
    assert.equal(personal.calls.filter(call => call.args?.request?.operation === 'cloud_workspace_settings').length, 0);
  }
  const finalRead = fixture(), finalRequest = new AbortController(); let accountReads = 0;
  finalRead.c.account = value => { ++accountReads; return value; };
  finalRead.c.after = method => { if (method === 'account/read' && accountReads === 2) finalRequest.abort(); };
  await assert.rejects(finalRead.read(surfaces, finalRequest.signal), error => finalRequest.signal.aborted);
  assert.equal(accountReads, 2, 'cancellation actually occurs during the final auth read');
  for (const changedField of ['userId', 'generation']) {
    const failedWorkspace = fixture(); let identityReads = 0;
    failedWorkspace.c.workspaceError = Object.assign(Error('workspace request failed'), { status: 403 });
    failedWorkspace.c.identity = () => ++identityReads === 1 ? clone(identity)
      : { ...identity, [changedField]: changedField === 'generation' ? 3 : 'other-user' };
    await assert.rejects(failedWorkspace.read(), error => error.code === 'account_changed');
    assert.equal(failedWorkspace.calls.filter(call => call.args?.request?.operation === 'cloud_workspace_settings').length, 1);
    assert.equal(failedWorkspace.calls.filter(call => call.command === 'share_thread_access').length, 0, 'identity retirement is not swallowed as a workspace error');
  }
});
console.log(`PASS ${passed} Work access groups; official decision tables, real TS service wrappers, offline bridge, zero HTTP/model or key activity`);

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const identity = { accountId: 'orchestration-account', userId: 'orchestration-user', generation: 4 };
const clone = value => JSON.parse(JSON.stringify(value));
const permission = 'chatgpt.workspace.feature.cloud-orchestration.access';
function fixture() {
  const calls = []; let serial = 0, infoReads = 0, accountReads = 0;
  const c = { plan: 'business', authMethod: 'chatgpt', gates: { '3063076119': false, '1315865107': true, '3683713372': false, '2465577016': true, '3559027740': false },
    compact: false, hashed: false, payload: value => value, identity: () => clone(identity), after() {},
    workspace: { permissions: [permission] }, config: { config: { model_provider: 'openai' } }, settings: { settings: { lockdown_mode_enabled: false } },
    fail: null, info: value => value, account: value => value };
  const bridge = {
    callAppServer: async (method, params) => {
      calls.push({ method, params: clone(params) }); let result;
      if (method === 'account/read') {
        assert.deepEqual(clone(params), { refreshToken: false });
        result = c.account({ account: { type: 'chatgpt', planType: 'deliberately-unrelated' }, workspaceRouting: { chatgptAccountId: identity.accountId } }, ++accountReads);
      } else {
        assert.equal(method, 'config/read'); assert.deepEqual(clone(params), { includeLayers: true, cwd: null });
        if (c.fail === 'config') { await c.after(method); throw Error('offline config failure'); } result = c.config;
      }
      await c.after(method); return result;
    },
    tauriInvoke: async (command, args) => {
      calls.push({ command, args: clone(args) });
      if (command === 'chatgpt_service_identity') return c.identity();
      if (command === 'chatgpt_service_cancel') return;
      const r = args.request; assert.deepEqual(clone(r.expectedIdentity), identity); let result;
      if (command === 'work_account_info') {
        result = await c.info({ requestId: r.requestId, identity: clone(identity), authMethod: c.authMethod, plan: c.plan }, ++infoReads);
      } else if (command === 'share_thread_access') {
        if (c.fail === 'bootstrap') { await c.after(command); throw Error('offline bootstrap failure'); }
        const hash = key => { let v = 0; for (const char of key) v = (Math.imul(v, 31) + char.charCodeAt(0)) >>> 0; return String(v); };
        result = { statsigPayload: JSON.stringify(c.payload({ has_updates: true, response_format: c.compact ? 'init-v2' : 'init-v1',
          user: { userID: identity.userId, customIDs: { account_id: identity.accountId } },
          feature_gates: Object.fromEntries(Object.entries(c.gates).map(([key, value]) => [c.hashed ? hash(key) : key, { [c.compact ? 'v' : 'value']: value }])) })) };
      } else {
        assert.equal(command, 'chatgpt_service_read'); assert.deepEqual(clone(r.params), {});
        assert.ok(['cloud_workspace_settings', 'library_settings'].includes(r.operation));
        const source = r.operation === 'cloud_workspace_settings' ? 'workspace' : 'lockdown';
        if (c.fail === source) { await c.after(r.operation); throw Error('offline ' + source + ' failure'); }
        result = { requestId: r.requestId, identity: clone(identity), body: source === 'workspace' ? c.workspace : c.settings };
        await c.after(r.operation);
      }
      await c.after(command); return result;
    },
  };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
      { exports, AbortController, crypto: { randomUUID: () => `orchestration-${++serial}` }, navigator: { userAgent: 'Offline orchestration test',
        userAgentData: { brands: [{ brand: 'Chromium', version: '140' }], platform: 'Windows' } }, localStorage: { getItem: () => 'offline-device' },
        require: name => name === './bridge' ? bridge : load(`src/${name.slice(2)}.ts`) }, { filename: file });
    return exports;
  }
  return { c, calls, api: load('src/workOrchestrationAccess.ts'), read: (signal = new AbortController().signal) => load('src/workOrchestrationAccess.ts').readLocalWorkOrchestration(signal),
    isEnterprise: load('src/workRunLocation.ts').isWorkEnterprisePlan };
}
let passed = 0;
async function test(name, run) { await run(); console.log('PASS', name); ++passed; }
await test('independent capability reads existing identity-bound channels without unnecessary workspace or config', async () => {
  const h = fixture(), result = await h.read();
  assert.deepEqual(clone(result.capability), { isLoading: false, isError: false, isCapable: true });
  assert.equal(result.lockdown.state, 'disabled'); assert.equal(result.lockdown.loaded, true);
  assert.ok(!h.calls.some(x => x.method === 'config/read' || x.args?.request?.operation === 'cloud_workspace_settings'));
  assert.equal(h.calls.filter(x => x.args?.request?.operation === 'library_settings').length, 1);
});
const flags = (isCapable, isLoading = false, isError = false) => ({ isLoading, isError, isCapable });
const account = overrides => ({ authLoading: false, authMethod: 'chatgpt', accountLoading: false, accountInfoError: false,
  accountId: identity.accountId, authenticatedAccountId: identity.accountId, plan: 'business', ...overrides });
const query = (data, overrides = {}) => ({ data, isLoading: false, isError: false, ...overrides });
const capabilityInput = overrides => ({ account: account(), gate306: true, gate131: true, gate131Loading: false, gate368: false,
  workspace: query({ permissions: [permission] }), config: query(undefined), ...overrides });
await test('three gate combinations require only their real workspace and first-party branches', async () => {
  for (const policy of [false, true]) for (const rollout of [false, true]) for (const firstParty of [false, true]) {
    const h = fixture(); h.c.gates['3063076119'] = policy; h.c.gates['1315865107'] = rollout; h.c.gates['3683713372'] = firstParty;
    const result = await h.read();
    assert.deepEqual(clone(result.capability), flags(rollout));
    assert.equal(h.calls.filter(call => call.args?.request?.operation === 'cloud_workspace_settings').length, policy ? 1 : 0);
    assert.equal(h.calls.filter(call => call.method === 'config/read').length, firstParty ? 1 : 0);
  }
});
await test('policy auth and account short circuits preserve loading/error/capable independently', async () => {
  const { api } = fixture();
  const cases = [
    [{ authLoading: true, authMethod: null, accountInfoError: true }, query(undefined), flags(false, true)],
    [{ accountLoading: true, accountInfoError: true }, query(undefined), flags(false, true)],
    [{ authMethod: 'chatgptAuthTokens', accountInfoError: true, plan: null }, query(undefined), flags(true)],
    [{ accountInfoError: true }, query({ permissions: [permission] }), flags(false, false, true)],
    [{ accountId: null }, query({ permissions: [permission] }), flags(false)],
    [{ authenticatedAccountId: 'another-account' }, query({ permissions: [permission] }), flags(false)],
    [{ plan: null }, query({ permissions: [permission] }), flags(false)],
    [{ plan: 'team' }, query(undefined, { isError: true }), flags(true)],
    [{}, query(undefined), flags(false, true)],
    [{}, query(undefined, { isLoading: true, isError: true }), flags(false, true, true)],
    [{}, query(undefined, { isError: true }), flags(false, false, true)],
  ];
  for (const [overrides, workspace, expected] of cases) assert.deepEqual(clone(api.projectWorkOrchestrationPolicy(account(overrides), workspace)), expected);
  const result = api.projectWorkOrchestrationCapability(capabilityInput({ gate131Loading: true,
    workspace: query(undefined, { isError: true }), gate368: true, config: query(undefined, { isError: true }) }));
  assert.deepEqual(clone(result.capability), flags(false, true, true), 'errors do not hide independently true loading');
  assert.deepEqual(clone(api.projectWorkOrchestrationCapability(capabilityInput({ gate306: false, account: account({ accountInfoError: true }) })).capability), flags(true));
});
await test('enterprise policy uses the shared plan table and exactly one permission', async () => {
  // Exercise every shared table member without maintaining a second enterprise list.
  const ast = ts.createSourceFile('workRunLocation.ts', fs.readFileSync('src/workRunLocation.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  let plans;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'enterprisePlans') plans = node.initializer.arguments[0].elements.map(value => value.text); ts.forEachChild(node, visit); }
  visit(ast); assert.equal(plans.length, 19);
  const h = fixture();
  for (const plan of [...plans, 'plus', 'free', 'team', '', 'unknown-future-plan']) {
    const result = h.api.projectWorkOrchestrationPolicy(account({ plan }), query({ permissions: [] }));
    assert.equal(result.isCapable, !h.isEnterprise(plan), plan);
  }
  for (const permissions of [undefined, null, [], ['chatgpt.workspace.feature.allow-codex-access.access']]) {
    assert.deepEqual(clone(h.api.projectWorkOrchestrationPolicy(account(), query({ permissions }))), flags(false));
  }
  assert.deepEqual(clone(h.api.projectWorkOrchestrationPolicy(account(), query({ permissions: [permission] }))), flags(true));
  assert.deepEqual(clone(h.api.projectWorkOrchestrationPolicy(account(), query({ permissions: permission }))), flags(false, false, true));
  for (const plan of ['plus', 'team', 'unknown-future-plan']) {
    const personal = fixture(); personal.c.plan = plan; personal.c.gates['3063076119'] = true; personal.c.fail = 'workspace';
    assert.equal((await personal.read()).capability.isCapable, true);
    assert.equal(personal.calls.filter(call => call.args?.request?.operation === 'cloud_workspace_settings').length, 0);
  }
  const tokens = fixture(); tokens.c.authMethod = 'chatgptAuthTokens'; tokens.c.gates['3063076119'] = true;
  assert.equal((await tokens.read()).capability.isCapable, true);
  assert.equal(tokens.calls.filter(call => call.args?.request?.operation === 'cloud_workspace_settings').length, 0);
});
await test('provider defaults only follow successful raw config with non-null active-profile overrides', async () => {
  const h = fixture();
  for (const [config, expected] of [
    [{}, true], [{ model_provider: null }, true], [{ model_provider: 'third-party' }, false],
    [{ model_provider: 'third-party', profile: 'active', profiles: { active: { model_provider: 'openai' } } }, true],
    [{ model_provider: 'openai', profile: 'active', profiles: { active: { model_provider: 'third-party' } } }, false],
    [{ model_provider: 'third-party', profile: 'active', profiles: { active: { model_provider: null } } }, false],
    [{ model_provider: 'openai', profile: 'active', profiles: [] }, true],
    [{ model_provider: 'third-party', profile: 'active', profiles: { active: [] } }, false],
    [{ model_provider: 'third-party', profile: 1, profiles: { active: { model_provider: 'openai' } } }, false],
    [{ model_provider: 'third-party', profiles: { active: { model_provider: 'openai' } } }, false],
    [{ model_provider: 'third-party', profile: undefined, profiles: { active: { model_provider: 'openai' } } }, false],
  ]) {
    const before = structuredClone(config);
    assert.deepEqual(clone(h.api.projectWorkFirstParty(query({ config }))), flags(expected));
    assert.deepEqual(config, before, 'normalizer never rewrites the supplied config');
  }
  assert.deepEqual(clone(h.api.projectWorkFirstParty(query(undefined))), flags(false, true));
  assert.deepEqual(clone(h.api.projectWorkFirstParty(query(undefined, { isError: true }))), flags(false, false, true));
  for (const raw of [null, {}, { config: null }, { config: [] }]) {
    const broken = fixture(); broken.c.gates['3683713372'] = true; broken.c.config = raw;
    assert.deepEqual(clone((await broken.read()).capability), flags(false, false, true));
  }
  const failed = fixture(); failed.c.gates['3683713372'] = true; failed.c.fail = 'config';
  assert.deepEqual(clone((await failed.read()).capability), flags(false, false, true));
});
await test('lockdown distinguishes successful absent field, real booleans, missing data and malformed schema', async () => {
  const h = fixture();
  for (const body of [{}, { settings: {} }, { settings: { lockdown_mode_enabled: false } }]) {
    assert.deepEqual(clone(h.api.projectWorkLockdown(query(body))), { state: 'disabled', loaded: true, error: false });
  }
  assert.deepEqual(clone(h.api.projectWorkLockdown(query({ settings: { lockdown_mode_enabled: true } }))), { state: 'enabled', loaded: true, error: false });
  assert.deepEqual(clone(h.api.projectWorkLockdown(query(undefined, { isLoading: true }))), { state: 'loading', loaded: false, error: false });
  for (const body of [undefined, null, [], false, { settings: null }, { settings: [] }, { settings: { lockdown_mode_enabled: null } }, { settings: { lockdown_mode_enabled: 'false' } }]) {
    assert.deepEqual(clone(h.api.projectWorkLockdown(query(body))), { state: 'enabled', loaded: false, error: true });
  }
  const failed = fixture(); failed.c.fail = 'lockdown';
  const state = await failed.read(); assert.equal(state.lockdown.state, 'enabled'); assert.equal(state.lockdown.loaded, false); assert.equal(state.lockdown.error, true);
  assert.ok(state.missingInputs.includes('lockdown'));
});
await test('router gates remain independent of capability and incomplete name gates never become false', async () => {
  const h = fixture(); delete h.c.gates['2465577016']; delete h.c.gates['3559027740'];
  const result = await h.read(); assert.deepEqual(clone(result.capability), flags(true));
  assert.equal(result.gates.gate246, null); assert.equal(result.gates.gate355, null);
  assert.ok(result.missingInputs.includes('gate246') && result.missingInputs.includes('gate355'));
  for (const [key, name] of [['3063076119', 'gate306'], ['1315865107', 'gate131'], ['3683713372', 'gate368']]) {
    const missing = fixture(); delete missing.c.gates[key]; const state = await missing.read();
    assert.equal(state.capability, null); assert.ok(state.missingInputs.includes(name));
  }
});
await test('full V1/V2 hashed snapshots bind identity and reject delta/overlay/unknown gate types', async () => {
  for (const compact of [false, true]) for (const hashed of [false, true]) {
    const h = fixture(); Object.assign(h.c, { compact, hashed }); assert.equal((await h.read()).capability.isCapable, true);
  }
  for (const mode of ['account', 'user', 'delta', 'overlay', 'incomplete', 'bad-gate']) {
    const h = fixture(); h.c.payload = value => { if (mode === 'account') value.user.customIDs.account_id = 'other';
      if (mode === 'user') value.user.userID = 'other'; if (mode === 'delta') value.isDelta = true; if (mode === 'overlay') value.live_overlay = {};
      if (mode === 'incomplete') delete value.has_updates; if (mode === 'bad-gate') value.feature_gates['3063076119'].value = 'false'; return value; };
    assert.equal((await h.read()).capability, null);
    assert.ok(!h.calls.some(call => call.method === 'config/read' || call.args?.request?.operation === 'cloud_workspace_settings'));
  }
  const failed = fixture(); failed.c.fail = 'bootstrap'; failed.c.gates['3063076119'] = true; failed.c.gates['3683713372'] = true;
  const unknown = await failed.read();
  assert.equal(unknown.capability, null);
  for (const gate of ['gate306', 'gate131', 'gate368']) assert.ok(unknown.missingInputs.includes(gate), 'bootstrap failure cannot establish ' + gate);
  assert.ok(!failed.calls.some(call => call.method === 'config/read' || call.args?.request?.operation === 'cloud_workspace_settings'));
});
await test('workspace denial and read errors cannot be bypassed by gate131 or other workspace rights', async () => {
  for (const raw of [{}, { permissions: null }, { permissions: [] }, { permissions: ['chatgpt.workspace.feature.allow-codex-access.access'] }]) {
    const h = fixture(); h.c.gates['3063076119'] = true; h.c.workspace = raw;
    assert.deepEqual(clone((await h.read()).capability), flags(false));
  }
  const failed = fixture(); failed.c.gates['3063076119'] = true; failed.c.fail = 'workspace';
  assert.deepEqual(clone((await failed.read()).capability), flags(false, false, true));
  failed.c.gates['1315865107'] = false;
  assert.deepEqual(clone((await failed.read()).capability), flags(false, false, true), 'disabled gate131 must not hide an independently failed workspace policy block');
});
await test('JWT auth/plan, routing and generation changes cannot deliver stale capability', async () => {
  for (const field of ['plan', 'authMethod']) {
    const h = fixture(); h.c.info = (value, count) => count === 1 ? value : { ...value, [field]: field === 'plan' ? 'plus' : 'chatgptAuthTokens' };
    await assert.rejects(h.read(), error => error.code === 'account_changed');
  }
  for (const field of ['accountId', 'userId', 'generation']) {
    const h = fixture(); h.c.after = event => { if (event === 'library_settings') h.c.identity = () => ({ ...identity, [field]: field === 'generation' ? 5 : 'changed' }); };
    await assert.rejects(h.read(), error => error.code === 'account_changed');
  }
  const wrongRoute = fixture(); wrongRoute.c.account = (value, count) => { if (count === 2) value.workspaceRouting.chatgptAccountId = 'other'; return value; };
  await assert.rejects(wrongRoute.read(), error => error.code === 'account_changed');
  const failed = fixture(); failed.c.fail = 'lockdown'; failed.c.after = event => { if (event === 'library_settings') failed.c.identity = () => ({ ...identity, generation: 5 }); };
  await assert.rejects(failed.read(), error => error.code === 'account_changed');
});
await test('pre-cancel and pending capability/settings/final JWT cancellation never reach downstream requests', async () => {
  const before = fixture(), controller = new AbortController(); controller.abort(); await assert.rejects(before.read(controller.signal)); assert.equal(before.calls.length, 0);
  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
  for (const outcome of ['abort', 'identity']) {
    const h = fixture(), entered = deferred(), release = deferred(), active = new AbortController();
    h.c.info = async value => { entered.resolve(); await release.promise; return value; };
    const pending = h.read(active.signal); await entered.promise;
    if (outcome === 'abort') active.abort(); else h.c.identity = () => ({ ...identity, generation: 5 });
    release.resolve(); await assert.rejects(pending, error => outcome === 'abort' ? active.signal.aborted : error.code === 'account_changed');
    assert.ok(!h.calls.some(call => call.command === 'share_thread_access' || call.command === 'chatgpt_service_read'));
  }
  for (const source of ['share_thread_access', 'config/read', 'library_settings', 'final-work-account-info']) {
    const h = fixture(), entered = deferred(), release = deferred(), active = new AbortController();
    if (source === 'config/read') h.c.gates['3683713372'] = true;
    if (source === 'final-work-account-info') h.c.info = async (value, count) => {
      if (count === 2) { entered.resolve(); await release.promise; } return value;
    };
    else h.c.after = async event => { if (event === source) { entered.resolve(); await release.promise; } };
    const pending = h.read(active.signal); await entered.promise;
    const beforeAbort = h.calls.filter(call => call.command !== 'chatgpt_service_cancel').length;
    active.abort(); release.resolve(); await assert.rejects(pending, () => active.signal.aborted, source);
    assert.equal(h.calls.filter(call => call.command !== 'chatgpt_service_cancel').length, beforeAbort,
      'catch must not swallow cancellation and start another request after ' + source);
  }
});
console.log(`PASS ${passed} orchestration groups; isolated source flags, actual TS wrappers, zero HTTP/model/native input/config writes`);

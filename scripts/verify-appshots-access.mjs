import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const identity = { accountId: 'appshots-account', userId: 'appshots-user', generation: 4 };
const clone = value => JSON.parse(JSON.stringify(value));
const hash = key => { let value = 0; for (const char of key) value = (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0; return String(value); };

function fixture() {
  const calls = [];
  let serial = 0, identityReads = 0;
  const config = {
    gates: { '1304276663': true, '2124127696': true }, requirements: { requirements: null },
    compact: false, hashed: false, payload: value => value, identity: () => clone(identity),
    fail: null, abort: null,
  };
  const bridge = {
    callAppServer: async (method, params) => {
      calls.push({ method, params: clone(params) });
      assert.equal(method, 'configRequirements/read');
      assert.deepEqual(clone(params), {});
      if (config.fail === 'requirements') throw Error('offline requirements error');
      return config.requirements;
    },
    tauriInvoke: async (command, args) => {
      calls.push({ command, args: clone(args) });
      if (command === 'chatgpt_service_cancel') return;
      if (command === 'chatgpt_service_identity') return config.identity(++identityReads);
      assert.equal(command, 'share_thread_access');
      assert.deepEqual(clone(args.request.expectedIdentity), identity);
      if (config.fail === 'bootstrap') throw Error('offline bootstrap error');
      const payload = {
        has_updates: true, response_format: config.compact ? 'init-v2' : 'init-v1',
        user: { userID: identity.userId, customIDs: { account_id: identity.accountId } },
        feature_gates: Object.fromEntries(Object.entries(config.gates).map(([key, value]) => [config.hashed ? hash(key) : key, { [config.compact ? 'v' : 'value']: value }])),
      };
      config.abort?.();
      return { statsigPayload: JSON.stringify(config.payload(payload)) };
    },
  };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, {
      exports, AbortController, crypto: { randomUUID: () => `appshots-${++serial}` },
      navigator: { userAgent: 'Offline appshots test', userAgentData: { brands: [{ brand: 'Chromium', version: '140' }], platform: 'Windows' } },
      localStorage: { getItem: () => 'offline-device' },
      require: name => name === './bridge' ? bridge : load(`src/${name.slice(2)}.ts`),
    }, { filename: file });
    return exports;
  }
  const api = load('src/appshotsAccess.ts');
  return { config, calls, api, read: (platform = 'windows', signal = new AbortController().signal) => api.readLocalAppshotsAccess(signal, platform) };
}

let passed = 0;
async function test(name, run) { await run(); console.log('PASS', name); ++passed; }

await test('positive account gates and actual local null requirements allow base only', async () => {
  const h = fixture(), result = await h.read();
  assert.deepEqual(clone(result), { hostId: 'local', identity, platform: 'windows', generalGate: true, windowsGate: true, requirementsAllowed: true, enabled: true, miniFeature: null });
  assert.equal(h.api.evaluateAppshotsAvailability(result, null), null);
  assert.equal(h.api.evaluateAppshotsAvailability(result, false), false);
  assert.equal(h.api.evaluateAppshotsAvailability(result, true), true);
  assert.equal(h.calls.filter(call => call.command === 'chatgpt_service_identity').length, 2);
  assert.equal(h.calls.filter(call => call.method === 'configRequirements/read').length, 1);
  assert.ok(h.calls.every(call => call.method === 'configRequirements/read' || ['chatgpt_service_identity', 'share_thread_access'].includes(call.command)));
});

await test('each positive gate false blocks, unknown never becomes confirmed false or true', async () => {
  for (const key of ['1304276663', '2124127696']) {
    const h = fixture(); h.config.gates[key] = false;
    assert.equal((await h.read()).enabled, false);
    for (const invalid of [undefined, 'true', 1, null]) {
      const unknown = fixture();
      if (invalid === undefined) delete unknown.config.gates[key]; else unknown.config.gates[key] = invalid;
      assert.equal((await unknown.read()).enabled, null);
    }
  }
  const h = fixture(); h.config.gates['1304276663'] = false; h.config.requirements = {};
  assert.equal((await h.read()).enabled, false);
});

await test('real requirements null/object defaults differ from missing, malformed and denied response', async () => {
  for (const response of [{ requirements: null }, { requirements: {} }, { requirements: { allowAppshots: null } }, { requirements: { allowAppshots: true } }]) {
    const h = fixture(); h.config.requirements = response;
    assert.equal((await h.read()).requirementsAllowed, true);
  }
  for (const response of [null, undefined, {}, [], { requirements: undefined }, { requirements: [] }, { requirements: true }, { requirements: { allowAppshots: 'true' } }]) {
    const h = fixture(); h.config.requirements = response;
    const result = await h.read(); assert.equal(result.requirementsAllowed, null); assert.equal(result.enabled, null);
  }
  const h = fixture(); h.config.requirements = { requirements: { allowAppshots: false } };
  assert.equal((await h.read()).enabled, false);
});

await test('V1/V2 and existing hashed gate encoding are parsed from actual wrapper payload', async () => {
  for (const compact of [false, true]) for (const hashed of [false, true]) {
    const h = fixture(); Object.assign(h.config, { compact, hashed });
    assert.equal((await h.read()).enabled, true);
  }
});

await test('Mini gate affects description only and preserves unknown without changing Windows permission', async () => {
  for (const compact of [false, true]) for (const hashed of [false, true]) for (const mini of [true, false, undefined, 'true']) {
    const h = fixture(); Object.assign(h.config, { compact, hashed });
    if (mini !== undefined) h.config.gates['1532120159'] = mini;
    const access = await h.read();
    assert.equal(access.miniFeature, typeof mini === 'boolean' ? mini : null);
    assert.equal(access.enabled, true, 'Mini is not an additional Windows Appshots access gate');
  }
});

await test('foreign, delta, unsupported and incomplete snapshots stay unknown', async () => {
  for (const kind of ['account', 'user', 'delta', 'deltaAlias', 'overlay', 'noUpdates', 'missingUpdates', 'format', 'gates', 'userMissing']) {
    const h = fixture(); h.config.payload = payload => {
      if (kind === 'account') payload.user.customIDs.account_id = 'other';
      if (kind === 'user') payload.user.userID = 'other';
      if (kind === 'delta') payload.is_delta = true;
      if (kind === 'deltaAlias') payload.isDelta = true;
      if (kind === 'overlay') payload.live_overlay = {};
      if (kind === 'noUpdates') payload.has_updates = false;
      if (kind === 'missingUpdates') delete payload.has_updates;
      if (kind === 'format') payload.response_format = 'future-format';
      if (kind === 'gates') payload.feature_gates = [];
      if (kind === 'userMissing') delete payload.user;
      return payload;
    };
    const value = await h.read(); assert.equal(value.generalGate, null, kind); assert.equal(value.enabled, null, kind);
  }
  const h = fixture();
  for (const bootstrap of [null, {}, { statsigPayload: false }, { statsigPayload: 'invalid-json' }]) {
    assert.equal(h.api.decodeAppshotsAccess(bootstrap, { requirements: null }, identity, 'windows').enabled, null);
  }
});

await test('Windows support stays separate from enabled; macOS skips only Windows-specific conditions', async () => {
  const h = fixture(); delete h.config.gates['2124127696'];
  const mac = await h.read('macOS');
  assert.equal(mac.windowsGate, null); assert.equal(mac.enabled, true);
  assert.equal(h.api.evaluateAppshotsAvailability(mac, false), true);
  assert.equal(h.api.evaluateAppshotsAvailability(mac, null), true);
  h.config.gates['1304276663'] = false;
  assert.equal((await h.read('macOS')).enabled, false);
  for (const platform of ['linux', '', 'unknown']) {
    const access = await fixture().read(platform);
    assert.equal(access.enabled, false);
    assert.equal(h.api.evaluateAppshotsAvailability(access, true), false);
  }
});

await test('account, user and service generation changes reject late qualified snapshots', async () => {
  for (const field of ['accountId', 'userId', 'generation']) {
    const h = fixture(); h.config.identity = count => count === 1 ? clone(identity) : { ...identity, [field]: field === 'generation' ? 5 : 'different' };
    await assert.rejects(h.read(), error => error.code === 'account_changed');
  }
});

await test('pre-cancel makes no calls; in-flight cancel and transport failure cannot return access', async () => {
  const h = fixture(), before = new AbortController(); before.abort();
  await assert.rejects(h.read('windows', before.signal)); assert.equal(h.calls.length, 0);
  const active = fixture(), controller = new AbortController(); active.config.abort = () => controller.abort();
  await assert.rejects(active.read('windows', controller.signal));
  assert.ok(active.calls.some(call => call.command === 'chatgpt_service_cancel'));
  for (const source of ['bootstrap', 'requirements']) {
    const failure = fixture(); failure.config.fail = source;
    await assert.rejects(failure.read(), new RegExp(`offline ${source} error`));
  }
});

console.log(`PASS ${passed} Appshots access groups; real TypeScript/service wrapper with offline bridge, no HTTP or capture`);

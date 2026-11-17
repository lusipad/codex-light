import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const identity = { accountId: 'settings-account', userId: 'settings-user', generation: 3 };
const clone = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const calls = []; let serial = 0;
  const c = { hotkey: 'DoubleAlt', defaulted: true, owner: 'active', saved: 'automatic', effective: undefined,
    version: 'version-one', status: 'ok', fail: null, after: () => {}, identity: () => clone(identity), read: value => value,
    runtime: value => value, snapshot: value => value };
  const state = () => c.snapshot({ identity: clone(identity), configuredHotkey: c.hotkey, configuredHotkeyDefaulted: c.defaulted,
    eligible: true, ownerState: c.owner, supported: c.owner === 'active' ? true : null, registration: c.owner === 'active' ? 'ready' : 'none' });
  const effective = () => c.effective ?? c.saved;
  const bridge = {
    tauriInvoke: async (command, args) => {
      calls.push({ command, args: clone(args) });
      if (command === 'chatgpt_service_identity') return c.identity();
      if (command === 'chatgpt_service_cancel') return;
      assert.deepEqual(clone(args.request.identity), identity);
      let result;
      if (command === 'appshots_settings_read') result = state();
      else if (command === 'appshots_hotkey_set') {
        if (c.fail === 'hotkey') throw Error('native registration rejected');
        c.hotkey = args.request.hotkey; c.defaulted = false; result = state();
      } else if (command === 'appshots_destination_refresh') {
        result = c.runtime({ ...state(), destination: ['automatic', 'last-chat', 'new-chat'].includes(effective()) ? effective() : 'automatic' });
      } else assert.fail('unexpected command ' + command);
      c.after(command); return result;
    },
    callAppServer: async (method, params) => {
      calls.push({ method, params: clone(params) });
      let result;
      if (method === 'config/read') {
        assert.deepEqual(clone(params), { includeLayers: true });
        result = c.read({ config: { desktop: effective() === undefined ? {} : { appshotDestination: effective() } }, origins: {}, layers: [
          { name: { type: 'system', file: 'C:/isolated/system.toml' }, version: 'system-version', config: {} },
          { name: { type: 'user', file: 'C:/isolated/profile.toml', profile: 'profile' }, version: 'profile-version', config: {} },
          { name: { type: 'user', file: 'C:/isolated/config.toml', profile: null }, version: c.version, config: { desktop: c.saved === undefined ? {} : { appshotDestination: c.saved } } },
        ] });
      } else if (method === 'config/batchWrite') {
        assert.equal(params.filePath, 'C:/isolated/config.toml'); assert.equal(params.expectedVersion, c.version);
        assert.equal(params.reloadUserConfig, true);
        assert.equal(params.edits.length, 1); assert.equal(params.edits[0].keyPath, 'desktop.appshotDestination');
        assert.equal(params.edits[0].mergeStrategy, 'replace');
        c.saved = params.edits[0].value; c.version = 'version-two';
        if (c.fail === 'write') throw Error('write delivery uncertain');
        result = { filePath: params.filePath, version: c.version, status: c.status };
      } else assert.fail('unexpected method ' + method);
      c.after(method); return result;
    },
  };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText, { exports, AbortController, crypto: { randomUUID: () => `settings-${++serial}` },
      require: name => name === './bridge' ? bridge : load(`src/${name.slice(2)}.ts`),
    }, { filename: file });
    return exports;
  }
  return { c, calls, api: load('src/appshotsSettings.ts'), signal: new AbortController().signal };
}
let passed = 0;
async function test(name, run) { await run(); console.log('PASS', name); ++passed; }

await test('read preserves raw custom shortcut, null, defaulted and unavailable owner', async () => {
  const h = fixture(); h.c.hotkey = 'Ctrl+Alt+Custom'; h.c.defaulted = false;
  assert.equal((await h.api.readAppshotsSettings(identity, h.signal)).configuredHotkey, 'Ctrl+Alt+Custom');
  h.c.hotkey = null; assert.equal((await h.api.readAppshotsSettings(identity, h.signal)).configuredHotkey, null);
  h.c.owner = 'unavailable'; const state = await h.api.readAppshotsSettings(identity, h.signal);
  assert.equal(state.ownerState, 'unavailable'); assert.equal(state.supported, null);
});
await test('shortcut setter uses real flat backend transaction and preserves pending state', async () => {
  const h = fixture(); h.c.snapshot = value => ({ ...value, registration: 'pending' });
  const result = await h.api.setAppshotsHotkey(identity, 'DoubleShift', h.signal);
  assert.equal(result.configuredHotkey, 'DoubleShift'); assert.equal(result.registration, 'pending');
  assert.equal(h.calls.filter(value => value.command === 'appshots_hotkey_set').length, 1);
  assert.ok(!h.calls.some(value => value.command === 'desktop_state_set' || value.method === 'config/batchWrite'));
  h.c.fail = 'hotkey'; await assert.rejects(h.api.setAppshotsHotkey(identity, null, h.signal));
  assert.equal(h.calls.filter(value => value.command === 'appshots_hotkey_set').length, 2, 'failure is not replayed');
});
await test('inputs and pre-cancel fail before identity, backend or config requests', async () => {
  const h = fixture();
  await assert.rejects(h.api.setAppshotsHotkey(identity, 'Ctrl+Alt+A', h.signal));
  await assert.rejects(h.api.writeAppshotsDestination(identity, 'somewhere', h.signal));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(h.api.readAppshotsSettings(identity, controller.signal));
  assert.equal(h.calls.length, 0);
});
await test('settingsStore enum-invalid destination uses memory default without changing stored raw data', async () => {
  for (const raw of ['future-destination', '', null, 1, true, {}, [], undefined]) {
    const h = fixture(); h.c.saved = raw;
    const result = await h.api.readAppshotsDestination(identity, h.signal);
    assert.equal(result.destination, 'automatic'); assert.equal(result.destinationDefaulted, true);
    assert.equal(h.c.saved, raw, 'memory fallback does not normalize persisted data');
    assert.ok(!h.calls.some(value => value.method === 'config/batchWrite'));
  }
});
await test('versioned user-layer write confirms saved, effective and real owner refresh', async () => {
  const h = fixture(); const result = await h.api.writeAppshotsDestination(identity, 'new-chat', h.signal);
  assert.equal(result.saved, 'new-chat'); assert.equal(result.effective.destination, 'new-chat');
  assert.equal(result.overridden, false); assert.equal(result.runtimeApplied, true);
  assert.equal(h.calls.filter(value => value.method === 'config/read').length, 2);
  assert.equal(h.calls.filter(value => value.command === 'appshots_destination_refresh').length, 1);
  const noOwner = fixture(); noOwner.c.owner = 'unavailable';
  const saved = await noOwner.api.writeAppshotsDestination(identity, 'last-chat', noOwner.signal);
  assert.equal(saved.saved, 'last-chat'); assert.equal(saved.runtimeApplied, false);
});
await test('managed override reports user saved value separately from effective route', async () => {
  const h = fixture(); h.c.status = 'okOverridden'; h.c.effective = 'last-chat';
  const result = await h.api.writeAppshotsDestination(identity, 'new-chat', h.signal);
  assert.equal(result.status, 'okOverridden'); assert.equal(result.saved, 'new-chat');
  assert.equal(result.effective.destination, 'last-chat'); assert.equal(result.overridden, true);
});
await test('wrong types, unsupported layers and missing raw user value cannot pass readback', async () => {
  for (const mode of ['profile-only', 'no-file', 'no-version', 'no-layer-config', 'bad-desktop']) {
    const h = fixture(); h.c.read = value => {
      if (mode === 'profile-only') value.layers = value.layers.filter(layer => layer.name.profile);
      if (mode === 'no-file') delete value.layers[2].name.file;
      if (mode === 'no-version') delete value.layers[2].version;
      if (mode === 'no-layer-config') delete value.layers[2].config;
      if (mode === 'bad-desktop') value.config.desktop = [];
      return value;
    };
    await assert.rejects(h.api.writeAppshotsDestination(identity, 'new-chat', h.signal), mode);
    assert.equal(h.calls.filter(value => value.method === 'config/batchWrite').length, 0);
  }
  const h = fixture(); let count = 0; h.c.read = value => { if (++count === 2) delete value.layers[2].config.desktop.appshotDestination; return value; };
  await assert.rejects(h.api.writeAppshotsDestination(identity, 'new-chat', h.signal), error => error.code === 'write_readback');
  const illegal = fixture(); let reads = 0;
  illegal.c.read = value => { if (++reads === 2) value.layers[2].config.desktop.appshotDestination = 'invalid-raw-value'; return value; };
  await assert.rejects(illegal.api.writeAppshotsDestination(identity, 'automatic', illegal.signal), error => error.code === 'write_readback');
});
await test('unknown write delivery is not replayed or silently promoted by readback', async () => {
  const h = fixture(); h.c.fail = 'write';
  await assert.rejects(h.api.writeAppshotsDestination(identity, 'new-chat', h.signal), error => error.code === 'ambiguous' && Boolean(error.cause));
  assert.equal(h.calls.filter(value => value.method === 'config/batchWrite').length, 1);
  assert.equal(h.calls.filter(value => value.method === 'config/read').length, 1);
  assert.equal(h.calls.filter(value => value.command === 'appshots_destination_refresh').length, 0);
});
await test('identity changes and in-flight cancellation prevent subsequent writes', async () => {
  for (const field of ['accountId', 'userId', 'generation']) {
    const h = fixture(); h.c.after = method => { if (method === 'config/read') h.c.identity = () => ({ ...identity, [field]: field === 'generation' ? 4 : 'other' }); };
    await assert.rejects(h.api.writeAppshotsDestination(identity, 'new-chat', h.signal), error => error.code === 'account_changed');
    assert.equal(h.calls.filter(value => value.method === 'config/batchWrite').length, 0);
  }
  const h = fixture(), controller = new AbortController(); h.c.after = method => { if (method === 'config/read') controller.abort(); };
  await assert.rejects(h.api.writeAppshotsDestination(identity, 'new-chat', controller.signal));
  assert.equal(h.calls.filter(value => value.method === 'config/batchWrite').length, 0);
});
await test('backend identity/types and refresh mismatch are rejected without fabricated active state', async () => {
  for (const change of [value => ({ ...value, eligible: 'true' }), value => ({ ...value, registration: 'installed' }), value => ({ ...value, identity: { ...identity, generation: 99 } })]) {
    const h = fixture(); h.c.snapshot = change;
    await assert.rejects(h.api.readAppshotsSettings(identity, h.signal));
  }
  const h = fixture(); h.c.runtime = value => ({ ...value, destination: 'wrong-route' });
  await assert.rejects(h.api.writeAppshotsDestination(identity, 'new-chat', h.signal), error => error.code === 'write_readback');
  const malformed = fixture(); malformed.c.runtime = value => ({ ...value, destinationDefaulted: 'true' });
  await assert.rejects(malformed.api.readAppshotsDestination(identity, malformed.signal));
  for (const desktop of [[], 'corrupt', true, 1]) {
    const badParent = fixture(); badParent.c.read = value => ({ ...value, config: { desktop } });
    await assert.rejects(badParent.api.readAppshotsDestination(identity, badParent.signal), error => error.code === 'invalid_response');
  }
});
await test('actual 0.165 unset desktop null is a read-only default and supports first versioned creation', async () => {
  const h = fixture(); h.c.saved = undefined;
  h.c.read = value => {
    if (h.c.version === 'version-one') { value.config.desktop = null; value.layers[2].config.desktop = null; }
    return value;
  };
  const before = await h.api.readAppshotsDestination(identity, h.signal);
  assert.equal(before.destination, 'automatic'); assert.equal(before.destinationDefaulted, true);
  assert.equal(h.calls.filter(value => value.method === 'config/batchWrite').length, 0);
  const after = await h.api.writeAppshotsDestination(identity, 'new-chat', h.signal);
  assert.equal(after.saved, 'new-chat'); assert.equal(after.effective.destination, 'new-chat');
  assert.equal(after.effective.destinationDefaulted, false);
  assert.equal(h.calls.filter(value => value.method === 'config/batchWrite').length, 1);
});
await test('late post-write account changes do not refresh another owner or replay the transaction', async () => {
  for (const operation of ['appshots_hotkey_set', 'config/batchWrite']) {
    const h = fixture(); h.c.after = method => { if (method === operation) h.c.identity = () => ({ ...identity, generation: 4 }); };
    await assert.rejects(operation === 'appshots_hotkey_set'
      ? h.api.setAppshotsHotkey(identity, 'DoubleShift', h.signal)
      : h.api.writeAppshotsDestination(identity, 'new-chat', h.signal), error => error.code === 'account_changed');
    assert.equal(h.calls.filter(value => value.command === 'appshots_destination_refresh').length, 0);
    assert.equal(h.calls.filter(value => value.command === 'appshots_hotkey_set' || value.method === 'config/batchWrite').length, 1);
  }
  const h = fixture(); h.c.status = 'unknown-status';
  await assert.rejects(h.api.writeAppshotsDestination(identity, 'new-chat', h.signal), error => error.code === 'ambiguous');
  assert.equal(h.calls.filter(value => value.method === 'config/read').length, 1);
});
console.log(`PASS ${passed} Appshots settings groups; production TS/config/service wrappers, offline bridge, zero HTTP/model/native registration`);

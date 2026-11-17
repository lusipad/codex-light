import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const identity = { userId: 'execution-user', accountId: 'execution-account', generation: 7 };
const clone = value => JSON.parse(JSON.stringify(value));
const access = () => ({ identity: clone(identity), combined: { status: 'allowed', accountId: identity.accountId }, base: { local: { status: 'allowed', accountId: identity.accountId } } });
const payload = () => ({ has_updates: true, response_format: 'init-v1', user: { userID: identity.userId,
  customIDs: { account_id: identity.accountId, stableID: 'execution-device' }, custom: { auth_method: 'chatgpt' } },
  feature_gates: {}, dynamic_configs: {}, layer_configs: {} });
const source = 'src/workExecutionPreparation.ts';
function fixture() {
  const calls = [], modules = new Map(); let serial = 0, infoCount = 0;
  const c = { identity: () => clone(identity), body: payload(), config: { config: { desktop: null } },
    atom: { status: 'missing' }, plan: 'plus', authMethod: 'chatgpt', fail: null, after() {},
    route: identity.accountId, info: value => value };
  const bridge = {
    callAppServer: async (method, params) => {
      calls.push({ method, params: clone(params) });
      let result;
      if (method === 'account/read') {
        assert.deepEqual(clone(params), { refreshToken: false });
        result = { account: { type: 'chatgpt', planType: 'not-the-real-plan' }, workspaceRouting: { chatgptAccountId: c.route } };
      } else {
        assert.equal(method, 'config/read'); assert.deepEqual(clone(params), { includeLayers: true, cwd: null });
        if (c.fail === 'config') { await c.after(method); throw Error('offline config'); }
        result = clone(c.config);
      }
      await c.after(method); return result;
    },
    tauriInvoke: async (command, args) => {
      calls.push({ command, args: clone(args) });
      if (command === 'chatgpt_service_identity') return c.identity();
      if (command === 'chatgpt_service_cancel') return;
      const request = args.request; assert.deepEqual(clone(request.expectedIdentity), identity);
      let result;
      if (command === 'work_account_info') result = await c.info({ requestId: request.requestId, identity: clone(identity), authMethod: c.authMethod, plan: c.plan }, ++infoCount);
      else if (command === 'share_thread_access') {
        if (c.fail === 'bootstrap') { await c.after(command); throw Error('offline bootstrap'); }
        result = { statsigPayload: JSON.stringify(c.body) };
      } else throw Error('Unexpected mutation/service: ' + command);
      await c.after(command); return result;
    },
  };
  const preferences = { readWorkHomePreferences: async (expected, signal) => {
    calls.push({ ownerRead: true }); assert.deepEqual(clone(expected), identity); signal.throwIfAborted();
    if (c.fail === 'preferences') { await c.after('preferences'); throw Error('owner unavailable'); }
    const result = { identity: clone(identity), owner: 'bound', defaultModeRequestUserInput: clone(c.atom), legacyDetail: 'missing' };
    await c.after('preferences'); return result;
  } };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
      { exports, AbortController, crypto: { randomUUID: () => `execution-${++serial}` }, navigator: { userAgent: 'Offline execution test',
        userAgentData: { brands: [{ brand: 'Chromium', version: '140' }], platform: 'Windows' } }, localStorage: { getItem: () => 'offline-device' },
        require: name => name === './bridge' ? bridge : name === './workHomePreferences' ? preferences : load(`src/${name.slice(2)}.ts`) }, { filename: file });
    return exports;
  }
  const api = load(source);
  return { c, calls, api,
    project: (overrides = {}) => api.projectWorkExecutionPreparation({ identity, appServerVersion: '0.165.0', workAccess: access(),
      bootstrap: { statsigPayload: JSON.stringify(c.body) }, config: c.config, defaultModeRequestUserInput: c.atom, legacyDetail: 'missing', ...overrides }),
    read: (signal = new AbortController().signal, overrides = {}) => api.readWorkExecutionPreparation({ identity, appServerVersion: '0.165.0', workAccess: access(), ...overrides }, signal) };
}
let groups = 0;
async function test(name, run) { await run(); ++groups; console.log('PASS', name); }
function ready(value) { assert.equal(value.status, 'ready', JSON.stringify(value)); return value; }
function compact(body, hashed = false) {
  const hash = key => { let result = 0; for (const char of key) result = (Math.imul(result, 31) + char.charCodeAt(0)) >>> 0; return String(result); };
  const result = clone(body); result.response_format = 'init-v2'; result.values = [];
  result.feature_gates = Object.fromEntries(Object.entries(body.feature_gates).map(([key, entry]) => [hashed ? hash(key) : key, { v: entry.value }]));
  for (const table of ['dynamic_configs', 'layer_configs']) result[table] = Object.fromEntries(Object.entries(body[table]).map(([key, entry]) => {
    const index = result.values.push(entry.value) - 1;
    return [hashed ? hash(key) : key, { v: index, ue: entry.is_user_in_experiment, ea: entry.is_experiment_active }];
  }));
  return result;
}
await test('full identity-bound snapshot supplies actual defaults and preserves undefined source branches', () => {
  const result = ready(fixture().project());
  assert.equal(result.settings.effectiveDetail, 'STEPS_COMMANDS'); assert.equal(result.settings.configuredDetail, null);
  assert.equal(result.defaultEnableFeatures.compaction_image_budget, true);
  assert.equal(result.defaultEnableFeatures.default_mode_request_user_input, undefined);
  assert.equal(result.assignmentIdentity.stableId, 'execution-device');
  assert.equal(result.values.gitWorktreeAttach, undefined); assert.equal(result.values.guardianV2Experiment, undefined);
  assert.deepEqual(clone(result.values.toolCatalog.configs), { modelAvailability: {}, realtimeConversationPrompt: {} });
});
await test('all 34 fixed feature mappings and V1/V2 hashed value-pool results agree', () => {
  // Frozen EP02/09 source fixture: the regression must run without ignored .ref files.
  const mappings = `2815533291:local_work_search_mcp 3013700042:apply_patch_preserve_line_endings 1786883712:unified_exec
241701189:code_mode_buffered_exec 1398371767:code_mode_interrupt 1570710371:instant_interrupt 4173592727:executed_tool_call_metadata
1615536597:shell_snapshot 3342304550:shell_snapshot_v2 770526561:remote_models 2734851136:responses_websockets_v2
4074240636:reasoning_effort_override 3701003275:standalone_web_search 1156958996:collaboration_modes 2929104770:default_mode_request_user_input
3390468622:request_rule 1935276618:image_generation 3762443246:item_ids 138621433:image_detail_original 2307253562:codex_git_commit
3026692602:workspace_dependencies 3902016271:guardian_approval 798686840:guardian_native_multi_agent_history 1690660828:write_stdin_approval
2731805027:guardian_reuse_parent_compaction 2701734443:tool_search_always_defer_mcp_tools 298803427:mcp_lazy_stdio_startup
2895893268:incremental_tools 18916273:skill_catalog_deltas 2036057545:output_token_replay 1693082043:deferred_tool_world_state
1859936703:settings_tools 2707717541:writing_blocks 2508143457:concurrent_reasoning_summaries`.split(/\s+/).map(value => {
    const [gate, feature] = value.split(':'); return { gate, feature };
  });
  assert.equal(mappings.length, 34);
  for (const { gate, feature } of mappings) {
    const h = fixture(); h.c.body.feature_gates[gate] = { value: true };
    assert.equal(ready(h.project()).assignmentFeatures[feature], true, feature);
    h.c.body = compact(h.c.body, true); assert.equal(ready(h.project()).assignmentFeatures[feature], true, 'v2:' + feature);
  }
  const h = fixture(); h.c.body.dynamic_configs['1867347216'] = { value: { default_personality: 'friendly' } };
  h.c.body.layer_configs['1574672957'] = { value: { 'actual-model': { desktop_context_section: 'source instructions' } } };
  const v1 = ready(h.project()); h.c.body = compact(h.c.body, true);
  assert.deepEqual(clone(ready(h.project())), clone(v1));
});
await test('ordered allowlisted boolean overrides retain false and reject arbitrary feature keys', () => {
  const h = fixture(); h.c.body.feature_gates['1786883712'] = { value: true };
  h.c.body.layer_configs['3902942138'] = { value: { feature_overrides: { 'features.unified_exec': false, default_mode_request_user_input: true, plugins: true, arbitrary: true, shell_snapshot: 'true' } } };
  h.c.body.layer_configs['223073164'] = { value: { enable_plugins: false, enable_tool_suggest: true, enable_auth_elicitation: false, enable_tool_call_mcp_elicitation: true } };
  h.c.body.layer_configs['2138468235'] = { value: { enable_mcp_apps: true } };
  h.c.atom = { status: 'value', value: false };
  const result = ready(h.project());
  assert.equal(result.assignmentFeatures.unified_exec, false); assert.equal(result.assignmentFeatures.default_mode_request_user_input, true);
  assert.equal(result.defaultEnableFeatures.default_mode_request_user_input, false);
  for (const key of ['apps', 'plugins', 'recommended_plugins', 'auth_elicitation']) assert.equal(result.assignmentFeatures[key], false);
  for (const key of ['tool_suggest', 'tool_call_mcp_elicitation', 'enable_mcp_apps']) assert.equal(result.assignmentFeatures[key], true);
  assert.equal(result.assignmentFeatures.arbitrary, undefined); assert.equal(result.assignmentFeatures.shell_snapshot, undefined);
});
await test('typed parameters, async compaction and external-MCP experiment metadata match source', () => {
  const h = fixture(); h.c.body.feature_gates['1390641248'] = { value: true };
  h.c.body.dynamic_configs['914834687'] = { value: { enabled: 'true' } };
  h.c.body.dynamic_configs['763333490'] = { value: { enabled: true, model_async_compact_threshold_percent: 0 } };
  h.c.body.dynamic_configs['2383501365'] = { value: { enabled: false }, is_user_in_experiment: true };
  let result = ready(h.project()); assert.equal(result.values.deferredToolOutput, false);
  assert.equal(result.assignmentFeatures.async_compaction.model_async_compact_threshold_percent, 65);
  assert.equal(result.values.experimentalFeatureGates.shareCodexAppTools, false, 'V1 missing active does not force the base gate');
  h.c.body = compact(h.c.body); result = ready(h.project());
  assert.equal(result.values.experimentalFeatureGates.shareCodexAppTools, true, 'V2 missing ea is inactive and uses base gate');
  h.c.body.user.custom.auth_method = null; assert.equal(ready(h.project()).values.experimentalFeatureGates.shareCodexAppTools, false);
});
await test('guardian version rules merge in order, replace arrays and use source prerelease comparison', () => {
  const h = fixture(); h.c.body.dynamic_configs['2553103476'] = { value: { nested: { old: true }, list: [1, 2] } };
  h.c.body.layer_configs['1055689174'] = { value: { min_app_server_version: '0.160.0', config: { nested: { base: true }, list: [3] },
    config_rules: [null, { min_app_server_version: 'broken', config: {} }, { min_app_server_version: '0.165.0', config: { nested: { newer: true } } },
      { min_app_server_version: '0.166.0', config: { future: true } }] } };
  let result = ready(h.project());
  assert.deepEqual(clone(result.assignmentFeatures.guardianv2), { nested: { old: true, base: true, newer: true }, list: [3] });
  for (const appServerVersion of [null, 'invalid']) {
    const unchanged = ready(h.project({ appServerVersion }));
    assert.deepEqual(clone(unchanged.assignmentFeatures.guardianv2), { nested: { old: true }, list: [1, 2] });
  }
  assert.equal(ready(h.project({ appServerVersion: '0.0.0' })).assignmentFeatures.guardianv2.future, true);
  result = ready(h.project({ appServerVersion: '0.160.0-beta.1' })); assert.deepEqual(clone(result.assignmentFeatures.guardianv2.list), [1, 2]);
  h.c.body.layer_configs['1055689174'].value.min_app_server_version = '0.160.0-01';
  result = ready(h.project({ appServerVersion: '0.160.0-1' })); assert.deepEqual(clone(result.assignmentFeatures.guardianv2.list), [1, 2], 'source treats prerelease 01 as string after numeric 1');
});
await test('owner/config/default precedence and detail Work policy distinguish unavailable inputs', () => {
  const h = fixture(); h.c.config.config.desktop = { conversationDetailMode: 'STEPS_PROSE', 'default-mode-request-user-input-enabled': false };
  h.c.atom = { status: 'value', value: true }; assert.equal(ready(h.project()).settings.defaultModeRequestUserInput, true);
  h.c.atom = { status: 'invalid', value: 'wrong' }; assert.equal(ready(h.project()).settings.defaultModeRequestUserInput, false);
  h.c.atom = { status: 'unbound' }; assert.equal(h.project().status, 'not-ready');
  h.c.atom = { status: 'missing' }; assert.equal(ready(h.project()).settings.effectiveDetail, 'STEPS_PROSE');
  const coding = access(); coding.combined = { status: 'denied', reason: 'unsupported-auth' }; coding.base.local = null;
  assert.equal(ready(h.project({ workAccess: coding })).settings.effectiveDetail, 'STEPS_COMMANDS');
  const everyday = access(); everyday.base.local = { status: 'denied', reason: 'workspace-disabled' };
  h.c.config.config.desktop.conversationDetailMode = 'STEPS_COMMANDS'; assert.equal(ready(h.project({ workAccess: everyday })).settings.effectiveDetail, 'STEPS_PROSE');
  const unknown = access(); unknown.combined = null; assert.equal(h.project({ workAccess: unknown }).status, 'not-ready');
  unknown.combined = access().combined; unknown.base.local = null; assert.equal(h.project({ workAccess: unknown }).status, 'not-ready');
  for (const value of ['STEPS_EXECUTION', 'invalid', null]) { h.c.config.config.desktop.conversationDetailMode = value; assert.equal(ready(h.project()).settings.effectiveDetail, 'STEPS_COMMANDS'); }
});
await test('malformed, delta, incomplete, identity-mismatched and unread snapshots never become empty success', () => {
  const edits = [body => { delete body.feature_gates; }, body => { delete body.dynamic_configs; }, body => { delete body.layer_configs; },
    body => { delete body.user; }, body => { body.user.userID = 'other'; }, body => { body.user.customIDs.account_id = 'other'; },
    body => { body.user.customIDs.stableID = 12; }, body => { body.user.custom.auth_method = 12; }, body => { body.has_updates = false; },
    body => { body.is_delta = true; }, body => { body.live_overlay = {}; }, body => { body.response_format = 'init-v99'; },
    body => { body.feature_gates['1786883712'] = { value: 'true' }; }];
  for (const edit of edits) { const h = fixture(); edit(h.c.body); assert.equal(h.project().status, 'not-ready'); }
  const h = fixture(); for (const bootstrap of [null, {}, { statsigPayload: 'null' }, { statsigPayload: 'undefined' }]) assert.equal(h.project({ bootstrap }).status, 'not-ready');
  h.c.body = compact(payload()); h.c.body.dynamic_configs['1867347216'] = { v: {} }; assert.equal(h.project().status, 'not-ready');
  for (const desktop of [[], true, 'bad', 42]) assert.equal(h.project({ config: { config: { desktop } } }).status, 'not-ready');
});
await test('reader uses actual read-only bridge, JWT and owner view without writing defaults or invoking models', async () => {
  const h = fixture(); ready(await h.read());
  assert.equal(h.calls.filter(call => call.method === 'config/read').length, 1);
  assert.equal(h.calls.filter(call => call.command === 'share_thread_access').length, 1);
  assert.equal(h.calls.filter(call => call.command === 'work_account_info').length, 2);
  assert.equal(h.calls.filter(call => call.ownerRead).length, 1);
  const provided = fixture(); ready(await provided.read(undefined, { preferences: { identity: clone(identity), defaultModeRequestUserInput: { status: 'value', value: false }, legacyDetail: 'missing' } }));
  assert.equal(provided.calls.filter(call => call.ownerRead).length, 0);
});
await test('read failures return not-ready but changed identities and abort retain priority', async () => {
  for (const fail of ['bootstrap', 'config', 'preferences']) {
    const h = fixture(); h.c.fail = fail; assert.equal((await h.read()).status, 'not-ready');
    const changed = fixture(); changed.c.fail = fail;
    changed.c.after = step => { if (step === (fail === 'bootstrap' ? 'share_thread_access' : fail === 'config' ? 'config/read' : 'preferences')) changed.c.identity = () => ({ ...identity, userId: 'late-user' }); };
    await assert.rejects(changed.read(), error => error.code === 'account_changed');
  }
});
await test('every awaited input rejects cancellation including final JWT and catch paths', async () => {
  for (const step of ['share_thread_access', 'config/read', 'preferences', 'final-info']) {
    const h = fixture(), controller = new AbortController();
    if (step === 'final-info') h.c.info = (value, count) => { if (count === 2) controller.abort(); return value; };
    else h.c.after = actual => { if (actual === step) controller.abort(); };
    await assert.rejects(h.read(controller.signal));
  }
  const h = fixture(), controller = new AbortController(); h.c.fail = 'bootstrap'; h.c.after = () => controller.abort();
  await assert.rejects(h.read(controller.signal));
});
await test('scope, route, JWT auth and plan late changes reject while unrelated planType is unused', async () => {
  for (const field of ['userId', 'accountId', 'generation']) {
    const h = fixture(); h.c.after = step => { if (step === 'share_thread_access') h.c.identity = () => ({ ...identity, [field]: field === 'generation' ? 8 : 'other' }); };
    await assert.rejects(h.read(), error => error.code === 'account_changed');
  }
  for (const field of ['authMethod', 'plan']) {
    const h = fixture(); h.c.info = (value, count) => count === 2 ? { ...value, [field]: field === 'plan' ? 'business' : 'chatgptAuthTokens' } : value;
    await assert.rejects(h.read(), error => error.code === 'account_changed');
  }
  const h = fixture(); h.c.after = step => { if (step === 'config/read') h.c.route = 'different-route'; };
  await assert.rejects(h.read(), error => error.code === 'account_changed');
  const wrongAccess = access(); wrongAccess.identity.generation++; assert.equal(fixture().project({ workAccess: wrongAccess }).status, 'not-ready');
});
await test('legacy detail evidence gates only the real preference fallback without assuming migration', async () => {
  const h = fixture();
  for (const legacyDetail of [undefined, 'unbound']) {
    assert.deepEqual(clone(h.project({ legacyDetail }).missingInputs), ['legacy-detail-owner']);
    h.c.config.config.desktop = { conversationDetailMode: 'STEPS_PROSE' };
    assert.equal(ready(h.project({ legacyDetail })).settings.effectiveDetail, 'STEPS_PROSE');
    h.c.config.config.desktop = { conversationDetailMode: 'invalid' };
    assert.equal(h.project({ legacyDetail }).status, 'not-ready');
    const coding = access(); coding.combined = { status: 'denied', reason: 'unsupported-auth' };
    assert.equal(ready(h.project({ legacyDetail, workAccess: coding })).settings.effectiveDetail, 'STEPS_COMMANDS');
    const everyday = access(); everyday.base.local = { status: 'denied', reason: 'workspace-disabled' };
    assert.equal(ready(h.project({ legacyDetail, workAccess: everyday })).settings.effectiveDetail, 'STEPS_PROSE');
    h.c.config.config.desktop = null;
  }
  const result = await h.read(undefined, { preferences: { identity: clone(identity), defaultModeRequestUserInput: { status: 'missing' } } });
  assert.deepEqual(clone(result.missingInputs), ['legacy-detail-owner']);
  assert.equal(ready(h.project({ legacyDetail: 'missing' })).settings.effectiveDetail, 'STEPS_COMMANDS');
});
await test('source auth short circuit and guardian local schema catch do not reject unrelated features', () => {
  const results = [];
  const noAuth = fixture(); noAuth.c.body.user.custom.auth_method = null;
  noAuth.c.body.dynamic_configs['2383501365'] = { value: [] };
  results.push(noAuth.project().status);
  for (const value of [[], false]) {
    const h = fixture(); h.c.body.dynamic_configs['2553103476'] = { value };
    h.c.body.feature_gates['1786883712'] = { value: true };
    results.push(h.project().status);
  }
  assert.deepEqual(results, ['ready', 'ready', 'ready']);
  assert.equal(ready(noAuth.project()).values.experimentalFeatureGates.shareCodexAppTools, false);
  for (const value of [[], false]) {
    const h = fixture(); h.c.body.dynamic_configs['2553103476'] = { value };
    h.c.body.feature_gates['1786883712'] = { value: true };
    const result = ready(h.project()); assert.equal(result.assignmentFeatures.guardianv2, undefined);
    assert.equal(result.assignmentFeatures.unified_exec, true);
    h.c.body = compact(h.c.body, true); assert.equal(ready(h.project()).assignmentFeatures.unified_exec, true);
  }
  const corrupt = fixture(); corrupt.c.body = compact(corrupt.c.body);
  corrupt.c.body.dynamic_configs['2553103476'] = { v: {} };
  assert.equal(corrupt.project().status, 'not-ready', 'local schema catch must not hide corrupt value-pool indexes');
});
await test('async compaction local safeParse omits malformed whole values without rejecting other features', () => {
  const values = [false, [], 'wrong', 42], results = [];
  for (const value of values) {
    const h = fixture(); h.c.body.dynamic_configs['763333490'] = { value }; h.c.body.feature_gates['1786883712'] = { value: true };
    results.push(h.project().status);
  }
  assert.deepEqual(results, values.map(() => 'ready'));
  for (const value of values) {
    const h = fixture(); h.c.body.dynamic_configs['763333490'] = { value }; h.c.body.feature_gates['1786883712'] = { value: true };
    const result = ready(h.project()); assert.equal(result.assignmentFeatures.async_compaction, undefined); assert.equal(result.assignmentFeatures.unified_exec, true);
    h.c.body = compact(h.c.body, true); assert.equal(ready(h.project()).assignmentFeatures.async_compaction, undefined);
  }
});
await test('typed parameter getters fallback on non-record sources but retain corrupt entry and pool-index rejection', () => {
  const values = [false, [], 'wrong', 42], results = [];
  for (const value of values) {
    const h = fixture(); h.c.body.dynamic_configs['914834687'] = { value }; h.c.body.layer_configs['3902942138'] = { value };
    h.c.body.layer_configs['1055689174'] = { value }; results.push(h.project().status);
  }
  assert.deepEqual(results, values.map(() => 'ready'));
  for (const value of values) {
    const h = fixture(); h.c.body.dynamic_configs['914834687'] = { value }; h.c.body.layer_configs['3902942138'] = { value };
    h.c.body.layer_configs['1055689174'] = { value };
    const result = ready(h.project()); assert.equal(result.values.deferredToolOutput, false); assert.equal(result.values.guardianV2Experiment, undefined);
    h.c.body = compact(h.c.body, true); assert.equal(ready(h.project()).values.deferredToolOutput, false);
  }
  for (const table of ['dynamic_configs', 'layer_configs']) {
    const h = fixture(), key = table === 'dynamic_configs' ? '914834687' : '3902942138';
    h.c.body[table][key] = false; assert.equal(h.project().status, 'not-ready');
    h.c.body = compact(payload()); h.c.body[table][key] = { v: {} }; assert.equal(h.project().status, 'not-ready');
  }
});
await test('guardian source preserves original feature values on missing or invalid runtime versions', () => {
  const { api } = fixture();
  const experiment = { min_app_server_version: '0.165.0', config: { enabled: true }, config_rules: [{ min_app_server_version: '0.166.0', config: { future: true } }] };
  for (const guardianv2 of [false, { enabled: false, untouched: true }]) {
    const base = { guardianv2, unrelated: true };
    for (const runtime of [null, 'invalid', '0.164.0']) assert.deepEqual(clone(api.projectWorkGuardianFeatures(base, experiment, runtime)), clone(base));
    const anyVersion = api.projectWorkGuardianFeatures(base, experiment, '0.0.0');
    assert.equal(anyVersion.guardianv2.enabled, true); assert.equal(anyVersion.guardianv2.future, true);
    const current = api.projectWorkGuardianFeatures(base, experiment, '0.165.0');
    assert.equal(current.guardianv2.enabled, true); assert.equal(current.guardianv2.future, undefined);
    assert.equal(base.guardianv2, guardianv2, 'projection must not mutate caller features');
  }
});
console.log(`Work execution preparation: ${groups} groups passed`);

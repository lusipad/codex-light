import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const exports = {}; modules.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: name => name === './workExecutionPreparation' ? load('src/workExecutionPreparation.ts') : {} }, { filename: file });
  return exports;
}
const api = load('src/workLocalRequest.ts');
const clone = value => JSON.parse(JSON.stringify(value));
const identity = { userId: 'request-user', accountId: 'request-account', generation: 8 };
const preparation = () => ({ status: 'ready', identity, assignmentIdentity: { userId: identity.userId, accountId: identity.accountId, authMethod: 'chatgpt', stableId: 'request-device' },
  values: { personality: {}, instructions: {} }, assignmentFeatures: {}, defaultEnableFeatures: { unified_exec: true },
  policy: 'preference', settings: { configuredDetail: 'STEPS_PROSE', effectiveDetail: 'STEPS_PROSE', defaultModeRequestUserInput: true }, missingInputs: [] });
const base = () => ({ cwd: 'D:/request-project', projectId: 'actual-project', runtimeWorkspaceRoots: ['D:/request-project'],
  approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write', config: { web_search: 'cached', 'features.unified_exec': false } });
const result = api.buildWorkLocalThreadRequest({ baseParams: base(), selection: { model: 'actual-work-model', reasoningEffort: 'high' },
  hostConfig: {}, preparation: preparation(), appServerVersion: '0.165.0', preparedDeveloperInstructions: 'actually assembled instructions' });
assert.equal(result.request.serviceName, 'codex_work_desktop');
assert.equal(result.request.model, 'actual-work-model');
assert.equal(result.request.config.model_reasoning_effort, 'high');
assert.equal(result.request.config['features.unified_exec'], false);
assert.deepEqual(clone(result.missingInputs), []);
let groups = 1;
console.log('PASS first-turn request preserves resolved policy and config precedence');
function test(name, run) { run(); ++groups; console.log('PASS', name); }
function thread(overrides = {}) { return api.buildWorkLocalThreadRequest({ baseParams: base(), hostConfig: {}, selection: { model: 'actual-work-model', reasoningEffort: 'high' },
  preparation: preparation(), appServerVersion: '0.165.0', preparedDeveloperInstructions: null, ...overrides }); }
test('thread request source golden has no invented permissions, prompt serializer or ordinary model fallback', () => {
  assert.deepEqual(clone(result.request), { ...base(), model: 'actual-work-model', personality: 'friendly', serviceName: 'codex_work_desktop',
    developerInstructions: 'actually assembled instructions', config: { ...base().config, model_reasoning_effort: 'high' } });
  assert.deepEqual(clone(result.instructionOptions), { model: 'actual-work-model', includeProseDetailLevelInstructions: true, writingBlockInstructions: false });
  const p = preparation(); p.settings.effectiveDetail = 'STEPS_COMMANDS'; p.defaultEnableFeatures.writing_blocks = true;
  const commands = thread({ preparation: p }); assert.equal(commands.request.serviceName, undefined);
  assert.equal(commands.instructionOptions.writingBlockInstructions, false);
  p.settings.effectiveDetail = 'STEPS_PROSE'; assert.equal(thread({ preparation: p }).instructionOptions.writingBlockInstructions, true);
  assert.equal(thread({ preparation: p }).request.config['features.writing_blocks'], undefined);
  assert.deepEqual(clone(thread({ preparedDeveloperInstructions: undefined }).missingInputs), ['project-aware-developer-instructions']);
  assert.deepEqual(clone(thread({ preparedDeveloperInstructions: null }).missingInputs), []);
  assert.deepEqual(clone(thread({ preparation: { status: 'not-ready', identity, missingInputs: ['bootstrap'] } })), { request: null, instructionOptions: null, missingInputs: ['bootstrap'] });
  assert.ok(thread({ selection: { model: null, reasoningEffort: null } }).missingInputs.includes('selected-work-model'));
});
test('personality uses actual host config before source assignment and only accepts source enums', () => {
  const p = preparation(); p.values.personality.default_personality = 'pragmatic';
  assert.equal(thread({ preparation: p }).request.personality, 'pragmatic');
  assert.equal(thread({ preparation: p, hostConfig: { model_personality: 'friendly' } }).request.personality, 'friendly');
  assert.equal(thread({ preparation: p, hostConfig: { personality: 'pragmatic', model_personality: 'friendly' } }).request.personality, 'pragmatic');
  assert.equal(thread({ preparation: p, hostConfig: { personality: 'none', model_personality: 'friendly' } }).request.personality, 'friendly');
  p.values.personality.default_personality = 'invented'; assert.equal(thread({ preparation: p }).request.personality, 'friendly');
});
test('hR source feature compatibility and nr exclusion/config precedence remain distinct', () => {
  const excluded = ['search_mcp', 'local_work_search_mcp', 'auth_elicitation', 'mcp_lazy_stdio_startup', 'plugins', 'apps', 'tool_suggest', 'tool_call_mcp_elicitation', 'writing_blocks'];
  const features = Object.fromEntries(excluded.map(key => [key, true]));
  Object.assign(features, { unified_exec: true, guardian_native_multi_agent_history: true, skill_catalog_deltas: true, incremental_tools: true,
    incremental_tools_legacy: true, incremental_tools_legacy_gcp: true, command_sessions_world_state: true,
    guardianv2: { enabled: true, original: 'preserved' }, 'features.custom_candidate': false });
  const current = api.projectWorkLocalFeatureConfig(features, { 'features.unified_exec': false, web_search: 'cached' }, '0.165.0');
  for (const key of [...excluded, 'guardian_native_multi_agent_history', 'skill_catalog_deltas', 'incremental_tools_legacy', 'incremental_tools_legacy_gcp', 'command_sessions_world_state']) assert.equal(current['features.' + key], undefined, key);
  assert.equal(current['features.incremental_tools'], true); assert.equal(current['features.unified_exec'], false);
  assert.equal(current['features.custom_candidate'], false); assert.equal(current.web_search, 'cached');
  assert.deepEqual(clone(current['features.guardianv2']), { enabled: true, original: 'preserved' });
  const old = api.projectWorkLocalFeatureConfig(features, {}, '0.147.0'); assert.equal(old['features.guardianv2'], true);
  const development = api.projectWorkLocalFeatureConfig(features, {}, '0.0.0');
  for (const key of ['guardian_native_multi_agent_history', 'skill_catalog_deltas', 'incremental_tools_legacy', 'incremental_tools_legacy_gcp', 'command_sessions_world_state']) assert.equal(development['features.' + key], true, key);
  const invalid = api.projectWorkLocalFeatureConfig(features, {}, 'invalid'); assert.equal(invalid['features.incremental_tools'], undefined);
  assert.equal(invalid['features.guardianv2'], true);
  assert.equal(features.unified_exec, true, 'does not mutate source assignments');
});
test('named runtime thresholds, alpha exceptions and unknown versions follow fixed JF', () => {
  const thresholds = [
    ['guardian_native_multi_agent_history', '0.166.0-alpha.3'], ['multi_agent_v2.preserve_fork_prefix', '0.163.0-alpha.4'],
    ['async_compaction', '0.163.0-alpha.11'], ['output_token_replay', '0.163.0-alpha.6'], ['incremental_tools', '0.162.0-alpha.17'],
    ['skill_catalog_deltas', '0.166.0-alpha.1'], ['incremental_tools_legacy', '0.169.0-alpha.2'], ['reasoning_effort_override', '0.156.0'],
    ['instant_interrupt', '0.159.0'], ['apply_patch_preserve_line_endings', '0.148.0-alpha.6'], ['deferred_tool_world_state', '0.146.0-alpha.6'],
    ['mcp_oauth_refresh_coordination', '0.154.0-alpha.1'], ['guardianv2_decisions_comparison', '0.162.0-alpha.2'] ];
  for (const [key, minimum] of thresholds) {
    assert.equal(api.projectWorkLocalFeatureConfig({ [key]: false }, {}, minimum)['features.' + key], false, minimum);
    assert.equal(api.projectWorkLocalFeatureConfig({ [key]: false }, {}, '0.1.0')['features.' + key], undefined, key);
  }
  for (const [runtime, expected] of [['0.149.0-alpha.4.2', undefined], ['0.149.0-alpha.4.3', true], ['0.149.0-alpha.7.2', undefined],
    ['0.149.0-alpha.7.3', true], ['0.150.0-alpha.1', undefined], ['0.150.0', true], ['0.149.1', true], [null, undefined]]) {
    assert.equal(api.projectWorkLocalFeatureConfig({ compaction_image_budget: true }, {}, runtime)['features.compaction_image_budget'], expected, String(runtime));
  }
});
test('first turn uses acknowledged model or collaboration settings and preserves actual inputs/permissions', () => {
  const input = [{ type: 'text', text: 'actual draft', text_elements: [] }, { type: 'localImage', path: 'D:/private-fixture.png' }];
  const policy = { type: 'workspaceWrite', writableRoots: ['D:/request-project'], networkAccess: false };
  const baseParams = { cwd: 'D:/acknowledged', runtimeWorkspaceRoots: ['D:/acknowledged'], input, sandboxPolicy: policy,
    approvalPolicy: 'untrusted', approvalsReviewer: 'auto_review', summary: 'concise', serviceTier: 'fast', model: 'stale-model', effort: 'stale-effort' };
  const ordinary = api.buildWorkLocalTurnRequest({ baseParams, threadId: 'ack-thread', createdThreadModel: 'server-model' });
  assert.equal(ordinary.model, 'server-model'); assert.equal(ordinary.effort, undefined); assert.equal(ordinary.input, input); assert.equal(ordinary.sandboxPolicy, policy);
  const collaborationMode = { mode: 'default', settings: { model: 'actual-work-model', reasoning_effort: 'high', developer_instructions: null } };
  const collaborative = api.buildWorkLocalTurnRequest({ baseParams, threadId: 'ack-thread', createdThreadModel: 'server-model', collaborationMode });
  assert.equal(collaborative.model, null); assert.equal(collaborative.effort, 'high'); assert.equal(collaborative.collaborationMode, collaborationMode);
  for (const key of ['cwd', 'runtimeWorkspaceRoots', 'approvalPolicy', 'approvalsReviewer', 'summary', 'serviceTier']) assert.deepEqual(clone(collaborative[key]), clone(baseParams[key]));
  assert.equal(baseParams.model, 'stale-model');
});
test('MCP source double JSON metadata retains restrictions, scope and unrelated keys', () => {
  const metadata = { unrelated: 'original', mcp_request_meta: JSON.stringify({ other: { preserve: true }, 'openai/search_context': JSON.stringify({ is_web_access_restricted: true, old: 'preserve' }) }) };
  const context = { mode: 'live', defaultModeOnFullAccess: 'live', legalModel: 'not-wire', session_persistent: true, is_web_access_restricted: false, allowed_domains: [] };
  const result = api.mergeWorkSearchMcpMetadata(metadata, context, { sandboxPolicy: { type: 'dangerFullAccess' } });
  const outer = JSON.parse(result.mcp_request_meta), search = JSON.parse(outer['openai/search_context']);
  assert.equal(result.unrelated, 'original'); assert.deepEqual(outer.other, { preserve: true }); assert.equal(search.is_web_access_restricted, true);
  assert.equal(search.old, 'preserve'); assert.equal(search.mode, 'live'); assert.equal(search.allowed_domains, undefined);
  assert.equal(search.defaultModeOnFullAccess, undefined); assert.equal(search.legalModel, undefined);
  assert.equal(api.mergeWorkSearchMcpMetadata(metadata, null), metadata);
  assert.throws(() => api.mergeWorkSearchMcpMetadata({ mcp_request_meta: '[]' }, context));
  assert.throws(() => api.mergeWorkSearchMcpMetadata({ mcp_request_meta: '{' }, context));
});
test('MCP full-access override uses request permission precedence without loosening existing restricted state', () => {
  const context = { mode: 'live', defaultModeOnFullAccess: 'cached', session_persistent: false, is_web_access_restricted: false, allowed_domains: ['example.test'] };
  const project = (current, request) => JSON.parse(JSON.parse(api.mergeWorkSearchMcpMetadata(undefined, context, current, request).mcp_request_meta)['openai/search_context']);
  assert.equal(project({ activePermissionProfile: { id: ':danger-full-access' } }).mode, 'cached');
  assert.equal(project({ activePermissionProfile: { id: ':danger-full-access' } }, { sandboxPolicy: { type: 'readOnly' } }).mode, 'live');
  assert.equal(project({ sandboxPolicy: { type: 'readOnly' } }, { permissions: ':danger-full-access' }).is_web_access_restricted, true);
  assert.deepEqual(project({ sandboxPolicy: { type: 'readOnly' } }).allowed_domains, ['example.test']);
});
console.log(`Work local request: ${groups} groups passed`);

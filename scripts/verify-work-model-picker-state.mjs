import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const api = {}, file = 'src/workModelPickerState.ts';
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: api, require() { return {}; } }, { filename: file });
const catalog = () => ({ defaultModelSlug: 'work-current', modelConfigBySlug: { 'work-current': { title: 'Actual model' } },
  options: [{ slug: 'work-current', thinkingEffort: 'standard', title: 'Service Standard' }, { slug: 'work-current', thinkingEffort: 'extended', title: 'Service Extended' }],
  internalOptions: [], chatAlphaOptions: [], categories: [], versionOptions: [], sliderSettings: [], defaultThinkingEffortByModelSlug: { 'work-current': 'standard' }, disabledVersionSlugs: [] });
const result = api.projectWorkModelPickerState({ catalog: catalog(), selection: { slug: 'work-current', thinkingEffort: 'extended' } });
assert.equal(result.selectedPowerId, 'work-current:extended');
assert.deepEqual(JSON.parse(JSON.stringify(result.powerOptions.map(option => [option.id, option.label]))), [
  ['work-current:standard', 'Service Standard'], ['work-current:extended', 'Service Extended'] ]);
console.log('PASS real service power order and labels');
let groups = 1;
const clone = value => JSON.parse(JSON.stringify(value));
function test(name, run) { run(); ++groups; console.log('PASS', name); }
function versions() {
  const latest = [
    { slug: 'current-instant', thinkingEffort: null, lane: 'instant', title: '服务 Instant' },
    { slug: 'current-thinking', thinkingEffort: 'standard', lane: 'thinking', title: '服务普通', selectedLabel: '真实标准', selectedDisplayVersion: 'V2' },
    { slug: 'current-thinking', thinkingEffort: 'extended', lane: 'thinking', title: '服务加长', selectedLabel: '真实加长', selectedDisplayVersion: 'V2' },
  ];
  const older = [ { slug: 'older-instant', thinkingEffort: null, lane: 'instant', title: 'Old Instant' },
    { slug: 'older-thinking', thinkingEffort: 'standard', lane: 'thinking', title: 'Old Standard' } ];
  return { ...catalog(), defaultModelSlug: 'current-thinking', options: latest,
    modelConfigBySlug: { 'current-thinking': { title: 'Raw current model', thinking_efforts: [{ thinking_effort: 'ultra', full_label: '完整真实Ultra', short_label: '短Ultra' }] },
      'current-instant': { title: 'Raw instant' }, 'older-thinking': { title: 'Old model', disabledByAdmin: true } },
    internalOptions: [{ slug: 'current-thinking', thinkingEffort: 'ultra', title: 'Raw current model' }],
    versionOptions: [ { id: 'v1', slugs: ['older-instant', 'older-thinking'], options: older, modelSlugByLane: { instant: 'older-instant', thinking: 'older-thinking' }, display_text: '旧版原始名称', picker_group: 'older', enabled: false },
      { id: 'latest', slugs: ['current-instant', 'current-thinking'], options: latest, modelSlugByLane: { instant: 'current-instant', thinking: 'current-thinking' }, display_text_for_intelligence: '服务当前版本' } ],
    sliderSettings: [{ modelSlug: 'current-thinking', thinkingEffort: 'ultra' }, { modelSlug: 'current-thinking', thinkingEffort: 'standard' }],
    defaultThinkingEffortByModelSlug: { 'current-thinking': 'standard', 'older-thinking': 'standard' } };
}
test('home advanced golden preserves version/older service order and never expands invented default or effort rows', () => {
  const value = api.projectWorkModelPickerState({ catalog: versions(), selection: { slug: 'current-thinking', thinkingEffort: 'extended', versionId: 'latest' } });
  assert.deepEqual(clone(value.rows.map(row => ({ id: row.id, kind: row.kind, versionId: row.versionId, label: row.label, group: row.group ?? null, selected: row.selected,
    selection: row.selection, disabled: row.disabled, available: row.available, adminDisabled: row.adminDisabled }))), [
    { id: 'v1', kind: 'version', versionId: 'v1', label: '旧版原始名称', group: 'older', selected: false,
      selection: { slug: 'older-thinking', thinkingEffort: 'standard', versionId: 'v1' }, disabled: false, available: false, adminDisabled: true },
    { id: 'latest', kind: 'version', versionId: 'latest', label: '服务当前版本', group: null, selected: true,
      selection: { slug: 'current-thinking', thinkingEffort: 'extended', versionId: 'latest' }, disabled: false, available: true, adminDisabled: false },
  ]);
  assert.ok(value.rows.every(row => row.kind !== 'default'));
  assert.equal(value.label, 'V2 真实加长');
});
test('version powers keep option-first and slider-only-extra source order, labels and version identity', () => {
  const value = api.projectWorkModelPickerState({ catalog: versions(), selection: { slug: 'current-thinking', thinkingEffort: 'extended' } });
  assert.deepEqual(clone(value.powerOptions.map(option => [option.id, option.label, option.selection.versionId])), [
    ['current-instant:', '服务 Instant', 'latest'], ['current-thinking:standard', '真实标准', 'latest'],
    ['current-thinking:extended', '真实加长', 'latest'], ['current-thinking:ultra', 'Raw current model 短Ultra', 'latest'],
  ]);
  assert.equal(value.selectedPowerId, 'current-thinking:extended');
  assert.equal(value.powerOptions[0].reasoningEffort, 'none'); assert.equal(value.powerOptions[1].reasoningEffort, 'medium');
});
test('version preference only selects a compatible browse version and does not rewrite committed model/effort', () => {
  const c = versions(), selection = { slug: 'current-thinking', thinkingEffort: 'standard', versionId: 'latest' };
  const matching = { ...c.versionOptions[0], id: 'shared-old', slugs: ['current-thinking'], options: [c.options[1]], modelSlugByLane: { thinking: 'current-thinking' }, picker_group: 'older' };
  c.versionOptions.unshift(matching);
  const preference = { versionId: 'shared-old', selectionMode: 'default' };
  const value = api.projectWorkModelPickerState({ catalog: c, selection, versionPreference: preference });
  assert.equal(value.activeVersionId, 'shared-old'); assert.equal(value.selectionMode, 'model'); assert.equal(value.selectedPowerId, 'current-thinking:standard');
  assert.equal(value.powerOptions[0].selection.versionId, 'shared-old'); assert.deepEqual(selection, { slug: 'current-thinking', thinkingEffort: 'standard', versionId: 'latest' });
  matching.options = [c.options[2]];
  assert.equal(api.projectWorkModelPickerState({ catalog: c, selection, versionPreference: preference }).activeVersionId, 'latest', 'wrong effort must not override committed selection');
  assert.equal(api.projectWorkModelPickerState({ catalog: c, selection, versionPreference: { versionId: 'v1', selectionMode: 'model' } }).activeVersionId, 'latest', 'wrong slug must not override committed selection');
  assert.equal(api.projectWorkModelPickerState({ catalog: c, selection: { ...selection, versionId: 'shared-old' } }).activeVersionId, 'latest', 'no preference uses latest-first source fallback, not committed versionId as a substitute');
});
test('latest preference uses its augmented settings option pool, older versions use exact own options', () => {
  const c = versions();
  const extra = { slug: 'current-thinking', thinkingEffort: 'ultra' };
  const latest = api.projectWorkModelPickerState({ catalog: c, selection: extra, versionPreference: { versionId: 'latest', selectionMode: 'default' } });
  assert.equal(latest.activeVersionId, 'latest'); assert.equal(latest.selectedPowerId, 'current-thinking:ultra');
});
test('no real options produce no fabricated auto, default selection or search-style rows', () => {
  const c = { ...catalog(), defaultModelSlug: 'auto', options: [], modelConfigBySlug: {}, defaultThinkingEffortByModelSlug: {} };
  const value = api.projectWorkModelPickerState({ catalog: c, selection: { slug: 'auto', thinkingEffort: null } });
  assert.deepEqual(clone(value.rows), []); assert.deepEqual(clone(value.powerOptions), []); assert.equal(value.defaultSelection, null);
  assert.equal(value.selectedPowerId, null); assert.equal(value.label, '选择 ChatGPT 模型');
});
test('fallback powers are not claimed as source defaults unless the exact model/SOL and effort contract allows it', () => {
  const c = catalog(); c.defaultModelSlug = 'unlisted';
  const value = api.projectWorkModelPickerState({ catalog: c, selection: { slug: 'unlisted', thinkingEffort: 'standard' } });
  assert.equal(value.defaultSelection, null); assert.equal(value.selectedPowerId, null);
  const sol = { ...c, defaultModelSlug: 'gpt-sol-v2', options: [{ slug: 'gpt-sol-v1', thinkingEffort: 'standard', title: 'Source SOL' }],
    defaultThinkingEffortByModelSlug: { 'gpt-sol-v2': 'standard' } };
  assert.deepEqual(clone(api.projectWorkModelPickerState({ catalog: sol, selection: { slug: 'gpt-sol-v2', thinkingEffort: 'standard' } }).defaultSelection),
    { slug: 'gpt-sol-v1', thinkingEffort: 'standard', versionId: null });
});
test('model rows preserve service effort enums, raw labels and availability/admin metadata without inventing limits', () => {
  const c = catalog(); c.modelConfigBySlug['work-current'].disabledByAdmin = true; c.options[1].isAvailable = false;
  const value = api.projectWorkModelPickerState({ catalog: c, selection: { slug: 'work-current', thinkingEffort: 'standard' } });
  assert.deepEqual(clone(value.rows.map(row => [row.kind, row.id, row.label, row.selected, row.available, row.adminDisabled])), [
    ['model', 'work-current:standard', 'Service Standard', true, true, true],
    ['model', 'work-current:extended', 'Service Extended', false, false, true],
  ]);
  assert.deepEqual(clone(value.rows[1].selection), { slug: 'work-current', thinkingEffort: 'extended', versionId: null });
  assert.ok(!Object.hasOwn(value, 'modelLimits')); assert.ok(!Object.hasOwn(value, 'daybreak')); assert.ok(!Object.hasOwn(value, 'speed'));
});
test('projection leaves real catalog and committed preference data untouched', () => {
  const c = versions(), before = clone(c), selection = { slug: 'current-thinking', thinkingEffort: 'extended', versionId: 'latest' };
  api.projectWorkModelPickerState({ catalog: c, selection, versionPreference: { versionId: 'v1', selectionMode: 'model' } });
  assert.deepEqual(clone(c), before); assert.deepEqual(selection, { slug: 'current-thinking', thinkingEffort: 'extended', versionId: 'latest' });
});
console.log(`Work model picker state: ${groups} groups passed`);

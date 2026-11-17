import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';
const file = 'src/workDeveloperInstructions.ts', exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
  { exports, TextEncoder }, { filename: file });
const input = () => ({ threadId: null, customInstructions: null, gitSettings: { branchPrefix: 'codex/', commitInstructions: '', pullRequestInstructions: '' },
  gitWorkspace: 'unknown', artifactFollowupsEnabled: false, workspaceDependenciesEnabled: false, worktreeCreationPreference: false,
  tools: { thread: false, worktree: false, worktreeLifecycle: false, sidebarSections: false },
  includeProseDetailLevelInstructions: false, writingBlockInstructions: false });
const output = exports.buildWorkDeveloperInstructions(input());
assert.ok(output.startsWith('<app-context>\n# Codex desktop context'));
assert.ok(output.endsWith('</app-context>'));
assert.ok(output.includes('### Git\n- Branch prefix: `codex/`.'));
let groups = 1;
console.log('PASS actual local first-chat instructions have source context and Git guidance');
const clone = value => JSON.parse(JSON.stringify(value));
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function test(name, run) { run(); ++groups; console.log('PASS', name); }
test('fixed source golden for minimal local context and explicit non-Git differs only by Git section', () => {
  // Independently frozen from DI02/03 static literals + the source section order.
  // No ignored .ref dependency and no official JavaScript is executed by this test.
  assert.equal(output.length, 4134); assert.equal(hash(output), '4355363ff80cc514d488437da04f5b691bf689e61b1563eae08dab2e64ab94c3');
  const nonGit = exports.buildWorkDeveloperInstructions({ ...input(), gitWorkspace: 'non-git' });
  assert.equal(nonGit.length, 3984); assert.equal(hash(nonGit), '09c1ded4ecb9d7e41401510fe169b3bbaf080635dd99db7c8d8602702589def5');
  assert.equal(exports.buildWorkDeveloperInstructions({ ...input(), gitWorkspace: 'git' }), output, 'unknown must not masquerade as non-Git');
});
test('source golden covers every actual tool/section flag and final append order', () => {
  const result = exports.buildWorkDeveloperInstructions({ ...input(), baseInstructions: ' base ', customInstructions: ' custom ',
    gitSettings: { branchPrefix: ' codex/ ', commitInstructions: ' Commit fixture ', pullRequestInstructions: ' PR fixture ' },
    instructionOverrides: { desktopContextSection: 'Model desktop', workspaceDependenciesSection: 'Model dependencies', worktreeInstructionsIncluded: true },
    artifactFollowupsEnabled: true, workspaceDependenciesEnabled: true,
    tools: { thread: true, worktree: true, worktreeLifecycle: true, sidebarSections: true, mcpWorktreeAttach: true, runningSummary: true },
    includeProseDetailLevelInstructions: true, writingBlockInstructions: true, additionalDeveloperInstructions: ' extra ' });
  assert.equal(result.length, 11354); assert.equal(hash(result), '16aa987a31de96d58afe726d0f58260a486d4198ee27f2601d80ba5808fc58f5');
  assert.ok(result.startsWith('base \n\n custom\n\n<app-context>\nModel desktop'));
  const positions = ['Model dependencies', '### Automations', '### Thread Coordination', '### Worktrees', '### Sidebar Organization',
    '### Non-technical UI', '### Inline Code Comments', '### Inline Artifact Follow-Ups', '### Git', '</app-context>',
    'When a worktree is needed,', 'The pet activity pill uses', '### Writing blocks', ' extra '].map(text => result.indexOf(text));
  assert.ok(positions.every((position, i) => position >= 0 && (i === 0 || position > positions[i - 1])));
});
test('tool flags, independent worktree preference and artifact flags do not advertise unregistered capabilities', () => {
  const overrides = { worktreeInstructionsIncluded: true, workspaceDependenciesSection: 'Actual dependencies' };
  const disabled = exports.buildWorkDeveloperInstructions({ ...input(), instructionOverrides: overrides, worktreeCreationPreference: true,
    tools: { thread: false, worktree: false, worktreeLifecycle: true, sidebarSections: true } });
  for (const marker of ['### Thread Coordination', '### Worktrees', '### Sidebar Organization', 'Actual dependencies', '### Inline Artifact Follow-Ups', '### Writing blocks']) assert.ok(!disabled.includes(marker), marker);
  const preferred = exports.buildWorkDeveloperInstructions({ ...input(), worktreeCreationPreference: true,
    tools: { thread: false, worktree: true, worktreeLifecycle: false, sidebarSections: false } });
  assert.ok(preferred.includes('### Worktrees')); assert.ok(!preferred.includes('For worktrees created with `create_worktree`'));
  const unselected = exports.buildWorkDeveloperInstructions({ ...input(), tools: { thread: false, worktree: true, worktreeLifecycle: true, sidebarSections: false } });
  assert.ok(!unselected.includes('### Worktrees'));
  const artifacts = exports.buildWorkDeveloperInstructions({ ...input(), artifactFollowupsEnabled: true });
  assert.ok(artifacts.includes('### Inline Artifact Follow-Ups'));
});
test('model override selection is exact, trims context and keeps original memory prompt whitespace', () => {
  const values = { instructions: { chosen: { desktop_context_section: '  Actual model context  ', workspace_dependencies_section: '\nActual deps\t', memory_read_prompt: ' \nMemory text\t' },
    other: { desktop_context_section: 'Never selected' }, worktree_instructions_included: true }, gitWorktreeAttach: { mcpToolsSearchable: false } };
  assert.deepEqual(clone(exports.parseModelInstructionOverrides(values, 'chosen')), { desktopContextSection: 'Actual model context', workspaceDependenciesSection: 'Actual deps',
    memoryReadPrompt: ' \nMemory text\t', worktreeInstructionsIncluded: true, gitWorktreeAttach: { mcpToolsSearchable: false } });
  assert.deepEqual(clone(exports.parseModelInstructionOverrides(values, null)), { worktreeInstructionsIncluded: true, gitWorktreeAttach: { mcpToolsSearchable: false } });
  assert.equal(exports.parseModelInstructionOverrides({ instructions: { chosen: { desktop_context_section: ' \n', memory_read_prompt: '\t' } } }, 'chosen'), null);
  assert.equal(exports.parseModelInstructionOverrides({ instructions: { chosen: { unrelated: 42 } } }, 'chosen'), null);
});
test('a malformed known field discards the whole model record but preserves independent global flags', () => {
  for (const invalid of [null, 42, false, [], {}]) {
    const values = { instructions: { chosen: { desktop_context_section: 'would be valid', memory_read_prompt: invalid }, worktree_instructions_included: true } };
    assert.deepEqual(clone(exports.parseModelInstructionOverrides(values, 'chosen')), { worktreeInstructionsIncluded: true });
  }
  for (const raw of [null, false, 42, [], 'invalid']) assert.equal(exports.parseModelInstructionOverrides({ instructions: { chosen: raw } }, 'chosen'), null);
  assert.equal(exports.parseModelInstructionOverrides({ instructions: { chosen: { desktop_context_section: null, memory_read_prompt: 'would be valid' } } }, 'chosen'), null);
});
test('all three memory fields enforce character and UTF8 byte bounds independently', () => {
  for (const [source, target] of [['memory_read_prompt', 'memoryReadPrompt'], ['memory_phase_one_prompt', 'memoryPhaseOnePrompt'], ['memory_phase_two_prompt', 'memoryPhaseTwoPrompt']]) {
    for (const text of ['a'.repeat(65536), '中'.repeat(21845), '😀'.repeat(16384)]) {
      const value = exports.parseModelInstructionOverrides({ instructions: { chosen: { [source]: text } } }, 'chosen'); assert.equal(value[target], text);
    }
    for (const text of ['a'.repeat(65537), '中'.repeat(21846), '😀'.repeat(16385)]) {
      const value = exports.parseModelInstructionOverrides({ instructions: { chosen: { desktop_context_section: 'must also drop', [source]: text } } }, 'chosen'); assert.equal(value, null);
    }
  }
});
test('Git settings trim individually while unknown workspace keeps real guidance', () => {
  const value = exports.buildWorkDeveloperInstructions({ ...input(), gitSettings: { branchPrefix: ' \t', commitInstructions: ' Commit\ncontinuation ', pullRequestInstructions: ' PR ' } });
  assert.ok(!value.includes('- Branch prefix:')); assert.ok(value.includes('### Git\n- Commit instructions: Commit\ncontinuation\n- Pull request instructions: PR'));
  const empty = exports.buildWorkDeveloperInstructions({ ...input(), gitSettings: { branchPrefix: '', commitInstructions: '', pullRequestInstructions: '' } });
  assert.ok(!empty.includes('### Git\n'));
});
test('additional instructions retain source bytes and do not become fake defaults', () => {
  assert.equal(exports.buildWorkDeveloperInstructions({ ...input(), additionalDeveloperInstructions: '' }), output + '\n\n');
  assert.equal(exports.buildWorkDeveloperInstructions({ ...input(), additionalDeveloperInstructions: '\n extra \t' }), output + '\n\n\n extra \t');
  assert.equal(exports.buildWorkDeveloperInstructions({ ...input(), additionalDeveloperInstructions: null }), output);
  assert.throws(() => exports.buildWorkDeveloperInstructions({ ...input(), customInstructions: undefined }));
  assert.throws(() => exports.buildWorkDeveloperInstructions({ ...input(), threadId: 'old-heartbeat-thread' }));
});
test('restored local chat requires explicit heartbeat proof and inactive restores keep the first-chat source output', () => {
  assert.equal(exports.buildWorkDeveloperInstructions({ ...input(), threadId: 'restored-thread', heartbeatEnabled: false }), output);
  for (const heartbeatEnabled of [undefined, null, 'false']) {
    assert.throws(() => exports.buildWorkDeveloperInstructions({ ...input(), threadId: 'restored-thread', heartbeatEnabled }), error => error.code === 'heartbeat-unconfirmed');
  }
  assert.equal(exports.buildWorkDeveloperInstructions({ ...input(), heartbeatEnabled: true }), output, 'null thread ID cannot activate heartbeat guidance');
});
test('confirmed active heartbeat restores use the independent fixed source golden before Git and final appended sections', () => {
  const active = exports.buildWorkDeveloperInstructions({ ...input(), threadId: 'actual-heartbeat-target', heartbeatEnabled: true });
  // Frozen from DI02/03's ay data + module71530.py; no source code execution.
  assert.equal(active.length, 6735); assert.equal(hash(active), '7b7b8d6884c36289ac1ceb15062827069e915aae5d4ad82f58bd63d850921013');
  assert.equal(active.split('## Heartbeats').length - 1, 1);
  assert.ok(active.indexOf('## Heartbeats') < active.indexOf('### Git\n'));
  assert.ok(active.includes('call it with `mode="delete"` and that automation id'));
  const appended = exports.buildWorkDeveloperInstructions({ ...input(), threadId: 'actual-heartbeat-target', heartbeatEnabled: true,
    writingBlockInstructions: true, additionalDeveloperInstructions: 'real extra' });
  assert.ok(appended.indexOf('## Heartbeats') < appended.indexOf('</app-context>'));
  assert.ok(appended.indexOf('</app-context>') < appended.indexOf('### Writing blocks'));
  assert.ok(appended.endsWith('\n\nreal extra'));
});
console.log(`Work developer instructions: ${groups} groups passed`);

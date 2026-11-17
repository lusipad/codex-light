import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const file = 'src/workModelPermissionDecision.ts', api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: api }, { filename: file });
const input = () => ({ isConfigDataPending: false, requirements: null, resolvedConfig: {}, current: { model: 'current', reasoningEffort: 'medium', agentMode: 'auto', permissionProfileId: null },
  candidate: { model: 'ordinary', reasoningEffort: 'high' }, statsigGuardianEnabled: false, hasAuthoritativeGuardianApprovalDefault: false });
assert.equal(api.decideWorkModelPermissions(input()).status, 'allowed');
const required = input(); required.requirements = { autoReview: { requiredOnModels: ['required'] } }; required.candidate.model = 'provider/required';
assert.equal(api.decideWorkModelPermissions(required).status, 'needs-guardian');
console.log('PASS source ordinary and required-model precedence');
let groups = 1;
const clone = value => JSON.parse(JSON.stringify(value));
function test(name, run) { run(); ++groups; console.log('PASS', name); }
const onlyGuardian = () => ({ allowedPermissionProfiles: { ':workspace': true }, allowedSandboxModes: ['workspace-write'],
  allowedApprovalPolicies: ['on-request'], allowedApprovalsReviewers: ['auto_review'] });
test('required-model golden strips one valid provider prefix and preserves exact case', () => {
  const requirements = { autoReview: { requiredOnModels: ['target'] } };
  for (const model of ['target', 'openai/target', 'Provider-1_name/target']) assert.equal(api.isWorkModelAutoReviewRequired(requirements, model), true, model);
  for (const model of [null, 'Target', 'openai/Target', '/target', 'a/b/target', 'bad prefix/target', '提供者/target', 'openai\\target']) assert.equal(api.isWorkModelAutoReviewRequired(requirements, model), false, String(model));
  assert.equal(api.isWorkModelAutoReviewRequired(null, 'target'), false);
});
test('only-guardian allowed by actual requirements overrides config false and unknown assignment flags', () => {
  const value = input(); value.requirements = onlyGuardian(); value.resolvedConfig = { 'features.guardian_approval': false };
  value.statsigGuardianEnabled = null; value.hasAuthoritativeGuardianApprovalDefault = null;
  assert.deepEqual(clone(api.projectWorkGuardianAvailability(value)), { guardianAvailable: true, availableAgentModes: ['guardian-approvals'], missingInputs: [] });
  value.candidate.model = 'future-CYBER-model'; assert.equal(api.decideWorkModelPermissions(value).status, 'needs-guardian');
  value.requirements.allowedApprovalsReviewers = ['guardian_subagent']; assert.equal(api.projectWorkGuardianAvailability(value).guardianAvailable, true);
});
test('requirements constrain sandbox/profile/reviewer and granular policy independently of SDK true', () => {
  const value = input(); value.statsigGuardianEnabled = true;
  value.requirements = { allowedPermissionProfiles: { ':read-only': true } };
  assert.deepEqual(clone(api.projectWorkGuardianAvailability(value).availableAgentModes), ['read-only']);
  assert.equal(api.projectWorkGuardianAvailability(value).guardianAvailable, false);
  value.requirements = { allowedApprovalsReviewers: ['user'] }; assert.equal(api.projectWorkGuardianAvailability(value).guardianAvailable, false);
  const granular = { granular: { request_permissions: true, skill_approval: false, mcp_elicitations: true, rules: false, sandbox_approval: false } };
  value.requirements = { allowedPermissionProfiles: { ':workspace': true }, allowedSandboxModes: ['workspace-write'], allowedApprovalsReviewers: ['user'], allowedApprovalPolicies: [granular] };
  assert.deepEqual(clone(api.projectWorkGuardianAvailability(value).availableAgentModes), ['granular']);
  value.requirements.allowedApprovalPolicies = ['on-request'];
  assert.deepEqual(clone(api.projectWorkGuardianAvailability(value).availableAgentModes), ['auto']);
});
test('custom mode counts as a non-guardian mode and reviewer aliases do not treat user as auto-review', () => {
  const value = input(); value.requirements = { allowedSandboxModes: ['workspace-write'], allowedApprovalPolicies: ['on-request'], allowedApprovalsReviewers: ['auto_review'] };
  value.resolvedConfig = { sandbox_mode: 'workspace-write', approval_policy: 'on-request', approvals_reviewer: 'auto_review' };
  assert.deepEqual(clone(api.projectWorkGuardianAvailability(value)), { guardianAvailable: false, availableAgentModes: ['custom'], missingInputs: [] });
  value.resolvedConfig = { sandbox_mode: 'workspace-write', approval_policy: 'on-request', approvals_reviewer: 'user' };
  assert.deepEqual(clone(api.projectWorkGuardianAvailability(value).availableAgentModes), ['guardian-approvals']);
});
test('guardian config boolean precedence and three-way eligibility OR match source short circuits', () => {
  const value = input(); value.statsigGuardianEnabled = true;
  value.resolvedConfig = { 'features.guardian_approval': false, features: { guardian_approval: true } };
  assert.equal(api.projectWorkGuardianAvailability(value).guardianAvailable, false);
  value.resolvedConfig = { 'features.guardian_approval': 'false', features: { guardian_approval: false } };
  assert.equal(api.projectWorkGuardianAvailability(value).guardianAvailable, false);
  value.resolvedConfig = { 'features.guardian_approval': 'not-a-bool' };
  assert.equal(api.projectWorkGuardianAvailability(value).guardianAvailable, true, 'source bAH defaults when no actual boolean');
  value.resolvedConfig = {}; value.statsigGuardianEnabled = null; value.hasAuthoritativeGuardianApprovalDefault = null;
  assert.equal(api.projectWorkGuardianAvailability(value).guardianAvailable, null);
  value.requirements = { autoReview: { requiredOnModels: ['current'] } }; assert.equal(api.projectWorkGuardianAvailability(value).guardianAvailable, true);
  value.requirements = null; value.hasAuthoritativeGuardianApprovalDefault = true; assert.equal(api.projectWorkGuardianAvailability(value).guardianAvailable, true);
  value.hasAuthoritativeGuardianApprovalDefault = false; value.statsigGuardianEnabled = false; assert.equal(api.projectWorkGuardianAvailability(value).guardianAvailable, false);
});
test('callback required/cyber/full-access precedence never becomes an automatic permission upgrade', () => {
  const value = input(); value.requirements = { autoReview: { requiredOnModels: ['required-cyber'] } };
  value.current.agentMode = 'full-access'; value.current.permissionProfileId = undefined; value.candidate = { model: 'required-cyber', reasoningEffort: 'ultra' };
  assert.equal(api.decideWorkModelPermissions(value).reason, 'required-model', 'required candidate takes precedence over missing profile/ultra');
  value.requirements = null; value.statsigGuardianEnabled = true; value.candidate.model = 'prefix-DAYBREAK-suffix';
  assert.equal(api.decideWorkModelPermissions(value).reason, 'cyber-daybreak');
  value.current.model = value.candidate.model;
  assert.deepEqual(clone(api.decideWorkModelPermissions(value).missingInputs), ['permission-profile'], 'unchanged cyber model does not rerun guardian switch');
  value.current.agentMode = 'guardian-approvals'; value.current.model = 'different'; value.statsigGuardianEnabled = null;
  value.hasAuthoritativeGuardianApprovalDefault = null; assert.equal(api.decideWorkModelPermissions(value).status, 'allowed');
});
test('full-access ultra confirmation uses only confirmed builtin/null profiles and previous effort', () => {
  const table = [
    [null, 'medium', 'needs-full-access'], [':workspace', 'medium', 'needs-full-access'], [':danger-full-access', 'high', 'needs-full-access'],
    ['named-profile', 'medium', 'allowed'], [undefined, 'medium', 'not-ready'], [undefined, 'ultra', 'allowed'],
  ];
  for (const [profile, oldEffort, status] of table) {
    const value = input(); value.current.agentMode = 'full-access'; value.current.permissionProfileId = profile; value.current.reasoningEffort = oldEffort;
    value.candidate.reasoningEffort = 'ultra'; assert.equal(api.decideWorkModelPermissions(value).status, status, String(profile) + ':' + oldEffort);
  }
  const value = input(); value.current.permissionProfileId = undefined; value.candidate.reasoningEffort = 'ultra'; assert.equal(api.decideWorkModelPermissions(value).status, 'allowed');
});
test('unknown optional flags/profile do not block ordinary candidates but needed unknowns cannot silently allow', () => {
  const value = input(); value.statsigGuardianEnabled = null; value.hasAuthoritativeGuardianApprovalDefault = null; value.current.permissionProfileId = undefined;
  assert.equal(api.decideWorkModelPermissions(value).status, 'allowed');
  value.candidate.model = 'cyber'; assert.equal(api.decideWorkModelPermissions(value).status, 'not-ready');
  value.resolvedConfig = { 'features.guardian_approval': false }; assert.equal(api.decideWorkModelPermissions(value).status, 'allowed');
  value.requirements = undefined; value.candidate.model = 'ordinary'; assert.equal(api.decideWorkModelPermissions(value).status, 'not-ready');
  value.requirements = { autoReview: { requiredOnModels: null } }; assert.equal(api.decideWorkModelPermissions(value).status, 'allowed');
});
test('pending and malformed related requirements remain not-ready, never truthy permission', () => {
  const value = input(); value.isConfigDataPending = true; assert.equal(api.decideWorkModelPermissions(value).status, 'not-ready');
  value.isConfigDataPending = false; value.candidate.model = 'cyber'; value.statsigGuardianEnabled = true;
  for (const requirements of [ { autoReview: { requiredOnModels: 'cyber' } }, { allowedPermissionProfiles: { ':workspace': 'true' } },
    { allowedApprovalPolicies: 'on-request' }, { allowedApprovalsReviewers: 'auto_review' }, { allowedSandboxModes: true }, { allowedApprovalPolicies: [false] } ]) {
    value.requirements = requirements; assert.equal(api.decideWorkModelPermissions(value).status, 'not-ready', JSON.stringify(requirements));
  }
});
test('pure decision preserves caller account-policy/config/model data and performs no external operations', () => {
  const value = input(), before = clone(value); api.decideWorkModelPermissions(value); api.projectWorkGuardianAvailability(value);
  assert.deepEqual(value, before);
  const keys = Object.keys(api.decideWorkModelPermissions(value)); assert.ok(!keys.includes('permissionPatch')); assert.ok(!keys.includes('request'));
});
console.log(`Work model permissions: ${groups} groups passed`);

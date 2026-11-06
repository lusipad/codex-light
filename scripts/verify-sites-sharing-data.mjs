import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const api = {}, data = {};
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
vm.runInNewContext(compile('src/sitesService.ts'), { exports: data, URL });
vm.runInNewContext(compile('src/siteSharingData.ts'), { exports: api, URL, require: name => { assert.equal(name, './sitesService'); return data; } });
const plain = value => JSON.parse(JSON.stringify(value));
const reference = JSON.parse(fs.readFileSync('scripts/fixtures/sites-sharing-reference.json', 'utf8'));
const policy = extra => ({ access_mode: 'custom', users: [{ account_user_id: 'member', email: 'OWNER@example.invalid', name: '所有者', role: 'owner' }], groups: [], ...extra });
let groups = 0;
async function test(name, fn) { await fn(); groups++; console.log('PASS', name); }
await test('normalization matches complete fixed-package m including owner preservation and editor replacement', async () => {
  assert.equal(reference.version, '26.1027.3384.0'); assert.equal(reference.sources.length, 2);
  for (const source of reference.sources) assert.match(source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(reference.normalization.length, 3);
  for (const { input: sample, users } of reference.normalization) {
    assert.deepEqual(plain(api.parseSiteSharing(sample).users), users);
    assert.equal(sample.allowed_editors?.[0]?.editable, undefined, 'must not mutate caller data');
  }
});
await test('mode options match source Zji; personal missing options empty, workspace fallback, current appended disabled', () => {
  assert.equal(reference.options.length, 32);
  for (const { input, workspace, expected } of reference.options) {
    const parsed = api.parseSiteSharing(policy(input));
    assert.deepEqual(plain(api.siteSharingModeOptions(parsed, workspace)), expected);
  }
});
await test('owner uses member id or case-insensitive email, never global user id or absent identities', () => {
  const parsed = api.parseSiteSharing(policy());
  assert.equal(api.isSiteSharingOwner(parsed, 'member', null), true);
  assert.equal(api.isSiteSharingOwner(parsed, 'other', 'owner@EXAMPLE.invalid'), true);
  assert.equal(api.isSiteSharingOwner(parsed, 'global-user', 'different@example.invalid'), false);
  assert.equal(api.isSiteSharingOwner(api.parseSiteSharing(policy({ users: [{ role: 'owner' }] })), null, null), false);
  assert.equal(api.isSiteSharingOwner(api.parseSiteSharing(policy({ users: [{ role: 'viewer', account_user_id: 'member' }] })), 'member', null), false);
});
await test('null remains unavailable; malformed policy, users, editors and mode options reject', () => {
  assert.equal(api.parseSiteSharing(null), null);
  for (const value of [undefined, [], {}, policy({ users: null }), policy({ allowed_editors: {} }), policy({ groups: [null] }), policy({ access_mode: 'invented' }), policy({ available_access_modes: ['unknown'] }), policy({ users: [{ email: 3 }] }), policy({ show_private_tunnels_warning: 'yes' })]) assert.throws(() => api.parseSiteSharing(value));
});
await test('participant, group and warning values remain real service data without invented role/counts', () => {
  const sample = policy({ users: [{ role: 'viewer', email: 'reader@example.invalid', pending: true, editable: false, opaque: 'kept' }], groups: [{ id: 'group', name: '真实组', size: 17, editable: true }], show_private_tunnels_warning: true });
  const parsed = api.parseSiteSharing(sample);
  assert.deepEqual(plain(parsed.users), sample.users); assert.deepEqual(plain(parsed.groups), sample.groups); assert.equal(parsed.showPrivateTunnelsWarning, true);
});
await test('preferred URL consumes live_url only, preserves exact valid text and rejects unsafe targets', () => {
  const url = 'https://preferred.example.invalid/path?opaque=1';
  assert.equal(api.parseSitePreferredUrl({ live_url: url }), url); assert.equal(api.parseSitePreferredUrl({ live_url: null }), null); assert.equal(api.parseSitePreferredUrl(null), null);
  for (const value of [{}, { url }, { live_url: false }, { live_url: 'javascript:alert(1)' }, { live_url: 'https://user:secret@example.invalid' }]) assert.throws(() => api.parseSitePreferredUrl(value));
});
console.log(`PASS ${groups} Sites sharing data/source groups; fixed-package static comparison, not HTTP/native/pixel acceptance`);

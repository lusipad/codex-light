import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const identity = { accountId: 'account-fixture', userId: 'user-fixture', generation: 7 };
const calls = [];
let sequence = 0, status = 200, body = { items: [], cursor: null }, mismatch = null, pending = null;
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/chatgptService.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, {
  exports: module.exports,
  require(name) { return name.endsWith('/bridge') ? { tauriInvoke: async (command, params) => {
    calls.push({ command, params });
    if (command === 'chatgpt_service_cancel') return;
    if (pending) await new Promise(resolve => { pending.resolve = resolve; });
    return { requestId: mismatch === 'request' ? 'old' : params.request.requestId,
      identity: mismatch === 'identity' ? { ...identity, generation: 6 } : identity, status, body };
  } } : {}; },
  navigator: { userAgent: 'fixture-browser', userAgentData: { platform: 'Windows', brands: [{ brand: 'Fixture', version: '1' }] } },
  localStorage: { getItem: () => 'fixture-device' }, crypto: { randomUUID: () => `request-${++sequence}` },
});
const read = module.exports.readArchiveCloudTasksPage;
assert.equal(typeof read, 'function', 'ACT01: archived task read preserves status through its dedicated production service wrapper');
const control = () => new AbortController();
const result = await read('opaque &?中', identity, control().signal);
assert.equal(result.status, 200); assert.equal(result.body, body);
const request = calls.at(-1);
assert.equal(request.command, 'chatgpt_service_read');
assert.equal(request.params.request.operation, 'archive_cloud_tasks');
assert.equal(request.params.request.params.cursor, 'opaque &?中');
assert.equal(request.params.request.expectedIdentity, identity);
assert.equal(request.params.request.profile.deviceId, 'fixture-device');
for (const terminal of [401, 403, 404]) {
  status = terminal; body = null;
  assert.equal((await read(null, identity, control().signal)).status, terminal);
}
for (const invalid of [0, '200', 500, 302, 429]) {
  status = invalid; await assert.rejects(read(null, identity, control().signal));
}
status = 403; body = { error: 'raw auth payload must not be accepted' };
await assert.rejects(read(null, identity, control().signal));
status = 200; body = { items: [], cursor: null };
for (const kind of ['request', 'identity']) {
  mismatch = kind; await assert.rejects(read(null, identity, control().signal), error => error.code === 'account_changed' && /账号发生变化/.test(error.message));
}
mismatch = null;
const before = calls.length, cancelled = control(); cancelled.abort();
await assert.rejects(read(null, identity, cancelled.signal), /取消/); assert.equal(calls.length, before);
pending = {}; const late = control(); const promise = read('', identity, late.signal);
await Promise.resolve(); late.abort(); assert.equal(calls.at(-1).command, 'chatgpt_service_cancel');
pending.resolve(); await assert.rejects(promise, /取消/); pending = null;
assert.ok(calls.every(call => !call.command.startsWith('cloud_service_')));
console.log('PASS ACT01–ACT05: real archived-task wrapper, fixed operation/profile, terminal HTTP metadata, envelope isolation and cancellation; zero live HTTP');

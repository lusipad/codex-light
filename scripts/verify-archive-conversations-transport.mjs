import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const identity = { accountId: 'fixture-account', userId: 'fixture-user', generation: 9 };
const calls = [];
let sequence = 0, access = { status: 'allowed', includeWorkCloud: false }, body = { items: [], offset: 0, limit: 20, total: 0 };
let mismatch = null, pending = null;
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/chatgptService.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: module.exports, require(name) { return name.endsWith('/bridge') ? {
  tauriInvoke: async (command, args) => {
    calls.push({ command, args });
    if (command === 'chatgpt_service_cancel') return;
    if (pending) await new Promise(resolve => { pending.resolve = resolve; });
    return { requestId: mismatch === 'request' ? 'old' : args.request.requestId,
      identity: mismatch === 'identity' ? { ...identity, generation: 8 } : identity, access, body };
  },
} : {}; }, navigator: { userAgent: 'fixture', userAgentData: { platform: 'Windows', brands: [{ brand: 'Chromium', version: '140' }] } },
  localStorage: { getItem: () => 'fixture-device' }, crypto: { randomUUID: () => `fixture-${++sequence}` } });
const read = module.exports.readArchiveConversationsPage;
assert.equal(typeof read, 'function', 'ACVT01: dedicated conversation reader is required');
const controller = () => new AbortController();
const result = await read(20, identity, controller().signal);
assert.equal(result.body, body); assert.equal(result.access.includeWorkCloud, false);
assert.equal(calls.at(-1).command, 'archive_conversations_read');
assert.deepEqual(Object.keys(calls.at(-1).args.request).sort(), ['expectedIdentity', 'offset', 'profile', 'requestId']);
assert.equal(calls.at(-1).args.request.offset, 20);
assert.equal(calls.at(-1).args.request.expectedIdentity, identity);
assert.equal(calls.at(-1).args.request.profile.deviceId, 'fixture-device');
const beforeInvalid = calls.length;
for (const offset of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '20', null, {}]) {
  await assert.rejects(read(offset, identity, controller().signal));
}
assert.equal(calls.length, beforeInvalid, 'invalid offsets are rejected before host IPC');
access = { status: 'denied', includeWorkCloud: null }; body = null;
assert.equal((await read(0, identity, controller().signal)).access.status, 'denied');
for (const invalid of [null, {}, { status: 'unknown', includeWorkCloud: false }, { status: 'allowed', includeWorkCloud: null },
  { status: 'allowed', includeWorkCloud: 'false' }, { status: 'denied', includeWorkCloud: false }]) {
  access = invalid; await assert.rejects(read(0, identity, controller().signal));
}
access = { status: 'denied', includeWorkCloud: null }; body = {};
await assert.rejects(read(0, identity, controller().signal));
access = { status: 'allowed', includeWorkCloud: true }; body = null;
await assert.rejects(read(0, identity, controller().signal));
body = { items: [], offset: 0, limit: 20, total: 0 };
for (const kind of ['request', 'identity']) {
  mismatch = kind;
  await assert.rejects(read(0, identity, controller().signal), error => error.code === 'account_changed');
}
mismatch = null;
const cancelled = controller(); cancelled.abort(); const beforeCancel = calls.length;
await assert.rejects(read(0, identity, cancelled.signal), /取消/); assert.equal(calls.length, beforeCancel);
pending = {}; const late = controller(), reading = read(0, identity, late.signal);
await Promise.resolve(); late.abort(); assert.equal(calls.at(-1).command, 'chatgpt_service_cancel');
pending.resolve(); await assert.rejects(reading, /取消/); pending = null;
console.log('PASS ACVT01–ACVT05: dedicated host qualification, bounded offset, access schema, identity envelope and cancellation; zero live HTTP');

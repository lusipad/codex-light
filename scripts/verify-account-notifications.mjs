import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const identity = { accountId: 'a', userId: 'u', generation: 1 };
const account = { account: { type: 'chatgpt' }, workspaceRouting: { chatgptAccountId: 'a' } };
const settings = [{ category: 'server_category', name: '服务端名称', description: '', options: [
  { channel: 'future_channel', name: '新渠道', enabled: false },
] }];
let current = identity, active = account, writes = [], reads = 0, mutate, accountFailure;
let body = { access: 'allowed', settings, contacts: null, contactsError: false };
const module = { exports: {} };
const code = ts.transpileModule(fs.readFileSync('src/accountNotifications.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(code, { exports: module.exports, require(name) {
  if (name === './config') return { accountRead: async () => { if (accountFailure) throw accountFailure; return active; } };
  if (name === './chatgptService') return { serviceIdentity: async () => current,
    readAccountNotifications: async () => { reads++; const result = structuredClone(body); mutate?.(); return result; },
    writeAccountNotification: async (...args) => { writes.push(args); return { verification: 'confirmed', readback: { settings } }; },
  };
  throw Error(name);
} });
const api = module.exports, signal = new AbortController().signal;
assert.equal(JSON.stringify(api.decodeNotificationSettings({ settings })), JSON.stringify(settings));
for (const invalid of [{}, { settings: [settings[0], settings[0]] }, { settings: [{ ...settings[0], options: [settings[0].options[0], settings[0].options[0]] }] },
  { settings: [{ ...settings[0], options: [{ channel: 'x', name: 'x', enabled: 1 }] }] }]) {
  assert.throws(() => api.decodeNotificationSettings(invalid));
}
assert.equal((await api.loadAccountNotifications(signal)).settings[0].category, 'server_category');
active = { account: { type: 'apiKey' } }; const before = reads;
assert.equal((await api.loadAccountNotifications(signal)).access, 'denied'); assert.equal(reads, before);
active = account; mutate = () => { current = { ...identity, generation: 3 }; };
await assert.rejects(api.loadAccountNotifications(signal), /账号发生变化/);
current = identity; mutate = undefined;
body = { ...body, contacts: { email: 'secret@example.invalid', sms: false } };
await assert.rejects(api.loadAccountNotifications(signal), /联系方式资格响应格式/);
body = { access: 'allowed', settings, contacts: null, contactsError: false };
await api.updateAccountNotification('server_category', 'future_channel', false, identity, signal);
assert.equal(writes.length, 1); assert.equal(writes[0][0], 'server_category'); assert.equal(writes[0][1], 'future_channel');
await assert.rejects(api.updateAccountNotification('server_category', 'future_channel', true, identity, signal), /读回与提交值不符/);
const aborted = new AbortController(); aborted.abort();
await assert.rejects(api.loadAccountNotifications(aborted.signal), /取消/);
accountFailure = Error('account IPC unavailable');
await assert.rejects(api.loadAccountNotifications(signal), error => error.code === 'notifications_account_unavailable');
accountFailure = undefined;
mutate = () => { accountFailure = Error('account readback unavailable'); };
await assert.rejects(api.loadAccountNotifications(signal), error => error.code === 'notifications_account_unavailable');
accountFailure = undefined; mutate = undefined;
console.log('PASS account notification dynamic schema, contacts privacy, identity generation, no-auth, cancellation and readback');

// Exercise the real IPC wrappers, not a copied request builder.
const serviceModule = { exports: {} }, calls = []; let wrongIdentity = false;
const sites = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/sitesService.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: sites, URL });
const serviceCode = ts.transpileModule(fs.readFileSync('src/chatgptService.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(serviceCode, { exports: serviceModule.exports,
  crypto: { randomUUID: () => 'request-test' }, localStorage: { getItem: () => 'test-device' },
  navigator: { userAgent: 'test', userAgentData: { brands: [{ brand: 'Test', version: '1' }], platform: 'Windows' } },
  require(name) {
    if (name === './sitesService') return sites;
    if (name === './remoteReview') return {};
    if (name === './bridge') return { tauriInvoke: async (command, args) => {
      calls.push([command, args]); const request = args.request;
      return { requestId: request.requestId, identity: wrongIdentity ? { ...identity, generation: 9 } : identity,
        body, verification: 'confirmed', readback: { settings } };
    } };
    throw Error(name);
  },
});
await serviceModule.exports.readAccountNotifications(identity, signal);
await serviceModule.exports.writeAccountNotification('server_category', 'future_channel', true, identity, signal);
assert.equal(calls[0][0], 'account_notifications_read');
assert.equal(calls[1][0], 'account_notifications_write');
assert.equal(JSON.stringify(Object.keys(calls[1][1].request).sort()), JSON.stringify(['requestId', 'expectedIdentity', 'profile', 'category', 'channel', 'enabled'].sort()));
wrongIdentity = true;
await assert.rejects(serviceModule.exports.readAccountNotifications(identity, signal), /账号发生变化/);
console.log('PASS dedicated IPC request shape and response identity guard');

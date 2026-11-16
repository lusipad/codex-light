import assert from 'node:assert/strict';
import { harness } from './verify-plugin-management-ui-b.mjs';

const identity = { accountId: 'account-A', userId: 'user-A', generation: 3 };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
for (const scenario of ['success', 'refresh-error', 'account-before', 'account-during', 'route-before', 'route-during', 'connection-before']) {
  const location = { href: 'https://test.invalid/settings/plugins-settings/apps/asdk_app_actual?keep=old#stale' }, navigation = [], reads = [];
  let actual = identity, deleting = false;
  const gate = deferred();
  const history = { state: {}, replaceState(state, _, url) { this.state = state; location.href = new URL(url, location.href).href; navigation.push(['replace', url]); },
    pushState(state, _, url) { this.state = state; location.href = new URL(url, location.href).href; navigation.push(['push', url]); } };
  const view = harness({ window: { location, history },
    config: { accountRead: async () => ({ account: { type: 'chatgpt' }, workspaceRouting: { chatgptAccountId: actual.accountId } }) },
    service: { serviceIdentity: async () => actual },
    plugins: { listApps: async options => { if (!deleting) return { data: [] }; reads.push(options); return gate.promise; } },
  });
  try {
    view.render(); await view.tick();
    const entry = view.nodes(view.tree).find(node => node.type === 'PluginAppEntryPage');
    assert.ok(entry); assert.equal(typeof entry.props.onDeleted, 'function');
    deleting = true;
    if (scenario === 'account-before') actual = { ...identity, userId: 'other-user' };
    if (scenario === 'route-before') location.href = 'https://test.invalid/settings/plugins-settings/apps/other';
    if (scenario === 'connection-before') { view.props.connectionIdentity = 'other-connection'; view.render(); }
    const before = location.href, result = entry.props.onDeleted(identity);
    if (scenario === 'account-before') { await assert.rejects(result, /账号发生变化/); assert.equal(reads.length, 0); }
    else if (scenario === 'route-before' || scenario === 'connection-before') { await result; assert.equal(reads.length, 0); }
    else {
      for (let i = 0; i < 8; i++) await Promise.resolve();
      assert.equal(reads.length, 1); assert.equal(reads[0].forceRefetch, true);
      if (scenario === 'account-during') actual = { ...identity, generation: 4 };
      if (scenario === 'route-during') location.href = 'https://test.invalid/settings/plugins-settings/apps/new-route';
      if (scenario === 'refresh-error') gate.reject(Error('refresh failed'));
      else gate.resolve({ data: [] });
      if (scenario === 'account-during') await assert.rejects(result, /账号发生变化/);
      else if (scenario === 'refresh-error') await assert.rejects(result, /refresh failed/);
      else await result;
      if (scenario === 'success') {
        assert.equal(new URL(location.href).pathname, '/settings/plugins-settings');
        assert.equal(new URL(location.href).search, ''); assert.equal(new URL(location.href).hash, '');
        assert.equal(navigation.at(-1)[0], 'replace');
      } else if (scenario !== 'route-during') assert.equal(location.href, before);
      else assert.equal(new URL(location.href).pathname, '/settings/plugins-settings/apps/new-route');
    }
  } finally { view.unmount(); }
}
console.log('Standalone App deletion parent: actual refreshed Apps consumer, exact account/user/generation guard before/after, no retired route navigation, refresh failure and fixed replace-root passed.');

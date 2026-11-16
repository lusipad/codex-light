import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('scripts/verify-plugin-preparation-host.mjs', 'utf8');
const ast = ts.createSourceFile('host.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = [];
for (const statement of ast.statements) {
  if (ts.isBlock(statement)) break;
  if (!ts.isImportDeclaration(statement)) declarations.push(statement.getFullText(ast));
}
const { mount, plugin, marketplace } = vm.runInNewContext(`(() => { ${declarations.join('\n')} return { mount, plugin, marketplace }; })()`,
  { assert, fs, vm, ts, AbortController, console });
const installed = { ...plugin, installed: true, enabled: true };
{
  const host = mount({ policy: 'ON_USE', apps: [] });
  const foreign = { ...installed, source: { type: 'local', path: 'D:/foreign/sample' } };
  const foreignMarket = { name: marketplace.name, path: 'D:/foreign', plugins: [foreign] };
  host.context.directoryInstalled = [{ plugin: foreign, marketplace: foreignMarket }];
  host.context.installedData = { marketplaces: [foreignMarket] };
  const drafts = [];
  host.context.onTryPlugin = async (value, prompt, guard) => { drafts.push({ value, prompt, guard }); return true; };
  await host.activate('original prompt');
  const writes = host.calls.filter(call => call[0] === 'install');
  assert.equal(writes.length, 1, 'same ID in another marketplace path cannot stand in for installing the original source');
  assert.equal(writes[0][1].marketplacePath, 'D:/original');
  assert.equal(drafts.length, 1); assert.equal(drafts[0].value.source.path, 'D:/original/sample');
  assert.equal(drafts[0].prompt, 'original prompt');
}
for (const alias of ['d:/ORIGINAL', String.raw`D:\original`, String.raw`\\?\D:\ORIGINAL`]) {
  const host = mount({ policy: 'ON_USE', apps: [] });
  const aliasMarket = { ...marketplace, path: alias, plugins: [installed] };
  host.context.directoryInstalled = [{ plugin: installed, marketplace: aliasMarket }];
  host.context.installedData = { marketplaces: [aliasMarket] };
  assert.equal(await host.activate('original prompt'), true, `Windows lexical alias ${alias} retains the same marketplace identity`);
  assert.equal(host.calls.filter(call => call[0] === 'install').length, 0, 'known same-source installation must not be repeated');
  assert.equal(host.calls.filter(call => call[0] === 'draft').length, 1);
}
{
  const host = mount({ policy: 'ON_INSTALL' });
  host.context.loadInstalledPlugins = async () => ({ marketplaces: [{ ...marketplace, path: String.raw`d:\ORIGINAL`, plugins: [installed] }] });
  await host.install('original prompt');
  assert.equal(host.preparation().flow.confirmed, true, 'post-ACK confirmation accepts the same Windows lexical marketplace alias');
  await host.verify();
  assert.equal(host.calls.filter(call => call[0] === 'final').length, 1);
  assert.equal(host.calls.filter(call => call[0] === 'draft').length, 1);
}
console.log('PASS actual directory prompt/install/panel callbacks: same-ID foreign marketplace cannot bypass original-source install; Windows case/slash/verbatim aliases remain valid; original prompt once, no HTTP/model/turn calls.');

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const clone = value => JSON.parse(JSON.stringify(value));
const plugin = (id = 'fixture.name"quoted\\path@market') => ({ id, name: id, installed: true, enabled: true, source: { type: "local", path: "fixture" }, installPolicy: "AVAILABLE", authPolicy: "ON_USE" });
function fixture() {
  const first = plugin(), second = plugin("second@market"), calls = [];
  let rows = [first, second], removed = false, mutation = "ok", refreshFailure = false, reads = 0, hook = () => {}, loadErrors = [], livePath = "fixture/marketplace.json";
  let config = { plugins: { [first.id]: { enabled: true, unknown: "keep" }, sibling: { enabled: true } }, marketplaces: { market: { source_type: "git", source: "fixture" } } }, origins = {};
  const installed = async () => {
    calls.push(["installed"]); reads++; hook("installed", reads);
    return clone({ marketplaces: removed ? [] : [{ name: "market", path: livePath, plugins: rows }], marketplaceLoadErrors: loadErrors });
  };
  const dependencies = {
    configRead: async () => { calls.push(["configRead"]); return clone({ config, origins, layers: [{ name: { type: "user", file: "private/config.toml" }, version: "v1", config }] }); },
    configBatchWrite: async (edits, options) => {
      calls.push(["write", clone(edits), options]); hook("write");
      if (mutation === "reject") throw Error("Configuration was modified since last read. Fetch latest version and retry.");
      if (mutation === "unknown") throw Error("response lost");
      const id = JSON.parse(edits[0].keyPath.slice(8, -8));
      config.plugins[id] = { ...config.plugins[id], enabled: edits[0].value };
      rows = rows.map(item => item.id === id ? { ...item, enabled: edits[0].value } : item);
      if (mutation === "delivered") throw Error("response lost");
    },
    listInstalledPlugins: installed,
    listSkills: async (roots, force) => { calls.push(["skills", roots, force]); if (refreshFailure) throw Error("skills failed"); return { data: [] }; },
    uninstallPlugin: async id => {
      calls.push(["uninstall", id]); hook("uninstall", id);
      if (mutation === "uninstall-denied" && id === second.id) throw { kind: "forbidden", message: "denied" };
      if (mutation === "uninstall-unknown") throw Error("connection lost");
      rows = rows.filter(item => item.id !== id);
    },
    removeMarketplace: async name => {
      calls.push(["remove", name]); hook("remove");
      if (mutation === "remove-unknown") throw Error("response lost");
      removed = true; delete config.marketplaces.market;
      if (mutation === "remove-delivered") throw Error("response lost");
    },
    errorDetail: error => error?.message ?? String(error),
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/pluginManagement.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: () => dependencies });
  return { ...exports, calls, first, second, market: { name: "market", path: "fixture/marketplace.json", plugins: [first, second] }, mode: value => { mutation = value; }, refreshFail: () => { refreshFailure = true; }, hook: value => { hook = value; }, errors: value => { loadErrors = value; }, origins: value => { origins = value; }, get config() { return config; }, setRows: value => { rows = value; }, setPath: value => { livePath = value; } };
}
{
  const f = fixture();
  for (const name of ["codex-official", "openai-bundled", "openai-curated", "openai-curated-remote", "openai-primary-runtime", " OpenAI_Bundled "]) {
    assert.equal(f.isBuiltInMarketplaceName(name), true);
    f.config.marketplaces[name] = { source_type: "local", source: "fixture" };
  }
  assert.equal(f.isBuiltInMarketplaceName("my-openai-bundled"), false);
  assert.deepEqual(clone((await f.readConfiguredMarketplaces()).map(item => item.marketplace.name)), ["market"], "fixed Store name mapper filters built-ins even without RPC field");
}
{
  const f = fixture(), result = await f.setPluginEnabled(f.first, false, { cwd: "workspace" });
  assert.equal(result.verification, "confirmed"); assert.equal(result.plugin.enabled, false);
  const write = f.calls.find(call => call[0] === "write");
  assert.deepEqual(write[1], [{ keyPath: `plugins.${JSON.stringify(f.first.id)}.enabled`, value: false, mergeStrategy: "upsert" }]);
  assert.equal(write[2].expectedVersion, "v1"); assert.equal(write[2].reloadUserConfig, true);
  assert.equal(f.config.plugins[f.first.id].unknown, "keep"); assert.equal(f.config.plugins.sibling.enabled, true);
  assert.equal(f.calls.at(-1)[0], "skills"); assert.equal(f.calls.at(-1)[2], true);
}
for (const [mode, verification] of [["reject", "rejected"], ["unknown", "pending"], ["delivered", "confirmed"]]) {
  const f = fixture(); f.mode(mode);
  assert.equal((await f.setPluginEnabled(f.first, false)).verification, verification);
  assert.equal(f.calls.filter(call => call[0] === "write").length, 1, "never replay uncertain mutation");
}
{
  const f = fixture();
  const confirmed = await f.verifyPluginEnabled(f.first, true, { expectedFilePath: "private/config.toml" });
  assert.equal(confirmed.verification, "confirmed");
  assert.equal((await f.verifyPluginEnabled(f.first, true, { expectedFilePath: "different/config.toml" })).verification, "pending");
  f.origins({ [`plugins.${f.first.id}.enabled`]: { name: { type: "project" }, version: "project" } });
  assert.equal((await f.verifyPluginEnabled(f.first, true)).verification, "pending", "effective plugin row alone cannot prove user-target confirmation");
  assert.equal(f.calls.filter(call => call[0] === "write").length, 0, "read-only recovery never resubmits config");
}
{
  const f = fixture(); f.refreshFail();
  const result = await f.setPluginEnabled(f.first, false);
  assert.equal(result.verification, "confirmed"); assert.match(result.refreshError, /skills failed/);
}
for (const variant of ["remote", "host", "admin", "scope", "stale"]) {
  const f = fixture(), target = { ...f.first }, context = {};
  if (variant === "remote") target.source = { type: "remote" };
  if (variant === "host") context.hostId = "remote-host";
  if (variant === "admin") target.availability = "DISABLED_BY_ADMIN";
  if (variant === "scope") f.origins({ [`plugins.${target.id}.enabled`]: { name: { type: "project" }, version: "project" } });
  if (variant === "stale") context.isCurrent = () => false;
  const result = await f.setPluginEnabled(target, false, context);
  assert.ok(result.verification !== "confirmed"); assert.equal(f.calls.filter(call => call[0] === "write").length, 0);
}
{
  const f = fixture(), plan = await f.prepareMarketplaceRemoval(f.market);
  const updates = [], result = await f.runMarketplaceRemoval(plan, { onProgress: update => updates.push(update) });
  assert.equal(result.removed, true); assert.equal(result.completedIds.length, 2);
  assert.deepEqual(f.calls.filter(call => ["uninstall", "remove"].includes(call[0])).map(call => call[0]), ["uninstall", "uninstall", "remove"]);
  assert.ok(updates.some(update => update.completedIds.length === 1 && !update.removed));
}
{
  const f = fixture(); f.setRows([{ ...f.first, source: { type: "remote" }, installPolicy: "INSTALLED_BY_DEFAULT" }, f.second]);
  await assert.rejects(() => f.prepareMarketplaceRemoval(f.market), /保护/);
  assert.equal(f.calls.filter(call => call[0] === "uninstall").length, 0);
}
{
  const f = fixture(); f.setRows([{ ...f.first, installPolicy: "INSTALLED_BY_DEFAULT" }, f.second]);
  const plan = await f.prepareMarketplaceRemoval(f.market);
  assert.equal((await f.runMarketplaceRemoval(plan)).removed, true, "local default-installed policy does not inherit remote-only uninstall restriction");
}
{
  const f = fixture(); f.errors([{ marketplacePath: f.market.path, message: "broken" }]);
  await assert.rejects(() => f.prepareMarketplaceRemoval(f.market), /读取失败/);
}
{
  const f = fixture(), before = await f.prepareMarketplaceRemoval(f.market); f.mode("uninstall-denied");
  const partial = await f.runMarketplaceRemoval(before);
  assert.deepEqual(clone(partial.completedIds), [f.first.id]); assert.equal(partial.removed, false);
  f.mode("ok"); const done = await f.runMarketplaceRemoval(partial);
  assert.equal(done.removed, true);
  assert.equal(f.calls.filter(call => call[0] === "uninstall" && call[1] === f.first.id).length, 1);
}
{
  const f = fixture(), before = await f.prepareMarketplaceRemoval(f.market); f.mode("uninstall-unknown");
  const partial = await f.runMarketplaceRemoval(before);
  assert.equal(partial.pendingPluginId, f.first.id);
  await f.runMarketplaceRemoval(partial);
  assert.equal(f.calls.filter(call => call[0] === "uninstall").length, 1);
  assert.equal(f.calls.filter(call => call[0] === "remove").length, 0);
}
{
  const f = fixture(), before = await f.prepareMarketplaceRemoval(f.market); let active = true;
  f.hook(event => { if (event === "uninstall") active = false; });
  const result = await f.runMarketplaceRemoval(before, { isCurrent: () => active });
  assert.equal(result.removed, false); assert.equal(result.pendingPluginId, f.first.id);
  assert.equal(f.calls.filter(call => call[0] === "uninstall").length, 1); assert.equal(f.calls.filter(call => call[0] === "remove").length, 0);
}
for (const insertAt of [2, 3]) {
  const f = fixture(), before = await f.prepareMarketplaceRemoval(f.market); let secondDone = false, readbacks = 0;
  f.hook((event, id) => {
    if (event === "uninstall" && id === f.second.id) secondDone = true;
    if (event === "installed" && secondDone && ++readbacks === insertAt) f.setRows([plugin("late-plugin@market")]);
  });
  const result = await f.runMarketplaceRemoval(before);
  assert.equal(result.removed, false); assert.match(result.error, /已安装插件/);
  assert.equal(f.calls.filter(call => call[0] === "remove").length, 0, "late plugin prevents final destructive action");
}
for (const changed of ["source", "path"]) {
  const f = fixture(), before = await f.prepareMarketplaceRemoval(f.market);
  if (changed === "source") f.config.marketplaces.market.source = "replacement";
  else f.setPath("replacement/marketplace.json");
  const result = await f.runMarketplaceRemoval(before);
  assert.equal(result.removed, false); assert.match(result.error, /来源/);
  assert.equal(f.calls.filter(call => ["uninstall", "remove"].includes(call[0])).length, 0, "same-name replacement must never inherit removal consent");
}
{
  const f = fixture(), before = await f.prepareMarketplaceRemoval(f.market);
  f.hook((event, id) => { if (event === "uninstall" && id === f.first.id) f.config.marketplaces.market.source = "replacement"; });
  const result = await f.runMarketplaceRemoval(before);
  assert.equal(result.removed, false); assert.match(result.error, /来源/);
  assert.equal(f.calls.filter(call => call[0] === "uninstall").length, 1);
  assert.equal(f.calls.filter(call => call[0] === "remove").length, 0);
}
for (const mode of ["remove-unknown", "remove-delivered"]) {
  const f = fixture(), before = await f.prepareMarketplaceRemoval(f.market); f.mode(mode);
  const result = await f.runMarketplaceRemoval(before);
  assert.equal(result.removed, mode === "remove-delivered");
  if (!result.removed) {
    assert.equal(result.removePending, true);
    await f.runMarketplaceRemoval(result);
    assert.equal(f.calls.filter(call => call[0] === "remove").length, 1, "uncertain remove never automatically replayed");
  }
}
{
  const f = fixture(), before = await f.prepareMarketplaceRemoval(f.market); let active = true;
  f.hook(event => { if (event === "remove") active = false; });
  const closed = await f.runMarketplaceRemoval(before, { isCurrent: () => active });
  assert.equal(closed.removed, false); assert.equal(closed.removePending, true);
  active = true;
  assert.equal((await f.runMarketplaceRemoval(closed, { isCurrent: () => active })).removed, true);
  assert.equal(f.calls.filter(call => call[0] === "remove").length, 1, "reopen confirms already delivered remove without resending");
}
console.log("PASS plugin management production: CAS single-field/readback/skills, scope and remote guards, uncertain delivery no replay, complete marketplace preflight, sequential removal, partial retry and close");

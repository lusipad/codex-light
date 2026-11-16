import assert from "node:assert/strict";
import { harness } from "./verify-plugin-management-ui-b.mjs";

const prompt = "检查当前项目\n保留原始动作文本";
const base = { id: "parent@private", name: "Parent", installed: true, enabled: true,
  source: { type: "local", path: "C:/isolated/plugin" }, installPolicy: "AVAILABLE", authPolicy: "ON_USE",
  interface: { defaultPrompt: [prompt] } };
const market = { name: "real-private-market", path: "C:/isolated/market.json" };
const inventory = plugin => ({ marketplaces: [{ ...market, plugins: [plugin] }] });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const failures = [];
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.stack}`); }
}

async function open(plugin = base, options = {}) {
  const location = { href: `/plugins/${encodeURIComponent(plugin.id)}?pluginName=Parent&marketplacePath=C%3A%2Fisolated%2Fmarket.json` };
  const attempts = [], settings = [], fileReads = [], protocolReads = [];
  let writes = 0;
  const view = harness({
    window: { location, history: { state: {}, replaceState() {}, pushState() {} } },
    fs: { readFileText: async path => { fileReads.push(path); return `file:${path}`; } },
    remote: options.remote,
    bridge: { callAppServer: async (method, params) => { protocolReads.push([method, params]); return { contents: "remote contents" }; } },
    plugins: {
      listMarketplacePlugins: async () => ({ marketplaces: [{ ...market, plugins: [plugin] }] }),
      readPlugin: async () => ({ summary: plugin, marketplaceName: market.name, marketplacePath: market.path,
        skills: [], apps: [], hooks: [], mcpServers: [], ...options.detail }),
      pluginRefFor: () => ({ pluginName: plugin.name, marketplacePath: market.path }), resetBrowseCache() {},
      installPlugin: async () => { writes++; return options.install ? options.install(view) : { appsNeedingAuth: [] }; },
      ...options.plugins,
    },
  });
  view.props.manageOnly = false; view.props.initialTab = "plugins";
  view.props.onTryPlugin = (actual, text) => { attempts.push([actual, text]); return true; };
  view.props.onOpenPluginSettings = section => settings.push(section);
  view.setInstalled(inventory(plugin)); view.render(); await view.tick();
  const detail = () => view.nodes(view.tree).find(node => node.type === "PluginDirectoryDetail");
  const included = () => view.nodes(view.tree).find(node => node.type === "PluginDirectoryIncluded");
  return { view, detail, included, attempts, settings, fileReads, protocolReads, writes: () => writes };
}

await check("ready prompt preserves plugin identity and prompt text without writes", async () => {
  const test = await open();
  try {
    assert.equal(await test.detail().props.onActivatePrompt(prompt), true);
    assert.equal(test.attempts[0][0].id, base.id); assert.equal(test.attempts[0][1], prompt);
    assert.equal(test.writes(), 0);
    assert.equal(await test.detail().props.onActivatePrompt("arbitrary prompt"), false);
    assert.equal(test.attempts.length, 1, "only a prompt actually supplied by this detail can activate");
  } finally { test.view.unmount(); }
});

await check("uninstalled prompt waits for ACK and confirmed inventory before draft", async () => {
  const delivery = deferred(); const uninstalled = { ...base, installed: false, enabled: false };
  const test = await open(uninstalled, { install: () => delivery.promise });
  try {
    const pending = test.detail().props.onActivatePrompt(prompt);
    await test.view.tick(); assert.equal(test.writes(), 1); assert.equal(test.attempts.length, 0);
    test.view.setInstalled(inventory(base)); delivery.resolve({ appsNeedingAuth: [] });
    assert.equal(await pending, true); assert.equal(test.attempts.length, 1);
    assert.equal(test.attempts[0][0].enabled, true);
  } finally { test.view.unmount(); }
});

for (const outcome of ["missing", "failed", "unknown", "needs-apps"]) {
  await check(`unconfirmed ${outcome} install cannot draft or duplicate install`, async () => {
    const uninstalled = { ...base, installed: false, enabled: false };
    let reads = 0;
    class PluginProtocolError extends Error {}
    const test = await open(uninstalled, {
      install: view => {
        if (outcome === "unknown") throw new PluginProtocolError("delivery unknown");
        if (outcome === "needs-apps") view.setInstalled(inventory(base));
        return { authPolicy: outcome === "needs-apps" ? "ON_INSTALL" : "ON_USE",
          appsNeedingAuth: outcome === "needs-apps" ? [{ id: "required", name: "Required" }] : [] };
      },
      plugins: { PluginProtocolError, ...(outcome === "failed" ? {
        listInstalledPlugins: async () => { if (++reads > 1) throw Error("inventory unavailable"); return inventory(uninstalled); },
      } : {}) },
    });
    try {
      await assert.rejects(test.detail().props.onActivatePrompt(prompt), /安装或应用连接尚未确认/);
      await test.view.tick(); assert.equal(test.attempts.length, 0); assert.equal(test.writes(), 1);
      const again = test.detail().props.onActivatePrompt(prompt);
      await Promise.resolve(again).catch(() => {}); await test.view.tick();
      assert.equal(test.attempts.length, 0); assert.equal(test.writes(), 1);
    } finally { test.view.unmount(); }
  });
}

await check("ON_USE without explicit app setup may prefill before optional application connection", async () => {
  const test = await open({ ...base, installed: false, enabled: false }, { install: view => {
    view.setInstalled(inventory(base));
    return { authPolicy: "ON_USE", appsNeedingAuth: [{ id: "on-use", name: "Optional connection" }] };
  } });
  try {
    assert.equal(await test.detail().props.onActivatePrompt(prompt), true);
    assert.equal(test.attempts.length, 1); assert.equal(test.writes(), 1);
    await test.view.tick();
    assert.equal(await test.detail().props.onActivatePrompt(prompt), true, "a retained ON_USE preparation panel does not become an OAuth prerequisite");
    assert.equal(test.writes(), 1);
  } finally { test.view.unmount(); }
});

await check("disabled installed plugin requires confirmed enable before draft", async () => {
  const test = await open({ ...base, enabled: false }); const delivery = deferred();
  test.view.setWrite(() => delivery.promise);
  try {
    const pending = test.detail().props.onActivatePrompt(prompt);
    await test.view.tick(); assert.equal(test.attempts.length, 0);
    assert.equal(test.view.calls.filter(call => call[0] === "toggle").length, 1);
    delivery.resolve({ plugin: base, verification: "confirmed", error: null, refreshError: null, stale: false });
    assert.equal(await pending, true); assert.equal(test.attempts[0][0].enabled, true);
  } finally { test.view.unmount(); }
});

await check("pending enable never drafts or repeats the enable write", async () => {
  const test = await open({ ...base, enabled: false });
  test.view.setWrite(async () => ({ plugin: null, verification: "pending", error: "delivery unknown", refreshError: null, stale: false }));
  try {
    await assert.rejects(test.detail().props.onActivatePrompt(prompt), /启用尚未确认/);
    await test.view.tick();
    await assert.rejects(test.detail().props.onActivatePrompt(prompt), /启用尚未确认/);
    assert.equal(test.view.calls.filter(call => call[0] === "toggle").length, 1);
    assert.equal(test.attempts.length, 0);
  } finally { test.view.unmount(); }
});

await check("local-host remote catalog entity still enables through the local configuration", async () => {
  const test = await open({ ...base, source: { type: "remote" }, remotePluginId: "raw-remote", enabled: false });
  try {
    test.view.setWrite(async () => ({ plugin: { ...base, source: { type: "remote" }, remotePluginId: "raw-remote" },
      verification: "confirmed", error: null, refreshError: null, stale: false }));
    assert.equal(await test.detail().props.onActivatePrompt(prompt), true);
    assert.equal(test.view.calls.filter(call => call[0] === "toggle").length, 1,
      "catalog source type is not a hosted HTTP execution context");
    assert.equal(test.attempts.length, 1);
  } finally { test.view.unmount(); }
});

for (const outcome of ["confirmed", "pending", "runtime-failed"]) {
  await check(`service enable ${outcome} obeys confirmed snapshot and runtime readiness`, async () => {
    const plugin = { ...base, id: `service-${outcome}@remote`, enabled: false, source: { type: "remote" },
      remotePluginId: `raw-${outcome}`, remoteServicePlugin: { id: `raw-${outcome}` }, remotePolicyKnown: true };
    const identity = { accountId: "private-account", userId: "private-user", generation: 1 };
    const snapshot = { identity, marketplace: { name: market.name, plugins: [plugin] }, error: null, unsupported: false };
    let mutations = 0, changed = false;
    let test;
    test = await open(plugin, {
      plugins: { listSkills: async () => {
        if (changed && outcome === "runtime-failed") throw Error("runtime skill refresh failed");
        return { data: [{ skills: [], errors: [] }] };
      } },
      remote: {
        loadRemotePlugins: async () => snapshot,
        manageRemotePlugin: async () => {
          mutations++; changed = true;
          const after = { ...plugin, enabled: true };
          if (outcome !== "pending") test.view.setInstalled(inventory(after));
          return { verification: outcome === "pending" ? "pending" : "confirmed",
            snapshot: outcome === "pending" ? null : { ...snapshot, marketplace: { ...snapshot.marketplace, plugins: [after] } },
            error: outcome === "pending" ? "delivery unknown" : null };
        },
      },
    });
    try {
      if (outcome === "confirmed") {
        assert.equal(await test.detail().props.onActivatePrompt(prompt), true,
          "confirmed service enable plus successful runtime refresh should draft immediately");
        assert.equal(test.attempts[0][0].enabled, true);
        assert.equal(test.attempts[0][0].remotePluginId, plugin.remotePluginId);
      } else {
        await assert.rejects(test.detail().props.onActivatePrompt(prompt), /启用尚未确认/);
        await test.view.tick(); assert.equal(test.attempts.length, 0);
        if (outcome === "pending") {
          await assert.rejects(test.detail().props.onActivatePrompt(prompt), /启用尚未确认/);
          assert.equal(test.attempts.length, 0);
        }
      }
      assert.equal(mutations, 1, "one starter action may submit only one service enable mutation");
    } finally { test.view.unmount(); }
  });
}

for (const transition of ["detail", "account", "workspace"]) {
  await check(`late install after ${transition} change cannot draft`, async () => {
    const delivery = deferred(); const test = await open({ ...base, installed: false }, { install: () => delivery.promise });
    try {
      const pending = test.detail().props.onActivatePrompt(prompt); await test.view.tick();
      if (transition === "detail") test.view.button("插件").props.onClick();
      else test.view.props[transition === "account" ? "connectionIdentity" : "activeWorkspaceRoot"] = "other-scope";
      test.view.render(); await test.view.tick(); delivery.resolve({ appsNeedingAuth: [] });
      assert.equal(await pending, false); assert.equal(test.attempts.length, 0);
    } finally { test.view.unmount(); }
  });
}

await check("included callbacks use actual paths, raw remote source, and real settings", async () => {
  const test = await open({ ...base, remotePluginId: "raw-id" });
  try {
    const included = test.included().props;
    assert.equal(await included.loadSkillContents({ name: "Skill", path: "C:/catalog/SKILL.md" }, { path: "C:/installed/SKILL.md" }), "file:C:/installed/SKILL.md");
    assert.equal(await included.loadSkillContents({ name: "Skill", path: "C:/catalog/SKILL.md" }, null), "file:C:/catalog/SKILL.md");
    assert.equal(await included.loadSkillContents({ name: "Skill" }, null), "remote contents");
    assert.deepEqual(test.fileReads, ["C:/installed/SKILL.md", "C:/catalog/SKILL.md"]);
    assert.equal(test.protocolReads.length, 1);
    const [method, params] = test.protocolReads[0];
    assert.equal(method, "plugin/skill/read"); assert.equal(params.remotePluginId, "raw-id");
    assert.equal(params.remoteMarketplaceName, market.name); assert.equal(params.skillName, "Skill");
    included.onOpenMcpSettings(); included.onOpenHooksSettings();
    assert.deepEqual(test.settings, ["connections", "hooks-settings"]);
  } finally { test.view.unmount(); }
  const missing = await open();
  try {
    await assert.rejects(missing.included().props.loadSkillContents({ name: "Skill" }, null), /没有可确认的读取来源/);
    assert.equal(missing.protocolReads.length, 0); assert.equal(missing.fileReads.length, 0);
  } finally { missing.view.unmount(); }
});

assert.equal(failures.length, 0, `plugin detail parent regressions failed: ${failures.join("; ")}`);

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Offline bridge only: execute the real client and service wrapper, never HTTP/auth.
const identity = { accountId: "images-account", userId: "images-user", generation: 4 };
const clone = value => JSON.parse(JSON.stringify(value));
const hash = key => { let value = 0; for (const c of key) value = (Math.imul(value, 31) + c.charCodeAt(0)) >>> 0; return String(value); };
function snapshot({ compact = false, hashed = false, workspaceGate = false, providerGate = false } = {}) {
  const key = value => hashed ? hash(value) : value;
  const entry = value => ({ [compact ? "v" : "value"]: value });
  return { has_updates: true, response_format: compact ? "init-v2" : "init-v1",
    user: { userID: identity.userId, customIDs: { account_id: identity.accountId } },
    feature_gates: { [key("1355972088")]: entry(workspaceGate), [key("3683713372")]: entry(providerGate), [key("3085093835")]: entry(true) },
    dynamic_configs: { [key("4161245824")]: entry(compact ? "tabs" : { my_images_tab_enabled: true }),
      [key("3939855767")]: entry(compact ? "order" : { section_order: ["trending", "art"] }) },
    ...(compact ? { values: { tabs: { my_images_tab_enabled: true }, order: { section_order: ["trending", "art"] } } } : {}),
  };
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 30; ++i) await Promise.resolve(); };
function load(file, dependencies, uuid) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, AbortController, crypto: { randomUUID: uuid },
    navigator: { userAgent: "Explicit offline fixture", userAgentData: { platform: "Windows", brands: [{ brand: "Chromium", version: "140" }] } },
    localStorage: { getItem: () => "fixture-device" }, require: dependencies });
  return exports;
}
function client() {
  const calls = [], cancelled = [];
  let serial = 0;
  const control = { payload: snapshot(),
    account: { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: identity.accountId } },
    accounts: { account_ordering: [identity.accountId], accounts: [{ id: identity.accountId, structure: "personal" }] }, config: { config: {} },
    identity: async () => clone(identity),
    read: async request => request.operation === "share_accounts" ? control.accounts
      : request.operation === "images_workspace_settings" ? { permissions: ["chatgpt.workspace.feature.image-gen.access"] }
      : request.operation === "images_init" ? { groups: [{ id: "styles", items: [{ id: "style-a" }] }] }
      : request.operation === "images_styles" ? { styles: [{ id: "style-a" }], image_suggestions: [{ id: "suggestion" }] }
      : { items: [{ id: "image-a", url: "https://fixture.invalid/image" }], cursor: "next" },
  };
  const bridge = { callAppServer: async (method, params) => {
    calls.push({ method, params: clone(params) });
    if (method === "account/read") { assert.deepEqual(clone(params), { refreshToken: false }); return control.account; }
    assert.equal(method, "config/read");
    assert.deepEqual(clone(params), { includeLayers: false });
    if (control.config instanceof Error) throw control.config;
    return control.config;
  }, tauriInvoke: async (command, args) => {
    calls.push({ command, args: clone(args) });
    if (command === "chatgpt_service_identity") return control.identity();
    if (command === "chatgpt_service_cancel") { cancelled.push(args.requestId); return; }
    if (command === "share_thread_access") return { statsigPayload: JSON.stringify(control.payload) };
    assert.equal(command, "chatgpt_service_read");
    const request = args.request, body = await control.read(request);
    const result = { requestId: request.requestId, identity: control.responseIdentity ?? request.expectedIdentity, body,
      ...(["images_init", "images_styles", "images_recent"].includes(request.operation) ? { assets: typeof control.assets === "function" ? control.assets(request) : control.assets ?? [] } : {}) };
    return control.response ? control.response(result, request) : result;
  } };
  const uuid = () => `images-fixture-${++serial}`;
  const service = load("src/chatgptService.ts", name => name === "./bridge" ? bridge : {}, uuid);
  // Only used for the unchanged 19C red comparison: same real service wrapper underneath.
  service.readImagesService = async (...args) => ({ data: await service.readChatgptService(...args), assets: [] });
  const data = load("src/imagesData.ts", () => { throw Error("unexpected data dependency"); }, uuid);
  const images = load(process.env.IMAGES_CLIENT_SOURCE ?? "src/imagesClient.ts", name => ({ "./bridge": bridge, "./chatgptService": service, "./imagesData": data })[name], uuid);
  const assets = load("src/imagesAssets.ts", name => name === "./imagesData" ? data : {}, uuid);
  return { images, control, calls, cancelled, data, service, assets };
}
const signal = () => new AbortController().signal;
const access = () => ({ identity: clone(identity), available: true });
const reads = h => h.calls.filter(call => call.command === "chatgpt_service_read").map(call => call.args.request);
let passed = 0, failed = 0;
async function check(name, run) {
  try { await run(); ++passed; console.log(`PASS ${name}`); }
  catch (error) { ++failed; console.error(`FAIL ${name}: ${error.message}`); }
}
await check("first history omits after; continuation uses 20 and opaque cursor", async () => {
  const h = client(); await h.images.readImagesHistory(access(), null, signal());
  await h.images.readImagesHistory(access(), "raw/?next", signal());
  assert.deepEqual(reads(h).map(r => clone(r.params)), [{ limit: 25 }, { limit: 20, after: "raw/?next" }]);
});
await check("full V1/V2 and hashed keys decode only independent direct gates/configs", async () => {
  for (const compact of [false, true]) for (const hashed of [false, true]) {
    const h = client(); h.control.payload = snapshot({ compact, hashed });
    const result = await h.images.readImagesAccess(signal());
    assert.equal(result.available, true); assert.equal(result.myImagesTabEnabled, true); assert.equal(result.newLayout, true);
    assert.deepEqual(clone(result.sectionOrder), ["trending", "art"]);
    assert.deepEqual(reads(h).map(r => r.operation), ["share_accounts"]);
    assert.equal(h.calls.filter(c => c.method === "config/read").length, 0);
  }
});
await check("workspace permission and provider requests are conditional", async () => {
  for (const workspace of [false, true]) for (const workspaceGate of [false, true]) for (const providerGate of [false, true]) {
    const h = client(); h.control.payload = snapshot({ workspaceGate, providerGate });
    h.control.accounts.accounts[0].structure = workspace ? "workspace" : "personal";
    const result = await h.images.readImagesAccess(signal()); assert.equal(result.available, true);
    assert.equal(reads(h).filter(r => r.operation === "images_workspace_settings").length, Number(workspace && workspaceGate));
    assert.equal(h.calls.filter(c => c.method === "config/read").length, Number(providerGate));
  }
});
await check("selected identity need not be first in ordering or a Library-supported plan", async () => {
  const h = client(); h.control.accounts.accounts[0].plan_type = "future-plan";
  h.control.accounts.account_ordering = ["another-account"];
  assert.equal((await h.images.readImagesAccess(signal())).available, true);
});
await check("account auth, selected uniqueness, structure and routing must be known", async () => {
  for (const change of [h => { h.control.account.account.type = "apiKey"; },
    h => { delete h.control.account.workspaceRouting; }, h => { h.control.account.workspaceRouting.chatgptAccountId = "other"; },
    h => { h.control.accounts.accounts = []; }, h => { h.control.accounts.accounts.push(h.control.accounts.accounts[0]); },
    h => { delete h.control.accounts.accounts[0].structure; }]) {
    const h = client(); change(h); await assert.rejects(h.images.readImagesAccess(signal()));
    assert.equal(reads(h).filter(r => r.operation === "images_workspace_settings").length, 0);
  }
});
await check("unknown/partial/delta/foreign snapshots and required gates fail closed", async () => {
  for (const change of [p => { p.has_updates = false; }, p => { delete p.has_updates; }, p => { p.is_delta = true; },
    p => { p.isDelta = true; }, p => { p.live_overlay = {}; }, p => { p.user.userID = "other"; },
    p => { p.user.customIDs.account_id = "other"; }, p => { p.response_format = "partial"; },
    p => { delete p.feature_gates["3683713372"]; }, p => { p.feature_gates["3683713372"].value = "true"; }]) {
    const h = client(); change(h.control.payload); await assert.rejects(h.images.readImagesAccess(signal()));
  }
  const h = client(); h.control.accounts.accounts[0].structure = "workspace";
  delete h.control.payload.feature_gates["1355972088"];
  await assert.rejects(h.images.readImagesAccess(signal()));
});
await check("personal does not require unused workspace gate; missing layout configs stay unknown", async () => {
  const h = client(); delete h.control.payload.feature_gates["1355972088"];
  delete h.control.payload.feature_gates["3085093835"]; delete h.control.payload.dynamic_configs;
  const result = await h.images.readImagesAccess(signal()); assert.equal(result.available, true);
  assert.equal(result.myImagesTabEnabled, undefined); assert.equal(result.newLayout, undefined); assert.equal(result.sectionOrder, undefined);
});
await check("workspace permission denial and explicit non-openai are unavailable", async () => {
  const h = client(); h.control.accounts.accounts[0].structure = "workspace";
  h.control.payload = snapshot({ workspaceGate: true });
  const read = h.control.read; h.control.read = request => request.operation === "images_workspace_settings" ? {} : read(request);
  assert.equal((await h.images.readImagesAccess(signal())).available, false);
  const provider = client(); provider.control.payload = snapshot({ providerGate: true }); provider.control.config = { config: { model_provider: "custom" } };
  assert.equal((await provider.images.readImagesAccess(signal())).available, false);
});
await check("invalid or failed raw effective config is never a fallback openai success", async () => {
  for (const config of [{}, { config: null }, { config: [] }, { config: { model_provider: 7 } }, new Error("config unavailable")]) {
    const h = client(); h.control.payload = snapshot({ providerGate: true }); h.control.config = config;
    await assert.rejects(h.images.readImagesAccess(signal()));
    assert.equal(h.calls.filter(c => c.method === "config/read").length, 1);
  }
});
await check("explicit account restrictions deny, malformed flags and workspace permissions reject", async () => {
  for (const [key, value] of [["can_access_with_session", false], ["is_deactivated", true]]) {
    const h = client(); h.control.accounts.accounts[0][key] = value;
    assert.equal((await h.images.readImagesAccess(signal())).available, false);
  }
  for (const key of ["can_access_with_session", "is_deactivated"]) {
    const h = client(); h.control.accounts.accounts[0][key] = "false"; await assert.rejects(h.images.readImagesAccess(signal()));
  }
  for (const permissions of ["image-gen", [4]]) {
    const h = client(); h.control.accounts.accounts[0].structure = "workspace"; h.control.payload = snapshot({ workspaceGate: true });
    const read = h.control.read; h.control.read = request => request.operation === "images_workspace_settings" ? { permissions } : read(request);
    await assert.rejects(h.images.readImagesAccess(signal()));
  }
});
await check("known malformed layout values are not coerced into a selected branch", async () => {
  for (const change of [p => { p.dynamic_configs["4161245824"].value.my_images_tab_enabled = "true"; },
    p => { p.dynamic_configs["3939855767"].value.section_order = ["art", 3]; },
    p => { p.dynamic_configs["3939855767"].value = []; }, p => { p.feature_gates["3085093835"].value = "true"; }]) {
    const h = client(); change(h.control.payload); await assert.rejects(h.images.readImagesAccess(signal()));
  }
});
await check("final identity confirmation rejects account/user/generation changes", async () => {
  for (const field of ["accountId", "userId", "generation"]) {
    const h = client(); let count = 0;
    h.control.identity = async () => ++count === 1 ? identity : { ...identity, [field]: field === "generation" ? 5 : "other" };
    await assert.rejects(h.images.readImagesAccess(signal()), /账号发生变化/);
  }
});
await check("catalog reads both sources, keeps partial values, parses unknown bodies as errors", async () => {
  const h = client(); const read = h.control.read;
  h.control.read = request => request.operation === "images_styles" ? Promise.reject(Error("styles unavailable")) : read(request);
  const partial = await h.images.readImagesCatalog(access(), signal());
  assert.equal(partial.catalog.groups[0].id, "styles"); assert.equal(partial.styles, undefined); assert.equal(partial.errors.length, 1);
  assert.deepEqual(reads(h).map(r => r.operation), ["images_init", "images_styles"]);
  assert.deepEqual(clone(reads(h)[1].params), { include_image_suggestions: true });
  const other = client(); const otherRead = other.control.read;
  other.control.read = request => request.operation === "images_init" ? [] : otherRead(request);
  const result = await other.images.readImagesCatalog(access(), signal());
  assert.equal(result.catalog, undefined); assert.equal(result.styles.image_suggestions.length, 1); assert.equal(result.errors.length, 1);
});
await check("unavailable access never reads metadata", async () => {
  const h = client(), denied = { ...access(), available: false };
  await assert.rejects(h.images.readImagesCatalog(denied, signal()));
  await assert.rejects(h.images.readImagesHistory(denied, null, signal())); assert.equal(reads(h).length, 0);
});
await check("two catalog failures remain two errors, never a fabricated successful empty catalog", async () => {
  const h = client(); h.control.read = async () => { throw Error("offline catalog failure"); };
  const result = await h.images.readImagesCatalog(access(), signal());
  assert.equal(result.catalog, undefined); assert.equal(result.styles, undefined); assert.equal(result.errors.length, 2);
});
await check("real service response identity verification prevents foreign bodies reaching parsers", async () => {
  const h = client(); h.control.responseIdentity = { ...identity, accountId: "other" };
  await assert.rejects(h.images.readImagesHistory(access(), null, signal()), /账号发生变化/);
  const result = await h.images.readImagesCatalog(access(), signal());
  assert.equal(result.catalog, undefined); assert.equal(result.styles, undefined); assert.equal(result.errors.length, 2);
});
await check("abort while non-cancellable raw config is pending cannot release late access", async () => {
  const h = client(), pending = deferred(), controller = new AbortController();
  h.control.payload = snapshot({ providerGate: true }); h.control.config = pending.promise;
  const result = h.images.readImagesAccess(controller.signal); await flush();
  assert.equal(h.calls.filter(c => c.method === "config/read").length, 1);
  controller.abort(); pending.resolve({ config: {} }); await assert.rejects(result);
  assert.equal(h.calls.filter(c => c.command === "chatgpt_service_identity").length, 1);
});
await check("pre-abort and abort during history drop late data and forward cancellation", async () => {
  const h = client(), before = new AbortController(); before.abort();
  await assert.rejects(h.images.readImagesAccess(before.signal)); assert.equal(h.calls.length, 0);
  const pending = deferred(), controller = new AbortController(); h.control.read = () => pending.promise;
  const result = h.images.readImagesHistory(access(), null, controller.signal); controller.abort();
  pending.resolve({ items: [], cursor: null }); await assert.rejects(result); assert.equal(h.cancelled.length, 1);
});
await check("cancelled catalog and changed final identity cannot return partial stale data", async () => {
  const h = client(), pending = deferred(), controller = new AbortController(); h.control.read = () => pending.promise;
  const result = h.images.readImagesCatalog(access(), controller.signal); controller.abort(); pending.resolve({});
  await assert.rejects(result); assert.equal(h.cancelled.length, 2);
  for (const operation of ["readImagesCatalog", "readImagesHistory"]) {
    const changed = client(); changed.control.identity = async () => ({ ...identity, generation: 5 });
    await assert.rejects(operation === "readImagesCatalog" ? changed.images[operation](access(), signal())
      : changed.images[operation](access(), null, signal()), /账号发生变化/);
  }
});
console.log(`Images real-client offline bridge regression: ${passed} passed, ${failed} failed; no HTTP, native auth/network or GUI claim.`);
if (failed) process.exitCode = 1;
export { client, identity, clone, deferred, flush, access, signal, reads };

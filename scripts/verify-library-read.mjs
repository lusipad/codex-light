import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const identity = { accountId: "account-fixture", userId: "user-fixture", generation: 0 };
const account = planType => ({ account: { type: "chatgpt", planType }, workspaceRouting: { chatgptAccountId: identity.accountId } });
const hash = key => { let value = 0; for (const c of key) value = (Math.imul(value, 31) + c.charCodeAt(0)) >>> 0; return String(value); };
const accounts = plan_type => ({ account_ordering: [identity.accountId], accounts: [{ id: identity.accountId, plan_type, can_access_with_session: true, is_deactivated: false }] });
function payload({ compact = false, hashed = false, file = true, layer = false, onedrive = false } = {}) {
  const key = value => hashed ? hash(value) : value;
  return { user: { userID: identity.userId, customIDs: { account_id: identity.accountId } }, has_updates: true,
    response_format: compact ? "init-v2" : "init-v1",
    feature_gates: { [key("224248639")]: { [compact ? "v" : "value"]: file },
      [key("3583034603")]: { [compact ? "v" : "value"]: onedrive } },
    layer_configs: { [key("3017902351")]: compact ? { v: "layer-values" } : { value: { web_file_library_enabled: layer } } },
    ...(compact ? { values: { "layer-values": { web_file_library_enabled: layer } } } : {}),
  };
}
const bootstrap = value => ({ statsigPayload: JSON.stringify(value) });
const settings = { flags: { file_library_enabled_for_registration_country: true } };
const flush = async () => { for (let i = 0; i < 50; ++i) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function load(file, dependencies, uuid) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Intl, AbortController, crypto: { randomUUID: uuid },
    navigator: { userAgent: "Fixture Chromium", userAgentData: { platform: "Windows", brands: [{ brand: "Chromium", version: "140" }] } },
    localStorage: { getItem: () => "fixture-device" }, require: dependencies });
  return exports;
}
export function client(requestId = "fixed-library-id") {
  const calls = [], cancelled = [];
  const control = { identity: async () => identity, bootstrap: async () => bootstrap(payload()),
    account: async () => account("plus"),
    read: async request => ({ requestId: request.requestId, identity: request.expectedIdentity,
      body: request.operation === "library_settings" ? settings : request.operation === "share_accounts" ? accounts("plus") : { items: [], cursor: null } }) };
  const bridge = { callAppServer: async (method, params) => {
    assert.equal(method, "account/read"); assert.equal(JSON.stringify(params), '{"refreshToken":false}');
    return control.account();
  }, tauriInvoke: async (command, args) => {
    calls.push({ command, args });
    if (command === "chatgpt_service_identity") return control.identity();
    if (command === "chatgpt_service_cancel") { cancelled.push(args.requestId); return; }
    if (command === "share_thread_access") return control.bootstrap();
    assert.equal(command, "chatgpt_service_read"); return control.read(args.request);
  } };
  const service = load("src/chatgptService.ts", name => name === "./bridge" ? bridge : {}, () => requestId);
  const data = load("src/libraryData.ts", () => { throw Error("unexpected data dependency"); }, () => requestId);
  const preview = load("src/libraryPreview.ts", () => { throw Error("unexpected preview dependency"); }, () => requestId);
  const library = load("src/libraryClient.ts", name => ({ "./bridge": bridge, "./chatgptService": service, "./libraryData": data, "./libraryPreview": preview })[name], () => requestId);
  return { library, control, calls, cancelled };
}
const productionDecode = client().library.decodeLibraryAccess;
const decodeLibraryAccess = (bootstrap, settings, account, identity, inventory = accounts("plus")) =>
  productionDecode(bootstrap, settings, account, identity, inventory);
for (const compact of [false, true]) for (const hashed of [false, true]) for (const onedrive of [false, true]) {
  const access = decodeLibraryAccess(bootstrap(payload({ compact, hashed, onedrive })), settings, account("plus"), identity);
  assert.equal(access.available, true); assert.equal(access.onedrive, onedrive); assert.equal(access.identity, identity);
}
for (const compact of [false, true]) for (const hashed of [false, true]) {
  const key = hashed ? hash("3085093835") : "3085093835";
  for (const expected of [true, false, undefined]) {
    const p = payload({ compact, hashed });
    if (expected !== undefined) p.feature_gates[key] = { [compact ? "v" : "value"]: expected };
    const access = decodeLibraryAccess(bootstrap(p), settings, account("plus"), identity);
    assert.equal(access.newLayout, expected);
    assert.equal(Object.hasOwn(access, "newLayout"), expected !== undefined);
    assert.equal(access.available, true);
  }
  for (const invalid of ["true", null, 1]) {
    const p = payload({ compact, hashed });
    p.feature_gates[key] = { [compact ? "v" : "value"]: invalid };
    assert.throws(() => decodeLibraryAccess(bootstrap(p), settings, account("plus"), identity));
  }
  for (const change of [p => { p.user.userID = "other"; }, p => { p.user.customIDs.account_id = "other"; },
    p => { p.response_format = "unknown"; }, p => { p.is_delta = true; }]) {
    const p = payload({ compact, hashed });
    p.feature_gates[key] = { [compact ? "v" : "value"]: true };
    change(p);
    assert.throws(() => decodeLibraryAccess(bootstrap(p), settings, account("plus"), identity));
  }
  const p = payload({ compact, hashed });
  p.feature_gates[key] = { [compact ? "v" : "value"]: true };
  assert.throws(() => decodeLibraryAccess(bootstrap(p), settings, { account: { type: "apiKey" } }, identity));
}
for (const [file, layer, expected] of [[true, false, true], [false, true, true], [true, true, true], [false, false, false]])
  assert.equal(decodeLibraryAccess(bootstrap(payload({ file, layer })), settings, account("plus"), identity).available, expected);
for (const change of [p => { delete p.feature_gates["224248639"]; delete p.layer_configs; },
  p => { p.feature_gates["224248639"].value = false; delete p.layer_configs; },
  p => { p.feature_gates["224248639"].value = "true"; }, p => { p.layer_configs["3017902351"].value.web_file_library_enabled = null; },
  p => { delete p.feature_gates["3583034603"]; }, p => { p.feature_gates["3583034603"].value = 1; },
  p => { p.user.userID = "other"; }, p => { p.user.customIDs.account_id = "other"; }, p => { delete p.user; },
  p => { p.has_updates = false; }, p => { p.is_delta = true; }, p => { p.isDelta = true; },
  p => { p.live_overlay = {}; }, p => { p.response_format = "unknown"; }, p => { p.feature_gates = []; }]) {
  const p = payload(); change(p); assert.throws(() => decodeLibraryAccess(bootstrap(p), settings, account("plus"), identity));
}
for (const value of [{}, { flags: {} }]) assert.equal(decodeLibraryAccess(bootstrap(payload()), value, account("plus"), identity).available, true);
assert.equal(decodeLibraryAccess(bootstrap(payload()), { flags: { file_library_enabled_for_registration_country: false } }, account("plus"), identity).available, false);
for (const value of [null, [], { flags: null }, { flags: [] }, { flags: { file_library_enabled_for_registration_country: null } },
  { flags: { file_library_enabled_for_registration_country: "true" } }]) assert.throws(() => decodeLibraryAccess(bootstrap(payload()), value, account("plus"), identity));
const plans = ["free", "go", "plus", "pro", "promax", "prolite", "free_workspace", "team", "self_serve_business_prolite", "sci",
  "rosalind_academic", "business", "enterprise_cbp_trial", "enterprise_cbp_view_only", "finserv", "law", "ent26", "education",
  "edu_plus", "edu_pro", "quorum", "enterprise", "hc", "hc_consumption", "deprecated_enterprise", "edu", "deprecated_edu", "k12"];
for (const plan of plans) assert.equal(decodeLibraryAccess(bootstrap(payload()), settings, account("unknown"), identity, accounts(plan)).available, true);
assert.equal(decodeLibraryAccess(bootstrap(payload()), settings, account("unknown"), identity,
  { account_ordering: ["other-account", identity.accountId], accounts: [{ id: "other-account", plan_type: "unsupported" }, ...accounts("team").accounts] }).available, true);
for (const value of [{ account: { type: "apiKey", planType: "plus" } },
  { ...account("plus"), workspaceRouting: { chatgptAccountId: "other" } }]) assert.throws(() => decodeLibraryAccess(bootstrap(payload()), settings, value, identity));
for (const inventory of [null, {}, { ...accounts("plus"), accounts: {} }, { ...accounts("plus"), accounts: [] },
  { ...accounts("plus"), accounts: [{ id: "other", plan_type: "plus" }] },
  { ...accounts("plus"), accounts: [...accounts("plus").accounts, ...accounts("plus").accounts] }, accounts("unsupported"),
  { ...accounts("plus"), accounts: [{ ...accounts("plus").accounts[0], can_access_with_session: false }] },
  { ...accounts("plus"), accounts: [{ ...accounts("plus").accounts[0], is_deactivated: true }] },
  { ...accounts("plus"), account_ordering: undefined }, { ...accounts("plus"), account_ordering: ["other-account"] }])
  assert.throws(() => decodeLibraryAccess(bootstrap(payload()), settings, account("unknown"), identity, inventory));
{
  const c = client(); assert.equal((await c.library.readLibraryAccess(new AbortController().signal)).available, true);
  assert.equal(c.calls.filter(call => call.command === "chatgpt_service_identity").length, 2);
  assert.equal(c.calls.find(call => call.command === "chatgpt_service_read").args.request.operation, "library_settings");
  const inventoryRequest = c.calls.find(call => call.args.request?.operation === "share_accounts").args.request;
  assert.equal(JSON.stringify(inventoryRequest.params), "{}"); assert.equal(inventoryRequest.expectedIdentity, identity);
}
for (const change of [{ accountId: "other" }, { userId: "other" }, { generation: 1 }]) {
  const c = client(); let n = 0; c.control.identity = async () => ++n === 1 ? identity : { ...identity, ...change };
  await assert.rejects(c.library.readLibraryAccess(new AbortController().signal), /账号发生变化/);
}
{
  const c = client(), abort = new AbortController(), wait = deferred(); c.control.bootstrap = () => wait.promise;
  const read = c.library.readLibraryAccess(abort.signal); await flush(); abort.abort(); wait.resolve(bootstrap(payload()));
  await assert.rejects(read, /取消|abort/i); assert.ok(c.cancelled.includes("fixed-library-id"));
}
{
  const c = client(), abort = new AbortController(); abort.abort();
  await assert.rejects(c.library.readLibraryAccess(abort.signal), /取消/); assert.equal(c.calls.length, 0);
}
const access = { identity, available: true, onedrive: true };
for (const directoryId of [null, "directory-search"]) {
  const c = client();
  await c.library.readLibraryPage(access, "all", "search-cursor", new AbortController().signal, directoryId, "中文 & term");
  const params = c.calls[0].args.request.params;
  assert.equal(params.q, "中文 & term", "native search must reach the authenticated service, not filter loaded rows");
  assert.equal(params.parent_directory_id, directoryId ?? undefined);
  assert.equal(params.cursor, "search-cursor");
  await c.library.readLibraryPage(access, "all", null, new AbortController().signal, directoryId, "");
  assert.equal("q" in c.calls[1].args.request.params, false, "cleared search omits q");
}
{
  const c = client(); await c.library.readLibraryPage(access, "all", "cursor-2", new AbortController().signal);
  const request = c.calls[0].args.request;
  assert.equal(request.operation, "library_nodes"); assert.equal(request.expectedIdentity, identity);
  assert.equal(JSON.stringify(request.params), JSON.stringify({ entry_surface: "library", cursor: "cursor-2", categories: [], source: null,
    include_hidden_files: false, include_files: true, include_saved_entities: true, defer_sharing_badges: true,
    include_sites: false, include_folder_counts: false, include_onedrive: true, hydrate_folder_thumbnails: true }));
  await c.library.readLibraryPage({ ...access, onedrive: false }, "all", null, new AbortController().signal);
  assert.equal(c.calls[1].args.request.params.include_onedrive, false);
}
{
  const c = client();
  c.control.read = async request => ({ requestId: request.requestId, identity,
    body: { items: [{ id: "image-fixture", file_name: "图像.png", file_size_bytes: 1024 }], cursor: "image-next" } });
  const result = await c.library.readLibraryPage(access, "images", "image-cursor", new AbortController().signal);
  assert.equal(c.calls[0].args.request.operation, "library_images");
  assert.equal(JSON.stringify(c.calls[0].args.request.params), '{"cursor":"image-cursor"}');
  assert.equal(result.cursor, "image-next"); assert.equal(result.items[0].node.name, "图像.png");
  assert.equal(result.items[0].node.kind, "file"); assert.equal(result.items[0].currentVersion, 0);
}
const fixtureArg = flag => {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  const path = process.argv[index + 1];
  if (!path || path.startsWith("--")) throw Error(`${flag} requires a response file path`);
  return JSON.parse(fs.readFileSync(path, "utf8"));
};
const imageFixture = fixtureArg("--native-fixture");
const settingsFixture = fixtureArg("--settings-fixture");
const previewFixture = fixtureArg("--image-fixture");
if (imageFixture) {
  const fixture = imageFixture;
  const c = client(fixture.requestId); c.control.read = async () => fixture;
  const result = await c.library.readLibraryPage(access, "images", null, new AbortController().signal);
  assert.equal(c.calls[0].args.request.operation, "library_images"); assert.equal(JSON.stringify(c.calls[0].args.request.params), '{"cursor":null}');
  assert.equal(result.cursor, "next-fixture"); assert.equal(result.items[0].node.name, "图像.png");
  assert.equal(result.items[0].node.kind, "file"); assert.equal(result.items[0].currentVersion, 2);
  assert.equal(result.items[0].node.parent_directory_id, null);
}
if (settingsFixture) {
  const fixture = settingsFixture;
  const c = client(fixture.requestId); const defaultRead = c.control.read;
  c.control.read = async request => request.operation === "library_settings" ? fixture : defaultRead(request);
  assert.equal((await c.library.readLibraryAccess(new AbortController().signal)).available, true);
}
if (previewFixture) {
  const c = client(previewFixture.requestId); c.control.read = async () => previewFixture;
  const dataUrl = await c.library.readLibraryImage({ node: { id: "libfile_fde1_fixture", kind: "file", name: "图像.png" } }, access, new AbortController().signal);
  assert.equal(c.calls[0].args.request.operation, "library_image");
  assert.equal(JSON.stringify(c.calls[0].args.request.params), '{"library_file_id":"libfile_fde1_fixture"}');
  assert.equal(dataUrl, "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=");
}
for (const [node, params] of [
  [{ id: "libfile_fde2_image", file_id: "ignored", gizmo_id: "gizmo-fixture" }, { library_file_id: "libfile_fde2_image", gizmo_id: "gizmo-fixture" }],
  [{ id: "wrapped-file", file_id: "libfile_fde3_image" }, { library_file_id: "libfile_fde3_image" }],
  [{ id: "node-id", file_id: "file-fixture" }, { file_id: "file-fixture" }],
]) {
  const c = client(); c.control.read = async request => ({ requestId: request.requestId, identity, body: { dataUrl: "data:image/png;base64,AQ==" } });
  assert.equal(await c.library.readLibraryImage({ node: { ...node, kind: "file", name: "Image" } }, access, new AbortController().signal), "data:image/png;base64,AQ==");
  assert.equal(c.calls[0].args.request.operation, "library_image");
  assert.equal(JSON.stringify(c.calls[0].args.request.params), JSON.stringify(params));
}
for (const dataUrl of ["https://example.test/image.png", "http://example.test/image.png", "data:text/html;base64,PGh0bWw+", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,<script>"]) {
  const c = client(); c.control.read = async request => ({ requestId: request.requestId, identity, body: { dataUrl } });
  await assert.rejects(c.library.readLibraryImage({ node: { id: "image", file_id: "file", name: "Image", kind: "file" } }, access, new AbortController().signal), /图像预览/);
}
{
  const c = client();
  await assert.rejects(c.library.readLibraryImage({ node: { id: "missing-locator", name: "Image", kind: "file" } }, access, new AbortController().signal), /图像预览/);
  assert.equal(c.calls.length, 0);
}
for (const change of [{ requestId: "other" }, { identity: { ...identity, generation: 3 } }]) {
  const c = client(); c.control.read = async request => ({ requestId: request.requestId, identity, body: { items: [], cursor: null }, ...change });
  await assert.rejects(c.library.readLibraryPage(access, "all", null, new AbortController().signal), /账号发生变化/);
}
{
  const c = client(); c.control.read = async request => ({ requestId: request.requestId, identity, body: { items: "invalid", cursor: null } });
  await assert.rejects(c.library.readLibraryPage(access, "images", null, new AbortController().signal), /分页数据无效/);
  await assert.rejects(c.library.readLibraryPage({ ...access, available: false }, "all", null, new AbortController().signal), /不支持/);
}
console.log("PASS production Library access decoding, fixed operations and identity/cancellation guards");
if (imageFixture) console.log("PASS actual Rust images service envelope -> production client and parser");
if (settingsFixture) console.log("PASS actual Rust settings service envelope -> production access decoder");
if (previewFixture) console.log("PASS actual Rust image bytes data URL -> production image client");

{
  const c = client();
  await c.library.readLibraryPage(access, "all", "folder-next", new AbortController().signal, "libdir_fde1_中文/a?#");
  assert.equal(c.calls[0].args.request.params.parent_directory_id, "libdir_fde1_中文/a?#");
  assert.equal(c.calls[0].args.request.params.cursor, "folder-next");
  assert.equal(c.calls[0].args.request.params.include_onedrive, true);
  await c.library.readLibraryPage(access, "all", null, new AbortController().signal);
  assert.equal("parent_directory_id" in c.calls[1].args.request.params, false, "existing root/cleanup request is unchanged");
  c.control.read = async request => ({ requestId: request.requestId, identity, body: { items: [{ id: "a/b", name: "目录" }] } });
  const path = await c.library.readLibraryDirectoryPath(access, "a/b", new AbortController().signal);
  assert.equal(path[0].name, "目录");
  assert.equal(c.calls[2].args.request.operation, "library_directory_path");
  assert.equal(JSON.stringify(c.calls[2].args.request.params), '{"directory_id":"a/b"}');
  assert.equal(c.calls[2].args.request.expectedIdentity, identity);
}
for (const id of ["", "   ", null, undefined]) {
  const c = client();
  await assert.rejects(c.library.readLibraryDirectoryPath(access, id, new AbortController().signal));
  assert.equal(c.calls.length, 0);
}
{
  const c = client();
  await assert.rejects(c.library.readLibraryDirectoryPath({ ...access, available: false }, "a", new AbortController().signal), /不支持/);
  assert.equal(c.calls.length, 0);
}
for (const change of [{ requestId: "other" }, { identity: { ...identity, generation: 3 } }]) {
  const c = client(); c.control.read = async request => ({ requestId: request.requestId, identity, body: { items: [] }, ...change });
  await assert.rejects(c.library.readLibraryDirectoryPath(access, "a", new AbortController().signal), /账号发生变化/);
}
{
  const c = client(), abort = new AbortController(), wait = deferred();
  c.control.read = () => wait.promise;
  const read = c.library.readLibraryDirectoryPath(access, "a", abort.signal); await flush(); abort.abort();
  wait.resolve({ requestId: "fixed-library-id", identity, body: { items: [] } });
  await assert.rejects(read, /取消|abort/i);
  assert.ok(c.cancelled.includes("fixed-library-id"));
}
console.log("PASS native directory list scope, fixed path reader, access, identity and late cancellation");

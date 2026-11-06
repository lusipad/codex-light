import assert from "node:assert/strict";
import { client, identity, clone, deferred, flush, access, signal, reads } from "./verify-images-read.mjs";

let passed = 0, failed = 0;
async function check(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
}
const ref = (requestId = "origin", role = "recent", id = "image-a", groupId = null) => ({
  assetKey: `opaque-${role}-${id}`, sourceRequestId: requestId, role, id, groupId, variant: 0,
});
const png = "data:image/png;base64,iVBORw==";
await check("metadata requires host references including an explicit empty array", async () => {
  for (const assets of [undefined, null, {}, "bad"]) {
    const h = client(); h.control.response = result => ({ ...result, assets });
    await assert.rejects(h.images.readImagesHistory(access(), null, signal()), /资源引用/);
  }
  const h = client(); assert.deepEqual(clone((await h.images.readImagesHistory(access(), null, signal())).assets), []);
});
await check("metadata references bind operation, request, shape and unique key", async () => {
  for (const mutate of [r => ({ ...r, sourceRequestId: "foreign" }), r => ({ ...r, role: "styles" }),
    r => ({ ...r, variant: 1 }), r => ({ ...r, groupId: "wrong" }), r => ({ ...r, assetKey: "" }),
    r => ({ ...r, id: "a\n" }), r => ({ ...r, sourceRequestId: null }), r => ({ ...r, role: "arbitrary" })]) {
    const h = client(); h.control.assets = request => [mutate(ref(request.requestId))];
    await assert.rejects(h.images.readImagesHistory(access(), null, signal()), /资源引用/);
  }
  const h = client(); h.control.assets = request => [ref(request.requestId), ref(request.requestId)];
  await assert.rejects(h.images.readImagesHistory(access(), null, signal()), /重复/);
  const repeatedId = client(); repeatedId.control.assets = request => [ref(request.requestId), { ...ref(request.requestId), assetKey: "second" }];
  assert.equal((await repeatedId.images.readImagesHistory(access(), null, signal())).assets.length, 2);
});
await check("init group IDs are mandatory and styles/suggestions remain separate roles", async () => {
  const h = client(); h.control.assets = request => request.operation === "images_init"
    ? [ref(request.requestId, "init_group", "style-a", "styles")]
    : [ref(request.requestId, "styles", "same"), ref(request.requestId, "image_suggestions", "same")];
  const result = await h.images.readImagesCatalog(access(), signal());
  assert.equal(result.errors.length, 0); assert.equal(result.catalogAssets[0].groupId, "styles"); assert.equal(result.stylesAssets.length, 2);
  h.control.assets = request => request.operation === "images_init" ? [ref(request.requestId, "init_group")] : [];
  const bad = await h.images.readImagesCatalog(access(), signal());
  assert.equal(bad.catalog, undefined); assert.equal(bad.stylesAssets.length, 0); assert.equal(bad.errors.length, 1);
});
await check("partial catalog keeps grants only for the successfully parsed source", async () => {
  const h = client(), read = h.control.read;
  h.control.read = request => request.operation === "images_styles" ? [] : read(request);
  h.control.assets = request => request.operation === "images_init" ? [ref(request.requestId, "init_group", "style-a", "styles")]
    : [ref(request.requestId, "image_suggestions", "suggestion")];
  const result = await h.images.readImagesCatalog(access(), signal());
  assert.equal(result.catalogAssets.length, 1); assert.equal(result.stylesAssets.length, 0); assert.equal(result.errors.length, 1);
  const foreign = client(); foreign.control.response = result => ({ ...result, requestId: "foreign-request" });
  await assert.rejects(foreign.images.readImagesHistory(access(), null, signal()), /账号发生变化/);
});
await check("selector follows merged suggestion role, never same-ID style or init grant", async () => {
  const h = client(), catalog = { groups: [{ id: "a", items: [{ id: "same" }] }, { id: "b", items: [{ id: "same" }] }] };
  const result = { catalog, styles: { styles: [{ id: "same" }], image_suggestions: [{ id: "same" }] },
    catalogAssets: [ref("init", "init_group", "same", "a"), { ...ref("init", "init_group", "same", "b"), assetKey: "b" }],
    stylesAssets: [ref("styles", "styles", "same"), ref("styles", "image_suggestions", "same")], errors: [] };
  const groups = h.data.mergeImagesCatalog(catalog, result.styles);
  assert.equal(h.assets.selectPromptAsset(groups[0], groups[0].items[0], result).role, "image_suggestions");
  assert.equal(h.assets.selectPromptAsset(groups[1], groups[1].items[0], result).groupId, "b");
  result.stylesAssets = result.stylesAssets.filter(r => r.role === "styles");
  assert.equal(h.assets.selectPromptAsset(groups[0], groups[0].items[0], result), null);
});
await check("history selector uses first originating page and revokes later blocked/archived", async () => {
  const h = client(), item = { id: "image-a", url: "https://not-authorization.invalid/image" };
  const pages = [{ items: [item], cursor: "next", assets: [ref("first")] }, { items: [item], cursor: null, assets: [ref("second")] }];
  assert.equal(h.assets.selectHistoryAsset(item, pages).sourceRequestId, "first");
  for (const field of ["is_archived", "output_blocked"]) {
    pages[1].items = [{ ...item, [field]: true }]; assert.equal(h.assets.selectHistoryAsset(item, pages), null);
  }
  assert.equal(h.assets.selectHistoryAsset({ ...item, encodings: { thumbnail: { path: "" } } }, [pages[0]]), null);
  assert.equal(h.assets.selectHistoryAsset(item, [{ ...pages[0], assets: [] }]), null);
});
await check("image read sends opaque key/source only and validates identity at response and readback", async () => {
  const h = client(); h.control.read = async () => ({ dataUrl: png });
  assert.equal(await h.images.readImagesAsset(ref(), access(), signal()), png);
  assert.deepEqual(clone(reads(h)[0].params), { asset_key: ref().assetKey, source_request_id: "origin" });
  assert.equal(reads(h)[0].operation, "images_asset");
  for (const field of ["accountId", "userId", "generation"]) {
    const foreign = client(); foreign.control.read = async () => ({ dataUrl: png });
    foreign.control.responseIdentity = { ...identity, [field]: field === "generation" ? 8 : "foreign" };
    await assert.rejects(foreign.images.readImagesAsset(ref(), access(), signal()), /账号发生变化/);
    const late = client(); late.control.read = foreign.control.read;
    late.control.identity = async () => foreign.control.responseIdentity;
    await assert.rejects(late.images.readImagesAsset(ref(), access(), signal()), /账号发生变化/);
  }
});
await check("invalid references and unavailable access make no asset calls", async () => {
  for (const value of [null, {}, { ...ref(), role: "unknown" }, { ...ref(), groupId: "g" }, { ...ref(), variant: 2 }]) {
    const h = client(); await assert.rejects(h.images.readImagesAsset(value, access(), signal())); assert.equal(h.calls.length, 0);
  }
  const h = client(); await assert.rejects(h.images.readImagesAsset(ref(), { ...access(), available: false }, signal())); assert.equal(h.calls.length, 0);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(h.images.readImagesAsset(ref(), access(), aborted.signal)); assert.equal(h.calls.length, 0);
});
await check("data URLs reject arbitrary remote URLs, SVG, malformed base64, empty and over-limit data", async () => {
  for (const dataUrl of ["https://fixture.invalid/image", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,", "data:image/png;base64,a===",
    "data:image/png;base64,AA=", "data:image/png;base64,AA==\n", "data:image/png;base64," + "AAAA".repeat(Math.ceil(8 * 1024 * 1024 / 3) + 1)]) {
    const h = client(); h.control.read = async () => ({ dataUrl }); await assert.rejects(h.images.readImagesAsset(ref(), access(), signal()), /图像内容/);
  }
});
await check("late metadata and asset responses are discarded on abort with native cancellation", async () => {
  for (const metadata of [false, true]) {
    const h = client(), pending = deferred(), controller = new AbortController(); h.control.read = () => pending.promise;
    const result = metadata ? h.images.readImagesHistory(access(), null, controller.signal) : h.images.readImagesAsset(ref(), access(), controller.signal);
    await flush(); controller.abort(); pending.resolve(metadata ? { items: [], cursor: null } : { dataUrl: png });
    await assert.rejects(result); assert.equal(h.cancelled.length, 1);
    assert.equal(h.calls.filter(c => c.command === "chatgpt_service_identity").length, 0);
  }
});
console.log(`Images opaque assets: ${passed} passed, ${failed} failed; offline actual TS readers/selectors, no HTTP or UI claim.`);
if (failed) process.exitCode = 1;

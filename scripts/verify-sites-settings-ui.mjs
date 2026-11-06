import assert from "node:assert/strict";
import fs from "node:fs";
import { harness, walk, text, flush, latest, button, raw, access } from "./verify-sites-view.mjs";

const snapshot = (entries = [{ key: "MODE", secret: false, value: "dev" }], revision = 1, extra = {}) => ({ projectId: "one", entries, revision, updatedAt: null, ...extra });
function fixture(initial = snapshot()) {
  const h = harness({ component: "SiteSettingsForm" }), scope = new AbortController(), updated = [];
  const props = { access, site: h.data.parseSite(raw("one")), snapshot: initial, scope: scope.signal, loading: false, sharingText: "仅自己可见", onSite: value => updated.push(value) };
  h.render(props);
  const state = h.load("src/siteSettingsState.ts").siteSettingsState(access, props.site, initial, scope.signal, props.onSite);
  return { h, scope, props, state, updated, render: () => h.render(props), input(label) { return walk(h.render(props)).find(n => n.type === "input" && n.props["aria-label"] === label); } };
}
const titleResult = (h, title, updated = "2026-11-08T00:00:00Z") => ({ site: h.data.parseSite(raw("one", { title, updated_at: updated })), assets: [] });
let passed = 0;
const failures = [];
async function check(name, run) { try { await run(); passed++; console.log(`PASS ${name}`); } catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); } }

await check("actual title field waits 900 ms, trims wire input and only clears the matching successful draft", async () => {
  const f = fixture(); assert.equal(f.input("站点标题").props.maxLength, 100);
  f.input("站点标题").props.onChange({ target: { value: "  新名称  " } }); f.h.tick(899); assert.equal(f.h.calls.length, 0);
  f.h.tick(1); assert.equal(latest(f.h, "title-write").args[2], "新名称"); latest(f.h, "title-write").resolve(titleResult(f.h, "新名称")); await flush();
  assert.equal(f.input("站点标题").props.value, "新名称"); assert.equal(f.updated.length, 1); assert.match(text(f.render()), /已保存/); f.h.unmount();
});
await check("title composition cancels timer and IME Enter never commits; composition end resets 900 ms and blur is immediate", async () => {
  const f = fixture(), input = () => f.input("站点标题"); input().props.onChange({ target: { value: "输入中" } }); input().props.onCompositionStart(); f.h.tick(1000); assert.equal(f.h.calls.length, 0);
  let prevented = false; input().props.onKeyDown({ key: "Enter", nativeEvent: { isComposing: true }, keyCode: 229, preventDefault() { prevented = true; } }); assert.equal(prevented, false);
  input().props.onCompositionEnd(); f.h.tick(899); assert.equal(f.h.calls.length, 0); input().props.onBlur(); assert.equal(f.h.calls.length, 1);
  latest(f.h, "title-write").resolve(titleResult(f.h, "输入中")); await flush(); input().props.onChange({ target: { value: "   " } }); input().props.onBlur();
  assert.match(text(f.render()), /必须填写站点标题/); assert.equal(f.h.calls.length, 1); f.h.unmount();
});
await check("title A then B serializes and independent environment failure cannot revert successful title", async () => {
  const f = fixture(); f.state.changeTitle("A"); void f.state.commitTitle(); const first = latest(f.h, "title-write");
  f.state.changeTitle("B"); void f.state.commitTitle(); assert.equal(f.h.calls.filter(c => c.operation === "title-write").length, 1);
  f.state.editEnvironment(f.state.entries.map(e => ({ ...e, value: "prod" }))); void f.state.commitEnvironment(); latest(f.h, "environment-write").reject({ code: "site_environment_unconfirmed" }); await flush();
  first.resolve(titleResult(f.h, "A")); await flush(); assert.equal(latest(f.h, "title-write").args[2], "B"); latest(f.h, "title-write").resolve(titleResult(f.h, "B", "2026-11-09T00:00:00Z")); await flush();
  assert.equal(f.state.title, "B"); assert.equal(f.state.environmentStatus, "error"); assert.equal(f.state.entries[0].value, "prod"); f.h.unmount();
});
await check("environment has no title timer; internal group focus does not commit; leaving group or non-IME Enter commits", async () => {
  const f = fixture(); f.input("值").props.onChange({ target: { value: "prod" } }); f.h.tick(2000); assert.equal(f.h.calls.length, 0);
  const group = walk(f.render()).find(n => n.props.role === "group"), field = f.input("值");
  group.props.onBlur({ currentTarget: group.element, relatedTarget: field.element }); assert.equal(f.h.calls.length, 0);
  group.props.onKeyDown({ key: "Enter", target: { tagName: "INPUT" }, nativeEvent: { isComposing: true }, keyCode: 229, preventDefault() { assert.fail("IME prevented"); } }); assert.equal(f.h.calls.length, 0);
  group.props.onBlur({ currentTarget: group.element, relatedTarget: null }); assert.equal(latest(f.h, "environment-write").args[2].set_values[0].value, "prod");
  latest(f.h, "environment-write").resolve(snapshot([{ key: "MODE", secret: false, value: "prod" }], 2)); await flush(); f.h.unmount();
});
await check("secret sentinel stays internal; stored secret key/toggle locked, replacement Escape restores and ordinary literal sentinel remains legal", async () => {
  const f = fixture(snapshot([{ key: "TOKEN", secret: true, value: null }])), api = f.h.load("src/siteSettingsState.ts");
  assert.equal(f.input("密钥").props.disabled, true); assert.equal(walk(f.render()).some(n => n.type === "input" && n.props.value === "<REDACTED>"), false);
  assert.equal(walk(f.render()).find(n => n.props.type === "checkbox").props.disabled, true);
  const replace = walk(f.render()).find(n => n.type === "button" && n.props["aria-label"] === "替换 TOKEN 的密钥值"); replace.props.onClick(); f.render();
  let stopped = false; f.input("值").props.onKeyDown({ key: "Escape", nativeEvent: { isComposing: false }, preventDefault() {}, stopPropagation() { stopped = true; } }); f.render(); assert.equal(stopped, true);
  assert.equal(f.state.entries[0].value, api.STORED_SECRET); await f.state.commitEnvironment(); assert.equal(f.h.calls.length, 0);
  const ordinary = [{ ...api.newEnvironmentDraft(), key: "PUBLIC", value: "<REDACTED>" }]; assert.equal(api.environmentPatch(snapshot([]), ordinary).set_values[0].value, "<REDACTED>");
  assert.match(api.environmentValidation([{ ...f.state.entries[0], secret: false }]), /输入新值/); f.h.unmount();
});
await check("raw key validation permits case and spacing distinctions; requires-secrets only defaults new rows and locks toggle", async () => {
  const f = fixture(snapshot([], 1, { requiresSecrets: true })), api = f.h.load("src/siteSettingsState.ts");
  button(f.h, "添加变量").props.onClick(); f.render(); assert.equal(f.state.entries[0].secret, true); assert.equal(f.h.calls.length, 0); assert.equal(walk(f.render()).find(n => n.props.type === "checkbox").props.disabled, true);
  assert.match(api.environmentValidation(f.state.entries), /键名/); const a = api.newEnvironmentDraft();
  assert.equal(api.environmentValidation([{ ...a, key: " A " }, { ...a, rowId: "b", key: "a" }]), null);
  assert.match(api.environmentValidation([{ ...a, key: "A" }, { ...a, rowId: "b", key: "A" }]), /唯一/); f.scope.abort(); f.h.unmount();
});
await check("environment rebase preserves edits during save and unrelated entries returned by the server", async () => {
  const f = fixture(); f.state.editEnvironment(f.state.entries.map(e => ({ ...e, value: "A" }))); void f.state.commitEnvironment();
  f.state.editEnvironment(f.state.entries.map(e => ({ ...e, value: "B" }))); void f.state.commitEnvironment();
  latest(f.h, "environment-write").resolve(snapshot([{ key: "MODE", secret: false, value: "A" }, { key: "EXTERNAL", secret: false, value: "server" }], 2)); await flush();
  assert.equal(latest(f.h, "environment-write").args[2].set_values[0].value, "B"); assert.deepEqual(Array.from(latest(f.h, "environment-write").args[2].remove), []);
  latest(f.h, "environment-write").resolve(snapshot([{ key: "MODE", secret: false, value: "B" }, { key: "EXTERNAL", secret: false, value: "server" }], 3)); await flush();
  assert.equal(f.state.entries.find(e => e.key === "MODE").value, "B"); assert.equal(f.state.entries.find(e => e.key === "EXTERNAL").value, "server"); f.h.unmount();
});
await check("environment unknown outcome locks writes until explicit GET; already applied public value does not POST twice", async () => {
  const f = fixture(); f.state.editEnvironment(f.state.entries.map(e => ({ ...e, value: "prod" }))); void f.state.commitEnvironment(); latest(f.h, "environment-write").reject({ code: "site_environment_unconfirmed" }); await flush();
  void f.state.commitEnvironment(); assert.equal(f.h.calls.filter(c => c.operation === "environment-write").length, 1);
  void f.state.recoverEnvironment(); assert.equal(latest(f.h, "environment-read").args[1], "one"); latest(f.h, "environment-read").resolve(snapshot([{ key: "MODE", secret: false, value: "prod" }], 2)); await flush();
  assert.equal(f.h.calls.filter(c => c.operation === "environment-write").length, 1); assert.equal(f.state.environmentError, null); f.h.unmount();
});
await check("title unknown GET leaves explicit retry for an uncommitted draft and never automatically repeats POST", async () => {
  const f = fixture(); f.state.changeTitle("wanted"); void f.state.commitTitle(); latest(f.h, "title-write").reject({ code: "site_title_unconfirmed" }); await flush();
  void f.state.commitTitle(); assert.equal(f.h.calls.filter(c => c.operation === "title-write").length, 1); void f.state.recoverTitle(); latest(f.h, "detail").resolve(titleResult(f.h, "different")); await flush();
  assert.equal(f.state.title, "wanted"); assert.match(f.state.titleError, /重试/); assert.equal(f.state.titleUnknown, false); assert.equal(f.h.calls.filter(c => c.operation === "title-write").length, 1);
  void f.state.commitTitle(); latest(f.h, "title-write").resolve(titleResult(f.h, "wanted", "2026-11-09T00:00:00Z")); await flush(); f.h.unmount();
});
await check("same-identity unmount starts flush and pending draft survives; aborted generation does not flush or notify stale subscribers", async () => {
  const f = fixture(); f.state.changeTitle("leave"); f.h.unmount(); assert.equal(latest(f.h, "title-write").args[2], "leave"); const writes = f.h.writes;
  latest(f.h, "title-write").resolve(titleResult(f.h, "leave")); await flush(); assert.equal(f.h.writes, writes);
  const old = fixture(); old.state.changeTitle("pending across generation"); old.state.editEnvironment(old.state.entries.map(e => ({ ...e, value: "pending" }))); old.scope.abort(); old.h.unmount(); assert.equal(old.h.calls.length, 0);
  const next = new AbortController(), api = old.h.load("src/siteSettingsState.ts"), fresh = snapshot([{ key: "MODE", secret: false, value: "dev" }, { key: "EXTERNAL", secret: false, value: "server" }], 2);
  const rebound = api.siteSettingsState({ ...access, identity: { ...access.identity, generation: 2 } }, old.props.site, fresh, next.signal, () => {});
  assert.equal(rebound.title, "pending across generation"); assert.equal(rebound.entries.find(e => e.key === "EXTERNAL").value, "server"); void rebound.commitEnvironment();
  assert.deepEqual(Array.from(latest(old.h, "environment-write").args[2].remove), []); assert.equal(latest(old.h, "environment-write").args[0].identity.generation, 2); next.abort();
});
await check("existing row delete requires confirmation; cancel is unchanged; confirm only deletes the captured stable row", async () => {
  const f = fixture(); button(f.h, "删除此项").props.onClick(); assert.match(text(f.render()), /确定要删除环境变量/); assert.equal(f.h.calls.length, 0);
  const dialog = walk(f.render()).find(n => n.type === "dialog" && n.props.className === "site-environment-delete");
  assert.equal(walk(dialog).find(n => n.type === "h2").props.id, dialog.props["aria-labelledby"]);
  assert.equal(walk(dialog).find(n => n.type === "p").props.id, dialog.props["aria-describedby"]);
  button(f.h, "取消").props.onClick(); assert.equal(f.state.entries.length, 1); button(f.h, "删除此项").props.onClick(); f.render();
  button(f.h, "删除变量").props.onClick(); assert.deepEqual(Array.from(latest(f.h, "environment-write").args[2].remove), ["MODE"]);
  latest(f.h, "environment-write").resolve(snapshot([], 2)); await flush(); assert.equal(f.state.entries.length, 0); f.h.unmount();
});
await check("pending later drafts do not display saved after an earlier title or environment write", async () => {
  const f = fixture(); f.state.changeTitle("A"); void f.state.commitTitle(); f.state.changeTitle("B");
  latest(f.h, "title-write").resolve(titleResult(f.h, "A")); await flush(); assert.equal(f.state.titleStatus, "idle"); assert.equal(f.state.title, "B");
  f.state.editEnvironment(f.state.entries.map(e => ({ ...e, value: "A" }))); void f.state.commitEnvironment(); f.state.editEnvironment(f.state.entries.map(e => ({ ...e, value: "B" })));
  latest(f.h, "environment-write").resolve(snapshot([{ key: "MODE", secret: false, value: "A" }], 2)); await flush();
  assert.equal(f.state.environmentStatus, "idle"); assert.equal(f.state.entries[0].value, "B"); f.scope.abort(); f.h.unmount();
});
await check("fresh requires-secrets recovered state controls new rows rather than stale props", async () => {
  const f = fixture(); f.state.editEnvironment(f.state.entries.map(e => ({ ...e, value: "prod" }))); void f.state.commitEnvironment(); latest(f.h, "environment-write").reject({ code: "site_environment_unconfirmed" }); await flush();
  void f.state.recoverEnvironment(); latest(f.h, "environment-read").resolve(snapshot([{ key: "MODE", secret: false, value: "prod" }], 2, { requiresSecrets: true })); await flush();
  button(f.h, "添加变量").props.onClick(); assert.equal(f.state.entries.at(-1).secret, true); assert.equal(walk(f.render()).filter(n => n.props.type === "checkbox").at(-1).props.disabled, true); f.scope.abort(); f.h.unmount();
});
await check("confirmation tracks original stable row and replacement UI state does not move to another secret", async () => {
  const f = fixture(snapshot([{ key: "A", secret: true, value: null }, { key: "B", secret: true, value: null }]));
  walk(f.render()).find(n => n.props["aria-label"] === "替换 B 的密钥值").props.onClick(); f.render(); f.input("值").props.onChange({ target: { value: "replacement" } }); f.render();
  assert.equal(walk(f.render()).find(n => n.props.type === "checkbox" && n.props["aria-label"] === "将 B 视为机密").props.disabled, true);
  walk(f.render()).filter(n => n.props["aria-label"] === "删除此项")[0].props.onClick(); f.render();
  f.state.editEnvironment(f.state.entries.filter(e => e.key !== "A")); f.render(); assert.equal(button(f.h, "删除变量").props.disabled, true);
  button(f.h, "删除变量").props.onClick(); assert.equal(f.state.entries.length, 1); assert.equal(f.state.entries[0].key, "B"); assert.equal(f.input("值").props.value, "replacement"); assert.equal(f.h.calls.length, 0); f.scope.abort(); f.h.unmount();
});
async function parentFixture(props = {}) {
  const h = harness({ props }); h.render(); await flush(); latest(h, "access").resolve(access); await flush(); h.render(); await flush(); latest(h, "page").resolve({ items: [h.data.parseSite(raw("one"))], assets: [], cursor: null }); await flush();
  walk(h.render()).find(n => n.type === "mock-menu").props.onSelect("settings"); h.render(); await flush(); latest(h, "detail").resolve({ site: h.data.parseSite(raw("one")), assets: [] }); await flush(); h.render();
  latest(h, "settings").resolve({ environment: [], environmentSnapshot: snapshot([]), domains: [], errors: {} }); await flush(); h.render(); return h;
}
await check("actual parent cleanup flushes title using independent identity scope; invalidation cancels before child cleanup", async () => {
  const errors = [], h = await parentFixture({ onSaveError: message => errors.push(message) }); walk(h.render()).find(n => n.props["aria-label"] === "站点标题").props.onChange({ target: { value: "离页保存" } });
  h.unmount(); await flush(); const pending = latest(h, "title-write"); assert.ok(pending); assert.equal(pending.signal.aborted, false);
  const writes = h.writes; pending.reject({ code: "site_title_unconfirmed" }); await flush(); assert.equal(h.writes, writes); assert.equal(errors.length, 1); assert.match(errors[0], /网站名称未能保存/);
  const invalid = await parentFixture(); walk(invalid.render()).find(n => n.props["aria-label"] === "站点标题").props.onChange({ target: { value: "禁止旧号新写" } }); invalid.invalidate(); invalid.render(); invalid.unmount(); await flush(); assert.equal(invalid.calls.filter(c => c.operation === "title-write").length, 0);
});
await check("actual source structure has one shared 12-column environment grid and safe Escape boundary", async () => {
  const f = fixture(snapshot([{ key: "A", secret: false, value: "one" }, { key: "B", secret: false, value: "two" }]));
  assert.equal(walk(f.render()).filter(n => n.props.className === "site-environment-columns").length, 1);
  const css = fs.readFileSync("src/components/SiteSettingsForm.css", "utf8"); assert.match(css, /\.site-environment-grid\s*\{[^}]*repeat\(12,minmax\(0,1fr\)\)[^}]*gap:\s*8px[^}]*padding:\s*16px/);
  assert.match(css, /\.site-environment-columns, \.site-environment-edit-row\s*\{ display: contents/); assert.match(css, /max-width:\s*336px/); f.h.unmount();
});
await check("actual parent retained identity registration aborts an unmounted write and suppresses old-account toast", async () => {
  const errors = [], h = await parentFixture({ onSaveError: message => errors.push(message) }); walk(h.render()).find(n => n.props["aria-label"] === "站点标题").props.onChange({ target: { value: "pending old account" } });
  h.unmount(); await flush(); const pending = latest(h, "title-write"); assert.equal(h.unlistened, 0); assert.equal(h.listeners.filter(x => x.active).length, 1);
  h.invalidate(); assert.equal(pending.signal.aborted, true); pending.reject({ code: "site_title_unconfirmed", cause: { code: "account_changed" } }); await flush();
  assert.equal(errors.length, 0); assert.equal(h.unlistened, 1); assert.equal(h.listeners.filter(x => x.active).length, 0);
});
await check("the existing registration remains through independent title/environment and queued title work, then releases exactly once", async () => {
  const h = await parentFixture(); const title = () => walk(h.render()).find(n => n.props["aria-label"] === "站点标题"); title().props.onChange({ target: { value: "A" } }); title().props.onBlur();
  title().props.onChange({ target: { value: "B" } }); const stateProps = h.componentProps.get("SiteSettingsForm"), api = h.load("src/siteSettingsState.ts");
  const state = api.siteSettingsState(stateProps.access, stateProps.site, stateProps.snapshot, stateProps.scope, stateProps.onSite);
  state.editEnvironment([{ ...api.newEnvironmentDraft(), key: "MODE", value: "prod" }]); h.unmount(); await flush();
  assert.equal(h.unlistened, 0); const first = h.calls.find(c => c.operation === "title-write"); first.resolve(titleResult(h, "A")); await flush();
  assert.equal(latest(h, "title-write").args[2], "B"); assert.equal(h.unlistened, 0);
  latest(h, "environment-write").resolve(snapshot([{ key: "MODE", secret: false, value: "prod" }], 2)); await flush(); assert.equal(h.unlistened, 0);
  latest(h, "title-write").resolve(titleResult(h, "B", "2026-11-09T00:00:00Z")); await flush(); assert.equal(h.unlistened, 1); assert.equal(h.listeners.filter(x => x.active).length, 0);
  const queued = await parentFixture(); const queuedTitle = () => walk(queued.render()).find(n => n.props["aria-label"] === "站点标题"); queuedTitle().props.onChange({ target: { value: "first" } }); queuedTitle().props.onBlur(); queuedTitle().props.onChange({ target: { value: "last" } }); queued.unmount(); await flush();
  latest(queued, "title-write").resolve(titleResult(queued, "first")); await flush(); assert.equal(latest(queued, "title-write").args[2], "last"); assert.equal(queued.unlistened, 0);
  latest(queued, "title-write").resolve(titleResult(queued, "last", "2026-11-09T00:00:00Z")); await flush(); assert.equal(queued.unlistened, 1);
  const clean = await parentFixture(); clean.unmount(); await flush(); assert.equal(clean.unlistened, 1); assert.equal(clean.listeners.filter(x => x.active).length, 0);
});
assert.equal(failures.length, 0, failures.join("; "));
console.log(`PASS 21F actual settings state and JSX: ${passed} groups; explicit deferred client boundary; no real HTTP, native keyboard or pixel claim`);

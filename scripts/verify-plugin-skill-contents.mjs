import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = ts.transpileModule(fs.readFileSync("src/pluginSkillContents.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const raw = contents => ({ pluginId: "raw/plugin", skillName: "skill/name", contents });
function fixture() {
  const slots = [], effects = [], calls = []; let cursor = 0, dirty = true, result, updates = 0;
  let props = { scope: "root/load-1", pluginId: "raw/plugin", skillName: "skill/name", identity: { accountId: "a", userId: "u", generation: 1 } };
  const react = { useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = next; dirty = true; updates++; }]; },
    useEffect(run, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((v, n) => v !== old.deps[n])) { old?.cleanup?.(); effects[i] = { deps, cleanup: run() }; } },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, AbortController, require(name) {
    if (name === "react") return react;
    if (name === "./chatgptService") return { readPluginSkillContents: (...args) => { assert.equal(args[0], props.pluginId); assert.equal(args[1], props.skillName); assert.equal(args[2], props.identity); const request = deferred(); calls.push({ args, ...request }); return request.promise; } };
    throw Error(`Unexpected root/catalog/CLI/account import: ${name}`);
  } });
  const render = () => { for (let i = 0; dirty; i++) { assert.ok(i < 20); dirty = false; cursor = 0; result = exports.usePluginSkillContents(props.scope, props.pluginId, props.skillName, props.identity); } return result; };
  return { exports, calls, get value() { return render(); }, get updates() { return updates; }, update(patch) { props = { ...props, ...patch }; dirty = true; return render(); }, unmount() { effects.forEach(effect => effect?.cleanup?.()); } };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
{
  const f = fixture(), decode = contents => f.exports.decodePluginSkillContents(raw(contents), "raw/plugin", "skill/name");
  for (const contents of [{}, { name: null, description: null, interface: null, skill_md_contents: null }, { name: "", description: "", interface: { display_name: "" }, skill_md_contents: "" }, { interface: {} }]) {
    assert.deepEqual(JSON.parse(JSON.stringify(decode(contents))), contents);
  }
  const publicData = decode({ name: "Actual", interface: { display_name: "Title", token: "secret" }, skill_md_contents: "# Heading\n原文", token: "secret" });
  assert.equal(publicData.skill_md_contents, "# Heading\n原文"); assert.ok(!JSON.stringify(publicData).includes("secret"));
  for (const contents of [null, [], "markdown", { name: 1 }, { description: [] }, { interface: false }, { interface: { display_name: {} } }, { skill_md_contents: false }]) assert.throws(() => decode(contents));
  for (const body of [{ ...raw({}), pluginId: "foreign" }, { ...raw({}), skillName: "foreign" }, { pluginId: "raw/plugin", skillName: "skill/name" }]) assert.throws(() => f.exports.decodePluginSkillContents(body, "raw/plugin", "skill/name"));
}
{
  const f = fixture(); assert.equal(f.value.loading, true); assert.equal(f.calls.length, 1); f.value.retry(); f.value.retry(); assert.equal(f.calls.length, 1);
  f.calls[0].resolve(raw({ name: "Actual", skill_md_contents: "# Original" })); await flush(); assert.equal(f.value.data.skill_md_contents, "# Original"); assert.equal(f.value.error, null); assert.equal(f.value.loading, false);
  f.value.retry(); f.value.retry(); assert.equal(f.calls.length, 2); assert.equal(f.value.data.skill_md_contents, "# Original"); assert.equal(f.value.loading, true);
  f.calls[1].reject({ code: "forbidden", message: "private response" }); await flush(); assert.equal(f.value.error, "无法加载此技能"); assert.equal(f.value.data.skill_md_contents, "# Original"); assert.equal(f.value.loading, false); f.unmount();
}
for (const contents of [{}, { skill_md_contents: null }, { skill_md_contents: "" }]) {
  const f = fixture(); f.value; f.calls[0].resolve(raw(contents)); await flush(); assert.equal(f.value.error, null); assert.deepEqual(JSON.parse(JSON.stringify(f.value.data)), contents); f.unmount();
}
{
  const f = fixture(); f.value; const oldRetry = f.value.retry; f.update({ scope: "other" }); f.update({ scope: "root/load-1" }); const before = f.updates;
  oldRetry(); assert.equal(f.calls.length, 3); assert.ok(f.calls[0].args[3].aborted); f.calls[0].resolve(raw({ skill_md_contents: "old" })); await flush(); assert.equal(f.updates, before); assert.equal(f.value.data, null);
  f.unmount(); const unmounted = f.updates; for (const call of f.calls) call.reject(Error("late")); await flush(); assert.equal(f.updates, unmounted); assert.ok(f.calls.every(call => call.args[3].aborted));
}
{
  const f = fixture(); f.value; f.calls[0].resolve(raw({ skill_md_contents: "old" })); await flush(); assert.ok(f.value.data);
  f.update({ skillName: "new/skill" }); assert.equal(f.value.data, null); assert.equal(f.value.loading, true); f.calls[1].resolve({ pluginId: "raw/plugin", skillName: "new/skill", contents: { skill_md_contents: "new" } }); await flush(); assert.equal(f.value.data.skill_md_contents, "new");
  f.update({ identity: { accountId: "a", userId: "u", generation: 2 } }); assert.equal(f.value.data, null); assert.equal(f.calls.length, 3); f.unmount();
}
console.log("Service skill contents: exact context and public DTO, missing/null/empty Markdown, single-flight retry with retained old data, independent error and scope/skill/identity/ABA/close cancellation passed.");

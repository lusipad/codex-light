import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const { outputText } = ts.transpileModule(fs.readFileSync("src/useHomeCloudComposer.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const identity = { accountId: "a", userId: "u", generation: 1 };
const item = { id: "asenvcfg_fixture", name: "云构建", versionId: "v2" };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function mount() {
  const exports = {}, slots = [], effects = [], writes = [], reads = [];
  let cursor = 0, eligible = true, current = identity, journal = null;
  let catalog = async () => ({ items: [item, { ...item, id: "invalid" }, { ...item, versionId: "" }] });
  const react = {
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value;
      return [slots[i], update => { slots[i] = typeof update === "function" ? update(slots[i]) : update; }]; },
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useEffect(run, deps) {
      const i = cursor++, before = slots[i];
      if (!before || deps.some((value, j) => before.deps[j] !== value)) {
        before?.dispose?.();
        slots[i] = { deps };
        effects.push(() => { slots[i].dispose = run(); });
      }
    },
  };
  vm.runInNewContext(outputText, { exports, AbortController, require(name) {
    if (name === "react") return react;
    if (name === "./cloudEnvironmentAccess") return { async readCloudEnvironmentAccess(signal, check) {
      signal.throwIfAborted(); assert.equal(check, true); return { canStartChat: eligible, identity: current };
    } };
    if (name === "./cloudEnvironmentService") return { loadCloudCatalog(account, signal) { reads.push({ account, signal }); return catalog(); } };
    if (name === "./chatgptService") return { serviceErrorMessage: cause => cause.message };
    if (name === "./cloudPublishedChat") return {
      readPublishedCloudStart: () => journal,
      async startPublishedCloudChat(target, text, signal, open) {
        signal.throwIfAborted();
        writes.push({ target, text });
        open({ ...target.session, threadId: "cloud-thread" });
      },
    };
    assert.fail(name);
  } });
  const render = scope => {
    cursor = 0; const view = exports.useHomeCloudComposer(scope); effects.splice(0).forEach(run => run()); return view;
  };
  return { render, writes, reads, deny: () => { eligible = false; }, switchIdentity: () => { current = { ...identity, generation: 2 }; },
    setJournal: value => { journal = value; }, setCatalog: read => { catalog = read; } };
}
const app = mount();
app.render("a"); await flush();
let view = app.render("a");
assert.equal(view.available, true);
assert.equal(app.reads.length, 0, "catalog remains lazy");
view.setActive(true);
await view.load(); view = app.render("a");
assert.equal(view.items.length, 1);
assert.equal(view.canSend, false);
view.setPrompt(" 第一条云端消息 ");
view.select(item); view = app.render("a");
assert.equal(app.writes.length, 0);
assert.equal(view.target.session.binding.environmentId, null, "deferred environment does not invent an instance ID");
assert.equal(view.canSend, true);
view.setActive(false); view = app.render("a");
await view.send(() => assert.fail("inactive target opened"));
view.setActive(true); view = app.render("a");
let opened;
await view.send(session => { opened = session; return true; });
assert.equal(opened.threadId, "cloud-thread");
assert.equal(app.writes[0].text, " 第一条云端消息 ");
app.switchIdentity();
await app.render("a").send(() => assert.fail("late account opened"));
assert.equal(app.writes.length, 1);
app.setJournal({ text: "未知启动", messageId: "uuid" });
app.render("a").select(item);
view = app.render("a");
assert.equal(view.canSend, false);
await view.send(() => assert.fail("unknown write replayed"));
assert.equal(app.writes.length, 1);

let complete;
const late = mount();
late.render("a"); await flush();
late.setCatalog(() => new Promise(resolve => { complete = resolve; }));
const pending = late.render("a").load();
late.render(null);
assert.equal(late.reads[0].signal.aborted, true);
complete({ items: [item] });
await pending;
late.deny();
late.render("b"); await flush();
assert.equal(late.render("b").items, null);
assert.equal(late.render("b").available, false);
assert.equal(late.writes.length, 0);

console.log("PASS home cloud composer: lazy ready catalog, isolated text, read-only choice, explicit send, unknown journal, account and navigation invalidation");

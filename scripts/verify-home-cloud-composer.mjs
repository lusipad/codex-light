import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const { outputText } = ts.transpileModule(fs.readFileSync("src/useHomeCloudComposer.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const identity = { accountId: "a", userId: "u", generation: 1 };
const item = { id: "asenvcfg_fixture", name: "云构建", versionId: "v2", repositories: [{ id: "repo-a" }, { id: "repo-b" }, { id: "repo-a" }] };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function mount() {
  const exports = {}, slots = [], effects = [], writes = [], reads = [], repoReads = [];
  let cursor = 0, eligible = true, current = identity, journal = null, now = 0;
  let catalog = async () => ({ items: [item, { ...item, id: "invalid" }, { ...item, versionId: "" }] });
  let repository = async id => ({ name: id === "repo-a" ? "owner/runtime" : null, error: null });
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
  vm.runInNewContext(outputText, { exports, AbortController, Date: { now: () => now }, require(name) {
    if (name === "react") return react;
    if (name === "./cloudEnvironmentAccess") return { async readCloudEnvironmentAccess(signal, check) {
      signal.throwIfAborted(); assert.equal(check, true); return { canStartChat: eligible, identity: current };
    } };
    if (name === "./cloudEnvironmentService") return {
      loadCloudCatalog(account, signal) { reads.push({ account, signal }); return catalog(); },
      loadRepositoryName(id, account, signal) { repoReads.push({ id, account, signal }); return repository(id); },
    };
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
  return { render, writes, reads, repoReads, deny: () => { eligible = false; }, switchIdentity: () => { current = { ...identity, generation: 2 }; },
    setJournal: value => { journal = value; }, setCatalog: read => { catalog = read; },
    setRepository: read => { repository = read; },
    advance: ms => { now += ms; } };
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
const launch = view.send(session => { opened = session; return true; });
assert.equal(view.setActive(false), false, "a pending launch rejects Work's deactivation request synchronously");
assert.equal(app.render("a").active, true);
await launch;
assert.equal(app.render("a").setActive(false), true, "a finished launch allows leaving cloud mode");
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

const cache = mount();
cache.render("a"); await flush();
await cache.render("a").load();
cache.advance(599_999);
await cache.render("a").load();
assert.equal(cache.reads.length, 1, "reopening the picker within ten minutes reuses the catalog");
cache.advance(1);
cache.setCatalog(async () => { throw Error("目录读取失败"); });
await cache.render("a").load();
assert.equal(cache.reads.length, 2, "reopening an expired picker refreshes the catalog");
assert.equal(cache.render("a").catalogError, "目录读取失败");
assert.equal(cache.render("a").error, null, "catalog failure is independent of launch errors");
assert.equal(cache.render("a").items[0], item, "failed refresh preserves the previous list");
await cache.render("a").load();
assert.equal(cache.reads.length, 2, "ordinary reopen does not replay a recent catalog failure");
cache.setCatalog(async () => ({ items: [] }));
await cache.render("a").load(true);
assert.equal(cache.reads.length, 3, "explicit retry bypasses a cached failure");
assert.equal(cache.render("a").items.length, 0);
assert.equal(cache.render("a").catalogError, null);
cache.switchIdentity();
cache.render("b"); await flush();
await cache.render("b").load();
assert.equal(cache.reads.length, 4, "identity change never reuses another account's list");

const repos = mount();
repos.render("a"); await flush();
let resolveName;
repos.setRepository(id => id === "repo-a" ? new Promise(resolve => { resolveName = resolve; }) : Promise.reject(Error("not accessible")));
await repos.render("a").load();
assert.deepEqual(repos.repoReads.map(read => read.id), ["repo-a", "repo-b"], "one read per repository ID");
assert.equal(repos.render("a").filterItems(" repo-a ")[0], item, "pending metadata falls back to repository ID");
assert.equal(repos.render("a").filterItems("repo-b")[0], item, "failure keeps repository ID searchable");
repos.setRepository(async () => ({ name: "new/runtime", error: null }));
await repos.render("a").load(true); await flush();
resolveName({ name: "old/runtime", error: null }); await flush();
assert.equal(repos.render("a").filterItems(" NEW/RUNTIME ")[0], item);
assert.equal(repos.render("a").filterItems("old/runtime").length, 0, "a superseded catalog cannot restore old names");
assert.equal(repos.render("a").filterItems("云构建")[0], item);
assert.equal(repos.writes.length, 0);
let resolvePreviousAccount;
repos.setRepository(() => new Promise(resolve => { resolvePreviousAccount = resolve; }));
await repos.render("a").load(true);
repos.switchIdentity();
repos.render("b"); await flush();
assert.equal(repos.repoReads.at(-1).signal.aborted, true);
resolvePreviousAccount({ name: "private/old", error: null }); await flush();
assert.equal(repos.render("b").repositoryNames.size, 0);

console.log("PASS home cloud composer: lazy catalog, ten-minute cache, explicit retry, repository search, stale metadata, isolated text, explicit send, unknown journal, account and navigation invalidation");

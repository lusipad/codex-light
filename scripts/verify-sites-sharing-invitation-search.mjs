import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function harness() {
  let now = 0, serial = 0; const timers = new Map(), calls = [], events = new Map(), listeners = new Set(), writes = [];
  const state = { access: { identity: { accountId: "account", userId: "user", generation: 1 } }, scope: new AbortController().signal,
    context: { workspace: true, workspaceGroupsAllowed: true, teamsAllowed: false, memberId: "self", email: "self@example.invalid", canInviteExternal: true },
    policy: { users: [{ account_user_id: "self", email: "self@example.invalid" }], groups: [] }, canInvite: true, canShowInvites: true,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, async invite(target) { writes.push(target); return true; } };
  const call = (kind, args) => new Promise((resolve, reject) => calls.push({ kind, args, resolve, reject }));
  const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const data = {}; vm.runInNewContext(compile("src/siteSharingInvitationData.ts"), { exports: data });
  const exports = {}; vm.runInNewContext(compile("src/siteSharingInvitationSearch.ts"),
    { exports, AbortController, Date: class extends Date { static now() { return now; } }, setTimeout(fn, delay) { timers.set(++serial, { fn, at: now + delay }); return serial; }, clearTimeout(id) { timers.delete(id); },
      window: { addEventListener(n, fn) { events.set(n, fn); }, removeEventListener(n, fn) { if (events.get(n) === fn) events.delete(n); } },
      require(name) { if (name === "./sitesSharingInvitationsClient") return { searchSiteSharingUsers: (...a) => call("users", a), searchSiteSharingGroups: (...a) => call("groups", a), readSiteSharingTeams: (...a) => call("teams", a) };
        if (name === "./siteSharingInvitationData") return data;
        throw Error(name); } });
  const search = new exports.SiteSharingInvitationSearch(state);
  return { search, state, data, calls, writes, events, timers, listeners, changed() { listeners.forEach(fn => fn()); }, latest(kind) { return calls.filter(c => c.kind === kind).at(-1); },
    async tick(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await flush(); } };
}
const candidate = (kind, id, label = id, source = kind === "user" ? "users" : "groups", email) => ({ kind, target: kind === "email" ? { kind, email: id } : { kind, id }, label, source, ...(email ? { email } : {}) });
let passed = 0; const check = async (name, fn) => { await fn(); passed++; console.log("PASS", name); };
await check("149/150ms debounce uses latest trim and cancels old query without stale result pollution", async () => {
  const h = harness(), s = h.search; s.attach(); s.setFocused(true); s.setQuery(" old "); await h.tick(149); assert.equal(h.calls.length, 0); await h.tick(1); assert.equal(h.latest("users").args[2], "old");
  const old = h.latest("users"); s.setQuery(" new "); assert.equal(old.args[3].aborted, true); await h.tick(150); h.latest("users").resolve([candidate("user", "new", "新用户", "users", "new@example.invalid")]); h.latest("groups").resolve([]); old.resolve([candidate("user", "old", "旧用户", "users", "old@example.invalid")]); await flush(); assert.equal(s.candidates.length, 1); assert.equal(s.candidates[0].target.id, "new"); s.dispose();
});
await check("personal never queries workspace directories; external candidates normalize and exclude self/existing mailbox", async () => {
  const h = harness(), s = h.search; h.state.context.workspace = false; h.state.context.workspaceGroupsAllowed = false; s.attach(); s.setFocused(true); s.setQuery(" Guest@Example.invalid "); await h.tick(150); assert.equal(h.calls.length, 0); assert.equal(s.candidates[0].target.email, "guest@example.invalid");
  h.state.policy.users.push({ email: "GUEST@example.invalid" }); h.changed(); assert.equal(s.candidates.length, 0); s.setQuery("SELF@example.invalid"); assert.equal(s.candidates.length, 0); s.dispose();
});
await check("teams/groups/users order and identities exclude shared, self, missing-email and duplicate groups", async () => {
  const h = harness(), s = h.search; h.state.context.teamsAllowed = true; h.state.policy.groups.push({ id: "shared" }); s.attach(); s.setFocused(true); s.setQuery("团队"); await h.tick(150);
  h.latest("teams").resolve([candidate("group", "team", "团队 A", "teams"), candidate("group", "shared", "团队 B", "teams")]); h.latest("groups").resolve([candidate("group", "team", "团队 A"), candidate("group", "group", "团队 C")]);
  h.latest("users").resolve(h.data.parseSiteSharingUsers({ items: [{ account_user_id: "self", name: "自己", email: "self@example.invalid" }, { account_user_id: "missing", email: null }, { account_user_id: "person", name: "成员", email: "member@example.invalid" }] })); await flush();
  assert.deepEqual(Array.from(s.candidates, c => c.source), ["teams", "groups", "users"]); s.dispose();
});
await check("directory errors stay independent, retry is explicit, outside keeps query and Escape clears it", async () => {
  const h = harness(), s = h.search; s.attach(); s.setFocused(true); s.setQuery("member"); await h.tick(150); h.latest("users").reject(Error("用户读取失败")); h.latest("groups").resolve([candidate("group", "group", "member group")]); await flush();
  assert.ok(s.errors.users); assert.equal(s.errors.groups, null); assert.equal(s.candidates.length, 1); s.setFocused(false); assert.equal(s.query, "member"); assert.equal(s.open, false); s.setFocused(true); s.retry("users"); assert.equal(h.calls.filter(c => c.kind === "users").length, 2); s.close(); assert.equal(s.query, ""); assert.equal(s.open, false); s.dispose();
});
await check("selection clears input before one viewer invite and rejects stale or repeated candidates", async () => {
  const h = harness(), s = h.search; h.state.context.workspace = false; h.state.context.workspaceGroupsAllowed = false; s.attach(); s.setFocused(true); s.setQuery("guest@example.invalid"); const item = s.candidates[0];
  h.state.invite = async target => { assert.equal(s.query, ""); h.writes.push(target); return true; }; assert.equal(await s.select(item), true); await s.select(item); assert.equal(h.writes.length, 1); s.dispose();
});
await check("rights loss/dispose cancels reads and listeners; late resolve never revives closed scope", async () => {
  const h = harness(), s = h.search; s.attach(); s.setQuery("member"); await h.tick(150); const pending = h.latest("users"); h.state.canInvite = false; h.changed(); assert.equal(pending.args[3].aborted, true); assert.equal(s.open, false);
  s.dispose(); pending.resolve([candidate("user", "late", "late", "users", "late@example.invalid")]); await flush(); assert.equal(s.candidates.length, 0); assert.equal(h.listeners.size, 0); assert.equal(h.events.size, 0); assert.equal(h.timers.size, 0);
});
await check("cached directory reads are scoped to query for one minute and online refresh does not replay invitations", async () => {
  const h = harness(), s = h.search; s.attach(); s.setQuery("member"); await h.tick(150); h.latest("users").resolve([]); h.latest("groups").resolve([]); await flush(); const initial = h.calls.length;
  s.setQuery("other"); s.setQuery(" member "); await h.tick(150); assert.equal(h.calls.length, initial); await h.tick(60000); h.events.get("online")(); await h.tick(150); assert.ok(h.calls.length > initial); assert.equal(h.writes.length, 0); s.dispose();
});
await check("revoking group directory access clears its obsolete error and cannot expose an ineffective retry", async () => {
  const h = harness(), s = h.search; s.attach(); s.setFocused(true); s.setQuery("member"); await h.tick(150); h.latest("groups").reject(Error("failed")); h.latest("users").resolve([]); await flush(); assert.ok(s.errors.groups);
  h.state.context.workspaceGroupsAllowed = false; h.changed(); assert.equal(s.errors.groups, null); assert.equal(s.loading.groups, false); s.retry("groups"); assert.equal(h.calls.filter(c => c.kind === "groups").length, 1); s.dispose();
});
console.log(`PASS ${passed} actual Sites invitation search controller groups; isolated deferred directory boundary, no HTTP`);

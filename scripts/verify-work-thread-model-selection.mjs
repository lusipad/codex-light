import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

assert.ok(fs.existsSync("src/workThreadModelSelection.ts"), "Work native thread model updates need the source controller");
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const contextApi = {};
vm.runInNewContext(compile(fs.readFileSync("src/workThreadContext.ts", "utf8")), { exports: contextApi });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function fixture() {
  let now = 0, serial = 0;
  const timers = new Map(), calls = [], commits = [], permissions = [], pendingRpc = [];
  const scope = { identity: { accountId: "a", userId: "u", generation: 3 }, hostIdentity: "local:host-1" };
  const makeContext = id => ({ scope, threadId: id, serviceName: "codex_work_desktop", originator: "codex_work_desktop",
    model: "native-a", reasoningEffort: "medium", cwd: "C:/project", projectId: "project",
    collaborationMode: { mode: "plan", settings: { model: "native-a", reasoning_effort: "medium", developer_instructions: "keep mode instructions" } } });
  const models = [{ id: "runtime-id-a", model: "native-a", supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "high" }] },
    { id: "runtime-id-b", model: "native-b", supportedReasoningEfforts: ["low", "high"] }];
  const snapshots = new Map(["one", "two"].map(id => [id, { scope, context: makeContext(id), models, policyRevision: 4 }]));
  const config = { permission: {}, permissionGate: null, current: true, ack: undefined, error: null, beforeRead: null };
  const exports = {};
  vm.runInNewContext(compile(fs.readFileSync("src/workThreadModelSelection.ts", "utf8")), { exports, AbortController, Promise,
    setTimeout: (callback, delay) => { const id = ++serial; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout: id => timers.delete(id), require: name => { assert.equal(name, "./workThreadContext"); return contextApi; } });
  const controller = exports.createWorkThreadModelSelectionController({
    read: id => { config.beforeRead?.(); return snapshots.get(id) ?? null; },
    isCurrent: () => config.current,
    preparePermissions: async (input, signal) => { permissions.push({ input, signal }); if (config.permissionGate) await config.permissionGate.promise; return config.permission; },
    update: params => { calls.push(params); if (config.error) return Promise.reject(config.error); if (config.ack !== undefined) return Promise.resolve(config.ack);
      const rpc = deferred(); pendingRpc.push(rpc); return rpc.promise; },
    commit: (snapshot, next) => { const previous = snapshots.get(snapshot.context.threadId); if (!previous || previous.context !== snapshot.context) return false;
      commits.push(next); snapshots.set(next.threadId, { ...previous, context: next }); return true; },
  });
  const advance = async ms => {
    now += ms;
    for (;;) { const due = [...timers].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break;
      timers.delete(due[0]); due[1].callback(); await flush(); }
    await flush();
  };
  return { controller, scope, snapshots, config, calls, commits, permissions, pendingRpc, timers, advance };
}
const selection = (model = "native-b", reasoningEffort = "high") => ({ model, reasoningEffort });
{
  const f = fixture(); const first = f.controller.select("one", selection("native-a", "high"));
  await f.advance(200); assert.equal(f.calls.length, 0);
  const second = f.controller.select("one", selection()); assert.equal(await first, false);
  await f.advance(319); assert.equal(f.calls.length, 0, "320ms is pending coalescing, never simulated success");
  await f.advance(1); assert.equal(f.calls.length, 1); assert.equal(f.commits.length, 0, "no local result before the actual RPC ACK");
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])), { threadId: "one", model: "native-b", effort: "high", multiAgentMode: "explicitRequestOnly" });
  const schema = JSON.parse(fs.readFileSync(".ref/parity/16/desktop-host-r1-20261116-current/work-local-protocol-cli/schema-experimental/v2/ThreadSettingsUpdateParams.json", "utf8"));
  assert.ok(Object.keys(f.calls[0]).every(key => Object.hasOwn(schema.properties, key)));
  for (const key of ["collaborationMode", "serviceTier", "versionId"]) assert.equal(key in f.calls[0], false);
  f.pendingRpc[0].resolve({}); assert.equal(await second, true);
  assert.equal(f.commits[0].model, "native-b"); assert.equal(f.commits[0].reasoningEffort, "high");
  assert.equal(f.commits[0].collaborationMode.mode, "plan"); assert.equal(f.commits[0].collaborationMode.settings.developer_instructions, "keep mode instructions");
}
{
  const f = fixture(); const first = f.controller.select("one", selection("native-a", "high")); await f.advance(320);
  const next = f.controller.select("one", selection()); await f.advance(320); assert.equal(f.calls.length, 1, "same-thread writes are serialized");
  f.pendingRpc[0].resolve({}); assert.equal(await first, true); await flush();
  assert.equal(f.calls.length, 2, "later intent reads the context from the earlier ACK rather than failing on its own prior commit");
  f.pendingRpc[1].resolve({}); assert.equal(await next, true);
}
{
  const f = fixture(); const first = f.controller.select("one", selection()); await f.advance(320);
  const next = f.controller.select("one", selection("native-a", "high")); await f.advance(320);
  f.pendingRpc[0].reject(Error("first rejected")); await assert.rejects(first, /first rejected/); await flush();
  assert.equal(f.calls.length, 2, "a failed write does not strand the next selection"); f.pendingRpc[1].resolve({}); assert.equal(await next, true);
}
for (const retirement of ["notification", "policy", "owner", "host", "thread", "caller"]) {
  const f = fixture(), selecting = f.controller.select("one", selection()); await f.advance(320);
  const current = f.snapshots.get("one");
  if (retirement === "notification") f.snapshots.set("one", { ...current, context: { ...current.context, reasoningEffort: "low" } });
  if (retirement === "policy") f.snapshots.set("one", { ...current, policyRevision: 5 });
  if (retirement === "owner") f.snapshots.set("one", { ...current, scope: { ...current.scope, identity: { ...current.scope.identity, accountId: "other" } } });
  if (retirement === "host") f.snapshots.set("one", { ...current, scope: { ...current.scope, hostIdentity: "host-2" } });
  if (retirement === "thread") f.snapshots.delete("one");
  if (retirement === "caller") f.config.current = false;
  f.pendingRpc[0].resolve({}); assert.equal(await selecting, false, `${retirement} fences late projection`); assert.equal(f.commits.length, 0);
}
for (const value of [false, null]) {
  const f = fixture(); f.config.permission = value; const selecting = f.controller.select("one", selection()); await f.advance(320);
  assert.equal(await selecting, false); assert.equal(f.calls.length, 0, "cancelled/unknown guardian state cannot write model settings");
}
{
  const f = fixture(); f.config.permission = { approvalPolicy: "on-request", approvalsReviewer: "user", permissions: ":workspace" };
  const selecting = f.controller.select("one", selection()); await f.advance(320);
  assert.equal(f.calls[0].permissions, ":workspace"); assert.equal(f.calls[0].approvalsReviewer, "user");
  f.pendingRpc[0].resolve({}); assert.equal(await selecting, true);
}
for (const permission of [{ serviceTier: "fast" }, { versionId: "merged-version" }, { permissions: ":workspace", sandboxPolicy: { type: "readOnly", networkAccess: false } }]) {
  const f = fixture(); f.config.permission = permission;
  const selecting = f.controller.select("one", selection()), rejected = assert.rejects(selecting, /权限/);
  await f.advance(320); await rejected; assert.equal(f.calls.length, 0, "unconfirmed/mixed permission fields cannot become wire overrides");
}
{
  const f = fixture(); f.config.permissionGate = deferred(); const selecting = f.controller.select("one", selection()); await f.advance(320);
  const old = f.snapshots.get("one"); f.snapshots.set("one", { ...old, policyRevision: old.policyRevision + 1 });
  f.config.permissionGate.resolve(); assert.equal(await selecting, false); assert.equal(f.calls.length, 0);
}
for (const requested of [selection("runtime-id-b"), selection("native-b-wm"), selection("native-b", "ultra")]) {
  const f = fixture(); assert.equal(await f.controller.select("one", requested), false); await f.advance(320);
  assert.equal(f.calls.length, 0, "only actual native model and supported effort are selectable");
}
for (const patch of [{ context: null }, { models: [] }, { policyRevision: undefined }]) {
  const f = fixture(); f.snapshots.set("one", { ...f.snapshots.get("one"), ...patch });
  assert.equal(await f.controller.select("one", selection()), false); await f.advance(320); assert.equal(f.calls.length, 0);
}
{
  const f = fixture(); const selecting = f.controller.select("one", selection("native-b", null)); await f.advance(320);
  assert.equal(f.calls[0].effort, null, "explicit default effort is not replaced by a guessed native effort");
  f.pendingRpc[0].resolve({}); assert.equal(await selecting, true); assert.equal(f.commits[0].collaborationMode.settings.reasoning_effort, null);
}
for (const response of [null, false, [], 1, "ok"]) {
  const f = fixture(); const selecting = f.controller.select("one", selection()); await f.advance(320); const rejected = assert.rejects(selecting);
  f.pendingRpc[0].resolve(response); await rejected; assert.equal(f.commits.length, 0, "malformed reply is not an ACK");
}
{
  const f = fixture(); f.config.ack = { futureSetting: { accepted: true }, ackVersion: 2 };
  const selecting = f.controller.select("one", selection()); await f.advance(320);
  assert.equal(await selecting, true, "object ACK schema and source await allow future extra fields"); assert.equal(f.commits.length, 1);
}
{
  const f = fixture(), selecting = f.controller.select("one", selection()); await f.advance(320);
  const rejected = assert.rejects(selecting, error => error.code === -32601);
  f.pendingRpc[0].reject(Object.assign(Error("unsupported"), { code: -32601 })); await rejected; assert.equal(f.commits.length, 0);
}
{
  const f = fixture(), signal = new AbortController(), selecting = f.controller.select("one", selection(), signal.signal);
  signal.abort(); assert.equal(await selecting, false); await f.advance(320); assert.equal(f.calls.length, 0);
  const running = f.controller.select("one", selection()); await f.advance(320); f.controller.dispose(); assert.equal(await running, false);
  f.pendingRpc[0].resolve({}); await flush(); assert.equal(f.commits.length, 0); assert.equal(f.timers.size, 0);
  assert.equal(await f.controller.select("one", selection()), false);
}
{
  const f = fixture(), signal = new AbortController(); f.config.beforeRead = () => signal.abort();
  assert.equal(await f.controller.select("one", selection(), signal.signal), false);
  await f.advance(320); assert.equal(f.calls.length, 0, "cancellation during the caller's initial read cannot be missed before listener registration");
}
{
  const f = fixture(), signal = new AbortController();
  const first = f.controller.select("one", selection(), signal.signal); await f.advance(320); signal.abort(); assert.equal(await first, false);
  const next = f.controller.select("one", selection("native-a", "high")); await f.advance(320);
  assert.equal(f.calls.length, 1, "cancelled in-flight delivery still occupies its serial lane until completion");
  f.pendingRpc[0].resolve({}); await flush(); assert.equal(f.commits.length, 0); assert.equal(f.calls.length, 2);
  f.pendingRpc[1].resolve({}); assert.equal(await next, true);
}
{
  const f = fixture(), one = f.controller.select("one", selection()), two = f.controller.select("two", selection());
  await f.advance(320); assert.equal(f.calls.length, 2, "independent threads do not block each other's writes");
  f.pendingRpc.forEach(rpc => rpc.resolve({})); assert.equal(await one, true); assert.equal(await two, true);
}
console.log("PASS native Work model controller: actual schema wire, 320ms pending merge, per-thread serial ACK/error handling, native model/effort and permission proof, late notification/owner/host/policy fences, cancellation/disposal, no fabricated unsupported success. Offline VM only.");

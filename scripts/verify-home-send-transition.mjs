import assert from "node:assert/strict";
import { mountProjectContext } from "./verify-new-thread-project-context.mjs";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mount(options) {
  const view = mountProjectContext(options);
  view.context.sendStartPendingRef = { current: new Set() };
  return view;
}
const count = (view, method) => view.calls.filter(call => call[0] === method).length;

{
  const start = deferred();
  const view = mount({ start: () => start.promise });
  const first = view.send();
  const duplicate = view.send();
  assert.equal(count(view, "thread/start"), 1, "FT01: first-send reentry must not create another thread");
  assert.equal(view.state.turns.length, 1, "FT01: only one optimistic user turn");
  start.resolve({ thread: { id: "created" } });
  await Promise.all([first, duplicate]);
  assert.equal(count(view, "turn/start"), 1);
}
{
  const turn = deferred(), entered = deferred();
  const view = mount({ turn: () => { entered.resolve(); return turn.promise; } });
  const first = view.send();
  await entered.promise;
  // Simulate React committing the created thread and streaming state before turn/start resolves.
  view.context.activeThreadId = "created";
  view.context.isStreaming = true;
  await view.send();
  assert.equal(count(view, "turn/start"), 1, "FT02: pending start cannot accept another turn");
  assert.equal(count(view, "turn/steer"), 0, "FT02: pending turn ID is not a steerable server turn");
  turn.resolve({ turn: { id: "accepted" } });
  await first;
  assert.equal(view.context.sendStartPendingRef.current.size, 0);
}
{
  let attempt = 0;
  const view = mount({ start: async () => {
    if (++attempt === 1) throw Error("fixture offline");
    return { thread: { id: "created" } };
  } });
  await view.send();
  assert.equal(view.state.promptInput, "hello", "FT03: failed creation retains draft");
  assert.equal(view.state.turns[0].status, "failed");
  await view.send();
  assert.equal(count(view, "thread/start"), 2, "FT03: a manual retry is not locked out");
  assert.equal(count(view, "turn/start"), 1);
}
for (const result of ["reject", "missing-path"]) {
  const view = mount({ worktree: true });
  view.context.tauriInvoke = async () => {
    if (result === "reject") throw Error("fixture worktree denied");
    return {};
  };
  await view.send();
  assert.equal(count(view, "thread/start"), 0, `FT04 ${result}: cannot silently run in source directory`);
  assert.equal(count(view, "turn/start"), 0);
  assert.equal(view.state.promptInput, "hello");
  assert.equal(view.state.turns[0].status, "failed");
  assert.ok(view.state.turns[0].items.some(item => item.text?.includes("执行出错")));
  assert.equal(view.context.sendStartPendingRef.current.size, 0);
}
{
  const old = deferred(), next = deferred(), entered = deferred();
  const view = mount({ start: () => old.promise, turn: () => { entered.resolve(); return next.promise; } });
  const first = view.send();
  view.context.threadRequestRef.current++;
  view.context.activeThreadIdRef.current = "other";
  view.context.activeThreadId = "other";
  view.context.attachedFiles = [{ name: "fixture.txt", path: "D:/fixture.txt", kind: "file" }];
  const second = view.send();
  await entered.promise;
  assert.equal(count(view, "turn/start"), 1, "FT05: new navigation identity can send independently");
  const pendingAttachments = view.context.pendingAttachmentSaveRef.current;
  assert.equal(pendingAttachments.threadId, "other");
  old.reject(Error("fixture old request failed"));
  await first;
  assert.equal(view.context.pendingAttachmentSaveRef.current, pendingAttachments, "FT05: old failure cannot clear the new thread's pending attachments");
  await view.send();
  assert.equal(count(view, "turn/start"), 1, "FT05: old finally cannot unlock the newer request");
  next.resolve({ turn: { id: "other-turn" } });
  await second;
  assert.equal(view.context.sendStartPendingRef.current.size, 0);
}
{
  const turn = deferred();
  const view = mount({ threadId: "existing", turn: () => turn.promise });
  const first = view.send(), duplicate = view.send();
  assert.equal(count(view, "turn/start"), 1, "FT06: existing idle thread sends once before React commits");
  turn.resolve({ turn: { id: "accepted" } });
  await Promise.all([first, duplicate]);
  await view.send();
  assert.equal(count(view, "turn/start"), 2, "FT06: settled request releases its guard");
}
console.log("PASS FT01-FT06 production send transition: single-flight creation/start, failure retry, worktree failure, navigation identity isolation (L2)");

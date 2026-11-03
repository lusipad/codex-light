import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const keys = ["git-commit-instructions", "git-pr-instructions"];
const deferred = () => { let resolve; const promise = new Promise(a => { resolve = a; }); return { promise, resolve }; };
function harness(initial = {}) {
  let slots = [], effects = [], scheduled = [], cursor = 0, changed = false, tree, state, time = 0, timerId = 0, updates = 0;
  const stored = new Map(Object.entries(initial)), calls = [], timers = new Map();
  let transport = async (method, args) => { if (method === "desktop_state_set") stored.set(args.key, args.value); return stored.get(args.key) ?? null; };
  const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { changed = true; updates++; } slots[index] = next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useEffect(callback, deps) { const index = cursor++, old = effects[index]; if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps[i]))) scheduled.push(() => { old?.cleanup?.(); effects[index] = { deps, cleanup: callback() }; }); },
  };
  const window = { setTimeout(callback, delay) { timers.set(++timerId, { callback, due: time + delay }); return timerId; }, clearTimeout(id) { timers.delete(id); } };
  const load = (file, imports) => { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { exports, require: name => name === "react" ? react : name.endsWith(".css") ? {} : imports[name], window }); return exports; };
  const core = load("src/gitPreferences.ts", { "./bridge": { tauriInvoke: (method, args) => { calls.push([method, args]); return transport(method, args); } } });
  const { GitSettings } = load("src/components/GitSettings.tsx", {});
  const nodes = node => node && typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : [];
  const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
  const render = () => { let loops = 0; do { assert.ok(loops++ < 15); cursor = 0; changed = false; state = core.useGitPreferences(); tree = GitSettings({ state }); scheduled.splice(0).forEach(effect => effect()); } while (changed); return tree; };
  const tick = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); render(); };
  return { render, tick, stored, calls, nodes, text, get tree() { return tree; }, get state() { return state; }, get updates() { return updates; },
    field(label) { const found = nodes(tree).find(node => node.type === "textarea" && node.props["aria-label"] === label); assert.ok(found, `textarea ${label}`); return found; },
    change(label, value) { this.field(label).props.onChange({ target: { value } }); render(); },
    save(label) { const section = nodes(tree).find(node => node.props["data-git-instruction"] === label); const button = nodes(section).find(node => node.type === "button"); assert.ok(button, `save ${label}`); button.props.onClick(); render(); },
    setTransport(value) { transport = value; },
    async advance(ms) { time += ms; for (const [id, timer] of [...timers]) if (timer.due <= time) { timers.delete(id); timer.callback(); } await tick(); },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); }, settle: async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); },
  };
}
const h = harness(); h.render(); await h.tick();
assert.equal(h.state.preferences[keys[0]], ""); assert.equal(h.state.preferences[keys[1]], "");
assert.equal(h.field("提交指令").props.rows, 6); assert.equal(h.field("Pull Request 指令").props.rows, 6);
h.change("提交指令", "  exact\nmessage  "); await h.advance(2999); assert.equal(h.calls.filter(call => call[0] === "desktop_state_set").length, 0);
await h.advance(1); assert.equal(h.stored.get(keys[0]), "  exact\nmessage  "); assert.match(h.text(h.tree), /已保存/);
await h.advance(3000); assert.ok(!h.text(h.tree).includes("已保存"));
h.change("Pull Request 指令", "PR instructions"); h.field("Pull Request 指令").props.onKeyDown({ ctrlKey: true, key: "s", nativeEvent: { isComposing: false }, preventDefault() {} }); await h.tick(); assert.equal(h.stored.get(keys[1]), "PR instructions");
const writes = h.calls.filter(call => call[0] === "desktop_state_set").length; await h.advance(3000); assert.equal(h.calls.filter(call => call[0] === "desktop_state_set").length, writes);
h.change("提交指令", ""); h.save("提交指令"); await h.tick(); assert.equal(h.stored.get(keys[0]), "");
const restored = harness(Object.fromEntries(h.stored)); restored.render(); await restored.tick(); assert.equal(restored.field("Pull Request 指令").props.value, "PR instructions"); assert.equal(restored.field("提交指令").props.value, ""); restored.unmount();
h.unmount();
console.log("PASS GIB01/03: production defaults/raw strings/empty values, six rows, exact 3000ms debounce, saved feedback lifetime and immediate Ctrl+S without duplicate write");

const concurrent = harness(); concurrent.render(); await concurrent.tick();
const first = deferred(); let firstWrite = true;
concurrent.setTransport(async (method, args) => { if (method === "desktop_state_set") { if (args.key === keys[0] && firstWrite) { firstWrite = false; await first.promise; } concurrent.stored.set(args.key, args.value); } return concurrent.stored.get(args.key) ?? null; });
concurrent.change("提交指令", "old draft"); concurrent.save("提交指令");
concurrent.change("Pull Request 指令", "other field"); concurrent.save("Pull Request 指令"); await concurrent.tick(); assert.equal(concurrent.stored.get(keys[1]), "other field");
concurrent.change("提交指令", "new draft"); concurrent.save("提交指令"); await concurrent.tick(); assert.equal(concurrent.field("提交指令").props.value, "new draft");
first.resolve(); await concurrent.tick(); assert.equal(concurrent.stored.get(keys[0]), "new draft"); assert.equal(concurrent.field("提交指令").props.value, "new draft"); concurrent.unmount();
console.log("PASS GIB02/04: two instruction keys save independently, same-key newer draft queues after the older write and remains visible");

const failure = harness(); failure.render(); await failure.tick(); failure.setTransport(async () => { throw Error("disk failed"); });
failure.change("提交指令", "keep draft"); failure.save("提交指令"); await failure.tick(); assert.equal(failure.field("提交指令").props.value, "keep draft"); assert.ok(!failure.text(failure.tree).includes("已保存"));
failure.setTransport(async (method, args) => { if (method === "desktop_state_set") failure.stored.set(args.key, args.value); return failure.stored.get(args.key) ?? null; });
failure.save("提交指令"); await failure.tick(); assert.equal(failure.stored.get(keys[0]), "keep draft"); failure.unmount();
const leaving = harness(); leaving.render(); await leaving.tick(); leaving.change("提交指令", "flush commit"); leaving.change("Pull Request 指令", "flush PR"); leaving.unmount(); const old = leaving.updates; await leaving.settle();
assert.equal(leaving.stored.get(keys[0]), "flush commit"); assert.equal(leaving.stored.get(keys[1]), "flush PR"); assert.equal(leaving.updates, old);
console.log("PASS GIB05: failure retains editable draft and allows real retry; unmount flushes both fields and never updates disposed React state");

const composing = harness(); composing.render(); await composing.tick(); composing.change("提交指令", "IME draft");
composing.field("提交指令").props.onKeyDown({ ctrlKey: true, key: "s", nativeEvent: { isComposing: true }, preventDefault() { throw Error("composition must not trigger save shortcut"); } }); await composing.tick();
assert.equal(composing.calls.filter(call => call[0] === "desktop_state_set").length, 0);
assert.equal(await composing.state.save(keys[0], 42), false); assert.equal(composing.calls.filter(call => call[0] === "desktop_state_set").length, 0);
const initialRead = deferred(), late = harness(); late.setTransport(async () => initialRead.promise); late.render();
late.change("提交指令", "new local draft"); initialRead.resolve("older saved value"); await late.tick(); assert.equal(late.field("提交指令").props.value, "new local draft");
assert.equal(late.calls.filter(call => call[0] === "desktop_state_set").length, 0); late.unmount(); await late.settle(); composing.unmount(); await composing.settle();
console.log("PASS GIB06: IME Ctrl+S does not flush, malformed types never write, initial late storage reads cannot overwrite a newer local draft");

const mismatch = harness(); mismatch.render(); await mismatch.tick(); let badRead = true;
mismatch.setTransport(async (method, args) => { if (method === "desktop_state_set") mismatch.stored.set(args.key, args.value); return badRead ? "not the saved draft" : mismatch.stored.get(args.key) ?? null; });
mismatch.change("Pull Request 指令", "readback required"); mismatch.save("Pull Request 指令"); await mismatch.tick();
assert.ok(!mismatch.text(mismatch.tree).includes("已保存")); assert.equal(mismatch.field("Pull Request 指令").props.value, "readback required");
const attempts = mismatch.calls.filter(call => call[0] === "desktop_state_set").length; await mismatch.advance(6000); assert.equal(mismatch.calls.filter(call => call[0] === "desktop_state_set").length, attempts, "failed save does not automatically loop");
badRead = false; mismatch.save("Pull Request 指令"); await mismatch.tick(); assert.match(mismatch.text(mismatch.tree), /已保存/); mismatch.unmount();

const revert = harness(); revert.render(); await revert.tick(); const delayed = deferred(); let firstRevert = true;
revert.setTransport(async (method, args) => { if (method === "desktop_state_set") { if (firstRevert) { firstRevert = false; await delayed.promise; } revert.stored.set(args.key, args.value); } return revert.stored.get(args.key) ?? null; });
revert.change("提交指令", "in flight"); revert.save("提交指令"); revert.change("提交指令", ""); await revert.advance(3000); delayed.resolve(); await revert.tick(); assert.equal(revert.stored.get(keys[0]), ""); assert.equal(revert.field("提交指令").props.value, ""); revert.unmount();
console.log("PASS GIB07: readback mismatch never reports saved or loops, explicit retry verifies; reverting to old saved text during a pending write is preserved and queued");
const separateReadiness = harness(); separateReadiness.render(); await separateReadiness.tick(); separateReadiness.change("提交指令", "do not lose after toggle failure");
separateReadiness.setTransport(async (method, args) => { if (args.key === "git-always-force-push") throw Error("toggle failed"); if (method === "desktop_state_set") separateReadiness.stored.set(args.key, args.value); return separateReadiness.stored.get(args.key) ?? null; });
assert.equal(await separateReadiness.state.save("git-always-force-push", true), false); separateReadiness.render(); assert.equal(separateReadiness.state.ready, false);
separateReadiness.unmount(); await separateReadiness.settle(); assert.equal(separateReadiness.stored.get(keys[0]), "do not lose after toggle failure");
console.log("PASS GIB08: unrelated toggle failure retains strict Git-operation readiness while independently loaded instruction drafts still flush on leaving");

const superseded = harness(); superseded.render(); await superseded.tick(); const failOld = deferred();
superseded.setTransport(async (method, args) => { if (method === "desktop_state_set") { if (args.value === "old") { await failOld.promise; throw Error("old write failed"); } superseded.stored.set(args.key, args.value); } return superseded.stored.get(args.key) ?? null; });
superseded.change("提交指令", "old"); superseded.save("提交指令"); superseded.change("提交指令", "new"); await superseded.advance(3000); failOld.resolve(); await superseded.tick();
assert.equal(superseded.stored.get(keys[0]), "new"); assert.equal(superseded.state.error, null, "a superseded same-key failure cannot pollute the newer successful save"); superseded.unmount();
const otherError = harness(); otherError.render(); await otherError.tick();
otherError.setTransport(async (method, args) => { if (method === "desktop_state_set") { if (args.key === keys[1]) throw Error("PR write failed"); otherError.stored.set(args.key, args.value); } return otherError.stored.get(args.key) ?? null; });
otherError.change("Pull Request 指令", "failed PR"); otherError.save("Pull Request 指令"); await otherError.tick();
otherError.change("提交指令", "successful commit"); otherError.save("提交指令"); await otherError.tick(); assert.match(otherError.state.error, /PR write failed/, "successful save of another key must retain the unrelated error"); otherError.unmount(); await otherError.settle();
console.log("PASS GIB09: superseded same-key failure has no stale error ownership while a different key's real failure survives unrelated successful saves");

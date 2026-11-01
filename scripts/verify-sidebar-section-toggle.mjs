import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { mount } from "./verify-sidebar-projects.mjs";

// Production component + protocol wrapper; only the RPC response is controlled.
// This does not prove native activation, service persistence or official parity.
const all = node => node && typeof node === "object" ? [node, ...node.children.flatMap(all)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "string" ? node : "";
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const sections = [{ id: "s-a", name: "Section A" }, { id: "s-b", name: "Section B" }];

async function scenario(initialSection, availableSections = sections) {
  const requests = [], notices = [], refreshed = [];
  let complete;
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/threadSections.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports: module.exports,
    require: name => {
      assert.equal(name, "./bridge");
      return { callAppServer: async (method, params) => {
        if (method === "threadSection/list") return { data: availableSections, nextCursor: null };
        assert.equal(method, "thread/section/move");
        requests.push(JSON.parse(JSON.stringify(params)));
        return new Promise((resolve, reject) => { complete = { resolve, reject }; });
      } };
    },
  });
  const view = mount({
    threads: [{ id: "a1", name: "Alpha thread", cwd: "D:/parity/alpha", section: initialSection }],
    onThreadsChanged: () => refreshed.push(true),
    onShowToast: (...args) => notices.push(args),
  }, new Map(), false, module.exports);
  view.render(); await flush(); view.render();
  const menu = () => all(view.render()).find(n => n.props.role === "menu" && n.props["aria-label"] === "会话操作");
  const submenu = () => all(view.render()).find(n => n.props.role === "menu" && n.props["aria-label"] === "分区");
  const item = label => all(label.startsWith("Section ") || label === "新建分区…" ? submenu() : menu()).find(n => n.type === "button" &&
    (label.startsWith("Section ") ? text(n) === label : text(n).includes(label)));
  const open = () => {
    const row = all(view.render()).find(n => n.props["data-thread-id"] === "a1");
    view.element(row).focus();
    row.props.onContextMenu({
      currentTarget: view.element(row), target: view.element(row), clientX: 100, clientY: 100,
      preventDefault() {}, stopPropagation() {},
    });
    const move = item("移至分区");
    assert.ok(move, "the move submenu label must match the official Chinese locale");
    assert.equal(text(move), "移至分区", "parent item has no current-section name badge");
    move.props.onClick();
    assert.ok(submenu(), "section destinations render in their own menu surface");
    assert.equal(text(menu()).includes("Section A"), false, "section rows do not expand inline in the root menu");
    return submenu();
  };
  const select = label => item(label).props.onClick();
  const checked = label => item(label).props["aria-checked"];
  return { view, open, menu, submenu, item, select, checked, requests, notices, refreshed, complete: () => complete };
}

// Start with the behavior assertion so the pre-fix run proves the wrong RPC.
const current = await scenario("s-a");
current.open(); current.select("Section A"); await flush();
assert.deepEqual(current.requests, [{ threadId: "a1", sectionId: null, beforeThreadId: null }], "selecting the current section must remove membership");
assert.equal(current.menu(), undefined, "selection closes the menu");
current.open();
assert.equal(current.checked("Section A"), true, "pending request keeps confirmed membership");
assert.equal(current.refreshed.length, 0);
current.complete().resolve({}); await flush();
current.open();
assert.equal(current.checked("Section A"), false);
assert.equal(current.checked("Section B"), false);
assert.equal(current.refreshed.length, 1);
assert.match(current.notices[0][0], /已移出分区/);
assert.deepEqual(current.view.calls, [], "membership operation must not navigate the thread");
current.view.unmount();

for (const fail of [false, true]) {
  const other = await scenario("s-a");
  other.open();
  assert.equal(other.item("移出分区"), undefined, "official submenu removes membership by selecting the checked section");
  assert.equal(text(all(other.view.render()).find(n => n.props.role === "menu" && n.props["aria-label"] === "分区")).indexOf("Section A") <
    text(all(other.view.render()).find(n => n.props.role === "menu" && n.props["aria-label"] === "分区")).indexOf("新建分区…"), true);
  assert.equal(other.item("Section A").props.role, "menuitemcheckbox");
  assert.equal(other.checked("Section A"), true);
  assert.equal(text(other.item("Section A")), "Section A", "official section child label has no folder emoji or textual current badge");
  assert.ok(all(other.item("Section A")).some(n => n.type === "CheckIcon"), "checked section uses a check indicator");
  assert.equal(other.checked("Section B"), false);
  other.select("Section B"); await flush();
  assert.deepEqual(other.requests, [{ threadId: "a1", sectionId: "s-b", beforeThreadId: null }]);
  other.open(); assert.equal(other.checked("Section A"), true);
  if (fail) other.complete().reject(new Error("test move rejected"));
  else other.complete().resolve({});
  await flush(); other.open();
  assert.equal(other.checked("Section A"), fail);
  assert.equal(other.checked("Section B"), !fail);
  assert.equal(other.refreshed.length, fail ? 0 : 1);
  if (fail) assert.deepEqual(other.notices, [["移动聊天到分区失败：test move rejected", "error"]]);
  assert.deepEqual(other.view.calls, []);
  other.view.unmount();
}

const roundtrip = await scenario(null);
for (const expected of ["s-a", null]) {
  roundtrip.open(); roundtrip.select("Section A"); await flush();
  assert.equal(roundtrip.requests.at(-1).sectionId, expected);
  roundtrip.complete().resolve({}); await flush();
  roundtrip.open(); assert.equal(roundtrip.checked("Section A"), expected === "s-a");
}
assert.equal(roundtrip.requests.length, 2);
roundtrip.view.unmount();
const rejectedRemoval = await scenario("s-a");
rejectedRemoval.open(); rejectedRemoval.select("Section A"); await flush();
rejectedRemoval.complete().reject(new Error("test removal rejected")); await flush();
rejectedRemoval.open();
assert.equal(rejectedRemoval.checked("Section A"), true);
assert.equal(rejectedRemoval.refreshed.length, 0);
assert.deepEqual(rejectedRemoval.notices, [["移动聊天到分区失败：test removal rejected", "error"]]);
rejectedRemoval.view.unmount();
const cold = await scenario(sections[0]);
cold.open();
assert.equal(cold.checked("Section A"), true, "cold thread/list section object must restore checked membership");
cold.select("Section A"); await flush();
assert.deepEqual(cold.requests, [{ threadId: "a1", sectionId: null, beforeThreadId: null }]);
cold.complete().resolve({}); await flush();
cold.open(); assert.equal(cold.checked("Section A"), false);
cold.view.unmount();
const noSections = await scenario(null, []);
noSections.open();
assert.equal(noSections.item("新建分区…").props.role, "menuitem", "when no sections exist, the submenu contains only the create action");
assert.equal(noSections.item("Section A"), undefined);
assert.equal(noSections.item("移出分区"), undefined);
assert.equal(text(noSections.submenu()).includes("还没有分区"), false);
noSections.view.unmount();
console.log("PASS actual sidebar section toggle + RPC: exact parent label, current removal, other destination, no separate remove row, empty-section submenu, checked/keyboard, pending/success/failure, roundtrip (L2 only)");

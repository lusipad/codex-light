import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(fs.readFileSync("src/components/WorktreeInventory.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const removal = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/worktreeRemoval.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: removal, require: () => ({}) });
function mount() {
  const slots = [], effects = [], calls = [], opened = [];
  let cursor = 0, tree, changes = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; changes++; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(callback) { effects.push(callback); },
  };
  const request = (kind, signal) => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    calls.push({ kind, signal, resolve, reject });
    return promise;
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, AbortController, require(name) {
    if (name === "react") return react;
    if (name === "lucide-react") return { ChevronDown: "ChevronDown", RefreshCw: "RefreshCw" };
    if (name === "../bridge") return { tauriInvoke: command => { assert.equal(command, "worktree_policy_inventory"); return request("inventory"); } };
    if (name === "../fsClient") return { baseNameFsPath: path => path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "" };
    if (name === "../worktreeRemoval") return { ...removal, loadWorktreeConversations: signal => request("chats", signal) };
    if (name.endsWith(".css")) return {};
    throw Error(name);
  } });
  const props = { workspaceRoots: ["c:/managed/registered/subfolder"], onOpenThread: id => opened.push(id) };
  function render() { cursor = 0; tree = exports.WorktreeInventory(props); return tree; }
  const walk = node => node && typeof node === "object" ? [node, ...node.children.flatMap(walk)] : [];
  const text = node => typeof node === "string" || typeof node === "number" ? String(node) : (node?.children ?? []).map(text).join("");
  render();
  const cleanup = effects[0]();
  return { calls, props, opened, render, unmount: cleanup, get changes() { return changes; },
    nodes: predicate => walk(render()).filter(predicate), text: () => text(render()), nodeText: text,
    refresh: () => walk(render()).find(node => node.props["aria-label"] === "刷新").props.onClick(),
  };
}
const tick = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };
const records = [
  { path: "C:/managed/a", repoPath: "C:/repos/first" },
  { path: "C:/managed/b", repoPath: "C:/repos/second" },
  { path: "C:/managed/registered", repoPath: "C:/repos/first" },
];
const chat = (id, cwd, recency = 0, isPinned = false) => ({ id, cwd, recency, isPinned, title: id === "untitled" ? "" : id });
{
  const page = mount();
  assert.match(page.text(), /正在获取工作树详细信息/);
  page.refresh(); assert.equal(page.calls.length, 1);
  page.calls[0].resolve({ records, errors: [{ path: "C:/blocked", message: "denied" }] }); await tick();
  page.calls[1].resolve([chat("first-chat", "C:/managed/a/child", 3), chat("untitled", "C:/managed/b", 7, true),
    chat("other", "C:/managed/b/child", 5), chat("unrelated", "C:/managed/ab", 99)]);
  await tick();
  const groups = page.nodes(node => node.props.className === "worktree-inventory-group");
  assert.equal(groups.length, 2);
  assert.match(page.nodeText(groups[0]), /second/);
  assert.match(page.nodeText(groups[1]), /first/);
  assert.doesNotMatch(page.text(), /registered|unrelated/);
  assert.match(page.text(), /无标题对话.*另有 1 个聊天/);
  assert.match(page.text(), /已置顶.*无法删除/);
  assert.match(page.text(), /部分工作树无法读取.*denied/);
  page.nodes(node => node.type === "button" && page.nodeText(node) === "无标题对话")[0].props.onClick();
  assert.deepEqual(page.opened, ["untitled"]);
  page.nodes(node => node.type === "button" && page.nodeText(node) === "other")[0].props.onClick();
  assert.deepEqual(page.opened, ["untitled", "other"]);
  page.refresh();
  assert.doesNotMatch(page.text(), /first-chat|无标题对话/, "refresh withdraws old chat metadata");
  page.calls.at(-1).reject(Error("inventory offline")); await tick();
  assert.match(page.text(), /无法加载工作树.*inventory offline/);
  assert.equal(page.nodes(node => node.props.className === "worktree-inventory-row").length, 2, "previous inventory remains available");
  page.refresh(); page.calls.at(-1).resolve({ records: [records[0]], errors: [] }); await tick();
  page.calls.at(-1).reject(Error("chat offline")); await tick();
  assert.match(page.text(), /无法读取关联聊天.*chat offline/);
  assert.match(page.text(), /C:\/managed\/a/);
  page.refresh(); page.calls.at(-1).resolve({ records: [], errors: [] }); await tick();
  assert.match(page.text(), /尚无工作树/);
  page.unmount();
}
for (const stage of ["inventory", "chats"]) {
  const page = mount();
  if (stage === "chats") { page.calls[0].resolve({ records, errors: [] }); await tick(); }
  const current = page.calls.at(-1);
  page.unmount();
  const before = page.changes;
  current.resolve(stage === "inventory" ? { records, errors: [] } : []);
  await tick();
  assert.equal(page.changes, before);
  if (stage === "inventory") assert.equal(page.calls.length, 1, "late inventory cannot start chat reads");
  else assert.equal(current.signal.aborted, true);
}
console.log("PASS managed inventory production JSX: repository order, path boundaries, registered roots, chat IDs/pins, partial errors, retry, single flight and unmount");

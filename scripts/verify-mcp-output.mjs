import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

export function mountMcp(initial) {
  let item = initial, state = false;
  const document = { activeElement: null };
  const React = {
    createElement(type, props, ...children) {
      if (typeof type === "function") return type(props);
      return { type, props: props ?? {}, children: children.flat(Infinity) };
    },
    useState: () => [state, value => { state = value; }],
    useRef: () => ({ current: null }),
    useEffect() {},
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/McpCallCard.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, {
    exports: module.exports,
    document,
    require(name) {
      if (name === "react") return React;
      if (name === "./Icons") return { CloseIcon: () => null, SparklesIcon: () => null };
      if (name.endsWith(".css")) return {};
      throw Error(name);
    },
  });
  return { render: () => module.exports.McpCallCard({ item }), update: next => { item = next; }, document };
}
const nodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
const text = node => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : "";
const rawTrigger = tree => nodes(tree).find(node => node.props["aria-label"] === "显示原始工具调用输出");
const dialog = tree => nodes(tree).find(node => node.type === "dialog");
const raw = tree => nodes(tree).find(node => node.props["aria-label"] === "原始工具调用 JSON");
const sample = { id: "mcp-a", type: "mcpToolCall", server: "fs", tool: "read", arguments: { path: "example.txt" }, durationMs: 42, status: "completed", result: { content: [{ type: "text", text: "result marker" }], _meta: { marker: "metadata" } } };
const view = mountMcp(sample);
assert.equal(dialog(view.render()), undefined, "MC01: raw dialog is not mounted until opened");
rawTrigger(view.render()).props.onClick();
assert.equal(dialog(view.render()).props["aria-label"], "原始 fs.read 工具调用输出");
let payload = JSON.parse(text(raw(view.render())));
assert.equal(payload.callId, "mcp-a");
assert.equal(payload.invocation.arguments.path, "example.txt");
assert.equal(payload.durationMs, 42);
assert.equal(payload.result.raw._meta.marker, "metadata", "MC02: raw metadata is preserved");
view.update({ ...sample, result: { content: [{ type: "text", text: "updated" }] } });
assert.match(text(raw(view.render())), /updated/, "MC03: open dialog follows actual item updates");
assert.equal(dialog(mountMcp({ ...sample, id: "other" }).render()), undefined, "MC03: dialog state is isolated");
let stopped = false, prevented = false;
dialog(view.render()).props.onKeyDown({ key: "Escape", nativeEvent: { isComposing: true }, stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
assert.ok(dialog(view.render()), "MC04: composition Escape must not close the dialog");
dialog(view.render()).props.onKeyDown({ key: "Escape", nativeEvent: {}, stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
assert.equal(dialog(view.render()), undefined);
assert.ok(stopped && prevented);
rawTrigger(view.render()).props.onClick();
const focusTargets = [
  { focus() { view.document.activeElement = this; } },
  { focus() { view.document.activeElement = this; } },
];
for (const [shiftKey, from, to] of [[false, 1, 0], [true, 0, 1]]) {
  view.document.activeElement = focusTargets[from];
  dialog(view.render()).props.onKeyDown({
    key: "Tab", shiftKey, nativeEvent: {}, stopPropagation() {}, preventDefault() {},
    currentTarget: { querySelectorAll: () => focusTargets },
  });
  assert.equal(view.document.activeElement, focusTargets[to], "MC04: Tab and Shift+Tab wrap inside the modal");
}
for (const item of [
  { ...sample, status: "failed", result: { content: [{ type: "text", text: "tool error" }] } },
  { ...sample, error: { message: "protocol error" } },
  { ...sample, server: "codex_apps", result: { content: [], structuredContent: { content: [], isError: true, meta: null, structuredContent: null } } },
]) {
  const tree = mountMcp(item).render();
  assert.equal(text(nodes(tree).find(node => node.props.className === "mcp-call-status status-failed")), "失败", "MC05: tool errors cannot show completion");
}
assert.match(text(mountMcp({ ...sample, result: { content: [] } }).render()), /工具未返回任何内容/);
assert.doesNotMatch(text(mountMcp({ ...sample, status: "inProgress", result: null }).render()), /工具未返回任何内容/, "MC06: running is not empty completion");
console.log("PASS MC01–MC06 production MCP raw output: lazy dialog, actual payload/update, isolation, Escape, errors and empty state; focus requires browser verification");

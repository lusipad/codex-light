import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true };
const app = fs.readFileSync("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let commandMap;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "renderCommand") commandMap = node.initializer;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(commandMap, "Exercise the production App command-card wiring");
const nodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
const textOf = node => node && typeof node === "object" ? node.children.map(textOf).join("") : typeof node === "string" || typeof node === "number" ? String(node) : "";
function mount(initial, turnStatus = "completed") {
  let cursor = 0, item = initial;
  const turn = { status: turnStatus };
  const hooks = [];
  const React = {
    createElement(type, props, ...children) {
      if (typeof type === "function") return type(props);
      return { type, props: props ?? {}, children: children.flat(Infinity) };
    },
    useId: () => "command-body",
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], update => { hooks[index] = typeof update === "function" ? update(hooks[index]) : update; }];
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/CommandExecutionCard.tsx", "utf8"), { compilerOptions: options }).outputText, {
    exports: module.exports,
    require(name) {
      if (name === "react") return React;
      if (name === "./Icons") return { TerminalIcon: () => null, ChevronDownIcon: () => null, CheckIcon: () => null };
      throw Error(name);
    },
  });
  const renderItem = vm.runInNewContext(ts.transpileModule(`(${commandMap.getText(ast)})`, { compilerOptions: options }).outputText, {
    React, CommandExecutionCard: module.exports.CommandExecutionCard, turn,
  });
  return {
    render() { cursor = 0; return renderItem(item, 0); },
    update(next) { item = next; },
    updateTurnStatus(status) { turn.status = status; },
  };
}
const header = tree => nodes(tree).find(node => node.type === "button" && node.props.className === "command-exec-header");
const output = tree => nodes(tree).find(node => node.props.className === "command-exec-body");
const footer = tree => nodes(tree).find(node => node.props.className === "command-exec-footer");
const view = mount({ id: "a", type: "commandExecution", command: "npm test", status: "inProgress", aggregatedOutput: "marker-output", output: "stale" }, "inProgress");
assert.ok(header(view.render()), "EC01: the production command summary must be a real button");
assert.equal(header(view.render()).props["aria-expanded"], false);
assert.equal(output(view.render()), undefined, "EC01: collapsed output is unmounted");
header(view.render()).props.onClick();
assert.equal(header(view.render()).props["aria-expanded"], true);
assert.equal(textOf(output(view.render())), "marker-output");
assert.equal(footer(view.render()), undefined, "EC03: running commands cannot show success/exit footer");
view.update({ id: "a", type: "commandExecution", command: "npm test", status: "inProgress", aggregatedOutput: "", output: "stale" });
assert.equal(output(view.render()), undefined, "EC02: an authoritative empty output must suppress stale fallback output");
view.update({ id: "a", type: "commandExecution", command: "npm test", status: "completed", exitCode: 0, aggregatedOutput: "final" });
assert.equal(textOf(footer(view.render())), "成功", "EC04: success requires actual exitCode zero");
assert.equal(textOf(output(view.render())), "final", "EC02: stream updates preserve expansion and authoritative output");
header(view.render()).props.onClick();
assert.equal(output(view.render()), undefined);
assert.equal(header(view.render()).props["aria-expanded"], false);
for (const [status, exitCode, expected] of [
  ["completed", 1, "退出码 1"], ["failed", 2, "退出码 2"], ["failed", null, "退出码 未知"],
  ["declined", null, "退出码 未知"], ["completed", null, "退出码 未知"],
]) {
  const sample = mount({ type: "commandExecution", command: "task", status, exitCode });
  header(sample.render()).props.onClick();
  assert.equal(textOf(footer(sample.render())), expected, `EC05–EC07: ${status}/${exitCode}`);
}
const stopped = mount({ type: "commandExecution", command: "task", status: "inProgress", exitCode: null }, "interrupted");
assert.match(textOf(header(stopped.render())), /已停止命令/);
header(stopped.render()).props.onClick();
assert.equal(textOf(footer(stopped.render())), "已停止", "EC06: interrupted turn adapts unfinished command to stopped");
const resumed = mount({ type: "commandExecution", command: "task", status: "inProgress", exitCode: null }, "running");
assert.match(textOf(header(resumed.render())), /正在运行命令/);
resumed.updateTurnStatus("interrupted");
assert.match(textOf(header(resumed.render())), /已停止命令/, "EC06: turn interruption updates an unfinished command");
const other = mount({ id: "b", type: "commandExecution", command: "other", status: "completed", aggregatedOutput: "second" });
assert.equal(header(other.render()).props["aria-expanded"], false, "EC08: a different command has independent expansion");
{
  const findSource = fs.readFileSync("src/components/ThreadFindBar.tsx", "utf8");
  const findAst = ts.createSourceFile("ThreadFindBar.tsx", findSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let scroll;
  function visitFind(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(findAst) === "scrollToMatch") scroll = node.initializer.arguments[0];
    ts.forEachChild(node, visitFind);
  }
  visitFind(findAst);
  const actions = [];
  const context = {
    matchesRef: { current: [{ elementId: "command-cmd-a" }] },
    highlightTimerRef: { current: null }, lastHighlightedElementRef: { current: null },
    clearTimeout() {}, setTimeout: () => 1,
    document: { getElementById: id => ({
      querySelector(selector) {
        if (selector.includes("data-command-expand")) return { click: () => actions.push(`expand:${id}`) };
        return null;
      },
      scrollIntoView: () => actions.push("scroll"), classList: { add() {}, remove() {} },
    }) },
  };
  vm.runInNewContext(ts.transpileModule(`(${scroll.getText(findAst)})`, { compilerOptions: options }).outputText, context)(0);
  assert.deepEqual(actions, ["expand:command-cmd-a", "scroll"], "searching hidden command output expands its card before scrolling");
}
console.log("PASS EC01–EC08 production command cards: real button, collapsed default, toggle, stream updates, exact exit results, interruption and independent state");

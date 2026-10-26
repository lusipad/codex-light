import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
// Exercise the actual components without adding a test runtime dependency.
for (const ext of [".ts", ".tsx"]) {
  Module._extensions[ext] = (module, filename) => {
    const result = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    module._compile(result.outputText, filename);
  };
}
Module._extensions[".css"] = () => {};
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { MarkdownView } = require(fileURLToPath(new URL("../src/components/MarkdownView.tsx", import.meta.url)));
const { findThreadMatches } = require(fileURLToPath(new URL("../src/components/ThreadFindBar.tsx", import.meta.url)));
const render = (content, props = {}) => renderToStaticMarkup(createElement(MarkdownView, { content, ...props }));
const cases = [
  ["streaming unclosed fence stays code", () => assert.match(render("```ts\nconst x = 1;"), /<pre[^>]*>/)],
  ["four backticks protect inner fence", () => {
    const html = render("````text\n```ts\nhello\n```\n````\nend");
    assert.equal((html.match(/<pre\b/g) || []).length, 1);
    assert.match(html.replace(/<[^>]*>/g, ""), /```ts/);
    assert.match(html, /<p[^>]*>end<\/p>/);
  }],
  ["tilde fence", () => assert.match(render("~~~python\nprint(1)\n~~~"), /<pre[^>]*>/)],
  ["inline backticks do not start a block", () => assert.doesNotMatch(render("Use ```inline``` here"), /<pre\b/)],
  ["shorter closing fence stays inside code", () => {
    const html = render("````text\none\n```\ntwo");
    assert.equal((html.match(/<pre\b/g) || []).length, 1);
    assert.match(html.replace(/<[^>]*>/g, ""), /one\n```\ntwo/);
  }],
  ["longer closing fence ends code", () => assert.match(render("~~~text\nhello\n~~~~\nend"), /<p[^>]*>end<\/p>/)],
  ["indented CRLF fence", () => assert.match(render("  ```js\r\n  hello\r\n  ```"), /<pre[^>]*><code>hello<\/code><\/pre>/)],
  ["closing fence must occupy its line", () => {
    const html = render("```text\nhello ``` world\n```");
    assert.match(html.replace(/<[^>]*>/g, ""), /hello ``` world/);
  }],
  ["malformed file encoding cannot crash message", () => assert.doesNotThrow(() => render("[file](file:///tmp/100%bad.ts)", { onOpenFile() {} }))],
  ["unsafe links remain inert", () => assert.doesNotMatch(render("[bad](javascript:alert)", { onOpenFile() {} }), /href=/)],
  ["raw HTML remains escaped", () => assert.doesNotMatch(render('<img src=x onerror="alert(1)">'), /<img\b/)],
  ["normal table and fenced code survive", () => {
    const html = render("| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst x = 1;\n```");
    assert.match(html, /<table\b/); assert.match(html, /<pre\b/);
  }],
  ["structured user content is searchable", () => {
    const matches = findThreadMatches([{ id: "t", items: [{ type: "userMessage", content: [{ type: "text", text: "查询中文 marker" }] }] }], "中文");
    assert.equal(matches.length, 1); assert.equal(matches[0].elementId, "turn-user-t");
  }],
  ["structured content does not create object matches", () => assert.equal(findThreadMatches([{ id: "t", items: [{ type: "userMessage", content: [{ type: "text", text: "hello" }] }] }], "object").length, 0)],
  ["assistant multipart content is searchable", () => assert.equal(findThreadMatches([{ id: "t", items: [{ type: "assistant", parts: [{ text: "needle" }] }] }], "NEEDLE").length, 1)],
  ["command output remains searchable beside command", () => assert.equal(findThreadMatches([{ id: "t", items: [{ type: "commandExecution", command: ["npm", "test"], aggregatedOutput: "all tests passed" }] }], "tests passed").length, 1)],
  ["empty queries and absent matches", () => {
    assert.deepEqual(findThreadMatches([], " "), []);
    assert.deepEqual(findThreadMatches([{ id: "t", items: [{ type: "agentMessage", text: "hello" }] }], "missing"), []);
  }],
];
let failed = 0;
for (const [name, run] of cases) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message.split("\n")[0]}`); }
}
console.log(`Thread content: ${cases.length - failed}/${cases.length} cases passed`);
process.exitCode = failed ? 1 : 0;

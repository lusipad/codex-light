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
  ["RC01 user Markdown keeps structure and heading levels", () => {
    const html = render("# 标题\n\n**加粗** 和 `代码`\n\n- 条目\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```", { variant: "user-message" });
    for (const tag of ["h1", "strong", "code", "ul", "table", "pre"]) assert.match(html, new RegExp(`<${tag}\\b`));
    assert.match(html, /markdown-body-user-message/);
  }],
  ["RC02 user soft lines share a paragraph, blank lines separate paragraphs", () => {
    const html = render("第一行\n第二行\n\n另一段", { variant: "user-message" });
    assert.match(html, /<p class="md-p">第一行\n第二行<\/p><p class="md-p">另一段<\/p>/);
    assert.equal((html.match(/<p\b/g) || []).length, 2);
  }],
  ["RC03 user Markdown images become links while assistant images remain images", () => {
    const content = "![示例](https://example.com/image.png)";
    const html = render(content, { variant: "user-message" });
    assert.doesNotMatch(html, /<img\b/);
    assert.match(html, /!<a[^>]*href="https:\/\/example.com\/image.png"/);
    assert.match(render(content), /<img\b/);
    assert.doesNotMatch(render("![bad](javascript:alert)", { variant: "user-message" }), /href=/);
  }],
  ["RC04 composer links use existing file preview callback", () => {
    const html = render("[源文件](codex-text-link://src/App.tsx)", { variant: "user-message", onOpenFile() {} });
    assert.match(html, /<button[^>]*class="inline-file-link"/);
    assert.doesNotMatch(html, /codex-text-link/);
  }],
  ["RC07 plain long prompts retain every line in Markdown DOM", () => {
    const text = Array.from({ length: 40 }, (_, i) => `line-${i}`).join("\n");
    assert.match(render(text, { variant: "user-message" }), new RegExp(text));
  }],
  ["RC08 user code never offers terminal execution", () => {
    const props = { onRunCommand() {} };
    const content = "```sh\necho hello\n```";
    assert.doesNotMatch(render(content, { ...props, variant: "user-message" }), /在内置终端中运行/);
    assert.match(render(content, props), /在内置终端中运行/);
  }],
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

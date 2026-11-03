import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = fs.readFileSync("src/reviewFindings.ts", "utf8");
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports });
const context = { threadId: "thread-a", turnId: "turn-a", cwd: "C:/Work/repo", workspaceRoots: ["C:/Work/repo", "C:/Work/repo/nested", "D:/Other/lib"] };
const directive = (file, extra = "") => `::code-comment{title="Issue" body="Actual defect" file="${file}" ${extra}}`;
const parse = (text, ctx = context) => exports.parseReviewFindings(text, ctx);
{
 const result = parse(directive("c:\\WORK\\repo\\nested\\src\\app.ts", 'start="4.9" end="2" priority="1.9"'));
 assert.equal(result.comments.length, 1);
 const comment = result.comments[0];
 assert.equal(comment.rootPath, "C:/Work/repo/nested");
 assert.equal(comment.file, "src/app.ts");
 assert.equal(comment.absolutePath, "C:/Work/repo/nested/src/app.ts");
 assert.equal(comment.startLine, 4); assert.equal(comment.endLine, 4);
 assert.equal(comment.title, "[P1] Issue"); assert.equal(comment.side, "right");
 assert.equal(comment.threadId, "thread-a"); assert.equal(comment.turnId, "turn-a");
}
assert.equal(parse(directive("repo/src/a.ts")).comments[0].file, "src/a.ts");
assert.equal(parse(directive("lib/src/a.ts")).comments[0].rootPath, "D:/Other/lib");
assert.equal(parse(directive("src/a.ts")).comments[0].startLine, 1);
assert.equal(parse(directive("src/a.ts", 'start="-2" end="abc"')).comments[0].endLine, 1);
assert.equal(parse('::code-comment{title="[P2] Already" body="body" file="src/a.ts" priority="1"}').comments[0].title, "[P2] Already");
{
 const a = directive("src/a.ts");
 assert.equal(parse(`${a}\n${a}`).comments.length, 1);
 assert.equal(parse(`${a}\n${directive("src/a.ts", 'start="2"')}`).comments.length, 2);
 assert.equal(parse(a).comments[0].id, parse(a, { ...context, turnId: "turn-b" }).comments[0].id);
 assert.equal(parse(a).comments[0].id, parse(directive("C:/WORK/REPO/SRC/A.TS")).comments[0].id);
 assert.notEqual(parse(a).comments[0].id, parse(a, { ...context, threadId: "thread-b" }).comments[0].id);
}
assert.equal(parse('```md\n' + directive("src/a.ts") + '\n```\n' + directive("src/b.ts")).comments.length, 1);
assert.equal(parse('~~~\n' + directive("src/a.ts") + '\n~~~').comments.length, 0);
assert.equal(parse('    ' + directive("src/a.ts")).comments.length, 0);
assert.equal(parse('Example ' + directive("src/a.ts")).comments.length, 0);
assert.equal(parse('::code-comment{title="" body="body" file="src/a.ts"}\n::code-comment{title="bad" body="unterminated file="x"}').comments.length, 0);
assert.equal(parse(directive("C:/outside/a.ts")).unresolved.length, 1);
assert.equal(parse(directive("../outside/a.ts")).unresolved.length, 1);
assert.equal(parse(directive("C:/Work/repo-other/a.ts")).unresolved.length, 1);
assert.equal(parse(directive("src/a.ts"), { ...context, cwd: null, workspaceRoots: [] }).unresolved.length, 1);
const prompt = exports.buildQuickReviewPrompt("Review staged and unstaged changes", "security");
// SHA-256 of the independently extracted official M guidelines, trimmed UTF-8.
// Keep the raw chunk in local 14B research evidence; clean checkouts need no .ref tree.
const guidelines = prompt.slice("## Code review guidelines:\n".length).split("\nReview staged and unstaged changes\n## My request:\n")[0];
assert.equal(createHash("sha256").update(guidelines).digest("hex"), "6fcd7f8c0936b27ab7be0fef736d97a385995eb4da5bee70f4e6d54c6c5d7186");
assert(prompt.startsWith("## Code review guidelines:\n# Review Guidelines\n"));
assert(prompt.includes("\n## My request:\nsecurity"));
assert(prompt.includes("## Repository Rule Attribution"));
assert(prompt.includes("If there are no actionable issues, say that directly and briefly."));
assert(prompt.includes("Review staged and unstaged changes")); assert(prompt.includes("security"));
assert(exports.isQuickReviewPrompt(prompt)); assert(!exports.isQuickReviewPrompt("Please review this code"));
console.log("Review findings production checks passed: numeric defaults, path identity, fences, invalid items, unresolved and complete prompt");

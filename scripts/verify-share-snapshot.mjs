import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/shareSnapshot.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports, Map, Set });
const { buildShareSnapshot, collectShareAssetCandidates, SHARED_IMAGE_UNAVAILABLE: missing } = exports;
const json = value => JSON.parse(JSON.stringify(value));
const assets = new Map([["local.png", "codex:shared-asset/asset-1"], ["chart.html", "codex:shared-asset/chart"]]);
const thread = { id: "private-id", name: "Demo", cwd: "C:\\work\\repo", turns: [{
  id: "turn", startedAt: 10, completedAt: 12, items: [
    { type: "userMessage", content: [{ type: "text", text: "# Files mentioned by the user:\nprivate.txt\n## My request:\n  hello  " },
      { type: "localImage", path: "local.png" }, { type: "image", url: "unknown.png" }] },
    { type: "agentMessage", phase: "commentary", text: "Working" },
    { type: "agentMessage", phase: "final_answer", text: "![image](local.png)\n\n::notice{secret=\"private\"}\n::codex-inline-vis{path=\"chart.html\" title=\"Chart\" mode=\"expanded\" expandable=\"true\" unknown=\"drop\"}" },
    { type: "reasoning", summary: ["Plan", "Details"] },
    { type: "fileChange", status: "completed", changes: [
      { path: "C:\\work\\repo\\src\\x.ts", kind: { type: "update" }, diff: "diff --git a/x b/x\r\nindex 123..456\r\n--- a/x\r\n+++ b/x\r\n@@ -1 +1 @@\r\n-old\r\n+new" },
      { path: "D:\\private\\secret.txt", kind: { type: "add" }, diff: "line one\nline two" },
      { path: "C:\\Users\\x\\.codex\\visualizations\\2026\\11\\03\\session\\chart.html", kind: { type: "add" }, diff: "private html" },
    ] },
    { type: "fileChange", status: "declined", changes: [{ path: "hidden", diff: "hidden", kind: { type: "add" } }] },
    { type: "commandExecution", command: "PRIVATE_COMMAND", aggregatedOutput: "PRIVATE_OUTPUT" },
    { type: "imageView", path: "missing.png" },
    { type: "imageGeneration", status: "completed", result: "https://example.com/generated.png" },
  ],
}, { id: "empty", items: [{ type: "agentMessage", text: "no phase" }] }] };
const snapshot = json(buildShareSnapshot(thread, assets, [{ asset_id: "asset-1", width: 20, height: 10 }]));
assert.deepEqual(snapshot, { version: 1, title: "Demo", assets: { "asset-1": { width: 20, height: 10 } }, turns: [{
  durationMs: 2000, items: [
    { type: "userMessage", content: [{ type: "text", text: "hello" }, { type: "image", url: assets.get("local.png") }, { type: "image", url: missing }] },
    { type: "agentMessage", phase: "commentary", text: "Working" },
    { type: "agentMessage", text: "![image](codex:shared-asset/asset-1)\n\n\n::codex-inline-vis{file=\"chart.html\" asset=\"codex:shared-asset/chart\" title=\"Chart\" mode=\"expanded\" expandable=\"true\"}" },
    { type: "reasoning", summary: "**Plan**\n\nDetails" },
    { type: "fileChange", status: "completed", changes: [{ path: "src/x.ts", diff: "@@ -1 +1 @@\n-old\n+new" }, { path: "secret.txt", diff: "+line one\n+line two" }] },
    { type: "imageView", url: missing },
    { type: "imageGeneration", status: "completed", result: missing },
  ],
}] });
assert.ok(!JSON.stringify(snapshot).includes("private-id"));
assert.ok(!JSON.stringify(snapshot).includes("PRIVATE_"));
const buildText = text => buildShareSnapshot({ turns: [{ items: [{ type: "agentMessage", phase: "final_answer", text }] }] }, assets).turns[0]?.items[0]?.text;
assert.equal(buildText("![one][PIC]\n\n[pic]: local.png"), "![one](codex:shared-asset/asset-1)");
assert.equal(buildText("![one][pic]\n[link][pic]\n\n[pic]: local.png"), "![one](codex:shared-asset/asset-1)\n[link][pic]\n\n[pic]: local.png");
assert.equal(buildText("`![code](private.png)` ![real](missing.png)"), "`![code](private.png)` ![real](codex:shared-image-unavailable)");
assert.equal(buildText("```\n![code](private.png)\n```\n![real](local.png)"), "```\n![code](private.png)\n```\n![real](codex:shared-asset/asset-1)");
assert.equal(buildText("![nested](https://example.com/a(b).png \"Title\")"), "![nested](codex:shared-image-unavailable \"Title\")");
assert.equal(buildText("\\![escaped](private.png)"), "\\![escaped](private.png)");
assert.equal(buildText("::codex-inline-vis{path=\"missing.html\"}"), undefined);
assert.equal(buildText("::codex-inline-vis{path=\"chart.html\"}"), "::codex-inline-vis{file=\"chart.html\" asset=\"codex:shared-asset/chart\"}");
assert.equal(buildText("::notice"), undefined);
assert.equal(buildText("::codex-inline-vis{file=\"chart.html\" expandable}"), "::codex-inline-vis{file=\"chart.html\" asset=\"codex:shared-asset/chart\" expandable=\"true\"}");
assert.throws(() => buildText("visualizechart.html"), /legacy/i);
assert.throws(() => buildText(":::notice\nbody\n:::"), /container/i);
assert.throws(() => buildText("![nested [label]](private.png)"), /nested/i);
assert.throws(() => buildText("![ref][id]\n\n[id]:\n  private.png"), /reference definition/i);
const wrapper = "<codex_delegation>\n<source_thread_id>private-source</source_thread_id>\n<input>&lt;hello&gt; &amp; ok</input>\n</codex_delegation>";
const delegated = buildShareSnapshot({ turns: [{ items: [{ type: "functionCallOutput", namespace: "codex_app", name: "handoff_thread", output: wrapper }] }] }, assets);
assert.equal(delegated.turns[0].items[0].content[0].text, "<codex_delegation>\n  <source_thread_id></source_thread_id>\n  <input>&lt;hello&gt; &amp; ok</input>\n</codex_delegation>");
assert.equal(buildShareSnapshot({ turns: [{ items: [{ type: "functionCallOutput", namespace: "other", name: "handoff_thread", output: wrapper }] }] }, assets).turns.length, 0);
assert.equal(buildShareSnapshot({ turns: [{ durationMs: 50, items: [{ type: "agentMessage", phase: "final_answer", text: "done" }] }] }, assets).turns[0].durationMs, undefined);
assert.equal(buildShareSnapshot({ turns: [{ durationMs: -1, items: [{ type: "reasoning", summary: ["thinking"] }] }] }, assets).turns[0].durationMs, undefined);
assert.equal(buildShareSnapshot({ turns: [{ items: [{ type: "imageView", path: "local.png" }] }] }, new Map([["local.png", "data:image/png;base64,AAA"]])).turns[0].items[0].url, missing);
const generated = { turns: [{ items: [{ type: "imageGeneration", status: "completed", savedPath: "C:\\images\\made.png", result: "fallback" }] }] };
assert.equal(collectShareAssetCandidates(generated)[0].source, "/C:/images/made.png");
assert.equal(buildShareSnapshot(generated, new Map([["/C:/images/made.png", "codex:shared-asset/generated"]])).turns[0].items[0].result, "codex:shared-asset/generated");
const candidates = json(collectShareAssetCandidates(thread));
assert.ok(candidates.some(x => x.kind === "image" && x.source === "local.png"));
assert.ok(candidates.some(x => x.kind === "visualization" && x.source === "chart.html"));
assert.equal(candidates.filter(x => x.source === "local.png").length, 1);
assert.equal(JSON.stringify(candidates).includes("private.txt"), false);
assert.throws(() => buildShareSnapshot({ turns: [] }, assets, [{ asset_id: "../bad", width: 1, height: 1 }]), /asset/i);
assert.throws(() => buildShareSnapshot({ turns: [] }, assets, [{ asset_id: "ok", width: 0, height: 1 }]), /dimension/i);
console.log("Share snapshot: whitelist, path/diff, input cleanup, delegation, assets, Markdown, directives and duration passed.");

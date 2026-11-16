import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

let slots = [], cursor = 0, effects = [], scheduled = [], tree;
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
  useEffect(callback, deps) { const index = cursor++, old = effects[index]; if (!old || deps.some((value, i) => value !== old.deps[i])) scheduled.push(() => { old?.cleanup?.(); effects[index] = { deps, cleanup: callback() }; }); },
};
const output = ts.transpileModule(fs.readFileSync("src/components/PluginDirectoryIncluded.tsx", "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const exports = {};
const displayExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/recommendedSkills.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: displayExports, require: () => ({}) });
vm.runInNewContext(output, { exports, require(name) {
  if (name === "react") return react;
  if (name === "lucide-react") return { BookOpen: "BookOpen", Plug: "Plug", Workflow: "Workflow", Boxes: "Boxes" };
  if (name.endsWith("SkillPreviewDialog")) return { SkillPreviewDialog: "SkillPreviewDialog" };
  if (name.endsWith("recommendedSkills")) return displayExports;
  if (name.endsWith(".css")) return {};
  throw new Error(`Unexpected import ${name}`);
} });
const { resolveIncludedSkill: match, PluginDirectoryIncluded: Component } = exports;
const installed = (name, path) => ({ name, path, scope: "user", description: "Actual", enabled: true });
const exact = installed("pack:analyze", "/skills/a"), normalized = installed("Pack:Read_File", "/skills/b");
assert.equal(match({ name: "wrong", path: "/skills/a" }, "pack", [exact]), exact);
assert.equal(match({ name: "analyze" }, " pack ", [exact]), exact);
assert.equal(match({ name: "pack:analyze" }, "pack", [exact, installed("pack:analyze", "/last")]).path, "/last", "exact map uses latest entry like source");
assert.equal(match({ name: "pack:read-file" }, "pack", [normalized]), normalized);
assert.equal(match({ name: "analyze", path: "/missing" }, "pack", [exact]), null, "path-bearing names are not prefixed");
assert.equal(match({ name: "analyze", path: "/missing" }, "pack", [installed("analyze", "/other")]).path, "/other");
assert.equal(match({ name: "Read File" }, "pack", [normalized, installed("pack:read-file", "/c")]), null, "ambiguous normalized name is unavailable");
assert.equal(match({ name: "Read File" }, "", [normalized]), null);
assert.equal(match({ name: "unrelated", path: "/SKILLS/a" }, "pack", [exact]), null, "paths are compared exactly, without guessed normalization");
assert.equal(match({ name: "read" }, "pack", null), null);
assert.equal(match({ name: "read", interface: { displayName: "pack:analyze" } }, "pack", [exact]), null, "display name is never identity");
const skill = { name: "analyze", path: "/skills/a", description: "Analyze", enabled: true };
const detail = { marketplaceName: "actual-market", summary: { id: "pack@market", name: "pack", installed: false, enabled: true, source: { type: "local" } },
  apps: [{ id: "app", name: "Real App", description: "App description" }], mcpServers: ["real-mcp"], skills: [skill], hooks: [{ key: "hook", eventName: "Stop" }] };
const calls = [];
let props = { detail, installedSkills: null, connectionIdentity: "one", workspaceRoot: "/workspace",
  loadSkillContents: async (item, actual) => { calls.push(["read", item.name, actual?.path]); return "real text"; },
  onOpenMcpSettings: () => calls.push("mcp"), onOpenHooksSettings: () => calls.push("hooks"),
  onToggleSkill: item => calls.push(["toggle", item.path]), onTrySkill: item => { calls.push(["try", item.path]); return true; },
};
const render = () => { cursor = 0; tree = Component(props); for (const run of scheduled.splice(0)) run(); return tree; };
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...(node.children || []).flatMap(nodes)];
const all = () => nodes(tree);
const find = predicate => all().find(predicate);
render();
assert.deepEqual(all().filter(node => node.type === "h2").map(node => node.children[0]), ["应用", "MCP 服务器", "技能", "钩子"]);
for (const section of all().filter(node => node.type === "section" && ["MCP 服务器", "钩子"].includes(node.props["aria-label"]))) {
  nodes(section).find(node => node.type === "button").props.onClick();
}
assert.deepEqual(calls, ["mcp", "hooks"], "settings controls only invoke actual navigation callbacks");
assert.equal(all().some(node => node.props.role === "switch"), false, "unread inventory is not installed");
const previewTrigger = find(node => node.type === "button" && node.props["data-skill-preview"] !== undefined);
assert.ok(previewTrigger); previewTrigger.props.onClick(); render();
let preview = find(node => node.type === "SkillPreviewDialog");
assert.ok(preview); assert.equal(preview.props.onToggle, undefined); assert.equal(preview.props.onTry, undefined);
assert.equal(await preview.props.loadContents(), "real text");
assert.deepEqual(calls.at(-1), ["read", "analyze", undefined]);
props = { ...props, installedSkills: [exact], detail: { ...detail, summary: { ...detail.summary, installed: true } } }; render();
preview = find(node => node.type === "SkillPreviewDialog");
assert.ok(preview.props.onToggle); preview.props.onToggle(); assert.deepEqual(calls.at(-1), ["toggle", "/skills/a"]);
assert.ok(preview.props.onTry); assert.equal(await preview.props.onTry(), true);
props = { ...props, detail: { ...props.detail, skills: [{ name: "missing", enabled: true }, skill] } }; render();
assert.deepEqual(all().filter(node => node.props["data-skill-preview"] !== undefined).map(node => node.props["data-skill-preview"]), ["analyze", "missing"], "installed precedes unavailable like source");
props = { ...props, detail: { ...props.detail, skills: [skill] } }; render();
props = { ...props, connectionIdentity: "two" }; render();
assert.equal(find(node => node.type === "SkillPreviewDialog"), undefined, "old account preview hidden before effect clears state");
props = { ...props, detail: { ...props.detail, summary: { ...props.detail.summary, availability: "DISABLED_BY_ADMIN" } } }; render();
assert.equal(find(node => node.props["data-skill-preview"] !== undefined).props.disabled, true);
assert.equal(all().some(node => node.props.role === "switch"), false, "admin restriction blocks skill writes");
props = { ...props, detail: { ...detail, skills: [{ name: "remote", enabled: true, description: "Remote" }] }, installedSkills: [], loadSkillContents: undefined }; render();
assert.equal(find(node => node.props["data-skill-preview"] !== undefined).props.disabled, true, "no path or loader must not invent content");
props = { ...props, detail: { ...props.detail, summary: { ...detail.summary, source: { type: "remote" }, remotePluginId: "raw-id" } }, loadSkillContents: async () => "remote text" }; render();
assert.equal(find(node => node.props["data-skill-preview"] !== undefined).props.disabled, false, "known remote identity supports real loader without path");
find(node => node.props["data-skill-preview"] !== undefined).props.onClick(); render();
assert.equal(find(node => node.type === "SkillPreviewDialog").props.localHost, false);
assert.equal(all().some(node => node.children.includes("已连接") || node.children.includes("全部信任")), false);
props = { ...props, detail: { ...detail, summary: { ...detail.summary, installed: true, enabled: false } }, installedSkills: [{ ...exact, enabled: false }] }; render();
find(node => node.props["data-skill-preview"] !== undefined).props.onClick(); render();
preview = find(node => node.type === "SkillPreviewDialog");
assert.equal(preview.props.enabled, false, "enabled uses installed readback instead of detail skills enabled");
assert.equal(preview.props.onTry, undefined, "disabled installed skills cannot be tried");
props = { ...props, workspaceRoot: "/other-workspace" }; render();
assert.equal(find(node => node.type === "SkillPreviewDialog"), undefined, "workspace change removes prior preview");
props = { ...props, detail: { ...detail, apps: [], skills: [], hooks: [], mcpServers: [] } }; render();
assert.equal(all().filter(node => node.type === "h2").length, 0, "empty sections stay hidden");
console.log("PASS plugin included source order, exact skill ownership, ambiguity, readonly preview, admin restriction and identity reset");

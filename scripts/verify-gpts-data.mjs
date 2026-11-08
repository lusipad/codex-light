import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = process.env.GPTS_DATA_SOURCE || "src/gptsData.ts";
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(source, "utf8"), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText, { exports });
const d = exports;
const plain = value => JSON.parse(JSON.stringify(value));
const resource = (id, extra = {}) => ({ gizmo: { id, gizmo_type: "gpt", display: {
  name: id, description: "description", profile_picture_url: " https://fixture.invalid/avatar.png ",
}, author: { display_name: " Author ", user_id: "creator" }, tags: [], ...extra },
tools: [{ type: "browser" }], future: { preserved: true } });
const cut = (items, cursor = null, info = {}) => ({ info: { id: "popular", title: "Popular", ...info },
  list: { items: items.map(resource => ({ resource })), cursor } });
let failed = 0, passed = 0;
function check(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}
check("title trims before ID fallback; resource identity and unknown detail fields survive", () => {
  const raw = resource("a", { display: { name: "   " } });
  const item = d.parseGptSection(cut([raw])).items[0];
  assert.equal(item.name, "a"); assert.equal(item.raw, raw);
  assert.equal(item.raw.future.preserved, true);
  assert.equal(item.author, "Author"); assert.equal(item.authorId, "creator");
});
check("actual display avatar and vanity usage are trimmed; unrelated fallbacks are not invented", () => {
  const raw = resource("a", { vanity_metrics: { num_conversations_str: " 10K+ " } });
  const item = d.parseGptSection(cut([raw])).items[0];
  assert.equal(item.avatarUrl, "https://fixture.invalid/avatar.png"); assert.equal(item.usage, "10K+");
  assert.equal(d.parseGptSection(cut([resource("b", { author: { name: "unsupported alias" } })])).items[0].author, undefined);
});
check("published nonprivate GPT links use the official encoded short URL or ID", () => {
  const link = fields => d.gptPublicLink(d.parseGptResource(resource("g-fixture", fields)));
  assert.equal(link({ live_version: 2, share_recipient: "public", short_url: " g-x/测试 " }),
    "https://chatgpt.com/g/g-x%2F%E6%B5%8B%E8%AF%95");
  assert.equal(link({ live_version: 2, share_recipient: "link", short_url: " " }), "https://chatgpt.com/g/g-fixture");
  for (const fields of [{ live_version: 0, share_recipient: "public" }, { live_version: 2, share_recipient: "private" },
    { live_version: 2 }, { share_recipient: "public" }]) assert.equal(link(fields), null);
});
check("snorlax filtering preserves raw page size and true-empty distinction", () => {
  const filtered = d.parseGptSection(cut([resource("s", { gizmo_type: "snorlax" })], "next"));
  assert.equal(filtered.items.length, 0); assert.equal(filtered.rawItemCount, 1);
  assert.equal(d.parseGptSection(cut([], "next")).rawItemCount, 0);
});
check("discovery retains actual locale, groups, descriptions and display types", () => {
  const result = d.parseGptDiscovery({ cuts: [cut([resource("a")], null, {
    display_group: "Writing", display_type: "featured", description: "Section description", locale: "zh-CN",
  })], locale: "en-US", workspace_filtered: true });
  assert.equal(result.locale, "en-US"); assert.equal(result.workspaceFiltered, true);
  assert.equal(result.sections[0].displayGroup, "Writing"); assert.equal(result.sections[0].displayType, "featured");
  assert.equal(result.sections[0].description, "Section description"); assert.equal(result.sections[0].locale, "zh-CN");
});
check("discovery retains cursor-only cuts and removes fully filtered terminal cuts", () => {
  const result = d.parseGptDiscovery({ cuts: [cut([], "next"), cut([resource("s", { gizmo_type: "snorlax" })])] });
  assert.equal(result.sections.length, 1); assert.equal(result.sections[0].cursor, "next");
});
check("restriction precedence follows source; owner exception requires confirmed allow_specific", () => {
  const tags = ["workspace_disabled", "openai_gpt_workspace_disabled", "fedramp_incompatible", "interactions_disabled"];
  assert.equal(d.gptRestriction(tags), "interactions_disabled");
  assert.equal(d.gptRestriction(tags.slice(0, 3)), "fedramp_incompatible");
  assert.equal(d.gptRestriction(tags.slice(0, 2)), "openai_gpt_workspace_disabled");
  assert.equal(d.gptRestriction(["workspace_disabled"], { isWorkspaceOwner: true }), "workspace_disabled");
  assert.equal(d.gptRestriction(["workspace_disabled"], { isWorkspaceOwner: true, allowThirdPartyGpts: "allow_specific" }), null);
  assert.equal(d.gptRestriction(["interactions_disabled"], { isWorkspaceOwner: true, allowThirdPartyGpts: "allow_specific" }), "interactions_disabled");
});
check("search consumes resources rather than discovery wrappers and preserves raw counts", () => {
  const page = d.parseGptSearch({ items: [resource("a"), resource("s", { gizmo_type: "snorlax" })], cursor: "p2" });
  assert.equal(page.id, "search"); assert.equal(page.rawItemCount, 2);
  assert.deepEqual(plain(page.items.map(item => item.id)), ["a"]);
});
check("pagination rejects category changes, keeps stable order and does not mutate sources", () => {
  const first = d.parseGptSection(cut([resource("a"), resource("b")], "p2"));
  const next = d.parseGptSection(cut([resource("b", { display: { name: "updated" } }), resource("c")]));
  const merged = d.appendGptPage(first, next);
  assert.deepEqual(plain(merged.items.map(item => item.id)), ["a", "b", "c"]);
  assert.equal(first.items[1].name, "b"); assert.equal(merged.items[1].name, "updated");
  assert.equal(merged.cursor, null);
  assert.throws(() => d.appendGptPage(first, { ...next, id: "other" }));
});
check("actual resource-level tools map and deduplicate equivalent image generation types", () => {
  const raw = resource("a"); raw.tools = [{ type: "browser" }, { type: "image_gen" }, { type: "dalle" },
    { type: "memory" }, { type: "connector" }, { type: "retrieval" }, { type: "future" }];
  assert.deepEqual(plain(d.parseGptResource(raw).tools.map(tool => tool.type)), ["browser", "image_gen", "memory", "connector"]);
  assert.equal(d.parseGptResource({ ...raw, tools: [] }).tools.length, 0);
});
check("about renders only actual supported blocks, retains raw data, and invents no ratings", () => {
  const blocks = [{ type: "generic_title_subtitle", title: "10K", subtitle: "Conversations" },
    { type: "rating", avg: 4.6, count_str: "100+" }, { type: "category", category_str: "Writing", category_ranking: 2 },
    { type: "unknown", rating: 5 }];
  const parsed = d.parseGptAbout({ about_blocks: blocks });
  assert.equal(parsed.length, 3); assert.equal(parsed[0].raw, blocks[0]);
  assert.equal(parsed[1].avg, 4.6); assert.equal(parsed[2].categoryRanking, 2);
  assert.deepEqual(plain(d.parseGptAbout({ about_blocks: [] })), []);
});
check("malformed consumed fields fail visibly rather than yielding corrupt UI or false empty", () => {
  for (const value of [null, { cuts: null }, { cuts: [] , workspace_filtered: "yes" }]) assert.throws(() => d.parseGptDiscovery(value));
  for (const raw of [resource(""), resource("a", { display: { name: {} } }), resource("a", { tags: [2] }),
    { ...resource("a"), tools: "browser" }]) assert.throws(() => d.parseGptResource(raw));
  assert.throws(() => d.parseGptSection(cut([], 3)));
  assert.throws(() => d.parseGptAbout({ about_blocks: [{ type: "rating", avg: "5" }] }));
});
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;

import assert from "node:assert/strict";
import { readyRecommendedSkills, flushRecommendedSkills } from "./verify-recommended-skills-ui.mjs";
const view = await readyRecommendedSkills();
const card = view.nodes(node => node.props.role === "button")[0];
assert.ok(card, "RP01 recommended card must be an accessible preview trigger");
card.props.onClick();
const preview = view.nodes(node => node.tag === "SkillPreviewDialog")[0];
assert.ok(preview, "RP01 card opens the real shared preview");
assert.equal(view.calls.filter(call => call.method === "contents").length, 0, "RP02 parent must not read before the modal requests content");
const pending = preview.props.loadContents();
assert.equal(view.calls.at(-1).method, "contents");
assert.equal(view.calls.at(-1).args[0], "C:/cache/skills/skills/.curated/demo/SKILL.md");
view.calls.at(-1).resolve("# Actual body");
assert.equal(await pending, "# Actual body");
assert.equal(preview.props.showMoreActions, false);
assert.equal(preview.props.onTry, undefined);
assert.equal(preview.props.onUninstall, undefined);
assert.equal(preview.props.onToggle, undefined);
view.unmount();
await flushRecommendedSkills();
console.log("PASS RP01-RP03 real recommended preview trigger, lazy source file and recommendation-only actions");

const click = { stopPropagation() {} };
const getPreview = f => f.nodes(node => node.tag === "SkillPreviewDialog")[0];
const getCard = f => f.nodes(node => node.props.role === "button")[0];
const installed = { key: "actual-path", name: "demo", path: "C:/home/skills/demo/SKILL.md", displayName: "Demo Skill" };
{
  const keys = [], options = { installedSkills: [installed], onInstalledCardKeysChange: value => keys.push(value) };
  const f = await readyRecommendedSkills(options);
  assert.equal(getCard(f), undefined, "RP07 initial installed matches do not remain in recommendations");
  assert.equal(f.nodes(node => node.tag === "installed-card").length, 0, "RP07 initial matches stay in the main installed section");
  assert.deepEqual(Array.from(keys.at(-1)), []);
  f.unmount();
}
{
  const keys = [], counts = [], options = { installedSkills: [], onInstalledCardKeysChange: value => keys.push(value),
    searchQuery: "PDF", activeSearchResultIndex: 0, onSearchResultCountChange: count => counts.push(count) };
  const f = await readyRecommendedSkills(options);
  assert.equal(getCard(f).props["data-skill-search-result"], "true");
  assert.equal(counts.at(-1).count, 1);
  assert.doesNotMatch(f.text(), /刷新推荐目录|推荐目录缓存/, "SL01 results omit browse-only controls and provenance");
  getCard(f).props.onClick();
  const action = getPreview(f).props.footer.children[0].props.onClick;
  action(click); action(click);
  assert.equal(f.writes, 1);
  assert.equal(getPreview(f).props.footer.children[0].children.filter(x=>typeof x === "string").join(""), "安装技能", "RP04 loading retains the official installation label");
  assert.equal(f.calls.at(-1).args[1], null, "RP04 preview uses the official default install root");
  f.calls.at(-1).resolve({ destination: "C:/home/skills/demo" }); await flushRecommendedSkills();
  const calls = f.calls.length;
  action(click);
  assert.equal(f.calls.length, calls, "RP05 copied success blocks repeated writes before discovery returns");
  assert.equal(getPreview(f).props.footer.children[0].props.disabled, true);
  f.calls.at(-1).resolve({ found: false, errors: ["offline"] }); await flushRecommendedSkills();
  assert.match(getPreview(f).props.actionFeedback.text, /发现待确认.*offline/);
  assert.equal(getPreview(f).props.actionFeedback.kind, "error");
  assert.equal(getPreview(f).props.footer.children[0].props.disabled, true);
  options.installedSkills = [installed]; f.render();
  assert.equal(getPreview(f), undefined, "RP06 actual metadata replaces the recommendation preview instance");
  assert.equal(f.nodes(node => node.tag === "installed-card").length, 1);
  assert.equal(f.nodes(node => node.tag === "installed-card")[0].props.active, true, "the mapped card inherits the result selection once");
  assert.equal(f.nodes(node => node.props["data-skill-search-result"] !== undefined).length, 0, "the wrapper must not be an extra keyboard result");
  assert.match(f.text(), /发现待确认.*offline/, "RP08 metadata transition must retain visible discovery failure");
  assert.deepEqual(Array.from(keys.at(-1)), [installed.key], "RP06 parent can remove the duplicate overview card");
  options.installedSkills = []; f.render();
  assert.equal(getPreview(f), undefined, "RP06 removed metadata cannot resurrect an old preview");
  f.unmount();
}
for (const scenario of ["Enter", " ", "composition", "nested"]) {
  const f = await readyRecommendedSkills(), card = getCard(f), target = {};
  let prevented = 0;
  card.props.onKeyDown({ key: scenario === " " ? " " : "Enter", target: scenario === "nested" ? {} : target,
    currentTarget: target, nativeEvent: { isComposing: scenario === "composition" }, keyCode: 0,
    preventDefault() { prevented++; } });
  assert.equal(!!getPreview(f), scenario === "Enter" || scenario === " ");
  assert.equal(prevented, scenario === "Enter" || scenario === " " ? 1 : 0);
  f.unmount();
}
{
  const f = await readyRecommendedSkills(); let stops = 0;
  f.buttons("安装技能")[0].props.onClick({ stopPropagation() { stops++; } });
  assert.equal(stops, 1); assert.equal(getPreview(f), undefined, "RP01 direct installation does not open the preview");
  f.calls.at(-1).reject(Error("refused")); await flushRecommendedSkills(); f.unmount();
}
{
  const f = await readyRecommendedSkills(); getCard(f).props.onClick();
  f.buttons("刷新推荐目录")[0].props.onClick();
  f.calls.at(-1).resolve({ skills: [{ id: "demo", name: "Spreadsheet", description: "", repoPath: "skills/.curated/demo" }], repoRoot: "C:/other-cache", source: "cache", fetchedAt: null, error: null });
  await flushRecommendedSkills();
  const pending = getPreview(f).props.loadContents();
  assert.equal(f.calls.at(-1).args[0], "C:/other-cache/skills/.curated/demo/SKILL.md", "RP02 open preview follows the current official catalog source");
  f.calls.at(-1).resolve(""); assert.equal(await pending, ""); f.unmount();
}
console.log("PASS RP01/RP04-RP09 default-root footer, synchronous write lock, copy/discovery distinction, initial/session mapping, metadata transition, source snapshot and keyboard isolation");

{
  const names = ["playwright", "other-tool", "PDF", "doc", "Imagegen", "sora", "spreadsheet", "pdf", "PDF ", "Pdf"];
  const skills = names.map((name, index) => ({ id: `id-${index}`, name, description: "Shared description", repoPath: `skills/.curated/id-${index}` }));
  const mappedKeys = [];
  const options = { catalog: { skills, repoRoot: "C:/cache", source: "cache", fetchedAt: null, error: null }, searchQuery: " ",
    onInstalledCardKeysChange: keys => mappedKeys.push(Array.from(keys)), installedSkills: [] };
  const f = await readyRecommendedSkills(options);
  const cardKeys = () => f.nodes(node => node.props.role === "button").map(node => node.props.key);
  assert.deepEqual(Array.from(cardKeys()), ["id-4", "id-5", "id-2", "id-7", "id-8", "id-9"],
    "RB01 default browse only shows the official curated order, with a six-item folded limit");
  const expand = () => f.nodes(node => node.tag === "button" && typeof node.props["aria-expanded"] === "boolean")[0];
  assert.equal(expand().props["aria-expanded"], false);
  assert.equal(f.buttons("查看doc, spreadsheet，另有 1 项").length, 1);
  expand().props.onClick();
  assert.deepEqual(Array.from(cardKeys()), ["id-4", "id-5", "id-2", "id-7", "id-8", "id-9", "id-3", "id-6", "id-0"]);
  assert.equal(expand().props["aria-expanded"], true);
  f.nodes(node => node.props.key === "id-0")[0].props.onClick();
  getPreview(f).props.footer.children[0].props.onClick(click);
  f.calls.at(-1).resolve({ destination: "C:/home/skills/playwright" }); await flushRecommendedSkills();
  f.calls.at(-1).resolve({ found: true, errors: [] }); await flushRecommendedSkills();
  options.installedSkills = [{ key: "playwright-path", name: "playwright", path: "C:/home/skills/playwright/SKILL.md" }];
  f.render();
  assert.deepEqual(mappedKeys.at(-1), ["playwright-path"]);
  f.buttons("收起")[0].props.onClick();
  assert.equal(cardKeys().length, 6);
  assert.deepEqual(mappedKeys.at(-1), [], "RB04 a collapsed recommendation must not hide its installed overview card");
  expand().props.onClick();
  assert.deepEqual(mappedKeys.at(-1), ["playwright-path"]);
  options.searchQuery = "  SHARED DESCRIPTION "; f.render();
  const resultKeys = f.nodes(node => node.props.role === "button" || node.props.role === "group").map(node => node.props.key);
  assert.deepEqual(Array.from(resultKeys), skills.map(skill => skill.id), "RB02 search includes non-curated results in catalog order without folding");
  assert.equal(expand(), undefined);
  options.searchQuery = "other-tool"; f.render();
  assert.deepEqual(Array.from(cardKeys()), ["id-1"]);
  assert.deepEqual(mappedKeys.at(-1), []);
  options.searchQuery = ""; f.render();
  assert.equal(cardKeys().length, 6, "RB03 returning from search resets the browse disclosure");
  f.unmount();
  for (const length of [8, 9]) {
    const small = await readyRecommendedSkills({ catalog: { ...options.catalog, skills: skills.slice(0, length) } });
    assert.equal(small.nodes(node => node.props.role === "button").length, length - 1);
    assert.equal(small.nodes(node => node.props["aria-expanded"] !== undefined).length, 0);
    small.unmount();
  }
}
console.log("PASS 13H default curated ranking, full-catalog search and accessible disclosure boundaries");

{
  const reports = [];
  const options = { onSearchResultCountChange: report => reports.push(report) };
  const f = await readyRecommendedSkills(options);
  f.buttons("刷新推荐目录")[0].props.onClick();
  options.searchQuery = "other"; f.render();
  assert.equal(reports.at(-1).query, "other");
  assert.equal(reports.at(-1).count, null);
  assert.match(f.text(), /正在加载技能/);
  f.calls.at(-1).reject(Error("offline")); await flushRecommendedSkills();
  assert.match(f.text(), /无法加载推荐技能.*offline/);
  assert.equal(reports.at(-1).count, null, "SL02 failed recommendations do not claim zero results");
  f.buttons("重试")[0].props.onClick();
  f.calls.at(-1).resolve({ skills: [], repoRoot: "C:/cache", source: "cache", fetchedAt: null, error: null });
  await flushRecommendedSkills();
  assert.equal(reports.at(-1).count, 0);
  assert.doesNotMatch(f.text(), /无法加载|正在加载|推荐目录没有/);
  const reads = f.calls.length;
  options.searchQuery = " "; f.render();
  assert.equal(f.calls.length, reads, "SL03 browsing and search use the same mounted catalog");
  assert.match(f.text(), /刷新推荐目录/);
  f.unmount();
}
console.log("PASS 13J search reports loading, failures, retry and confirmed empty separately");

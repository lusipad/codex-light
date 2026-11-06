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
  const keys = [], options = { installedSkills: [], onInstalledCardKeysChange: value => keys.push(value) };
  const f = await readyRecommendedSkills(options);
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
  f.calls.at(-1).resolve({ skills: [{ id: "demo", name: "Changed", description: "", repoPath: "skills/.curated/demo" }], repoRoot: "C:/other-cache", source: "cache", fetchedAt: null, error: null });
  await flushRecommendedSkills();
  const pending = getPreview(f).props.loadContents();
  assert.equal(f.calls.at(-1).args[0], "C:/other-cache/skills/.curated/demo/SKILL.md", "RP02 open preview follows the current official catalog source");
  f.calls.at(-1).resolve(""); assert.equal(await pending, ""); f.unmount();
}
console.log("PASS RP01/RP04-RP09 default-root footer, synchronous write lock, copy/discovery distinction, initial/session mapping, metadata transition, source snapshot and keyboard isolation");

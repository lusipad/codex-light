import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(fs.readFileSync("src/components/RecommendedSkillsPanel.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;
const helpers = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/recommendedSkills.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: helpers, require: () => ({}) });
const click = { stopPropagation() {} };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const skill = { id: "demo", name: "PDF", description: "Description", repoPath: "skills/.curated/demo" };
const catalog = { skills: [skill], repoRoot: "C:/cache/skills", source: "cache", fetchedAt: null, error: null };
const destination = "C:/home/skills/demo";
function mount(options = {}) {
  const slots = [], effects = [], pendingEffects = [], calls = [];
  let cursor = 0, initial = true, tree, mounted = true, refreshes = 0, writes = 0, finishes = 0, blocked = false;
  const react = {
    createElement: (tag, props, ...children) => ({ tag, props: props ?? {}, children: children.flat(Infinity) }),
    useState(value) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof value === "function" ? value() : value;
      return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; if (mounted) render(); }];
    },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useEffect(effect, deps) {
      const i = cursor++, previous = effects[i];
      if (!previous || !deps || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
        effects[i] = { deps, cleanup: previous?.cleanup };
        pendingEffects.push(() => { previous?.cleanup?.(); effects[i].cleanup = effect(); });
      }
    },
  };
  const exports = {};
  const request = (method, ...args) => { const pending = deferred(); calls.push({ method, args, ...pending }); return pending.promise; };
  vm.runInNewContext(compiled, { exports,
    require(name) {
      if (name === "react") return { ...react, default: react };
      if (name === "lucide-react") return { Loader2: "Loader2" };
      if (name === "./SkillPreviewDialog") return { SkillPreviewDialog: "SkillPreviewDialog" };
      if (name === "../fsClient") return { readFileText: path => request("contents", path) };
      if (name === "../recommendedSkills") return { ...helpers,
        readRecommendedSkills: refresh => request("read", refresh),
        installRecommendedSkill: (item, root) => request("install", item, root),
        verifyRecommendedSkillDiscovery: (path, root) => request("discovery", path, root),
      };
      throw Error(name);
    },
  });
  function render() {
    cursor = 0;
    tree = exports.RecommendedSkillsPanel({
      installedSkills: options.installedSkills ?? [], renderInstalledSkill: key => ({tag:"installed-card",props:{key},children:[]}), onInstalledCardKeysChange: options.onInstalledCardKeysChange ?? (() => {}), searchQuery: options.searchQuery ?? "",
      workspaceRoot: options.root ?? "C:/Project", writeBusy: options.writeBusy ?? false,
      onInstalled: async () => { refreshes++; if (options.refreshError) throw Error("parent refresh failed"); },
      beginInstall: () => { writes++; if (blocked || options.denyWrite) return false; blocked = true; return true; },
      finishInstall: () => { finishes++; blocked = false; },
    });
    pendingEffects.splice(0).forEach(effect => effect());
  }
  render(); initial = false;
  function all(node, predicate) {
    if (!node || typeof node !== "object") return [];
    return [...(predicate(node) ? [node] : []), ...(node.children ?? []).flatMap(child => all(child, predicate))];
  }
  function text(node) { return typeof node === "string" ? node : (node?.children ?? []).map(text).join(""); }
  return {
    calls, render, text: () => text(tree), nodes: predicate => all(tree, predicate),
    buttons: label => all(tree, node => node.tag === "button" && text(node) === label),
    unmount() { mounted = false; effects.forEach(effect => effect?.cleanup?.()); },
    get refreshes() { return refreshes; }, get writes() { return writes; }, get finishes() { return finishes; },
  };
}
async function ready(options) {
  const f = mount(options);
  assert.equal(f.calls[0].method, "read");
  assert.equal(f.calls[0].args[0], false, "初次挂载不能强制网络刷新");
  f.calls[0].resolve(options?.catalog ?? catalog); await flush();
  return f;
}
{
  const f = await ready();
  const refresh = f.buttons("刷新推荐目录")[0].props.onClick;
  refresh(); refresh();
  assert.equal(f.calls.filter(call => call.method === "read").length, 2, "刷新请求合并");
  assert.equal(f.calls[1].args[0], true);
  f.calls[1].resolve({ ...catalog, error: "offline", source: "cache" }); await flush();
  assert.match(f.text(), /offline.*仍显示已读取的目录/);
  assert.match(f.text(), /PDF/);
  f.buttons("刷新推荐目录")[0].props.onClick(click);
  f.calls[2].reject(Error("network down")); await flush();
  assert.match(f.text(), /network down/);
  assert.match(f.text(), /PDF/, "刷新读取抛错仍保留已有目录");
}
{
  const f = await ready();
  assert.equal(f.nodes(node => node.tag === "select").length, 0, "official recommendation entry has no installation scope selector");
  const install = f.buttons("安装技能")[0].props.onClick;
  install(click); install(click);
  assert.equal(f.writes, 1, "组件同步锁不重复申请共享写锁");
  assert.equal(f.calls.filter(call => call.method === "install").length, 1);
  assert.equal(f.calls[1].args[0].id, skill.id);
  assert.equal(f.calls[1].args[1], null);
  f.calls[1].resolve({ destination }); await flush();
  assert.equal(f.calls[2].method, "discovery");
  assert.equal(f.calls[2].args[0], destination);
  assert.equal(f.calls[2].args[1], "C:/Project");
  f.calls[2].resolve({ found: true, errors: [] }); await flush();
  assert.match(f.text(), /已安装并发现/);
  assert.equal(f.refreshes, 1);
  assert.equal(f.finishes, 1);
}
{
  const f = await ready({ denyWrite: true });
  f.buttons("安装技能")[0].props.onClick(click); await flush();
  assert.equal(f.writes, 1);
  assert.equal(f.calls.length, 1, "共享写锁拒绝时不启动安装");
  assert.equal(f.finishes, 0, "未取得共享锁不得释放他人的锁");
}
{
  const f = await ready({ root: "" });
  f.buttons("安装技能")[0].props.onClick(click); f.calls[1].resolve({ destination }); await flush();
  assert.equal(f.calls[1].args[1], null);
  assert.equal(f.calls[2].args[1], null, "没有项目时发现检查使用默认scope");
  f.calls[2].reject(Error("unexpected discovery failure")); await flush();
  assert.match(f.text(), /文件已安装，刷新失败.*unexpected discovery failure/);
  assert.equal(f.finishes, 1);
}
for (const discovery of [
  { found: false, errors: ["尚未发现该路径"] },
  { found: false, errors: ["技能发现读取失败，无法确认发现状态（不代表文件未安装）"] },
]) {
  const f = await ready();
  f.buttons("安装技能")[0].props.onClick(click);
  f.calls[1].resolve({ destination }); await flush();
  f.calls[2].resolve(discovery); await flush();
  assert.match(f.text(), /文件已安装，技能发现待确认/);
  assert.match(f.text(), new RegExp(discovery.errors[0].replace(/[（）]/g, ".")));
  assert.doesNotMatch(f.text(), /已安装并发现|安装失败/);
  assert.equal(f.refreshes, 1);
  assert.equal(f.finishes, 1);
}
{
  const f = await ready({ refreshError: true });
  f.buttons("安装技能")[0].props.onClick(click); f.calls[1].resolve({ destination }); await flush();
  f.calls[2].resolve({ found: true, errors: [] }); await flush();
  assert.match(f.text(), /文件已安装，刷新失败.*parent refresh failed/);
  assert.equal(f.finishes, 1);
}
{
  const f = await ready();
  f.buttons("安装技能")[0].props.onClick(click); f.calls[1].reject(Error("copy failed")); await flush();
  assert.match(f.text(), /安装失败或结果未确认.*copy failed/);
  assert.equal(f.refreshes, 0);
  assert.equal(f.finishes, 1);
}
for (const phase of ["install", "discovery"]) {
  const old = await ready();
  old.buttons("安装技能")[0].props.onClick(click);
  if (phase === "discovery") { old.calls[1].resolve({ destination }); await flush(); }
  const previousText = old.text();
  old.unmount();
  const next = await ready({ root: "C:/OtherProject" });
  old.calls.at(-1).resolve(phase === "install" ? { destination } : { found: true, errors: [] }); await flush();
  assert.equal(old.refreshes, 0, "旧context晚回不得刷新父页面");
  assert.equal(old.finishes, 1, "已取得的共享锁在卸载后仍须释放");
  assert.equal(old.text(), previousText);
  assert.doesNotMatch(next.text(), /已安装并发现|技能发现待确认/);
}
{
  const f = await ready();
  f.buttons("安装技能")[0].props.onClick(click);
  const previous = f.text(); f.unmount();
  f.calls[1].reject(Error("late failure")); await flush();
  assert.equal(f.text(), previous);
  assert.equal(f.refreshes, 0);
  assert.equal(f.finishes, 1);
}
{
  const f = mount(); const previous = f.text(); f.unmount();
  f.calls[0].resolve(catalog); await flush();
  assert.equal(f.text(), previous, "卸载后目录晚回不得更新界面");
}
assert.match(fs.readFileSync("src/components/SkillsMcpView.tsx", "utf8"), /<RecommendedSkillsPanel\s+key=\{JSON.stringify\(\[activeWorkspaceRoot, connectionIdentity\]\)\}/,
  "宿主必须通过workspace key隔离组件上下文，不能复用alive标记接收旧请求");
console.log("Recommended skills UI: actual component initial/cache refresh, write lock, default install root, discovery facts, parent refresh and context lifetime passed");

export { mount as mountRecommendedSkills, ready as readyRecommendedSkills, flush as flushRecommendedSkills };

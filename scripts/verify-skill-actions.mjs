import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/components/SkillsMcpView.tsx", "utf8");
const ast = ts.createSourceFile("SkillsMcpView.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = {};
const names = ["isPluginContextCurrent", "loadLocalSkills", "loadRemoteSkills", "refreshAll", "handleSelectSkillRow", "handleStartNewSkill", "handleSaveSkill", "handleDeleteSkill", "handleInstallSeedSkill", "handleToggleSkill"];
function visit(node) {
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast))) callbacks[node.name.getText(ast)] = node.initializer.getText(ast);
  if (ts.isFunctionDeclaration(node) && ["normalizePathKey", "buildSkillRows"].includes(node.name?.text)) callbacks[node.name.text] = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const recommended = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/recommendedSkills.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: recommended, require: () => ({}) });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const local = { id: "tool", name: "Tool", path: "C:/home/skills/tool/SKILL.md", dirPath: "C:/home/skills/tool", installed: true, content: "original" };
const remote = { name: "tool", path: "D:/repo/.agents/skills/tool/SKILL.md", description: "repo", scope: "repo", enabled: true };
const row = { key: remote.path, name: remote.name, description: "repo", scope: "repo", local: null, remote, enabled: true };
function mount() {
  const requests = [], notices = [], context = {
    pluginContextRef: { current: 0 }, pluginMountedRef: { current: true }, remoteSkillsLoadingRef: { current: false },
    remoteSkillsRequestRef: { current: 0 }, localSkillsRequestRef: { current: 0 },
    skillSelectionRequestRef: { current: 0 }, skillEditorRevisionRef: { current: 0 }, skillSelectionRef: { current: null },
    skillWritePendingRef: { current: false }, selectedSkill: null, selectedSkillKey: null, readOnlyRemoteSkill: null,
    newSkillId: "tool", skillContent: "draft", activeWorkspaceRoot: "A", subTab: "skills", manageOnly: false,
    appsLoadedRef: { current: false }, skillScopeLabel: value => value, recommendedSkillDisplayName: recommended.recommendedSkillDisplayName,
    unsupportedDirectoryHost: () => false, searchQuery: "", directoryCategory: null,
    directorySearch: { retry() {} }, loadBrowsePlugins: async () => {},
    notify: (...args) => notices.push(args), confirm: () => true,
    workspaceCwds: () => ["A"], toViewError: error => ({ message: error.message }), errorSummary: error => error.message,
    flattenSkills: result => ({ skills: result.data }), loadInstalledPlugins: async () => {}, loadServicePlugins: async () => {}, loadManagement: async () => {}, loadManagementRecommended: async () => {}, loadApps: async () => {},
  };
  for (const method of ["tauriInvoke", "callAppServer", "readFileText", "writeSkillEnabled", "listSkills"]) {
    context[method] = (...args) => { const pending = deferred(); requests.push({ method, args, ...pending }); return pending.promise; };
  }
  for (const name of ["Skills", "RemoteSkills", "RemoteSkillsLoading", "RemoteSkillsError", "LocalSkillsError", "SelectedSkill", "SelectedSkillKey", "CreatingSkill", "ReadOnlyRemoteSkill", "NewSkillId", "SkillContent", "SkillContentError", "SkillContentLoading", "SkillWriteBusy", "SkillToggleBusy", "Config", "McpLiveStatus"]) {
    const key = name[0].toLowerCase() + name.slice(1);
    context[`set${name}`] = value => { context[key] = typeof value === "function" ? value(context[key]) : value; };
  }
  for (const [name, code] of Object.entries(callbacks)) context[name] = vm.runInNewContext(compile(`(${code})`), context);
  return { context, requests, notices, ...Object.fromEntries(names.map(name => [name, context[name]])) };
}
{
  const view = mount(), rows = view.context.buildSkillRows([local], [remote, { ...remote, path: local.path, pluginId: "plugin@market" }]);
  assert.equal(rows[0].local, null, "SA01: repo skill cannot bind same-name user skill");
  assert.equal(rows[1].local, null, "SA01: plugin skill cannot become writable local content");
  const samePath = view.context.buildSkillRows([local], [{ ...remote, path: "c:\\HOME\\skills\\tool\\SKILL.md" }]);
  assert.equal(samePath[0].local.path, local.path);
}
for (const action of ["local", "new"]) {
  const view = mount(), reading = view.handleSelectSkillRow(row);
  if (action === "local") await view.handleSelectSkillRow({ ...row, key: local.path, local, remote: null });
  else view.handleStartNewSkill();
  const text = view.context.skillContent;
  view.requests[0].resolve("late remote file"); await reading;
  assert.equal(view.context.skillContent, text, "SA02: stale content cannot replace current editor");
}
{
  const view = mount(), reading = view.handleSelectSkillRow(row);
  assert.equal(view.requests[0].method, "readFileText", "SA03: real file protocol wrapper is used");
  view.requests[0].resolve(""); await reading;
  assert.equal(view.context.skillContent, "", "SA03: empty content is valid");
  const failure = view.handleSelectSkillRow(row);
  view.requests[1].reject(Error("read denied")); await failure;
  assert.ok(view.context.skillContentError.includes("read denied"));
  assert.equal(view.context.skillContent, "", "SA03: never invent a skill document on read failure");
  const pluginReading = view.handleSelectSkillRow({ ...row, remote: { ...remote, pluginId: "plugin@market" } });
  view.requests[2].reject(Error("no local path")); await flush();
  assert.equal(view.requests[3].args[0], "plugin/skill/read");
  view.requests[3].resolve({ contents: "real plugin content" }); await pluginReading;
  assert.equal(view.context.skillContent, "real plugin content", "SA03: contents field follows actual schema");
}
{
  const view = mount(), saving = view.handleSaveSkill();
  await view.handleSaveSkill(); await view.handleDeleteSkill(local); await view.handleToggleSkill(row); await view.handleInstallSeedSkill(local);
  assert.equal(view.requests.length, 1, "SA04: synchronous write lock blocks duplicate/conflicting writes");
  view.requests[0].reject(Error("save denied")); await saving;
  assert.equal(view.context.skillContent, "draft");
  assert.equal(view.context.skillWritePendingRef.current, false);
  assert.ok(view.notices.some(([text]) => text.includes("save denied")));
}
for (const action of ["handleToggleSkill", "handleInstallSeedSkill", "handleDeleteSkill"]) {
  const view = mount(), operation = view[action](action === "handleToggleSkill" ? row : local);
  view.requests[0].reject(Error("write rejected")); await operation;
  assert.equal(view.context.skillWritePendingRef.current, false);
  assert.ok(view.notices.some(([text]) => text.includes("write rejected")), "SA04: every mutation releases lock and exposes failure");
}
{
  const view = mount();
  view.context.loadRemoteSkills = async () => {};
  view.context.refreshAll = async () => {};
  const saving = view.handleSaveSkill();
  view.handleStartNewSkill();
  const text = view.context.skillContent;
  view.requests[0].resolve(local); await saving;
  assert.equal(view.context.selectedSkill, null, "SA05: late save cannot replace new selection");
  assert.equal(view.context.skillContent, text);
}
{
  const view = mount();
  view.context.selectedSkill = local;
  view.context.loadRemoteSkills = async () => {};
  view.context.refreshAll = async () => {};
  const deleting = view.handleDeleteSkill(local);
  view.handleStartNewSkill();
  const text = view.context.skillContent;
  view.requests[0].resolve({}); await deleting;
  assert.equal(view.context.skillContent, text, "SA05: late delete does not clear another draft");
  const saving = view.handleSaveSkill();
  view.context.skillContent = "new typing";
  ++view.context.skillEditorRevisionRef.current;
  view.requests[1].resolve(local); await saving;
  assert.equal(view.context.skillContent, "new typing", "SA05: in-flight save does not erase later edits");
}
{
  const view = mount(), first = view.loadRemoteSkills(true), second = view.loadRemoteSkills(true);
  view.requests[0].resolve({ data: [remote] }); await first;
  assert.equal(view.context.remoteSkillsLoadingRef.current, true, "SA06: old finally does not end newer load");
  view.requests[1].resolve({ data: [{ ...remote, name: "new" }] }); await second;
  assert.equal(view.context.remoteSkills[0].name, "new");
  const stale = view.loadRemoteSkills(true);
  view.context.pluginContextRef.current += 2;
  view.requests[2].reject(Error("old A")); await stale;
  assert.equal(view.context.remoteSkillsError, null, "SA06: old project errors ignored");
}
{
  const view = mount(), refreshing = view.refreshAll();
  view.handleStartNewSkill();
  const text = view.context.skillContent;
  view.requests[0].resolve([local]); await flush();
  view.requests[1].resolve({ data: [] }); await refreshing;
  assert.equal(view.context.skillContent, text, "SA05: refreshed local list cannot select first row over draft");
}
{
  const view = mount(), old = view.refreshAll();
  view.context.pluginContextRef.current += 2;
  view.requests[0].resolve([local]); await old;
  assert.equal(view.context.skills, undefined, "SA06: late local list cannot populate a new project context");
  assert.equal(view.requests.length, 1, "SA06: stale refresh stops downstream work");
}
console.log("SA01–SA06 skill content, identity and mutation regressions passed");

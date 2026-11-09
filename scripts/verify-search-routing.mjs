import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const parse = path => ts.createSourceFile(path, fs.readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const page = parse("src/components/QuickSearchModal.tsx"), app = parse("src/App.tsx"), folderDialog = parse("src/components/SearchFolderDialog.tsx");
let items, keydown, focus, pageSelection, appSlash, sidebarSearch, selectedFileSearchText, rememberWorkspaceFile, pickSearchFolder, finishFolderPicker, folderLocation, folderListEffect;
let chatProjectLabel, selectedIndexExpression, selectResult, highlightChatMatch;
const chatStates = {};
const shortcuts = {};
const helpers = [];
function visit(node, ast) {
  if (ast === app && ts.isFunctionDeclaration(node) && node.name?.text === "selectedFileSearchText") selectedFileSearchText = node;
  if (ast === app && ts.isVariableDeclaration(node) && node.name.getText(ast) === "rememberWorkspaceFile") rememberWorkspaceFile = node.initializer.arguments[0];
  if (ast === app && ts.isVariableDeclaration(node) && node.name.getText(ast) === "getChatProjectLabel") chatProjectLabel = node.initializer.arguments[0];
  if (ast === page && ts.isFunctionDeclaration(node) && ["fileDedupeKey", "fileSearchRoot"].includes(node.name?.text)) helpers.push(node);
  if (ast === folderDialog && ts.isFunctionDeclaration(node) && node.name?.text === "folderLocation") folderLocation = node;
  if (ast === folderDialog && ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes('"fs_list_dir"')) folderListEffect = node.arguments[0];
  if (ts.isVariableDeclaration(node) && ast === page) {
    if (["emptyChat", "chatLoading"].includes(node.name.getText(ast))) chatStates[node.name.getText(ast)] = node.initializer;
    if (node.name.getText(ast) === "items") items = node.initializer.arguments[0];
    if (node.name.getText(ast) === "selectedIndex") selectedIndexExpression = node.initializer;
    if (node.name.getText(ast) === "selectResult") selectResult = node.initializer.arguments[0];
    if (node.name.getText(ast) === "highlightChatMatch") highlightChatMatch = node.initializer;
    if (node.name.getText(ast) === "handleKeyDown") keydown = node.initializer;
    if (node.name.getText(ast) === "pickSearchFolder") pickSearchFolder = node.initializer;
    if (node.name.getText(ast) === "finishFolderPicker") finishFolderPicker = node.initializer;
  }
  if (ast === page && ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("lastActiveElementRef.current = document.activeElement")) focus = node.arguments[0];
  if (ast === page && ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("pendingChatSelection.current")) pageSelection = node.arguments[0];
  if (ast === app && ts.isJsxAttribute(node) && node.name.getText(ast) === "onSelectSlashCommand") appSlash = node.initializer.expression;
  if (ast === app && ts.isJsxAttribute(node) && node.name.getText(ast) === "onOpenQuickSearch") sidebarSearch = node.initializer.expression;
  if (ast === app && ts.isPropertyAssignment(node) && ["command-palette", "command-palette-alt", "file-search"].includes(node.name.text) &&
      node.initializer.getText(ast).includes("setQuickSearchMode")) shortcuts[node.name.text] = node.initializer;
  ts.forEachChild(node, child => visit(child, ast));
}
visit(page, page); visit(app, app); visit(folderDialog, folderDialog);
const matcher = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/chatSearchMatch.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, matcher);
const execute = (node, ast, context) => {
  assert.ok(node, "production callback exists");
  return vm.runInNewContext(ts.transpileModule(`(${node.getText(ast)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText, context);
};
const slash = { id: "goal", command: "/goal", title: "Goal", description: "goal", kind: "action", action: "open_goal_dialog" };
function mount(overrides = {}) {
  const calls = [];
  const context = {
    query: "goal", mode: "root", workspacePath: "repo-B", remoteResults: null, pathQuery: null, pathLookup: null,
    fileRoots: [overrides.workspacePath ?? "repo-B"], fileScope: JSON.stringify([overrides.workspacePath ?? "repo-B"]),
    folderScope: undefined,
    scopeTriggerRef: { current: null },
    createChatRef: { current: null },
    emptyChat: false,
    pinnedThreadIds: [],
    threads: [], workspaceFileHits: [], recentFiles: [], recentHistory: [], recentLookup: null, skills: [], SLASH_COMMANDS: [slash],
    REMOTE_THREAD_LIMIT: 9, REMOTE_CHAT_LIMIT: 25,
    chatPaging: null,
    chatSearchScope: {}, chatPageRequest: { current: null }, pendingChatSelection: { current: null },
    runCmd: "npm run dev", testCmd: "npm test", buildCmd: "npm run build",
    selectedIndex: 0,
    baseNameFsPath: path => path.split(/[\\/]/).at(-1),
    createChatSearchMatcher: matcher.exports.createChatSearchMatcher,
    getChatProjectLabel: () => undefined,
    setPathRetry: updater => calls.push(["retry", updater(0)]),
    setRecentRetry: updater => calls.push(["recent retry", updater(0)]),
    inputRef: { current: { focus() {}, select() {} } },
    React: { createElement() { return {}; } },
    ...overrides,
  };
  for (const icon of ["Command", "MessageSquare", "Play", "Folder", "Settings", "FileText", "BookOpen"]) context[icon] = () => null;
  for (const name of ["onSelectSlashCommand", "onClose", "onTriggerCommand", "onSelectFile", "onSearchFiles", "onSearchChats", "onSelectThread", "onNavigateSettings", "onNavigateRoute", "onStartNewChat", "onSelectSkill", "loadMoreChats"]) {
    context[name] = (...args) => calls.push([name, ...args]);
  }
  context.setSelectedIndex = value => { context.selectedIndex = typeof value === "function" ? value(context.selectedIndex) : value; };
  context.selectAndScroll = (index, block = "nearest") => { context.selectedIndex = index; calls.push(["scroll", index, block]); };
  context.setQuery = value => { context.query = value; };
  for (const helper of helpers) vm.runInNewContext(ts.transpileModule(helper.getText(page), {}).outputText, context);
  return { context, calls, results: () => execute(items, page, context)() };
}
{
  const threads = Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: `聊天 ${i}`, updatedAt: i }));
  threads[0].recencyAt = 99;
  const view = mount({ mode: "chats", query: "", threads, pinnedThreadIds: ["missing", "3", "1", "3"] });
  const initial = view.results();
  assert.equal(initial.length, 25);
  assert.deepEqual(Array.from(initial.slice(0, 5), item => [item.id, item.section]), [
    ["th-3", "已置顶聊天"], ["th-1", "已置顶聊天"], ["th-0", "聊天"], ["th-29", "聊天"], ["th-28", "聊天"],
  ]);
  assert.ok(initial.every(item => item.category === "thread"), "opening without a query never shows pagination");
  view.context.items = initial;
  execute(keydown, page, view.context)({ key: "Tab", nativeEvent: {}, preventDefault() {} });
  assert.equal(view.context.selectedIndex, 2);
  initial[view.context.selectedIndex].onSelect();
  assert.deepEqual(view.calls, [["scroll", 2, "nearest"], ["onSelectThread", "0"], ["onClose"]]);
  view.context.query = "聊天";
  const matches = view.results();
  assert.equal(matches[0].section, "聊天");
  assert.equal(matches.at(-1).id, "show-more-chats");
  assert.equal(threads[1].id, "1", "sorting never mutates the original history");
}
{
  const projects = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/sidebarProjects.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, projects);
  const sidebarProjectMembership = { threadProjectAssignments: {}, workspaceProjectAssignments: { excluded: null }, projectlessThreadIds: [],
    localProjects: [{ id: "local-project", serverProjectId: "server-project", name: "已重命名项目", rootPaths: ["D:/projects/main"], createdAt: 0 }] };
  const resolve = execute(chatProjectLabel, app, {
    ...projects.exports, sidebarProjectMembership, workspaceHints: {},
    searchChatProjects: projects.exports.buildSidebarProjectGroups([], sidebarProjectMembership),
  });
  const remoteThreads = [
    { id: "unknown", name: "新命中", projectId: "server-project", cwd: "D:/other/folder" },
    { id: "excluded", name: "已移出", cwd: "D:/projects/main" },
    { id: "legacy", name: "旧协议命中", cwd: "D:/other/folder" },
    { id: "ordinary", name: "普通目录", cwd: "D:/other/folder" },
  ];
  const view = mount({ mode: "chats", query: "项目", getChatProjectLabel: resolve,
    threads: [{ id: "legacy", projectId: "server-project" }, { id: "loaded", name: "项目本地候选", cwd: "D:/projects/main" }],
    remoteResults: { mode: "chats", query: "项目", workspacePath: "repo-B", threads: remoteThreads } });
  assert.deepEqual(Object.fromEntries(view.results().map(row => [row.id, row.rightLabel])), {
    "th-unknown": "已重命名项目", "th-excluded": "", "th-legacy": "已重命名项目",
    "th-ordinary": "folder", "th-loaded": "已重命名项目",
  });
}
{
  const match = { id: "content-match", name: "Design", cwd: "D:/private/workspace", snippet: "命中的正文" };
  const view = mount({ mode: "chats", query: "正文", remoteResults: { mode: "chats", query: "正文", workspacePath: "repo-B", threads: [match] },
    threads: [{ id: "local-only", name: "正文标题" }] });
  const [local, remote] = view.results();
  assert.equal(remote.subtitle, "命中的正文");
  assert.equal(remote.rightLabel, "workspace");
  assert.equal(local.subtitle, undefined);
  assert.equal(local.rightLabel, "");
  remote.onSelect();
  assert.deepEqual(view.calls, [["onSelectThread", "content-match"], ["onClose"]]);
}
{
  const threads = [
    { id: "branch-only", name: "构建结果", gitInfo: { branch: "feature/修复-UI" } },
    { id: "title", name: "修复-UI 记录", gitInfo: { branch: "feature/修复-UI" } },
    { id: "content", name: "日志", gitInfo: { branch: "feature/修复-UI" } },
    { id: "no-snippet", name: "说明", gitInfo: { branch: "feature/修复-UI" } },
    { id: "not-matched", name: "设计", gitInfo: null },
  ];
  const query = "修复-ui";
  const view = mount({ mode: "chats", query, threads, remoteResults: {
    mode: "chats", query, workspacePath: "repo-B",
    threads: [{ id: "content", name: "日志", snippet: "修复-UI 的正文" }, { id: "no-snippet", name: "说明" }],
  } });
  const rows = view.results();
  assert.deepEqual(Array.from(rows, row => [row.id, row.subtitle]), [
    ["th-title", undefined], ["th-content", "修复-UI 的正文"],
    ["th-branch-only", "feature/修复-UI"], ["th-no-snippet", "feature/修复-UI"],
  ]);
  rows.find(row => row.id === "th-branch-only").onSelect();
  assert.deepEqual(view.calls, [["onSelectThread", "branch-only"], ["onClose"]]);
  view.context.query = "";
  assert.ok(view.results().every(row => row.subtitle === undefined), "idle results do not expose branch previews");
  view.context.query = query;
  view.context.mode = "root";
  assert.equal(view.results().some(row => row.id === "th-branch-only"), false);
}
{
  const query = "repair";
  const view = mount({ mode: "chats", query, threads: [
    { id: "older", name: "repair", updatedAt: 2 },
    { id: "newer", name: "repair", recencyAt: 5, updatedAt: 1 },
    { id: "branch", name: "分支候选", gitInfo: { branch: "feature/repair" } },
    { id: "folder", name: "目录候选", cwd: "D:/repair" },
  ] });
  const select = () => execute(selectedIndexExpression, page, view.context);
  const initial = view.results();
  assert.deepEqual(Array.from(initial, row => row.id), ["th-newer", "th-older", "th-branch", "th-folder"]);
  Object.assign(view.context, { items: initial, chatSelection: null, otherSelectedIndex: 0,
    setChatSelection: value => { view.context.chatSelection = value; } });
  execute(selectResult, page, view.context)(2);
  view.context.remoteResults = { mode: "chats", query, workspacePath: "repo-B", threads: [
    { id: "branch", name: "旧服务标题", snippet: "repair 正文" },
    ...Array.from({ length: 26 }, (_, i) => ({ id: `content-${i}`, name: "正文", snippet: "repair 同类正文", updatedAt: -i - 1 })),
  ] };
  view.context.chatPaging = { limit: 25, threads: [{ id: "branch", name: "重复结果" }] };
  const ranked = view.results();
  view.context.items = ranked;
  assert.equal(ranked.length, 26);
  assert.equal(ranked.at(-1).id, "show-more-chats");
  assert.deepEqual(Array.from(ranked.slice(0, 3), row => [row.id, row.title, row.subtitle]), [
    ["th-newer", "repair", undefined], ["th-older", "repair", undefined], ["th-branch", "分支候选", "repair 正文"],
  ]);
  assert.equal(ranked[select()].id, "th-branch", "response preserves the explicit selected identity");
  view.context.items = ranked.filter(row => row.id !== "th-branch");
  view.context.selectedIndex = select();
  assert.equal(view.context.selectedIndex, -1, "an item pushed out of the page leaves no active row");
  const key = execute(keydown, page, view.context);
  key({ key: "Enter", nativeEvent: {}, preventDefault() {} });
  assert.equal(view.calls.length, 0, "Enter must not open a replacement result");
  key({ key: "ArrowUp", nativeEvent: {}, preventDefault() {} });
  assert.equal(view.context.selectedIndex, view.context.items.length - 1);
  view.context.chatSearchScope = {};
  assert.equal(select(), 0, "another query cannot inherit the previous selection");
}
{
  const vectors = [
    ["repair-ui", "ru", [[0, 1], [7, 8]]], ["repair-ui", "rpr", null], ["repair-ui", "epu", null],
    ["repair-ui", "pai", [[2, 5]]], ["feature/repair-ui", "fru", [[0, 1], [8, 9], [15, 16]]],
    ["feature/repair-ui", "r/ui", [[5, 6], [7, 8], [15, 17]]],
    ["feature/repair-ui", "f\\r", [[0, 1], [7, 9]]], ["word", "foo/*", []],
    ["GitReviewPanel", "grp", [[0, 1], [3, 4], [9, 10]]], ["GitReviewPanel", "gRp", null],
    ["GitReviewPanel", "G R P", [[0, 1], [3, 4], [9, 10]]],
    ["read20File", "r2f", [[0, 1], [4, 5], [6, 7]]], ["abc123def", "a13d", null],
    ["fix🚀launch", "f🚀l", [[0, 1], [3, 6]]], ["feature/修复-界面", "修界", [[8, 9], [11, 12]]],
    ["foobar", "f b", null], ["foobar", "f*b", [[0, 1], [3, 4]]],
  ];
  for (const [text, query, expected] of vectors) {
    const hit = matcher.exports.createChatSearchMatcher(query)(text);
    assert.deepEqual(hit ? Array.from(hit.ranges, ({ start, end }) => [start, end]) : null, expected, `${text} / ${query}`);
  }
  for (const [text, query, score] of [
    ["repair-ui", "ru", 109911], ["feature/repair-ui", "ru", 9873], ["feature/repair-ui", "f/r", 110013],
    ["Git Review Panel", "GRP", 111484], ["git review panel", "GRP", 109954], ["GitReviewPanel", "grp", 109776],
    ["read2file", "r2f", 110031], ["a🚀x", "a🚀x", 110046], ["repair-ui", "folder/ru", 109911],
    ["a".repeat(105), "a".repeat(103), 109925],
  ]) assert.equal(matcher.exports.createChatSearchMatcher(query)(text)?.score, score, `${text} / ${query}`);
  assert.equal(matcher.exports.createChatSearchMatcher("i\u0307".repeat(51))("İ".repeat(51)), null,
    "case-fold expansion cannot produce a range outside the original title");
  const view = mount({ mode: "chats", query: "ru", threads: [
    { id: "long", name: "构建甲", gitInfo: { branch: "feature/repair-ui" }, updatedAt: 20 },
    { id: "short", name: "构建乙", gitInfo: { branch: "repair-ui" }, updatedAt: 10 },
  ] });
  const rows = view.results();
  assert.deepEqual(Array.from(rows, row => row.id), ["th-short", "th-long"]);
  const render = execute(highlightChatMatch, page, { React: { createElement: (tag, props, value) => ({ tag, value }) } });
  assert.deepEqual(Array.from(render(rows[0].subtitle, "ru", rows[0].subtitleRanges), part => part?.value ?? part),
    ["", "r", "epair-", "u", "i"]);
  view.context.mode = "root";
  assert.equal(view.results().some(row => row.id === "th-short"), false);
  const byCase = mount({ mode: "chats", query: "GRP", threads: [
    { id: "folded", name: "git review panel", updatedAt: 30 },
    { id: "exact", name: "Git Review Panel", updatedAt: 10 },
  ] });
  assert.deepEqual(Array.from(byCase.results(), row => row.id), ["th-exact", "th-folded"]);
}
{
  const view = mount({ mode: "chats", query: "", chatHistoryReady: false, trimmedQuery: "", items: [], isTauriRuntime: () => true });
  const state = name => execute(chatStates[name], page, view.context);
  assert.equal(state("emptyChat"), false, "the catalog has not loaded");
  view.context.chatHistoryReady = true;
  assert.equal(state("emptyChat"), true);
  const input = { focus: () => view.calls.push(["input focus"]) };
  const button = { focus: () => view.calls.push(["create focus"]) };
  Object.assign(view.context, { emptyChat: true, inputRef: { current: input }, createChatRef: { current: button } });
  const press = (key, target) => execute(keydown, page, view.context)({
    key, target, nativeEvent: {}, preventDefault: () => view.calls.push(["prevent"]),
  });
  press("Tab", input);
  press("Tab", button);
  press("Enter", button);
  assert.deepEqual(view.calls, [["prevent"], ["create focus"], ["prevent"], ["input focus"]]);
  view.context.items = [{ category: "thread" }];
  assert.equal(state("emptyChat"), false);
  view.context.trimmedQuery = "测";
  assert.equal(state("chatLoading"), true);
  view.context.remoteResults = { mode: "chats", query: "测", workspacePath: "repo-A", threads: [] };
  assert.equal(state("chatLoading"), true, "another workspace's response does not settle the query");
  view.context.remoteResults.workspacePath = "repo-B";
  assert.equal(state("chatLoading"), false);
  view.context.mode = "files";
  assert.equal(state("emptyChat"), false);
  assert.equal(state("chatLoading"), false);
}
{
  const recentFiles = ["C:/repo/src/测试🚀.rs", "c:\\REPO\\src\\测试🚀.rs", "C:/repo-backup/secret.txt",
    ...Array.from({ length: 12 }, (_, i) => `C:/repo/recent-${i}.txt`)];
  const view = mount({ mode: "files", query: " ", workspacePath: "C:/repo", recentFiles: recentFiles.map((path, i) => ({ path, updatedAt: 100 - i })) });
  const results = view.results();
  assert.equal(results.length, 10);
  assert.equal(results[0].section, "最近打开");
  assert.equal(results[0].title, "测试🚀.rs");
  assert.equal(results[0].subtitle, "src");
  assert.equal(results.at(-1).title, "recent-8.txt");
  results[0].onSelect();
  assert.deepEqual(view.calls, [["onSelectFile", recentFiles[0]], ["onClose"]]);
  view.context.query = "测试";
  assert.equal(view.results().length, 0, "recent files never mix into a nonempty query");
  view.context.query = "";
  view.context.workspacePath = "C:/another";
  view.context.fileRoots = ["C:/another"];
  assert.equal(view.results().length, 0, "recent paths cannot leak to another workspace");
  let history = {};
  const writes = [];
  const remember = execute(rememberWorkspaceFile, app, { fileDedupeKey: view.context.fileDedupeKey, fileSearchRoot: view.context.fileSearchRoot,
    workbenchWorkspaceRoots: ["C:/repo", "C:/other"], explicitFileScopeRef: { current: null }, setRecentFilesByWorkspace: update => { history = update(history); },
    isTauriRuntime: () => true, activeThreadId: "thread-a", tauriInvoke: (method, args) => { writes.push({ method, args }); return Promise.resolve(); } });
  for (const path of recentFiles.slice().reverse()) remember("C:/repo", path);
  remember("C:/repo", "C:/other/isolated.txt");
  remember("c:\\REPO", "c:\\repo\\recent-4.txt");
  assert.equal(history["c:/repo"].length, 10);
  assert.equal(history["c:/repo"][0].path, "c:\\repo\\recent-4.txt");
  assert.equal(history["c:/repo"].filter(file => /recent-4/i.test(file.path)).length, 1);
  assert.ok(!history["c:/repo"].some(file => file.path.includes("secret.txt")));
  assert.deepEqual(Array.from(history["c:/other"], file => file.path), ["C:/other/isolated.txt"]);
  assert.ok(writes.every(write => write.method === "fs_record_recent_file_access" && write.args.threadId === "thread-a" && !write.args.path.includes("secret.txt")));
}
{
  const view = mount({ mode: "files", query: "", workspacePath: "C:/repo", fileRoots: ["C:/picked"], folderScope: "C:/picked",
    recentFiles: [{ path: "C:/repo/unselected.txt", updatedAt: 20 }, { path: "C:/picked/selected.txt", updatedAt: 10 }],
  });
  assert.deepEqual(Array.from(view.results(), item => item.title), ["selected.txt"]);
  view.results()[0].onSelect();
  assert.deepEqual(view.calls, [["onSelectFile", "C:/picked/selected.txt", undefined, "C:/picked"], ["onClose"]]);
  const events = [], scopeContext = {};
  const context = {
    scopeContext, scopeContextRef: { current: scopeContext }, projectScope: '["C:/repo"]',
    scopeTriggerRef: { current: { focus: () => events.push(["focus"]) } },
    setScopeMenuOpen: value => events.push(["menu", value]), setFolderPicker: value => events.push(["picker", value]),
    setSelectedFolder: value => events.push(["selected", value]),
    requestAnimationFrame: callback => callback(),
  };
  const pick = execute(pickSearchFolder, page, context);
  const finish = execute(finishFolderPicker, page, context);
  pick();
  assert.deepEqual(events.slice(0, 2), [["menu", false], ["picker", scopeContext]]);
  finish();
  assert.equal(events.filter(([type]) => type === "selected").length, 0, "cancel preserves the previous scope");
  assert.equal(events.at(-1)[0], "focus");
  pick(); finish("C:/picked");
  assert.equal(events.find(([type]) => type === "selected")[1].path, "C:/picked");
  pick(); context.scopeContextRef.current = {}; finish("C:/stale");
  assert.equal(events.filter(([type]) => type === "selected").length, 1, "late picker results cannot affect another project or opening");
}
{
  const location = execute(folderLocation, folderDialog, {
    parentFsPath: value => value.replace(/[/\\][^/\\]+$/, "") || "/", baseNameFsPath: value => value.split(/[/\\]/).at(-1),
  });
  assert.equal(location("relative", true), null);
  assert.equal(location("C:/", true).parent, null);
  assert.equal(location("//server/share/", false).parent, null);
  assert.equal(location("C:/repo/测试", true).directory, "C:/repo");
  assert.equal(location("C:/repo/测试", true).prefix, "测试");
  assert.equal(location("C:/repo/", true).directory, "C:/repo/");
  const requests = [], states = [];
  const context = { directory: "C:/repo", normalize: async value => value, setListing: value => states.push(value),
    tauriInvoke: (method, args) => new Promise(resolve => requests.push({ method, args, resolve })) };
  const read = execute(folderListEffect, folderDialog, context);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const cancel = read(); await flush();
  assert.equal(requests[0].args.path, "C:/repo");
  cancel(); context.directory = "C:/other"; const finish = read(); await flush();
  requests[0].resolve([{ name: "stale", isDirectory: true }]);
  requests[1].resolve([{ name: "file.txt", isDirectory: false }, { name: "folder2", isDirectory: true }, { name: "folder1", isDirectory: true }]);
  await flush();
  assert.equal(states.length, 1);
  assert.equal(states[0].directory, "C:/other");
  assert.deepEqual(Array.from(states[0].entries, entry => entry.name), ["folder1", "folder2"]);
  finish();
}
{
  const view = mount({ mode: "files", query: "", workspacePath: "C:/repo",
    recentFiles: [{ path: "C:/repo/open.txt", updatedAt: 10 }],
    recentLookup: { files: [{ path: "C:/repo/changed.txt", updatedAt: 30 }, { path: "c:/REPO/OPEN.txt", updatedAt: 20 }] },
  });
  assert.deepEqual(Array.from(view.results(), row => row.title), ["changed.txt", "OPEN.txt"]);
  assert.ok(view.results().every(row => row.section === "最近文件"));
  view.context.recentLookup = {};
  view.context.recentHistory = [{ path: "C:/repo/before-restart.txt", updatedAt: 40 }];
  assert.equal(view.results()[0].title, "before-restart.txt", "disk scan failure preserves loaded history");
  view.context.recentHistory = [];
  assert.equal(view.results()[0].title, "open.txt", "scan failure preserves opened history");
  view.results()[1].onSelect();
  assert.deepEqual(view.calls, [["recent retry", 1]]);
}
{
  const view = mount({ mode: "files", query: "C:/repo/src", pathQuery: "C:/repo/src",
    pathLookup: { match: { path: "C:/repo/src", isDirectory: true } } });
  view.results()[0].onSelect();
  assert.deepEqual(view.calls, [["onSelectFile", "C:/repo/src", true], ["onClose"]]);
  view.calls.length = 0;
  view.context.pathLookup = { failed: true };
  const retry = view.results()[0];
  assert.equal(retry.title, "无法检查路径。选择此项以重试");
  retry.onSelect();
  assert.deepEqual(view.calls, [["retry", 1]], "retry keeps the menu open and only refreshes the lookup");
}
{
  const view = mount();
  view.results().find(item => item.id === "slash-goal").onSelect();
  assert.equal(view.calls[0][0], "onSelectSlashCommand", "SR01: slash is separate from shell command dispatch");
  assert.equal(view.calls[0][1], slash);
  assert.ok(!view.calls.some(call => call[0] === "onTriggerCommand"));
  const calls = [], dispatch = execute(appSlash, app, {
    handleSlashAction: value => calls.push(["action", value]),
    setPromptInput: value => calls.push(["draft", value]),
  });
  dispatch(slash);
  dispatch({ kind: "insert", insertText: "/review inspect changes" });
  assert.deepEqual(calls, [["action", "open_goal_dialog"], ["draft", "/review inspect changes"]]);
}
{
  const view = mount({ mode: "files", query: "npm", remoteResults: {
    mode: "files", query: "npm", workspacePath: "repo-B", fileScope: '["repo-B"]', threads: [],
    files: [{ fileName: "npm.txt", relPath: "npm.txt", absPath: "repo-B/npm.txt" }],
  } });
  const result = view.results();
  assert.equal(result.length, 1);
  assert.equal(result[0].category, "file", "SR02: files mode excludes matching run actions");
  view.context.fileScope = '["repo-B","sibling"]';
  assert.equal(view.results().length, 0, "same active root and query cannot expose results from a previous root set");
  view.context.mode = "root";
  assert.ok(view.results().some(item => item.category === "action"));
  const modes = [], opened = [];
  for (const name of ["file-search", "command-palette", "command-palette-alt"]) {
    execute(shortcuts[name], app, {
      showQuickSearch: false, lastFileSearchSeed: { current: "" }, selectedFileSearchText: () => undefined,
      setQuickSearchInitialQuery() {},
      setQuickSearchMode: mode => modes.push(mode), setShowQuickSearch: value => opened.push(value),
    })();
  }
  assert.deepEqual(modes, ["files", "root", "root"], "SR03: every entry chooses its mode");
  assert.deepEqual(opened, [true, true, true]);
}
{
  class Input {
    type = "text";
    value = "前缀  路径/测试🚀.rs  后缀";
    selectionStart = 2;
    selectionEnd = this.value.indexOf("后缀");
  }
  class Textarea extends Input {}
  const input = new Input();
  const document = { activeElement: input, getSelection: () => null };
  assert.ok(selectedFileSearchText, "file shortcut must capture selection before the search input takes focus");
  const select = execute(selectedFileSearchText, app, { document, HTMLInputElement: Input, HTMLTextAreaElement: Textarea });
  assert.equal(select(), "路径/测试🚀.rs");
  input.type = "password";
  assert.equal(select(), undefined);
  for (const value of ["a\nb", "a\rb", "a\0b", "a".repeat(257), " "]) {
    const textarea = new Textarea();
    Object.assign(textarea, { value, selectionStart: 0, selectionEnd: value.length });
    document.activeElement = textarea;
    assert.equal(select(), undefined);
  }
  document.activeElement = { contains: node => node === 1 || node === 2 };
  const selection = { anchorNode: 1, focusNode: 2, toString: () => " src/main.rs " };
  document.getSelection = () => selection;
  assert.equal(select(), "src/main.rs");
  selection.focusNode = 3;
  assert.equal(select(), undefined);
  const seeds = [];
  const context = {
    showQuickSearch: false, lastFileSearchSeed: { current: "" },
    selectedFileSearchText: () => "src/main.rs",
    setQuickSearchInitialQuery: request => seeds.push(request.value),
    setQuickSearchMode() {}, setShowQuickSearch() {},
  };
  const openFiles = execute(shortcuts["file-search"], app, context);
  openFiles();
  context.showQuickSearch = true;
  context.selectedFileSearchText = () => { throw Error("must not read the menu's own selection"); };
  openFiles();
  execute(shortcuts["command-palette"], app, context)();
  assert.deepEqual(seeds, ["src/main.rs", "src/main.rs", ""]);
}
{
  const view = mount({ query: "match", remoteResults: {
    mode: "root", query: "match", workspacePath: "repo-A",
    files: [{ absPath: "repo-A/match", relPath: "match", fileName: "match" }],
    threads: [{ id: "old", name: "match" }],
  } });
  assert.equal(view.results().length, 0, "SR05: same query cannot expose old-workspace results");
  view.context.workspacePath = "repo-A";
  assert.equal(view.results().length, 1, "root shows threads, never fuzzy files");
}
{
  const view = mount({ query: "files" });
  let focused = 0;
  view.context.inputRef.current.focus = () => focused++;
  view.results().find(item => item.id === "search-files").onSelect();
  assert.equal(view.context.query, "", "official file drill-in clears search");
  assert.deepEqual(view.calls, [["onSearchFiles"]], "drill-in changes mode without closing");
  assert.equal(focused, 1, "mouse drill-in restores focus to the search input");
}
{
  const view = mount({ query: "切换聊天" });
  view.results().find(item => item.id === "search-chats")?.onSelect();
  assert.deepEqual(view.calls, [["onSearchChats"]]);
  assert.equal(view.context.query, "切换聊天", "chat drill-in retains the current query");
  view.context.mode = "chats"; view.context.query = "聊天";
  view.context.threads = Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: `聊天 ${i}` }));
  const results = view.results();
  assert.equal(results.filter(item => item.category === "thread").length, 25);
  assert.equal(results.at(-1).id, "show-more-chats");
  results[0].onSelect();
  assert.deepEqual(view.calls.slice(1), [["onSelectThread", "0"], ["onClose"]]);
  const entry = [];
  execute(sidebarSearch, app, {
    setQuickSearchInitialQuery: seed => entry.push(seed.value),
    setQuickSearchMode: mode => entry.push(mode),
    setShowQuickSearch: open => entry.push(open),
  })();
  assert.deepEqual(entry, ["", "chats", true], "sidebar opens the dedicated chat mode");
  results.at(-1).onSelect();
  assert.equal(view.context.pendingChatSelection.current.ids.size, 25);
  view.context.chatPaging = { limit: 50, threads: [{ id: "0", name: "same server hit" }, { id: "new", name: "new hit" }] };
  const expanded = view.results();
  assert.equal(expanded.length, 31, "expanded results deduplicate loaded history against server pages");
  assert.ok(expanded.every(item => item.category === "thread"));
  view.context.chatPaging.loading = true;
  view.context.items = expanded;
  execute(pageSelection, page, view.context)();
  assert.equal(expanded[view.context.selectedIndex].title, "聊天 25", "selection moves to the highest ranked newly revealed chat");
  assert.equal(view.calls.at(-1)[2], "center");
  assert.equal(view.context.pendingChatSelection.current.selectedId, "th-25");
  view.context.chatPaging.loading = false;
  view.context.items = [{ id: "th-other-new", category: "thread" }, ...expanded];
  execute(pageSelection, page, view.context)();
  assert.equal(view.context.items[view.context.selectedIndex].id, "th-25", "late page completion preserves the first newly selected chat");
  assert.equal(view.context.pendingChatSelection.current, null);
  view.context.pendingChatSelection.current = { scope: {}, ids: new Set() };
  view.context.selectedIndex = 0;
  execute(pageSelection, page, view.context)();
  assert.equal(view.context.selectedIndex, 0);
  assert.equal(view.context.pendingChatSelection.current, null, "changed scope drops the old selection");
  view.context.items = results;
  view.context.pendingChatSelection.current = { scope: view.context.chatSearchScope, ids: new Set(results.map(item => item.id)) };
  execute(pageSelection, page, view.context)();
  assert.equal(results[view.context.selectedIndex].id, "show-more-chats", "failed page keeps the retry action selected");
  execute(keydown, page, view.context)({ key: "ArrowDown", nativeEvent: {}, preventDefault() {} });
  assert.deepEqual(view.calls.at(-1), ["scroll", 0, "nearest"], "keyboard wrap reveals the newly selected row");
}
{
  const view = mount();
  view.context.items = [{ section: "a", onSelect: () => view.calls.push(["select"]) }];
  const key = execute(keydown, page, view.context);
  for (const keyName of ["Enter", "Escape", "ArrowDown", "Tab"]) {
    key({ key: keyName, nativeEvent: { isComposing: true }, preventDefault() { throw Error("IME navigation consumed"); } });
    key({ key: keyName, keyCode: 229, nativeEvent: {}, preventDefault() { throw Error("IME navigation consumed"); } });
  }
  assert.deepEqual(view.calls, [], "SR04: composing keys do not execute/close");
  key({ key: "Enter", nativeEvent: {}, preventDefault() {} });
  assert.deepEqual(view.calls, [["select"]]);
}
{
  const timers = new Set(); let focusCalls = 0;
  const context = {
    open: true, document: { activeElement: { focus() { focusCalls++; } } },
    lastActiveElementRef: { current: null }, inputRef: { current: { focus() { focusCalls++; } } },
    setQuery() {}, setSelectedIndex() {},
    setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); },
  };
  const effect = execute(focus, page, context), cleanup = effect();
  cleanup(); assert.equal(timers.size, 0, "SR06: closing cancels delayed focus");
  context.open = false; effect();
  assert.equal(focusCalls, 1, "SR06: restores trigger focus");
}
console.log("PASS SR01–SR06 production search routing: slash action/draft, file mode, entry modes, IME, workspace-scoped results and focus cleanup");

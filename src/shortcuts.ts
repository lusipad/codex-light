// Windows desktop command metadata. Source: Store 26.1021.3705, 16.03B catalog.
// Local dispatch IDs remain stable; persisted command IDs follow the official registry.
export interface ShortcutDef {
  id: string; keys: string; label: string; description?: string;
  group: 'global' | 'thread' | 'composer' | 'panels';
  kind?: 'webview' | 'electron-only' | 'local';
  match: (e: KeyboardEvent) => boolean;
}
export interface KeyBinding { command: string; key: string | null; version?: 1; [field: string]: unknown }

type CommandRow = [string, string, string, string, ShortcutDef['group'], 'webview' | 'electron-only', string[]];
const COMMAND_ROWS: CommandRow[] = [
  ["new-chat","newTask","新聊天","开始新聊天","global","webview",["CmdOrCtrl+N","CmdOrCtrl+Shift+O"]],
  ["new-standalone-chat","newProjectlessTask","新建独立聊天","在项目外开始新聊天","global","webview",["CmdOrCtrl+Alt+O"]],
  ["toggle-sidebar","toggleSidebar","显示/隐藏侧边栏","显示或隐藏侧边栏","panels","webview",["CmdOrCtrl+Shift+S","CmdOrCtrl+B"]],
  ["toggle-terminal","toggleTerminal","打开终端","打开终端面板","panels","webview",["Control+`"]],
  ["toggle-bottom-panel","toggleBottomPanel","显示/隐藏底部面板","显示或隐藏底部面板","panels","webview",["CmdOrCtrl+J"]],
  ["toggle-changes","toggleSidePanel","显示/隐藏“变更”面板","在当前聊天中显示或隐藏“变更”面板","panels","webview",["CmdOrCtrl+Alt+B"]],
  ["open-settings","settings","设置","打开 {appName} 设置","global","webview",["CmdOrCtrl+,"]],
  ["show-keyboard-shortcuts","showKeyboardShortcuts","显示键盘快捷键","显示当前可用的快捷键","global","webview",["CmdOrCtrl+/"]],
  ["command-palette","openCommandMenu","打开命令菜单","打开命令菜单","global","electron-only",["CmdOrCtrl+K","CmdOrCtrl+Shift+P"]],
  ["file-search","searchFiles","搜索文件…","搜索文件","global","electron-only",["CmdOrCtrl+P"]],
  ["find-in-chat","findInThread","查找","搜索当前聊天","thread","webview",["Ctrl+F"]],
  ["rename-thread","renameThread","重命名聊天","重命名当前聊天","thread","electron-only",["CmdOrCtrl+Alt+R"]],
  ["pin-thread","toggleThreadPin","切换置顶状态","置顶或取消置顶当前聊天","thread","webview",["CmdOrCtrl+Alt+P"]],
  ["archive-thread","archiveThread","归档聊天","归档当前聊天","thread","webview",["CmdOrCtrl+Shift+A"]],
  ["copy-last-code-block","copyLastCodeBlock","复制最后一个代码块","复制当前聊天中助手提供的最后一个代码块","thread","webview",["CmdOrCtrl+Shift+;"]],
  ["fork-thread","forkThread","分叉聊天","为当前聊天创建分支","thread","webview",[]],
  ["open-review-tab","openReviewTab","打开“变更”选项卡","打开“变更”选项卡","panels","webview",["Ctrl+Shift+G"]],
  ["open-side-chat","openSideChat","打开侧边聊天","在侧边聊天中打开当前聊天","thread","webview",["CmdOrCtrl+Alt+S"]],
  ["copy-working-dir","copyWorkingDirectory","复制工作目录","复制当前聊天的工作目录","global","electron-only",["CmdOrCtrl+Shift+C"]],
  ["open-model-picker","composer.openModelPicker","选择推理强度","打开输入框中的模型推理强度设置","composer","webview",["Ctrl+Shift+M"]],
  ["composer-open-recent-models","composer.openRecentModels","打开最近使用的模型","打开最近使用的模型、强度和速度配置组合","composer","webview",["Alt+M"]],
  ["open-thread-new-window","openThreadInNewWindow","在新窗口中打开","在新窗口中打开当前聊天","thread","webview",[]],
  ["mark-thread-unread","markThreadUnread","标记为未读","将当前聊天标记为未读","thread","webview",["CmdOrCtrl+Shift+U"]],
  ["delete-chat","deleteChat","删除聊天","确认是否要删除当前聊天","thread","webview",[]],
  ["copy-conversation-markdown","copyConversationMarkdown","复制为 Markdown","将当前聊天复制为 Markdown","global","webview",[]],
  ["next-thread","nextThread","下一个侧边栏项目","切换到下一个侧边栏项目","thread","webview",["Ctrl+Alt+]","Ctrl+Alt+Right"]],
  ["previous-thread","previousThread","上一个侧边栏项目","切换到上一个侧边栏项目","thread","webview",["Ctrl+Alt+[","Ctrl+Alt+Left"]],
  ["toggle-file-tree","toggleFileTreePanel","显示/隐藏导航面板","显示或隐藏页面导航或代码查看器中的文件树","panels","webview",["CmdOrCtrl+Shift+E"]],
  ["git-commit","git.commit","提交或推送","打开提交或推送选项","panels","webview",[]],
  ["git-create-branch","git.createBranch","创建分支","打开分支创建选项","panels","webview",[]],
  ["git-create-pull-request","git.createPullRequest","创建 PR","打开 Pull Request 创建选项","panels","webview",[]],
  ["git-create-draft-pull-request","git.createDraftPullRequest","创建草稿 PR","打开草稿 Pull Request 创建选项","panels","webview",[]],
  // Fixed 26.1027 registry: Command means Meta, never Windows Ctrl. Slots 2–9 have no default.
  ["environment-action-1","environmentAction1","运行环境操作 1","运行当前环境的第 1 个操作","thread","webview",["Command+Shift+D"]],
  ["environment-action-2","environmentAction2","运行环境操作 2","运行当前环境的第 2 个操作","thread","webview",[]],
  ["environment-action-3","environmentAction3","运行环境操作 3","运行当前环境的第 3 个操作","thread","webview",[]],
  ["environment-action-4","environmentAction4","运行环境操作 4","运行当前环境的第 4 个操作","thread","webview",[]],
  ["environment-action-5","environmentAction5","运行环境操作 5","运行当前环境的第 5 个操作","thread","webview",[]],
  ["environment-action-6","environmentAction6","运行环境操作 6","运行当前环境的第 6 个操作","thread","webview",[]],
  ["environment-action-7","environmentAction7","运行环境操作 7","运行当前环境的第 7 个操作","thread","webview",[]],
  ["environment-action-8","environmentAction8","运行环境操作 8","运行当前环境的第 8 个操作","thread","webview",[]],
  ["environment-action-9","environmentAction9","运行环境操作 9","运行当前环境的第 9 个操作","thread","webview",[]],
  ["composer-submit","composer.submit","发送消息","发送当前编辑器中的消息","composer","webview",[]],
  ["composer-steer","composer.steer","引导提示","将当前编辑器提示作为引导消息提交","composer","webview",[]],
  ["composer-queue","composer.queue","将提示加入队列","将当前编辑器提示作为排队消息提交","composer","webview",[]],
  ["composer-clear","composer.clear","清除提示","清除当前编辑器中的提示","composer","webview",[]],
  ["composer-add-files","composer.addFiles","附加文件和文件夹","将文件和文件夹附加到当前编辑器","composer","webview",[]],
  ["composer-toggle-fast-mode","composer.toggleFastMode","循环切换速度","循环切换可用速度：标准、快速和超快","composer","webview",[]],
  ["composer-increase-reasoning-effort","composer.increaseReasoningEffort","提高推理强度","提高当前编辑器推理强度","composer","webview",[]],
  ["composer-decrease-reasoning-effort","composer.decreaseReasoningEffort","降低推理强度","降低当前编辑器推理强度","composer","webview",[]],
  ["composer-cycle-reasoning-effort","composer.cycleReasoningEffort","循环切换推理强度","循环切换编辑器推理强度选项","composer","webview",[]],
  ["composer-toggle-plan-mode","composer.togglePlanMode","切换规划模式","在当前编辑器中开启或关闭方案模式","composer","webview",[]],
  ["approval-approve","approval.approve","批准请求","批准已开启的请求","thread","webview",["Enter"]],
  ["approval-decline","approval.decline","拒绝请求","拒绝当前请求","thread","webview",["Escape"]],
  ["recent-thread-1","recentThread1","转到最近聊天 1","打开此快捷槽位中最近更新的聊天","thread","webview",["CmdOrCtrl+Alt+1"]],
  ["recent-thread-2","recentThread2","转到最近聊天 2","打开此快捷槽位中最近更新的聊天","thread","webview",["CmdOrCtrl+Alt+2"]],
  ["recent-thread-3","recentThread3","转到最近聊天 3","打开此快捷槽位中最近更新的聊天","thread","webview",["CmdOrCtrl+Alt+3"]],
  ["recent-thread-4","recentThread4","转到最近聊天 4","打开此快捷槽位中最近更新的聊天","thread","webview",["CmdOrCtrl+Alt+4","CmdOrCtrl+Shift+9"]],
  ["recent-thread-5","recentThread5","转到最近聊天 5","打开此快捷槽位中最近更新的聊天","thread","webview",["CmdOrCtrl+Alt+5","CmdOrCtrl+Shift+8"]],
  ["recent-thread-6","recentThread6","转到最近聊天 6","打开此快捷槽位中最近更新的聊天","thread","webview",["CmdOrCtrl+Alt+6"]],
  ["sidebar-thread-1","thread1","转到聊天 1","打开此快捷槽位中可见的聊天","thread","webview",["Alt+1"]],
  ["sidebar-thread-2","thread2","转到聊天 2","打开此快捷槽位中可见的聊天","thread","webview",["Alt+2"]],
  ["sidebar-thread-3","thread3","转到聊天 3","打开此快捷槽位中可见的聊天","thread","webview",["Alt+3"]],
  ["sidebar-thread-4","thread4","转到聊天 4","打开此快捷槽位中可见的聊天","thread","webview",["Alt+4"]],
  ["sidebar-thread-5","thread5","转到聊天 5","打开此快捷槽位中可见的聊天","thread","webview",["Alt+5"]],
  ["sidebar-thread-6","thread6","转到聊天 6","打开此快捷槽位中可见的聊天","thread","webview",["Alt+6"]],
  ["sidebar-thread-7","thread7","转到聊天 7","打开此快捷槽位中可见的聊天","thread","webview",["Alt+7"]],
  ["sidebar-thread-8","thread8","转到聊天 8","打开此快捷槽位中可见的聊天","thread","webview",["Alt+8"]],
  ["sidebar-thread-9","thread9","转到聊天 9","打开此快捷槽位中可见的聊天","thread","webview",["Alt+9"]],
  ["next-tab","nextTab","下一个标签页","切换到下一个标签页","panels","webview",["Ctrl+Shift+]","Ctrl+PageDown","Ctrl+Tab"]],
  ["previous-tab","previousTab","上一个标签页","切换到上一个标签页","panels","webview",["Ctrl+Shift+[","Ctrl+PageUp","Ctrl+Shift+Tab"]],
  ["focus-tab-1","focusTab1","聚焦第 1 个标签页","聚焦聊天标签栏中此位置的标签页","panels","webview",["CmdOrCtrl+1"]],
  ["focus-tab-2","focusTab2","聚焦第 2 个标签页","聚焦聊天标签栏中此位置的标签页","panels","webview",["CmdOrCtrl+2"]],
  ["focus-tab-3","focusTab3","聚焦第 3 个标签页","聚焦聊天标签栏中此位置的标签页","panels","webview",["CmdOrCtrl+3"]],
  ["focus-tab-4","focusTab4","聚焦第 4 个标签页","聚焦聊天标签栏中此位置的标签页","panels","webview",["CmdOrCtrl+4"]],
  ["focus-tab-5","focusTab5","聚焦第 5 个标签页","聚焦聊天标签栏中此位置的标签页","panels","webview",["CmdOrCtrl+5"]],
  ["focus-tab-6","focusTab6","聚焦第 6 个标签页","聚焦聊天标签栏中此位置的标签页","panels","webview",["CmdOrCtrl+6"]],
  ["focus-tab-7","focusTab7","聚焦第 7 个标签页","聚焦聊天标签栏中此位置的标签页","panels","webview",["CmdOrCtrl+7"]],
  ["focus-tab-8","focusTab8","聚焦第 8 个标签页","聚焦聊天标签栏中此位置的标签页","panels","webview",["CmdOrCtrl+8"]],
  ["focus-tab-9","focusTab9","聚焦第 9 个标签页","聚焦聊天标签栏中此位置的标签页","panels","webview",["CmdOrCtrl+9"]],
];

export const SHORTCUT_COMMAND_IDS: Record<string, string> = Object.fromEntries(COMMAND_ROWS.map(([id, command]) => [id, command]));
export const SHORTCUTS: ShortcutDef[] = COMMAND_ROWS.map(([id, , label, description, group, kind, keys]) => ({
  id, keys: keys.map(key => key.replaceAll('CmdOrCtrl', 'Ctrl').replaceAll('Control', 'Ctrl')).join(' / '), label, description, group, kind,
  match: event => { const stroke = acceleratorFromEvent(event); return !!stroke && defaultBindings(id).some(key => normalizeAccelerator(key) === normalizeAccelerator(stroke)); },
}));
// Existing local actions have no corresponding configurable official command.
SHORTCUTS.push(
  { id: 'open-review', keys: '', label: '打开代码审查', group: 'global', kind: 'local', match: () => false },
  ...[['zoom-in', 'Ctrl++', '放大'], ['zoom-out', 'Ctrl+-', '缩小'], ['zoom-reset', 'Ctrl+0', '实际大小'], ['escape', 'Esc', '关闭弹窗/面板']].map(([id, keys, label]): ShortcutDef => ({
    id, keys, label, group: 'global', kind: 'local', match: event => {
      if (id === 'escape') return event.key === 'Escape';
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
      if (id === 'zoom-in') return ['+', '='].includes(event.key) || event.code === 'NumpadAdd';
      if (id === 'zoom-out') return event.key === '-' || event.code === 'NumpadSubtract';
      return !event.shiftKey && event.key === '0';
    },
  })),
);

export function commandId(id: string): string { return SHORTCUT_COMMAND_IDS[id] ?? id; }
export function defaultBindings(id: string, primaryNumberShortcutTarget: 'tabs' | 'sidebar' = 'tabs'): string[] {
  if (/^focus-tab-[1-9]$/.test(id)) return [`${primaryNumberShortcutTarget === 'tabs' ? 'CmdOrCtrl' : 'Alt'}+${id.slice(-1)}`];
  if (/^sidebar-thread-[1-9]$/.test(id)) return [`${primaryNumberShortcutTarget === 'sidebar' ? 'CmdOrCtrl' : 'Alt'}+${id.slice(-1)}`];
  return COMMAND_ROWS.find(row => row[0] === id)?.[6].slice() ?? (shortcutById(id)?.keys.split(' / ').filter(Boolean) ?? []);
}
export function shortcutAllowsSequence(id: string): boolean {
  const command = commandId(id);
  const row = COMMAND_ROWS.find(row => row[1] === command);
  return row?.[5] === 'webview' && command !== 'composer.submit' && command !== 'browser.toggleAnnotationMode';
}
export function shortcutAllowsAppend(id: string): boolean { return !!COMMAND_ROWS.find(row => row[1] === commandId(id)); }
export function shortcutSharesBinding(id: string, otherId: string, accelerator?: string): boolean {
  const left = commandId(id), right = commandId(otherId);
  if (left === right) return true;
  if (normalizeAccelerator(accelerator ?? '') === 'enter' && [left, right].every(id => ['composer.submit', 'approval.approve'].includes(id))) return true;
  return [['closeTab', 'closeWindow'], ['goToLine', 'focusBrowserAddressBar'], ['file.goToDefinition', 'navigateForward']].some(group => group.includes(left) && group.includes(right));
}
/** Windows read-time migrations from Store QS/$S/eC. Does not mutate persisted records. */
export function migrateKeyBindings(bindings: KeyBinding[]): KeyBinding[] {
  let result = bindings.map(binding => ({ ...binding }));
  const current = (binding: KeyBinding) => binding.version == null || binding.version === 1;
  const same = (left: string, right: string) => normalizeAccelerator(left) === normalizeAccelerator(right);
  for (const command of ['previousTab', 'nextTab']) {
    const records = result.filter(binding => binding.command === command);
    if (!records.some(binding => binding.version != null) && !records.some(binding => binding.key === null)) {
      const previous = command === 'previousTab';
      const oldTab = previous ? 'Ctrl+Shift+Tab' : 'Ctrl+Tab';
      const candidates = [oldTab, previous ? 'Ctrl+PageUp' : 'Ctrl+PageDown', previous ? 'Ctrl+Shift+[' : 'Ctrl+Shift+]'];
      const matches = new Set(records.flatMap(binding => binding.key && !/\s/.test(binding.key.trim()) && candidates.some(key => same(key, binding.key!)) ? [normalizeAccelerator(binding.key)] : []));
      if (matches.size >= 2) result = result.filter(binding => binding.command !== command || binding.key === null || !same(binding.key, oldTab));
    }
    const directions = command === 'previousTab' ? ['previousThread', 'previousRecentThread'] : ['nextThread', 'nextRecentThread'];
    const occupied = directions.flatMap(direction => {
      const group = result.filter(binding => binding.command === direction && current(binding));
      return group.some(binding => binding.key === null) ? [] : group.flatMap(binding => binding.key ? [normalizeAccelerator(binding.key)] : []);
    });
    if (!records.some(binding => binding.key === null)) {
      const before = result.filter(binding => binding.command === command);
      result = result.filter(binding => binding.command !== command || !current(binding) || binding.key === null || !occupied.some(key => {
        const normalized = normalizeAccelerator(binding.key!);
        return normalized === key || normalized.startsWith(key + ' ') || key.startsWith(normalized + ' ');
      }));
      if (before.length && !result.some(binding => binding.command === command)) result.push({ command, key: null });
    }
  }
  const recent = result.filter(binding => current(binding) && ['nextRecentThread', 'previousRecentThread'].includes(binding.command));
  result = result.filter(binding => !current(binding) || !['nextRecentThread', 'previousRecentThread'].includes(binding.command));
  const extra = recent.flatMap(binding => binding.key && !['Ctrl+Tab', 'Ctrl+Shift+Tab'].some(key => same(key, binding.key!)) ? [binding.key] : []);
  if (extra.length) {
    const existing = result.filter(binding => binding.command === 'openCommandMenu' && current(binding));
    const keys = existing.length ? existing.flatMap(binding => binding.key === null ? [] : [binding.key]) : defaultBindings('command-palette');
    result = result.filter(binding => binding.command !== 'openCommandMenu' || !current(binding));
    result.push(...Array.from(new Map([...keys, ...extra].map(key => [normalizeAccelerator(key), key])).values()).map(key => ({ command: 'openCommandMenu', key })));
  }
  const aliases: Record<string, string[]> = { closeTabOrWindow: ['closeTab', 'closeWindow'], focusQuickChat: ['openAvatarOverlay'], newThread: ['newTask'], openBrowserTab: ['newTab'], searchThreadsOverlay: ['spotlightSearch'], toggleBrowserPanel: ['stepWorkspaceLayout'], toggleMaximizeSidePanel: ['showWorkspaceTabView'], toggleSidePanelFullWidth: ['showWorkspaceTabView'] };
  const layout = result.find(binding => ['showWorkspaceTabView', 'toggleMaximizeSidePanel', 'toggleSidePanelFullWidth'].includes(binding.command) && current(binding))?.command;
  return result.flatMap(binding => {
    if (!current(binding)) return [binding];
    if (binding.command === 'composer.startDictation') return [];
    if (binding.command === 'globalDictationToggle') {
      if (result.some(other => other.command === 'globalDictationSingleTap' && current(other))) return [];
      const hold = result.find(other => other.command === 'globalDictationHold' && current(other));
      if (!hold && binding.key !== null) return [{ ...binding, command: 'globalDictationHold' }];
      return [{ ...binding, command: 'globalDictationSingleTap', key: hold?.key && binding.key && same(hold.key, binding.key) ? null : binding.key }];
    }
    if (binding.command === 'focusQuickChat' && result.some(other => other.command === 'openAvatarOverlay' && current(other))) return [];
    if (['toggleMaximizeSidePanel', 'toggleSidePanelFullWidth'].includes(binding.command) && binding.command !== layout) return [];
    return (aliases[binding.command] ?? [binding.command]).map(command => ({ ...binding, command }));
  });
}
export function effectiveBindings(id: string, bindings: KeyBinding[], primaryNumberShortcutTarget: 'tabs' | 'sidebar' = 'tabs'): string[] {
  bindings = migrateKeyBindings(bindings).filter(binding => binding.version == null || binding.version === 1);
  const custom = bindings.filter(binding => binding.command === commandId(id));
  if (custom.length) return custom.some(binding => binding.key === null) ? [] : custom.map(binding => binding.key!).filter(key => shortcutAllowsSequence(id) || !/\s/.test(key.trim()));
  const defaults = defaultBindings(id, primaryNumberShortcutTarget);
  // Other occupied defaults are explicitly disabled by the keybinding update
  // operation. Only these official dynamic defaults yield without a null record.
  const yieldsToCustom = ['copyLastCodeBlock', 'toggleSidebar', 'nextThread', 'previousThread', 'nextTab', 'previousTab'].includes(commandId(id)) || /^(sidebar-thread|focus-tab)-[1-9]$/.test(id);
  return yieldsToCustom ? defaults.filter(key => !bindings.some(binding => binding.key != null && binding.command !== commandId(id) && normalizeAccelerator(binding.key.split(/\s+/)[0]) === normalizeAccelerator(key))) : defaults;
}
export function availableShortcuts(context: { hasActiveThread: boolean; hasWorkspace: boolean; hasWorkbench?: boolean }, bindings: KeyBinding[] = [], primaryNumberShortcutTarget: 'tabs' | 'sidebar' = 'tabs'): ShortcutDef[] {
  return SHORTCUTS.filter(shortcut => (context.hasActiveThread || !THREAD_CONTEXT_SHORTCUTS.has(shortcut.id)) &&
    (context.hasWorkspace || !(shortcut.id === 'copy-working-dir' || shortcut.id === 'toggle-file-tree' || shortcut.id.startsWith('git-'))) &&
    (context.hasWorkbench || !(shortcut.id === 'next-tab' || shortcut.id === 'previous-tab' || shortcut.id.startsWith('focus-tab-'))))
    .map(shortcut => ({ ...shortcut, keys: effectiveBindings(shortcut.id, bindings, primaryNumberShortcutTarget).map(key => key.replaceAll('CmdOrCtrl', 'Ctrl').replaceAll('Control', 'Ctrl')).join(' / ') }));
}
const THREAD_CONTEXT_SHORTCUTS = new Set(['find-in-chat', 'rename-thread', 'pin-thread', 'archive-thread', 'fork-thread', 'copy-last-code-block', 'open-thread-new-window', 'mark-thread-unread', 'delete-chat', 'copy-conversation-markdown', 'approval-approve', 'approval-decline']);

export function normalizeAccelerator(accelerator: string): string {
  return accelerator.trim().split(/\s+/).map(stroke => {
    const parts = stroke.replace(/\+\+$/, "+Plus").split("+").map(part => part.toLowerCase());
    const key = parts.pop() ?? "";
    const aliases: Record<string, string> = { esc: "escape", "`": "backquote", "+": "plus", " ": "space", equal: "=", minus: "-", comma: ",", period: ".", slash: "/", semicolon: ";", arrowleft: "left", arrowright: "right", arrowup: "up", arrowdown: "down" };
    const aliasesForModifiers: Record<string, string> = { cmdorctrl: "ctrl", commandorcontrol: "ctrl", control: "ctrl",
      super: "meta", command: "meta", cmd: "meta", option: "alt" };
    const modifiers = new Set(parts.map(part => aliasesForModifiers[part] ?? part));
    if ([...modifiers].some(modifier => !["ctrl", "meta", "alt", "shift"].includes(modifier))) return `invalid:${stroke}`;
    let normalizedKey = aliases[key] ?? key;
    if (normalizedKey === 'plus') { modifiers.add('shift'); normalizedKey = '+'; }
    const shifted: Record<string, string> = { '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*', '9': '(', '0': ')', '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|', ';': ':', "'": '"', ',': '<', '.': '>', '/': '?', '`': '~' };
    if (modifiers.has('shift')) normalizedKey = shifted[normalizedKey] ?? normalizedKey;
    return ["ctrl", "meta", "alt", "shift"].filter(modifier => modifiers.has(modifier)).concat(normalizedKey).join("+");
  }).join(" ");
}

export function acceleratorFromEvent(event: KeyboardEvent): string | null {
  if (event.isComposing || event.keyCode === 229 || ["Control", "Alt", "Shift", "Meta", "Dead", "Process", "Unidentified"].includes(event.key)) return null;
  const punctuation: Record<string, string> = { Backquote: "`", Backslash: "\\", BracketLeft: "[", BracketRight: "]", Comma: ",",
    Equal: "=", Minus: "-", Period: ".", Quote: "'", Semicolon: ";", Slash: "/" };
  const physical = event.shiftKey ? punctuation[event.code] ?? (/^Digit[0-9]$/.test(event.code) ? event.code.slice(-1) : null) : null;
  const key = physical ?? (event.key === " " ? "Space" : event.key === "+" ? "Plus" : event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return [event.ctrlKey ? "Ctrl" : "", event.metaKey ? "Meta" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : "", key].filter(Boolean).join("+");
}

export function shortcutEventAllowed(event: KeyboardEvent, bindings: KeyBinding[]): boolean {
  const target = event.target as HTMLElement | null;
  if (target?.closest?.(".xterm")) return ["toggle-terminal", "toggle-bottom-panel", "zoom-in", "zoom-out", "zoom-reset"].includes(matchShortcut(event, bindings) ?? "");
  const editable = target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
  // The default secondary sidebar binding yields to rich text bold except for an
  // unselected cursor at the beginning of the composer (official command-row).
  if (editable?.closest?.('.codex-two-tier-composer') && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'b' &&
    !bindings.some(binding => binding.command === 'toggleSidebar')) {
    if ('selectionStart' in editable) {
      const input = editable as HTMLTextAreaElement;
      if (input.selectionStart !== 0 || input.selectionEnd !== 0) return false;
    } else {
      const selection = editable.ownerDocument?.getSelection();
      if (!selection?.isCollapsed || selection.anchorOffset !== 0 || !selection.anchorNode ||
        !editable.contains(selection.anchorNode)) return false;
      const range = editable.ownerDocument.createRange();
      range.selectNodeContents(editable);
      range.setEnd(selection.anchorNode, selection.anchorOffset);
      if (range.toString().length !== 0) return false;
    }
  }
  return !editable || event.ctrlKey || event.metaKey || event.altKey || event.key === "Escape";
}

export function createShortcutMatcher(getBindings: () => KeyBinding[], allowed?: (id: string) => boolean, getNumberTarget: () => 'tabs' | 'sidebar' = () => 'tabs') {
  let prefix = "";
  let deadline = 0;
  const match = (event: KeyboardEvent): { id: string | null; pending: boolean } => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return { id: null, pending: false };
    const stroke = acceleratorFromEvent(event);
    if (!stroke) return { id: null, pending: false };
    if (event.key === "Escape" && prefix) { prefix = ""; return { id: null, pending: true }; }
    const normalized = normalizeAccelerator(stroke);
    if (Date.now() >= deadline) prefix = "";
    const bindings = getBindings();
    const entries = SHORTCUTS.filter(shortcut => !allowed || allowed(shortcut.id)).flatMap(shortcut => effectiveBindings(shortcut.id, bindings, getNumberTarget()).map(key => ({ id: shortcut.id, key: normalizeAccelerator(key) })));
    const sequence = prefix ? `${prefix} ${normalized}` : normalized;
    prefix = "";
    const exact = entries.find(entry => entry.key === sequence);
    if (exact) return { id: exact.id, pending: false };
    if (entries.some(entry => entry.key.startsWith(`${sequence} `))) {
      prefix = sequence;
      deadline = Date.now() + 1000;
      return { id: null, pending: true };
    }
    // Keep the legacy default matcher for layout-dependent accelerators such as zoom.
    if (sequence !== normalized && entries.some(entry => entry.key.startsWith(`${normalized} `))) {
      prefix = normalized;
      deadline = Date.now() + 1000;
      return { id: null, pending: true };
    }
    const id = matchShortcut(event, bindings, getNumberTarget());
    return { id: id && (!allowed || allowed(id)) ? id : null, pending: false };
  };
  match.reset = () => { prefix = ""; deadline = 0; };
  return match;
}

/** Ctrl+Alt+1..6 opens the Nth recent chat on Windows. */
export function matchRecentThreadIndex(e: KeyboardEvent): number | null {
  if (e.isComposing || e.keyCode === 229) return null;
  if (!(e.altKey && e.ctrlKey && !e.metaKey && !e.shiftKey)) return null;
  const m = /^([1-6])$/.exec(e.key || "");
  return m ? Number(m[1]) - 1 : null;
}

/** Return the matching shortcut id for a keyboard event, or null. */
export function matchShortcut(e: KeyboardEvent, bindings: KeyBinding[] = [], primaryNumberShortcutTarget: 'tabs' | 'sidebar' = 'tabs'): string | null {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return null;
  for (const shortcut of SHORTCUTS) {
    try {
      const accelerator = acceleratorFromEvent(e);
      if (accelerator && effectiveBindings(shortcut.id, bindings, primaryNumberShortcutTarget).some(key => normalizeAccelerator(key) === normalizeAccelerator(accelerator))) return shortcut.id;
      if (shortcut.kind === 'local' && shortcut.match(e)) return shortcut.id;
    } catch {
      // ignore malformed events
    }
  }
  return null;
}

export function shortcutById(id: string): ShortcutDef | undefined {
  return SHORTCUTS.find((s) => s.id === id);
}

export function formatShortcut(keys: string): string {
  return keys;
}

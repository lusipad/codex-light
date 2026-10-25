// Global keyboard shortcut registry.
// Kept dependency-free so it can be unit-tested and shared with the Settings UI.
// Matches the accelerator conventions of the official Codex desktop app.

export interface ShortcutDef {
  id: string;
  /** Human readable accelerator, e.g. "Ctrl+Shift+P". */
  keys: string;
  label: string;
  group: "global" | "thread" | "composer" | "panels";
  match: (e: KeyboardEvent) => boolean;
}

const isMod = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;
const key = (e: KeyboardEvent) => (e.key || "").toLowerCase();
const code = (e: KeyboardEvent) => e.code || "";

export const SHORTCUTS: ShortcutDef[] = [
  {
    id: "new-chat",
    keys: "Ctrl+N",
    label: "新建会话",
    group: "global",
    match: (e) => isMod(e) && !e.shiftKey && !e.altKey && key(e) === "n",
  },
  {
    id: "new-standalone-chat",
    keys: "Ctrl+Alt+O",
    label: "新独立聊天 (Popout)",
    group: "global",
    match: (e) => isMod(e) && e.altKey && key(e) === "o",
  },
  {
    id: "toggle-sidebar",
    keys: "Ctrl+B",
    label: "折叠/展开侧边栏",
    group: "panels",
    match: (e) => isMod(e) && !e.shiftKey && !e.altKey && key(e) === "b",
  },
  {
    id: "toggle-terminal",
    keys: "Ctrl+J",
    label: "切换底部终端",
    group: "panels",
    match: (e) => isMod(e) && !e.shiftKey && !e.altKey && key(e) === "j",
  },
  {
    id: "toggle-changes",
    keys: "Ctrl+Alt+B",
    label: "切换变更面板",
    group: "panels",
    match: (e) => isMod(e) && e.altKey && key(e) === "b",
  },
  {
    id: "open-settings",
    keys: "Ctrl+,",
    label: "打开设置",
    group: "global",
    match: (e) => isMod(e) && key(e) === ",",
  },
  {
    id: "command-palette",
    keys: "Ctrl+K",
    label: "命令面板 / 快速搜索",
    group: "global",
    match: (e) => isMod(e) && !e.altKey && key(e) === "k",
  },
  {
    id: "command-palette-alt",
    keys: "Ctrl+Shift+P",
    label: "命令面板",
    group: "global",
    match: (e) => isMod(e) && e.shiftKey && !e.altKey && key(e) === "p",
  },
  {
    id: "file-search",
    keys: "Ctrl+P",
    label: "文件搜索",
    group: "global",
    match: (e) => isMod(e) && !e.shiftKey && !e.altKey && key(e) === "p",
  },
  {
    id: "find-in-chat",
    keys: "Ctrl+F",
    label: "在会话中查找",
    group: "thread",
    match: (e) => isMod(e) && !e.shiftKey && !e.altKey && key(e) === "f",
  },
  {
    id: "rename-thread",
    keys: "Ctrl+Alt+R",
    label: "重命名当前会话",
    group: "thread",
    match: (e) => isMod(e) && e.altKey && key(e) === "r",
  },
  {
    id: "pin-thread",
    keys: "Ctrl+Alt+P",
    label: "置顶/取消置顶当前会话",
    group: "thread",
    match: (e) => isMod(e) && e.altKey && key(e) === "p",
  },
  {
    id: "archive-thread",
    keys: "Ctrl+Shift+A",
    label: "归档当前会话",
    group: "thread",
    match: (e) => isMod(e) && e.shiftKey && !e.altKey && key(e) === "a",
  },
  {
    id: "copy-last-code-block",
    keys: "Ctrl+Shift+;",
    label: "复制最后一段代码块",
    group: "thread",
    match: (e) => isMod(e) && e.shiftKey && code(e) === "Semicolon",
  },
  {
    id: "fork-thread",
    keys: "Ctrl+Alt+F",
    label: "派生当前会话",
    group: "thread",
    match: (e) => isMod(e) && e.altKey && key(e) === "f",
  },
  {
    id: "open-review-tab",
    keys: "Ctrl+Shift+G",
    label: "打开变更标签",
    group: "panels",
    match: (e) => isMod(e) && e.shiftKey && !e.altKey && key(e) === "g",
  },
  {
    id: "open-review",
    keys: "Ctrl+Alt+C",
    label: "打开代码审查",
    group: "global",
    match: (e) => isMod(e) && e.altKey && key(e) === "c",
  },
  {
    id: "open-side-chat",
    keys: "Ctrl+Alt+S",
    label: "打开侧边独立对话",
    group: "panels",
    match: (e) => isMod(e) && e.altKey && key(e) === "s",
  },
  {
    id: "copy-working-dir",
    keys: "Ctrl+Shift+C",
    label: "复制当前工作目录",
    group: "global",
    match: (e) => isMod(e) && e.shiftKey && !e.altKey && key(e) === "c",
  },
  {
    id: "escape",
    keys: "Esc",
    label: "关闭弹窗/面板",
    group: "global",
    match: (e) => key(e) === "escape",
  },
];

/** Alt+1..9 jumps to the Nth recent thread (handled separately for numeric keys). */
export function matchRecentThreadIndex(e: KeyboardEvent): number | null {
  if (!(e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey)) return null;
  const m = /^([1-9])$/.exec(e.key || "");
  return m ? Number(m[1]) - 1 : null;
}

/** Return the matching shortcut id for a keyboard event, or null. */
export function matchShortcut(e: KeyboardEvent): string | null {
  for (const shortcut of SHORTCUTS) {
    try {
      if (shortcut.match(e)) return shortcut.id;
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

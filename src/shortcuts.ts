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
    keys: "Ctrl+N / Ctrl+Shift+O",
    label: "新建会话",
    group: "global",
    match: (e) => isMod(e) && !e.altKey && ((!e.shiftKey && key(e) === "n") || (e.shiftKey && key(e) === "o")),
  },
  {
    id: "new-standalone-chat",
    keys: "Ctrl+Alt+O",
    label: "新独立聊天 (Popout)",
    group: "global",
    match: (e) => isMod(e) && e.altKey && !e.shiftKey && key(e) === "o",
  },
  {
    id: "toggle-sidebar",
    keys: "Ctrl+B / Ctrl+Shift+S",
    label: "折叠/展开侧边栏",
    group: "panels",
    match: (e) => isMod(e) && !e.altKey && ((!e.shiftKey && key(e) === "b") || (e.shiftKey && key(e) === "s")),
  },
  {
    id: "toggle-terminal",
    keys: "Ctrl+J / Ctrl+`",
    label: "切换底部终端",
    group: "panels",
    match: (e) => isMod(e) && !e.shiftKey && !e.altKey && (key(e) === "j" || code(e) === "Backquote"),
  },
  {
    id: "toggle-changes",
    keys: "Ctrl+Alt+B",
    label: "切换变更面板",
    group: "panels",
    match: (e) => isMod(e) && e.altKey && !e.shiftKey && key(e) === "b",
  },
  {
    id: "open-settings",
    keys: "Ctrl+,",
    label: "打开设置",
    group: "global",
    match: (e) => isMod(e) && !e.shiftKey && !e.altKey && key(e) === ",",
  },
  {
    id: "command-palette",
    keys: "Ctrl+K",
    label: "命令面板 / 快速搜索",
    group: "global",
    match: (e) => isMod(e) && !e.shiftKey && !e.altKey && key(e) === "k",
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
    match: (e) => isMod(e) && e.altKey && !e.shiftKey && key(e) === "r",
  },
  {
    id: "pin-thread",
    keys: "Ctrl+Alt+P",
    label: "置顶/取消置顶当前会话",
    group: "thread",
    match: (e) => isMod(e) && e.altKey && !e.shiftKey && key(e) === "p",
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
    match: (e) => isMod(e) && e.altKey && !e.shiftKey && key(e) === "f",
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
    match: (e) => isMod(e) && e.altKey && !e.shiftKey && key(e) === "c",
  },
  {
    id: "open-side-chat",
    keys: "Ctrl+Alt+S",
    label: "打开侧边独立对话",
    group: "panels",
    match: (e) => isMod(e) && e.altKey && !e.shiftKey && key(e) === "s",
  },
  {
    id: "copy-working-dir",
    keys: "Ctrl+Shift+C",
    label: "复制当前工作目录",
    group: "global",
    match: (e) => isMod(e) && e.shiftKey && !e.altKey && key(e) === "c",
  },
  {
    id: "zoom-in",
    keys: "Ctrl++",
    label: "放大",
    group: "global",
    match: (e) => isMod(e) && !e.altKey && (key(e) === "+" || key(e) === "=" || code(e) === "NumpadAdd"),
  },
  {
    id: "zoom-out",
    keys: "Ctrl+-",
    label: "缩小",
    group: "global",
    match: (e) => isMod(e) && !e.altKey && (key(e) === "-" || code(e) === "NumpadSubtract"),
  },
  {
    id: "zoom-reset",
    keys: "Ctrl+0",
    label: "实际大小",
    group: "global",
    match: (e) => isMod(e) && !e.altKey && !e.shiftKey && (key(e) === "0" || code(e) === "Digit0" || code(e) === "Numpad0"),
  },
  {
    id: "open-model-picker",
    keys: "Ctrl+Shift+M",
    label: "打开模型选择器",
    group: "composer",
    match: (e) => isMod(e) && e.shiftKey && !e.altKey && key(e) === "m",
  },
  {
    id: "escape",
    keys: "Esc",
    label: "关闭弹窗/面板",
    group: "global",
    match: (e) => key(e) === "escape",
  },
];

/** Ctrl+Alt+1..6 opens the Nth recent chat on Windows. */
export function matchRecentThreadIndex(e: KeyboardEvent): number | null {
  if (e.isComposing || e.keyCode === 229) return null;
  if (!(e.altKey && e.ctrlKey && !e.metaKey && !e.shiftKey)) return null;
  const m = /^([1-6])$/.exec(e.key || "");
  return m ? Number(m[1]) - 1 : null;
}

/** Return the matching shortcut id for a keyboard event, or null. */
export function matchShortcut(e: KeyboardEvent): string | null {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return null;
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

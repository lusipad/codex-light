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

export interface KeyBinding { command: string; key: string | null }

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
    label: "新建无项目聊天",
    group: "global",
    match: (e) => isMod(e) && e.altKey && !e.shiftKey && key(e) === "o",
  },
  {
    id: "toggle-sidebar",
    keys: "Ctrl+Shift+S / Ctrl+B",
    label: "折叠/展开侧边栏",
    group: "panels",
    match: (e) => isMod(e) && !e.altKey && ((!e.shiftKey && key(e) === "b") || (e.shiftKey && key(e) === "s")),
  },
  {
    id: "toggle-terminal",
    keys: "Ctrl+`",
    label: "切换底部终端",
    group: "panels",
    match: (e) => e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && code(e) === "Backquote",
  },
  {
    id: "toggle-bottom-panel", keys: "Ctrl+J", label: "切换底部面板", group: "panels",
    match: (e) => isMod(e) && !e.shiftKey && !e.altKey && key(e) === "j",
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
    id: "show-keyboard-shortcuts",
    keys: "Ctrl+/",
    label: "键盘快捷键",
    group: "global",
    match: (e) => isMod(e) && !e.shiftKey && !e.altKey && key(e) === "/",
  },
  {
    id: "command-palette",
    keys: "Ctrl+K / Ctrl+Shift+P",
    label: "命令面板 / 快速搜索",
    group: "global",
    match: (e) => isMod(e) && !e.altKey && ((!e.shiftKey && key(e) === "k") || (e.shiftKey && key(e) === "p")),
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
    keys: "",
    label: "派生当前会话",
    group: "thread",
    match: () => false,
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
    keys: "",
    label: "打开代码审查",
    group: "global",
    match: () => false,
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
  ...Array.from({ length: 6 }, (_, index): ShortcutDef => ({
    id: `recent-thread-${index + 1}`, keys: `Ctrl+Alt+${index + 1}${index === 3 ? " / Ctrl+Shift+9" : index === 4 ? " / Ctrl+Shift+8" : ""}`,
    label: `打开最近的聊天 ${index + 1}`, group: "thread",
    match: e => matchRecentThreadIndex(e) === index || (isMod(e) && e.shiftKey && !e.altKey &&
      ((index === 3 && key(e) === "9") || (index === 4 && key(e) === "8"))),
  })),
];

const THREAD_CONTEXT_SHORTCUTS = new Set([
  "find-in-chat",
  "rename-thread",
  "pin-thread",
  "archive-thread",
  "fork-thread",
  "copy-last-code-block",
]);

export function availableShortcuts(context: { hasActiveThread: boolean; hasWorkspace: boolean }, bindings: KeyBinding[] = []): ShortcutDef[] {
  return SHORTCUTS.filter(shortcut =>
    (context.hasActiveThread || !THREAD_CONTEXT_SHORTCUTS.has(shortcut.id)) &&
    (context.hasWorkspace || shortcut.id !== "copy-working-dir")
  ).map(shortcut => ({ ...shortcut, keys: effectiveBindings(shortcut.id, bindings).map(key => key.replaceAll("CmdOrCtrl", "Ctrl").replaceAll("Control", "Ctrl")).join(" / ") }));
}

// Official command IDs are kept separate from the local action dispatch IDs.
export const SHORTCUT_COMMAND_IDS: Record<string, string> = {
  "new-chat": "newTask", "new-standalone-chat": "newProjectlessTask", "toggle-sidebar": "toggleSidebar",
  "toggle-terminal": "toggleTerminal", "toggle-bottom-panel": "toggleBottomPanel", "toggle-changes": "toggleSidePanel",
  "open-settings": "settings", "show-keyboard-shortcuts": "showKeyboardShortcuts", "command-palette": "openCommandMenu",
  "file-search": "searchFiles", "find-in-chat": "findInThread", "rename-thread": "renameThread",
  "pin-thread": "toggleThreadPin", "archive-thread": "archiveThread", "copy-last-code-block": "copyLastCodeBlock",
  "fork-thread": "forkThread", "open-review-tab": "openReviewTab", "open-side-chat": "openSideChat",
  "copy-working-dir": "copyWorkingDirectory", "open-model-picker": "composer.openModelPicker",
  ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`recent-thread-${index + 1}`, `recentThread${index + 1}`])),
};

export function commandId(id: string): string { return SHORTCUT_COMMAND_IDS[id] ?? id; }

export function defaultBindings(id: string): string[] {
  if (id === "toggle-terminal") return ["Control+`"];
  if (id === "find-in-chat") return ["Ctrl+F"];
  if (id === "open-review-tab") return ["Ctrl+Shift+G"];
  if (id === "open-model-picker") return ["Ctrl+Shift+M"];
  return (shortcutById(id)?.keys.split(" / ").filter(Boolean) ?? []).map(key => key.replace(/^Ctrl\+/, "CmdOrCtrl+"));
}

export function effectiveBindings(id: string, bindings: KeyBinding[]): string[] {
  const custom = bindings.filter(binding => binding.command === commandId(id));
  if (custom.length) return custom.some(binding => binding.key === null) ? [] : custom.map(binding => binding.key!);
  return defaultBindings(id);
}

export function normalizeAccelerator(accelerator: string): string {
  return accelerator.trim().split(/\s+/).map(stroke => {
    const parts = stroke.replace(/\+\+$/, "+Plus").split("+").map(part => part.toLowerCase());
    const key = parts.pop() ?? "";
    const aliases: Record<string, string> = { esc: "escape", "`": "backquote", "+": "plus", " ": "space", equal: "=", minus: "-", comma: ",", period: ".", slash: "/", semicolon: ";" };
    const aliasesForModifiers: Record<string, string> = { cmdorctrl: "ctrl", commandorcontrol: "ctrl", control: "ctrl",
      super: "meta", command: "meta", cmd: "meta", option: "alt" };
    const modifiers = new Set(parts.map(part => aliasesForModifiers[part] ?? part));
    if ([...modifiers].some(modifier => !["ctrl", "meta", "alt", "shift"].includes(modifier))) return `invalid:${stroke}`;
    return ["ctrl", "meta", "alt", "shift"].filter(modifier => modifiers.has(modifier)).concat(aliases[key] ?? key).join("+");
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
  return !editable || event.ctrlKey || event.metaKey || event.altKey || event.key === "Escape";
}

export function createShortcutMatcher(getBindings: () => KeyBinding[], allowed?: (id: string) => boolean) {
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
    const entries = SHORTCUTS.filter(shortcut => !allowed || allowed(shortcut.id)).flatMap(shortcut => effectiveBindings(shortcut.id, bindings).map(key => ({ id: shortcut.id, key: normalizeAccelerator(key) })));
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
    const id = matchShortcut(event, bindings);
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
export function matchShortcut(e: KeyboardEvent, bindings: KeyBinding[] = []): string | null {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return null;
  for (const shortcut of SHORTCUTS) {
    try {
      if (bindings.some(binding => binding.command === commandId(shortcut.id))) {
        const accelerator = acceleratorFromEvent(e);
        if (accelerator && effectiveBindings(shortcut.id, bindings).some(key => normalizeAccelerator(key) === normalizeAccelerator(accelerator))) return shortcut.id;
        continue;
      }
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

import { useCallback, useEffect, useRef, useState } from "react";
import { tauriInvoke, tauriListen } from "./bridge";
import { SHORTCUTS, SHORTCUT_COMMAND_IDS, commandId, defaultBindings, effectiveBindings, normalizeAccelerator, migrateKeyBindings, shortcutAllowsAppend, shortcutAllowsSequence, shortcutSharesBinding, type KeyBinding } from "./shortcuts";

export type NumberShortcutTarget = "tabs" | "sidebar";
export type BindingUpdate = { type: "set" | "append" | "remove"; accelerator: string } |
  { type: "replace"; accelerator: string; previousAccelerator: string } | { type: "clear" | "reset" };
export const configurableShortcuts = SHORTCUTS.filter(shortcut => SHORTCUT_COMMAND_IDS[shortcut.id] && shortcut.id !== "find-in-chat");
const nativeCommands = ["new-chat", "open-settings", "toggle-sidebar", "toggle-terminal", "toggle-changes",
  "command-palette", "file-search", "zoom-in", "zoom-out", "zoom-reset"];
export function nativeAccelerators(bindings: KeyBinding[], suspended = false, target: NumberShortcutTarget = "tabs"): Record<string, string | null> {
  return Object.fromEntries(nativeCommands.map(id => {
    const key = effectiveBindings(id, bindings, target)[0];
    const native = key?.replace(/\+\+$/, "+Shift+Equal").replace(/(?:Shift\+)?Plus$/, "Shift+Equal").replaceAll("Meta", "Super");
    return [id, suspended || !native || /\s/.test(native) || !/(?:Ctrl|Control|Alt|Meta|Super)\+/i.test(native) ? null : native];
  }));
}

export function updateKeyBindings(bindings: KeyBinding[], id: string, update: BindingUpdate, target: NumberShortcutTarget = "tabs"): KeyBinding[] {
  if (!configurableShortcuts.some(shortcut => shortcut.id === id)) throw Error("此动作不可修改快捷键");
  if (update.type === "append" && !shortcutAllowsAppend(id)) throw Error("此动作不支持追加快捷键");
  if ("accelerator" in update && update.type !== "remove" && /\s/.test(update.accelerator.trim()) && !shortcutAllowsSequence(id)) throw Error("此动作不支持组合序列");
  const command = commandId(id);
  const currentVersion = (binding: KeyBinding) => binding.version == null || binding.version === 1;
  // Only expand legacy records that feed the edited command. Preserve unrelated raw records,
  // including future versions. A multi-command alias retains its other command's binding.
  const migrated = migrateKeyBindings(bindings);
  const related = bindings.filter(binding => currentVersion(binding) && binding.command !== command &&
    migrateKeyBindings([binding]).some(record => record.command === command));
  if (related.length) {
    const otherCommands = new Set(related.flatMap(binding => migrateKeyBindings([binding]).map(record => record.command)).filter(id => id !== command));
    bindings = [...bindings.filter(binding => !related.includes(binding) && !((binding.command === command || otherCommands.has(binding.command)) && currentVersion(binding))),
      ...migrated.filter(binding => currentVersion(binding) && (binding.command === command || otherCommands.has(binding.command)))];
  }
  const records = bindings.filter(binding => binding.command === command && currentVersion(binding));
  let next = bindings.filter(binding => binding.command !== command || !currentVersion(binding));
  let keys = effectiveBindings(id, bindings, target);
  const previousKeys = keys;
  if (update.type === "reset") keys = defaultBindings(id, target);
  else if (update.type === "clear") keys = [];
  else if (update.type === "set") keys = [update.accelerator, ...keys.slice(1)];
  else if (update.type === "append") keys = [...keys, update.accelerator];
  else if (update.type === "remove") keys = keys.filter(key => key !== update.accelerator);
  else if (update.type === "replace") keys = keys.map(key => key === update.previousAccelerator ? update.accelerator : key);
  keys = keys.filter((key, index) => keys.findIndex(other => normalizeAccelerator(other) === normalizeAccelerator(key)) === index);
  if ("accelerator" in update && update.type !== "remove") {
    for (const other of configurableShortcuts) {
      if (other.id === id || shortcutSharesBinding(id, other.id, update.accelerator)) continue;
      const occupied = effectiveBindings(other.id, next, target);
      const remaining = occupied.filter(key => normalizeAccelerator(key) !== normalizeAccelerator(update.accelerator));
      if (occupied.length === remaining.length) continue;
      const otherRecords = next.filter(binding => binding.command === commandId(other.id) && currentVersion(binding));
      next = next.filter(binding => binding.command !== commandId(other.id) || !currentVersion(binding));
      next.push(...(remaining.length ? remaining.map(key => otherRecords.find(record => record.key === key) ?? { command: commandId(other.id), key }) : [{ command: commandId(other.id), key: null }]));
    }
  }
  for (const released of previousKeys.filter(key => !keys.includes(key))) {
    for (const other of configurableShortcuts) {
      if (other.id === id || !defaultBindings(other.id, target).includes(released)) continue;
      const records = next.filter(binding => binding.command === commandId(other.id) && currentVersion(binding));
      if (records.length === 1 && records[0].key === null) next = next.filter(binding => binding.command !== commandId(other.id) || !currentVersion(binding));
    }
  }
  const replacement = update.type === "replace" ? records.find(record => record.key === update.previousAccelerator) : update.type === "set" ? records[0] : undefined;
  if (update.type === "reset") return next;
  const version = ["nextTab", "previousTab"].includes(command) ? { version: 1 as const } : {};
  const updated = keys.map(key => {
    const original = records.find(record => record.key === key) ??
      ("accelerator" in update && key === update.accelerator ? replacement : undefined);
    return { ...original, command, key, ...version };
  });
  return [...next, ...(updated.length ? updated : [{ command, key: null, ...version }])];
}

export function bindingConflict(id: string, accelerator: string, bindings: KeyBinding[], target: NumberShortcutTarget = "tabs"): string | null {
  const normalized = normalizeAccelerator(accelerator);
  if (["ctrl+f", "f3", "shift+f3"].includes(normalized)) return "查找";
  const reserved: Record<string, string> = { "ctrl+o": "打开工作区", "ctrl+q": "退出", "ctrl+r": "重新加载", f11: "全屏", f12: "开发者工具",
    "ctrl+c": "复制", "ctrl+v": "粘贴", "ctrl+x": "剪切", "ctrl+a": "全选", "ctrl+z": "撤销", "ctrl+y": "重做" };
  const first = normalized.split(" ")[0];
  if (reserved[first]) return reserved[first];
  return SHORTCUTS.find(shortcut => shortcut.id !== id && !shortcutSharesBinding(id, shortcut.id, accelerator) &&
    effectiveBindings(shortcut.id, bindings, target).some(key => {
      const other = normalizeAccelerator(key);
      return other === normalized || other.startsWith(`${normalized} `) || normalized.startsWith(`${other} `);
    }))?.label ?? null;
}

interface BindingRead { bindings: KeyBinding[]; warning?: string | null; revision: string }
export function useKeyboardPreferences() {
  const [bindings, setBindings] = useState<KeyBinding[]>([]);
  const [primaryNumberShortcutTarget, setNumberTarget] = useState<NumberShortcutTarget>("tabs");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const pending = useRef(true);
  const alive = useRef(false);
  const capturing = useRef(false);
  const current = useRef<KeyBinding[]>([]);
  const target = useRef<NumberShortcutTarget>("tabs");
  const revision = useRef<string | null>(null);
  const resumeRequested = useRef(false);
  const reloadRequested = useRef(false);
  const sync = (next = current.current, suspended = capturing.current, numberTarget = target.current) =>
    tauriInvoke("shortcut_menu_sync", { accelerators: nativeAccelerators(next, false, numberTarget), capturing: suspended });
  const apply = (result: BindingRead) => {
    current.current = result.bindings;
    revision.current = result.revision;
    if (alive.current) setBindings(result.bindings);
  };
  const read = async () => {
    const result = await tauriInvoke<BindingRead>("keyboard_bindings_read");
    const number = await tauriInvoke<{ value: NumberShortcutTarget }>("keyboard_number_target_read");
    return { result, number: number.value };
  };
  const finishPending = () => {
    pending.current = false;
    if (alive.current) setBusy(false);
    if (resumeRequested.current) { resumeRequested.current = false; void setCapturing(false); }
    else if (reloadRequested.current && alive.current) { reloadRequested.current = false; setRefresh(value => value + 1); }
  };
  const reload = () => {
    if (pending.current) reloadRequested.current = true;
    else setRefresh(value => value + 1);
  };
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void tauriListen("keyboard-bindings-changed", () => { if (!disposed) reload(); }).then(release => {
      if (disposed) release(); else unlisten = release;
    }).catch(reason => { if (!disposed) setError(`监听快捷键变更失败：${String(reason)}`); });
    return () => {
      disposed = true; alive.current = false; unlisten?.();
      resumeRequested.current = true;
      if (!pending.current) { resumeRequested.current = false; void setCapturing(false); }
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    pending.current = true;
    setBusy(true);
    void read().then(async ({ result, number }) => {
      if (cancelled || !alive.current) return;
      apply(result); target.current = number; setNumberTarget(number);
      setError(result.warning ?? null);
      try { await sync(); } catch (reason) { if (!cancelled && alive.current) setError(`已读取，但菜单同步失败，请重新读取重试：${String(reason)}`); }
    }).catch(reason => { if (!cancelled && alive.current) setError(`读取快捷键失败：${String(reason)}`); })
      .finally(() => { if (!cancelled || !alive.current) finishPending(); });
    return () => { cancelled = true; };
  }, [refresh]);

  const save = useCallback(async (next: KeyBinding[]): Promise<boolean> => {
    if (pending.current || revision.current === null) return false;
    pending.current = true; setBusy(true); setError(null);
    let written = false;
    try {
      const saved = await tauriInvoke<BindingRead>("keyboard_bindings_write", { bindings: next, expectedRevision: revision.current });
      written = true; apply(saved);
      const result = await tauriInvoke<BindingRead>("keyboard_bindings_read");
      apply(result);
      if (result.warning || result.revision !== saved.revision) throw Error(result.warning || "保存后文件已再次变化，请检查当前键位");
      try { await sync(); } catch (reason) { throw Error(`菜单同步失败，请重新读取重试：${String(reason)}`); }
      return true;
    } catch (reason) {
      let recovery = "";
      if (!written) {
        try { const result = await tauriInvoke<BindingRead>("keyboard_bindings_read"); apply(result); await sync(); }
        catch (readError) { recovery = `；重新读取失败：${String(readError)}`; }
      }
      if (alive.current) setError(`${written ? "已保存，但确认或菜单同步失败" : "保存快捷键失败，未覆盖当前文件"}：${String(reason)}${recovery}`);
      return false;
    } finally { finishPending(); }
  }, []);

  const saveNumberTarget = async (value: NumberShortcutTarget): Promise<boolean> => {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setError(null);
    let written = false;
    try {
      await tauriInvoke("keyboard_number_target_write", { value }); written = true;
      const result = await tauriInvoke<{ value: NumberShortcutTarget }>("keyboard_number_target_read");
      target.current = result.value;
      if (alive.current) setNumberTarget(result.value);
      if (result.value !== value) throw Error("编号目标读回不一致");
      await sync();
      return true;
    } catch (reason) {
      if (alive.current) setError(`${written ? "编号目标已保存，但确认或菜单同步失败" : "保存编号目标失败"}：${String(reason)}`);
      return false;
    } finally { finishPending(); }
  };
  const setCapturing = async (value: boolean): Promise<boolean> => {
    if (pending.current) { if (!value) resumeRequested.current = true; return false; }
    pending.current = true;
    if (alive.current) setBusy(true);
    try {
      await sync(current.current, value);
      capturing.current = value;
      return true;
    } catch (reason) {
      if (alive.current) setError(`切换快捷键录入失败：${String(reason)}`);
      return false;
    } finally { finishPending(); }
  };
  return { bindings, primaryNumberShortcutTarget, busy, error, capturing, save, saveNumberTarget, setCapturing, reload };
}
export type KeyboardPreferencesState = ReturnType<typeof useKeyboardPreferences>;

import { useCallback, useEffect, useRef, useState } from "react";
import { tauriInvoke } from "./bridge";
import { SHORTCUTS, SHORTCUT_COMMAND_IDS, commandId, defaultBindings, effectiveBindings, normalizeAccelerator, type KeyBinding } from "./shortcuts";

export type BindingUpdate = { type: "set" | "append" | "remove"; accelerator: string } |
  { type: "replace"; accelerator: string; previousAccelerator: string } | { type: "clear" | "reset" };
export const configurableShortcuts = SHORTCUTS.filter(shortcut => SHORTCUT_COMMAND_IDS[shortcut.id] && shortcut.id !== "find-in-chat");
const nativeCommands = ["new-chat", "open-settings", "toggle-sidebar", "toggle-terminal", "toggle-changes",
  "command-palette", "file-search", "zoom-in", "zoom-out", "zoom-reset"];
export function nativeAccelerators(bindings: KeyBinding[], suspended = false): Record<string, string | null> {
  return Object.fromEntries(nativeCommands.map(id => {
    const key = effectiveBindings(id, bindings)[0];
    const native = key?.replace(/\+\+$/, "+Shift+Equal").replace(/(?:Shift\+)?Plus$/, "Shift+Equal").replaceAll("Meta", "Super");
    return [id, suspended || !native || /\s/.test(native) || !/(?:Ctrl|Control|Alt|Meta|Super)\+/i.test(native) ? null : native];
  }));
}

export function updateKeyBindings(bindings: KeyBinding[], id: string, update: BindingUpdate): KeyBinding[] {
  if (!configurableShortcuts.some(shortcut => shortcut.id === id)) throw Error("此动作不可修改快捷键");
  const command = commandId(id);
  let next = bindings.filter(binding => binding.command !== command);
  let keys = effectiveBindings(id, bindings);
  const previousKeys = keys;
  if (update.type === "reset") keys = defaultBindings(id);
  else if (update.type === "clear") keys = [];
  else if (update.type === "set") keys = [update.accelerator, ...keys.slice(1)];
  else if (update.type === "append") keys = [...keys, update.accelerator];
  else if (update.type === "remove") keys = keys.filter(key => key !== update.accelerator);
  else if (update.type === "replace") keys = keys.map(key => key === update.previousAccelerator ? update.accelerator : key);
  keys = [...new Set(keys)];
  if ("accelerator" in update && update.type !== "remove") {
    // The official UI reports conflicts before submitting; file updates also suppress occupied defaults.
    for (const other of configurableShortcuts) {
      if (other.id === id || !effectiveBindings(other.id, next).includes(update.accelerator)) continue;
      const remaining = effectiveBindings(other.id, next).filter(key => key !== update.accelerator);
      next = next.filter(binding => binding.command !== commandId(other.id));
      next.push(...(remaining.length ? remaining.map(key => ({ command: commandId(other.id), key })) : [{ command: commandId(other.id), key: null }]));
    }
  }
  // Releasing an occupied default restores only a disabled default; explicit custom keys stay intact.
  for (const released of previousKeys.filter(key => !keys.includes(key))) {
    for (const other of configurableShortcuts) {
      if (other.id === id || !defaultBindings(other.id).includes(released)) continue;
      const records = next.filter(binding => binding.command === commandId(other.id));
      if (records.length === 1 && records[0].key === null) next = next.filter(binding => binding.command !== commandId(other.id));
    }
  }
  return update.type === "reset" ? next : [...next, ...(keys.length ? keys.map(key => ({ command, key })) : [{ command, key: null }])];
}

export function bindingConflict(id: string, accelerator: string, bindings: KeyBinding[]): string | null {
  const normalized = normalizeAccelerator(accelerator);
  if (["ctrl+f", "f3", "shift+f3"].includes(normalized)) return "查找";
  const reserved: Record<string, string> = { "ctrl+o": "打开工作区", "ctrl+q": "退出", "ctrl+r": "重新加载", f11: "全屏", f12: "开发者工具",
    "ctrl+c": "复制", "ctrl+v": "粘贴", "ctrl+x": "剪切", "ctrl+a": "全选", "ctrl+z": "撤销", "ctrl+y": "重做" };
  if (reserved[normalized]) return reserved[normalized];
  return SHORTCUTS.find(shortcut => shortcut.id !== id &&
    effectiveBindings(shortcut.id, bindings).some(key => normalizeAccelerator(key) === normalized))?.label ?? null;
}

interface BindingRead { bindings: KeyBinding[]; warning?: string | null }
export function useKeyboardPreferences() {
  const [bindings, setBindings] = useState<KeyBinding[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const pending = useRef(true);
  const alive = useRef(true);
  const capturing = useRef(false);
  const current = useRef(bindings);
  const resumeRequested = useRef(false);
  current.current = bindings;
  const sync = (next: KeyBinding[], suspended = capturing.current) =>
    tauriInvoke("shortcut_menu_sync", { accelerators: nativeAccelerators(next, suspended) });
  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    pending.current = true;
    setBusy(true);
    tauriInvoke<BindingRead>("keyboard_bindings_read").then(async result => {
      if (cancelled) return;
      await sync(result.bindings);
      if (!cancelled) { current.current = result.bindings; setBindings(result.bindings); setError(result.warning ?? null); }
    }).catch(reason => { if (!cancelled) setError(`读取快捷键失败：${String(reason)}`); })
      .finally(() => {
        if (!cancelled) {
          pending.current = false; setBusy(false);
          if (resumeRequested.current) { resumeRequested.current = false; void setCapturing(false); }
        }
      });
    return () => { cancelled = true; alive.current = false; };
  }, [refresh]);

  const save = useCallback(async (next: KeyBinding[]): Promise<boolean> => {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError(null);
    let written = false;
    const previous = current.current;
    try {
      await sync(next);
      await tauriInvoke("keyboard_bindings_write", { bindings: next });
      written = true;
      current.current = next;
      if (alive.current) setBindings(next);
      const result = await tauriInvoke<BindingRead>("keyboard_bindings_read");
      const sorted = (bindings: KeyBinding[]) => [...bindings].sort((a, b) => a.command.localeCompare(b.command));
      if (result.warning || JSON.stringify(sorted(result.bindings)) !== JSON.stringify(sorted(next))) throw Error(result.warning || "快捷键读回不一致");
      return true;
    } catch (reason) {
      if (String(reason).includes("Keybindings saved but readback")) {
        written = true;
        current.current = next;
        if (alive.current) setBindings(next);
      }
      let rollback = "";
      if (!written) {
        try { await sync(previous); } catch (error) { rollback = `；菜单恢复失败：${String(error)}`; }
      }
      if (alive.current) setError(`${written ? "已保存，但读取确认失败" : "保存快捷键失败"}：${String(reason)}${rollback}`);
      return written;
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
      if (resumeRequested.current) { resumeRequested.current = false; void setCapturing(false); }
    }
  }, []);

  const setCapturing = async (value: boolean): Promise<boolean> => {
    if (pending.current) { if (!value) resumeRequested.current = true; return false; }
    pending.current = true;
    setBusy(true);
    try {
      await sync(current.current, value);
      capturing.current = value;
      return true;
    } catch (reason) {
      if (alive.current) setError(`切换快捷键录入失败：${String(reason)}`);
      return false;
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
      if (resumeRequested.current) { resumeRequested.current = false; void setCapturing(false); }
    }
  };
  return { bindings, busy, error, capturing, save, setCapturing,
    reload: () => { if (!pending.current) setRefresh(value => value + 1); } };
}
export type KeyboardPreferencesState = ReturnType<typeof useKeyboardPreferences>;

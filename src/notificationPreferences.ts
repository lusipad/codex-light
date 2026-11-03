import { useCallback, useEffect, useRef, useState } from "react";
import { tauriInvoke } from "./bridge";
import type { NotificationSoundTheme } from "./types";

export const NOTIFICATION_DEFAULTS = {
  "notifications-turn-mode": "unfocused" as "off" | "unfocused" | "always",
  "notifications-permissions-enabled": true,
  "notifications-questions-enabled": true,
  "notifications-dot-enabled": true,
  "notifications-sound": "default" as NotificationSound,
};
export type NotificationSound = "default" | "classic" | "none" | "Basso" | "Glass" | "Ping" | "Pop" | "Purr" | "Tink" |
  { fileName: string; name: string };
export type NotificationPreferences = typeof NOTIFICATION_DEFAULTS;
export type NotificationKey = keyof NotificationPreferences;

export function normalizeNotificationValue<K extends NotificationKey>(key: K, value: unknown): NotificationPreferences[K] {
  if (key === "notifications-turn-mode") return (["off", "unfocused", "always"].includes(value as string) ? value : "unfocused") as NotificationPreferences[K];
  if (key === "notifications-sound") {
    if (["default", "classic", "none", "Basso", "Glass", "Ping", "Pop", "Purr", "Tink"].includes(value as string)) return value as NotificationPreferences[K];
    const custom = value as { fileName?: unknown; name?: unknown } | null;
    if (custom && typeof custom.name === "string" && custom.name.trim() && typeof custom.fileName === "string" &&
      /^codex-custom-[a-f0-9]{64}\.(wav|aiff|caf)$/.test(custom.fileName)) return custom as NotificationPreferences[K];
    return "default" as NotificationPreferences[K];
  }
  return (typeof value === "boolean" ? value : true) as NotificationPreferences[K];
}

export function notificationSoundTheme(sound: NotificationSound): NotificationSoundTheme | null {
  return typeof sound === "string" ? sound.toLowerCase() as NotificationSoundTheme : null;
}

export function notificationRequestCategory(request: { method: string; params?: any }): "permission" | "question" {
  return /requestUserInput|ask_user/.test(request.method) || Array.isArray(request.params?.questions)
    ? "question" : "permission";
}

export function shouldNotifyTurn(params: any): boolean {
  return !["failed", "interrupted"].includes(params?.turn?.status) && !params?.hasPendingContinuation &&
    params?.automationNotificationDecision !== "DONT_NOTIFY" &&
    !(params?.automationNotificationDecision == null && params?.heartbeatAssistantMessage?.decision === "DONT_NOTIFY");
}

export type NotificationCategory = "turn" | "permission" | "question" | "dot";
type NotificationEvent = { id: string; category: NotificationCategory; title: string; body: string; threadId?: string; valid?: () => boolean };
export function shouldNotify(preferences: NotificationPreferences, category: NotificationCategory, focused: boolean, visible: boolean): boolean {
  if (category === "turn") return preferences["notifications-turn-mode"] !== "off" &&
    (preferences["notifications-turn-mode"] === "always" || !focused);
  if (category === "dot") return preferences["notifications-dot-enabled"] && !focused;
  return preferences[category === "question" ? "notifications-questions-enabled" : "notifications-permissions-enabled"] &&
    !(focused && visible);
}

export function createNotificationDispatcher(dependencies: {
  preferences: () => NotificationPreferences;
  focused: () => boolean;
  visible: (threadId?: string) => boolean;
  send: (title: string, body: string) => Promise<unknown>;
  play: (sound: NotificationSound, kind: "done" | "nudge") => void;
  onError: (error: unknown) => void;
  nativeClaim?: (event: NotificationEvent) => Promise<{ sound: NotificationSound } | null>;
}) {
  const delivered = new Set<string>();
  return async (event: NotificationEvent) => {
    if (delivered.has(event.id)) return;
    delivered.add(event.id);
    if (delivered.size > 1000) delivered.delete(delivered.values().next().value!);
    // 请求可能在同一事件批次内解决；发送前重新检查当前状态和焦点。
    await Promise.resolve();
    if (event.valid?.() === false) return;
    let sound: NotificationSound;
    if (dependencies.nativeClaim) {
      let claim;
      try { claim = await dependencies.nativeClaim(event); }
      catch (error) { dependencies.onError(error); return; }
      if (!claim || event.valid?.() === false) return;
      sound = normalizeNotificationValue("notifications-sound", claim.sound);
    } else {
      const preferences = dependencies.preferences();
      if (!shouldNotify(preferences, event.category, dependencies.focused(), dependencies.visible(event.threadId))) return;
      sound = preferences["notifications-sound"];
    }
    try { dependencies.play(sound, event.category === "turn" ? "done" : "nudge"); }
    catch (error) { dependencies.onError(error); }
    try { await dependencies.send(event.title, event.body); }
    catch (error) { dependencies.onError(error); }
  };
}

export function useNotificationPreferences() {
  const [preferences, setPreferences] = useState<NotificationPreferences>(NOTIFICATION_DEFAULTS);
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const current = useRef(preferences);
  const pending = useRef(true);
  const alive = useRef(true);
  current.current = preferences;
  const read = async () => {
    const entries = await Promise.all((Object.keys(NOTIFICATION_DEFAULTS) as NotificationKey[]).map(async key =>
      [key, normalizeNotificationValue(key, await tauriInvoke("desktop_state_get", { key }))] as const));
    return Object.fromEntries(entries) as NotificationPreferences;
  };
  useEffect(() => {
    let cancelled = false;
    alive.current = true; pending.current = true; setBusy(true); setReady(false); setError(null);
    read().then(value => { if (!cancelled) { current.current = value; setPreferences(value); setReady(true); } })
      .catch(reason => { if (!cancelled) setError(`读取通知设置失败：${String(reason)}`); })
      .finally(() => { if (!cancelled) { pending.current = false; setBusy(false); } });
    return () => { cancelled = true; alive.current = false; };
  }, [refresh]);
  const save = useCallback(async <K extends NotificationKey>(key: K, value: NotificationPreferences[K]): Promise<boolean> => {
    if (pending.current || JSON.stringify(normalizeNotificationValue(key, value)) !== JSON.stringify(value)) return false;
    pending.current = true; setBusy(true); setError(null);
    const previous = current.current;
    const next = { ...previous, [key]: value };
    current.current = next; setPreferences(next);
    let written = false;
    try {
      await tauriInvoke("desktop_state_set", { key, value }); written = true;
      const result = await tauriInvoke("desktop_state_get", { key });
      if (JSON.stringify(result) !== JSON.stringify(value)) throw Error("通知设置读回不一致");
      return true;
    } catch (reason) {
      if (alive.current) {
        if (!written) { current.current = previous; setPreferences(previous); }
        setError(`${written ? "已保存，但读取确认失败" : "保存通知设置失败"}：${String(reason)}`);
      }
      return written;
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }, []);
  return { preferences, current, busy, ready, error, save, reload: () => { if (!pending.current) setRefresh(value => value + 1); } };
}
export type NotificationState = ReturnType<typeof useNotificationPreferences>;

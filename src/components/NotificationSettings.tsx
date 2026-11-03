import React, { useEffect, useRef, useState } from "react";
import { tauriInvoke } from "../bridge";
import { importNotificationSound, playNotificationChime, stopNotificationSound } from "../sound";
import { type NotificationState, type NotificationSound } from "../notificationPreferences";

type PermissionStatus = "enabled" | "disabled" | "not-determined" | "unknown";

export const NotificationSettings: React.FC<{ state: NotificationState }> = ({ state }) => {
  const [soundError, setSoundError] = useState<string | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionStatus>("unknown");
  const [openingSettings, setOpeningSettings] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const alive = useRef(false);
  const operation = useRef(0);
  const importPending = useRef(false);
  const soundControl = useRef<HTMLSelectElement>(null);
  const restoreSoundFocus = useRef(false);
  const refreshPermission = useRef<(() => Promise<void>) | null>(null);
  const pendingPreview = useRef<NotificationSound | null>(null);
  const sound = state.preferences["notifications-sound"];
  useEffect(() => {
    alive.current = true;
    let query = 0;
    const readPermission = async () => {
      const request = ++query;
      try {
        const result = await tauriInvoke<{ status: PermissionStatus }>("notification_permission_read");
        if (alive.current && request === query) {
          setPermission(["enabled", "disabled", "not-determined"].includes(result.status) ? result.status : "unknown");
        }
      } catch { if (alive.current && request === query) setPermission("unknown"); }
    };
    refreshPermission.current = readPermission;
    void readPermission();
    window.addEventListener("focus", readPermission);
    return () => {
      alive.current = false; query++; operation.current++;
      refreshPermission.current = null;
      window.removeEventListener("focus", readPermission);
      void stopNotificationSound().catch(() => {});
    };
  }, []);
  useEffect(() => {
    const request = ++operation.current;
    const selected = pendingPreview.current;
    pendingPreview.current = null;
    void (async () => {
      try {
        await stopNotificationSound();
        if (alive.current && request === operation.current && selected !== null &&
          JSON.stringify(selected) === JSON.stringify(sound)) await playNotificationChime("done", selected);
      } catch (error) {
        if (alive.current && request === operation.current) setSoundError(`无法试听提示音：${String(error)}`);
      }
    })();
  }, [sound, previewRevision]);
  useEffect(() => {
    if (restoreSoundFocus.current && !importing && !state.busy) {
      restoreSoundFocus.current = false;
      soundControl.current?.focus();
    }
  }, [importing, state.busy]);
  const disabled = state.busy || importing || permission === "disabled";
  const chooseSound = async (value: string) => {
    if (disabled || importPending.current) return;
    const request = ++operation.current;
    setSoundError(null);
    try {
      await stopNotificationSound();
      if (!alive.current || request !== operation.current) return;
      let next: NotificationSound;
      if (value === "import") {
        importPending.current = true; setImporting(true);
        const custom = await importNotificationSound();
        if (!alive.current || request !== operation.current || custom === null) return;
        next = custom;
      } else {
        if (!["default", "classic", "none"].includes(value)) return;
        next = value as NotificationSound;
      }
      const saved = await state.save("notifications-sound", next);
      if (alive.current && !saved) setSoundError("无法更改通知提示音。请重试");
      if (alive.current && saved) {
        pendingPreview.current = next;
        setPreviewRevision(value => value + 1);
      }
    } catch (error) {
      if (alive.current && request === operation.current) setSoundError(`${value === "import"
        ? "无法导入此提示音。请选择时长不超过 30 秒且大小不超过 10 MB 的 MP3、WAV、FLAC 或 Ogg 文件"
        : "无法更改通知提示音。请重试"}：${String(error)}`);
    } finally {
      if (alive.current) {
        restoreSoundFocus.current = importPending.current;
        importPending.current = false; setImporting(false);
      }
    }
  };
  return <div className="card-section">
    <h3>通知</h3>
    {permission === "disabled" && <div className="form-field">
      <span>通知已关闭</span><p className="card-subtitle-desc">在 Windows 设置中开启通知，即可使用下方选项</p>
    </div>}
    {permission === "unknown" && <p className="card-subtitle-desc">无法确认 Windows 通知权限状态</p>}
    {permission === "unknown" && <button type="button" onClick={() => void refreshPermission.current?.()}>重新读取</button>}
    {(permission === "disabled" || permission === "not-determined") && <button type="button" disabled={openingSettings} onClick={async () => {
      setSystemError(null); setOpeningSettings(true);
      try { await tauriInvoke("notification_settings_open"); await refreshPermission.current?.(); }
      catch (error) { if (alive.current) setSystemError(`无法打开 Windows 设置：${String(error)}`); }
      finally { if (alive.current) setOpeningSettings(false); }
    }}>打开 Windows 设置</button>}
    <div className="form-field">
      <label htmlFor="notification-turn-mode">轮次完成通知</label>
      <p className="card-subtitle-desc">设置 ChatGPT 完成后何时提醒你</p>
      <select id="notification-turn-mode" disabled={disabled} value={state.preferences["notifications-turn-mode"]}
        onChange={event => void state.save("notifications-turn-mode", event.target.value as "off" | "unfocused" | "always")}>
        <option value="off">从不</option><option value="unfocused">仅在未聚焦时</option><option value="always">始终</option>
      </select>
    </div>
    {([["notifications-permissions-enabled", "启用权限通知", "在需要通知权限时显示提醒"],
      ["notifications-questions-enabled", "启用问题通知", "在需要回答问题才能继续时显示通知"],
      ["notifications-dot-enabled", "启用 Dot 通知", "当你的 Dot 发来消息时显示提醒"]] as const).map(([key, label, description]) =>
      <div className="form-field" key={key}>
        <label htmlFor={key}>{label}</label>
        <p className="card-subtitle-desc">{description}</p>
        <input id={key} type="checkbox" disabled={disabled} checked={state.preferences[key]}
          onChange={event => void state.save(key, event.target.checked)} />
      </div>)}
    <div className="form-field">
      <label htmlFor="notifications-sound">通知提示音</label>
      <p className="card-subtitle-desc">任务完成、请求权限和提问时的提示音</p>
      <select ref={soundControl} id="notifications-sound" disabled={disabled} value={typeof sound === "string" ? sound : "custom"}
        onChange={event => void chooseSound(event.target.value)}>
        <option value="default">默认</option><option value="classic">经典</option><option value="none">无</option>
        {typeof sound === "string" && !["default", "classic", "none"].includes(sound) && <option value={sound}>{sound}</option>}
        {typeof sound === "object" && <option value="custom">{sound.name}</option>}
        <option value="import">选择自定义提示音…</option>
      </select>
    </div>
    {soundError && <p role="alert">{soundError}</p>}
    {systemError && <p role="alert">{systemError}</p>}
    {state.error && <div role="alert">{state.error}<button type="button" disabled={state.busy} onClick={state.reload}>重新读取</button></div>}
  </div>;
};

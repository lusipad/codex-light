import React, { useEffect, useRef, useState } from "react";
import { tauriInvoke } from "../bridge";
import { importNotificationSound, playNotificationChime, stopNotificationSound } from "../sound";
import { type NotificationState, type NotificationSound } from "../notificationPreferences";
import { GeneralPreferenceSelect } from "./GeneralPreferenceSelect";
import "./NotificationSettings.css";

type PermissionStatus = "enabled" | "disabled" | "not-determined" | "unknown";

export const NotificationSettings: React.FC<{ state: NotificationState }> = ({ state }) => {
  const [soundError, setSoundError] = useState<string | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionStatus>("unknown");
  const [permissionLoading, setPermissionLoading] = useState(true);
  const [openingSettings, setOpeningSettings] = useState(false);
  const [soundBusy, setSoundBusy] = useState(false);
  const alive = useRef(false);
  const operation = useRef(0);
  const soundPending = useRef(false);
  const soundControl = useRef<HTMLButtonElement>(null);
  const turnControl = useRef<HTMLButtonElement>(null);
  const systemControl = useRef<HTMLButtonElement>(null);
  const restorePermissionFocus = useRef(false);
  const restoreSoundFocus = useRef(false);
  const refreshPermission = useRef<(() => Promise<void>) | null>(null);
  const selectedByControl = useRef<NotificationSound | null>(null);
  const sound = state.preferences["notifications-sound"];
  useEffect(() => {
    alive.current = true;
    let query = 0;
    const readPermission = async () => {
      const request = ++query;
      try {
        const result = await tauriInvoke<{ status: PermissionStatus }>("notification_permission_read");
        if (alive.current && request === query) {
          if (systemControl.current && document.activeElement === systemControl.current &&
            !["disabled", "not-determined"].includes(result.status)) restorePermissionFocus.current = true;
          setPermission(["enabled", "disabled", "not-determined"].includes(result.status) ? result.status : "unknown");
        }
      } catch { if (alive.current && request === query) setPermission("unknown"); }
      finally { if (alive.current && request === query) setPermissionLoading(false); }
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
    if (selectedByControl.current !== null && JSON.stringify(selectedByControl.current) === JSON.stringify(sound)) {
      selectedByControl.current = null;
      return;
    }
    const request = ++operation.current;
    void stopNotificationSound().catch(error => {
      if (alive.current && request === operation.current) setSoundError(`无法试听提示音：${String(error)}`);
    });
  }, [sound]);
  useEffect(() => {
    if (restoreSoundFocus.current && !soundBusy && !state.busy) {
      restoreSoundFocus.current = false;
      soundControl.current?.focus();
    }
  }, [soundBusy, state.busy]);
  const permissionBlocked = permission === "disabled" || permission === "not-determined";
  const disabled = state.busy || soundBusy || permissionLoading || permissionBlocked;
  useEffect(() => {
    if (restorePermissionFocus.current && !disabled) {
      restorePermissionFocus.current = false;
      turnControl.current?.focus();
    }
  }, [disabled]);
  const chooseSound = async (value: string) => {
    if (disabled || soundPending.current) return;
    soundPending.current = true; setSoundBusy(true);
    const request = ++operation.current;
    let pickerOpened = false;
    setSoundError(null);
    try {
      let next: NotificationSound;
      if (value === "import") {
        pickerOpened = true;
        const custom = await importNotificationSound();
        if (!alive.current || request !== operation.current || custom === null) return;
        next = custom;
      } else if (value === "custom" && typeof sound === "object") next = sound;
      else {
        if (!["default", "classic", "none"].includes(value) && value !== sound) return;
        next = value as NotificationSound;
      }
      selectedByControl.current = next;
      void playNotificationChime("done", next).catch(error => {
        if (alive.current && request === operation.current) setSoundError(`无法试听提示音：${String(error)}`);
      });
      const saved = await state.save("notifications-sound", next);
      if (alive.current && !saved && request === operation.current) {
        operation.current++; selectedByControl.current = null;
        await stopNotificationSound();
        setSoundError("无法更改通知提示音。请重试");
      }
    } catch (error) {
      if (alive.current && request === operation.current) setSoundError(`${value === "import"
        ? "无法导入此提示音。请选择时长不超过 30 秒且大小不超过 10 MB 的 MP3、WAV、FLAC 或 Ogg 文件"
        : "无法更改通知提示音。请重试"}：${String(error)}`);
    } finally {
      soundPending.current = false;
      if (alive.current) {
        restoreSoundFocus.current = pickerOpened;
        setSoundBusy(false);
      }
    }
  };
  return <section className="notification-settings" aria-labelledby="local-notifications-heading">
    <h3 id="local-notifications-heading">通知</h3>
    <div className="notification-settings-card">
    {permissionBlocked && <div className="notification-permission-banner">
      <div><strong>通知已关闭</strong><p>在 Windows 设置中开启通知，即可使用下方选项</p></div>
      <button ref={systemControl} type="button" disabled={openingSettings} onClick={async () => {
        setSystemError(null); setOpeningSettings(true);
        try { await tauriInvoke("notification_settings_open"); await refreshPermission.current?.(); }
        catch (error) { if (alive.current) setSystemError(`无法打开 Windows 设置：${String(error)}`); }
        finally { if (alive.current) setOpeningSettings(false); }
      }}>打开 Windows 设置</button>
    </div>}
    <div className="notification-setting-row">
      <div><label htmlFor="notification-turn-mode">轮次完成通知</label><p>设置 ChatGPT 完成后何时提醒你</p></div>
      <div className="notification-setting-control"><GeneralPreferenceSelect triggerRef={turnControl} id="notification-turn-mode" label="轮次完成通知" disabled={disabled}
        className="notification-preference-select" value={state.preferences["notifications-turn-mode"]}
        options={[{ value: "off", label: "从不" }, { value: "unfocused", label: "仅在未聚焦时" }, { value: "always", label: "始终" }]}
        onChange={value => void state.save("notifications-turn-mode", value as "off" | "unfocused" | "always")} /></div>
    </div>
    {([["notifications-permissions-enabled", "启用权限通知", "在需要通知权限时显示提醒"],
      ["notifications-questions-enabled", "启用问题通知", "在需要回答问题才能继续时显示通知"],
      ["notifications-dot-enabled", "启用 Dot 通知", "当你的 Dot 发来消息时显示提醒"]] as const).map(([key, label, description]) =>
      <div className="notification-setting-row" key={key}>
        <div><label htmlFor={key}>{label}</label><p>{description}</p></div>
        <div className="notification-setting-control"><input id={key} type="checkbox" role="switch" disabled={disabled} checked={state.preferences[key]}
          onChange={event => void state.save(key, event.target.checked)} /></div>
      </div>)}
    <div className="notification-setting-row">
      <div><label htmlFor="notifications-sound">通知提示音</label><p>任务完成、请求权限和提问时的提示音</p></div>
      <div className="notification-setting-control"><GeneralPreferenceSelect triggerRef={soundControl} id="notifications-sound" label="通知提示音" disabled={disabled}
        className="notification-preference-select" value={typeof sound === "string" ? sound : "custom"}
        onChange={value => void chooseSound(value)} onReselect={() => void chooseSound(typeof sound === "string" ? sound : "custom")}
        options={[{ value: "default", label: "默认" }, { value: "classic", label: "经典" }, { value: "none", label: "无" },
          ...(typeof sound === "object" ? [{ value: "custom", label: sound.name }] :
            !["default", "classic", "none"].includes(sound) ? [{ value: sound, label: sound }] : []),
          { value: "import", label: "选择自定义提示音…" }]} /></div>
    </div>
    {soundError && <p role="alert">{soundError}</p>}
    {systemError && <p role="alert">{systemError}</p>}
    {state.error && <div role="alert">{state.error}<button type="button" disabled={state.busy} onClick={state.reload}>重新读取</button></div>}
    </div>
  </section>;
};

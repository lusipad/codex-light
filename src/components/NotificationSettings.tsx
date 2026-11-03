import React, { useState } from "react";
import { tauriInvoke } from "../bridge";
import { playNotificationChime } from "../sound";
import { notificationSoundTheme, type NotificationState, type NotificationSound } from "../notificationPreferences";

export const NotificationSettings: React.FC<{ state: NotificationState }> = ({ state }) => {
  const [previewError, setPreviewError] = useState<string | null>(null);
  const sound = state.preferences["notifications-sound"];
  return <div className="card-section">
    <h3>通知</h3>
    <div className="form-field">
      <label htmlFor="notification-turn-mode">轮次完成通知</label>
      <select id="notification-turn-mode" disabled={state.busy} value={state.preferences["notifications-turn-mode"]}
        onChange={event => void state.save("notifications-turn-mode", event.target.value as "off" | "unfocused" | "always")}>
        <option value="off">从不</option><option value="unfocused">仅在未聚焦时</option><option value="always">始终</option>
      </select>
    </div>
    {([["notifications-permissions-enabled", "启用权限通知"], ["notifications-questions-enabled", "启用问题通知"]] as const).map(([key, label]) =>
      <div className="form-field" key={key}>
        <label htmlFor={key}>{label}</label>
        <input id={key} type="checkbox" disabled={state.busy} checked={state.preferences[key]}
          onChange={event => void state.save(key, event.target.checked)} />
      </div>)}
    <div className="form-field">
      <label htmlFor="notifications-sound">通知提示音</label>
      <select id="notifications-sound" disabled={state.busy} value={typeof sound === "string" ? sound : "custom"}
        onChange={event => void state.save("notifications-sound", event.target.value as NotificationSound)}>
        <option value="default">默认</option><option value="classic">经典</option><option value="none">无</option>
        {typeof sound === "string" && !["default", "classic", "none"].includes(sound) && <option value={sound}>{sound}</option>}
        {typeof sound === "object" && <option value="custom" disabled>{sound.name}</option>}
      </select>
      <button type="button" disabled={state.busy || typeof sound !== "string" || sound === "none"} onClick={() => {
        try {
          setPreviewError(null);
          const theme = notificationSoundTheme(sound);
          if (theme) playNotificationChime("done", theme);
        } catch (error) { setPreviewError(`无法播放声音预览：${String(error)}`); }
      }}>试听声音</button>
    </div>
    <p className="card-subtitle-desc">自定义声音暂不可用。</p>
    <button type="button" disabled={state.busy} onClick={async () => {
      try { setPreviewError(null); await tauriInvoke("show_desktop_notification", { title: "Codex Native", body: "测试通知" }); }
      catch (error) { setPreviewError(`发送测试通知失败：${String(error)}`); }
    }}>发送测试通知</button>
    {previewError && <p role="alert">{previewError}</p>}
    {state.error && <div role="alert">{state.error}<button type="button" disabled={state.busy} onClick={state.reload}>重新读取</button></div>}
  </div>;
};

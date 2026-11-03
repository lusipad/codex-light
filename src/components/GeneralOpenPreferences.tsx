import React, { useEffect, useRef, useState } from "react";
import { tauriInvoke } from "../bridge";

export interface DesktopOpenPreferences {
  platform: string;
  targets: { id: string; label: string }[];
  preferredTarget: string | null;
  shells: { id: string; label: string }[];
  preferredShell: string;
}

export const GeneralOpenPreferences: React.FC = () => {
  const [preferences, setPreferences] = useState<DesktopOpenPreferences | null>(null);
  const [busy, setBusy] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    setBusy(true);
    setError(null);
    let cancelled = false;
    tauriInvoke<DesktopOpenPreferences>("desktop_open_preferences").then(value => {
      if (!cancelled) setPreferences(value);
    }).catch(reason => {
      if (!cancelled) setError(`读取打开偏好失败：${String(reason)}`);
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; alive.current = false; };
  }, [refresh]);

  const savePreference = async (kind: "target" | "shell", value: string) => {
    if (pending.current || !preferences || busy) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    let written = false;
    try {
      await tauriInvoke("desktop_open_preference_set", { kind, value });
      written = true;
      const saved = await tauriInvoke<DesktopOpenPreferences>("desktop_open_preferences");
      if ((kind === "target" ? saved.preferredTarget : saved.preferredShell) !== value) {
        throw new Error("保存后的偏好读回不一致");
      }
      if (alive.current) setPreferences(saved);
    } catch (reason) {
      if (alive.current) setError(`${written ? "已保存，但读取确认失败，请重新读取" : "更新打开偏好失败"}：${String(reason)}`);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return <>
    <div className="form-field">
      <label htmlFor="default-open-target">默认文件打开位置</label>
      <p className="card-subtitle-desc">默认打开文件和文件夹的位置</p>
      <select id="default-open-target" disabled={busy || !preferences?.targets.length}
        value={preferences?.preferredTarget ?? ""}
        onChange={event => void savePreference("target", event.target.value)}>
        {!preferences?.targets.length && <option value="">未找到目标</option>}
        {preferences?.targets.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}
      </select>
    </div>
    {preferences?.platform === "windows" && <div className="form-field">
      <label htmlFor="integrated-terminal-shell">集成终端 Shell</label>
      <p className="card-subtitle-desc">选择要在集成终端中打开的 Shell。</p>
      <select id="integrated-terminal-shell" disabled={busy} value={preferences.preferredShell}
        onChange={event => void savePreference("shell", event.target.value)}>
        {preferences.shells.map(shell => <option key={shell.id} value={shell.id}>{shell.label}</option>)}
      </select>
    </div>}
    {error && <div role="alert">{error}<button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>重新读取</button></div>}
  </>;
};

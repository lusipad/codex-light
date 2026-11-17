import React, { useEffect, useRef, useState } from "react";
import { tauriInvoke } from "../bridge";
import { GeneralPreferenceSelect } from "./GeneralPreferenceSelect";
import "./SettingsGeneralRows.css";

export interface DesktopOpenPreferences {
  platform: string;
  targets: { id: string; label: string }[];
  preferredTarget: string | null;
  shells: { id: string; label: string }[];
  preferredShell: string;
  defaultTerminalLocation: "bottom" | "right";
}

export interface BottomPanelLauncherPreference {
  visible: boolean;
  busy: boolean;
  save: (visible: boolean) => void;
}

export const GeneralOpenPreferences: React.FC<{ bottomPanelLauncher?: BottomPanelLauncherPreference }> = ({ bottomPanelLauncher } = {}) => {
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

  const savePreference = async (kind: "target" | "shell" | "terminal-location", value: string) => {
    if (pending.current || !preferences || busy) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    let written = false;
    try {
      await tauriInvoke("desktop_open_preference_set", { kind, value });
      written = true;
      const saved = await tauriInvoke<DesktopOpenPreferences>("desktop_open_preferences");
      const confirmed = kind === "target" ? saved.preferredTarget
        : kind === "shell" ? saved.preferredShell : saved.defaultTerminalLocation;
      if (confirmed !== value) {
        throw new Error("保存后的偏好读回不一致");
      }
      if (alive.current) setPreferences(saved);
    } catch (reason) {
      if (alive.current) setError(`${written ? "已保存，但读取确认失败，请重新读取" :
        kind === "terminal-location" ? "未能保存终端位置偏好设置" : "更新打开偏好失败"}：${String(reason)}`);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return <>
    <div className="settings-general-row">
      <div className="settings-general-copy">
        <label htmlFor="default-open-target">默认文件打开位置</label>
        <p>默认打开文件和文件夹的位置</p>
      </div>
      <div className="settings-general-control">
        <GeneralPreferenceSelect id="default-open-target" label="默认文件打开位置" disabled={busy || !preferences?.targets.length}
          value={preferences?.preferredTarget ?? ""}
          options={preferences?.targets.map(target => ({ value: target.id, label: target.label })) ?? []}
          onChange={value => void savePreference("target", value)} />
      </div>
    </div>
    {preferences?.platform === "windows" && <div className="settings-general-row">
      <div className="settings-general-copy">
        <label htmlFor="integrated-terminal-shell">集成终端 Shell</label>
        <p>选择要在集成终端中打开的 Shell。</p>
      </div>
      <div className="settings-general-control">
        <GeneralPreferenceSelect id="integrated-terminal-shell" label="集成终端 Shell" disabled={busy}
          placeholder="无可用 Shell" value={preferences.preferredShell}
          options={preferences.shells.map(shell => ({ value: shell.id, label: shell.label }))}
          onChange={value => void savePreference("shell", value)} />
      </div>
    </div>}
    {bottomPanelLauncher && <div className="settings-general-row">
      <div className="settings-general-copy">
        <label htmlFor="bottom-panel-launcher">底部面板</label>
        <p id="bottom-panel-launcher-description">在应用标题栏中显示底部面板控件</p>
      </div>
      <div className="settings-general-control">
        <div className="bottom-panel-launcher-setting">
          <label className="switch-control">
            <input id="bottom-panel-launcher" type="checkbox" role="switch" checked={bottomPanelLauncher.visible}
              aria-describedby="bottom-panel-launcher-description" aria-disabled={bottomPanelLauncher.busy}
              onChange={event => bottomPanelLauncher.save(event.target.checked)} />
            <span className="switch-slider" aria-hidden="true" />
          </label>
        </div>
      </div>
    </div>}
    {bottomPanelLauncher?.visible !== false && <div className="settings-general-row">
      <div className="settings-general-copy">
        <span id="default-terminal-location-label">默认终端位置</span>
        <p id="default-terminal-location-description">选择终端快捷键和环境操作在何处打开终端标签页</p>
      </div>
      <div className="settings-general-control">
        <div className="terminal-location-options" role="group" aria-labelledby="default-terminal-location-label"
          aria-describedby="default-terminal-location-description">
          {([["bottom", "底部"], ["right", "右侧"]] as const).map(([value, label]) =>
            <button key={value} type="button" aria-pressed={preferences?.defaultTerminalLocation === value}
              disabled={!preferences} aria-disabled={busy} onClick={() => {
                if (preferences?.defaultTerminalLocation !== value) void savePreference("terminal-location", value);
              }}>{label}</button>)}
        </div>
      </div>
    </div>}
    {error && <div className="settings-general-row" role="alert">
      <span className="settings-general-copy">{error}</span>
      <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>重新读取</button>
    </div>}
  </>;
};

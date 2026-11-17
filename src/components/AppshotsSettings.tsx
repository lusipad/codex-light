import React from "react";
import { GeneralPreferenceSelect } from "./GeneralPreferenceSelect";
import "./AppshotsSettings.css";

export interface AppshotsSettingsViewProps {
  available: boolean;
  configuredHotkey: string | null;
  supported: boolean | null;
  hotkeyPending: boolean;
  hotkeyError: string | null;
  destination: string;
  miniFeature: boolean | null;
  onHotkeyChange: (value: "DoubleAlt" | "DoubleShift" | null) => void;
  onDestinationChange: (value: "automatic" | "last-chat" | "new-chat") => void;
}

const hotkeys = [
  { value: "DoubleAlt", label: "Alt + Alt" },
  { value: "DoubleShift", label: "Shift + Shift" },
  { value: "none", label: "无" },
];

/** Windows B4 partial consumer. Sound, licensed artwork/video and paired visual
 * acceptance are separate outstanding work, not simulated controls here. */
export function AppshotsSettingsView(props: AppshotsSettingsViewProps) {
  if (!props.available) return null;
  const hotkeyValue = props.configuredHotkey === null ? "none"
    : props.configuredHotkey === "DoubleAlt" || props.configuredHotkey === "DoubleShift"
      ? props.configuredHotkey : `custom:${props.configuredHotkey}`;
  const hotkeyDescription = props.configuredHotkey === "DoubleAlt" ? "同时按下两个 Alt 键"
    : props.configuredHotkey === "DoubleShift" ? "同时按下两个 Shift 键" : null;
  const destinations = [
    { value: "automatic", label: "自动", description: props.miniFeature === true
      ? "如果最近使用过当前聊天，则继续使用；否则开始新聊天。在 Mini 中始终开始新聊天"
      : "如果当前聊天最近使用过，则使用当前聊天；否则开始新聊天" },
    { value: "last-chat", label: "当前聊天", description: "始终使用当前聊天" },
    { value: "new-chat", label: "新聊天", description: "始终开始新聊天" },
  ];
  return <section className="settings-scroll-container appshots-settings" aria-labelledby="appshots-settings-title">
    <h2 id="appshots-settings-title">应用快照</h2>
    <div className="appshots-settings-hero">
      <h3>截取应用快照，向 ChatGPT 展示最前面的窗口</h3>
      <p>应用快照包含视觉和文本内容，包括滚动到屏幕外的文本。</p>
    </div>
    <div className="appshots-settings-grid"><div className="appshots-settings-group">
      {props.supported !== false && <div className="appshots-settings-row">
        <div className="appshots-settings-copy"><label htmlFor="appshots-hotkey">快捷键</label>
          {hotkeyDescription && <p>{hotkeyDescription}</p>}
          {props.hotkeyError !== null && <p className="appshots-settings-error" role="alert">{props.hotkeyError}</p>}
        </div>
        <div className="appshots-settings-control"><GeneralPreferenceSelect id="appshots-hotkey" label="快捷键"
          value={hotkeyValue} placeholder={props.configuredHotkey ?? "无"} options={hotkeys}
          disabled={props.hotkeyPending} className="appshots-hotkey-select"
          onChange={value => {
            const next = value === "none" ? null : value === "DoubleAlt" || value === "DoubleShift" ? value : undefined;
            if (!props.hotkeyPending && next !== undefined) props.onHotkeyChange(next);
          }} onReselect={() => {
            if (!props.hotkeyPending && (props.configuredHotkey === null || props.configuredHotkey === "DoubleAlt" || props.configuredHotkey === "DoubleShift")) props.onHotkeyChange(props.configuredHotkey);
          }} /></div>
      </div>}
      <div className="appshots-settings-row">
        <div className="appshots-settings-copy"><label htmlFor="appshots-destination">应用快照目标位置</label>
          <p>选择使用快捷键时将应用快照发送到哪里</p>
        </div>
        <div className="appshots-settings-control"><GeneralPreferenceSelect id="appshots-destination" label="应用快照目标位置"
          value={props.destination} placeholder="自动" options={destinations} className="appshots-destination-select"
          onChange={value => {
            if (value === "automatic" || value === "last-chat" || value === "new-chat") props.onDestinationChange(value);
          }} onReselect={() => {
            if (props.destination === "automatic" || props.destination === "last-chat" || props.destination === "new-chat") props.onDestinationChange(props.destination);
          }} /></div>
      </div>
    </div></div>
  </section>;
}

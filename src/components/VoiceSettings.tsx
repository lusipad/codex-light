import React from "react";

export function VoiceSettings() {
  return <div className="settings-scroll-container">
    <div className="card-section">
      <p role="status">尚未连接官方语音设置服务，无法读取语音语言、声音或实时语音访问权限。</p>
      <p className="card-subtitle-desc">当前输入框提供浏览器 Web Speech 听写回退，是否可用取决于浏览器或 WebView 及其麦克风权限。该回退仅插入草稿，使用浏览器语言，不会自动发送。</p>
      <p className="card-subtitle-desc">官方麦克风设备选择、语音聊天、全局听写快捷键和词典尚未接入。</p>
    </div>
  </div>;
}

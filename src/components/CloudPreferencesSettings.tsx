import React from "react";

export function CloudPreferencesSettings() {
  return <div className="settings-scroll-container"><div className="card-section">
    <h3>云端偏好</h3>
    <p role="status">尚未连接云端偏好服务，无法读取或修改云端聊天的差异视图和分支格式。</p>
    <p className="card-subtitle-desc">分支格式可用的占位符与长度限制需要由实际服务返回。当前没有可用的云端配置读写入口。</p>
  </div></div>;
}

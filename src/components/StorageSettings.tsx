import React from "react";

export function StorageSettings() {
  return <div className="settings-scroll-container">
    <div className="card-section" role="status">
      <p>无法加载存储空间使用情况</p>
      <p className="card-subtitle-desc">当前版本尚未连接云端存储服务，暂时无法查看文件和图像的存储配额或管理已保存的项目。</p>
    </div>
  </div>;
}

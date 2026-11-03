import React from "react";
import "./LibraryView.css";

export const LibraryView: React.FC = () => (
  <div className="library-view-container">
    <div className="library-view-header">
      <div><h2>资料库</h2></div>
    </div>
    <section className="card-section" aria-label="资料库服务状态">
      <h3>资料库服务尚未连接</h3>
      <p role="status">暂时无法读取资料库或上传文件。收藏、下载和文件管理需要连接资料库服务后才能使用。</p>
    </section>
  </div>
);

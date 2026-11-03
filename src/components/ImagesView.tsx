import React from "react";
import "./ImagesView.css";

export const ImagesView: React.FC = () => (
  <div className="images-view-container">
    <div className="images-view-header"><div><h2>图像</h2></div></div>
    <section className="card-section" aria-label="图像服务状态">
      <h3>图像服务尚未连接</h3>
      <p role="status">暂时无法加载图像模板或“我的图像”。生成、编辑和云端图库需要连接图像服务后才能使用。</p>
    </section>
  </div>
);

import React from "react";

export function ComputerUseSettings({ onManagePlugins }: { onManagePlugins: () => void }) {
  return <div className="settings-scroll-container"><div className="card-section">
    <h3>电脑操控</h3>
    <p role="status">尚未连接电脑操控的原生权限和应用控制服务，无法读取可操控应用及授权状态。</p>
    <p className="card-subtitle-desc">可在插件设置中查看和管理已安装插件。安装插件后的操控能力仍需对应主机工具与权限支持。</p>
    <button type="button" className="secondary-btn" onClick={onManagePlugins}>管理插件</button>
  </div></div>;
}

export function AppshotsSettings() {
  return <div className="settings-scroll-container"><div className="card-section">
    <h3>Appshots</h3>
    <p role="status">尚未接入官方前台窗口捕获、屏外文本及全局快捷键服务。</p>
    <p className="card-subtitle-desc">输入框附件菜单的“截屏”可捕获主屏幕并添加为图片附件；它仅捕获屏幕像素，不会读取应用屏外文本。</p>
  </div></div>;
}

export function BrowserUseSettings() {
  return <div className="settings-scroll-container"><div className="card-section">
    <h3>浏览器</h3>
    <p role="status">尚未连接内置浏览器服务，无法读取浏览记录、下载、扩展或站点权限。</p>
    <p className="card-subtitle-desc">浏览器连接与操控需要实际主机能力支持，当前无法通过设置本地 CDP 端口或开关启用。</p>
  </div></div>;
}

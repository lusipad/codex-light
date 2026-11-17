import React from "react";
import { useAppshotsSettings } from "../useAppshotsSettings";
import { AppshotsSettingsView } from "./AppshotsSettings";

export function ComputerUseSettings({ onManagePlugins }: { onManagePlugins: () => void }) {
  return <div className="settings-scroll-container"><div className="card-section">
    <p role="status">尚未连接电脑操控的原生权限和应用控制服务，无法读取可操控应用及授权状态。</p>
    <p className="card-subtitle-desc">可在插件设置中查看和管理已安装插件。安装插件后的操控能力仍需对应主机工具与权限支持。</p>
    <button type="button" className="secondary-btn" onClick={onManagePlugins}>管理插件</button>
  </div></div>;
}

export function AppshotsSettings({ scope, connected, onError }: { scope: string; connected: boolean; onError?: (message: string) => void }) {
  const settings = useAppshotsSettings({ scope, connected, onError });
  return <AppshotsSettingsView {...settings} />;
}

export function BrowserUseSettings() {
  return <div className="settings-scroll-container"><div className="card-section">
    <p role="status">尚未连接内置浏览器服务，无法读取浏览记录、下载、扩展或站点权限。</p>
    <p className="card-subtitle-desc">浏览器连接与操控需要实际主机能力支持，当前无法通过设置本地 CDP 端口或开关启用。</p>
  </div></div>;
}

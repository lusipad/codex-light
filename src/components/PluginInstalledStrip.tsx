import React, { useEffect, useRef, useState } from "react";
import { Settings2 } from "lucide-react";
import { pluginDisplayName, type PluginSummary } from "../plugins";
import { PluginLogo } from "./PluginLogo";
import "./PluginInstalledStrip.css";

export type PluginInstalledStripItem = { key: string; plugin: PluginSummary; href: string };

export function pluginInstalledStripLayout(width: number | null, count: number) {
  if (width === null) return { visible: 0, remaining: count };
  const capacity = Math.max(1, Math.floor(width / 44));
  const visible = capacity >= count ? count : capacity - 1;
  return { visible, remaining: count - visible };
}

export function PluginInstalledStrip({ items, loading = false, error = null, onOpen, onManage,
  manageHref = "/settings/plugins-settings" }: {
  items: PluginInstalledStripItem[];
  loading?: boolean;
  error?: string | null;
  onOpen: (item: PluginInstalledStripItem, event: React.MouseEvent<HTMLAnchorElement>) => void;
  onManage?: () => void;
  manageHref?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const present = !loading && !error && items.length > 0;
  useEffect(() => {
    setWidth(null);
    const element = row.current;
    if (!present || !element) return;
    let active = true;
    const measure = () => { if (active) setWidth(element.getBoundingClientRect().width); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => {
      if (active && entries[0]) setWidth(entries[0].contentRect.width);
    });
    observer?.observe(element);
    window.addEventListener("resize", measure);
    measure();
    return () => { active = false; observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [present]);
  if (loading) return <section id="plugins-connected" className="pis-section" role="status">
    <span className="pis-sr-only">正在加载插件…</span>
    <div className="pis-header pis-loading-header"><span className="pis-heading-skeleton" aria-hidden="true" /></div>
    <div className="pis-padding"><div className="pis-skeleton-row" aria-hidden="true">
      {[0, 1, 2].map(key => <span key={key} className="pis-skeleton" />)}
    </div></div>
  </section>;
  if (error) return <div className="pis-error" role="alert">{error}</div>;
  if (!items.length) return null;
  const { visible, remaining } = pluginInstalledStripLayout(width, items.length);
  const manage = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (onManage && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault(); onManage();
    }
  };
  return <section id="plugins-connected" className="pis-section">
    <header className="pis-header"><h2>已安装</h2>
      {onManage && <a className="pis-manage" href={manageHref} aria-label="管理" onClick={manage}><Settings2 size={16} /><span className="pis-label" aria-hidden="true">管理</span></a>}
    </header>
    <div className="pis-padding"><div className="pis-row" ref={row}>
      {items.slice(0, visible).map(item => <a key={item.key} className="pis-slot" href={item.href}
        aria-label={pluginDisplayName(item.plugin)} onClick={event => onOpen(item, event)}
        onAuxClick={event => { if (event.button === 1) onOpen(item, event); }}>
        <span className="pis-tile"><PluginLogo plugin={item.plugin} className="pis-logo" /></span>
        <span className="pis-label" aria-hidden="true">{pluginDisplayName(item.plugin)}</span>
      </a>)}
      {width !== null && remaining > 0 && onManage && <a className="pis-slot" href={manageHref}
        aria-label={`另有 ${remaining} 个已连接插件`} onClick={manage}>
        <span className="pis-tile pis-overflow">{items.slice(visible, visible + 4).map(item =>
          <PluginLogo key={item.key} plugin={item.plugin} className="pis-mini-logo" />)}</span>
        <span className="pis-label" aria-hidden="true">另有 {remaining} 个</span>
      </a>}
    </div></div>
  </section>;
}

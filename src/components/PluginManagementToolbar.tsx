import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { ManagementTab } from "../pluginManagementState";
import "./PluginManagementToolbar.css";

const searchLabels: Record<ManagementTab, string> = {
  plugins: "搜索插件", apps: "搜索应用", mcp: "搜索 MCP 服务器", skills: "搜索技能", marketplaces: "搜索市场",
};

export function PluginManagementToolbar({ tabs, selected, onSelect, query, onQueryChange }: {
  tabs: { id: ManagementTab; label: string; count: number }[];
  selected: ManagementTab;
  onSelect: (tab: ManagementTab) => void;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const group = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const changed = () => setWide(media.matches);
    changed(); media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useLayoutEffect(() => {
    const element = group.current;
    if (!element) return;
    let active = true;
    const reveal = () => {
      if (!active) return;
      const button = element.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      if (!button) return;
      const left = button.offsetLeft, right = left + button.offsetWidth;
      if (left < element.scrollLeft) element.scrollLeft = left;
      else if (right > element.scrollLeft + element.clientWidth) element.scrollLeft = right - element.clientWidth;
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reveal);
    observer?.observe(element);
    element.querySelectorAll("button").forEach(button => observer?.observe(button));
    reveal();
    return () => { active = false; observer?.disconnect(); };
  }, [tabs, selected]);
  useEffect(() => {
    if (!wide) return;
    const find = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f" || event.isComposing || event.keyCode === 229) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (input.current) { event.preventDefault(); input.current.focus(); }
    };
    window.addEventListener("keydown", find);
    return () => window.removeEventListener("keydown", find);
  }, [wide]);
  const label = searchLabels[selected];
  return <div className="pmt-toolbar">
    <div className="pmt-segments" role="group" aria-label="管理扩展程序" ref={group}
      onWheel={event => { const delta = event.deltaX || event.deltaY; if (delta) event.currentTarget.scrollLeft += delta; }}>
      {tabs.map(tab => <button type="button" key={tab.id} aria-pressed={tab.id === selected}
        className="pmt-segment" onClick={() => onSelect(tab.id)}>{tab.label}<span className="pmt-count">{tab.count}</span></button>)}
    </div>
    {wide && <label className="pmt-search"><Search size={16} aria-hidden="true" />
      <input ref={input} type="search" aria-label={label} placeholder={label} value={query}
        onChange={event => onQueryChange(event.target.value)} />
    </label>}
  </div>;
}

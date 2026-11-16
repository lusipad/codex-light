import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import "./PluginManagementActions.css";

export function PluginManagementActions({ onAddMarketplace, onAddMcp }: {
  onAddMarketplace?: () => void;
  onAddMcp: () => void;
}) {
  const [open, setOpen] = useState(false), [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 320 });
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), firstFocus = useRef(0);
  const multiple = Boolean(onAddMarketplace);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!multiple) setOpen(false);
    else if (open) menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[firstFocus.current]?.focus();
  }, [open, multiple]);
  useLayoutEffect(() => {
    if (!open || !multiple) return;
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      if (rect.bottom < 0 || rect.top > window.innerHeight) { setOpen(false); return; }
      const width = menu.current?.offsetWidth || 220, height = Math.min(menu.current?.offsetHeight || 320, 320);
      const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12, upward = below < height && above > below;
      const maxHeight = Math.max(32, Math.min(320, upward ? above : below));
      setPosition({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        top: upward ? Math.max(8, rect.top - Math.min(height, maxHeight) - 4) : rect.bottom + 4, maxHeight });
    };
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    update(); document.addEventListener("pointerdown", outside); window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open, multiple]);
  const show = (index: number) => { firstFocus.current = index; setOpen(true); };
  const blur = (event: React.FocusEvent<HTMLElement>) => {
    if (!trigger.current?.contains(event.relatedTarget) && !menu.current?.contains(event.relatedTarget)) setOpen(false);
  };
  return <div className="pma-actions" onBlur={blur}>
    <button type="button" className="pma-trigger" ref={trigger}
      aria-haspopup={multiple ? "menu" : undefined} aria-expanded={multiple ? open : undefined}
      aria-controls={multiple && open ? "plugin-management-add-menu" : undefined}
      onClick={() => { if (!multiple) onAddMcp(); else if (open) close(); else show(0); }}
      onKeyDown={event => {
        if (!multiple || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(event.key === "ArrowUp" ? 1 : 0); }
        else if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); }
      }}>
      {multiple ? <>添加<ChevronDown size={12} aria-hidden="true" /></> : "添加 MCP 服务器"}
    </button>
    {multiple && open && createPortal(<div id="plugin-management-add-menu" className="pma-menu" ref={menu} role="menu" aria-label="添加"
      style={position} onBlur={blur} onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
        if (event.key === "Tab") { setOpen(false); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
        const index = items.indexOf(event.target as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
      <button type="button" role="menuitem" onClick={() => { close(); onAddMarketplace?.(); }}>添加插件市场</button>
      <button type="button" role="menuitem" onClick={() => { close(); onAddMcp(); }}>添加 MCP 服务器</button>
    </div>, document.body)}
  </div>;
}

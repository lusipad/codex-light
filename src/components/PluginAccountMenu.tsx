import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, MoreHorizontal, Pencil, Unplug } from "lucide-react";
import "./GeneralPreferenceSelect.css";
import "./PluginAccountMenu.css";

export function PluginAccountMenu({ identity, linkId, accountName, nickname, pending, disconnecting, onRename, onDisconnect }: {
  identity: string; linkId: string; accountName: string; nickname?: string | null; pending: boolean; disconnecting: boolean;
  onRename?: (() => void) | null; onDisconnect: () => void;
}) {
  const id = `plugin-account-${useId()}`, scope = JSON.stringify([identity, linkId]);
  const [open, setOpen] = useState(false), [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 320 });
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), initialFocus = useRef(0), active = useRef(false), opening = useRef(0);
  const token = useRef({ scope }), mounted = useRef(true), latest = useRef({ pending, disconnecting, onRename, onDisconnect });
  if (token.current.scope !== scope) token.current = { scope };
  const generation = token.current, cycle = opening.current; latest.current = { pending, disconnecting, onRename, onDisconnect };
  const available = () => mounted.current && token.current === generation && !latest.current.pending && !latest.current.disconnecting;
  const close = (restore = true) => { active.current = false; opening.current++; setOpen(false); if (restore && trigger.current?.isConnected !== false) trigger.current?.focus(); };
  useLayoutEffect(() => {
    mounted.current = true; active.current = false; setOpen(false);
    return () => { mounted.current = false; active.current = false; };
  }, [generation]);
  useLayoutEffect(() => {
    if (!open || pending || disconnecting) { active.current = false; if (open) setOpen(false); return; }
    const updatePosition = () => {
      if (!available() || !active.current) return;
      const rect = trigger.current?.getBoundingClientRect(); if (!rect) return;
      if (rect.bottom < 0 || rect.top > window.innerHeight) { close(false); return; }
      const width = menu.current?.offsetWidth || 220, height = Math.min(menu.current?.offsetHeight || 320, 320);
      const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12, upward = below < height && above > below;
      const maxHeight = Math.max(32, Math.min(320, upward ? above : below));
      setPosition({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        top: upward ? Math.max(8, rect.top - Math.min(height, maxHeight) - 4) : rect.bottom + 4, maxHeight });
    };
    const outside = (event: PointerEvent) => { if (available() && active.current && !trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) close(); };
    updatePosition(); menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[initialFocus.current]?.focus();
    document.addEventListener("pointerdown", outside); window.addEventListener("resize", updatePosition); window.addEventListener("scroll", updatePosition, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", updatePosition); window.removeEventListener("scroll", updatePosition, true); };
  }, [open, pending, disconnecting, generation, Boolean(onRename)]);
  const show = (last = false) => {
    if (!available()) return; initialFocus.current = last && latest.current.onRename ? 1 : 0;
    if (active.current) { menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[initialFocus.current]?.focus(); return; }
    opening.current++; active.current = true; setOpen(true);
  };
  const choose = (rename: boolean) => {
    if (!available() || !active.current || opening.current !== cycle) return;
    const callback = rename ? latest.current.onRename : latest.current.onDisconnect;
    close(); callback?.();
  };
  const composing = (event: React.KeyboardEvent) => event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
  return <div className="plugin-account-menu" onClick={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
    <button ref={trigger} id={id} type="button" className="plugin-account-menu-trigger" aria-label={`${accountName} 的操作`}
      aria-labelledby={nickname ? `${id} ${id}-nickname` : undefined} aria-haspopup="menu" aria-expanded={open && !pending && !disconnecting}
      aria-controls={open && !pending && !disconnecting ? `${id}-menu` : undefined} aria-busy={disconnecting} disabled={pending || disconnecting}
      onClick={event => { event.stopPropagation(); if (!available()) return; if (active.current) close(); else show(); }}
      onKeyDown={event => { event.stopPropagation(); if (composing(event)) { if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) event.preventDefault(); return; }
        if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); show(event.key === "ArrowUp"); } }}>
      {disconnecting ? <Loader2 size={16} className="pm-spin" aria-hidden="true" /> : <MoreHorizontal size={16} aria-hidden="true" />}
    </button>{nickname && <span id={`${id}-nickname`} className="plugin-account-menu-nickname">{nickname}</span>}
    {open && !pending && !disconnecting && createPortal(<div ref={menu} id={`${id}-menu`} role="menu" aria-label={`${accountName} 的操作`}
      className="general-preference-menu plugin-account-menu-popup" style={position}
      onClick={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation(); if (!available() || !active.current || opening.current !== cycle) return;
        if (composing(event)) { if (["Enter", " ", "Escape"].includes(event.key)) event.preventDefault(); return; }
        if (event.key === "Escape") { event.preventDefault(); close(); return; }
        if (event.key === "Tab") { close(false); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []), index = items.indexOf(event.target as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
      {onRename && <button type="button" role="menuitem" onClick={event => { event.stopPropagation(); choose(true); }}><Pencil size={14} aria-hidden="true" /><span>重命名账户</span></button>}
      <button type="button" role="menuitem" className="plugin-account-menu-danger" onClick={event => { event.stopPropagation(); choose(false); }}><Unplug size={14} aria-hidden="true" /><span>断开连接</span></button>
    </div>, document.body)}
  </div>;
}

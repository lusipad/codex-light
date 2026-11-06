import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Copy, ExternalLink, Globe, Lock, Users, X } from "lucide-react";
import { SiteSharingState } from "../siteSharingState";
import { copyTextToClipboard } from "../clipboard";
import type { SiteSharingMode, SiteSharingPolicy } from "../siteSharingData";
import type { SitesClientAccess } from "../sitesClient";
import "./SiteSharingDialog.css";

interface Props { access: SitesClientAccess; siteId: string; siteTitle?: string | null; scope: AbortSignal; open: boolean;
  onClose: () => void; onPolicy?: (policy: SiteSharingPolicy | null) => void | Promise<void>; onError?: (message: string) => void }
const labels: Record<SiteSharingMode, string> = { admins_only: "仅限我自己", custom: "仅限受邀者", workspace_all: "此工作区内收到链接的任何人", public: "互联网上的任何人" };
export function SiteSharingDialog({ access, siteId, siteTitle, scope, open, onClose, onPolicy = () => {}, onError }: Props) {
  const state = useMemo(() => new SiteSharingState(access, siteId, scope, onPolicy, onError), [scope, siteId, access.identity.accountId, access.identity.userId, access.identity.generation]);
  state.onPolicy = onPolicy; state.onError = onError;
  const [, update] = useState(0), [copied, setCopied] = useState<boolean | null>(null), [modeOpen, setModeOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null), modeTrigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), trigger = useRef<HTMLElement | null>(null), wasOpen = useRef(false), live = useRef({ open, scope, state }); live.current = { open, scope, state };
  const [position, setPosition] = useState({ left: 0, top: 0, width: 420, maxHeight: 1200 });
  useEffect(() => { live.current = { open, scope, state }; setCopied(null); setModeOpen(false); const unsubscribe = state.subscribe(() => update(n => n + 1)); state.attach(); return () => { live.current.open = false; unsubscribe(); state.dispose(); }; }, [state]);
  useEffect(() => { state.setOpen(open); if (open && !wasOpen.current) { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; dialog.current?.showModal(); }
    if (!open && wasOpen.current) { const active = document.activeElement, returnFocus = active === document.body || dialog.current?.contains(active); dialog.current?.close(); if (returnFocus && trigger.current?.isConnected) trigger.current.focus(); setCopied(null); setModeOpen(false); } wasOpen.current = open;
  }, [state, open]);
  useEffect(() => { if (modeOpen) menu.current?.querySelector<HTMLButtonElement>("[aria-checked=true]:not(:disabled),[role=menuitemradio]:not(:disabled)")?.focus(); }, [modeOpen]);
  useLayoutEffect(() => {
    if (!modeOpen) return;
    const reposition = () => {
      const anchor = modeTrigger.current?.getBoundingClientRect(), frame = dialog.current?.getBoundingClientRect(); if (!anchor || !frame) return;
      if (anchor.bottom < 0 || anchor.top > window.innerHeight) { setModeOpen(false); return; }
      const width = Math.min(420, window.innerWidth - 24), height = Math.min(menu.current?.offsetHeight || 240, 1200), below = window.innerHeight - anchor.bottom - 35, above = anchor.top - 35;
      const upwards = below < height && above > below, maxHeight = Math.max(44, Math.min(1200, upwards ? above : below));
      const left = Math.max(12, Math.min(anchor.left - 5, window.innerWidth - width - 12)), top = upwards ? Math.max(30, anchor.top - 5 - Math.min(height, maxHeight)) : anchor.bottom + 5;
      setPosition({ left: left - frame.left - (dialog.current?.clientLeft ?? 0), top: top - frame.top - (dialog.current?.clientTop ?? 0), width, maxHeight });
    };
    const outside = (event: PointerEvent) => { if (!modeTrigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setModeOpen(false); };
    reposition(); window.addEventListener("resize", reposition); window.addEventListener("scroll", reposition, true); document.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); document.removeEventListener("pointerdown", outside); };
  }, [modeOpen]);
  useEffect(() => setCopied(null), [state.url]);
  const close = () => { setModeOpen(false); state.setOpen(false); onClose(); };
  const customOwnerOnly = !state.context?.workspace && !state.policy?.users.some(user => user.account_user_id == null);
  const modeLabel = (mode: SiteSharingMode) => mode === "custom" && customOwnerOnly ? labels.admins_only : labels[mode];
  const selected = state.selected, description = selected === "public" ? "任何拥有该链接的互联网用户均可查看" : selected === "workspace_all" ? "拥有该链接的工作空间成员可以查看" : selected === "custom" && !customOwnerOnly ? "你和你已添加的用户可以查看" : "已有访问权限的用户可以查看";
  const rank = { admins_only: 0, custom: 0, workspace_all: 2, public: 3 };
  const modeDescription = (mode: SiteSharingMode) => mode === "public" ? "任何拥有该链接的互联网用户均可查看" : mode === "workspace_all" ? "拥有该链接的工作空间成员可以查看" : mode === "custom" && !customOwnerOnly ? "你和你已添加的用户可以查看" : "已有访问权限的用户可以查看";
  const icon = (mode: SiteSharingMode | null) => mode === "public" ? <Globe size={20} /> : mode === "workspace_all" ? <Users size={20} /> : <Lock size={20} />;
  const users = state.policy?.users.filter(user => state.context?.workspace || user.role !== "editor") ?? [];
  const ordered = [...users.filter(user => user.role === "owner"), ...users.filter(user => user.role !== "owner")];
  return <dialog ref={dialog} className={`site-sharing-dialog${modeOpen ? " site-sharing-menu-open" : ""}`} aria-labelledby="site-sharing-title" onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onClick={event => { if (event.target !== event.currentTarget) return; const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close(); }}>
    <form onSubmit={event => { event.preventDefault(); if (state.canSave) void state.save(); }} onKeyDown={event => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }}>
      <header><h2 id="site-sharing-title">分享{siteTitle ? ` ${siteTitle}` : ""}</h2><button type="button" aria-label="关闭" className="site-sharing-close" onClick={close}><X size={20} /></button></header>
      <div className="site-sharing-body">
        {state.loading && !state.policy && <div className="site-sharing-skeleton" role="status" aria-label="正在加载共享设置…"><span /><span /><span /></div>}
        {(state.policyError || state.contextError) && <div role="alert" className="site-sharing-read-error">无法加载共享设置 <button type="button" disabled={state.loading || state.saving} onClick={event => { event.preventDefault(); void state.load(true); }}>刷新权限</button></div>}
        {state.policy && <>
          <section className="site-sharing-link" aria-label="链接访问权限"><div className="site-sharing-access-icon">{icon(selected)}</div><div className="site-sharing-mode" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && !menu.current?.contains(event.relatedTarget) && modeTrigger.current !== event.relatedTarget) setModeOpen(false); }}><span className="site-sharing-mode-label">链接访问权限</span>
            <button ref={modeTrigger} type="button" className="site-sharing-mode-trigger" aria-label="链接访问权限" aria-haspopup="menu" aria-expanded={modeOpen} title={!state.owner ? "只有所有者才能更改链接访问权限" : undefined} disabled={!state.owner || state.saving || state.unknown || scope.aborted} onClick={event => { event.preventDefault(); setModeOpen(!modeOpen); }} onKeyDown={event => { if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return; if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setModeOpen(true); } }}>{selected === "public" ? "公开" : selected === "workspace_all" ? "工作空间" : selected ? modeLabel(selected) : ""}<ChevronDown size={14} /></button><p>{description}</p>{!state.owner && <p>只有所有者才能更改链接访问权限</p>}
            {modeOpen && dialog.current && createPortal(<div ref={menu} role="menu" aria-label="链接访问权限" className="site-sharing-mode-menu" style={position} onKeyDown={event => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setModeOpen(false); modeTrigger.current?.focus(); }
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]:not(:disabled)")); if (!items.length) return; const index = items.indexOf(event.target as HTMLButtonElement); items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
            }}>{[...state.options].sort((a, b) => rank[a.value] - rank[b.value]).map(option => <button type="button" key={option.value} role="menuitemradio" data-mode={option.value} aria-checked={selected === option.value} disabled={option.disabled || !state.owner || state.saving || state.unknown} onClick={event => { event.preventDefault(); state.change(option.value); setModeOpen(false); modeTrigger.current?.focus(); }}><span className="site-sharing-access-icon">{icon(option.value)}</span><span><span>{modeLabel(option.value)}</span><small>{modeDescription(option.value)}</small></span>{selected === option.value && <Check size={16} />}</button>)}</div>, dialog.current)}
          </div></section>
          <section className="site-sharing-participants" aria-label="用户">{ordered.map((user, index) => <div className="site-sharing-person" key={`${user.account_user_id ?? user.email ?? "user"}:${index}`}><span className="site-sharing-avatar" aria-hidden="true">{(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}</span><div className="site-sharing-identity"><span>{user.name ?? user.email ?? user.account_user_id ?? ""}</span>{user.pending ? <small>待处理</small> : user.name && user.email ? <small>{user.email}</small> : null}</div><span className="site-sharing-role">{user.role === "owner" ? "所有者" : user.role === "editor" ? "编辑者" : "查看者"}</span></div>)}</section>
          {Boolean(state.policy.groups.length) && <section className="site-sharing-participants" aria-label="群组">{state.policy.groups.map(group => <div className="site-sharing-person" key={group.id}><span className="site-sharing-avatar" aria-hidden="true"><Users size={16} /></span><div className="site-sharing-identity"><span>{group.name ?? "群组"}</span><small>{group.pending ? "待处理" : typeof group.size === "number" ? `${group.size} 位成员` : ""}</small></div><span className="site-sharing-role">查看者</span></div>)}</section>}
          {state.policy.showPrivateTunnelsWarning && state.draft === "public" && state.policy.accessMode !== "public" && <p role="note">如果此网站使用私有隧道，任何拥有链接的人都可能使用可访问已连接的私有服务的功能。</p>}
        </>}
        {state.error && <p role="alert">{state.error}</p>}
        {state.unknown && <button type="button" disabled={state.saving} onClick={event => { event.preventDefault(); void state.recover(); }}>重新读取共享设置</button>}
        {state.urlError && <p role="alert">无法读取站点链接 <button type="button" disabled={state.urlLoading} onClick={event => { event.preventDefault(); void state.loadUrl(); }}>重试</button></p>}
      </div>
      <footer><div className="site-sharing-url-actions">{state.url !== undefined && !state.dirty && (state.url ? <><a href={state.url} target="_blank" rel="noreferrer"><ExternalLink size={16} />访问</a><button type="button" aria-label="复制链接" onClick={event => { event.preventDefault(); const url = state.url; if (!url) return; void copyTextToClipboard(url).then(ok => { if (!live.current.open || live.current.scope !== scope || live.current.state !== state || state.url !== url || scope.aborted) return; setCopied(ok); if (!ok) onError?.("无法复制链接"); }); }}>{copied ? <Check size={16} /> : <Copy size={16} />}复制链接</button>{copied === false && <span role="alert">无法复制链接</span>}</> : <>{state.owner ? <><button type="button" disabled>访问</button><button type="button" disabled title="发布此站点后即可复制其链接">复制链接</button></> : <span role="button" tabIndex={0} aria-disabled="true" aria-label="发布" title="只有所有者可以发布第一个版本">发布</span>}</>)}</div>
        {state.dirty ? <><button type="button" disabled={state.saving} onClick={event => { event.preventDefault(); state.reset(); }}>取消</button><button key="save" type="submit" disabled={!state.canSave} aria-busy={state.saving}>{state.saving ? "正在保存" : state.draft === "public" ? "发布" : "保存"}</button></> : <button key="done" type="button" disabled={state.saving} onClick={event => { event.preventDefault(); close(); }}>完成</button>}
      </footer>
    </form>
  </dialog>;
}

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Copy, ExternalLink, Globe, Lock, Users, X } from "lucide-react";
import { SiteSharingState } from "../siteSharingState";
import { copyTextToClipboard } from "../clipboard";
import { siteSharingMemberTarget, type SiteSharingMemberTarget, type SiteSharingMode, type SiteSharingPolicy } from "../siteSharingData";
import type { SitesClientAccess } from "../sitesClient";
import "./SiteSharingDialog.css";
import { SiteSharingInviteInput } from "./SiteSharingInviteInput";

interface Props { access: SitesClientAccess; siteId: string; siteTitle?: string | null; scope: AbortSignal; open: boolean;
  onClose: () => void; onPolicy?: (policy: SiteSharingPolicy | null) => void | Promise<void>; onError?: (message: string) => void }
const labels: Record<SiteSharingMode, string> = { admins_only: "仅限我自己", custom: "仅限受邀者", workspace_all: "此工作区内收到链接的任何人", public: "互联网上的任何人" };
type MemberMenu = { target: SiteSharingMemberTarget; label: string; element: HTMLButtonElement };
type Removal = { target: SiteSharingMemberTarget; label: string; role: "owner" | "editor" | "viewer" | null };
export function SiteSharingDialog({ access, siteId, siteTitle, scope, open, onClose, onPolicy = () => {}, onError }: Props) {
  const state = useMemo(() => new SiteSharingState(access, siteId, scope, onPolicy, onError), [scope, siteId, access.identity.accountId, access.identity.userId, access.identity.generation]);
  state.onPolicy = onPolicy; state.onError = onError;
  const [, update] = useState(0), [copied, setCopied] = useState<boolean | null>(null), [modeOpen, setModeOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null), modeTrigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), trigger = useRef<HTMLElement | null>(null), wasOpen = useRef(false), live = useRef({ open, scope, state }); live.current = { open, scope, state };
  const [position, setPosition] = useState<{ left: number; top: number; width?: number; maxHeight: number }>({ left: 0, top: 0, width: 420, maxHeight: 1200 });
  const [memberMenu, setMemberMenu] = useState<MemberMenu | null>(null), [removal, setRemoval] = useState<Removal | null>(null), confirmation = useRef<HTMLDialogElement>(null), removeTrigger = useRef<HTMLElement | null>(null), hadRemoval = useRef(false), removalRef = useRef(removal); removalRef.current = removal;
  const menuOpen = modeOpen || Boolean(memberMenu);
  useEffect(() => { live.current = { open, scope, state }; setCopied(null); setModeOpen(false); setMemberMenu(null); setRemoval(null); const unsubscribe = state.subscribe(() => update(n => n + 1)); state.attach(); return () => { live.current.open = false; unsubscribe(); state.dispose(); }; }, [state]);
  useEffect(() => { state.setOpen(open); if (open && !wasOpen.current) { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; dialog.current?.showModal(); }
    if (!open && wasOpen.current) { const active = document.activeElement, returnFocus = active === document.body || dialog.current?.contains(active); confirmation.current?.close(); setRemoval(null); setMemberMenu(null); dialog.current?.close(); if (returnFocus && trigger.current?.isConnected) trigger.current.focus(); setCopied(null); setModeOpen(false); } wasOpen.current = open;
  }, [state, open]);
  useEffect(() => { if (menuOpen) menu.current?.querySelector<HTMLButtonElement>("[aria-checked=true]:not(:disabled),[role=menuitemradio]:not(:disabled)")?.focus(); }, [menuOpen, memberMenu]);
  useEffect(() => {
    if (removal) { if (!confirmation.current?.open) confirmation.current?.showModal(); }
    else if (hadRemoval.current) { const active = document.activeElement, returnFocus = active === document.body || confirmation.current?.contains(active); confirmation.current?.close(); if (returnFocus && removeTrigger.current?.isConnected) removeTrigger.current.focus(); }
    hadRemoval.current = Boolean(removal);
  }, [removal]);
  useEffect(() => {
    if (!removal || state.saving || !state.policy) return;
    const target = removal.target, entry = target.kind === "group" ? state.policy.groups.find(group => group.id === target.id) : state.policy.users.find(user => target.kind === "user" ? user.account_user_id === target.id : user.account_user_id == null && user.email === target.email);
    const label = entry?.name ?? (target.kind === "group" ? "群组" : entry?.email ?? entry?.account_user_id ?? "");
    if (!entry || label !== removal.label || state.memberActions(target, false).role !== removal.role) setRemoval(null);
  }, [state, state.policy, state.saving, removal]);
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const reposition = () => {
      const anchor = (memberMenu?.element ?? modeTrigger.current)?.getBoundingClientRect(), frame = dialog.current?.getBoundingClientRect(); if (!anchor || !frame) return;
      if (anchor.bottom < 0 || anchor.top > window.innerHeight) { setModeOpen(false); setMemberMenu(null); return; }
      const width = Math.min(memberMenu ? menu.current?.offsetWidth || 300 : 420, window.innerWidth - 24), height = Math.min(menu.current?.offsetHeight || 240, 1200), below = window.innerHeight - anchor.bottom - 35, above = anchor.top - 35;
      const upwards = below < height && above > below, maxHeight = Math.max(44, Math.min(1200, upwards ? above : below));
      const left = Math.max(12, Math.min(memberMenu ? anchor.right - width + 5 : anchor.left - 5, window.innerWidth - width - 12)), top = upwards ? Math.max(30, anchor.top - 5 - Math.min(height, maxHeight)) : anchor.bottom + 5;
      setPosition({ left: left - frame.left - (dialog.current?.clientLeft ?? 0), top: top - frame.top - (dialog.current?.clientTop ?? 0), width: memberMenu ? undefined : width, maxHeight });
    };
    const outside = (event: PointerEvent) => { if (!(memberMenu?.element ?? modeTrigger.current)?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) { setModeOpen(false); setMemberMenu(null); } };
    reposition(); window.addEventListener("resize", reposition); window.addEventListener("scroll", reposition, true); document.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); document.removeEventListener("pointerdown", outside); };
  }, [menuOpen, memberMenu]);
  useEffect(() => setCopied(null), [state.url]);
  const close = () => { if (removal) return; setModeOpen(false); setMemberMenu(null); state.setOpen(false); onClose(); };
  const customOwnerOnly = !state.context?.workspace && !state.policy?.users.some(user => user.account_user_id == null);
  const modeLabel = (mode: SiteSharingMode) => mode === "custom" && customOwnerOnly ? labels.admins_only : labels[mode];
  const selected = state.selected, description = selected === "public" ? "任何拥有该链接的互联网用户均可查看" : selected === "workspace_all" ? "拥有该链接的工作空间成员可以查看" : selected === "custom" && !customOwnerOnly ? "你和你已添加的用户可以查看" : "已有访问权限的用户可以查看";
  const rank = { admins_only: 0, custom: 0, workspace_all: 2, public: 3 };
  const modeDescription = (mode: SiteSharingMode) => mode === "public" ? "任何拥有该链接的互联网用户均可查看" : mode === "workspace_all" ? "拥有该链接的工作空间成员可以查看" : mode === "custom" && !customOwnerOnly ? "你和你已添加的用户可以查看" : "已有访问权限的用户可以查看";
  const icon = (mode: SiteSharingMode | null) => mode === "public" ? <Globe size={20} /> : mode === "workspace_all" ? <Users size={20} /> : <Lock size={20} />;
  const users = state.policy?.users.filter(user => state.context?.workspace || user.role !== "editor") ?? [];
  const displayOwner = users.find(user => user.role === "owner") ?? users.find(user => Boolean(state.context?.email) && user.email?.trim().toLowerCase() === state.context?.email?.trim().toLowerCase()) ?? users.find(user => Boolean(state.context?.memberId) && user.account_user_id === state.context?.memberId);
  const ordered = [...displayOwner ? [displayOwner] : [], ...users.filter(user => user !== displayOwner && user.role === "editor"), ...users.filter(user => user !== displayOwner && user.role !== "editor")];
  const roleControl = (target: SiteSharingMemberTarget | null, label: string, displayRole?: string) => {
    const actions = target ? state.memberActions(target) : null, role = displayRole ?? actions?.role ?? "viewer", text = role === "owner" ? "所有者" : role === "editor" ? "编辑者" : "查看者";
    if (!target || role === "owner" || !actions?.canOpenMenu) return <span className="site-sharing-role">{text}</span>;
    return <button type="button" className="site-sharing-member-trigger" aria-label={`${label} 的权限：${text}`} aria-haspopup="menu" aria-expanded={Boolean(memberMenu && JSON.stringify(memberMenu.target) === JSON.stringify(target))} onMouseDown={event => event.stopPropagation()} onClick={event => { event.preventDefault(); setModeOpen(false); setMemberMenu({ target, label, element: event.currentTarget }); }}>{text}<ChevronDown size={12} /></button>;
  };
  const memberActions = memberMenu ? state.memberActions(memberMenu.target) : null;
  const confirmRemoval = (recover = false) => { const current = removal; if (!current) return; void (recover ? state.recoverMember() : state.changeMember(current.target, null, { label: current.label, role: current.role })).then(done => { if (done && live.current.state === state && live.current.open && removalRef.current === current) setRemoval(null); }); };
  return <><dialog ref={dialog} className={`site-sharing-dialog${menuOpen ? " site-sharing-menu-open" : ""}`} aria-labelledby="site-sharing-title" onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onClick={event => { if (event.target !== event.currentTarget || removal) return; const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close(); }}>
    <form onSubmit={event => { event.preventDefault(); if (state.canSave) void state.save(); }} onKeyDown={event => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }}>
      <header><h2 id="site-sharing-title">分享{siteTitle ? ` ${siteTitle}` : ""}</h2><button type="button" aria-label="关闭" className="site-sharing-close" onClick={close}><X size={20} /></button></header>
      {open && state.canShowInvites && <div className="site-sharing-invite-header"><SiteSharingInviteInput state={state} portalContainer={dialog.current} /></div>}
      <div className="site-sharing-body">
        {state.loading && !state.policy && <div className="site-sharing-skeleton" role="status" aria-label="正在加载共享设置…"><span /><span /><span /></div>}
        {(state.policyError || state.contextError) && <div role="alert" className="site-sharing-read-error">无法加载共享设置 <button type="button" disabled={state.loading || state.saving} onClick={event => { event.preventDefault(); void state.load(true); }}>刷新权限</button></div>}
        {state.policy && <>
          <section className="site-sharing-link" aria-label="链接访问权限"><div className="site-sharing-access-icon">{icon(selected)}</div><div className="site-sharing-mode" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && !menu.current?.contains(event.relatedTarget) && modeTrigger.current !== event.relatedTarget) setModeOpen(false); }}><span className="site-sharing-mode-label">链接访问权限</span>
            <button ref={modeTrigger} type="button" className="site-sharing-mode-trigger" aria-label="链接访问权限" aria-haspopup="menu" aria-expanded={modeOpen} title={!state.owner ? "只有所有者才能更改链接访问权限" : undefined} disabled={!state.owner || state.saving || state.unknown || Boolean(state.memberUnknown) || scope.aborted} onClick={event => { event.preventDefault(); setModeOpen(!modeOpen); }} onKeyDown={event => { if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return; if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setModeOpen(true); } }}>{selected === "public" ? "公开" : selected === "workspace_all" ? "工作空间" : selected ? modeLabel(selected) : ""}<ChevronDown size={14} /></button><p>{description}</p>{!state.owner && <p>只有所有者才能更改链接访问权限</p>}
            {modeOpen && dialog.current && createPortal(<div ref={menu} role="menu" aria-label="链接访问权限" className="site-sharing-mode-menu" style={position} onKeyDown={event => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setModeOpen(false); modeTrigger.current?.focus(); }
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]:not(:disabled)")); if (!items.length) return; const index = items.indexOf(event.target as HTMLButtonElement); items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
            }}>{[...state.options].sort((a, b) => rank[a.value] - rank[b.value]).map(option => <button type="button" key={option.value} role="menuitemradio" data-mode={option.value} aria-checked={selected === option.value} disabled={option.disabled || !state.owner || state.saving || state.unknown || Boolean(state.memberUnknown)} onClick={event => { event.preventDefault(); state.change(option.value); setModeOpen(false); modeTrigger.current?.focus(); }}><span className="site-sharing-access-icon">{icon(option.value)}</span><span><span>{modeLabel(option.value)}</span><small>{modeDescription(option.value)}</small></span>{selected === option.value && <Check size={16} />}</button>)}</div>, dialog.current)}
          </div></section>
          <section className="site-sharing-participants" aria-label="用户">{ordered.map((user, index) => <div className="site-sharing-person" key={`${user.account_user_id ?? user.email ?? "user"}:${index}`}><span className="site-sharing-avatar" aria-hidden="true">{(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}</span><div className="site-sharing-identity"><span>{user.name ?? user.email ?? user.account_user_id ?? ""}</span>{user.pending ? <small>待处理</small> : user.name && user.email ? <small>{user.email}</small> : null}</div>{roleControl(siteSharingMemberTarget(user, "user"), user.name ?? user.email ?? user.account_user_id ?? "", user === displayOwner ? "owner" : user.role ?? undefined)}</div>)}</section>
          {Boolean(state.policy.groups.length) && <section className="site-sharing-participants" aria-label="群组">{state.policy.groups.map(group => <div className="site-sharing-person" key={group.id}><span className="site-sharing-avatar" aria-hidden="true"><Users size={16} /></span><div className="site-sharing-identity"><span>{group.name ?? "群组"}</span><small>{group.pending ? "待处理" : typeof group.size === "number" ? `${group.size} 位成员` : ""}</small></div>{roleControl(siteSharingMemberTarget(group, "group"), group.name ?? "群组")}</div>)}</section>}
          {memberMenu && memberActions && dialog.current && createPortal(<div ref={menu} role="menu" aria-label={`${memberMenu.label} 的权限`} className="site-sharing-mode-menu site-sharing-member-menu" style={position} onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); const element = memberMenu.element; setMemberMenu(null); element.focus(); }
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role^=menuitem]:not(:disabled)")), index = items.indexOf(event.target as HTMLButtonElement); if (items.length) items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
          }}>{((memberActions.canMakeEditor || memberActions.canMakeViewer) ? ["viewer", "editor"] as const : [memberActions.role === "editor" ? "editor" : "viewer"] as const).map(role => <button type="button" role="menuitemradio" key={role} data-member-role={role} aria-checked={memberActions.role === role} disabled={state.saving} onClick={event => { event.preventDefault(); const current = memberMenu; setMemberMenu(null); current.element.focus(); if (memberActions.role !== role) void state.changeMember(current.target, role); }}><span><span>{role === "editor" ? "编辑者" : "查看者"}</span><small>{role === "editor" ? "编辑站点并发布更新。访问、下载、更改或删除其数据。" : "查看和使用站点。"}</small></span>{memberActions.role === role && <Check size={16} />}</button>)}
            {memberActions.canRemove && <><hr /><button type="button" role="menuitem" className="site-sharing-remove-access" onClick={event => { event.preventDefault(); const current = memberMenu; removeTrigger.current = current.element; setMemberMenu(null); setRemoval({ target: current.target, label: current.label, role: memberActions.role }); }}>移除访问权限</button></>}
          </div>, dialog.current)}
          {state.policy.showPrivateTunnelsWarning && state.draft === "public" && state.policy.accessMode !== "public" && <p role="note">如果此网站使用私有隧道，任何拥有链接的人都可能使用可访问已连接的私有服务的功能。</p>}
        </>}
        {state.error && <p role="alert">{state.error}</p>}
        {state.unknown && <button type="button" disabled={state.saving} onClick={event => { event.preventDefault(); void state.recover(); }}>重新读取共享设置</button>}
        {state.memberUnknown && !removal && <button type="button" disabled={state.saving} onClick={event => { event.preventDefault(); void state.recoverMember(); }}>重新读取访问权限</button>}
        {state.urlError && <p role="alert">无法读取站点链接 <button type="button" disabled={state.urlLoading} onClick={event => { event.preventDefault(); void state.loadUrl(); }}>重试</button></p>}
      </div>
      <footer><div className="site-sharing-url-actions">{state.url !== undefined && !state.dirty && (state.url ? <><a href={state.url} target="_blank" rel="noreferrer"><ExternalLink size={16} />访问</a><button type="button" aria-label="复制链接" onClick={event => { event.preventDefault(); const url = state.url; if (!url) return; void copyTextToClipboard(url).then(ok => { if (!live.current.open || live.current.scope !== scope || live.current.state !== state || state.url !== url || scope.aborted) return; setCopied(ok); if (!ok) onError?.("无法复制链接"); }); }}>{copied ? <Check size={16} /> : <Copy size={16} />}复制链接</button>{copied === false && <span role="alert">无法复制链接</span>}</> : <>{state.owner ? <><button type="button" disabled>访问</button><button type="button" disabled title="发布此站点后即可复制其链接">复制链接</button></> : <span role="button" tabIndex={0} aria-disabled="true" aria-label="发布" title="只有所有者可以发布第一个版本">发布</span>}</>)}</div>
        {state.dirty ? <><button type="button" disabled={state.saving} onClick={event => { event.preventDefault(); state.reset(); }}>取消</button><button key="save" type="submit" disabled={!state.canSave} aria-busy={state.saving}>{state.saving ? "正在保存" : state.draft === "public" ? "发布" : "保存"}</button></> : <button key="done" type="button" disabled={state.saving} onClick={event => { event.preventDefault(); close(); }}>完成</button>}
      </footer>
    </form>
  </dialog>{createPortal(<dialog ref={confirmation} className="site-sharing-dialog site-sharing-member-confirm" aria-labelledby="site-sharing-member-title" aria-describedby="site-sharing-member-description" onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!state.saving) setRemoval(null); }} onClick={event => { if (event.target !== event.currentTarget || state.saving) return; const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) setRemoval(null); }}>
    <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); if (!state.saving && !state.memberUnknown) confirmRemoval(); }} onKeyDown={event => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }}>
      <div className="site-sharing-member-confirm-body"><h2 id="site-sharing-member-title">移除 {removal?.label}？</h2><button type="button" aria-label="关闭移除确认" className="site-sharing-close" disabled={state.saving} onClick={() => { if (!state.saving) setRemoval(null); }}><X size={20} /></button>
        <p id="site-sharing-member-description">{removal?.role === "editor" ? `${removal.label} 将无法再编辑 ${siteTitle ?? ""}` : <>This removes <strong>{removal?.label}</strong> from this site’s access list. Other sharing settings may still give them access.</>}</p>
        {state.error && <p role="alert">{state.error}</p>}
      </div><footer><button type="button" disabled={state.saving} autoFocus onClick={event => { event.preventDefault(); if (!state.saving) setRemoval(null); }}>取消</button>{state.memberUnknown ? <button key="recover-member" type="button" disabled={state.saving} onClick={event => { event.preventDefault(); confirmRemoval(true); }}>重新读取访问权限</button> : <button key="remove-member" className="site-sharing-member-danger" type="submit" disabled={state.saving} aria-busy={state.saving}>移除</button>}</footer>
    </form>
  </dialog>, document.body)}</>;
}

import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, Users } from "lucide-react";
import { SiteSharingInvitationSearch, type SiteSharingInviteCandidate } from "../siteSharingInvitationSearch";
import type { SiteSharingState } from "../siteSharingState";
import "./SiteSharingInviteInput.css";

interface Props { state: SiteSharingState; portalContainer: HTMLElement | null }
const candidateKey = (candidate: SiteSharingInviteCandidate) => JSON.stringify([candidate.target.kind, candidate.target.kind === "email" ? candidate.target.email : candidate.target.id]);
export function SiteSharingInviteInput({ state, portalContainer }: Props) {
  const search = useMemo(() => new SiteSharingInvitationSearch(state), [state]), [, update] = useState(0), [highlighted, setHighlighted] = useState<string | null>(null);
  const anchor = useRef<HTMLDivElement>(null), field = useRef<HTMLInputElement>(null), popup = useRef<HTMLDivElement>(null), listboxId = useId();
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, available: 0 });
  useEffect(() => { const unsubscribe = search.subscribe(() => update(n => n + 1)); search.attach(); return () => { unsubscribe(); search.dispose(); }; }, [search]);
  const groups = [
    { source: "teams", label: "你的团队", items: search.candidates.filter(c => c.source === "teams") },
    { source: "groups", label: "群组", items: search.candidates.filter(c => c.source === "groups") },
    { source: "users", label: "用户", items: search.candidates.filter(c => c.source === "users" || c.source === "external") },
  ];
  const candidates = groups.flatMap(group => group.items), loading = Object.values(search.loading).some(Boolean), failed = Object.values(search.errors).some(Boolean);
  const visible = state.canShowInvites && state.canInvite && search.open && portalContainer !== null && (candidates.length > 0 || loading || failed || search.query.trim().length > 0);
  const found = candidates.findIndex(candidate => candidateKey(candidate) === highlighted), activeIndex = visible && candidates.length ? found < 0 ? 0 : found : -1;
  const optionId = (candidate: SiteSharingInviteCandidate) => `${listboxId}-option-${encodeURIComponent(candidateKey(candidate))}`;
  const placeholder = !state.context?.workspace ? "输入电子邮箱地址" : state.context.teamsAllowed ? "添加成员或团队" : "添加用户或群组";
  useLayoutEffect(() => {
    if (!visible || !portalContainer) return;
    const originalClass = portalContainer.classList.contains("site-sharing-invite-open"); portalContainer.classList.add("site-sharing-invite-open");
    const reposition = () => {
      const box = anchor.current?.getBoundingClientRect(); if (!box) return;
      if (box.bottom < 0 || box.top > window.innerHeight) { search.setFocused(false); return; }
      const frame = portalContainer.getBoundingClientRect(), surface = anchor.current?.closest<HTMLElement>("[data-menu-overlay-surface]")?.getBoundingClientRect();
      const offset = 5 + (surface ? Math.max(0, surface.bottom - box.bottom) : 0), below = window.innerHeight - box.bottom - offset - 6, above = box.top - offset - 6;
      const upwards = below < (popup.current?.offsetHeight || 256) && above > below, width = Math.min(box.width, window.innerWidth - 16), available = Math.max(0, upwards ? above : below);
      const left = Math.max(6, Math.min(box.left, window.innerWidth - width - 6)), top = upwards ? Math.max(6, box.top - offset - Math.min(popup.current?.offsetHeight || 256, available)) : box.bottom + offset;
      const next = { left: left - frame.left - portalContainer.clientLeft, top: top - frame.top - portalContainer.clientTop, width, available };
      setPosition(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    const outside = (event: PointerEvent) => { if (!anchor.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) search.setFocused(false); };
    reposition(); window.addEventListener("resize", reposition); window.addEventListener("scroll", reposition, true); document.addEventListener("pointerdown", outside);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition); if (anchor.current) observer?.observe(anchor.current); if (popup.current) observer?.observe(popup.current);
    return () => { window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); document.removeEventListener("pointerdown", outside); observer?.disconnect(); if (!originalClass) portalContainer.classList.remove("site-sharing-invite-open"); };
  }, [visible, portalContainer, search, search.query, candidates.length, loading, failed]);
  useEffect(() => { if (activeIndex >= 0) popup.current?.querySelectorAll<HTMLElement>("[role=option]")[activeIndex]?.scrollIntoView({ block: "nearest" }); }, [activeIndex, visible]);
  const select = (candidate: SiteSharingInviteCandidate) => { if (!state.canInvite) return; setHighlighted(null); void search.select(candidate); field.current?.focus(); };
  const dismissSuggestions = (event: React.KeyboardEvent) => {
    if (!visible || event.key !== "Escape" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault(); event.stopPropagation(); setHighlighted(null); field.current?.focus(); search.close();
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { if (event.key === "Enter") event.preventDefault(); return; }
    if (event.key === "Tab") { search.setFocused(false); return; }
    if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); if (visible && activeIndex >= 0 && state.canInvite) select(candidates[activeIndex]); return; }
    if (!visible) return;
    if (event.key === "Escape") { dismissSuggestions(event); return; }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && candidates.length) { event.preventDefault(); event.stopPropagation(); const next = (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + candidates.length) % candidates.length; setHighlighted(candidateKey(candidates[next])); }
  };
  if (!state.canShowInvites) return null;
  return <div className="site-sharing-invite-field" ref={anchor} onKeyDown={dismissSuggestions}>
    <input ref={field} role="combobox" aria-label={placeholder} aria-autocomplete="list" aria-expanded={visible} aria-controls={visible ? listboxId : undefined} aria-activedescendant={activeIndex >= 0 ? optionId(candidates[activeIndex]) : undefined} placeholder={placeholder} disabled={!state.canInvite} value={search.query} onChange={event => { search.setFocused(true); search.setQuery(event.currentTarget.value); }} onFocus={() => search.setFocused(true)} onBlur={event => { if (!popup.current?.contains(event.relatedTarget) && !anchor.current?.contains(event.relatedTarget)) search.setFocused(false); }} onKeyDown={onKeyDown} />
    {search.errors.groups && search.query.trim() && <button type="button" disabled={!state.canInvite || search.loading.groups} aria-label="重试群组搜索" onClick={event => { event.preventDefault(); search.retry("groups"); }}>重试</button>}
    {visible && portalContainer && createPortal(<div ref={popup} id={listboxId} role="listbox" aria-label={placeholder} onKeyDown={dismissSuggestions} className={`site-sharing-invite-popup${loading && !candidates.length && !failed ? " site-sharing-invite-loading" : ""}`} style={{ left: position.left, top: position.top, width: position.width, "--invite-available-height": `${position.available}px` } as React.CSSProperties}>
      {loading && !candidates.length && !failed && <div className="site-sharing-invite-spinner"><LoaderCircle size={16} aria-hidden="true" /></div>}
      {!loading && !failed && !candidates.length && search.query.trim() && <p>没有匹配的用户或群组</p>}
      {groups.filter(group => group.items.length).map(group => <section key={group.source} aria-label={group.label}><div className="site-sharing-invite-group">{group.label}</div>{group.items.map(candidate => {
        const active = activeIndex >= 0 && candidateKey(candidates[activeIndex]) === candidateKey(candidate);
        return <button key={candidateKey(candidate)} id={optionId(candidate)} type="button" role="option" aria-selected={active} disabled={!state.canInvite} onMouseDown={event => event.preventDefault()} onMouseMove={() => setHighlighted(candidateKey(candidate))} onClick={event => { event.preventDefault(); select(candidate); }}><span className="site-sharing-invite-avatar" aria-hidden="true">{candidate.kind === "group" ? <Users size={16} /> : candidate.label.slice(0, 1).toUpperCase()}</span><span className="site-sharing-invite-identity"><span>{candidate.label}</span>{candidate.email && candidate.email !== candidate.label ? <small>{candidate.email}</small> : candidate.kind === "group" && typeof candidate.size === "number" ? <small>{candidate.size} 位成员</small> : null}</span></button>;
      })}</section>)}
      {search.errors.users && <p role="status">用户加载失败 <button type="button" aria-label="重试用户搜索" disabled={search.loading.users || !state.canInvite} onClick={event => { event.preventDefault(); search.retry("users"); }}>重试</button></p>}
      {search.errors.groups && <p role="status">无法加载群组</p>}
      {search.errors.teams && <p role="status">无法加载团队 <button type="button" aria-label="重试团队建议" disabled={search.loading.teams || !state.canInvite} onClick={event => { event.preventDefault(); search.retry("teams"); }}>重试</button></p>}
      {search.loading.teams && <p role="status">正在加载你的团队…</p>}
    </div>, portalContainer)}
  </div>;
}

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LaptopIcon, FolderIcon } from "./Icons";
import { ThreadSummary } from "../types";
import "./SidebarThreadHoverCard.css";

const VIEWPORT_MARGIN = 8;
const CARD_GAP = 2;
const LEAVE_GRACE_MS = 100;
const CARD_WIDTH = 320;
const CARD_MIN_WIDTH = 224;

export function formatSidebarHoverTime(seconds: number | null | undefined, nowMs = Date.now()): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const timestamp = seconds > 1e12 ? seconds : seconds * 1000;
  const minutes = Math.max(1, Math.floor((nowMs - timestamp) / 60000));
  if (minutes < 60) return `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const then = new Date(timestamp);
  const now = new Date(nowMs);
  const calendarDays = Math.max(1, Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) / 86400000,
  ));
  if (calendarDays < 7) return `${calendarDays} 天`;
  if (calendarDays < 30) return `${Math.floor(calendarDays / 7)} 周`;
  if (calendarDays < 365) return `${Math.floor(calendarDays / 30)} 个月`;
  return `${Math.floor(calendarDays / 365)} 年`;
}

export interface SidebarThreadHoverCardProps {
  thread: ThreadSummary;
  anchor: HTMLElement;
  projectLabel?: string | null;
  onClose: () => void;
  onRename: (value: string) => void;
}

export const SidebarThreadHoverCard: React.FC<SidebarThreadHoverCardProps> = ({
  thread,
  anchor,
  projectLabel,
  onClose,
  onRename,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameFinishedRef = useRef(false);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    maxWidth: number;
    minWidth: number;
    maxHeight: number;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(thread.name ?? "");
  const [now, setNow] = useState(Date.now);
  const sideRef = useRef<"left" | "right">("right");

  useLayoutEffect(() => {
    const updatePosition = () => {
      if (!anchor.isConnected) { onClose(); return; }
      const bounds = anchor.getBoundingClientRect();
      const card = cardRef.current?.getBoundingClientRect();
      if (!card) return;
      const right = bounds.right + CARD_GAP;
      const rightAvailable = Math.max(0, window.innerWidth - right - VIEWPORT_MARGIN);
      const leftAvailable = Math.max(0, bounds.left - CARD_GAP - VIEWPORT_MARGIN);
      const useRight = CARD_WIDTH <= rightAvailable || rightAvailable >= leftAvailable;
      sideRef.current = useRight ? "right" : "left";
      const availableWidth = useRight ? rightAvailable : leftAvailable;
      const maxHeight = Math.max(0, window.innerHeight - VIEWPORT_MARGIN * 2);
      const width = Math.min(card.width, availableWidth);
      const height = Math.min(card.height, maxHeight);
      const nextPosition = {
        left: Math.max(VIEWPORT_MARGIN, Math.min(
          useRight ? right : bounds.left - CARD_GAP - width,
          window.innerWidth - width - VIEWPORT_MARGIN,
        )),
        top: Math.max(VIEWPORT_MARGIN, Math.min(bounds.top, window.innerHeight - height - VIEWPORT_MARGIN)),
        maxWidth: availableWidth,
        minWidth: Math.min(CARD_MIN_WIDTH, availableWidth),
        maxHeight,
      };
      setPosition(current => current &&
        current.left === nextPosition.left &&
        current.top === nextPosition.top &&
        current.maxWidth === nextPosition.maxWidth &&
        current.minWidth === nextPosition.minWidth &&
        current.maxHeight === nextPosition.maxHeight
        ? current
        : nextPosition);
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updatePosition);
    if (cardRef.current) resizeObserver?.observe(cardRef.current);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      resizeObserver?.disconnect();
    };
  }, [anchor, editing, thread.name, projectLabel, onClose]);

  useLayoutEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [editing]);

  useEffect(() => {
    const timer = window.setTimeout(() => setNow(Date.now()), 60000 - Date.now() % 60000);
    return () => window.clearTimeout(timer);
  }, [now]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    let timer: number | null = null;
    let corridor: { start: { x: number; y: number }; destination: HTMLElement; side: "left" | "right" } | null = null;
    const clearTimer = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const enter = () => { clearTimer(); corridor = null; };
    const scheduleCheck = (x: number, y: number) => {
      clearTimer();
      timer = window.setTimeout(() => {
        timer = null;
        const target = document.elementFromPoint(x, y);
        if (target && (anchor.contains(target) || card.contains(target))) enter();
        else onClose();
      }, LEAVE_GRACE_MS);
    };
    const leave = (event: PointerEvent, fromCard: boolean) => {
      corridor = {
        start: { x: event.clientX, y: event.clientY },
        destination: fromCard ? anchor : card,
        side: fromCard ? (sideRef.current === "right" ? "left" : "right") : sideRef.current,
      };
      scheduleCheck(event.clientX, event.clientY);
    };
    const leaveAnchor = (event: PointerEvent) => leave(event, false);
    const leaveCard = (event: PointerEvent) => leave(event, true);
    const onPointerMove = (event: PointerEvent) => {
      if (!corridor) return;
      const target = event.target as Node;
      if (anchor.contains(target) || card.contains(target)) { enter(); return; }
      const rect = corridor.destination.getBoundingClientRect();
      const edge = corridor.side === "right" ? rect.left : rect.right;
      const start = corridor.start;
      const a = { x: edge, y: rect.top - 8 };
      const b = { x: edge, y: rect.bottom + 8 };
      const point = { x: event.clientX, y: event.clientY };
      const cross = (p: typeof point, q: typeof point, r: typeof point) =>
        (p.x - r.x) * (q.y - r.y) - (q.x - r.x) * (p.y - r.y);
      const signs = [cross(point, start, a), cross(point, a, b), cross(point, b, start)];
      if (signs.some(n => n < 0) && signs.some(n => n > 0)) onClose();
      else scheduleCheck(point.x, point.y);
    };
    const onBlur = (event: FocusEvent) => {
      if (!anchor.contains(event.relatedTarget as Node) && !card.contains(event.relatedTarget as Node)) onClose();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing && event.keyCode !== 229) {
        queueMicrotask(() => { if (!event.defaultPrevented) onClose(); });
      }
    };
    anchor.addEventListener("pointerleave", leaveAnchor);
    anchor.addEventListener("focusout", onBlur);
    card.addEventListener("pointerenter", enter);
    card.addEventListener("pointerleave", leaveCard);
    card.addEventListener("focusout", onBlur);
    document.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("codex:dismiss-tooltips", onClose);
    window.addEventListener("keydown", onEscape);
    return () => {
      clearTimer();
      anchor.removeEventListener("pointerleave", leaveAnchor);
      anchor.removeEventListener("focusout", onBlur);
      card.removeEventListener("pointerenter", enter);
      card.removeEventListener("pointerleave", leaveCard);
      card.removeEventListener("focusout", onBlur);
      document.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("codex:dismiss-tooltips", onClose);
      window.removeEventListener("keydown", onEscape);
    };
  }, [anchor, onClose]);

  const submitInlineRename = (rawValue: string) => {
    if (renameFinishedRef.current) return;
    renameFinishedRef.current = true;
    const next = rawValue.trim();
    setEditing(false);
    if (next && next !== thread.name) onRename(next);
    else setValue(thread.name ?? "");
  };
  const timestamp = thread.recencyAt ?? thread.updatedAt ?? thread.createdAt;
  const title = thread.name || "新聊天";
  return (
    <div
      ref={cardRef}
      id="sidebar-thread-hover-card"
      className="sidebar-thread-hover-card"
      role="tooltip"
      aria-label={`会话详情：${title}`}
      style={position ? { ...position } : { visibility: "hidden" }}
    >
      <div className="sidebar-thread-hover-title-row">
        <div className="sidebar-thread-hover-heading">
          {editing ? (
            <input
              ref={inputRef}
              autoFocus
              aria-label="聊天标题"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={(event) => submitInlineRename(event.currentTarget.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.nativeEvent.isComposing || event.keyCode === 229) {
                  if (event.key === "Enter" || event.key === "Escape") event.preventDefault();
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  renameFinishedRef.current = true;
                  setValue(thread.name ?? "");
                  setEditing(false);
                }
              }}
            />
          ) : thread.name != null ? (
            <button
              type="button"
              className="sidebar-thread-hover-title"
              onClick={() => { renameFinishedRef.current = false; setValue(thread.name ?? ""); setEditing(true); }}
            >
              {title}
            </button>
          ) : <span className="sidebar-thread-hover-title">{title}</span>}
          <span className="sidebar-thread-hover-environment" aria-label="本地"><LaptopIcon size={16} /></span>
        </div>
        {formatSidebarHoverTime(timestamp, now) != null && (
          <span className="sidebar-thread-hover-time">
            {formatSidebarHoverTime(timestamp, now)}
            {thread.readState?.firstUnread && <span className="sidebar-thread-hover-unread" />}
          </span>
        )}
      </div>
      {projectLabel && (
        <div className="sidebar-thread-hover-meta">
          <FolderIcon size={16} />
          <span>{projectLabel}</span>
        </div>
      )}
    </div>
  );
};

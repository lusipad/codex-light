import React, { useEffect, useRef, useState } from "react";
import { tauriInvoke } from "../bridge";
import "./SidebarResizeHandle.css";

// Sidebar collapse remounts the handle while an earlier native write may still be running.
let pendingSave = Promise.resolve();

export function SidebarResizeHandle({ onError, contextual = false }: {
  onError?: (message: string, type: "error") => void;
  contextual?: boolean;
}) {
  const minimum = contextual ? 290 : 240;
  const handle = useRef<HTMLDivElement>(null);
  const preferredWidth = useRef(340);
  const edited = useRef(false);
  const active = useRef(true);
  const drag = useRef<{ pointerId: number; x: number; width: number; preferred: number } | null>(null);
  const reportError = useRef(onError);
  reportError.current = onError;
  const [width, setWidth] = useState(340);
  const [maximum, setMaximum] = useState(520);
  const [error, setError] = useState("");

  const applyWidth = (value: number) => {
    const sidebar = handle.current?.parentElement;
    const shellWidth = contextual ? window.innerWidth : sidebar?.parentElement?.getBoundingClientRect().width ?? window.innerWidth;
    const max = Math.max(minimum, Math.min(520, shellWidth - 240));
    const next = Math.max(minimum, Math.min(value, max));
    sidebar?.style.setProperty("--sidebar-width", `${next}px`);
    setWidth(next);
    setMaximum(max);
    return next;
  };

  const showError = (message: string) => {
    if (!active.current) return;
    setError(message);
    reportError.current?.(message, "error");
  };

  const saveWidth = (value: number) => {
    pendingSave = pendingSave.then(async () => {
      try {
        await tauriInvoke("desktop_state_set", { key: "sidebar-width", value });
        const saved = await tauriInvoke<unknown>("desktop_state_get", { key: "sidebar-width" });
        if (saved !== value) throw new Error("侧栏宽度未保存");
        if (active.current) setError("");
      } catch {
        showError("侧栏宽度保存失败，请调整后重试");
      }
    });
  };

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    const sidebar = handle.current?.parentElement;
    const original = sidebar?.style.getPropertyValue("--sidebar-width") ?? "";
    applyWidth(preferredWidth.current);
    pendingSave.then(() => {
      if (cancelled) return;
      return tauriInvoke<unknown>("desktop_state_get", { key: "sidebar-width" });
    }).then(value => {
      if (cancelled || edited.current) return;
      if (typeof value === "number" && Number.isFinite(value)) {
        preferredWidth.current = Math.max(240, Math.min(520, value));
        applyWidth(preferredWidth.current);
      }
    }).catch(() => {
      if (!cancelled) showError("侧栏宽度读取失败，请调整后重试");
    });
    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      preferredWidth.current = applyWidth(current.width + event.clientX - current.x);
    };
    const finish = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      move(event);
      drag.current = null;
      saveWidth(preferredWidth.current);
    };
    const cancel = () => {
      if (!drag.current) return;
      preferredWidth.current = drag.current.preferred;
      drag.current = null;
      applyWidth(preferredWidth.current);
    };
    const pointerCancel = (event: PointerEvent) => {
      if (drag.current?.pointerId === event.pointerId) cancel();
    };
    const resize = () => {
      cancel();
      applyWidth(preferredWidth.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", pointerCancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", resize);
    const observer = new ResizeObserver(resize);
    if (sidebar?.parentElement) observer.observe(sidebar.parentElement);
    return () => {
      cancelled = true;
      active.current = false;
      drag.current = null;
      observer.disconnect();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", pointerCancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", resize);
      if (original) sidebar?.style.setProperty("--sidebar-width", original);
      else sidebar?.style.removeProperty("--sidebar-width");
    };
  }, [contextual]);

  return <>
    <div ref={handle} className="sidebar-resize-handle" role="separator" tabIndex={0}
      aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuemin={minimum}
      aria-valuemax={maximum} aria-valuenow={width}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        edited.current = true;
        drag.current = { pointerId: event.pointerId, x: event.clientX, width, preferred: preferredWidth.current };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || drag.current) return;
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        edited.current = true;
        const next = applyWidth(width + (event.key === "ArrowRight" ? 10 : -10));
        if (next === width) return;
        preferredWidth.current = next;
        saveWidth(next);
      }} />
    {error && <span className="sidebar-resize-error" role="alert">{error}</span>}
  </>;
}

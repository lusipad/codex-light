import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clampColor, hexToHsv, hsvToHex, type HSV } from "../appearanceColor";
import "./AppearanceColorPicker.css";

export function AppearanceColorPicker({ label, value, disabled, pending = false, onChange }: {
  label: string; value: string; disabled: boolean; pending?: boolean; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [gesture, setGesture] = useState(false);
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const current = useRef(hsv), emitted = useRef(value), dragging = useRef(false);
  const update = (patch: Partial<HSV>) => {
    const next = { ...current.current, ...patch };
    current.current = next; setHsv(next);
    const color = hsvToHex(next);
    if (color !== emitted.current) { emitted.current = color; onChange(color); }
  };
  useEffect(() => {
    // Intermediate readbacks from our serial writes must not reset an active gesture.
    if (pending || dragging.current || value.toLowerCase() === emitted.current.toLowerCase()) return;
    const next = hexToHsv(value); current.current = next; setHsv(next); emitted.current = value;
  }, [value, pending, gesture]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect(), box = popup.current?.getBoundingClientRect();
      if (!rect || !box) return;
      const top = rect.bottom + 4 + box.height > window.innerHeight - 8 ? rect.top - box.height - 4 : rect.bottom + 4;
      setPosition({ left: Math.max(8, Math.min(rect.right - box.width, window.innerWidth - box.width - 8)),
        top: Math.max(8, Math.min(top, window.innerHeight - box.height - 8)) });
    };
    place(); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) {
        setOpen(false); dragging.current = false; setGesture(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
      event.preventDefault(); event.stopPropagation(); setOpen(false); dragging.current = false; setGesture(false); trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); };
  }, [open]);
  const move = (event: React.PointerEvent<HTMLDivElement>, hue: boolean) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const left = clampColor((event.clientX - rect.left) / rect.width, 1);
    update(hue ? { h: 360 * left } : { s: 100 * left, v: 100 - 100 * clampColor((event.clientY - rect.top) / rect.height, 1) });
  };
  const slider = (hue: boolean) => <div className={`appearance-color-${hue ? "hue" : "saturation"}`}>
    <div role="slider" tabIndex={0} aria-label={hue ? "Hue" : "Color"}
      aria-valuemin={hue ? 0 : undefined} aria-valuemax={hue ? 360 : undefined} aria-valuenow={hue ? Math.round(hsv.h) : undefined}
      aria-valuetext={hue ? undefined : `Saturation ${Math.round(hsv.s)}%, Brightness ${Math.round(hsv.v)}%`}
      className="appearance-color-interactive" style={hue ? undefined : { backgroundColor: hsvToHex({ h: hsv.h, s: 100, v: 100 }) }}
      onPointerDown={event => {
        if (disabled || event.button !== 0) return;
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = true; setGesture(true); move(event, hue);
      }} onPointerMove={event => { if (dragging.current && event.currentTarget.hasPointerCapture(event.pointerId)) move(event, hue); }}
      onPointerUp={event => {
        if (!dragging.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        move(event, hue); dragging.current = false; setGesture(false); event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => { dragging.current = false; setGesture(false); }}
      onKeyDown={event => {
        if (disabled || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const horizontal = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
        if (hue) update({ h: clampColor(current.current.h + horizontal * 18, 360) });
        else update({ s: clampColor(current.current.s + horizontal * 5),
          v: clampColor(current.current.v + (event.key === "ArrowUp" ? 5 : event.key === "ArrowDown" ? -5 : 0)) });
      }}>
      <span className="appearance-color-pointer" style={{ left: `${hue ? hsv.h / 3.6 : hsv.s}%`, top: hue ? "50%" : `${100 - hsv.v}%`,
        background: hsvToHex(hue ? { h: hsv.h, s: 100, v: 100 } : hsv) }} />
    </div>
  </div>;
  return <><button ref={trigger} type="button" className="appearance-color-swatch" style={{ background: value }}
    aria-label={label} aria-expanded={open} aria-haspopup="dialog" disabled={disabled} onClick={() => setOpen(current => !current)} />
    {open && createPortal(<div ref={popup} role="dialog" aria-label={label} className="appearance-color-popover"
      style={position}><div className="appearance-color-palette">{slider(false)}{slider(true)}</div></div>, document.body)}</>;
}

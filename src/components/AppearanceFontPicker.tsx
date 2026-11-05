import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, LoaderCircle } from "lucide-react";
import { escapeThemeFont, firstThemeFontFamily, loadThemeFonts, type ThemeFontFace } from "../appearanceTheme";
import { fontFamilyAllowed, selectedSystemFont, useSystemFonts } from "../systemFonts";
import { GeneralPreferenceSelect } from "./GeneralPreferenceSelect";
import "./AppearanceFontPicker.css";

const systemFamilies = new Set(["-apple-system", "blinkmacsystemfont", "monospace", "sans-serif", "serif", "system-ui", "ui-monospace", "ui-sans-serif"]);
const isSystemFamily = (value: string | null, defaultLabel: string) => defaultLabel === "系统" && systemFamilies.has(firstThemeFontFamily(value)?.toLowerCase() ?? "");
function fontDisplay(value: string | null, defaultLabel: string) {
  const family = firstThemeFontFamily(value);
  return family && !isSystemFamily(value, defaultLabel) ? family : defaultLabel;
}
function CustomFontMenu({ label, value, defaultLabel, disabled, hasFace = false, onChange }: {
  label: string; value: string | null; defaultLabel: string; disabled: boolean; hasFace?: boolean; onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(value ?? "");
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 320 });
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLFormElement>(null), composing = useRef(false);
  const openLast = useRef(false);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect(), box = menu.current?.getBoundingClientRect();
      if (!rect || !box) return;
      const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12;
      const up = below < box.height && above > below, height = Math.max(32, Math.min(320, up ? above : below));
      setPosition({ left: Math.max(8, Math.min(rect.right - box.width, window.innerWidth - box.width - 8)),
        top: up ? Math.max(8, rect.top - Math.min(box.height, height) - 4) : rect.bottom + 4, maxHeight: height });
    };
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    place(); const buttons = menu.current?.querySelectorAll("button"); buttons?.[openLast.current ? buttons.length - 1 : 0]?.focus();
    document.addEventListener("pointerdown", outside); window.addEventListener("scroll", place, true); window.addEventListener("resize", place);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open]);
  const apply = () => { if (!disabled && !composing.current) { const next = draft.trim() || null; if (next !== value || hasFace) onChange(next); close(); } };
  return <div className="general-preference-select appearance-font-select">
    <button ref={trigger} type="button" className="general-preference-trigger" aria-label={label} aria-haspopup="menu"
      aria-expanded={open} disabled={disabled} onClick={() => { if (open) close(); else { openLast.current = false; setDraft(value ?? ""); setOpen(true); } }}
      onKeyDown={event => {
        if (disabled || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); openLast.current = event.key === "ArrowUp"; setDraft(value ?? ""); setOpen(true); }
      }}>
      <span>{fontDisplay(value, defaultLabel)}</span><ChevronDown size={12} aria-hidden="true" /></button>
    {open && createPortal(<form ref={menu} role="menu" aria-label={label} className="general-preference-menu appearance-font-custom-menu" style={position}
      onSubmit={event => { event.preventDefault(); apply(); }} onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composing.current) { if (event.key === "Enter") event.preventDefault(); return; }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        if (event.target instanceof HTMLInputElement && (event.key === "Home" || event.key === "End")) return;
        event.preventDefault();
        const items = [...(menu.current?.querySelectorAll<HTMLElement>("button, input") ?? [])], index = items.indexOf(event.target as HTMLElement);
        items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && !trigger.current?.contains(event.relatedTarget)) setOpen(false); }}>
      <button type="button" role="menuitemradio" aria-checked={value == null || isSystemFamily(value, defaultLabel)} onClick={() => { if (value != null) onChange(null); close(); }}>
        <span>{defaultLabel}</span>{(value == null || isSystemFamily(value, defaultLabel)) && <Check size={14} aria-hidden="true" />}</button>
      <hr />
      <input aria-label={label} spellCheck={false} value={draft} onChange={event => setDraft(event.target.value)}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} />
      <button type="button" role="menuitem" onClick={apply}>使用自定义字体值</button>
    </form>, document.body)}
  </div>;
}

export function AppearanceFontPicker({ id, label, styleLabel, value, face, disabled, controls = "both", content = false, monospace = false, onChange }: {
  id: string; label: string; styleLabel: string; value: string | null; face?: ThemeFontFace; disabled: boolean;
  controls?: "family" | "style" | "both"; content?: boolean; monospace?: boolean;
  onChange: (value: string | null, face?: ThemeFontFace) => void;
}) {
  const { pending, families } = useSystemFonts();
  if (pending) return <span role="status" aria-label="正在读取字体" className="appearance-font-loading"><LoaderCircle size={14} aria-hidden="true" /></span>;
  const selected = selectedSystemFont(value, face, families), fallback = !families?.length;
  const defaultLabel = content ? "与界面字体相同" : "系统";
  const choose = (family: NonNullable<typeof selected>["family"], chosen: NonNullable<typeof selected>["face"]) => {
    const next = chosen.postscriptName === family.faces[0].postscriptName ? undefined
      : { family: family.family, fullName: chosen.fullName, postscriptName: chosen.postscriptName };
    onChange(`"${escapeThemeFont(family.family)}"`, next);
    if (next) void loadThemeFonts([{ fonts: { ui: family.family, code: null, uiFace: next } }]);
  };
  return <div className="appearance-font-controls">
    {controls !== "style" && (fallback ? <CustomFontMenu label={label} value={value} hasFace={face != null} defaultLabel={defaultLabel} disabled={disabled}
      onChange={next => onChange(next, undefined)} /> : <GeneralPreferenceSelect id={id} label={label} disabled={disabled}
      className="appearance-font-select" value={isSystemFamily(value, defaultLabel) ? "" : selected?.family.family ?? value ?? ""} placeholder={fontDisplay(value, defaultLabel)}
      onReselect={isSystemFamily(value, defaultLabel) ? () => onChange(null, undefined) : undefined}
      options={[{ value: "", label: defaultLabel }, ...families.filter(family => fontFamilyAllowed(family, monospace)).map(family => ({ value: family.family, label: family.family }))]}
      onChange={name => { if (!name) onChange(null, undefined); else { const family = families.find(item => item.family === name)!; choose(family, family.faces[0]); } }} />)}
    {controls !== "family" && <GeneralPreferenceSelect id={`${id}-style`} label={styleLabel} className="appearance-font-select appearance-font-style"
      disabled={disabled || !selected || !fontFamilyAllowed(selected.family, monospace)} value={selected?.face.postscriptName ?? ""}
      placeholder="常规" options={selected?.family.faces.map(item => ({ value: item.postscriptName, label: item.styleName })) ?? []}
      onChange={name => { const chosen = selected?.family.faces.find(item => item.postscriptName === name); if (selected && chosen) choose(selected.family, chosen); }} />}
  </div>;
}

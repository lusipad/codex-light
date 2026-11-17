import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadThemePreset, type ChromeTheme, type ThemeVariant } from "../appearanceTheme";
import "./AppearanceThemePresetPicker.css";

type PreviewColors = Pick<ChromeTheme, "surface" | "ink" | "accent">;
type Preset = { id: string; label: string };

function Badge({ theme, muted = false }: { theme?: PreviewColors; muted?: boolean }) {
  return <span className="appearance-preset-badge" aria-hidden="true" style={theme ? {
    backgroundColor: theme.surface, borderColor: `color-mix(in srgb, ${theme.ink} 16%, ${theme.surface})`,
    color: muted ? "var(--text-tertiary)" : theme.accent,
  } : undefined}>{theme ? "Aa" : null}</span>;
}

function PresetBadge({ id, variant }: { id: string; variant: ThemeVariant }) {
  const [preview, setPreview] = useState<{ id: string; variant: ThemeVariant; theme: PreviewColors } | null>(null);
  useEffect(() => {
    let current = true;
    void loadThemePreset(id, variant).then(theme => { if (current) setPreview({ id, variant, theme }); }, () => {});
    return () => { current = false; };
  }, [id, variant]);
  return <Badge theme={preview?.id === id && preview.variant === variant ? preview.theme : undefined} />;
}

interface Props {
  id: string;
  label: string;
  value: string;
  theme: PreviewColors;
  variant: ThemeVariant;
  disabled: boolean;
  loading: boolean;
  presets: readonly Preset[];
  onChange: (id: string) => void | Promise<void>;
}

const menuWidth = 240;
const menuInset = 8;
const displayName = (preset: Preset) => preset.id === "codex" ? "ChatGPT" : preset.label;
const viewportPosition = { left: 8, top: 8, subLeft: 8, subTop: 8 };

export function AppearanceThemePresetPicker({ id, label, value, theme, variant, disabled, loading, presets, onChange }: Props) {
  const [open, setOpen] = useState(false), [submenu, setSubmenu] = useState(false);
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 767);
  const [position, setPosition] = useState(viewportPosition);
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), subMenu = useRef<HTMLDivElement>(null);
  const submenuTrigger = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<"first" | "last" | "sub-first" | "sub-trigger" | null>(null);
  const defaultPreset = presets.find(preset => preset.id === "codex");
  const otherPresets = presets.filter(preset => preset.id !== "codex");
  const selection = presets.find(preset => preset.id === value);
  const display = selection ? displayName(selection) : value;
  const locked = disabled;
  const close = (restoreFocus: boolean) => {
    setOpen(false); setSubmenu(false); focusNext.current = null;
    if (restoreFocus) trigger.current?.focus();
  };
  const show = (direction: "first" | "last") => {
    if (locked || !presets.length) return;
    focusNext.current = direction;
    setNarrow(window.innerWidth <= 767); setOpen(true);
  };
  const showSubmenu = (withFocus: boolean) => {
    if (!otherPresets.length) return;
    if (withFocus) {
      if (submenu) subMenu.current?.querySelectorAll<HTMLButtonElement>("[data-preset-menu-item]")[0]?.focus();
      else focusNext.current = "sub-first";
    }
    setSubmenu(true);
  };
  const hideSubmenu = () => { focusNext.current = "sub-trigger"; setSubmenu(false); };
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const isNarrow = window.innerWidth <= 767;
      if (isNarrow && !narrow && submenu && menu.current?.contains(document.activeElement)) focusNext.current = "sub-first";
      setNarrow(isNarrow);
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const panel = isNarrow && submenu ? subMenu.current : menu.current;
      const width = panel?.offsetWidth || menuWidth, height = panel?.offsetHeight || 88;
      const limitX = (x: number, w: number) => Math.max(menuInset, Math.min(x, window.innerWidth - w - menuInset));
      const limitY = (y: number, h: number) => Math.max(menuInset, Math.min(y, window.innerHeight - h - menuInset));
      const left = limitX(anchor.right - width, width);
      const below = window.innerHeight - anchor.bottom;
      const top = limitY(below < height + 12 && anchor.top > below ? anchor.top - height - 4 : anchor.bottom + 4, height);
      const subWidth = subMenu.current?.offsetWidth || menuWidth, subHeight = subMenu.current?.offsetHeight || 320;
      const subLeft = limitX(left + width + subWidth <= window.innerWidth - menuInset ? left + width : left - subWidth, subWidth);
      const subTop = limitY(submenuTrigger.current?.getBoundingClientRect().top ?? top, subHeight);
      setPosition({ left, top, subLeft, subTop });
    };
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target) && !subMenu.current?.contains(target)) close(false);
    };
    const blur = () => close(false);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("blur", blur);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("blur", blur);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open, submenu, narrow]);
  useLayoutEffect(() => {
    if (!open || !focusNext.current) return;
    const focus = focusNext.current; focusNext.current = null;
    if (focus === "sub-trigger") submenuTrigger.current?.focus();
    else if (focus === "sub-first") subMenu.current?.querySelectorAll<HTMLButtonElement>("[data-preset-menu-item]")[0]?.focus();
    else {
      const rows = menu.current?.querySelectorAll<HTMLButtonElement>("[data-preset-menu-item]");
      rows?.[focus === "last" ? rows.length - 1 : 0]?.focus();
    }
  }, [open, submenu, narrow]);
  const menuKeys = (event: React.KeyboardEvent<HTMLDivElement>, sub: boolean) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape" || sub && event.key === "ArrowLeft") {
      event.preventDefault(); event.stopPropagation();
      if (sub || submenu) hideSubmenu(); else close(true);
      return;
    }
    if (event.key === "Tab") { close(true); return; }
    if (!sub && event.key === "ArrowRight" && document.activeElement === submenuTrigger.current) {
      event.preventDefault(); showSubmenu(true); return;
    }
    const rows = Array.from((sub ? subMenu : menu).current?.querySelectorAll<HTMLButtonElement>("[data-preset-menu-item]") ?? []);
    if (!rows.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : current < 0 ? 0 : -1) + rows.length) % rows.length;
    event.preventDefault(); event.stopPropagation(); rows[next]?.focus();
  };
  const arrow = (path: string) => <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>;
  const radio = (preset: Preset) =>
    <button key={preset.id} type="button" role="menuitemradio" tabIndex={-1} data-preset-menu-item="" data-preset-id={preset.id}
      aria-checked={value === preset.id} aria-disabled={locked || undefined}
      onClick={() => { if (!locked && preset.id !== value) void onChange(preset.id); }}>
      <PresetBadge id={preset.id} variant={variant} />
      <span className="appearance-preset-label">{displayName(preset)}</span>
      <span className="appearance-preset-check" aria-hidden="true">{value === preset.id && arrow("m3.5 8 3 3 6-6")}</span>
    </button>;
  return <>
    <button type="button" ref={trigger} id={id} className="appearance-preset-trigger" aria-label={label}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-${narrow && submenu ? "submenu" : "menu"}` : undefined}
      aria-disabled={!open && (locked || !presets.length) || undefined} aria-busy={loading || undefined}
      onClick={() => open ? close(true) : show("first")}
      onKeyDown={event => {
        if (!open && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && ["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault(); show(event.key === "ArrowDown" ? "first" : "last");
        }
      }}>
      <Badge theme={theme} /><span className="appearance-preset-label">{display}</span>{arrow("m4 6 4 4 4-4")}
    </button>
    {open && createPortal(<>
      {!(narrow && submenu) && <div id={`${id}-menu`} ref={menu} className="appearance-preset-menu" role="menu" aria-label={label}
        style={{ left: position.left, top: position.top }} onKeyDown={event => menuKeys(event, false)}>
        {defaultPreset && radio(defaultPreset)}
        {otherPresets.length > 0 && <button id={`${id}-submenu-trigger`} ref={submenuTrigger} type="button" role="menuitem" tabIndex={-1}
          data-preset-menu-item="" aria-haspopup="menu" aria-expanded={submenu}
          onClick={() => showSubmenu(true)} onPointerEnter={() => { if (!narrow) showSubmenu(false); }}>
          <Badge theme={theme} muted /><span className="appearance-preset-label">Codex 主题</span>{arrow("m6 4 4 4-4 4")}
        </button>}
      </div>}
      {submenu && <div id={`${id}-submenu`} ref={subMenu} className="appearance-preset-menu appearance-preset-submenu"
        data-preset-presentation={narrow ? "inline" : "flyout"} role="menu" aria-label="Codex 主题"
        style={{ left: narrow ? position.left : position.subLeft, top: narrow ? position.top : position.subTop }}
        onKeyDown={event => menuKeys(event, true)}>
        {narrow && <button type="button" role="menuitem" className="appearance-preset-back" onClick={hideSubmenu}>
          {arrow("m10 4-4 4 4 4")}<span className="appearance-preset-label">Codex 主题</span></button>}
        <div className="appearance-preset-list">{otherPresets.map(radio)}</div>
      </div>}
    </>, document.body)}
  </>;
}

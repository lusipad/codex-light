import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import "./GeneralPreferenceSelect.css";

interface GeneralPreferenceSelectProps {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string; title?: string; description?: string }[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  onChange: (value: string) => void;
  onReselect?: () => void;
  plainItems?: boolean;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

export const GeneralPreferenceSelect: React.FC<GeneralPreferenceSelectProps> = ({
  id, label, value, options, disabled = false, placeholder = "未找到目标", className = "", onChange, onReselect, plainItems = false, triggerRef: externalTriggerRef,
}) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 320 });
  const internalTriggerRef = useRef<HTMLButtonElement>(null);
  const triggerRef = externalTriggerRef ?? internalTriggerRef;
  const menuRef = useRef<HTMLDivElement>(null);
  const initialFocus = useRef(0);
  const unavailable = disabled || options.length === 0;
  const selected = options.find(option => option.value === value);

  useEffect(() => {
    if (open && unavailable) setOpen(false);
    else if (open) menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio], [role=menuitem]")[initialFocus.current]?.focus();
  }, [open, unavailable]);

  useLayoutEffect(() => {
    if (!open || unavailable) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        setOpen(false);
        return;
      }
      const width = menuRef.current?.offsetWidth || 220;
      const height = Math.min(menuRef.current?.offsetHeight || 320, 320);
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upward = below < height && above > below;
      const maxHeight = Math.max(32, Math.min(320, upward ? above : below));
      setPosition({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        top: upward ? Math.max(8, rect.top - Math.min(height, maxHeight) - 4) : rect.bottom + 4, maxHeight });
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    updatePosition();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, unavailable]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const show = (index: number) => {
    if (unavailable) return;
    initialFocus.current = index;
    setOpen(true);
  };
  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio], [role=menuitem]") ?? []);
    const index = items.indexOf(event.target as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  const handleBlur = (event: React.FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget) && !triggerRef.current?.contains(event.relatedTarget)
      && !menuRef.current?.contains(event.relatedTarget)) setOpen(false);
  };
  return <div className={`general-preference-select ${className}`} onBlur={handleBlur}>
    <button type="button" id={id} ref={triggerRef} className="general-preference-trigger"
      aria-label={label} aria-haspopup="menu" aria-expanded={open && !unavailable}
      aria-controls={open && !unavailable ? `${id}-menu` : undefined} disabled={unavailable}
      onClick={() => open ? close() : show(plainItems ? 0 : Math.max(0, options.findIndex(option => option.value === value)))}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          show(event.key === "ArrowUp" ? options.length - 1 : 0);
        }
      }}>
      <span>{selected?.label ?? placeholder}</span><ChevronDown size={12} aria-hidden="true" />
    </button>
    {open && !unavailable && createPortal(<div id={`${id}-menu`} ref={menuRef} role="menu" aria-label={label}
      className={`general-preference-menu ${className}`} style={position} onBlur={handleBlur} onKeyDown={handleMenuKeyDown}>
      {options.map(option => <button type="button" key={option.value} role={plainItems ? "menuitem" : "menuitemradio"} title={option.title}
        aria-checked={plainItems ? undefined : value === option.value} onClick={() => {
          close();
          if (!unavailable) {
            if (option.value !== value) onChange(option.value);
            else onReselect?.();
          }
        }}>
        {option.description ? <span className="general-preference-option-copy"><span>{option.label}</span><span className="general-preference-option-description">{option.description}</span></span> : <span>{option.label}</span>}
        {!plainItems && value === option.value && <Check size={14} aria-hidden="true" />}
      </button>)}
    </div>, document.body)}
  </div>;
};

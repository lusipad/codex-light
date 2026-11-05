import React, { useEffect, useLayoutEffect, useRef, useState, useId } from "react";
import { Check, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import "./GeneralPreferenceSelect.css";
import "./AccountNotificationMenu.css";

interface AccountNotificationMenuProps {

  label: string;

  options: { channel: string; name: string; enabled: boolean }[];
  disabled?: boolean;


  onChange: (channel: string, enabled: boolean) => void;


}

export const AccountNotificationMenu: React.FC<AccountNotificationMenuProps> = ({
  label, options, disabled = false, onChange,
}) => {
  const id = useId();
  const className = "account-notification-menu";
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 320 });
  const internalTriggerRef = useRef<HTMLButtonElement>(null);
  const triggerRef = internalTriggerRef;
  const menuRef = useRef<HTMLDivElement>(null);
  const initialFocus = useRef(0);
  const unavailable = disabled || options.length === 0;
  const summary = options.filter(option => option.enabled).map(option => option.name).join(", ") || "关闭";

  useEffect(() => {
    if (open && unavailable) setOpen(false);
    else if (open) menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemcheckbox]")[initialFocus.current]?.focus();
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
      const width = menuRef.current?.offsetWidth || 240;
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
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemcheckbox]") ?? []);
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
      onClick={() => open ? close() : show(0)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          show(event.key === "ArrowUp" ? options.length - 1 : 0);
        }
      }}>
      <span>{summary}</span><ChevronDown size={12} aria-hidden="true" />
    </button>
    {open && !unavailable && createPortal(<div id={`${id}-menu`} ref={menuRef} role="menu" aria-label={label}
      className={`general-preference-menu ${className}`} style={position} onBlur={handleBlur} onKeyDown={handleMenuKeyDown}>
      {options.map(option => <button type="button" key={option.channel} role="menuitemcheckbox"
        aria-checked={option.enabled} onClick={() => {
          if (!unavailable) onChange(option.channel, !option.enabled);
        }}>
        <span>{option.name}</span>{option.enabled && <Check size={14} aria-hidden="true" />}
      </button>)}
    </div>, document.body)}
  </div>;
};

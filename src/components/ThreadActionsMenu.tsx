import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRightIcon } from "./Icons";
import "./ThreadActionsMenu.css";

export interface ThreadActionItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  separatorBefore?: boolean;
  children?: ThreadActionItem[];
  type?: "radio" | "checkbox" | "label";
  checked?: boolean;
}

export interface ThreadActionsMenuProps {
  items: ThreadActionItem[];
  onSelect: (id: string) => void;
  label?: string | React.ReactNode;
  align?: "left" | "right";
  buttonClassName?: string;
  triggerAriaLabel?: string;
  onOpenChange?: (open: boolean) => void;
}

interface MenuPosition {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

const MENU_GAP = 6;
const VIEWPORT_MARGIN = 8;

export const ThreadActionsMenu: React.FC<ThreadActionsMenuProps> = ({
  items,
  onSelect,
  label,
  align = "right",
  buttonClassName,
  triggerAriaLabel = "聊天操作",
  onOpenChange,
}) => {
  const [open, setOpen] = useState<boolean>(false);
  const [activeSubmenuId, setActiveSubmenuId] = useState<string | null>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [submenuPosition, setSubmenuPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const submenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const focusSubmenuRef = useRef(false);
  const lifecycleRef = useRef({ open, onOpenChange });
  lifecycleRef.current = { open, onOpenChange };

  useEffect(() => () => {
    if (lifecycleRef.current.open) {
      lifecycleRef.current.open = false;
      lifecycleRef.current.onOpenChange?.(false);
    }
  }, []);

  const safeItems = Array.isArray(items) ? items : [];

  const closeMenu = useCallback((refocusTrigger: boolean) => {
    setOpen(false);
    lifecycleRef.current.open = false;
    onOpenChange?.(false);
    setActiveSubmenuId(null);
    setPosition(null);
    setSubmenuPosition(null);
    focusSubmenuRef.current = false;
    if (refocusTrigger) {
      triggerRef.current?.focus();
    }
  }, [onOpenChange]);

  const updateSubmenuPosition = useCallback(() => {
    const trigger = submenuTriggerRef.current;
    const submenu = submenuRef.current;
    if (!trigger || !submenu) return;
    const anchor = trigger.getBoundingClientRect();
    const rect = submenu.getBoundingClientRect();
    const left = anchor.right + MENU_GAP + rect.width <= window.innerWidth - VIEWPORT_MARGIN
      ? anchor.right + MENU_GAP
      : anchor.left - MENU_GAP - rect.width;
    setSubmenuPosition({
      left: Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - rect.width - VIEWPORT_MARGIN)),
      top: Math.max(VIEWPORT_MARGIN, Math.min(anchor.top - 4, window.innerHeight - rect.height - VIEWPORT_MARGIN)),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open || !activeSubmenuId) return;
    updateSubmenuPosition();
    if (focusSubmenuRef.current) {
      const firstItem = submenuRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)');
      if (firstItem) {
        focusSubmenuRef.current = false;
        firstItem.focus();
      }
    }
  }, [open, activeSubmenuId, position, items, updateSubmenuPosition]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = menuRef.current?.getBoundingClientRect().width ?? 230;
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
    const openUpwards = spaceBelow < 380 && rect.top > spaceBelow;

    const next: MenuPosition = {};
    if (openUpwards) {
      next.bottom = window.innerHeight - rect.top + MENU_GAP;
    } else {
      next.top = rect.bottom + MENU_GAP;
    }
    if (align === "right") {
      next.right = Math.max(VIEWPORT_MARGIN, Math.min(window.innerWidth - rect.right, window.innerWidth - menuWidth - VIEWPORT_MARGIN));
    } else {
      next.left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - menuWidth - VIEWPORT_MARGIN));
    }
    setPosition(next);
  }, [align]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, items, updatePosition]);

  useLayoutEffect(() => {
    if (!open) return;

    const handleReflow = () => { updatePosition(); updateSubmenuPosition(); };
    window.addEventListener("resize", handleReflow);
    window.addEventListener("scroll", handleReflow, true);

    const raf = window.requestAnimationFrame(() => {
      const firstItem = menuRef.current?.querySelector<HTMLButtonElement>(
        '[role^="menuitem"]:not(:disabled)'
      );
      firstItem?.focus();
    });

    return () => {
      window.removeEventListener("resize", handleReflow);
      window.removeEventListener("scroll", handleReflow, true);
      window.cancelAnimationFrame(raf);
    };
  }, [open, updatePosition, updateSubmenuPosition]);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      if (submenuRef.current?.contains(target)) return;
      closeMenu(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeMenu(true);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, closeMenu]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const menu = event.currentTarget;
    if (!menu) return;
    if (event.key === "ArrowLeft" && menu === submenuRef.current) {
      event.preventDefault();
      event.stopPropagation();
      setActiveSubmenuId(null);
      setSubmenuPosition(null);
      focusSubmenuRef.current = false;
      submenuTriggerRef.current?.focus();
      return;
    }
    if (event.key === "ArrowRight" && menu === menuRef.current) {
      const button = document.activeElement as HTMLButtonElement | null;
      const item = safeItems.find((candidate) => candidate.id === button?.getAttribute("data-menu-item-id"));
      if (item?.children?.length && !item.disabled && button) {
        event.preventDefault();
        event.stopPropagation();
        submenuTriggerRef.current = button;
        focusSubmenuRef.current = true;
        if (activeSubmenuId === item.id) {
          const firstItem = submenuRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)');
          if (firstItem) {
            focusSubmenuRef.current = false;
            firstItem.focus();
          }
        } else {
          setActiveSubmenuId(item.id);
        }
      }
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
      if (event.key === "Tab") {
        closeMenu(false);
      }
      return;
    }
    const focusable = Array.from(
      menu.querySelectorAll<HTMLButtonElement>(':scope > .thread-actions-item:not(:disabled), :scope > .thread-actions-item-wrap > .thread-actions-item:not(:disabled)')
    );
    if (focusable.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const focusItem = (button: HTMLButtonElement | undefined) => {
      button?.focus();
      if (menu === menuRef.current && button?.getAttribute("data-menu-item-id") !== activeSubmenuId) {
        setActiveSubmenuId(null);
        setSubmenuPosition(null);
      }
    };
    if (event.key === "Home") {
      focusItem(focusable[0]);
      return;
    }
    if (event.key === "End") {
      focusItem(focusable[focusable.length - 1]);
      return;
    }
    const step = event.key === "ArrowDown" ? 1 : -1;
    const currentIndex = focusable.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      currentIndex < 0
        ? step > 0
          ? 0
          : focusable.length - 1
        : (currentIndex + step + focusable.length) % focusable.length;
    focusItem(focusable[nextIndex]);
  };

  const handleSelect = (item: ThreadActionItem, button: HTMLButtonElement) => {
    if (item.disabled || item.type === "label") return;
    if (item.children && item.children.length > 0) {
      submenuTriggerRef.current = button;
      focusSubmenuRef.current = true;
      if (activeSubmenuId === item.id) {
        const firstItem = submenuRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)');
        if (firstItem) {
          focusSubmenuRef.current = false;
          firstItem.focus();
        }
      } else {
        setActiveSubmenuId(item.id);
      }
      return;
    }
    closeMenu(true);
    onSelect(item.id);
  };

  const renderItem = (item: ThreadActionItem, submenu = false) => {
    const hasChildren = !submenu && Boolean(item.children?.length);
    const isSubmenuOpen = hasChildren && activeSubmenuId === item.id;
    return (
      <React.Fragment key={item.id}>
        {item.separatorBefore && <div className="thread-actions-separator" role="separator" />}
        {item.type === "label" ? (
          <div className="thread-actions-label">{item.label}</div>
        ) : (
          <div
            className={`thread-actions-item-wrap ${hasChildren ? "has-submenu" : ""}`}
            onMouseEnter={(event) => {
              if (submenu) return;
              if (hasChildren && !item.disabled) {
                submenuTriggerRef.current = event.currentTarget.querySelector("button");
                focusSubmenuRef.current = false;
                setActiveSubmenuId(item.id);
              } else {
                setActiveSubmenuId(null);
                setSubmenuPosition(null);
              }
            }}
          >
            <button
              type="button"
              data-menu-item-id={item.id}
              role={item.type === "radio" ? "menuitemradio" : item.type === "checkbox" ? "menuitemcheckbox" : "menuitem"}
              aria-checked={item.type === "radio" || item.type === "checkbox" ? !!item.checked : undefined}
              aria-haspopup={hasChildren ? "menu" : undefined}
              aria-expanded={hasChildren ? isSubmenuOpen : undefined}
              className={`thread-actions-item${item.danger ? " is-danger" : ""}${isSubmenuOpen ? " is-active" : ""}`}
              disabled={item.disabled}
              onClick={(event) => handleSelect(item, event.currentTarget)}
              title={item.hint || item.label}
            >
              {item.icon && <span className="thread-actions-item-icon">{item.icon}</span>}
              <span className="thread-actions-item-label">{item.label}</span>
              {item.hint && <span className="thread-actions-item-hint">{item.hint}</span>}
              {(item.type === "radio" || item.type === "checkbox") && (
                <span className="thread-actions-item-check" aria-hidden="true">{item.checked ? "✓" : ""}</span>
              )}
              {hasChildren && <span className="thread-actions-item-arrow"><ChevronRightIcon size={13} /></span>}
            </button>
          </div>
        )}
      </React.Fragment>
    );
  };

  const activeSubmenu = safeItems.find((item) => item.id === activeSubmenuId);

  const triggerClassName = ["thread-actions-trigger", open ? "is-open" : "", buttonClassName || ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="thread-actions-anchor">
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerAriaLabel}
        title={typeof label === "string" ? label : triggerAriaLabel}
        onClick={() => {
          if (open) {
            closeMenu(false);
          } else {
            setOpen(true);
            lifecycleRef.current.open = true;
            onOpenChange?.(true);
          }
        }}
      >
        <span className="thread-actions-trigger-content">
          {label ?? "⋯"}
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={`thread-actions-menu thread-actions-menu--${align}`}
            style={{
              top: position?.top,
              bottom: position?.bottom,
              left: position?.left,
              right: position?.right,
            }}
            role="menu"
            aria-label={triggerAriaLabel}
            onKeyDown={handleMenuKeyDown}
          >
            {safeItems.length === 0 ? (
              <div className="thread-actions-empty">暂无可用操作</div>
            ) : (
              safeItems.map((item) => renderItem(item))
            )}
          </div>,
          document.body
        )}
      {open && activeSubmenu?.children?.length && createPortal(
        <div
          ref={submenuRef}
          className="thread-actions-submenu"
          role="menu"
          aria-label={activeSubmenu.label}
          style={{ top: submenuPosition?.top, left: submenuPosition?.left }}
          onKeyDown={handleMenuKeyDown}
        >
          {activeSubmenu.children.map((item) => renderItem(item, true))}
        </div>,
        document.body
      )}
    </div>
  );
};

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
}

export interface ThreadActionsMenuProps {
  items: ThreadActionItem[];
  onSelect: (id: string) => void;
  label?: string | React.ReactNode;
  align?: "left" | "right";
  buttonClassName?: string;
  triggerAriaLabel?: string;
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
}) => {
  const [open, setOpen] = useState<boolean>(false);
  const [activeSubmenuId, setActiveSubmenuId] = useState<string | null>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const safeItems = Array.isArray(items) ? items : [];

  const closeMenu = useCallback((refocusTrigger: boolean) => {
    setOpen(false);
    setActiveSubmenuId(null);
    setPosition(null);
    if (refocusTrigger) {
      triggerRef.current?.focus();
    }
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
    const openUpwards = spaceBelow < 380 && rect.top > spaceBelow;

    const next: MenuPosition = {};
    if (openUpwards) {
      next.bottom = window.innerHeight - rect.top + MENU_GAP;
    } else {
      next.top = rect.bottom + MENU_GAP;
    }
    if (align === "right") {
      next.right = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.right);
    } else {
      next.left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - VIEWPORT_MARGIN));
    }
    setPosition(next);
  }, [align]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();

    const handleReflow = () => updatePosition();
    window.addEventListener("resize", handleReflow);
    window.addEventListener("scroll", handleReflow, true);

    const raf = window.requestAnimationFrame(() => {
      const firstItem = menuRef.current?.querySelector<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)'
      );
      firstItem?.focus();
    });

    return () => {
      window.removeEventListener("resize", handleReflow);
      window.removeEventListener("scroll", handleReflow, true);
      window.cancelAnimationFrame(raf);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
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
    const menu = menuRef.current;
    if (!menu) return;
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
    if (event.key === "Home") {
      focusable[0]?.focus();
      return;
    }
    if (event.key === "End") {
      focusable[focusable.length - 1]?.focus();
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
    focusable[nextIndex]?.focus();
  };

  const handleSelect = (item: ThreadActionItem) => {
    if (item.disabled) return;
    if (item.children && item.children.length > 0) {
      setActiveSubmenuId((prev) => (prev === item.id ? null : item.id));
      return;
    }
    closeMenu(false);
    onSelect(item.id);
  };

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
              safeItems.map((item) => {
                const hasChildren = Boolean(item.children && item.children.length > 0);
                const isSubmenuOpen = activeSubmenuId === item.id;

                return (
                  <React.Fragment key={item.id}>
                    {item.separatorBefore && (
                      <div className="thread-actions-separator" role="separator" />
                    )}
                    <div
                      className={`thread-actions-item-wrap ${hasChildren ? "has-submenu" : ""}`}
                      onMouseEnter={() => {
                        if (hasChildren) setActiveSubmenuId(item.id);
                      }}
                      onMouseLeave={() => {
                        if (hasChildren) setActiveSubmenuId(null);
                      }}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className={`thread-actions-item${item.danger ? " is-danger" : ""}${isSubmenuOpen ? " is-active" : ""}`}
                        disabled={item.disabled}
                        onClick={() => handleSelect(item)}
                        title={item.hint || item.label}
                      >
                        {item.icon && <span className="thread-actions-item-icon">{item.icon}</span>}
                        <span className="thread-actions-item-label">{item.label}</span>
                        {item.hint && <span className="thread-actions-item-hint">{item.hint}</span>}
                        {hasChildren && (
                          <span className="thread-actions-item-arrow">
                            <ChevronRightIcon size={13} />
                          </span>
                        )}
                      </button>

                      {hasChildren && isSubmenuOpen && (
                        <div className="thread-actions-submenu" role="menu">
                          {item.children!.map((subItem) => (
                            <React.Fragment key={subItem.id}>
                              {subItem.separatorBefore && (
                                <div className="thread-actions-separator" role="separator" />
                              )}
                              <button
                                type="button"
                                role="menuitem"
                                className={`thread-actions-item${subItem.danger ? " is-danger" : ""}`}
                                disabled={subItem.disabled}
                                onClick={() => {
                                  closeMenu(false);
                                  onSelect(subItem.id);
                                }}
                                title={subItem.hint || subItem.label}
                              >
                                {subItem.icon && <span className="thread-actions-item-icon">{subItem.icon}</span>}
                                <span className="thread-actions-item-label">{subItem.label}</span>
                                {subItem.hint && <span className="thread-actions-item-hint">{subItem.hint}</span>}
                              </button>
                            </React.Fragment>
                          ))}
                        </div>
                      )}
                    </div>
                  </React.Fragment>
                );
              })
            )}
          </div>,
          document.body
        )}
    </div>
  );
};

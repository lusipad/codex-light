import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderIcon, PlusIcon, CheckIcon, SearchIcon } from "./Icons";
import { WorkspaceRootItem } from "../types";
import { createChatSearchMatcher } from "../chatSearchMatch";
import "./WorkspacePopover.css";

export interface WorkspacePopoverProps {
  workspaces: WorkspaceRootItem[];
  activeWorkspacePath: string;
  activeProjectId?: string;
  onSelectWorkspace: (path: string, projectId?: string) => void;
  onCreateProject: () => void;
  onClearProject: () => void;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
}

export const WorkspacePopover: React.FC<WorkspacePopoverProps> = ({
  workspaces, activeWorkspacePath, activeProjectId, onSelectWorkspace, onCreateProject, onClearProject,
  onClose, triggerRef, composerRef,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const closed = useRef(false);
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const listId = useId();
  const filtered = useMemo(() => {
    if (!query.trim()) return workspaces;
    const match = createChatSearchMatcher(query);
    const matchNormalized = createChatSearchMatcher(query.normalize("NFC"));
    const score = (value: string) => match(value)?.score ?? matchNormalized(value.normalize("NFC"))?.score ?? 0;
    return workspaces.map(workspace => ({ workspace, score: Math.max(score(workspace.label), score(workspace.path)) }))
      .filter(result => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(result => result.workspace);
  }, [query, workspaces]);
  const hasProject = Boolean(activeProjectId || activeWorkspacePath);
  const entryCount = filtered.length + 1 + Number(hasProject);
  const activeIndex = !filtered.length && query.trim() && !navigated ? -1 : Math.min(highlighted, entryCount - 1);
  const itemId = (index: number) => `${listId}-item-${index}`;

  const close = () => {
    if (closed.current) return;
    closed.current = true;
    closeCallback.current();
  };
  const returnToComposer = () => {
    close();
    requestAnimationFrame(() => {
      if (document.hasFocus() && composerRef.current?.isConnected) composerRef.current.focus();
    });
  };
  const activate = (index: number) => {
    if (closed.current || index < 0) return;
    if (index < filtered.length) {
      onSelectWorkspace(filtered[index].path, filtered[index].id);
      returnToComposer();
    } else if (index === filtered.length) {
      close();
      onCreateProject();
    } else if (hasProject) {
      onClearProject();
      returnToComposer();
    }
  };

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    const trigger = triggerRef.current;
    if (!popover || !trigger) return;
    const position = () => {
      if (!trigger.isConnected) return;
      const anchor = trigger.getBoundingClientRect();
      const bounds = popover.getBoundingClientRect();
      const above = Math.max(0, anchor.top - 11);
      const below = Math.max(0, window.innerHeight - anchor.bottom - 11);
      const onTop = bounds.height <= above || above >= below;
      const maxHeight = Math.max(0, Math.min(350, onTop ? above : below, window.innerHeight - 16));
      const height = Math.min(bounds.height, maxHeight);
      const preferredTop = onTop ? anchor.top - 5 - height : anchor.bottom + 5;
      const top = Math.max(6, Math.min(preferredTop, window.innerHeight - height - 6));
      const left = Math.max(6, Math.min(anchor.left + anchor.width / 2 - bounds.width / 2,
        window.innerWidth - bounds.width - 6));
      popover.style.position = "fixed";
      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
      popover.style.maxHeight = `${maxHeight}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(trigger);
    observer.observe(popover);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [triggerRef]);

  useEffect(() => {
    searchRef.current?.focus();
    const outside = (event: MouseEvent | FocusEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [triggerRef]);

  return createPortal(
    <div id="home-project-picker" role="dialog" aria-label="选择项目" className="workspace-popover-menu" ref={popoverRef} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        const restore = popoverRef.current?.contains(document.activeElement);
        close();
        if (restore && document.hasFocus() && triggerRef.current?.isConnected) triggerRef.current.focus();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const targets = [searchRef.current, createRef.current, clearRef.current].filter(Boolean);
        const index = targets.indexOf(document.activeElement as HTMLInputElement | HTMLButtonElement);
        targets[(index + (event.shiftKey ? targets.length - 1 : 1)) % targets.length]?.focus();
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? entryCount - 1
          : Math.max(0, Math.min(entryCount - 1, activeIndex + (event.key === "ArrowDown" ? 1 : -1)));
        setHighlighted(next);
        setNavigated(true);
        popoverRef.current?.querySelector<HTMLElement>(`[id="${itemId(next)}"]`)?.scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter") {
        event.preventDefault();
        activate(activeIndex);
      }
    }}>
      <div className="workspace-popover-search">
        <SearchIcon size={16} />
        <input ref={searchRef} role="combobox" aria-label="搜索项目" placeholder="搜索项目"
          aria-expanded={true} aria-controls={listId} aria-activedescendant={activeIndex >= 0 ? itemId(activeIndex) : undefined}
          autoComplete="off" value={query} onChange={event => {
            setQuery(event.target.value);
            setHighlighted(0);
            setNavigated(false);
          }} />
      </div>
      <div id={listId} role="listbox" aria-label="项目" className="workspace-popover-list">
        <div className="workspace-popover-results">
          {filtered.map((workspace, index) => {
            const label = workspace.label || workspace.path.split(/[/\\]/).pop() || workspace.path;
            const current = activeProjectId ? workspace.id === activeProjectId : workspace.path === activeWorkspacePath;
            return <div key={workspace.id} id={itemId(index)} role="option" aria-selected={activeIndex === index}
              data-current={current || undefined} className="workspace-item-row" title={workspace.path}
              onPointerMove={() => { setHighlighted(index); setNavigated(true); }}
              onMouseDown={event => event.preventDefault()} onClick={() => activate(index)}>
              <FolderIcon size={16} />
              <span className="workspace-item-name">{label}</span>
              {current && <CheckIcon size={14} />}
            </div>;
          })}
          {!filtered.length && <div className="workspace-popover-empty">未找到项目</div>}
        </div>
        <div className="workspace-popover-footer">
          <button ref={createRef} type="button" role="option" aria-selected={activeIndex === filtered.length}
            id={itemId(filtered.length)} className="workspace-action-btn"
            data-highlighted={activeIndex === filtered.length || undefined}
            onFocus={() => { setHighlighted(filtered.length); setNavigated(true); }}
            onClick={() => activate(filtered.length)}>
            <PlusIcon size={16} /><span>新建项目</span>
          </button>
          {hasProject && <button ref={clearRef} type="button" role="option" aria-selected={activeIndex === filtered.length + 1}
            id={itemId(filtered.length + 1)} className="workspace-action-btn"
            data-highlighted={activeIndex === filtered.length + 1 || undefined}
            onFocus={() => { setHighlighted(filtered.length + 1); setNavigated(true); }}
            onClick={() => activate(filtered.length + 1)}>不在项目中工作</button>}
        </div>
      </div>
    </div>, document.body
  );
};

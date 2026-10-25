import React, { useEffect, useRef, useState } from "react";
import {
  CloverCodexIcon,
  DiffIcon,
  EllipsisIcon,
  FolderIcon,
  PlusIcon,
} from "./Icons";
import "./ProjectSourcesPopover.css";

export interface ProjectSourcesPopoverProps {
  workspaceName: string;
  workspacePath: string;
  onOpenChanges: () => void;
  onOpenSourcesHub?: () => void;
  onOpenWorkspaces?: () => void;
  onClose: () => void;
}

export const ProjectSourcesPopover: React.FC<ProjectSourcesPopoverProps> = ({
  workspaceName,
  workspacePath,
  onOpenChanges,
  onOpenSourcesHub,
  onOpenWorkspaces,
  onClose,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [showProjectActions, setShowProjectActions] = useState(false);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="project-sources-popover" ref={popoverRef} role="dialog" aria-label="项目与来源">
      {/* Top Project Header */}
      <div className="project-sources-header">
        <span className="project-sources-title" title={workspacePath}>
          {workspaceName || "codex-project"}
        </span>
        <button
          type="button"
          className="project-sources-icon-btn"
          title="项目操作"
          onClick={() => setShowProjectActions((v) => !v)}
        >
          <EllipsisIcon size={14} />
        </button>

        {showProjectActions && (
          <div className="project-actions-flyout">
            <button
              type="button"
              className="project-action-row"
              onClick={() => {
                setShowProjectActions(false);
                onClose();
                onOpenWorkspaces?.();
              }}
            >
              <FolderIcon size={14} />
              <span>切换项目/工作区...</span>
            </button>
          </div>
        )}
      </div>

      {/* Changes Shortcut */}
      <button
        type="button"
        className="project-sources-item"
        onClick={() => {
          onClose();
          onOpenChanges();
        }}
      >
        <span className="project-sources-item-icon">
          <DiffIcon size={16} />
        </span>
        <span className="project-sources-item-label">变更</span>
      </button>

      <div className="project-sources-divider" />

      {/* Sources Section */}
      <div className="project-sources-section-header">
        <span className="project-sources-section-title">来源</span>
        <button
          type="button"
          className="project-sources-icon-btn"
          title="添加来源"
          onClick={() => {
            onClose();
            onOpenSourcesHub?.();
          }}
        >
          <PlusIcon size={14} />
        </button>
      </div>

      {/* Codex Source Item */}
      <div className="project-sources-item" style={{ cursor: "default" }}>
        <span className="project-sources-item-icon">
          <CloverCodexIcon size={16} />
        </span>
        <span className="project-sources-item-label">Codex</span>
        <span className="project-source-status-dot" title="Codex 代理已就绪" />
      </div>

      {/* View All Item */}
      <button
        type="button"
        className="project-sources-item"
        onClick={() => {
          onClose();
          onOpenSourcesHub?.();
        }}
      >
        <span className="project-sources-item-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="19" r="3" />
            <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
            <circle cx="18" cy="5" r="3" />
          </svg>
        </span>
        <span className="project-sources-item-label">查看全部</span>
      </button>
    </div>
  );
};

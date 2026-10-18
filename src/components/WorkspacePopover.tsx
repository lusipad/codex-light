import React, { useEffect, useRef } from "react";
import { FolderIcon, PlusIcon, CheckIcon, CloseIcon } from "./Icons";
import { WorkspaceRootItem } from "../types";

export interface WorkspacePopoverProps {
  workspaces: WorkspaceRootItem[];
  activeWorkspacePath: string;
  hasAgentsMd: boolean;
  onSelectWorkspace: (path: string) => void;
  onRemoveWorkspace: (path: string, e: React.MouseEvent) => void;
  onPickNewFolder: () => void;
  onOpenAgentsMd: () => void;
  onClose: () => void;
}

export const WorkspacePopover: React.FC<WorkspacePopoverProps> = ({
  workspaces,
  activeWorkspacePath,
  hasAgentsMd,
  onSelectWorkspace,
  onRemoveWorkspace,
  onPickNewFolder,
  onOpenAgentsMd,
  onClose,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div className="workspace-popover-menu" ref={popoverRef}>
      <div className="workspace-popover-header">工作区列表</div>

      <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {workspaces.map((ws) => {
          const isActive = ws.path === activeWorkspacePath || ws.active;
          return (
            <div
              key={ws.path}
              className={`workspace-item-row ${isActive ? "active" : ""}`}
              onClick={() => {
                onSelectWorkspace(ws.path);
                onClose();
              }}
              title={ws.path}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                <FolderIcon size={16} />
                <div className="workspace-item-info">
                  <span className="workspace-item-name">{ws.label || ws.path.split(/[/\\]/).pop()}</span>
                  <span className="workspace-item-path">{ws.path}</span>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {isActive && <CheckIcon size={14} />}
                {workspaces.length > 1 && (
                  <button
                    type="button"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--text-tertiary)",
                      cursor: "pointer",
                      padding: 4,
                      borderRadius: 4,
                    }}
                    title="从列表中移除此工作区"
                    onClick={(e) => onRemoveWorkspace(ws.path, e)}
                  >
                    <CloseIcon size={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="popover-divider" />

      <button type="button" className="workspace-action-btn" onClick={onPickNewFolder}>
        <PlusIcon size={15} />
        <span>打开其他本地目录...</span>
      </button>

      {hasAgentsMd && (
        <button
          type="button"
          className="workspace-action-btn"
          style={{ color: "var(--accent-blue)" }}
          onClick={() => {
            onClose();
            onOpenAgentsMd();
          }}
        >
          <span>📜 查看工作区 AGENTS.md 规范</span>
        </button>
      )}
    </div>
  );
};

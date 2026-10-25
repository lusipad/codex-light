import React, { useState, useEffect } from "react";
import { TargetIcon, CloseIcon } from "./Icons";

export interface ThreadGoalModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialObjective?: string;
  isExistingGoal?: boolean;
  onSaveGoal: (objective: string) => void;
}

/**
 * Official 1:1 Thread Goal Editor Dialog (matches `composer.threadGoal.editDialog` in Codex App)
 */
export const ThreadGoalModal: React.FC<ThreadGoalModalProps> = ({
  isOpen,
  onClose,
  initialObjective = "",
  isExistingGoal = false,
  onSaveGoal,
}) => {
  const [objective, setObjective] = useState<string>(initialObjective);

  useEffect(() => {
    if (isOpen) {
      setObjective(initialObjective);
    }
  }, [isOpen, initialObjective]);

  if (!isOpen) return null;

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = objective.trim();
    if (!trimmed) return;
    onSaveGoal(trimmed);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card thread-goal-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 520, width: "90%" }}
      >
        <div className="modal-header">
          <div className="modal-title-with-badge">
            <TargetIcon size={16} className="text-secondary" />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              {isExistingGoal ? "Edit goal" : "Set goal"}
            </h3>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="thread-goal-input-container">
            <textarea
              className="thread-goal-textarea"
              rows={8}
              autoFocus
              aria-label="Goal"
              placeholder="Set a goal to keep pursuing..."
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>

          <div className="modal-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!objective.trim()}
            >
              {isExistingGoal ? "Save" : "Set goal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

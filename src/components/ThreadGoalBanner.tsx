import React from "react";
import { ThreadGoal, ThreadGoalStatus } from "../threadGoal";
import { TargetIcon, PlayIcon, PauseIcon, PencilIcon, CloseIcon } from "./Icons";

export interface ThreadGoalBannerProps {
  goal: ThreadGoal;
  onEdit: () => void;
  onTogglePause: () => void;
  onClear: () => void;
}

export function getGoalSummaryLabel(status: ThreadGoalStatus): string {
  switch (status) {
    case "active":
      return "Pursuing goal";
    case "paused":
      return "Paused goal";
    case "blocked":
      return "Goal stalled";
    case "usageLimited":
      return "Goal usage limited";
    case "budgetLimited":
      return "Goal limited";
    case "complete":
      return "Goal achieved";
    default:
      return "Goal";
  }
}

/**
 * Official 1:1 Thread Goal Banner (matches `bKe` above-composer row in Codex App)
 */
export const ThreadGoalBanner: React.FC<ThreadGoalBannerProps> = ({
  goal,
  onEdit,
  onTogglePause,
  onClear,
}) => {
  const isPaused = goal.status === "paused";
  const statusLabel = getGoalSummaryLabel(goal.status);

  return (
    <div className={`composer-thread-goal-banner status-${goal.status}`}>
      <div className="goal-banner-content" onClick={onEdit} title="点击编辑目标 (Click to edit goal)">
        <TargetIcon className="goal-banner-leading-icon" size={15} />
        <span className={`goal-status-badge badge-${goal.status}`}>
          <span className="goal-status-dot" />
          {statusLabel}
        </span>
        <span className="goal-objective-text" title={goal.objective}>
          {goal.objective}
        </span>
      </div>

      <div className="goal-banner-actions">
        <button
          type="button"
          className="goal-action-btn"
          onClick={onEdit}
          title="Edit goal"
          aria-label="Edit goal"
        >
          <PencilIcon size={13} />
        </button>
        <button
          type="button"
          className="goal-action-btn"
          onClick={onTogglePause}
          title={isPaused ? "Resume goal" : "Pause goal"}
          aria-label={isPaused ? "Resume goal" : "Pause goal"}
        >
          {isPaused ? <PlayIcon size={13} /> : <PauseIcon size={13} />}
        </button>
        <button
          type="button"
          className="goal-action-btn close-action"
          onClick={onClear}
          title="Clear goal"
          aria-label="Clear goal"
        >
          <CloseIcon size={13} />
        </button>
      </div>
    </div>
  );
};

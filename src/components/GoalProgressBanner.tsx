import React, { useState } from "react";
import { ActiveGoalSession, GoalStepItem } from "../types";
import {
  CheckIcon,
  CloseIcon,
  PlayIcon,
  SparklesIcon,
  StopIcon,
  ShieldIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "./Icons";

export interface GoalProgressBannerProps {
  goal: ActiveGoalSession;
  isStreaming: boolean;
  countdown: number | null;
  onPause: () => void;
  onResume: () => void;
  onAbort: () => void;
  onTriggerNextNow: () => void;
  onRunVerification: () => void;
  onToggleStep: (stepId: string) => void;
  onAddStep?: (title: string) => void;
}

export const GoalProgressBanner: React.FC<GoalProgressBannerProps> = ({
  goal,
  isStreaming,
  countdown,
  onPause,
  onResume,
  onAbort,
  onTriggerNextNow,
  onRunVerification,
  onToggleStep,
  onAddStep,
}) => {
  const [showChecklist, setShowChecklist] = useState<boolean>(false);
  const [newStepText, setNewStepText] = useState<string>("");
  const [showVerifyOutput, setShowVerifyOutput] = useState<boolean>(false);

  const completedStepsCount = goal.steps.filter((s) => s.status === "completed").length;
  const totalStepsCount = goal.steps.length;
  const progressPercent =
    totalStepsCount > 0 ? Math.round((completedStepsCount / totalStepsCount) * 100) : 0;

  const handleAddStepSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newStepText.trim() && onAddStep) {
      onAddStep(newStepText.trim());
      setNewStepText("");
    }
  };

  return (
    <div className={`goal-progress-banner-container status-${goal.status}`}>
      <div className="goal-banner-main-row">
        {/* Left: Indicator & Objective */}
        <div className="goal-banner-left">
          <div className="goal-banner-badge-group">
            <span className="goal-banner-icon">🎯</span>
            <span className={`goal-status-dot dot-${goal.status}`} />
            <span className="goal-status-text">
              {goal.status === "running"
                ? isStreaming
                  ? "正在执行中..."
                  : countdown !== null
                  ? `等待推进 (${countdown}s)`
                  : "自主推进中"
                : goal.status === "paused"
                ? "已暂停"
                : goal.status === "completed"
                ? "目标已达成"
                : "已终止"}
            </span>
          </div>

          <div className="goal-turn-badge" title="当前自主轮次 / 最大上限">
            轮次 {goal.currentTurn} / {goal.maxTurns}
          </div>

          <div className="goal-objective-preview" title={goal.objective}>
            <span className="goal-objective-label">目标:</span>
            <span className="goal-objective-text">{goal.objective}</span>
          </div>
        </div>

        {/* Center: Steps & Verification */}
        <div className="goal-banner-center">
          {totalStepsCount > 0 && (
            <div
              className={`goal-steps-chip ${showChecklist ? "active" : ""}`}
              onClick={() => setShowChecklist((v) => !v)}
              title="查看与管理目标分解任务清单"
            >
              <span className="goal-steps-chip-text">
                📋 清单 {completedStepsCount}/{totalStepsCount} 完成
              </span>
              <div className="goal-mini-progress-bar">
                <div
                  className="goal-mini-progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <ChevronDownIcon size={12} />
            </div>
          )}

          {goal.autoVerifyCommand && (
            <div className="goal-verify-chip-group">
              <button
                type="button"
                className={`goal-verify-badge status-${goal.verificationStatus}`}
                onClick={() => {
                  if (goal.verificationOutput) {
                    setShowVerifyOutput((v) => !v);
                  } else {
                    onRunVerification();
                  }
                }}
                title={
                  goal.verificationOutput
                    ? "点击查看最新验证命令输出"
                    : `验证命令: ${goal.autoVerifyCommand}`
                }
              >
                {goal.verificationStatus === "running" ? (
                  <span>⏳ 验证运行中...</span>
                ) : goal.verificationStatus === "passed" ? (
                  <span>✅ 验证通过 ({goal.autoVerifyCommand})</span>
                ) : goal.verificationStatus === "failed" ? (
                  <span>❌ 验证失败 (查看输出)</span>
                ) : (
                  <span>🧪 {goal.autoVerifyCommand}</span>
                )}
              </button>

              <button
                type="button"
                className="goal-run-verify-btn"
                onClick={onRunVerification}
                disabled={goal.verificationStatus === "running"}
                title="立即手动运行验证命令"
              >
                运行
              </button>
            </div>
          )}
        </div>

        {/* Right: Countdown & Execution Controls */}
        <div className="goal-banner-right">
          {countdown !== null && goal.status === "running" && (
            <div className="goal-countdown-box">
              <span className="goal-countdown-timer">⏳ {countdown}s 自动推进</span>
              <button
                type="button"
                className="goal-btn-primary-compact"
                onClick={onTriggerNextNow}
                title="跳过等待，立即推进下一轮"
              >
                立即继续
              </button>
            </div>
          )}

          {goal.status === "running" && (
            <button
              type="button"
              className="goal-control-btn pause"
              onClick={onPause}
              title="暂停自主循环"
            >
              ⏸️ 暂停
            </button>
          )}

          {goal.status === "paused" && (
            <button
              type="button"
              className="goal-control-btn resume"
              onClick={onResume}
              title="继续自主推进"
            >
              ▶️ 继续推进
            </button>
          )}

          {goal.status !== "completed" && goal.status !== "aborted" && (
            <button
              type="button"
              className="goal-control-btn abort"
              onClick={onAbort}
              title="终止目标任务"
            >
              ⏹️ 终止
            </button>
          )}

          {goal.status === "completed" && (
            <span className="goal-completed-trophy">🏆 目标达成！</span>
          )}
        </div>
      </div>

      {/* Interactive Checklist Popover Drawer */}
      {showChecklist && (
        <div className="goal-checklist-drawer">
          <div className="goal-checklist-header">
            <strong>📋 目标分解步骤清单 ({completedStepsCount}/{totalStepsCount})</strong>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setShowChecklist(false)}
            >
              <CloseIcon size={14} />
            </button>
          </div>

          <div className="goal-checklist-items">
            {goal.steps.length === 0 ? (
              <div className="goal-checklist-empty">
                模型正在分析任务并提取分解步骤清单...
              </div>
            ) : (
              goal.steps.map((step) => (
                <div
                  key={step.id}
                  className={`goal-step-item status-${step.status}`}
                  onClick={() => onToggleStep(step.id)}
                >
                  <input
                    type="checkbox"
                    checked={step.status === "completed"}
                    onChange={() => onToggleStep(step.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="goal-step-title">{step.title}</span>
                </div>
              ))
            )}
          </div>

          {onAddStep && (
            <form onSubmit={handleAddStepSubmit} className="goal-add-step-form">
              <input
                type="text"
                placeholder="添加自定义子步骤..."
                value={newStepText}
                onChange={(e) => setNewStepText(e.target.value)}
              />
              <button
                type="submit"
                className="btn-approve"
                style={{ padding: "4px 10px", fontSize: 12 }}
                disabled={!newStepText.trim()}
              >
                添加
              </button>
            </form>
          )}
        </div>
      )}

      {/* Verification Output Drawer */}
      {showVerifyOutput && goal.verificationOutput && (
        <div className="goal-verify-output-drawer">
          <div className="goal-verify-output-header">
            <strong>🧪 验证命令输出 ({goal.autoVerifyCommand})</strong>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setShowVerifyOutput(false)}
            >
              <CloseIcon size={14} />
            </button>
          </div>
          <pre className="goal-verify-output-code">{goal.verificationOutput}</pre>
        </div>
      )}
    </div>
  );
};

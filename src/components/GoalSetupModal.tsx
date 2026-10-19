import React, { useState, useEffect } from "react";
import { CloseIcon, ShieldIcon, SparklesIcon, WorktreeIcon } from "./Icons";

export interface GoalSetupConfig {
  objective: string;
  autoVerifyCommand: string;
  maxTurns: number;
  autoContinue: boolean;
  useWorktree: boolean;
}

export interface GoalSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialObjective?: string;
  workspacePath?: string;
  onLaunchGoal: (config: GoalSetupConfig) => void;
}

const OBJECTIVE_PRESETS = [
  "一直推进到全部完成并跑通验证",
  "补全核心业务单元测试并验证通过",
  "复刻全部界面布局并修复样式问题",
  "代码重构、边界处理与健壮性排查",
];

const VERIFY_COMMAND_PRESETS = [
  { label: "npm test", cmd: "npm test" },
  { label: "npm run build", cmd: "npm run build" },
  { label: "cargo check", cmd: "cargo check" },
  { label: "cargo test", cmd: "cargo test" },
  { label: "无验证 (仅自主标记)", cmd: "" },
];

const MAX_TURNS_OPTIONS = [5, 10, 20, 50];

export const GoalSetupModal: React.FC<GoalSetupModalProps> = ({
  isOpen,
  onClose,
  initialObjective = "",
  workspacePath,
  onLaunchGoal,
}) => {
  const [objective, setObjective] = useState<string>(initialObjective);
  const [verifyCommand, setVerifyCommand] = useState<string>("npm test");
  const [maxTurns, setMaxTurns] = useState<number>(10);
  const [autoContinue, setAutoContinue] = useState<boolean>(true);
  const [useWorktree, setUseWorktree] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      if (initialObjective) {
        setObjective(initialObjective);
      }
    }
  }, [isOpen, initialObjective]);

  if (!isOpen) return null;

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!objective.trim()) return;
    onLaunchGoal({
      objective: objective.trim(),
      autoVerifyCommand: verifyCommand.trim(),
      maxTurns,
      autoContinue,
      useWorktree,
    });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card goal-setup-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560, width: "90%" }}
      >
        <div className="modal-header">
          <div className="modal-title-with-badge">
            <span className="goal-target-badge">🎯 /goal</span>
            <h3>启动自主目标执行模式</h3>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} title="关闭 (Esc)">
            <CloseIcon size={16} />
          </button>
        </div>

        <p className="modal-subtitle">
          设定高层目标与验证标准，Codex 将进入多轮自主循环，持续分解步骤、改动代码并运行自动化验证，直至目标全部达成。
        </p>

        <form onSubmit={handleSubmit} className="goal-setup-form">
          {/* Target Objective */}
          <div className="form-group">
            <label className="form-label">
              <span>🎯 目标任务描述 (Objective)</span>
              <span className="form-required">*必填</span>
            </label>
            <textarea
              className="form-textarea goal-objective-textarea"
              rows={3}
              placeholder="例如：实现复刻页面的全部参数设置功能，修复样式并确保测试全部通过..."
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              autoFocus
            />
            {/* Quick preset chips */}
            <div className="goal-preset-chips">
              {OBJECTIVE_PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="goal-chip-btn"
                  onClick={() => setObjective(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Verification Command */}
          <div className="form-group">
            <label className="form-label">
              <span>🧪 自动化验证命令 (Verification Command)</span>
              <span className="form-hint">每轮结束后自动运行此命令检验结果</span>
            </label>
            <input
              type="text"
              className="form-input"
              placeholder="例如: npm test 或 npm run build（留空则基于模型自主确认）"
              value={verifyCommand}
              onChange={(e) => setVerifyCommand(e.target.value)}
            />
            <div className="goal-preset-chips">
              {VERIFY_COMMAND_PRESETS.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`goal-chip-btn ${verifyCommand === item.cmd ? "active" : ""}`}
                  onClick={() => setVerifyCommand(item.cmd)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Max Autonomous Turns */}
          <div className="form-group">
            <label className="form-label">
              <span>🔄 最大自主迭代轮次 (Max Turns)</span>
              <span className="form-hint">防止陷入无限循环，达上限时将暂停并提醒确认</span>
            </label>
            <div className="goal-turn-selector">
              {MAX_TURNS_OPTIONS.map((turns) => (
                <button
                  key={turns}
                  type="button"
                  className={`goal-turn-pill ${maxTurns === turns ? "active" : ""}`}
                  onClick={() => setMaxTurns(turns)}
                >
                  {turns} 轮 {turns === 10 ? "(推荐)" : ""}
                </button>
              ))}
            </div>
          </div>

          {/* Additional Options */}
          <div className="goal-options-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={autoContinue}
                onChange={(e) => setAutoContinue(e.target.checked)}
              />
              <span className="checkbox-text">
                <strong>自动推进下一轮 (3 秒倒计时)</strong>
                <span className="checkbox-desc">
                  单轮完成后若未满足完成标志，倒计时 3 秒后自动触发下一轮提示词继续执行
                </span>
              </span>
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={useWorktree}
                onChange={(e) => setUseWorktree(e.target.checked)}
              />
              <span className="checkbox-text">
                <strong>在独立 Git Worktree 分支隔离运行</strong>
                <span className="checkbox-desc">
                  在干净的分支中尝试改动，避免弄乱当前工作区
                </span>
              </span>
            </label>
          </div>

          {/* Footer Actions */}
          <div className="modal-footer" style={{ marginTop: 20 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              取消
            </button>
            <button
              type="submit"
              className="primary-btn goal-submit-btn"
              disabled={!objective.trim()}
            >
              <span>🎯 启动自主目标模式</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

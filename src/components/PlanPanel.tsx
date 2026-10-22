import React, { useState } from "react";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, XIcon } from "./Icons";
import "./PlanPanel.css";

export interface PlanStep {
  id?: string;
  step?: string;
  title?: string;
  status?: string;
}

export interface PlanPanelProps {
  steps: PlanStep[];
  title?: string;
  defaultCollapsed?: boolean;
}

type PlanStepStatus = "pending" | "inProgress" | "completed" | "failed";

const STATUS_LABELS: Record<PlanStepStatus, string> = {
  pending: "待处理",
  inProgress: "进行中",
  completed: "已完成",
  failed: "失败",
};

function normalizeStepStatus(status?: string): PlanStepStatus {
  const value = (status || "").trim().toLowerCase();
  if (
    value === "inprogress" ||
    value === "in_progress" ||
    value === "in-progress" ||
    value === "running" ||
    value === "active" ||
    value === "started" ||
    value === "working"
  ) {
    return "inProgress";
  }
  if (
    value === "completed" ||
    value === "complete" ||
    value === "done" ||
    value === "success" ||
    value === "succeeded" ||
    value === "finished"
  ) {
    return "completed";
  }
  if (
    value === "failed" ||
    value === "failure" ||
    value === "error" ||
    value === "cancelled" ||
    value === "canceled" ||
    value === "aborted"
  ) {
    return "failed";
  }
  return "pending";
}

function stepText(step: PlanStep): string {
  const text = (step.step || step.title || "").trim();
  return text || "未命名步骤";
}

function StepStatusIcon({ status }: { status: PlanStepStatus }) {
  if (status === "completed") {
    return (
      <span className="plan-step-icon plan-step-icon--completed" aria-hidden="true">
        <CheckIcon size={11} />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="plan-step-icon plan-step-icon--failed" aria-hidden="true">
        <XIcon size={11} />
      </span>
    );
  }
  if (status === "inProgress") {
    return (
      <span className="plan-step-icon plan-step-icon--in-progress" aria-hidden="true">
        <span className="plan-step-spinner" />
      </span>
    );
  }
  return <span className="plan-step-icon plan-step-icon--pending" aria-hidden="true" />;
}

export const PlanPanel: React.FC<PlanPanelProps> = ({
  steps,
  title = "执行计划",
  defaultCollapsed = false,
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed);

  const items = Array.isArray(steps) ? steps : [];
  const totalCount = items.length;
  const completedCount = items.filter(
    (step) => normalizeStepStatus(step.status) === "completed"
  ).length;
  const progressPercent =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <section
      className={`plan-panel${collapsed ? " is-collapsed" : ""}`}
      aria-label={title}
    >
      <div className="plan-panel-header">
        <button
          type="button"
          className="plan-panel-header-btn"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((prev) => !prev)}
          title={collapsed ? "展开执行计划" : "折叠执行计划"}
        >
          <span className="plan-panel-chevron" aria-hidden="true">
            {collapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}
          </span>
          <span className="plan-panel-title">{title}</span>
          <span className="plan-panel-progress-text" title={`已完成 ${completedCount} / ${totalCount} 步`}>
            {completedCount}/{totalCount}
          </span>
        </button>
      </div>

      {!collapsed && (
        <div className="plan-panel-body">
          <div
            className="plan-panel-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={totalCount}
            aria-valuenow={completedCount}
            aria-label={`执行计划进度：已完成 ${completedCount} / ${totalCount} 步`}
          >
            <div
              className={`plan-panel-progress-fill${
                totalCount > 0 && completedCount >= totalCount ? " is-complete" : ""
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {totalCount === 0 ? (
            <div className="plan-panel-empty">暂无执行计划</div>
          ) : (
            <ol className="plan-panel-steps">
              {items.map((step, index) => {
                const status = normalizeStepStatus(step.status);
                const key = step.id || `plan-step-${index}`;
                return (
                  <li className={`plan-step plan-step--${status}`} key={key}>
                    <StepStatusIcon status={status} />
                    <span className="plan-step-text">{stepText(step)}</span>
                    <span className="plan-panel-sr-only">{`（${STATUS_LABELS[status]}）`}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </section>
  );
};

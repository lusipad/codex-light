import React, { useMemo, useState } from "react";
import "./CodeReviewView.css";

export interface ReviewCommitOption {
  hash: string;
  shortHash: string;
  subject: string;
  author?: string;
  relativeTime?: string;
}

export type ReviewKind = "uncommitted" | "branch" | "commit" | "custom";

export interface ReviewRequest {
  kind: ReviewKind;
  branch?: string;
  sha?: string;
  instructions?: string;
}

export interface CodeReviewViewProps {
  workspacePath?: string;
  branches?: string[];
  defaultBranch?: string | null;
  commits?: ReviewCommitOption[];
  busy?: boolean;
  onStartReview: (req: ReviewRequest) => Promise<void> | void;
  onBack?: () => void;
  /** 最近一次审查结果摘要（可选） */
  lastResult?: string | null;
}

const TARGETS: Array<{
  id: ReviewKind;
  title: string;
  desc: string;
  icon: string;
}> = [
  {
    id: "uncommitted",
    title: "未提交改动",
    desc: "审查工作区中已暂存、未暂存与未跟踪的文件",
    icon: "📝",
  },
  {
    id: "branch",
    title: "对比分支",
    desc: "审查当前分支相对某个基线分支的全部差异",
    icon: "🌿",
  },
  {
    id: "commit",
    title: "指定提交",
    desc: "审查某一次提交引入的改动",
    icon: "🔖",
  },
  {
    id: "custom",
    title: "自定义指令",
    desc: "用自由文本描述要审查的范围与关注点",
    icon: "🎯",
  },
];

export const CodeReviewView: React.FC<CodeReviewViewProps> = ({
  workspacePath,
  branches = [],
  defaultBranch,
  commits = [],
  busy = false,
  onStartReview,
  onBack,
  lastResult,
}) => {
  const [kind, setKind] = useState<ReviewKind>("uncommitted");
  const [branch, setBranch] = useState<string>(
    defaultBranch || branches[0] || "main"
  );
  const [sha, setSha] = useState<string>(commits[0]?.hash || "");
  const [instructions, setInstructions] = useState<string>("");

  const branchOptions = useMemo(() => {
    const list = new Set<string>(branches.filter(Boolean));
    if (defaultBranch) list.add(defaultBranch);
    if (!list.size) list.add("main");
    return Array.from(list);
  }, [branches, defaultBranch]);

  const canStart = useMemo(() => {
    if (busy) return false;
    if (!workspacePath) return false;
    if (kind === "branch") return Boolean(branch.trim());
    if (kind === "commit") return Boolean(sha.trim());
    if (kind === "custom") return Boolean(instructions.trim());
    return true;
  }, [busy, workspacePath, kind, branch, sha, instructions]);

  const start = async () => {
    if (!canStart) return;
    await onStartReview({
      kind,
      branch: kind === "branch" ? branch.trim() : undefined,
      sha: kind === "commit" ? sha.trim() : undefined,
      instructions:
        kind === "custom"
          ? instructions.trim()
          : instructions.trim() || undefined,
    });
  };

  return (
    <div className="code-review-view">
      <header className="review-header">
        <div className="review-header-left">
          {onBack && (
            <button type="button" className="review-back-btn" onClick={onBack}>
              ← 返回
            </button>
          )}
          <div>
            <h2 className="review-title">代码审查</h2>
            <p className="review-subtitle">
              对当前工作区执行 Codex 官方 review（`review/start`），审查结果会以对话形式
              流式返回。
            </p>
          </div>
        </div>
        <div className="review-workspace" title={workspacePath || ""}>
          <span className="review-workspace-label">工作区</span>
          <span className="mono ellipsis">
            {workspacePath || "未选择工作区"}
          </span>
        </div>
      </header>

      <div className="review-target-grid">
        {TARGETS.map((target) => (
          <button
            key={target.id}
            type="button"
            className={`review-target-card ${kind === target.id ? "selected" : ""}`}
            onClick={() => setKind(target.id)}
          >
            <span className="review-target-icon">{target.icon}</span>
            <span className="review-target-title">{target.title}</span>
            <span className="review-target-desc">{target.desc}</span>
          </button>
        ))}
      </div>

      <div className="review-form">
        {kind === "branch" && (
          <label className="review-field">
            <span className="review-field-label">基线分支</span>
            <select
              className="review-select"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            >
              {branchOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <span className="review-field-hint">
              将审查当前分支相对 <code>{branch || "…"}</code> 的差异
            </span>
          </label>
        )}

        {kind === "commit" && (
          <label className="review-field">
            <span className="review-field-label">提交</span>
            {commits.length > 0 ? (
              <select
                className="review-select"
                value={sha}
                onChange={(e) => setSha(e.target.value)}
              >
                {commits.map((commit) => (
                  <option key={commit.hash} value={commit.hash}>
                    {commit.shortHash} · {commit.subject}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="review-input mono"
                placeholder="输入 commit SHA"
                value={sha}
                onChange={(e) => setSha(e.target.value)}
              />
            )}
          </label>
        )}

        <label className="review-field">
          <span className="review-field-label">
            {kind === "custom" ? "审查指令" : "附加说明（可选）"}
          </span>
          <textarea
            className="review-textarea"
            rows={kind === "custom" ? 5 : 3}
            placeholder={
              kind === "custom"
                ? "例如：重点检查并发安全与错误处理，忽略格式性问题"
                : "可以补充关注点，例如：重点看依赖升级带来的行为变化"
            }
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>

        <div className="review-actions">
          <button
            type="button"
            className="review-start-btn"
            disabled={!canStart}
            onClick={start}
          >
            {busy ? "正在启动审查…" : "开始审查"}
          </button>
          <span className="review-actions-hint">
            审查会在一个新会话中以内联 turn 运行，可随时中断。
          </span>
        </div>
      </div>

      {lastResult && (
        <div className="review-last-result">
          <div className="review-last-result-title">最近一次审查</div>
          <div className="review-last-result-body">{lastResult}</div>
        </div>
      )}

      {!workspacePath && (
        <div className="review-empty-hint">
          请先在左侧选择一个工作区目录，然后开始代码审查。
        </div>
      )}
    </div>
  );
};

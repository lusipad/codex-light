import { openReviewLink, runPullRequestReview } from "../reviewPreferences";
import React, { useEffect, useMemo, useState } from "react";
import { tauriInvoke } from "../bridge";
import type { ReviewRun } from "../reviewResults";
import type { ModelReviewComment, UnresolvedReviewFinding } from "../reviewFindings";
import { MarkdownView } from "./MarkdownView";
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
  delivery?: "inline" | "detached";
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
  repositoryReady?: boolean;
  onStartReview: (req: ReviewRequest) => Promise<void> | void;
  onBack?: () => void;
  lastResult?: string | null;
  reviewResult?: ReviewRun | null;
  reviewFindings?: ModelReviewComment[];
  unresolvedFindings?: UnresolvedReviewFinding[];
  onOpenReviewFinding?: (finding: ModelReviewComment) => void;
}

interface GhStatus {
  is_installed: boolean;
  is_authenticated: boolean;
  version?: string;
}

interface GitPullRequestItem {
  number: number;
  title: string;
  state: string;
  is_draft: boolean;
  author?: string;
  head_ref_name?: string;
  base_ref_name?: string;
  updated_at?: string;
  additions?: number;
  deletions?: number;
  url?: string;
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
  repositoryReady = true,
  onStartReview,
  onBack,
  lastResult,
  reviewResult,
  reviewFindings = [],
  unresolvedFindings = [],
  onOpenReviewFinding,
}) => {
  const [subTab, setSubTab] = useState<"local" | "pr">("local");
  const [kind, setKind] = useState<ReviewKind>("uncommitted");
  const [branch, setBranch] = useState<string>(
    defaultBranch || branches[0] || ""
  );
  const [sha, setSha] = useState<string>(commits[0]?.hash || "");
  const [instructions, setInstructions] = useState<string>("");

  useEffect(() => {
    setBranch((current) => branches.includes(current) ? current : defaultBranch || branches[0] || "");
  }, [branches, defaultBranch]);
  useEffect(() => {
    if (commits.length) setSha((current) => commits.some((commit) => commit.hash === current) ? current : commits[0].hash);
  }, [commits]);

  // PR tab state
  const [ghStatus, setGhStatus] = useState<GhStatus | null>(null);
  const [ghLoading, setGhLoading] = useState<boolean>(false);
  const [prList, setPrList] = useState<GitPullRequestItem[]>([]);
  const [prLoading, setPrLoading] = useState<boolean>(false);
  const [prError, setPrError] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<boolean>(false);
  const [selectedPr, setSelectedPr] = useState<GitPullRequestItem | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<boolean>(false);
  const [checkoutMsg, setCheckoutMsg] = useState<string | null>(null);
  const prActionPending = React.useRef(false);
  const prActionGeneration = React.useRef(0);
  const [prActionBusy, setPrActionBusy] = useState(false);
  useEffect(() => {
    prActionPending.current = false; setPrActionBusy(false);
    return () => { prActionGeneration.current += 1; };
  }, [workspacePath, subTab]);
  const runPrAction = async (action: (isCurrent: () => boolean) => Promise<void>) => {
    if (prActionPending.current) return;
    prActionPending.current = true;
    const version = prActionGeneration.current;
    setPrActionBusy(true); setPrError(null);
    try { await action(() => version === prActionGeneration.current); }
    catch (error) { if (version === prActionGeneration.current) setPrError(String(error)); }
    finally { if (version === prActionGeneration.current) { prActionPending.current = false; setPrActionBusy(false); } }
  };

  const handleCheckoutBranch = async (branchName: string) => {
    if (!workspacePath) return;
    setCheckoutLoading(true);
    setCheckoutMsg(null);
    try {
      await tauriInvoke("git_branch_checkout", { cwd: workspacePath, branch: branchName });
      setCheckoutMsg(`✓ 成功检出分支: ${branchName}`);
    } catch (err: any) {
      setCheckoutMsg(`检出分支失败: ${String(err?.message || err)}`);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const loadGhInfo = async () => {
    setGhLoading(true);
    try {
      const status = await tauriInvoke<GhStatus>("gh_status");
      setGhStatus(status);
      if (status.is_installed && workspacePath) {
        setPrLoading(true);
        setPrError(null);
        try {
          const prs = await tauriInvoke<GitPullRequestItem[]>("git_list_prs", {
            cwd: workspacePath,
            limit: 30,
          });
          setPrList(prs);
        } catch (e: any) {
          setPrError(String(e?.message || e));
        } finally {
          setPrLoading(false);
        }
      }
    } catch {
      setGhStatus({ is_installed: false, is_authenticated: false });
    } finally {
      setGhLoading(false);
    }
  };

  useEffect(() => {
    if (subTab === "pr") {
      void loadGhInfo();
    }
  }, [subTab, workspacePath]);

  const branchOptions = useMemo(() => {
    const list = new Set<string>(branches.filter(Boolean));
    if (defaultBranch) list.add(defaultBranch);
    return Array.from(list);
  }, [branches, defaultBranch]);

  const canStart = useMemo(() => {
    if (busy) return false;
    if (!workspacePath) return false;
    if (kind === "branch") return repositoryReady && branchOptions.includes(branch);
    if (kind === "commit") return Boolean(sha.trim());
    if (kind === "custom") return Boolean(instructions.trim());
    return true;
  }, [busy, repositoryReady, branchOptions, workspacePath, kind, branch, sha, instructions]);

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

  const handleCopyInstallCmd = () => {
    navigator.clipboard.writeText("winget install --id GitHub.cli");
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
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
            <h2 className="review-title">代码审查与 PR 工作台</h2>
            <p className="review-subtitle">
              对本地改动或 GitHub Pull Requests 执行 Codex 智能体审查，审查意见将流式返回。
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

      {/* Mode Subtabs */}
      <div className="review-subtab-bar" style={{ display: "flex", gap: 8, margin: "14px 0" }}>
        <button
          type="button"
          className={`secondary-pill-action-btn ${subTab === "local" ? "active" : ""}`}
          style={{
            background: subTab === "local" ? "var(--accent-blue)" : "var(--bg-pill)",
            color: subTab === "local" ? "#ffffff" : "var(--text-secondary)",
            border: "none",
            padding: "6px 14px",
            borderRadius: 8,
            cursor: "pointer",
            fontWeight: 500,
          }}
          onClick={() => setSubTab("local")}
        >
          本地代码审查
        </button>
        <button
          type="button"
          className={`secondary-pill-action-btn ${subTab === "pr" ? "active" : ""}`}
          style={{
            background: subTab === "pr" ? "var(--accent-blue)" : "var(--bg-pill)",
            color: subTab === "pr" ? "#ffffff" : "var(--text-secondary)",
            border: "none",
            padding: "6px 14px",
            borderRadius: 8,
            cursor: "pointer",
            fontWeight: 500,
          }}
          onClick={() => setSubTab("pr")}
        >
          GitHub Pull Requests
        </button>
      </div>

      {subTab === "local" ? (
        <>
          <div className="review-target-grid">
            {TARGETS.map((target) => (
              <button
                key={target.id}
                type="button"
                className={`review-target-card ${
                  kind === target.id ? "active" : ""
                }`}
                onClick={() => setKind(target.id)}
              >
                <span className="review-target-icon">{target.icon}</span>
                <span className="review-target-title">{target.title}</span>
                <span className="review-target-desc">{target.desc}</span>
              </button>
            ))}
          </div>

          <div className="review-body">
            {kind === "branch" && (
              <label className="review-field">
                <span className="review-field-label">基准分支 (Base Branch)</span>
                <select
                  className="review-select"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                >
                  {branchOptions.map((b) => (
                    <option key={b} value={b}>
                      {b} {b === defaultBranch ? "(默认)" : ""}
                    </option>
                  ))}
                </select>
                <span className="review-field-hint">
                  Codex 会审查当前分支相对于所选分支的全部提交与未提交改动。
                </span>
              </label>
            )}

            {kind === "commit" && (
              <label className="review-field">
                <span className="review-field-label">指定提交 (Commit)</span>
                {commits.length > 0 ? (
                  <select
                    className="review-select"
                    value={sha}
                    onChange={(e) => setSha(e.target.value)}
                  >
                    {commits.map((c) => (
                      <option key={c.hash} value={c.hash}>
                        {c.shortHash} — {c.subject}
                        {c.relativeTime ? ` (${c.relativeTime})` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="review-input mono"
                    placeholder="输入完整或简短 commit SHA"
                    value={sha}
                    onChange={(e) => setSha(e.target.value)}
                  />
                )}
                <span className="review-field-hint">
                  Codex 会审查这次提交本身引入的所有变更。
                </span>
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
                优先在当前项目的聊天中审查；没有当前聊天时新建，可随时中断。
              </span>
            </div>
          </div>
        </>
      ) : (
        /* ── GitHub Pull Requests Tab ── */
        <div className="review-pr-container">
          {ghLoading ? (
            <div className="empty-hint" style={{ padding: 32 }}>
              正在探查 GitHub CLI 状态…
            </div>
          ) : !ghStatus?.is_installed ? (
            <div
              className="card-section"
              style={{
                padding: 24,
                border: "1px solid var(--border-default)",
                borderRadius: 12,
                background: "var(--bg-card)",
              }}
            >
              <h3 style={{ marginBottom: 8 }}>需要安装 GitHub CLI (`gh`)</h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "calc(13.5px * var(--font-ui-scale, 1))", lineHeight: 1.6, marginBottom: 16 }}>
                Codex 桌面端通过官方 GitHub CLI 浏览、拉取与审查 Pull Requests。检测到当前机器尚未安装 `gh` 命令行工具。
              </p>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 8,
                  padding: "8px 14px",
                  marginBottom: 16,
                }}
              >
                <code style={{ fontFamily: "var(--font-mono)", color: "var(--accent-blue)" }}>
                  winget install --id GitHub.cli
                </code>
                <button
                  type="button"
                  className="secondary-pill-action-btn-sm"
                  onClick={handleCopyInstallCmd}
                >
                  {copiedCmd ? "✓ 已复制" : "复制代码"}
                </button>
              </div>
              <button
                type="button"
                className="primary-btn"
                onClick={loadGhInfo}
              >
                重新检测 GitHub CLI
              </button>
            </div>
          ) : !ghStatus?.is_authenticated ? (
            <div
              className="card-section"
              style={{
                padding: 24,
                border: "1px solid var(--border-default)",
                borderRadius: 12,
                background: "var(--bg-card)",
              }}
            >
              <h3 style={{ marginBottom: 8 }}>需要登录 GitHub 账号</h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "calc(13.5px * var(--font-ui-scale, 1))", lineHeight: 1.6, marginBottom: 16 }}>
                已检测到 GitHub CLI ({ghStatus.version || "已安装"})，但在当前系统环境中尚未登录。请在终端执行：
              </p>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 8,
                  padding: "8px 14px",
                  marginBottom: 16,
                }}
              >
                <code style={{ fontFamily: "var(--font-mono)", color: "var(--accent-blue)" }}>
                  gh auth login
                </code>
              </div>
              <button
                type="button"
                className="primary-btn"
                onClick={loadGhInfo}
              >
                已登录，刷新 PR 列表
              </button>
            </div>
          ) : prLoading ? (
            <div className="empty-hint" style={{ padding: 32 }}>
              正在读取当前仓库的 Pull Requests…
            </div>
          ) : prError ? (
            <div className="error-banner" style={{ margin: "16px 0" }}>
              无法获取 PR 列表：{prError}
            </div>
          ) : prList.length === 0 ? (
            <div className="empty-hint" style={{ padding: 32 }}>
              当前仓库暂无处于 Open 状态的 Pull Request
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {prList.map((pr) => (
                <div
                  key={pr.number}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 10,
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 600, color: "var(--accent-blue)" }}>
                        #{pr.number}
                      </span>
                      <strong style={{ fontSize: "var(--text-base)" }}>{pr.title}</strong>
                      {pr.is_draft && (
                        <span className="tag-badge">Draft</span>
                      )}
                    </div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                      <span>由 {pr.author || "未知"} 创建</span>
                      {pr.head_ref_name && <span> · 分支: {pr.head_ref_name}</span>}
                      {pr.additions !== undefined && pr.deletions !== undefined && (
                        <span> · +{pr.additions} -{pr.deletions}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="secondary-btn-sm"
                      onClick={() => setSelectedPr(pr)}
                    >
                      详情 / 检出
                    </button>
                    {pr.url && (
                      <button
                        type="button"
                        className="secondary-btn-sm"
                        disabled={prActionBusy}
                        onClick={() => void runPrAction(isCurrent => openReviewLink(pr.url!, () => setSelectedPr(pr), isCurrent))}
                      >
                        打开链接
                      </button>
                    )}
                    <button
                      type="button"
                      className="primary-btn-sm"
                      disabled={prActionBusy || busy}
                      onClick={() => void runPrAction(isCurrent => runPullRequestReview(pr, onStartReview, isCurrent))}
                    >
                      使用 Codex 审查
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* PR Detail & Checkout Modal */}
      {selectedPr && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.65)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setSelectedPr(null)}
        >
          <div
            style={{
              width: 520,
              background: "var(--bg-card, #222226)",
              border: "1px solid var(--border-subtle, #333338)",
              borderRadius: 12,
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--accent-blue)", fontWeight: 600 }}>
                  Pull Request #{selectedPr.number}
                </span>
                <h3 style={{ margin: "4px 0 0 0", fontSize: "var(--text-lg)" }}>{selectedPr.title}</h3>
              </div>
              <button
                type="button"
                style={{ background: "none", border: "none", color: "#8e8e93", cursor: "pointer", fontSize: "var(--text-lg)" }}
                onClick={() => setSelectedPr(null)}
              >
                ✕
              </button>
            </div>

            {checkoutMsg && (
              <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(16, 163, 127, 0.15)", color: "#10a37f", fontSize: "var(--text-xs)" }}>
                {checkoutMsg}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, background: "rgba(0,0,0,0.25)", padding: 14, borderRadius: 8, fontSize: "var(--text-xs)" }}>
              <div>
                <span style={{ color: "#8e8e93" }}>源分支: </span>
                <code style={{ color: "#e2e2e5" }}>{selectedPr.head_ref_name || "未知"}</code>
              </div>
              <div>
                <span style={{ color: "#8e8e93" }}>目标分支: </span>
                <code style={{ color: "#e2e2e5" }}>{selectedPr.base_ref_name || "main"}</code>
              </div>
              <div>
                <span style={{ color: "#8e8e93" }}>作者: </span>
                <strong>{selectedPr.author || "未知"}</strong>
              </div>
              <div>
                <span style={{ color: "#8e8e93" }}>代码改动: </span>
                <span style={{ color: "#10a37f" }}>+{selectedPr.additions || 0}</span> / <span style={{ color: "#ef4444" }}>-{selectedPr.deletions || 0}</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {selectedPr.head_ref_name && (
                <button
                  type="button"
                  className="secondary-btn-sm"
                  disabled={checkoutLoading}
                  onClick={() => handleCheckoutBranch(selectedPr.head_ref_name!)}
                >
                  {checkoutLoading ? "正在检出…" : `检出分支 (${selectedPr.head_ref_name})`}
                </button>
              )}
              <button
                type="button"
                className="primary-btn-sm"
                onClick={() => {
                  onStartReview({
                    kind: "branch",
                    branch: selectedPr.head_ref_name || "main",
                    instructions: `请全面审查 Pull Request #${selectedPr.number}: ${selectedPr.title}`,
                  });
                  setSelectedPr(null);
                }}
              >
                在 Codex 中开始深度审查
              </button>
              {selectedPr.url && (
                <button
                  type="button"
                  className="secondary-btn-sm"
                  onClick={() => window.open(selectedPr.url, "_blank")}
                >
                  GitHub 查看
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {reviewResult ? (
        <section className="review-last-result" aria-label="最近一次审查">
          <div className="review-last-result-title" role="status">最近一次审查 · {{ starting: "正在启动", running: "审查中", completed: "已完成", failed: "失败", interrupted: "已中断", unknown: "状态未确认" }[reviewResult.status]}</div>
          {reviewResult.error && <div className="error-banner">{reviewResult.error}</div>}
          {reviewResult.text ? <MarkdownView content={reviewResult.text} /> : <div className="review-actions-hint">{reviewResult.status === "completed" ? "未返回审查文本" : "尚未收到审查文本"}</div>}
          {reviewFindings.map(finding => <article className="review-finding" key={finding.id}>
            <strong>{finding.title}</strong>
            <button type="button" className="mini-link-btn" disabled={!onOpenReviewFinding} onClick={() => onOpenReviewFinding?.(finding)}>{finding.file}:{finding.startLine}{finding.endLine !== finding.startLine ? `–${finding.endLine}` : ""}</button>
            <MarkdownView content={finding.body} />
          </article>)}
          {unresolvedFindings.map(finding => <article className="review-finding" key={finding.id}>
            <strong>{finding.title}</strong>
            <div>{finding.file}:{finding.startLine}–{finding.endLine}</div>
            <MarkdownView content={finding.body} />
            <span className="review-actions-hint">{finding.reason}</span>
          </article>)}
        </section>
      ) : lastResult && (
        <div className="review-last-result" style={{ marginTop: 16 }}>
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

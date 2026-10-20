import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DirectoryEntryItem,
  FilePreviewResult,
  GitCommitInfo,
  GitStatusInfo,
  TurnData,
  WorkspaceFileHit,
} from "../types";
import {
  CheckIcon,
  FolderIcon,
  GitBranchIcon,
  GlobeIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SparklesIcon,
  TrashIcon,
  XIcon,
} from "./Icons";

interface DiffDrawerProps {
  open?: boolean;
  cwd: string;
  gitStatus: GitStatusInfo | null;
  turns?: TurnData[];
  onRefreshGit: () => void;
  onClose: () => void;
  selectedPreviewFile?: string | null;
  onSelectPreviewFile?: (file: string | null) => void;
  onSendReviewComment?: (commentPrompt: string) => void;
}

interface ParsedDiffLine {
  type: "add" | "del" | "hunk" | "meta" | "ctx";
  raw: string;
  oldLine: number | null;
  newLine: number | null;
}

function parseUnifiedDiff(diffText: string): ParsedDiffLine[] {
  if (!diffText.trim()) return [];
  const lines = diffText.split("\n");
  const out: ParsedDiffLine[] = [];
  let oldLn = 0;
  let newLn = 0;

  for (const raw of lines) {
    if (
      raw.startsWith("diff --git") ||
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ") ||
      raw.startsWith("new file mode") ||
      raw.startsWith("deleted file mode")
    ) {
      out.push({ type: "meta", raw, oldLine: null, newLine: null });
      continue;
    }
    if (raw.startsWith("@@")) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldLn = parseInt(m[1], 10);
        newLn = parseInt(m[2], 10);
      }
      out.push({ type: "hunk", raw, oldLine: null, newLine: null });
      continue;
    }
    if (raw.startsWith("+")) {
      out.push({ type: "add", raw, oldLine: null, newLine: newLn });
      newLn++;
    } else if (raw.startsWith("-")) {
      out.push({ type: "del", raw, oldLine: oldLn, newLine: null });
      oldLn++;
    } else {
      out.push({
        type: "ctx",
        raw,
        oldLine: oldLn > 0 ? oldLn : null,
        newLine: newLn > 0 ? newLn : null,
      });
      if (oldLn > 0) oldLn++;
      if (newLn > 0) newLn++;
    }
  }
  return out;
}

export const DiffDrawer: React.FC<DiffDrawerProps> = ({
  open = true,
  cwd,
  gitStatus,
  turns = [],
  onRefreshGit,
  onClose,
  selectedPreviewFile,
  onSelectPreviewFile,
  onSendReviewComment,
}) => {
  const [activeTab, setActiveTab] = useState<"changes" | "files" | "summary" | "browser">(
    "changes"
  );

  // Changes state
  const [diffMode, setDiffMode] = useState<"working" | "staged" | "branch" | "commits">(
    "working"
  );
  const [diffLayout, setDiffLayout] = useState<"unified" | "split">("unified");
  const [baseBranch, setBaseBranch] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<string | null>(
    selectedPreviewFile ?? null
  );
  const [viewedFiles, setViewedFiles] = useState<Record<string, boolean>>({});
  const [diffContent, setDiffContent] = useState<string>("");
  const [loadingDiff, setLoadingDiff] = useState(false);

  useEffect(() => {
    if (selectedPreviewFile !== undefined) {
      setSelectedFile(selectedPreviewFile);
      if (selectedPreviewFile) {
        onSelectPreviewFile?.(selectedPreviewFile);
      }
    }
  }, [selectedPreviewFile]);

  // Commits state
  const [commits, setCommits] = useState<GitCommitInfo[]>([]);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);

  // Inline line review comment state
  const [commentLineIdx, setCommentLineIdx] = useState<number | null>(null);
  const [commentText, setCommentText] = useState("");

  // Commit / Push / PR state
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [forceWithLease, setForceWithLease] = useState(false);
  const [showPrModal, setShowPrModal] = useState(false);
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [prDraft, setPrDraft] = useState(false);
  const [creatingPr, setCreatingPr] = useState(false);
  const [gitToast, setGitToast] = useState<string | null>(null);

  // Files & Editor state
  const [currentDir, setCurrentDir] = useState<string>(cwd);
  const [dirEntries, setDirEntries] = useState<DirectoryEntryItem[]>([]);
  const [fileFilterQuery, setFileFilterQuery] = useState("");
  const [fileSearchHits, setFileSearchHits] = useState<WorkspaceFileHit[]>([]);
  const [filePreview, setFilePreview] = useState<FilePreviewResult | null>(null);
  const [editedContent, setEditedContent] = useState<string>("");
  const [inFileSearch, setInFileSearch] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [savingFile, setSavingFile] = useState(false);

  // Browser preview state
  const [browserUrl, setBrowserUrl] = useState("http://localhost:1420");
  const [browserInputUrl, setBrowserInputUrl] = useState("http://localhost:1420");
  const [browserKey, setBrowserKey] = useState(0);
  const [browserAnnotation, setBrowserAnnotation] = useState("");

  useEffect(() => {
    if (cwd) {
      setCurrentDir(cwd);
    }
  }, [cwd]);

  useEffect(() => {
    if (gitStatus?.defaultBranch && !baseBranch) {
      setBaseBranch(gitStatus.defaultBranch);
    }
  }, [gitStatus?.defaultBranch, baseBranch]);

  useEffect(() => {
    if (!open || activeTab !== "changes" || !cwd) return;
    if (diffMode === "commits") {
      setLoadingDiff(true);
      invoke<GitCommitInfo[]>("git_log_commits", { cwd, limit: 40 })
        .then((list) => {
          setCommits(list);
          const hash = selectedCommitHash || list[0]?.hash || null;
          setSelectedCommitHash(hash);
          if (hash) {
            return invoke<string>("git_commit_diff", { cwd, commitHash: hash });
          }
          return "";
        })
        .then((txt) => setDiffContent(txt || ""))
        .catch((err) => setDiffContent(`Error loading commit history: ${String(err)}`))
        .finally(() => setLoadingDiff(false));
      return;
    }

    setLoadingDiff(true);
    invoke<string>("git_diff", {
      cwd,
      filePath: selectedFile,
      staged: diffMode === "staged",
      baseBranch: diffMode === "branch" ? baseBranch : null,
    })
      .then((res) => setDiffContent(res))
      .catch((err) => setDiffContent(`Error loading diff: ${String(err)}`))
      .finally(() => setLoadingDiff(false));
  }, [open, activeTab, cwd, selectedFile, diffMode, baseBranch, selectedCommitHash, gitStatus]);

  useEffect(() => {
    if (!open || activeTab !== "files" || !currentDir) return;
    invoke<DirectoryEntryItem[]>("fs_list_dir", {
      path: currentDir,
      showHidden: false,
    })
      .then((entries) => setDirEntries(entries))
      .catch(() => setDirEntries([]));
  }, [open, activeTab, currentDir]);

  useEffect(() => {
    if (!open || activeTab !== "files" || !cwd) return;
    const q = fileFilterQuery.trim();
    if (!q) {
      setFileSearchHits([]);
      return;
    }
    invoke<WorkspaceFileHit[]>("fs_search_files", { cwd, query: q, limit: 35 })
      .then((hits) => setFileSearchHits(hits))
      .catch(() => setFileSearchHits([]));
  }, [open, activeTab, cwd, fileFilterQuery]);

  const showToast = (msg: string) => {
    setGitToast(msg);
    setTimeout(() => setGitToast(null), 3200);
  };

  const handleStage = async (filePath?: string) => {
    try {
      await invoke("git_stage", { cwd, filePath: filePath ?? null });
      onRefreshGit();
    } catch (e) {
      showToast(`暂存失败: ${String(e)}`);
    }
  };

  const handleUnstage = async (filePath?: string) => {
    try {
      await invoke("git_unstage", { cwd, filePath: filePath ?? null });
      onRefreshGit();
    } catch (e) {
      showToast(`取消暂存失败: ${String(e)}`);
    }
  };

  const handleDiscard = async (filePath: string) => {
    if (!confirm(`确定放弃 ${filePath} 的未提交更改吗？此操作无法撤销。`)) return;
    try {
      await invoke("git_discard", { cwd, filePath });
      if (selectedFile === filePath) setSelectedFile(null);
      onRefreshGit();
      showToast(`已还原 ${filePath}`);
    } catch (e) {
      showToast(`放弃更改失败: ${String(e)}`);
    }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    setCommitting(true);
    try {
      await invoke("git_commit_changes", { cwd, message: commitMessage.trim() });
      setCommitMessage("");
      onRefreshGit();
      showToast("✓ 已成功创建 Git 提交");
    } catch (e) {
      showToast(`提交失败: ${String(e)}`);
    } finally {
      setCommitting(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    try {
      await invoke("git_push_changes", { cwd, forceWithLease });
      onRefreshGit();
      showToast("✓ 已推送到远程仓库");
    } catch (e) {
      showToast(`推送失败: ${String(e)}`);
    } finally {
      setPushing(false);
    }
  };

  const handleCreatePr = async () => {
    if (!prTitle.trim()) return;
    setCreatingPr(true);
    try {
      const url = await invoke<string>("git_create_pr", {
        cwd,
        title: prTitle.trim(),
        body: prBody,
        baseBranch: baseBranch || null,
        draft: prDraft,
      });
      setShowPrModal(false);
      setPrTitle("");
      setPrBody("");
      showToast(`✓ PR 已创建: ${url}`);
    } catch (e) {
      showToast(`创建 PR 失败: ${String(e)}`);
    } finally {
      setCreatingPr(false);
    }
  };

  const openFilePreview = async (path: string) => {
    try {
      const res = await invoke<FilePreviewResult>("fs_read_preview", {
        path,
        maxBytes: 256 * 1024,
      });
      setFilePreview(res);
      setEditedContent(res.content ?? "");
      setIsDirty(false);
    } catch (e) {
      showToast(`读取文件失败: ${String(e)}`);
    }
  };

  const saveEditedFile = async () => {
    if (!filePreview) return;
    setSavingFile(true);
    try {
      await invoke("fs_write_file", {
        path: filePreview.path,
        content: editedContent,
      });
      setIsDirty(false);
      onRefreshGit();
      showToast("✓ 文件已保存");
    } catch (e) {
      showToast(`保存文件失败: ${String(e)}`);
    } finally {
      setSavingFile(false);
    }
  };

  const parsedLines = useMemo(() => parseUnifiedDiff(diffContent), [diffContent]);

  // Compute Summary & Artifacts from active thread turns
  const threadSummaryData = useMemo(() => {
    const modifiedFiles = new Map<string, { kind: string; count: number }>();
    const artifacts: Array<{ title: string; language: string; code: string }> = [];
    const commands: Array<{ cmd: string; status: string; exitCode?: number | null }> = [];

    for (const turn of turns) {
      for (const item of turn.items || []) {
        if (item.type === "fileChange" && Array.isArray(item.changes)) {
          for (const ch of item.changes) {
            const p = ch.path || "unknown";
            const prev = modifiedFiles.get(p);
            modifiedFiles.set(p, {
              kind: ch.kind || "modify",
              count: (prev?.count || 0) + 1,
            });
          }
        }
        if (item.type === "commandExecution") {
          const cmdStr = Array.isArray(item.command)
            ? item.command.join(" ")
            : String(item.command || "");
          if (cmdStr) {
            commands.push({
              cmd: cmdStr,
              status: item.status || "completed",
              exitCode: item.exitCode,
            });
          }
        }
        if (item.type === "agentMessage" && typeof item.text === "string") {
          const regex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
          let m: RegExpExecArray | null;
          while ((m = regex.exec(item.text)) !== null) {
            const lang = m[1] || "text";
            const code = m[2].trim();
            if (code.length >= 40) {
              artifacts.push({
                title: `${lang.toUpperCase()} 代码片段 (${code.split("\n").length} 行)`,
                language: lang,
                code,
              });
            }
          }
        }
      }
    }

    return {
      modifiedFiles: Array.from(modifiedFiles.entries()),
      artifacts,
      commands,
    };
  }, [turns]);

  if (!open) return null;

  return (
    <aside className="diff-drawer">
      {/* Top 4-Tab Workbench Switcher */}
      <div className="diff-drawer-header">
        <div className="diff-drawer-tabs">
          <button
            className={`diff-tab ${activeTab === "changes" ? "active" : ""}`}
            onClick={() => setActiveTab("changes")}
          >
            <GitBranchIcon size={13} />
            <span>变更</span>
            {gitStatus && gitStatus.entries.length > 0 && (
              <span className="badge-pill">{gitStatus.entries.length}</span>
            )}
          </button>
          <button
            className={`diff-tab ${activeTab === "files" ? "active" : ""}`}
            onClick={() => setActiveTab("files")}
          >
            <FolderIcon size={13} />
            <span>文件</span>
          </button>
          <button
            className={`diff-tab ${activeTab === "summary" ? "active" : ""}`}
            onClick={() => setActiveTab("summary")}
          >
            <SparklesIcon size={13} />
            <span>摘要</span>
          </button>
          <button
            className={`diff-tab ${activeTab === "browser" ? "active" : ""}`}
            onClick={() => setActiveTab("browser")}
          >
            <GlobeIcon size={13} />
            <span>预览</span>
          </button>
        </div>
        <div className="diff-drawer-actions">
          <button
            className="icon-btn"
            onClick={onRefreshGit}
            title="刷新工作区与 Git 状态"
          >
            <RefreshIcon size={14} />
          </button>
          <button className="icon-btn" onClick={onClose} title="收起右侧工作台">
            <XIcon size={14} />
          </button>
        </div>
      </div>

      {gitToast && <div className="workbench-toast-banner">{gitToast}</div>}

      {/* TAB 1: CHANGES & CODE REVIEW */}
      {activeTab === "changes" ? (
        <div className="diff-drawer-body">
          <div className="diff-mode-bar">
            <button
              className={`seg-btn ${diffMode === "working" ? "active" : ""}`}
              onClick={() => setDiffMode("working")}
            >
              未提交
            </button>
            <button
              className={`seg-btn ${diffMode === "staged" ? "active" : ""}`}
              onClick={() => setDiffMode("staged")}
            >
              已暂存
            </button>
            <button
              className={`seg-btn ${diffMode === "branch" ? "active" : ""}`}
              onClick={() => setDiffMode("branch")}
            >
              分支对比
            </button>
            <button
              className={`seg-btn ${diffMode === "commits" ? "active" : ""}`}
              onClick={() => setDiffMode("commits")}
            >
              提交历史
            </button>

            <div className="diff-layout-switch" style={{ marginLeft: "auto" }}>
              <button
                className={`seg-btn ${diffLayout === "unified" ? "active" : ""}`}
                onClick={() => setDiffLayout("unified")}
                title="统一 Diff 视图"
              >
                统一
              </button>
              <button
                className={`seg-btn ${diffLayout === "split" ? "active" : ""}`}
                onClick={() => setDiffLayout("split")}
                title="左右并排对比视图"
              >
                并排
              </button>
            </div>
          </div>

          {diffMode === "branch" && (
            <div className="diff-branch-filter-row">
              <span className="muted-text">基准分支:</span>
              <input
                className="branch-input-mini"
                placeholder="main"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
              />
            </div>
          )}

          {diffMode === "commits" ? (
            <div className="diff-file-list">
              <div className="diff-file-list-header">
                <span>最近提交 ({commits.length})</span>
              </div>
              <div className="diff-file-items">
                {commits.map((c) => (
                  <div
                    key={c.hash}
                    className={`diff-file-row ${
                      selectedCommitHash === c.hash ? "active" : ""
                    }`}
                    onClick={() => setSelectedCommitHash(c.hash)}
                  >
                    <span className="git-status-tag status-m">{c.shortHash}</span>
                    <span className="diff-file-path" title={c.subject}>
                      {c.subject}
                    </span>
                    <span className="muted-text" style={{ fontSize: 11 }}>
                      {c.relativeTime}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="diff-file-list">
              <div className="diff-file-list-header">
                <span>
                  更改的文件 ({gitStatus?.entries.length ?? 0})
                  {gitStatus && (
                    <span className="diff-stat-inline">
                      <span className="diff-add">+{gitStatus.additions}</span>{" "}
                      <span className="diff-del">-{gitStatus.deletions}</span>
                    </span>
                  )}
                </span>
                <div className="diff-file-bulk-actions">
                  <button className="mini-link-btn" onClick={() => setSelectedFile(null)}>
                    全部
                  </button>
                  <button className="mini-link-btn" onClick={() => handleStage()}>
                    全暂存
                  </button>
                  <button className="mini-link-btn" onClick={() => handleUnstage()}>
                    全取消
                  </button>
                </div>
              </div>

              <div className="diff-file-items">
                {gitStatus?.entries.length === 0 && (
                  <div className="empty-hint-small">工作树干净，没有未提交更改</div>
                )}
                {gitStatus?.entries.map((entry) => {
                  const isViewed = Boolean(viewedFiles[entry.path]);
                  return (
                    <div
                      key={entry.path}
                      className={`diff-file-row ${
                        selectedFile === entry.path ? "active" : ""
                      } ${isViewed ? "viewed" : ""}`}
                      onClick={() => setSelectedFile(entry.path)}
                    >
                      <span
                        className={`git-status-tag status-${
                          entry.untracked ? "u" : entry.staged ? "s" : "m"
                        }`}
                      >
                        {entry.status || "M"}
                      </span>
                      <span className="diff-file-path" title={entry.path}>
                        {entry.path}
                      </span>
                      <div
                        className="diff-file-row-btns"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          className={`mini-action-btn ${isViewed ? "active" : ""}`}
                          onClick={() =>
                            setViewedFiles((prev) => ({
                              ...prev,
                              [entry.path]: !prev[entry.path],
                            }))
                          }
                          title="标记为已审阅"
                        >
                          ✓
                        </button>
                        {!entry.staged ? (
                          <button
                            className="mini-action-btn"
                            onClick={() => handleStage(entry.path)}
                            title="暂存文件"
                          >
                            <PlusIcon size={12} />
                          </button>
                        ) : (
                          <button
                            className="mini-action-btn"
                            onClick={() => handleUnstage(entry.path)}
                            title="取消暂存"
                          >
                            -
                          </button>
                        )}
                        <button
                          className="mini-action-btn danger"
                          onClick={() => handleDiscard(entry.path)}
                          title="放弃更改"
                        >
                          <TrashIcon size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Commit + Push + PR Bar */}
          <div className="diff-commit-box">
            <input
              className="commit-input"
              placeholder="输入 Git 提交说明 (Commit message)..."
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  handleCommit();
                }
              }}
            />
            <button
              className="primary-btn compact"
              disabled={committing || !commitMessage.trim()}
              onClick={handleCommit}
            >
              <CheckIcon size={13} />
              <span>{committing ? "提交中" : "提交"}</span>
            </button>
            <button
              className="secondary-btn compact"
              disabled={pushing}
              onClick={handlePush}
              title="git push 推送到远端分支"
            >
              <span>{pushing ? "推送中..." : "推送 ↑"}</span>
            </button>
            <button
              className="secondary-btn compact"
              onClick={() => setShowPrModal((v) => !v)}
              title="使用 GitHub CLI 创建 Pull Request"
            >
              <span>PR</span>
            </button>
          </div>

          {/* Optional Force-with-Lease & PR Drawer */}
          <div className="diff-git-subbar">
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={forceWithLease}
                onChange={(e) => setForceWithLease(e.target.checked)}
              />
              <span>--force-with-lease</span>
            </label>
            <span className="muted-text" style={{ marginLeft: "auto", fontSize: 11 }}>
              点击任意 Diff 行可向 Codex 发送行级评审
            </span>
          </div>

          {showPrModal && (
            <div className="diff-pr-panel">
              <div className="diff-pr-panel-header">
                <strong>创建 GitHub Pull Request</strong>
                <button className="icon-btn" onClick={() => setShowPrModal(false)}>
                  <XIcon size={12} />
                </button>
              </div>
              <input
                className="commit-input"
                placeholder="PR 标题..."
                value={prTitle}
                onChange={(e) => setPrTitle(e.target.value)}
              />
              <textarea
                className="commit-input"
                rows={3}
                placeholder="PR 描述与变更摘要..."
                value={prBody}
                onChange={(e) => setPrBody(e.target.value)}
              />
              <div className="diff-pr-panel-footer">
                <label className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={prDraft}
                    onChange={(e) => setPrDraft(e.target.checked)}
                  />
                  <span>草稿 (Draft PR)</span>
                </label>
                <button
                  className="primary-btn compact"
                  disabled={creatingPr || !prTitle.trim()}
                  onClick={handleCreatePr}
                >
                  {creatingPr ? "创建中..." : "创建 PR"}
                </button>
              </div>
            </div>
          )}

          {/* Diff Code Viewer (Unified or Split + Inline Line Comments) */}
          <div className="diff-code-container">
            {loadingDiff ? (
              <div className="empty-hint-small">正在加载 Diff...</div>
            ) : !diffContent.trim() ? (
              <div className="empty-hint-small">无差异内容</div>
            ) : diffLayout === "split" ? (
              <div className="diff-split-grid">
                <div className="diff-split-col">
                  <div className="diff-split-col-header">旧版本 (Original)</div>
                  {parsedLines
                    .filter((l) => l.type !== "add")
                    .map((line, i) => (
                      <div
                        key={i}
                        className={`diff-line diff-line-${line.type}`}
                        onClick={() => setCommentLineIdx(i)}
                      >
                        <span className="diff-ln">{line.oldLine ?? ""}</span>
                        <span className="diff-tx">{line.raw}</span>
                      </div>
                    ))}
                </div>
                <div className="diff-split-col">
                  <div className="diff-split-col-header">新版本 (Modified)</div>
                  {parsedLines
                    .filter((l) => l.type !== "del")
                    .map((line, i) => (
                      <div
                        key={i}
                        className={`diff-line diff-line-${line.type}`}
                        onClick={() => setCommentLineIdx(i)}
                      >
                        <span className="diff-ln">{line.newLine ?? ""}</span>
                        <span className="diff-tx">{line.raw}</span>
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              <div className="diff-pre">
                {parsedLines.map((line, i) => (
                  <React.Fragment key={i}>
                    <div
                      className={`diff-line diff-line-${line.type} clickable`}
                      onClick={() =>
                        setCommentLineIdx(commentLineIdx === i ? null : i)
                      }
                    >
                      <span className="diff-ln">{line.oldLine ?? ""}</span>
                      <span className="diff-ln">{line.newLine ?? ""}</span>
                      <span className="diff-tx">{line.raw || " "}</span>
                    </div>
                    {commentLineIdx === i && (
                      <div className="diff-inline-comment-box">
                        <input
                          className="commit-input"
                          placeholder={`针对此行向 Codex 提出修改意见...`}
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          autoFocus
                        />
                        <button
                          className="primary-btn compact"
                          onClick={() => {
                            if (!commentText.trim()) return;
                            const targetLabel = selectedFile || "当前变更";
                            const prompt = `请查看 \`${targetLabel}\` 中的这行变更：\n\`\`\`diff\n${line.raw}\n\`\`\`\n评审意见：${commentText.trim()}`;
                            onSendReviewComment?.(prompt);
                            setCommentText("");
                            setCommentLineIdx(null);
                          }}
                        >
                          发送给 Codex
                        </button>
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* TAB 2: FILES & EDITOR */}
      {activeTab === "files" ? (
        <div className="diff-drawer-body">
          <div className="file-browser-path-bar">
            <span className="file-browser-cwd" title={currentDir}>
              {currentDir}
            </span>
            {currentDir !== cwd && (
              <button
                className="mini-link-btn"
                onClick={() => {
                  const parent = currentDir
                    .replace(/[\\/]+$/, "")
                    .replace(/[\\/][^\\/]+$/, "");
                  if (parent) setCurrentDir(parent);
                }}
              >
                返回上级
              </button>
            )}
          </div>

          <div className="diff-branch-filter-row">
            <SearchIcon size={13} />
            <input
              className="branch-input-mini"
              placeholder="快速搜索工作区文件名..."
              value={fileFilterQuery}
              onChange={(e) => setFileFilterQuery(e.target.value)}
            />
          </div>

          <div className="file-browser-list">
            {fileFilterQuery.trim() ? (
              fileSearchHits.map((hit) => (
                <div
                  key={hit.absPath}
                  className={`diff-file-row ${
                    filePreview?.path === hit.absPath ? "active" : ""
                  }`}
                  onClick={() => openFilePreview(hit.absPath)}
                >
                  <span className="file-icon-tag">📄</span>
                  <span className="diff-file-path">{hit.relPath}</span>
                </div>
              ))
            ) : (
              dirEntries.map((item) => (
                <div
                  key={item.path}
                  className={`diff-file-row ${
                    filePreview?.path === item.path ? "active" : ""
                  }`}
                  onClick={() => {
                    if (item.isDirectory) {
                      setCurrentDir(item.path);
                    } else {
                      openFilePreview(item.path);
                    }
                  }}
                >
                  <span className="file-icon-tag">
                    {item.isDirectory ? "📁" : "📄"}
                  </span>
                  <span className="diff-file-path">{item.name}</span>
                  {!item.isDirectory && (
                    <span className="file-size-tag">
                      {(item.size / 1024).toFixed(1)} KB
                    </span>
                  )}
                </div>
              ))
            )}
          </div>

          {filePreview && (
            <div className="file-editor-pane">
              <div className="file-editor-header">
                <span className="file-editor-title" title={filePreview.path}>
                  {filePreview.path.split(/[\\/]/).pop()}
                </span>
                <input
                  className="in-file-search-input"
                  placeholder="查找内容..."
                  value={inFileSearch}
                  onChange={(e) => setInFileSearch(e.target.value)}
                />
                {!filePreview.isBinary && !filePreview.isImage && (
                  <button
                    className="primary-btn compact"
                    disabled={!isDirty || savingFile}
                    onClick={saveEditedFile}
                  >
                    {savingFile ? "保存中..." : isDirty ? "保存修改" : "已保存"}
                  </button>
                )}
              </div>
              {filePreview.isImage && filePreview.base64DataUrl ? (
                <div className="file-image-preview">
                  <img src={filePreview.base64DataUrl} alt="preview" />
                </div>
              ) : filePreview.isBinary ? (
                <div className="empty-hint-small">二进制文件无法直接编辑</div>
              ) : (
                <textarea
                  className="file-editor-textarea"
                  value={editedContent}
                  onChange={(e) => {
                    setEditedContent(e.target.value);
                    setIsDirty(true);
                  }}
                  spellCheck={false}
                />
              )}
            </div>
          )}
        </div>
      ) : null}

      {/* TAB 3: SUMMARY & ARTIFACTS */}
      {activeTab === "summary" ? (
        <div className="diff-drawer-body workbench-summary-body">
          <div className="workbench-section-card">
            <div className="workbench-section-title">
              会话变更文件摘要 ({threadSummaryData.modifiedFiles.length})
            </div>
            {threadSummaryData.modifiedFiles.length === 0 ? (
              <div className="empty-hint-small">当前对话尚未产生文件修改记录</div>
            ) : (
              <div className="workbench-summary-list">
                {threadSummaryData.modifiedFiles.map(([path, info]) => (
                  <div
                    key={path}
                    className="diff-file-row"
                    onClick={() => {
                      setSelectedFile(path);
                      setActiveTab("changes");
                    }}
                  >
                    <span className="git-status-tag status-m">{info.kind}</span>
                    <span className="diff-file-path">{path}</span>
                    <span className="badge-pill">{info.count} 次变更</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="workbench-section-card">
            <div className="workbench-section-title">
              提取的代码与文档工件 ({threadSummaryData.artifacts.length})
            </div>
            {threadSummaryData.artifacts.length === 0 ? (
              <div className="empty-hint-small">对话回复中的代码块将自动整理在此处</div>
            ) : (
              <div className="workbench-artifacts-list">
                {threadSummaryData.artifacts.map((art, idx) => (
                  <details key={idx} className="workbench-artifact-item">
                    <summary>{art.title}</summary>
                    <pre className="workbench-artifact-pre">{art.code}</pre>
                  </details>
                ))}
              </div>
            )}
          </div>

          <div className="workbench-section-card">
            <div className="workbench-section-title">
              已执行的命令与后台任务 ({threadSummaryData.commands.length})
            </div>
            {threadSummaryData.commands.length === 0 ? (
              <div className="empty-hint-small">暂无命令执行记录</div>
            ) : (
              <div className="workbench-summary-list">
                {threadSummaryData.commands.map((cmd, idx) => (
                  <div key={idx} className="diff-file-row">
                    <span className="git-status-tag status-s">
                      {cmd.exitCode === 0 || cmd.status === "completed" ? "OK" : "RUN"}
                    </span>
                    <span className="diff-file-path" title={cmd.cmd}>
                      {cmd.cmd}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* TAB 4: IN-APP BROWSER PREVIEW */}
      {activeTab === "browser" ? (
        <div className="diff-drawer-body workbench-browser-body">
          <div className="browser-url-bar">
            <input
              className="commit-input"
              value={browserInputUrl}
              onChange={(e) => setBrowserInputUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setBrowserUrl(browserInputUrl.trim());
                }
              }}
              placeholder="http://localhost:1420"
            />
            <button
              className="secondary-btn compact"
              onClick={() => setBrowserUrl(browserInputUrl.trim())}
            >
              前往
            </button>
            <button
              className="icon-btn"
              onClick={() => setBrowserKey((k) => k + 1)}
              title="刷新网页预览"
            >
              <RefreshIcon size={13} />
            </button>
          </div>

          <div className="browser-iframe-wrap">
            <iframe
              key={`${browserUrl}-${browserKey}`}
              src={browserUrl}
              title="Codex In-App Browser Preview"
              className="browser-preview-iframe"
            />
          </div>

          <div className="diff-commit-box">
            <input
              className="commit-input"
              placeholder="输入针对当前预览页面的视觉/交互反馈发给 Codex..."
              value={browserAnnotation}
              onChange={(e) => setBrowserAnnotation(e.target.value)}
            />
            <button
              className="primary-btn compact"
              disabled={!browserAnnotation.trim()}
              onClick={() => {
                onSendReviewComment?.(
                  `[网页预览反馈 ${browserUrl}]：${browserAnnotation.trim()}`
                );
                setBrowserAnnotation("");
              }}
            >
              发送反馈
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
};

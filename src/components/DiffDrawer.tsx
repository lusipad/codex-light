import React, { useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  Columns,
  FileText,
  Folder,
  GitBranch,
  GitCommit,
  Plus,
  RefreshCw,
  RotateCcw,
  Rows,
  Save,
  X,
} from "lucide-react";
import { tauriInvoke } from "../bridge";
import {
  DirectoryEntryItem,
  FilePreviewResult,
  GitFileEntry,
  GitStatusInfo,
} from "../types";

interface DiffDrawerProps {
  cwd: string;
  gitStatus: GitStatusInfo | null;
  onRefreshGit: () => void;
  selectedPreviewFile: string | null;
  onSelectPreviewFile: (path: string | null) => void;
  onClose: () => void;
}

interface DiffLine {
  type: "add" | "del" | "ctx" | "hunk" | "meta";
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

function parseUnifiedDiff(rawDiff: string): DiffLine[] {
  const lines = rawDiff.split(/\r?\n/);
  const result: DiffLine[] = [];
  let oldNum = 0;
  let newNum = 0;

  for (const line of lines) {
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode")
    ) {
      result.push({ type: "meta", oldLine: null, newLine: null, text: line });
      continue;
    }
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      oldNum = parseInt(hunkMatch[1], 10);
      newNum = parseInt(hunkMatch[2], 10);
      result.push({ type: "hunk", oldLine: null, newLine: null, text: line });
      continue;
    }
    if (line.startsWith("+")) {
      result.push({
        type: "add",
        oldLine: null,
        newLine: newNum++,
        text: line.slice(1),
      });
    } else if (line.startsWith("-")) {
      result.push({
        type: "del",
        oldLine: oldNum++,
        newLine: null,
        text: line.slice(1),
      });
    } else {
      result.push({
        type: "ctx",
        oldLine: oldNum > 0 ? oldNum++ : null,
        newLine: newNum > 0 ? newNum++ : null,
        text: line.startsWith(" ") ? line.slice(1) : line,
      });
    }
  }
  return result;
}

export const DiffDrawer: React.FC<DiffDrawerProps> = ({
  cwd,
  gitStatus,
  onRefreshGit,
  selectedPreviewFile,
  onSelectPreviewFile,
  onClose,
}) => {
  const [drawerTab, setDrawerTab] = useState<"git" | "files">(
    selectedPreviewFile ? "files" : "git"
  );
  const [selectedGitFile, setSelectedGitFile] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState<"working" | "staged" | "branch">(
    "working"
  );
  const [splitView, setSplitView] = useState<boolean>(false);
  const [rawDiff, setRawDiff] = useState<string>("");
  const [loadingDiff, setLoadingDiff] = useState<boolean>(false);
  const [commitMessage, setCommitMessage] = useState<string>("");
  const [commitStatus, setCommitStatus] = useState<string | null>(null);

  // File browser state
  const [currentBrowseDir, setCurrentBrowseDir] = useState<string>(cwd);
  const [dirEntries, setDirEntries] = useState<DirectoryEntryItem[]>([]);
  const [filePreview, setFilePreview] = useState<FilePreviewResult | null>(null);
  const [editedContent, setEditedContent] = useState<string>("");
  const [isEditingFile, setIsEditingFile] = useState<boolean>(false);

  useEffect(() => {
    setCurrentBrowseDir(cwd);
  }, [cwd]);

  useEffect(() => {
    if (selectedPreviewFile) {
      setDrawerTab("files");
      loadFilePreview(selectedPreviewFile);
    }
  }, [selectedPreviewFile]);

  useEffect(() => {
    if (drawerTab === "git" && cwd) {
      loadGitDiff(selectedGitFile, diffMode);
    }
  }, [drawerTab, cwd, selectedGitFile, diffMode, gitStatus]);

  useEffect(() => {
    if (drawerTab === "files" && currentBrowseDir) {
      loadDirectory(currentBrowseDir);
    }
  }, [drawerTab, currentBrowseDir]);

  const loadGitDiff = async (
    filePath: string | null,
    mode: "working" | "staged" | "branch"
  ) => {
    if (!cwd) return;
    setLoadingDiff(true);
    try {
      const diff = await tauriInvoke<string>("git_diff", {
        cwd,
        filePath,
        staged: mode === "staged",
        baseBranch:
          mode === "branch"
            ? gitStatus?.defaultBranch || "main"
            : null,
      });
      setRawDiff(diff || "");
    } catch (err: any) {
      setRawDiff(`Error loading diff: ${err?.message || String(err)}`);
    } finally {
      setLoadingDiff(false);
    }
  };

  const loadDirectory = async (dirPath: string) => {
    try {
      const items = await tauriInvoke<DirectoryEntryItem[]>("fs_list_dir", {
        path: dirPath,
        showHidden: false,
      });
      setDirEntries(items);
    } catch {
      setDirEntries([]);
    }
  };

  const loadFilePreview = async (filePath: string) => {
    try {
      const target =
        filePath.includes(":") || filePath.startsWith("/")
          ? filePath
          : `${cwd.replace(/[\\/]+$/, "")}/${filePath}`;
      const res = await tauriInvoke<FilePreviewResult>("fs_read_preview", {
        path: target,
      });
      setFilePreview(res);
      setEditedContent(res.content || "");
      setIsEditingFile(false);
    } catch (err: any) {
      setFilePreview({
        path: filePath,
        isBinary: false,
        isImage: false,
        content: `无法读取文件: ${err?.message || String(err)}`,
        base64DataUrl: null,
        sizeBytes: 0,
        mtimeMs: 0,
      });
    }
  };

  const handleStage = async (entry?: GitFileEntry) => {
    try {
      await tauriInvoke("git_stage", {
        cwd,
        filePath: entry ? entry.path : null,
      });
      onRefreshGit();
    } catch (err: any) {
      alert(err?.message || String(err));
    }
  };

  const handleUnstage = async (entry?: GitFileEntry) => {
    try {
      await tauriInvoke("git_unstage", {
        cwd,
        filePath: entry ? entry.path : null,
      });
      onRefreshGit();
    } catch (err: any) {
      alert(err?.message || String(err));
    }
  };

  const handleDiscard = async (entry: GitFileEntry) => {
    if (!confirm(`确定要丢弃文件 ${entry.path} 的未提交修改吗？`)) return;
    try {
      await tauriInvoke("git_discard", {
        cwd,
        filePath: entry.path,
      });
      if (selectedGitFile === entry.path) setSelectedGitFile(null);
      onRefreshGit();
    } catch (err: any) {
      alert(err?.message || String(err));
    }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    try {
      await tauriInvoke("git_commit_changes", {
        cwd,
        message: commitMessage.trim(),
      });
      setCommitMessage("");
      setCommitStatus("已提交！");
      setTimeout(() => setCommitStatus(null), 2000);
      onRefreshGit();
    } catch (err: any) {
      alert(`Git commit 失败: ${err?.message || String(err)}`);
    }
  };

  const handleSaveFile = async () => {
    if (!filePreview) return;
    try {
      await tauriInvoke("fs_write_file", {
        path: filePreview.path,
        content: editedContent,
      });
      setFilePreview({ ...filePreview, content: editedContent });
      setIsEditingFile(false);
      onRefreshGit();
    } catch (err: any) {
      alert(`保存失败: ${err?.message || String(err)}`);
    }
  };

  const parsedLines = parseUnifiedDiff(rawDiff);

  return (
    <aside className="right-drawer">
      <div className="drawer-header">
        <div className="drawer-tabs">
          <button
            type="button"
            className={`drawer-tab ${drawerTab === "git" ? "active" : ""}`}
            onClick={() => setDrawerTab("git")}
          >
            <GitBranch size={14} />
            <span>
              Git Diff ({gitStatus?.entries?.length || 0})
            </span>
          </button>
          <button
            type="button"
            className={`drawer-tab ${drawerTab === "files" ? "active" : ""}`}
            onClick={() => setDrawerTab("files")}
          >
            <Folder size={14} />
            <span>文件树 & 预览</span>
          </button>
        </div>
        <div className="drawer-header-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={onRefreshGit}
            title="刷新状态"
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            title="关闭侧边栏"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {drawerTab === "git" ? (
        <div className="drawer-body git-drawer-body">
          {/* Changed files list */}
          <div className="git-files-section">
            <div className="section-subheader">
              <div className="diff-mode-pills">
                <button
                  type="button"
                  className={`mini-pill ${diffMode === "working" ? "active" : ""}`}
                  onClick={() => setDiffMode("working")}
                >
                  工作区
                </button>
                <button
                  type="button"
                  className={`mini-pill ${diffMode === "staged" ? "active" : ""}`}
                  onClick={() => setDiffMode("staged")}
                >
                  已暂存
                </button>
                <button
                  type="button"
                  className={`mini-pill ${diffMode === "branch" ? "active" : ""}`}
                  onClick={() => setDiffMode("branch")}
                >
                  对比主分支
                </button>
              </div>
              <div className="git-bulk-actions">
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => handleStage()}
                  title="全部暂存 (git add -A)"
                >
                  <Plus size={12} /> 全部暂存
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => handleUnstage()}
                  title="全部取消暂存"
                >
                  全部撤回
                </button>
              </div>
            </div>

            <div className="git-entries-list">
              <div
                className={`git-entry-row ${selectedGitFile === null ? "selected" : ""}`}
                onClick={() => setSelectedGitFile(null)}
              >
                <span className="git-status-badge all">ALL</span>
                <span className="git-entry-path">全部变更文件汇总</span>
                <span className="diff-stat-inline">
                  <span className="stat-add">+{gitStatus?.additions || 0}</span>{" "}
                  <span className="stat-del">-{gitStatus?.deletions || 0}</span>
                </span>
              </div>

              {(gitStatus?.entries || []).map((entry) => (
                <div
                  key={entry.path}
                  className={`git-entry-row ${
                    selectedGitFile === entry.path ? "selected" : ""
                  }`}
                  onClick={() => setSelectedGitFile(entry.path)}
                >
                  <span
                    className={`git-status-badge ${
                      entry.untracked
                        ? "untracked"
                        : entry.staged
                          ? "staged"
                          : "modified"
                    }`}
                  >
                    {entry.status || "M"}
                  </span>
                  <span className="git-entry-path" title={entry.path}>
                    {entry.path}
                  </span>
                  <div
                    className="git-entry-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!entry.staged ? (
                      <button
                        type="button"
                        className="icon-btn-xs"
                        onClick={() => handleStage(entry)}
                        title="暂存此文件"
                      >
                        <Plus size={12} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="icon-btn-xs"
                        onClick={() => handleUnstage(entry)}
                        title="取消暂存"
                      >
                        -
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-btn-xs danger"
                      onClick={() => handleDiscard(entry)}
                      title="放弃修改"
                    >
                      <RotateCcw size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Commit Box */}
            <div className="git-commit-bar">
              <input
                type="text"
                className="commit-input"
                placeholder="输入 Commit 信息 (自动提交已暂存更改)..."
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCommit();
                }}
              />
              <button
                type="button"
                className="primary-btn-sm"
                onClick={handleCommit}
                disabled={!commitMessage.trim()}
              >
                <GitCommit size={13} />
                <span>{commitStatus || "提交"}</span>
              </button>
            </div>
          </div>

          {/* Diff Viewer Header */}
          <div className="diff-viewer-toolbar">
            <span className="diff-target-label">
              {selectedGitFile || "全部变更"}
            </span>
            <div className="diff-view-toggle">
              <button
                type="button"
                className={`mini-pill ${!splitView ? "active" : ""}`}
                onClick={() => setSplitView(false)}
                title="Unified 视图"
              >
                <Rows size={12} /> Unified
              </button>
              <button
                type="button"
                className={`mini-pill ${splitView ? "active" : ""}`}
                onClick={() => setSplitView(true)}
                title="Split 左右对比视图"
              >
                <Columns size={12} /> Split
              </button>
            </div>
          </div>

          {/* Diff Lines */}
          <div className="diff-code-container">
            {loadingDiff ? (
              <div className="empty-hint">加载 Diff 中...</div>
            ) : !rawDiff.trim() ? (
              <div className="empty-hint">当前工作区干净，暂无差异</div>
            ) : !splitView ? (
              <table className="diff-table unified">
                <tbody>
                  {parsedLines.map((line, i) => (
                    <tr key={i} className={`diff-row diff-${line.type}`}>
                      <td className="diff-num">{line.oldLine ?? ""}</td>
                      <td className="diff-num">{line.newLine ?? ""}</td>
                      <td className="diff-sign">
                        {line.type === "add"
                          ? "+"
                          : line.type === "del"
                            ? "-"
                            : " "}
                      </td>
                      <td className="diff-text">{line.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="diff-table split">
                <tbody>
                  {parsedLines.map((line, i) => {
                    if (line.type === "meta" || line.type === "hunk") {
                      return (
                        <tr key={i} className={`diff-row diff-${line.type}`}>
                          <td colSpan={4} className="diff-text">
                            {line.text}
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={i} className={`diff-row diff-${line.type}`}>
                        <td className="diff-num">{line.oldLine ?? ""}</td>
                        <td className="diff-text split-col">
                          {line.type !== "add" ? line.text : ""}
                        </td>
                        <td className="diff-num">{line.newLine ?? ""}</td>
                        <td className="diff-text split-col">
                          {line.type !== "del" ? line.text : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : (
        <div className="drawer-body files-drawer-body">
          <div className="file-tree-pane">
            <div className="file-breadcrumb">
              <span className="truncate-path" title={currentBrowseDir}>
                {currentBrowseDir}
              </span>
              {currentBrowseDir !== cwd && (
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => {
                    const parent = currentBrowseDir.replace(/[\\/][^\\/]+$/, "");
                    setCurrentBrowseDir(parent || cwd);
                  }}
                >
                  上级目录
                </button>
              )}
            </div>
            <div className="file-entries-scroll">
              {dirEntries.map((item) => (
                <div
                  key={item.path}
                  className={`file-entry-item ${
                    filePreview?.path === item.path ? "selected" : ""
                  }`}
                  onClick={() => {
                    if (item.isDirectory) {
                      setCurrentBrowseDir(item.path);
                    } else {
                      onSelectPreviewFile(item.path);
                    }
                  }}
                >
                  {item.isDirectory ? (
                    <Folder size={14} className="folder-icon" />
                  ) : (
                    <FileText size={14} className="file-icon" />
                  )}
                  <span className="file-entry-name">{item.name}</span>
                  {item.isDirectory && <ChevronRight size={13} />}
                </div>
              ))}
            </div>
          </div>

          <div className="file-preview-pane">
            {filePreview ? (
              <>
                <div className="file-preview-header">
                  <span className="truncate-path" title={filePreview.path}>
                    {filePreview.path}
                  </span>
                  {!filePreview.isBinary && (
                    <div className="file-preview-actions">
                      {!isEditingFile ? (
                        <button
                          type="button"
                          className="mini-btn"
                          onClick={() => setIsEditingFile(true)}
                        >
                          编辑
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="primary-btn-sm"
                            onClick={handleSaveFile}
                          >
                            <Save size={12} /> 保存
                          </button>
                          <button
                            type="button"
                            className="mini-btn"
                            onClick={() => {
                              setEditedContent(filePreview.content || "");
                              setIsEditingFile(false);
                            }}
                          >
                            取消
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="file-preview-content">
                  {filePreview.isImage && filePreview.base64DataUrl ? (
                    <div className="image-preview-box">
                      <img
                        src={filePreview.base64DataUrl}
                        alt={filePreview.path}
                      />
                    </div>
                  ) : filePreview.isBinary ? (
                    <div className="empty-hint">
                      二进制文件 ({Math.round(filePreview.sizeBytes / 1024)} KB)
                    </div>
                  ) : isEditingFile ? (
                    <textarea
                      className="file-editor-textarea"
                      value={editedContent}
                      onChange={(e) => setEditedContent(e.target.value)}
                    />
                  ) : (
                    <pre className="file-preview-pre">
                      <code>{filePreview.content}</code>
                    </pre>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-hint">点击上方文件进行预览或编辑</div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};

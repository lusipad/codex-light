import { GIT_DEFAULTS, type GitPreferences } from "../gitPreferences";
import type { ModelReviewComment } from "../reviewFindings";
import { MarkdownView } from "./MarkdownView";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { copyTextToClipboard } from "../clipboard";
import { tauriListen } from "../bridge";
import { generateGitMessage, type GitGenerationMode } from "../gitMessageGeneration";
import { saveFileEditorSnapshot } from "../fileEditorSave";
import { FileDiscardDialog } from "./FileDiscardDialog";
import {
  DirectoryEntryItem,
  FilePreviewResult,
  GitCommitInfo,
  GitStatusInfo,
  TurnData,
  WorkspaceFileHit,
} from "../types";
import {
  baseNameFsPath,
  createDirectory as fsCreateDirectory,
  isBinaryBytes,
  joinFsPath,
  parentFsPath,
  readDirectory as fsReadDirectory,
  readFileBytes,
  removePath as fsRemovePath,
  renamePath as fsRenamePath,
  watchPath as fsWatchPath,
  writeFileText as fsWriteFileText,
  type FsDirectoryEntry,
  type FsUnwatch,
} from "../fsClient";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  DiffIcon,
  DownloadIcon,
  EllipsisIcon,
  FileCodeIcon,
  FolderIcon,
  FullscreenIcon,
  GitBranchIcon,
  GlobeIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SparklesIcon,
  SplitViewIcon,
  TrashIcon,
  XIcon,
} from "./Icons";
import { NewTabPage } from "./NewTabPage";
import { BrowserToolbar } from "./BrowserToolbar";
import { SideChatPanel } from "./SideChatPanel";
import "./FileExplorer.css";
import "./DiffDrawer.css";
import "./DiffDrawerWorkspace.css";

function WorkspaceFileTree({ width, onResize, children }: {
  width: number;
  onResize: (width: number) => void;
  children: React.ReactNode;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const resize = (value: number, parentWidth: number) => {
    onResize(value < 100 ? 0 : Math.min(Math.max(200, value), Math.max(200, parentWidth * .6)));
  };
  return <aside className="workspace-file-tree" style={{ width }} aria-label="文件树">
    <div className="workspace-file-tree-resize" role="separator" tabIndex={0}
      aria-label="调整文件树宽度" aria-orientation="vertical" aria-valuemin={200} aria-valuenow={width}
      onPointerDown={event => {
        drag.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={event => {
        if (!drag.current) return;
        const parentWidth = event.currentTarget.parentElement?.parentElement?.clientWidth ?? 0;
        resize(drag.current.width + drag.current.x - event.clientX, parentWidth);
      }}
      onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={event => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const parentWidth = event.currentTarget.parentElement?.parentElement?.clientWidth ?? 0;
        resize(width + (event.key === "ArrowLeft" ? 16 : -16), parentWidth);
      }} />
    {children}
  </aside>;
}

type WorkspaceEntryRenderer = (item: DirectoryEntryItem, depth: number, expanded: boolean, toggle: (value?: boolean) => void, groupId: string) => React.ReactNode;

function WorkspaceDirectoryEntry({ item, depth, refreshToken, renderRow, reveal }: {
  item: DirectoryEntryItem;
  depth: number;
  refreshToken: DirectoryEntryItem[];
  renderRow: WorkspaceEntryRenderer;
  reveal?: { path: string };
}) {
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<DirectoryEntryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const groupId = React.useId();
  useEffect(() => {
    if (!reveal || !item.isDirectory) return;
    const target = reviewPathKey(reveal.path);
    const branch = reviewPathKey(item.path);
    if (target === branch || target.startsWith(branch + "/")) setExpanded(true);
  }, [reveal, item.path, item.isDirectory]);
  useEffect(() => {
    if (!expanded || !item.isDirectory) return;
    let disposed = false;
    let sequence = 0;
    let stopWatch: FsUnwatch | null = null;
    const refresh = async () => {
      const request = ++sequence;
      setLoading(true);
      try {
        let children: DirectoryEntryItem[];
        try { children = toDirectoryEntryItems(item.path, await fsReadDirectory(item.path)); }
        catch { if (disposed || request !== sequence) return; children = (await invoke<DirectoryEntryItem[]>("fs_list_dir", { path: item.path, showHidden: true })).sort(compareDirectoryEntries); }
        if (disposed || request !== sequence) return;
        setEntries(children);
        setError(null);
      } catch (reason) {
        if (!disposed && request === sequence) setError(String(reason));
      } finally {
        if (!disposed && request === sequence) setLoading(false);
      }
    };
    void refresh();
    fsWatchPath(item.path, () => { if (!disposed) void refresh(); })
      .then(unwatch => { if (disposed) void unwatch(); else stopWatch = unwatch; })
      .catch(() => {});
    return () => { disposed = true; if (stopWatch) void stopWatch(); };
  }, [expanded, item.path, item.isDirectory, refreshToken, retry]);
  const toggle = (value?: boolean) => setExpanded(previous => value ?? !previous);
  return <React.Fragment>
    {renderRow(item, depth, expanded, toggle, groupId)}
    {expanded && item.isDirectory && <div role="group" id={groupId}>
      {loading && <div className="workspace-tree-status" role="status" style={{ paddingLeft: (depth + 1) * 16 + 8 }}>正在加载目录…</div>}
      {error ? <div className="workspace-tree-status" role="alert" title={error} style={{ paddingLeft: (depth + 1) * 16 + 8 }}>
        目录无法访问 <button type="button" onClick={() => setRetry(value => value + 1)}>重试</button>
      </div> : !loading && entries.length === 0 ? <div className="workspace-tree-status" style={{ paddingLeft: (depth + 1) * 16 + 8 }}>目录为空</div> :
        entries.map(child => <WorkspaceDirectoryEntry key={child.path} item={child} depth={depth + 1} refreshToken={refreshToken} renderRow={renderRow} reveal={reveal} />)}
    </div>}
  </React.Fragment>;
}

export interface WorkbenchTabItem {
  id: string;
  kind: "newTab" | "changes" | "files" | "summary" | "browser" | "sideChat";
  title: string;
  icon: React.ReactNode;
  url?: string;
  history?: string[];
  historyIndex?: number;
  closable?: boolean;
  badge?: number;
}

export interface DiffDrawerProps {
  open?: boolean;
  gitPreferences?: GitPreferences;
  gitPreferencesReady?: boolean;
  connectionIdentity?: string;
  cwd: string;
  workspaceRoots?: string[];
  gitStatus: GitStatusInfo | null;
  branches?: string[];
  turns?: TurnData[];
  recordedTurnDiff?: string;
  onRefreshGit: () => void;
  onClose: () => void;
  selectedPreviewFile?: string | null;
  previewRequestId?: number;
  previewLine?: number;
  directoryReveal?: { cwd: string; root?: string; path: string } | null;
  onSelectPreviewFile?: (file: string | null) => void;
  onFilePreviewHandlerChange?: (handler: ((path: string) => Promise<boolean>) | null) => void;
  onFileAccess?: (workspace: string, path: string) => void;
  onSendReviewComment?: (commentPrompt: string) => void;
  modelReviewComments?: ModelReviewComment[];
  selectedReviewFinding?: ModelReviewComment | null;
  initialTab?: "newTab" | "changes" | "files" | "summary" | "browser" | "sideChat";
  initialSidePrompt?: string;
  reviewTarget?: { cwd: string; baseBranch: string | null; mergeBase: string | null } | null;
  onOpenTerminal?: () => void;
  onOpenSideChat?: () => void;
  onFocusMainChat?: () => void;
  onInsertToMainChat?: (content: string) => void;
  shortcutRequest?: { id: string; requestId: number; cwd: string; wasOpen?: boolean };
  onShortcutHandled?: (requestId: number) => void;
}

interface ParsedDiffLine {
  file: string | null;
  type: "add" | "del" | "hunk" | "meta" | "ctx";
  raw: string;
  oldLine: number | null;
  newLine: number | null;
}

function alignSplitDiff(lines: ParsedDiffLine[]): [number | null, number | null][] {
  const rows: [number | null, number | null][] = [];
  for (let index = 0; index < lines.length;) {
    if (lines[index].type !== "add" && lines[index].type !== "del") {
      rows.push([index, index]);
      index++;
      continue;
    }
    const deleted: number[] = [];
    const added: number[] = [];
    while (lines[index]?.type === "add" || lines[index]?.type === "del") {
      (lines[index].type === "del" ? deleted : added).push(index++);
    }
    for (let offset = 0; offset < Math.max(deleted.length, added.length); offset++) {
      rows.push([deleted[offset] ?? null, added[offset] ?? null]);
    }
  }
  return rows;
}

function decodeGitDiffPath(path: string): string {
  if (!path.startsWith('"')) return path;
  if (!path.endsWith('"')) return "";
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const escapes: Record<string, string> = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", '"': '"' };
  for (let i = 1; i < path.length - 1; i++) {
    if (path[i] === "\\") {
      const octal = /^[0-7]{1,3}/.exec(path.slice(i + 1, -1));
      if (octal) { bytes.push(parseInt(octal[0], 8)); i += octal[0].length; continue; }
      const value = escapes[path[++i]];
      if (value === undefined) return "";
      bytes.push(...encoder.encode(value));
    } else {
      const value = String.fromCodePoint(path.codePointAt(i)!);
      bytes.push(...encoder.encode(value));
      i += value.length - 1;
    }
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes)); }
  catch { return ""; }
}

function parseUnifiedDiff(diffText: string): ParsedDiffLine[] {
  if (!diffText.trim()) return [];
  const lines = diffText.split("\n");
  const out: ParsedDiffLine[] = [];
  let oldLn = 0;
  let newLn = 0;
  let file: string | null = null;
  let oldRemaining = 0;
  let newRemaining = 0;

  for (const raw of lines) {
    if (raw.startsWith("diff --git")) { file = null; oldLn = 0; newLn = 0; oldRemaining = 0; newRemaining = 0; }
    const inHunk = oldRemaining > 0 || newRemaining > 0;
    if (!inHunk && raw.startsWith("+++ ")) {
      let path = raw.slice(4).split("\t")[0];
      path = decodeGitDiffPath(path);
      file = path.startsWith("b/") ? path.slice(2) : path === "/dev/null" ? null : path || null;
    }
    if (!inHunk && (
      raw.startsWith("diff --git") ||
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ") ||
      raw.startsWith("new file mode") ||
      raw.startsWith("deleted file mode")
    )) {
      out.push({ file, type: "meta", raw, oldLine: null, newLine: null });
      continue;
    }
    if (raw.startsWith("@@")) {
      const m = raw.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (m) {
        oldLn = parseInt(m[1], 10);
        newLn = parseInt(m[3], 10);
        oldRemaining = m[2] === undefined ? 1 : parseInt(m[2], 10);
        newRemaining = m[4] === undefined ? 1 : parseInt(m[4], 10);
      }
      out.push({ file, type: "hunk", raw, oldLine: null, newLine: null });
      continue;
    }
    if (!inHunk || (!raw.startsWith("+") && !raw.startsWith("-") && !raw.startsWith(" "))) {
      out.push({ file, type: "meta", raw, oldLine: null, newLine: null });
    } else if (raw.startsWith("+")) {
      out.push({ file, type: "add", raw, oldLine: null, newLine: newLn });
      newLn++;
      newRemaining--;
    } else if (raw.startsWith("-")) {
      out.push({ file, type: "del", raw, oldLine: oldLn, newLine: null });
      oldLn++;
      oldRemaining--;
    } else {
      out.push({
        file,
        type: "ctx",
        raw,
        oldLine: oldLn > 0 ? oldLn : null,
        newLine: newLn > 0 ? newLn : null,
      });
      if (oldLn > 0) oldLn++;
      if (newLn > 0) newLn++;
      oldRemaining--;
      newRemaining--;
    }
  }
  return out;
}

function reviewPathKey(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
  return /^(?:[a-z]:|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function findingMatchesLine(comment: ModelReviewComment, line: ParsedDiffLine, cwd: string): boolean {
  return reviewPathKey(comment.rootPath) === reviewPathKey(cwd)
    && line.file !== null && reviewPathKey(`${cwd}/${line.file}`) === reviewPathKey(comment.absolutePath)
    && line.newLine === comment.endLine && comment.side === "right";
}

function reviewSelectionRange(content: string, startLine: number, endLine: number): [number, number] | null {
  if (!content) return null;
  const lines = content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  if (startLine < 1 || endLine < startLine || endLine > lines.length) return null;
  const start = lines.slice(0, startLine - 1).reduce((offset, line) => offset + line.length + 1, 0);
  const end = start + lines.slice(startLine - 1, endLine).join("\n").length;
  return [start, end];
}

function ModelFinding({ comment }: { comment: ModelReviewComment }) {
  return <article className="diff-model-finding" data-review-finding={comment.id}>
    <strong>{comment.title}</strong>
    <span className="diff-model-finding-location">{comment.file}:{comment.startLine}{comment.endLine !== comment.startLine ? `–${comment.endLine}` : ""}</span>
    <MarkdownView content={comment.body} />
  </article>;
}

/* ------------------------------------------------------------------ */
/* Files tab: app-server `fs/*` helpers                                */
/* ------------------------------------------------------------------ */

/** Same editable-preview cap as the legacy `fs_read_preview` command. */
const MAX_TEXT_PREVIEW_BYTES = 256 * 1024;

/** Extensions the legacy command renders as `<img>` data URLs. */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
]);

/**
 * Known binary/media formats are previewed through the legacy command.
 * `fs/readFile` has no size guard (verified: a 60 MB file returns in ~9 s as a
 * huge base64 JSON line), so routing obvious large binaries around it keeps
 * the app-server IPC and browser memory usage bounded.
 */
const BINARY_EXTENSIONS = new Set([
  // video / audio
  "mp4", "mov", "avi", "mkv", "webm", "wmv", "flv", "m4v",
  "mp3", "wav", "flac", "ogg", "m4a", "aac",
  // archives / packages
  "zip", "7z", "rar", "gz", "tar", "bz2", "xz", "zst",
  "jar", "war", "whl", "egg", "apk", "dmg", "iso", "cab",
  // executables / object files
  "exe", "dll", "so", "dylib", "bin", "obj", "o", "a", "lib",
  "pdb", "class", "wasm", "node", "pyd", "pyc",
  // office / documents
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "rtf",
  // fonts
  "ttf", "otf", "woff", "woff2", "eot",
  // databases / model & columnar data
  "db", "sqlite", "sqlite3", "mdb", "realm",
  "gguf", "safetensors", "pt", "pth", "onnx", "h5", "npy", "npz",
  "parquet", "arrow", "feather", "pkl", "pickle",
]);

type ExplorerDraftMode = "createFile" | "createDir" | "rename";

interface ExplorerDraft {
  mode: ExplorerDraftMode;
  value: string;
  targetPath?: string;
  targetName?: string;
}

/** Marker error: `fs/readFile` cannot serve this preview, fall back silently. */
function previewFallbackError(reason: string): Error {
  const error = new Error(reason);
  error.name = "PreviewFallbackError";
  return error;
}

function isPreviewFallbackError(error: unknown): boolean {
  return (error as Error | null)?.name === "PreviewFallbackError";
}

function fileExtension(pathValue: string): string {
  const base = baseNameFsPath(pathValue);
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function compareDirectoryEntries(
  a: DirectoryEntryItem,
  b: DirectoryEntryItem
): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

function toDirectoryEntryItems(
  dir: string,
  entries: FsDirectoryEntry[]
): DirectoryEntryItem[] {
  return entries
    .map((entry) => ({
      name: entry.fileName,
      path: joinFsPath(dir, entry.fileName),
      isDirectory: entry.isDirectory,
      // fs/readDirectory does not report size/mtime; the UI hides unknown sizes.
      size: 0,
      mtimeMs: 0,
    }))
    .sort(compareDirectoryEntries);
}

/**
 * Read an editable text preview through `fs/readFile`.
 * Throws `PreviewFallbackError` for images / binary / oversized files so the
 * caller can fall back to `fs_read_preview`, and a normal error when the
 * protocol itself is unavailable.
 */
async function readTextPreviewViaProtocol(
  pathValue: string
): Promise<FilePreviewResult> {
  const extension = fileExtension(pathValue);
  if (IMAGE_EXTENSIONS.has(extension) || BINARY_EXTENSIONS.has(extension)) {
    throw previewFallbackError("image/binary preview needs fs_read_preview");
  }
  const bytes = await readFileBytes(pathValue);
  if (bytes.length > MAX_TEXT_PREVIEW_BYTES) {
    throw previewFallbackError("file exceeds editable preview limit");
  }
  if (isBinaryBytes(bytes)) {
    throw previewFallbackError("file looks binary");
  }
  // Keep a UTF-8 BOM in the text so an edit/save round-trips the bytes.
  const content = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  return {
    path: pathValue,
    isBinary: false,
    isImage: false,
    content,
    base64DataUrl: null,
    sizeBytes: bytes.length,
    mtimeMs: 0,
  };
}

function validateEntryName(rawName: string): string | null {
  const name = rawName.trim();
  if (!name) return "名称不能为空";
  if (name === "." || name === "..") return "名称不合法";
  if (/[\\/:*?"<>|]/.test(name)) return '名称不能包含 \\ / : * ? " < > | 字符';
  if (/[. ]$/.test(name)) return "名称不能以空格或点结尾";
  if (name.length > 200) return "名称过长";
  return null;
}

/** True when `childPath` is `parentPath` itself or inside it. */
function isPathWithin(childPath: string, parentPath: string): boolean {
  if (childPath === parentPath) return true;
  const normalizedParent = parentPath.replace(/[\\/]+$/, "");
  return (
    childPath.startsWith(`${normalizedParent}\\`) ||
    childPath.startsWith(`${normalizedParent}/`)
  );
}

function replacePathPrefix(
  pathValue: string,
  oldPrefix: string,
  newPrefix: string
): string {
  return isPathWithin(pathValue, oldPrefix)
    ? `${newPrefix}${pathValue.slice(oldPrefix.length)}`
    : pathValue;
}

/**
 * Check whether `dir` already contains `name`: `fs/readDirectory` first,
 * legacy `fs_list_dir` when the protocol is unavailable. `null` = unknown.
 */
async function entryExistsInDir(
  dir: string,
  name: string
): Promise<boolean | null> {
  const wanted = name.toLowerCase();
  try {
    const entries = await fsReadDirectory(dir);
    return entries.some((entry) => entry.fileName.toLowerCase() === wanted);
  } catch (protocolError) {
    console.warn(
      "fs/readDirectory unavailable for existence check, falling back to fs_list_dir:",
      protocolError
    );
  }
  try {
    const entries = await invoke<DirectoryEntryItem[]>("fs_list_dir", {
      path: dir,
      showHidden: true,
    });
    return entries.some((entry) => entry.name.toLowerCase() === wanted);
  } catch (fallbackError) {
    console.warn("fs_list_dir failed for existence check:", fallbackError);
    return null;
  }
}

export const DiffDrawer: React.FC<DiffDrawerProps> = ({
  open = true,
  gitPreferences = GIT_DEFAULTS,
  gitPreferencesReady = true,
  connectionIdentity = "local",
  cwd,
  workspaceRoots,
  gitStatus,
  branches = [],
  turns = [],
  recordedTurnDiff = "",
  onRefreshGit,
  onClose,
  selectedPreviewFile,
  previewRequestId,
  previewLine,
  directoryReveal,
  onSelectPreviewFile,
  onFilePreviewHandlerChange,
  onFileAccess,
  onSendReviewComment,
  modelReviewComments = [],
  selectedReviewFinding,
  initialTab = "changes",
  reviewTarget,
  initialSidePrompt,
  onOpenTerminal,
  onOpenSideChat,
  onFocusMainChat,
  onInsertToMainChat,
  shortcutRequest,
  onShortcutHandled,
}) => {
  const [isFullWidth, setIsFullWidth] = useState(false);
  const [fileTreeWidth, setFileTreeWidth] = useState(250);
  const [selectedTreePath, setSelectedTreePath] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<WorkbenchTabItem[]>([
    { id: "newTab", kind: "newTab", title: "新标签页", icon: <GlobeIcon size={13} />, closable: true },
    { id: "changes", kind: "changes", title: "变更", icon: <DiffIcon size={13} />, closable: false },
    { id: "files", kind: "files", title: "文件", icon: <FolderIcon size={13} />, closable: false },
    { id: "summary", kind: "summary", title: "摘要", icon: <SparklesIcon size={13} />, closable: false },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>(initialTab);
  const [browserReloadTokens, setBrowserReloadTokens] = useState<Record<string, number>>({});

  useEffect(() => {
    if (initialTab) {
      setActiveTabId(initialTab);
      setOpenTabs((prev) => {
        if (prev.some((t) => t.id === initialTab)) return prev;
        if (initialTab === "newTab") {
          return [
            { id: "newTab", kind: "newTab", title: "新标签页", icon: <GlobeIcon size={13} />, closable: true },
            ...prev,
          ];
        }
        if (initialTab === "sideChat") {
          return [
            ...prev,
            { id: "sideChat", kind: "sideChat", title: "侧边对话", icon: <SparklesIcon size={13} />, closable: true },
          ];
        }
        return prev;
      });
    }
  }, [initialTab]);

  const activeTabObj = openTabs.find((t) => t.id === activeTabId) || openTabs[0];
  const activeKind = activeTabObj?.kind || "changes";
  const activeTab = activeKind === "files" || activeKind === "summary" ? activeKind : "changes";
  const setActiveTab = (tab: "changes" | "files" | "summary") => {
    setActiveTabId(tab);
  };

  const handleAddNewTab = () => {
    const id = `newTab-${Date.now()}`;
    const newTab: WorkbenchTabItem = {
      id,
      kind: "newTab",
      title: "新标签页",
      icon: <GlobeIcon size={13} />,
      closable: true,
    };
    setOpenTabs((prev) => [newTab, ...prev]);
    setActiveTabId(id);
  };

  const handleOpenSideChatTab = () => {
    setOpenTabs((prev) => {
      if (prev.some((t) => t.kind === "sideChat")) return prev;
      return [
        ...prev,
        { id: "sideChat", kind: "sideChat", title: "侧边对话", icon: <SparklesIcon size={13} />, closable: true },
      ];
    });
    setActiveTabId("sideChat");
    onOpenSideChat?.();
  };

  const handleCloseTab = (id: string) => {
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id) {
        const idx = prev.findIndex((t) => t.id === id);
        const fallback =
          next[Math.max(0, idx - 1)] ||
          next[0] || { id: "changes", kind: "changes", title: "变更", icon: <DiffIcon size={13} /> };
        setActiveTabId(fallback.id);
      }
      return next.length > 0
        ? next
        : [
            { id: "changes", kind: "changes", title: "变更", icon: <DiffIcon size={13} />, closable: false },
          ];
    });
  };

  const handleReloadBrowser = () => {
    if (activeKind !== "browser" || !activeTabObj) return;
    setBrowserReloadTokens((prev) => ({
      ...prev,
      [activeTabObj.id]: (prev[activeTabObj.id] || 0) + 1,
    }));
  };

  const navigateBrowserHistory = (direction: -1 | 1) => {
    if (activeKind !== "browser" || !activeTabObj) return;
    const history = activeTabObj.history || (activeTabObj.url ? [activeTabObj.url] : []);
    const currentIndex = activeTabObj.historyIndex ?? 0;
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= history.length) return;
    const url = history[nextIndex];
    let title = url;
    try {
      title = new URL(url).hostname || url;
    } catch {
      title = url;
    }
    setOpenTabs((prev) => prev.map((tab) =>
      tab.id === activeTabObj.id
        ? { ...tab, url, title, history, historyIndex: nextIndex }
        : tab
    ));
  };

  const handleNavigateUrl = (url: string) => {
    let hostname = url;
    try {
      hostname = new URL(url).hostname || url;
    } catch {
      hostname = url;
    }
    if (activeKind === "browser" && activeTabObj) {
      if (activeTabObj.url === url) {
        handleReloadBrowser();
        return;
      }
      setOpenTabs((prev) => prev.map((tab) => {
        if (tab.id !== activeTabObj.id) return tab;
        const history = tab.history || (tab.url ? [tab.url] : []);
        const index = tab.historyIndex ?? Math.max(0, history.length - 1);
        const nextHistory = [...history.slice(0, index + 1), url];
        return {
          ...tab,
          title: hostname,
          url,
          history: nextHistory,
          historyIndex: nextHistory.length - 1,
        };
      }));
      return;
    }
    const browserId = `browser-${Date.now()}`;
    const newTab: WorkbenchTabItem = {
      id: browserId,
      kind: "browser",
      title: hostname,
      url,
      history: [url],
      historyIndex: 0,
      icon: <GlobeIcon size={13} />,
      closable: true,
    };
    setOpenTabs((prev) => [...prev, newTab]);
    setActiveTabId(browserId);
  };

  const activeHistoryIndex = activeTabObj?.historyIndex ?? 0;
  const canBrowserGoBack = activeKind === "browser" && activeHistoryIndex > 0;
  const canBrowserGoForward = activeKind === "browser" &&
    activeHistoryIndex < (activeTabObj?.history?.length ?? 0) - 1;
  const recentBrowserTabs = openTabs
    .filter((tab) => tab.kind === "browser" && tab.url)
    .map((tab) => ({ id: tab.id, title: tab.title, url: tab.url as string }));

  // Changes state
  const [requestedDiffMode, setDiffMode] = useState<"lastTurn" | "working" | "unstaged" | "staged" | "branch" | "commits">(
    "working"
  );
  const lastTurnOnly = !gitPreferencesReady || gitPreferences["git-review-mode"] === "last-turn-only";
  const diffMode = lastTurnOnly ? "lastTurn" : requestedDiffMode;
  const [diffLayout, setDiffLayout] = useState<"unified" | "split">("unified");
  const [baseBranch, setBaseBranch] = useState<string>("");
  const appliedReviewCwdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!reviewTarget || reviewTarget.cwd !== cwd) {
      if (appliedReviewCwdRef.current && appliedReviewCwdRef.current !== cwd) {
        appliedReviewCwdRef.current = null;
        setDiffMode("working");
        setBaseBranch("");
        setSelectedFile(null);
      }
      return;
    }
    appliedReviewCwdRef.current = cwd;
    setDiffMode(reviewTarget.baseBranch ? "branch" : "working");
    setBaseBranch(reviewTarget.baseBranch || "");
    setDiffLayout("split");
    setSelectedFile(null);
  }, [reviewTarget, cwd]);
  const [selectedFile, setSelectedFile] = useState<string | null>(
    selectedPreviewFile ?? null
  );
  const [viewedFiles, setViewedFiles] = useState<Record<string, boolean>>({});
  const [wordWrap, setWordWrap] = useState<boolean>(false);
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
  const [indexWriting, setIndexWriting] = useState(false);
  const gitWritePendingRef = useRef(false);
  const gitContextRef = useRef({ cwd, connectionIdentity, open });
  if (gitContextRef.current.cwd !== cwd || gitContextRef.current.connectionIdentity !== connectionIdentity || gitContextRef.current.open !== open) gitContextRef.current = { cwd, connectionIdentity, open };
  const [pushing, setPushing] = useState(false);
  const [generationKind, setGenerationKind] = useState<GitGenerationMode | null>(null);
  const generationRef = useRef<{ controller: AbortController; mode: GitGenerationMode } | null>(null);
  const generationMountedRef = useRef(true);
  const commitDraftRef = useRef(commitMessage); commitDraftRef.current = commitMessage;
  const [forceWithLease, setForceWithLease] = useState(gitPreferences["git-always-force-push"]);
  const [showPrModal, setShowPrModal] = useState(false);
  const [shortcutGitCwd, setShortcutGitCwd] = useState<string | null>(null);
  const commitInputRef = useRef<HTMLInputElement | null>(null);
  const prTitleInputRef = useRef<HTMLInputElement | null>(null);
  const handledShortcutRef = useRef<number | null>(null);
  const [shortcutFocus, setShortcutFocus] = useState<{ target: "commit" | "pr"; cwd: string } | null>(null);
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const prDraftRef = useRef({ title: prTitle, body: prBody }); prDraftRef.current = { title: prTitle, body: prBody };
  const [prDraft, setPrDraft] = useState(gitPreferences["git-create-pull-request-as-draft"]);
  useEffect(() => { setForceWithLease(gitPreferences["git-always-force-push"]); }, [gitPreferences["git-always-force-push"]]);
  useEffect(() => { setPrDraft(gitPreferences["git-create-pull-request-as-draft"]); }, [gitPreferences["git-create-pull-request-as-draft"]]);
  const [creatingPr, setCreatingPr] = useState(false);
  const gitWriteBusy = committing || pushing || indexWriting || creatingPr || generationKind !== null;
  const [gitToast, setGitToast] = useState<string | null>(null);
  useEffect(() => {
    generationRef.current?.controller.abort(); generationRef.current = null; setGenerationKind(null);
  }, [cwd, connectionIdentity, open]);
  useEffect(() => { generationMountedRef.current = true; return () => { generationMountedRef.current = false; generationRef.current?.controller.abort(); }; }, []);
  useEffect(() => { if (!showPrModal && generationRef.current?.mode === "pull_request") generationRef.current.controller.abort(); }, [showPrModal]);

  // Files & Editor state
  const [currentDir, setCurrentDir] = useState<string>(cwd);
  const revealedRoot = directoryReveal?.cwd === cwd ? directoryReveal.root : undefined;
  const fileTreeRoots = useMemo(() => Array.from(new Set([cwd, ...(workspaceRoots ?? []), revealedRoot].filter((root): root is string => !!root))), [cwd, workspaceRoots, revealedRoot]);
  const [dirEntries, setDirEntries] = useState<DirectoryEntryItem[]>([]);
  const [fileFilterQuery, setFileFilterQuery] = useState("");
  const [fileSearchHits, setFileSearchHits] = useState<WorkspaceFileHit[]>([]);
  const [fileSearchLoading, setFileSearchLoading] = useState(false);
  const [fileSearchError, setFileSearchError] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<FilePreviewResult | null>(null);
  const [activeReviewFinding, setActiveReviewFinding] = useState<ModelReviewComment | null>(null);
  const fileEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const filePreviewPaneRef = useRef<HTMLDivElement | null>(null);
  const [previewFocusRequest, setPreviewFocusRequest] = useState<{
    context: typeof gitContextRef.current; request: number; path: string; line?: number;
  } | null>(null);
  const [editedContent, setEditedContent] = useState<string>("");
  const [inFileSearch, setInFileSearch] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const previewRequestRef = useRef(0);
  const editRevisionRef = useRef(0);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const closePromiseRef = useRef<Promise<void> | null>(null);
  const editedContentRef = useRef(editedContent);
  const editorOpenRef = useRef(open);
  editorOpenRef.current = open;
  const [discardConfirmation, setDiscardConfirmation] = useState(false);
  const discardResolverRef = useRef<((discard: boolean) => void) | null>(null);
  useEffect(() => {
    setDiscardConfirmation(false);
    return () => {
      ++previewRequestRef.current;
      discardResolverRef.current?.(false);
      discardResolverRef.current = null;
    };
  }, [cwd, open, connectionIdentity]);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const isDirtyRef = useRef(isDirty);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);
  const filePreviewRef = useRef(filePreview);
  useEffect(() => {
    filePreviewRef.current = filePreview;
  }, [filePreview]);
  useEffect(() => () => {
    ++previewRequestRef.current;
    gitContextRef.current = { cwd: "", connectionIdentity: "", open: false };
  }, []);
  const [watchActive, setWatchActive] = useState(false);
  const [explorerDraft, setExplorerDraft] = useState<ExplorerDraft | null>(null);
  const [explorerBusy, setExplorerBusy] = useState(false);
  const dirLoadSeqRef = useRef(0);

  const displayedEntries = useMemo(() => {
    if (diffMode === "lastTurn") return [];
    const list = gitStatus?.entries || [];
    if (diffMode === "staged") {
      return list.filter((e) => e.staged);
    }
    if (diffMode === "unstaged") {
      return list.filter((e) => e.unstaged || e.untracked);
    }
    return list;
  }, [gitStatus, diffMode]);
  const fsWatchTimerRef = useRef<number | null>(null);
  const lastExternalPreviewRequestRef = useRef<string | null>(null);
  const lastDirectoryRevealRef = useRef<typeof directoryReveal>(null);
  const appServerConnectedRef = useRef<boolean | null>(null);
  const [watchEpoch, setWatchEpoch] = useState(0);

  useEffect(() => {
    if (cwd) {
      setCurrentDir(cwd);
      setDirEntries([]);
      setExplorerDraft(null);
    }
  }, [cwd]);

  useEffect(() => { setDirEntries([]); }, [connectionIdentity]);

  useEffect(() => {
    if (!fileTreeRoots.includes(currentDir)) setCurrentDir(cwd);
  }, [fileTreeRoots, currentDir, cwd]);

  useEffect(() => {
    if (gitStatus?.defaultBranch && !baseBranch) {
      setBaseBranch(gitStatus.defaultBranch);
    }
  }, [gitStatus?.defaultBranch, baseBranch]);

  useEffect(() => {
    if (!open || activeTab !== "changes" || !cwd) return;
    if (!gitPreferencesReady) { setDiffContent("Git 设置尚未读取，请在设置中重新读取。"); setLoadingDiff(false); return; }
    let disposed = false;
    if (diffMode === "lastTurn") {
      if (recordedTurnDiff) { setDiffContent(recordedTurnDiff); setLoadingDiff(false); return; }
      setLoadingDiff(true);
      const turnsList = Array.isArray(turns) ? turns : [];
      const lastTurnWithChanges = [...turnsList].reverse().find((t) =>
        (t.items || []).some((i) => i.type === "fileChange" || i.type === "diff")
      );
      if (!lastTurnWithChanges) {
        setDiffContent("本轮暂无文件改动记录。");
        setLoadingDiff(false);
        return;
      }
      const diffPieces: string[] = [];
      for (const item of lastTurnWithChanges.items || []) {
        if (item.type === "fileChange" && Array.isArray((item as any).changes)) {
          for (const ch of (item as any).changes) {
            if (ch?.diff) {
              if (!selectedFile || ch.path === selectedFile) {
                diffPieces.push(ch.diff);
              }
            }
          }
        }
      }
      setDiffContent(diffPieces.join("\n\n") || "本轮选定文件无差异文本。");
      setLoadingDiff(false);
      return;
    }
    if (diffMode === "commits") {
      setLoadingDiff(true);
      invoke<GitCommitInfo[]>("git_log_commits", { cwd, limit: 40 })
        .then((list) => {
          if (disposed) return "";
          setCommits(list);
          const hash = selectedCommitHash || list[0]?.hash || null;
          setSelectedCommitHash(hash);
          if (hash) {
            return invoke<string>("git_commit_diff", { cwd, commitHash: hash });
          }
          return "";
        })
        .then((txt) => { if (!disposed) setDiffContent(txt || ""); })
        .catch((err) => { if (!disposed) setDiffContent(`Error loading commit history: ${String(err)}`); })
        .finally(() => { if (!disposed) setLoadingDiff(false); });
      return () => { disposed = true; };
    }

    const filePath = (diffMode === "staged" || diffMode === "unstaged") &&
      !displayedEntries.some(entry => entry.path === selectedFile) ? null : selectedFile;
    setLoadingDiff(true);
    invoke<string>("git_diff", {
      cwd,
      filePath,
      previousFilePath: diffMode === "unstaged" ? null : gitStatus?.entries?.find(entry => entry.path === filePath)?.previousPath ?? null,
      staged: diffMode === "staged",
      unstaged: diffMode === "unstaged",
      baseBranch: diffMode === "branch" ? baseBranch : null,
      reviewBaseCommit: diffMode === "branch" && reviewTarget?.cwd === cwd && reviewTarget.baseBranch === baseBranch ? reviewTarget.mergeBase : null,
    })
      .then((res) => { if (!disposed) setDiffContent(res); })
      .catch((err) => { if (!disposed) setDiffContent(`Error loading diff: ${String(err)}`); })
      .finally(() => { if (!disposed) setLoadingDiff(false); });
    return () => { disposed = true; };
  }, [open, activeTab, cwd, selectedFile, diffMode, baseBranch, selectedCommitHash, gitStatus, turns, reviewTarget, gitPreferencesReady, recordedTurnDiff, displayedEntries]);

  /**
   * List one directory: app-server `fs/readDirectory` first, then the legacy
   * local `fs_list_dir` command so browsing keeps working offline.
   */
  const refreshDirectory = useCallback(async (dir: string) => {
    if (!dir) return;
    const seq = dirLoadSeqRef.current + 1;
    dirLoadSeqRef.current = seq;
    setDirLoading(true);
    // The legacy listing is both the offline fallback and the size/mtime
    // source: `fs/readDirectory` only reports names and types.
    const legacyEntriesPromise = invoke<DirectoryEntryItem[]>("fs_list_dir", {
      path: dir,
      showHidden: true,
    }).catch((legacyError) => {
      console.warn("fs_list_dir failed:", legacyError);
      return null;
    });
    try {
      let entries: DirectoryEntryItem[];
      try {
        const protocolEntries = await fsReadDirectory(dir);
        entries = toDirectoryEntryItems(dir, protocolEntries);
        const legacyEntries = await legacyEntriesPromise;
        if (legacyEntries) {
          const byPath = new Map(legacyEntries.map((entry) => [entry.path, entry]));
          entries = entries.map((entry) => {
            const legacy = byPath.get(entry.path);
            return legacy
              ? { ...entry, size: legacy.size, mtimeMs: legacy.mtimeMs }
              : entry;
          });
        }
      } catch (protocolError) {
        console.warn(
          "fs/readDirectory unavailable, falling back to fs_list_dir:",
          protocolError
        );
        const legacyEntries = await legacyEntriesPromise;
        if (!legacyEntries) throw protocolError;
        entries = legacyEntries;
      }
      if (seq !== dirLoadSeqRef.current) return;
      setDirEntries(entries);
      setDirError(null);
    } catch (listingError) {
      console.warn("directory listing failed:", listingError);
      if (seq !== dirLoadSeqRef.current) return;
      setDirEntries([]);
      setDirError(String(listingError));
    } finally {
      if (seq === dirLoadSeqRef.current) setDirLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || activeTab !== "files" || !currentDir) return;
    void refreshDirectory(currentDir);
    return () => { ++dirLoadSeqRef.current; };
  }, [open, activeTab, currentDir, connectionIdentity, refreshDirectory, watchEpoch]);

  // Re-arm `fs/watch` when app-server reconnects (watches are connection-scoped).
  useEffect(() => {
    if (!open || activeTab !== "files") return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    tauriListen<{ connected?: boolean }>("app-server:status", (status) => {
      if (disposed) return;
      const connected = Boolean(status?.connected);
      if (connected && appServerConnectedRef.current !== true) {
        setWatchEpoch((epoch) => epoch + 1);
      }
      appServerConnectedRef.current = connected;
    })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [open, activeTab]);

  // Live refresh: `fs/watch` on the current directory, debounced `fs/changed`.
  useEffect(() => {
    if (!open || activeTab !== "files" || !currentDir) return;
    let disposed = false;
    let stopWatch: FsUnwatch | null = null;
    setWatchActive(false);

    fsWatchPath(currentDir, (event) => {
      if (disposed) return;
      if (fsWatchTimerRef.current !== null) {
        window.clearTimeout(fsWatchTimerRef.current);
      }
      fsWatchTimerRef.current = window.setTimeout(() => {
        fsWatchTimerRef.current = null;
        if (!disposed) {
          void refreshDirectory(currentDir);
          const currentPreview = filePreviewRef.current;
          if (currentPreview && !isDirtyRef.current) {
            const curPath = currentPreview.path.replace(/\\/g, "/").toLowerCase();
            const paths = event?.changedPaths || [];
            const isTargetChanged = paths.length === 0 || paths.some((p) => p.replace(/\\/g, "/").toLowerCase() === curPath);
            if (isTargetChanged) {
              void openFilePreview(currentPreview.path, { silent: true });
            }
          }
        }
      }, 300);
    })
      .then((unwatch) => {
        if (disposed) {
          void unwatch();
          return;
        }
        stopWatch = unwatch;
        setWatchActive(true);
      })
      .catch((watchError) => {
        console.warn("fs/watch unavailable for directory:", currentDir, watchError);
        if (!disposed) setWatchActive(false);
      });

    return () => {
      disposed = true;
      setWatchActive(false);
      if (fsWatchTimerRef.current !== null) {
        window.clearTimeout(fsWatchTimerRef.current);
        fsWatchTimerRef.current = null;
      }
      if (stopWatch) void stopWatch();
    };
  }, [open, activeTab, currentDir, connectionIdentity, refreshDirectory, watchEpoch]);

  // Expanded folders no longer replace currentDir; watch an opened nested file
  // independently so external edits retain the existing clean-preview refresh.
  useEffect(() => {
    const path = filePreview?.path;
    if (!open || activeTab !== "files" || !path || parentFsPath(path) === currentDir) return;
    let disposed = false;
    let stopWatch: FsUnwatch | null = null;
    fsWatchPath(path, () => {
      if (!disposed && filePreviewRef.current?.path === path && !isDirtyRef.current) void openFilePreview(path, { silent: true });
    }).then(unwatch => { if (disposed) void unwatch(); else stopWatch = unwatch; }).catch(() => {});
    return () => { disposed = true; if (stopWatch) void stopWatch(); };
  }, [open, activeTab, filePreview?.path, currentDir, connectionIdentity, watchEpoch]);

  useEffect(() => {
    if (!open || activeTab !== "files" || !currentDir) return;
    const q = fileFilterQuery.trim();
    if (!q) {
      setFileSearchHits([]);
      setFileSearchLoading(false);
      setFileSearchError(null);
      return;
    }
    let disposed = false;
    setFileSearchHits([]);
    setFileSearchLoading(true);
    setFileSearchError(null);
    invoke<WorkspaceFileHit[]>("fs_search_files", { cwd: currentDir, query: q, limit: 35 })
      .then((hits) => { if (!disposed) setFileSearchHits(hits); })
      .catch(error => { if (!disposed) setFileSearchError(String(error)); })
      .finally(() => { if (!disposed) setFileSearchLoading(false); });
    return () => { disposed = true; };
  }, [open, activeTab, currentDir, connectionIdentity, fileFilterQuery]);

  const showToast = (msg: string) => {
    setGitToast(msg);
    setTimeout(() => setGitToast(null), 3200);
  };

  const handleStage = async (filePath?: string) => {
    if (gitWritePendingRef.current || generationRef.current) return;
    const context = gitContextRef.current;
    gitWritePendingRef.current = true;
    setIndexWriting(true);
    try {
      await invoke("git_stage", { cwd: context.cwd, filePath: filePath ?? null });
      if (context === gitContextRef.current) onRefreshGit();
    } catch (e) {
      if (context === gitContextRef.current) showToast(`暂存失败: ${String(e)}`);
    } finally {
      gitWritePendingRef.current = false;
      setIndexWriting(false);
    }
  };

  const handleUnstage = async (filePath?: string) => {
    if (gitWritePendingRef.current || generationRef.current) return;
    const context = gitContextRef.current;
    gitWritePendingRef.current = true;
    setIndexWriting(true);
    try {
      const renamed = gitStatus?.entries.find(entry => entry.path === filePath && entry.staged && entry.status.startsWith("R"));
      await invoke("git_unstage", { cwd: context.cwd, filePath: filePath ?? null, previousFilePath: renamed?.previousPath ?? null });
      if (context === gitContextRef.current) onRefreshGit();
    } catch (e) {
      if (context === gitContextRef.current) showToast(`取消暂存失败: ${String(e)}`);
    } finally {
      gitWritePendingRef.current = false;
      setIndexWriting(false);
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

  const handleDiscardAll = async () => {
    const count = displayedEntries.length;
    if (count === 0) return;
    if (!confirm(`确定放弃全部 ${count} 个文件的未提交更改吗？此操作无法撤销。`)) return;
    try {
      for (const entry of displayedEntries) {
        await invoke("git_discard", { cwd, filePath: entry.path });
      }
      setSelectedFile(null);
      onRefreshGit();
      showToast(`已还原全部 ${count} 个文件`);
    } catch (e) {
      showToast(`放弃更改失败: ${String(e)}`);
    }
  };

  const handleCopyGitApply = useCallback(async () => {
    if (!diffContent.trim()) {
      showToast("当前暂无改动差异可复制");
      return;
    }
    const script = `git apply <<'EOF'\n${diffContent}\nEOF`;
    try {
      await navigator.clipboard.writeText(script);
      showToast("✓ 已复制 git apply 补丁命令");
    } catch {
      showToast("复制失败");
    }
  }, [diffContent]);

  const handleCopyRawPatch = useCallback(async () => {
    if (!diffContent.trim()) {
      showToast("当前暂无改动差异可复制");
      return;
    }
    try {
      await navigator.clipboard.writeText(diffContent);
      showToast("✓ 已复制 Diff 补丁内容");
    } catch {
      showToast("复制失败");
    }
  }, [diffContent]);

  const cancelGeneration = () => { generationRef.current?.controller.abort(); };
  const requestGeneration = async (mode: GitGenerationMode, draftMessage = "") => {
    if (!cwd || !open || !gitPreferencesReady) throw Error("Git 设置或工作区尚未就绪，请重新读取。");
    if (generationRef.current) throw Error("正在生成，请等待完成或取消。");
    const context = gitContextRef.current, controller = new AbortController();
    const operation = { controller, mode }; generationRef.current = operation; setGenerationKind(mode);
    try {
      const result = await generateGitMessage(cwd, mode, {
        includeUnstaged: !gitStatus?.entries.some(entry => entry.staged), baseBranch: baseBranch || null, draftMessage,
      }, controller.signal);
      if (controller.signal.aborted || context !== gitContextRef.current) throw Error("生成已取消或工作区已改变。");
      return result;
    } finally {
      if (generationRef.current === operation) { generationRef.current = null; if (generationMountedRef.current) setGenerationKind(null); }
    }
  };
  const handleGenerateCommitMessage = async () => {
    if (gitWritePendingRef.current || generationRef.current) return;
    const context = gitContextRef.current, draft = commitDraftRef.current;
    try {
      const result = await requestGeneration("commit", draft);
      if (context !== gitContextRef.current) return;
      if (commitDraftRef.current !== draft) { showToast("提交草稿已改变，已保留当前输入。"); return; }
      commitDraftRef.current = result.message!; setCommitMessage(result.message!);
    } catch (error) { if (context === gitContextRef.current) showToast(`生成失败: ${String(error)}`); }
  };
  const handleGeneratePrMessage = async () => {
    if (gitWritePendingRef.current || generationRef.current) return;
    const context = gitContextRef.current, draft = { ...prDraftRef.current };
    try {
      const result = await requestGeneration("pull_request");
      if (context !== gitContextRef.current) return;
      const current = prDraftRef.current;
      const title = !draft.title.trim() && current.title === draft.title ? result.title! : current.title;
      const body = !draft.body.trim() && current.body === draft.body ? result.body! : current.body;
      prDraftRef.current = { title, body }; setPrTitle(title); setPrBody(body);
    } catch (error) { if (context === gitContextRef.current) showToast(`生成失败: ${String(error)}`); }
  };

  const handleCommit = async () => {
    if (gitWritePendingRef.current || generationRef.current) return;
    const context = gitContextRef.current;
    const draftMessage = commitMessage;
    let messageToUse = commitMessage.trim();
    gitWritePendingRef.current = true;
    setCommitting(true);
    try {
      if (!messageToUse) {
        const generated = await requestGeneration("commit", draftMessage);
        if (context !== gitContextRef.current || commitDraftRef.current !== draftMessage) throw Error("提交草稿已改变，未执行 Git 写入。");
        messageToUse = generated.message!;
      }
      const hasStaged = gitStatus?.entries.some((e) => e.staged);
      if (!hasStaged && (gitStatus?.entries.length || 0) > 0) {
        await invoke("git_stage", { cwd, filePath: null });
      }
      if (context !== gitContextRef.current) return;
      await invoke("git_commit_changes", { cwd, message: messageToUse });
      if (context !== gitContextRef.current) return;
      setCommitMessage((current) => current === draftMessage ? "" : current);
      onRefreshGit();
      showToast("✓ 已成功创建 Git 提交");
    } catch (e) {
      if (context === gitContextRef.current) showToast(`提交失败: ${String(e)}`);
    } finally {
      gitWritePendingRef.current = false;
      if (generationMountedRef.current) setCommitting(false);
    }
  };

  const handleCommitAndPush = async () => {
    if (gitWritePendingRef.current || generationRef.current) return;
    const context = gitContextRef.current;
    const draftMessage = commitMessage;
    let messageToUse = commitMessage.trim();
    gitWritePendingRef.current = true;
    setCommitting(true);
    try {
      if (!messageToUse) {
        const generated = await requestGeneration("commit", draftMessage);
        if (context !== gitContextRef.current || commitDraftRef.current !== draftMessage) throw Error("提交草稿已改变，未执行 Git 写入。");
        messageToUse = generated.message!;
      }
      const hasStaged = gitStatus?.entries.some((e) => e.staged);
      if (!hasStaged && (gitStatus?.entries.length || 0) > 0) {
        await invoke("git_stage", { cwd, filePath: null });
      }
      if (context !== gitContextRef.current) return;
      await invoke("git_commit_changes", { cwd, message: messageToUse });
      if (context !== gitContextRef.current) return;
      setCommitMessage((current) => current === draftMessage ? "" : current);
      onRefreshGit();
      showToast("✓ 提交成功，正在推送到远程...");
      await invoke("git_push_changes", { cwd, forceWithLease: gitPreferences["git-always-force-push"] || forceWithLease });
      if (context !== gitContextRef.current) return;
      onRefreshGit();
      showToast("✓ 提交并推送成功");
    } catch (e) {
      if (context === gitContextRef.current) showToast(`操作失败: ${String(e)}`);
    } finally {
      gitWritePendingRef.current = false;
      if (generationMountedRef.current) setCommitting(false);
    }
  };

  const handlePush = async () => {
    if (gitWritePendingRef.current || generationRef.current) return;
    const context = gitContextRef.current;
    gitWritePendingRef.current = true;
    setPushing(true);
    try {
      await invoke("git_push_changes", { cwd, forceWithLease: gitPreferences["git-always-force-push"] || forceWithLease });
      if (context !== gitContextRef.current) return;
      onRefreshGit();
      showToast("✓ 已推送到远程仓库");
    } catch (e) {
      if (context === gitContextRef.current) showToast(`推送失败: ${String(e)}`);
    } finally {
      gitWritePendingRef.current = false;
      setPushing(false);
    }
  };

  const handleCreatePr = async () => {
    if (gitWritePendingRef.current || generationRef.current) return;
    const context = gitContextRef.current, draft = { ...prDraftRef.current };
    gitWritePendingRef.current = true; setCreatingPr(true);
    try {
      let title = draft.title, body = draft.body;
      if (!title.trim() || !body.trim()) {
        const generated = await requestGeneration("pull_request");
        if (context !== gitContextRef.current || prDraftRef.current.title !== draft.title || prDraftRef.current.body !== draft.body) throw Error("PR 草稿已改变，未创建 PR。");
        title = title.trim() ? title : generated.title!; body = body.trim() ? body : generated.body!;
      }
      if (context !== gitContextRef.current) return;
      const url = await invoke<string>("git_create_pr", { cwd, title: title.trim(), body, baseBranch: baseBranch || null, draft: prDraft });
      if (context !== gitContextRef.current) return;
      setShowPrModal(false);
      setPrTitle(current => current === draft.title ? "" : current); setPrBody(current => current === draft.body ? "" : current);
      showToast(`✓ PR 已创建: ${url}`);
    } catch (error) { if (context === gitContextRef.current) showToast(`创建 PR 失败: ${String(error)}`); }
    finally { gitWritePendingRef.current = false; if (generationMountedRef.current) setCreatingPr(false); }
  };

  /**
   * Preview a file: `fs/readFile` (UTF-8) first; images / binary / oversized
   * files and protocol failures fall back to the legacy `fs_read_preview`.
   */
  const openFilePreview = async (
    path: string,
    options?: { silent?: boolean; reveal?: boolean; line?: number }
  ): Promise<boolean> => {
    if (isDirtyRef.current) {
      if (!options?.silent) showToast("请先保存当前文件的修改，再打开其他文件。");
      return false;
    }
    if (!editorOpenRef.current) return false;
    const context = gitContextRef.current;
    const request = ++previewRequestRef.current;
    const revision = editRevisionRef.current;
    const isCurrent = () => request === previewRequestRef.current
      && revision === editRevisionRef.current
      && context === gitContextRef.current && editorOpenRef.current;
    const applyPreview = (preview: FilePreviewResult) => {
      if (!isCurrent()) return false;
      filePreviewRef.current = preview;
      isDirtyRef.current = false;
      setFilePreview(preview);
      editedContentRef.current = preview.content ?? "";
      setEditedContent(preview.content ?? "");
      setIsDirty(false);
      if (!options?.silent) onFileAccess?.(context.cwd, preview.path);
      if (options?.reveal) {
        setActiveTab("files");
        setSelectedTreePath(preview.path);
      }
      if (options?.reveal || options?.line !== undefined) setPreviewFocusRequest({ context, request, path: preview.path, line: options.line });
      return true;
    };
    try {
      const preview = await readTextPreviewViaProtocol(path);
      return applyPreview(preview);
    } catch (protocolError) {
      if (!isPreviewFallbackError(protocolError)) {
        console.warn(
          "fs/readFile unavailable for preview, falling back to fs_read_preview:",
          protocolError
        );
      }
    }
    if (!isCurrent()) return false;
    try {
      const res = await invoke<FilePreviewResult>("fs_read_preview", {
        path,
        maxBytes: MAX_TEXT_PREVIEW_BYTES,
      });
      return applyPreview(res);
    } catch (e) {
      if (isCurrent() && !options?.silent) showToast(`读取文件失败: ${String(e)}`);
      return false;
    }
  };

  useEffect(() => {
    const context = gitContextRef.current;
    onFilePreviewHandlerChange?.(path => context === gitContextRef.current && open
      ? openFilePreview(path, { reveal: true }) : Promise.resolve(false));
    return () => onFilePreviewHandlerChange?.(null);
  }, [open, cwd, connectionIdentity, onFilePreviewHandlerChange, onFileAccess]);

  useEffect(() => {
    if (!previewFocusRequest || !open || activeKind !== "files") return;
    const { context, request, path, line } = previewFocusRequest;
    const frame = window.requestAnimationFrame(() => {
      const preview = filePreviewRef.current;
      if (!editorOpenRef.current || context !== gitContextRef.current
        || request !== previewRequestRef.current || preview?.path !== path) return;
      const editor = fileEditorRef.current;
      (preview.isBinary || preview.isImage ? filePreviewPaneRef.current : editor)?.focus();
      if (line === undefined) return;
      setPreviewFocusRequest(null);
      if (!editor || preview.isBinary || preview.isImage) return;
      const range = reviewSelectionRange(editor.value, line, line);
      if (!range) return;
      editor.setSelectionRange(range[0], range[0]);
      const lineHeight = parseFloat(window.getComputedStyle(editor).lineHeight);
      if (Number.isFinite(lineHeight)) editor.scrollTop = Math.max(0, (line - 2) * lineHeight);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [previewFocusRequest, open, activeKind, cwd, connectionIdentity]);

  const saveEditedFile = (): Promise<boolean> => {
    if (savePromiseRef.current) return savePromiseRef.current;
    const preview = filePreviewRef.current;
    if (!preview) return Promise.resolve(false);
    setSavingFile(true);
    const targetPath = preview.path;
    const content = editedContentRef.current;
    const revision = editRevisionRef.current;
    const request = previewRequestRef.current;
    const context = gitContextRef.current;
    const isCurrent = () => request === previewRequestRef.current
      && filePreviewRef.current?.path === targetPath
      && gitContextRef.current === context;
    const pending = (async () => {
      try {
        const result = await saveFileEditorSnapshot(
          targetPath, preview.content ?? "", content, isCurrent,
        );
        if (result === "obsolete") return false;
        if (result === "conflict") {
          showToast("磁盘文件已变化，未确认保存；当前草稿已保留。");
          return false;
        }
        if (!isCurrent() || !filePreviewRef.current) return false;
        const savedPreview = { ...filePreviewRef.current, content };
        filePreviewRef.current = savedPreview;
        setFilePreview(savedPreview);
        if (result === "saved") onFileAccess?.(context.cwd, targetPath);
        if (revision === editRevisionRef.current) {
          isDirtyRef.current = false;
          setIsDirty(false);
        }
        onRefreshGit();
        void refreshDirectory(currentDir);
        showToast("✓ 文件已保存");
        return true;
      } catch (e) {
        if (isCurrent()) showToast(`保存文件失败: ${String(e)}`);
        return false;
      } finally {
        savePromiseRef.current = null;
        setSavingFile(false);
      }
    })();
    savePromiseRef.current = pending;
    return pending;
  };

  const closeFilePreview = (): Promise<void> => {
    if (closePromiseRef.current) return closePromiseRef.current;
    const targetPath = filePreviewRef.current?.path;
    const request = previewRequestRef.current;
    const context = gitContextRef.current;
    const isCurrent = () => editorOpenRef.current
      && request === previewRequestRef.current
      && filePreviewRef.current?.path === targetPath
      && gitContextRef.current === context;
    const pending = (async () => {
      while (isCurrent() && isDirtyRef.current) {
        const saved = await saveEditedFile();
        if (!isCurrent()) return;
        if (saved) continue;
        const discard = await new Promise<boolean>(resolve => {
          discardResolverRef.current = resolve;
          setDiscardConfirmation(true);
        });
        if (!discard || !isCurrent()) return;
        break;
      }
      if (!isCurrent()) return;
      ++previewRequestRef.current;
      filePreviewRef.current = null;
      isDirtyRef.current = false;
      editedContentRef.current = "";
      setFilePreview(null);
      setEditedContent("");
      setIsDirty(false);
    })().finally(() => { closePromiseRef.current = null; });
    closePromiseRef.current = pending;
    return pending;
  };

  useEffect(() => {
    if (!shortcutRequest || handledShortcutRef.current === shortcutRequest.requestId) return;
    handledShortcutRef.current = shortcutRequest.requestId;
    const { id, requestId } = shortcutRequest;
    if (open && shortcutRequest.cwd === cwd) {
      if (id === "toggle-file-tree") {
        if (!cwd) { onShortcutHandled?.(requestId); return; }
        if ((activeKind === "files" || activeKind === "changes") && shortcutRequest.wasOpen !== false) setFileTreeWidth(value => value > 0 ? 0 : 250);
        else { setActiveTab("files"); setFileTreeWidth(250); }
      }
      else if (id === "next-tab" || id === "previous-tab") {
        const index = openTabs.findIndex(tab => tab.id === activeTabId);
        const next = openTabs[(Math.max(0, index) + (id === "next-tab" ? 1 : -1) + openTabs.length) % openTabs.length];
        if (next) setActiveTabId(next.id);
      } else if (/^focus-tab-[1-9]$/.test(id)) {
        const tab = openTabs[Number(id.slice(-1)) - 1];
        if (tab) setActiveTabId(tab.id);
      } else if (id === "file-save") {
        if (activeKind === "files" && filePreview && !filePreview.isBinary && !filePreview.isImage && isDirty) void saveEditedFile();
      } else if (["git-commit", "git-create-pull-request", "git-create-draft-pull-request"].includes(id)) {
        if (cwd && !gitWriteBusy && !creatingPr) {
          setActiveTab("changes");
          setDiffMode("working");
          setShortcutGitCwd(cwd);
          if (id === "git-commit") setShortcutFocus({ target: "commit", cwd });
          else {
            setPrDraft(id === "git-create-draft-pull-request" || gitPreferences["git-create-pull-request-as-draft"]);
            setShowPrModal(true);
            setShortcutFocus({ target: "pr", cwd });
          }
        }
      }
    }
    onShortcutHandled?.(requestId);
  }, [shortcutRequest, open, cwd, activeTabId, openTabs, activeKind, filePreview, isDirty, lastTurnOnly, gitWriteBusy, creatingPr, gitPreferences, onShortcutHandled]);

  useEffect(() => {
    if (!open || (shortcutGitCwd && shortcutGitCwd !== cwd)) setShortcutGitCwd(null);
  }, [open, cwd, shortcutGitCwd]);

  // Focus only after the requested form has mounted; never queue a delayed
  // action which could run in a different workspace or after closing the drawer.
  useEffect(() => {
    if (!shortcutFocus) return;
    if (open && shortcutFocus.cwd === cwd) {
      (shortcutFocus.target === "commit" ? commitInputRef : prTitleInputRef).current?.focus();
    }
    setShortcutFocus(null);
  }, [shortcutFocus, open, cwd]);

  // An explicit external open reveals Files. Consume request identity rather
  // than caching paths, so a new click can retry a failed read of the same file.
  useEffect(() => {
    if (!open || !selectedPreviewFile) {
      if (!selectedPreviewFile) lastExternalPreviewRequestRef.current = null;
      return;
    }
    if (selectedReviewFinding && selectedReviewFinding.absolutePath === selectedPreviewFile) return;
    const requestKey = JSON.stringify([cwd, connectionIdentity, selectedPreviewFile, previewRequestId ?? 0]);
    if (lastExternalPreviewRequestRef.current === requestKey) return;
    lastExternalPreviewRequestRef.current = requestKey;
    setActiveTab("files");
    if (filePreviewRef.current?.path === selectedPreviewFile) {
      const request = ++previewRequestRef.current;
      if (previewLine !== undefined) setPreviewFocusRequest({ context: gitContextRef.current, request, path: selectedPreviewFile, line: previewLine });
      return;
    }
    void openFilePreview(selectedPreviewFile, { line: previewLine });
  }, [open, cwd, connectionIdentity, selectedPreviewFile, previewRequestId, previewLine, selectedReviewFinding]);

  useEffect(() => {
    if (!open || !directoryReveal || directoryReveal.cwd !== cwd || lastDirectoryRevealRef.current === directoryReveal) return;
    lastDirectoryRevealRef.current = directoryReveal;
    setActiveTab("files");
    const root = directoryReveal.root ?? cwd;
    if (currentDir !== root) {
      ++dirLoadSeqRef.current;
      setDirEntries([]);
      setDirError(null);
      setExplorerDraft(null);
    }
    setCurrentDir(root);
    setFileFilterQuery("");
    setSelectedTreePath(directoryReveal.path);
  }, [open, cwd, currentDir, directoryReveal]);

  useEffect(() => {
    if (!selectedReviewFinding) { setActiveReviewFinding(null); return; }
    if (!open || reviewPathKey(selectedReviewFinding.rootPath) !== reviewPathKey(cwd)
      || !modelReviewComments.some(comment => comment.id === selectedReviewFinding.id)) return;
    setActiveReviewFinding(selectedReviewFinding);
    setActiveTab("files");
    void openFilePreview(selectedReviewFinding.absolutePath);
  }, [open, cwd, selectedReviewFinding]);

  const visibleReviewFinding = activeReviewFinding
    && reviewPathKey(activeReviewFinding.rootPath) === reviewPathKey(cwd)
    && modelReviewComments.some(comment => comment.id === activeReviewFinding.id) ? activeReviewFinding : null;
  useEffect(() => {
    if (activeReviewFinding && !visibleReviewFinding) setActiveReviewFinding(null);
  }, [activeReviewFinding, visibleReviewFinding]);

  useEffect(() => {
    if (!visibleReviewFinding || !filePreview || reviewPathKey(filePreview.path) !== reviewPathKey(visibleReviewFinding.absolutePath)) return;
    const range = reviewSelectionRange(filePreview.content ?? "", visibleReviewFinding.startLine, visibleReviewFinding.endLine);
    const editor = fileEditorRef.current;
    if (!range || !editor || filePreview.isBinary || filePreview.isImage) return;
    editor.focus();
    editor.setSelectionRange(range[0], range[1]);
    const lineHeight = parseFloat(window.getComputedStyle(editor).lineHeight);
    if (Number.isFinite(lineHeight)) editor.scrollTop = Math.max(0, (visibleReviewFinding.startLine - 2) * lineHeight);
  }, [filePreview, visibleReviewFinding]);

  const handleCopyPath = async (path: string) => {
    const ok = await copyTextToClipboard(path);
    showToast(ok ? `✓ 已复制路径: ${path}` : `复制路径失败: ${path}`);
  };

  const beginCreateDraft = (mode: "createFile" | "createDir") => {
    if (explorerBusy) return;
    setExplorerDraft({ mode, value: "" });
  };

  const beginRenameDraft = (item: DirectoryEntryItem) => {
    if (explorerBusy) return;
    setExplorerDraft({
      mode: "rename",
      value: item.name,
      targetPath: item.path,
      targetName: item.name,
    });
  };

  const cancelExplorerDraft = () => {
    if (explorerBusy) return;
    setExplorerDraft(null);
  };

  const submitExplorerDraft = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    const draft = explorerDraft;
    if (!draft || explorerBusy) return;

    const name = draft.value.trim();
    const nameError = validateEntryName(name);
    if (nameError) {
      showToast(nameError);
      return;
    }

    const isRename = draft.mode === "rename";
    const targetDir =
      isRename && draft.targetPath
        ? parentFsPath(draft.targetPath)
        : currentDir;
    const targetPath =
      isRename && draft.targetPath
        ? joinFsPath(targetDir, name)
        : joinFsPath(currentDir, name);
    if (isRename && draft.targetPath === targetPath) {
      setExplorerDraft(null);
      return;
    }

    setExplorerBusy(true);
    try {
      const exists = await entryExistsInDir(targetDir, name);
      if (exists === null) throw new Error("无法检查目标目录内容");
      if (exists) throw new Error(`已存在同名文件或文件夹：${name}`);

      if (draft.mode === "createDir") {
        await fsCreateDirectory(targetPath, true);
        showToast(`✓ 已新建文件夹: ${name}`);
      } else if (draft.mode === "createFile") {
        try {
          await fsWriteFileText(targetPath, "");
        } catch (protocolError) {
          console.warn(
            "fs/writeFile unavailable for create, falling back to fs_write_file:",
            protocolError
          );
          await invoke("fs_write_file", { path: targetPath, content: "" });
        }
        showToast(`✓ 已新建文件: ${name}`);
      } else {
        const oldPath = draft.targetPath as string;
        await fsRenamePath(oldPath, targetPath);
        setFilePreview((prev) => {
          if (!prev) return prev;
          const nextPath = replacePathPrefix(prev.path, oldPath, targetPath);
          return nextPath === prev.path ? prev : { ...prev, path: nextPath };
        });
        showToast(`✓ 已重命名: ${draft.targetName ?? oldPath} → ${name}`);
      }

      setExplorerDraft(null);
      await refreshDirectory(currentDir);
      if (draft.mode === "createFile") void openFilePreview(targetPath);
      onRefreshGit();
    } catch (e) {
      showToast(
        draft.mode === "createDir"
          ? `新建文件夹失败: ${String(e)}`
          : draft.mode === "createFile"
            ? `新建文件失败: ${String(e)}`
            : `重命名失败: ${String(e)}`
      );
    } finally {
      setExplorerBusy(false);
    }
  };

  const handleDeleteEntry = async (item: DirectoryEntryItem) => {
    const kind = item.isDirectory ? "文件夹" : "文件";
    const confirmed = window.confirm(
      `确定要删除${kind} “${item.name}” 吗？\n${item.path}\n\n此操作不可撤销。`
    );
    if (!confirmed) return;

    setExplorerBusy(true);
    try {
      await fsRemovePath(item.path, {
        recursive: item.isDirectory,
        force: true,
      });
      if (filePreview && isPathWithin(filePreview.path, item.path)) {
        ++previewRequestRef.current;
        filePreviewRef.current = null;
        isDirtyRef.current = false;
        setFilePreview(null);
        setEditedContent("");
        setIsDirty(false);
      }
      showToast(`✓ 已删除${kind}: ${item.name}`);
      await refreshDirectory(currentDir);
      onRefreshGit();
    } catch (e) {
      showToast(`删除失败: ${String(e)}`);
    } finally {
      setExplorerBusy(false);
    }
  };

  const explorerDraftLabel = explorerDraft
    ? explorerDraft.mode === "rename"
      ? `重命名 “${explorerDraft.targetName ?? ""}” 为：`
      : explorerDraft.mode === "createDir"
        ? "新建文件夹名称："
        : "新建文件名称："
    : "";

  const parsedLines = useMemo(() => parseUnifiedDiff(diffContent), [diffContent]);
  const visibleDiffStats = diffMode === "unstaged" || diffMode === "staged"
    ? loadingDiff || displayedEntries.some(entry => entry.path === selectedFile)
      ? null
      : {
        additions: parsedLines.filter(line => line.type === "add").length,
        deletions: parsedLines.filter(line => line.type === "del").length,
      }
    : gitStatus;
  const splitRows = useMemo(() => diffLayout === "split" ? alignSplitDiff(parsedLines) : [], [diffLayout, parsedLines]);
  const unanchoredFindings = modelReviewComments.filter(comment => loadingDiff || !parsedLines.some(line => findingMatchesLine(comment, line, cwd)));
  const renderLineFindings = (line: ParsedDiffLine) => modelReviewComments
    .filter(comment => findingMatchesLine(comment, line, cwd))
    .map(comment => <ModelFinding key={comment.id} comment={comment} />);
  const openFinding = (comment: ModelReviewComment) => {
    if (reviewPathKey(comment.rootPath) !== reviewPathKey(cwd)) return;
    const entry = displayedEntries.find(item => reviewPathKey(`${cwd}/${item.path}`) === reviewPathKey(comment.absolutePath));
    const fileInDiff = parsedLines.some(line => line.file !== null && reviewPathKey(`${cwd}/${line.file}`) === reviewPathKey(comment.absolutePath));
    if (entry && !fileInDiff) { setSelectedFile(entry.path); setActiveTab("changes"); }
    else { setActiveReviewFinding(comment); setActiveTab("files"); void openFilePreview(comment.absolutePath); }
  };

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

  const renderFileTreeEntry: WorkspaceEntryRenderer = (item, depth, expanded, toggle, groupId) => {
    const isRenaming =
      explorerDraft?.mode === "rename" &&
      explorerDraft.targetPath === item.path;
    const selected = selectedTreePath !== null && reviewPathKey(selectedTreePath) === reviewPathKey(item.path);
    return (
      <div
        key={item.path}
        className={`diff-file-row fe-file-row ${
          selected ? "active" : ""
        } ${isRenaming ? "fe-renaming" : ""}`}
        role="treeitem" tabIndex={0} aria-label={item.name}
        aria-level={depth + 1} aria-expanded={item.isDirectory ? expanded : undefined}
        aria-owns={item.isDirectory && expanded ? groupId : undefined}
        aria-selected={selected}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => setSelectedTreePath(item.path)}
        onDoubleClick={() => {
          if (item.isDirectory) {
            setExplorerDraft(null);
            toggle();
          } else {
            void openFilePreview(item.path);
          }
        }}
        onKeyDown={event => {
          if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return;
          if (item.isDirectory && (event.key === "ArrowRight" || event.key === "ArrowLeft")) { event.preventDefault(); toggle(event.key === "ArrowRight"); return; }
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (item.isDirectory) { setExplorerDraft(null); toggle(); }
          else void openFilePreview(item.path);
        }}
      >
        <button type="button" className="workspace-tree-disclosure"
          aria-label={`${expanded ? "收起" : "展开"} ${item.name}`} aria-expanded={expanded}
          tabIndex={-1} style={{ visibility: item.isDirectory ? "visible" : "hidden" }}
          onClick={event => { event.stopPropagation(); toggle(); }}
          onDoubleClick={event => event.stopPropagation()}>{expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}</button>
        <span className="file-icon-tag">{item.isDirectory ? <FolderIcon size={13} /> : <FileCodeIcon size={13} />}</span>
        <span className="diff-file-path" title={item.path}>
          {item.name}
        </span>
        {!item.isDirectory && item.size > 0 && (
          <span className="file-size-tag">
            {(item.size / 1024).toFixed(1)} KB
          </span>
        )}
        <span
          className="fe-row-actions"
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="fe-row-btn"
            title={`重命名 ${item.name}`}
            disabled={explorerBusy}
            onClick={() => beginRenameDraft(item)}
          >
            ✎
          </button>
          <button
            type="button"
            className="fe-row-btn"
            title={`复制路径 ${item.path}`}
            onClick={() => void handleCopyPath(item.path)}
          >
            ⧉
          </button>
          <button
            type="button"
            className="fe-row-btn danger"
            title={`删除 ${item.name}`}
            disabled={explorerBusy}
            onClick={() => void handleDeleteEntry(item)}
          >
            <TrashIcon size={11} />
          </button>
        </span>
      </div>
    );
  };

  if (!open) return null;

  return (
    <aside className={`diff-drawer ${isFullWidth ? "full-width" : ""}`}>
      {/* Workbench tab strip */}
      <div className="diff-drawer-header">
        <div className="diff-drawer-tabs">
          {openTabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const badgeCount =
              tab.kind === "changes" ? gitStatus?.entries?.length || 0 : tab.badge;

            return (
              <button
                key={tab.id}
                type="button"
                className={`diff-tab-pill ${isActive ? "active" : ""}`}
                onClick={() => setActiveTabId(tab.id)}
                title={tab.url ? `${tab.title}\n${tab.url}` : tab.title}
              >
                <span className="diff-tab-icon">{tab.icon}</span>
                <span className="diff-tab-label">{tab.kind === "files" && filePreview ? `${baseNameFsPath(filePreview.path)}${isDirty ? " •" : ""}` : tab.title}</span>
                {badgeCount !== undefined && badgeCount > 0 && (
                  <span className="badge-pill">{badgeCount}</span>
                )}
                {tab.closable && (
                  <span
                    className="diff-tab-close"
                    title="关闭标签页"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseTab(tab.id);
                    }}
                  >
                    <XIcon size={11} />
                  </span>
                )}
              </button>
            );
          })}

          <button
            type="button"
            className="diff-tab-add-btn"
            title="新标签页"
            onClick={handleAddNewTab}
          >
            <PlusIcon size={14} />
          </button>
        </div>

        <div className="diff-drawer-actions">
          {(activeKind === "files" || activeKind === "changes") && <button type="button" className="icon-btn"
            title="切换文件树" aria-label="切换文件树" aria-pressed={fileTreeWidth > 0}
            onClick={() => setFileTreeWidth(value => value > 0 ? 0 : 250)}>
            <FolderIcon size={14} />
          </button>}
          <button
            type="button"
            className={`icon-btn ${isFullWidth ? "active" : ""}`}
            onClick={() => setIsFullWidth((v) => !v)}
            title={isFullWidth ? "退出全屏工作台" : "全屏工作台 (⛶)"}
          >
            <FullscreenIcon size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            title="收起右侧工作台 ([|])"
          >
            <SplitViewIcon size={15} />
          </button>
        </div>
      </div>

      {gitToast && <div className="workbench-toast-banner">{gitToast}</div>}

      {/* TAB: NEW TAB / WORKSPACE TOOLS */}
      {activeKind === "newTab" && (
        <NewTabPage
          onOpenChanges={() => setActiveTabId("changes")}
          onOpenTerminal={() => onOpenTerminal?.()}
          onOpenFiles={() => setActiveTabId("files")}
          onOpenSideChat={handleOpenSideChatTab}
          onNavigateUrl={handleNavigateUrl}
          onClose={() => handleCloseTab(activeTabId)}
          onNotify={showToast}
          recentTabs={recentBrowserTabs}
          onSelectRecent={setActiveTabId}
        />
      )}

      {/* TAB: SIDE CHAT */}
      {activeKind === "sideChat" && (
        <SideChatPanel
          initialPrompt={initialSidePrompt}
          workspacePath={cwd}
          onClose={() => handleCloseTab(activeTabId)}
          onFocusMainChat={onFocusMainChat}
          onInsertToMainChat={onInsertToMainChat}
        />
      )}

      {/* TAB: IN-APP BROWSER */}
      {activeKind === "browser" && activeTabObj?.url && (
        <div className="in-app-browser-container">
          <BrowserToolbar
            currentUrl={activeTabObj.url}
            canGoBack={canBrowserGoBack}
            canGoForward={canBrowserGoForward}
            onBack={() => navigateBrowserHistory(-1)}
            onForward={() => navigateBrowserHistory(1)}
            onReload={handleReloadBrowser}
            onNavigate={handleNavigateUrl}
            onClose={() => handleCloseTab(activeTabId)}
            onNotify={showToast}
          />
          <div className="in-app-browser-frame-wrap">
            <iframe
              key={`${activeTabObj.id}:${activeTabObj.url}:${browserReloadTokens[activeTabObj.id] || 0}`}
              src={activeTabObj.url}
              title={activeTabObj.title}
              className="in-app-browser-iframe"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            />
          </div>
        </div>
      )}

      {/* TAB 1: CHANGES & CODE REVIEW */}
      {activeKind === "changes" ? (
        <div className="diff-drawer-body">
          {/* Top Review Mode & Layout Toolbar */}
          <div className="diff-mode-bar">
            <button
              type="button"
              className={`seg-btn ${diffMode === "lastTurn" ? "active" : ""}`}
              onClick={() => setDiffMode("lastTurn")}
              title="查看最近一轮对话产生的文件改动 (Last turn)"
            >
              本轮改动
            </button>
            {!lastTurnOnly && <>
            <button
              type="button"
              className={`seg-btn ${diffMode === "working" ? "active" : ""}`}
              onClick={() => setDiffMode("working")}
            >
              未提交
            </button>
            <button
              type="button"
              className={`seg-btn ${diffMode === "unstaged" ? "active" : ""}`}
              onClick={() => setDiffMode("unstaged")}
            >
              未暂存
            </button>
            <button
              type="button"
              className={`seg-btn ${diffMode === "staged" ? "active" : ""}`}
              onClick={() => setDiffMode("staged")}
            >
              已暂存
            </button>
            <button
              type="button"
              className={`seg-btn ${diffMode === "branch" ? "active" : ""}`}
              onClick={() => setDiffMode("branch")}
            >
              分支对比
            </button>
            <button
              type="button"
              className={`seg-btn ${diffMode === "commits" ? "active" : ""}`}
              onClick={() => setDiffMode("commits")}
            >
              提交历史
            </button>

            </>}

            <div className="diff-layout-switch">
              <button
                type="button"
                className={`seg-btn ${diffLayout === "unified" ? "active" : ""}`}
                onClick={() => setDiffLayout("unified")}
                title="统一 Diff 视图"
              >
                统一
              </button>
              <button
                type="button"
                className={`seg-btn ${diffLayout === "split" ? "active" : ""}`}
                onClick={() => setDiffLayout("split")}
                title="左右并排对比视图"
              >
                并排
              </button>
              <button
                type="button"
                className={`seg-btn ${wordWrap ? "active" : ""}`}
                onClick={() => setWordWrap((v) => !v)}
                title="切换代码自动换行 (Toggle word wrap)"
              >
                换行
              </button>
              <button
                type="button"
                className="seg-btn"
                onClick={handleCopyGitApply}
                title="复制 git apply 命令到剪贴板"
              >
                git apply
              </button>
              <button
                type="button"
                className="seg-btn"
                onClick={handleCopyRawPatch}
                title="复制原始 Patch 补丁文本"
              >
                复制 Patch
              </button>
              {!lastTurnOnly && (
              <button
                type="button"
                className="seg-btn"
                onClick={() => {
                  onRefreshGit();
                  showToast("已刷新 Git 状态");
                }}
                title="刷新 Git 变更状态"
              >
                <RefreshIcon size={11} />
              </button>
              )}
            </div>
          </div>

          {diffMode === "branch" && (
            <div className="diff-branch-filter-row">
              <span className="muted-text">基准分支:</span>
              <select
                className="branch-input-mini"
                value={baseBranch || "main"}
                onChange={(e) => setBaseBranch(e.target.value)}
              >
                {branches.length > 0 ? (
                  branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="main">main</option>
                    <option value="master">master</option>
                  </>
                )}
              </select>
            </div>
          )}

          {/* Scrollable Main Area */}
          <div className="diff-content-scroll-area workspace-review-body">
            {diffMode === "lastTurn" ? (
              <pre className="diff-code-content" style={{ whiteSpace: wordWrap ? "pre-wrap" : "pre", padding: 16 }}>{loadingDiff ? "读取中…" : diffContent}</pre>
            ) : diffMode === "commits" ? (
              <div className="diff-file-list" style={{ maxHeight: "none", borderBottom: "none" }}>
                <div className="diff-file-list-header">
                  <span>最近提交 ({commits.length})</span>
                </div>
                <div className="diff-file-items">
                  {commits.length === 0 ? (
                    <div className="empty-hint-small">暂无提交记录</div>
                  ) : (
                    commits.map((c) => (
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
                        <span className="muted-text" style={{ fontSize: "calc(11px * var(--font-ui-scale, 1))" }}>
                          {c.relativeTime}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : displayedEntries.length === 0 && modelReviewComments.length === 0 ? (
              /* Official Codex App 1:1 Empty State Card */
              <div className="diff-empty-state-card">
                <div className="diff-empty-icon-circle">
                  <CheckIcon size={24} />
                </div>
                <div className="diff-empty-title">
                  {diffMode === "staged"
                    ? "没有已暂存的更改"
                    : diffMode === "unstaged"
                    ? "无未暂存更改"
                    : diffMode === "working"
                    ? "工作树干净，没有未提交更改"
                    : "当前无文件差异"}
                </div>
                <div className="diff-empty-desc">
                  {diffMode === "staged"
                    ? "在更改列表中点击暂存按钮，将修改纳入提交范围"
                    : diffMode === "unstaged"
                    ? "代码更改将在此处显示"
                    : diffMode === "working"
                    ? "项目工作区当前没有变动，修改文件后将自动显示在这里"
                    : "此分支与基准分支内容一致"}
                </div>
              </div>
            ) : (
              <>
                {fileTreeWidth > 0 && <WorkspaceFileTree width={fileTreeWidth} onResize={setFileTreeWidth}>
<div className="diff-file-list">
                  <div className="diff-file-list-header">
                    <span>
                      已更改的文件 ({displayedEntries.length})
                      {visibleDiffStats && (
                        <span className="diff-stat-inline">
                          <span className="diff-add">+{visibleDiffStats.additions}</span>{" "}
                          <span className="diff-del">-{visibleDiffStats.deletions}</span>
                        </span>
                      )}
                    </span>
                    <div className="diff-file-bulk-actions">
                      <button
                        type="button"
                        className="mini-link-btn"
                        onClick={() => setSelectedFile(null)}
                      >
                        所有更改
                      </button>
                      <button
                        type="button"
                        className="mini-link-btn"
                        onClick={() => handleStage()}
                        disabled={gitWriteBusy || !gitStatus?.entries.some(entry => entry.unstaged || entry.untracked)}
                      >
                        全暂存
                      </button>
                      <button
                        type="button"
                        className="mini-link-btn"
                        onClick={() => handleUnstage()}
                        disabled={gitWriteBusy || !gitStatus?.entries.some(entry => entry.staged)}
                      >
                        全取消
                      </button>
                      <button
                        type="button"
                        className="mini-link-btn danger"
                        onClick={handleDiscardAll}
                        title="放弃工作区中全部未提交的修改"
                      >
                        全放弃
                      </button>
                    </div>
                  </div>

                  <div className="diff-file-items">
                    {displayedEntries.map((entry) => {
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
                              type="button"
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
                            {(entry.unstaged || entry.untracked) && (
                              <button
                                type="button"
                                className="mini-action-btn"
                                onClick={() => handleStage(entry.path)}
                                disabled={gitWriteBusy}
                                title="暂存文件"
                              >
                                <PlusIcon size={12} />
                              </button>
                            )}
                            {entry.staged && (
                              <button
                                type="button"
                                className="mini-action-btn"
                                onClick={() => handleUnstage(entry.path)}
                                disabled={gitWriteBusy}
                                title="取消暂存"
                              >
                                -
                              </button>
                            )}
                            <button
                              type="button"
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
                </WorkspaceFileTree>}

                {/* Diff Code Viewer (Unified or Split + Inline Line Comments) */}
                <div className="diff-code-container">
                  {unanchoredFindings.length > 0 && <section className="diff-unanchored-findings" aria-label="未定位到当前差异行的审查发现">
                    {unanchoredFindings.map(comment => <div key={comment.id}>
                      <ModelFinding comment={comment} />
                      <span className="diff-model-finding-location">{reviewPathKey(comment.rootPath) !== reviewPathKey(cwd) ? "该发现属于另一工作区" : loadingDiff ? "正在读取差异" : "该文件或行范围不在当前差异中"}</span>
                      <button type="button" className="mini-link-btn" disabled={reviewPathKey(comment.rootPath) !== reviewPathKey(cwd)} onClick={() => openFinding(comment)}>查看文件</button>
                    </div>)}
                  </section>}
                  {loadingDiff ? (
                    <div className="empty-hint-small">正在加载 Diff...</div>
                  ) : !diffContent.trim() ? (
                    <div className="empty-hint-small">选择文件以查看详细差异</div>
                  ) : diffLayout === "split" ? (
                    <div className={`diff-split-grid ${wordWrap ? "diff-word-wrap" : ""}`}>
                      {["旧版本 (Original)", "新版本 (Modified)"].map((title, side) => (
                        <div key={title} className="diff-split-col" style={{ gridColumn: side + 1, gridRow: `1 / span ${splitRows.length + 1}` }}>
                          <div className="diff-split-col-header">{title}</div>
                          {splitRows.map((row, rowIndex) => {
                            const lineIndex = row[side];
                            const line = lineIndex === null ? undefined : parsedLines[lineIndex];
                            return (
                              <div key={rowIndex} className="diff-split-cell" aria-hidden={line ? undefined : true}>
                                {line && (
                                  <div className={`diff-line diff-line-${line.type}`}>
                                    <span className="diff-ln">{(side === 0 ? line.oldLine : line.newLine) ?? ""}</span>
                                    <span className="diff-tx">{line.raw || " "}</span>
                                  </div>
                                )}
                                {line && side === 1 && renderLineFindings(line)}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={`diff-pre ${wordWrap ? "diff-word-wrap" : ""}`}>
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
                          {renderLineFindings(line)}
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
                                type="button"
                                className="primary-btn compact"
                                onClick={() => {
                                  if (!commentText.trim()) return;
                                  const targetLabel = line.file || "当前变更";
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
              </>
            )}
          </div>

          {/* Docked Commit & Push Section at the Bottom */}
          {((!lastTurnOnly && diffMode !== "commits") || shortcutGitCwd === cwd) && (
            <div className="diff-commit-dock">
              {showPrModal && (
                <div className="diff-pr-panel">
                  <div className="diff-pr-panel-header">
                    <strong>创建 GitHub Pull Request</strong>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setShowPrModal(false)}
                    >
                      <XIcon size={12} />
                    </button>
                  </div>
                  <input
                    className="commit-input"
                    ref={prTitleInputRef}
                    placeholder="PR 标题..."
                    value={prTitle}
                    onChange={(e) => { prDraftRef.current.title = e.target.value; setPrTitle(e.target.value); }}
                  />
                  <textarea
                    className="commit-input"
                    rows={3}
                    placeholder="PR 描述与变更摘要..."
                    value={prBody}
                    onChange={(e) => { prDraftRef.current.body = e.target.value; setPrBody(e.target.value); }}
                    style={{ height: "auto" }}
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
                    <button type="button" className="secondary-btn compact" disabled={gitWriteBusy || (!!prTitle.trim() && !!prBody.trim())} onClick={handleGeneratePrMessage}>生成标题与描述</button>
                    {generationKind === "pull_request" && <button type="button" className="secondary-btn compact" onClick={cancelGeneration}>取消生成</button>}
                    <button
                      type="button"
                      className="primary-btn compact"
                      disabled={gitWriteBusy}
                      onClick={handleCreatePr}
                    >
                      {creatingPr ? "创建中..." : "创建 PR"}
                    </button>
                  </div>
                </div>
              )}

              <div className="diff-commit-box">
                <input
                  className="commit-input"
                  ref={commitInputRef}
                  placeholder="输入 Git 提交说明 (留空自动生成)..."
                  value={commitMessage}
                  onChange={(e) => { commitDraftRef.current = e.target.value; setCommitMessage(e.target.value); }}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      handleCommit();
                    }
                  }}
                />
                <button
                  type="button"
                  className="secondary-btn compact"
                  onClick={handleGenerateCommitMessage}
                  disabled={gitWriteBusy}
                  title="根据真实 Git 改动和提交指令生成提交说明"
                >
                  <SparklesIcon size={12} />
                  <span>{generationKind === "commit" ? "生成中…" : "生成"}</span>
                </button>
                {generationKind === "commit" && <button type="button" className="secondary-btn compact" onClick={cancelGeneration}>取消生成</button>}
                <button
                  type="button"
                  className="primary-btn compact"
                  disabled={gitWriteBusy || (!commitMessage.trim() && displayedEntries.length === 0)}
                  onClick={handleCommit}
                  title="git commit 提交更改"
                >
                  <CheckIcon size={13} />
                  <span>{committing ? "提交中" : "提交"}</span>
                </button>
                <button
                  type="button"
                  className="secondary-btn compact"
                  disabled={gitWriteBusy || (!commitMessage.trim() && displayedEntries.length === 0)}
                  onClick={handleCommitAndPush}
                  title="提交并推送到远程分支 (Commit and push)"
                >
                  <span>提交并推送 ↑</span>
                </button>
                <button
                  type="button"
                  className="secondary-btn compact"
                  disabled={gitWriteBusy}
                  onClick={handlePush}
                  title="git push 推送到远端分支"
                >
                  <span>{pushing ? "推送中..." : "推送"}</span>
                </button>
                <button
                  type="button"
                  className="secondary-btn compact"
                  onClick={() => setShowPrModal((v) => !v)}
                  title="使用 GitHub CLI 创建 Pull Request"
                >
                  <span>PR</span>
                </button>
              </div>

              <div className="diff-git-subbar">
                <label className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={gitPreferences["git-always-force-push"] || forceWithLease}
                    disabled={gitPreferences["git-always-force-push"]}
                    onChange={(e) => setForceWithLease(e.target.checked)}
                  />
                  <span>--force-with-lease</span>
                </label>
                {diffLayout === "unified" && <span className="muted-text" style={{ marginLeft: "auto", fontSize: "calc(11px * var(--font-ui-scale, 1))" }}>
                  点击任意 Diff 行可向 Codex 发送行级评审
                </span>}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* TAB 2: FILES & EDITOR */}
      {activeKind === "files" ? (
        <div className="diff-drawer-body workspace-files-body">
          {fileTreeWidth > 0 && <WorkspaceFileTree width={fileTreeWidth} onResize={setFileTreeWidth}>
          <div className="file-browser-path-bar">
            {fileTreeRoots.length > 1 && <select className="workspace-tree-root" aria-label="选择文件树根目录" title={currentDir} value={currentDir}
              onChange={event => { ++dirLoadSeqRef.current; setDirEntries([]); setDirError(null); setFileSearchHits([]); setExplorerDraft(null); setCurrentDir(event.target.value); }}>
              {fileTreeRoots.map(root => <option key={root} value={root} title={root}>{baseNameFsPath(root) || root}</option>)}
            </select>}
            <span className="file-browser-cwd" title={currentDir}>
              {currentDir}
            </span>
            <div className="fe-path-actions">
              {watchActive && (
                <span
                  className="fe-live-dot"
                  title="已通过 fs/watch 监听当前目录，文件变化会自动刷新"
                >
                  ●
                </span>
              )}
              <button
                className="fe-icon-btn"
                title="刷新当前目录"
                disabled={dirLoading}
                onClick={() => void refreshDirectory(currentDir)}
              >
                <RefreshIcon size={12} />
              </button>
              {currentDir !== cwd && (
                <button
                  className="mini-link-btn"
                  onClick={() => {
                    setCurrentDir(cwd);
                  }}
                >
                  返回聊天根目录
                </button>
              )}
            </div>
          </div>

          <details className="workspace-file-actions"><summary>文件操作</summary>
          <div className="fe-toolbar">
            <button
              className="fe-toolbar-btn"
              title="在当前目录新建文件"
              disabled={explorerBusy}
              onClick={() => beginCreateDraft("createFile")}
            >
              <PlusIcon size={12} />
              <span>新建文件</span>
            </button>
            <button
              className="fe-toolbar-btn"
              title="在当前目录新建文件夹"
              disabled={explorerBusy}
              onClick={() => beginCreateDraft("createDir")}
            >
              <FolderIcon size={12} />
              <span>新建文件夹</span>
            </button>
            <button
              className="fe-toolbar-btn"
              title="复制当前目录绝对路径"
              onClick={() => void handleCopyPath(currentDir)}
            >
              <CopyIcon size={12} />
              <span>复制路径</span>
            </button>
            {dirLoading && <span className="fe-toolbar-hint">加载中…</span>}
            {explorerBusy && <span className="fe-toolbar-hint">处理中…</span>}
          </div>

          </details>

          {explorerDraft && (
            <form className="fe-inline-form" onSubmit={submitExplorerDraft}>
              <span className="fe-inline-label" title={explorerDraftLabel}>
                {explorerDraftLabel}
              </span>
              <input
                className="fe-inline-input"
                autoFocus
                placeholder={
                  explorerDraft.mode === "rename" ? "新名称" : "名称"
                }
                value={explorerDraft.value}
                disabled={explorerBusy}
                onChange={(event) =>
                  setExplorerDraft((prev) =>
                    prev ? { ...prev, value: event.target.value } : prev
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelExplorerDraft();
                  }
                }}
              />
              <button
                type="submit"
                className="fe-toolbar-btn primary"
                disabled={explorerBusy || !explorerDraft.value.trim()}
              >
                {explorerDraft.mode === "rename" ? "重命名" : "创建"}
              </button>
              <button
                type="button"
                className="fe-toolbar-btn"
                disabled={explorerBusy}
                onClick={cancelExplorerDraft}
              >
                取消
              </button>
            </form>
          )}

          <div className="diff-branch-filter-row">
            <SearchIcon size={13} />
            <input
              className="branch-input-mini"
              placeholder="筛选文件…"
              value={fileFilterQuery}
              onChange={(e) => setFileFilterQuery(e.target.value)}
            />
          </div>

          <details className="workspace-all-files" open><summary>所有文件</summary>
          <div className="file-browser-list" role="tree" aria-label="所有文件">
            {fileFilterQuery.trim() ? (
              fileSearchLoading ? <div className="workspace-tree-status" role="status">正在筛选文件…</div> :
              fileSearchError ? <div className="workspace-tree-status" role="alert" title={fileSearchError}>无法筛选文件，请更改筛选条件后重试。</div> :
              fileSearchHits.length === 0 ? <div className="workspace-tree-status">未找到文件</div> : fileSearchHits.map((hit) => (
                <div
                  key={hit.absPath}
                  className={`diff-file-row ${
                    selectedTreePath === hit.absPath ? "active" : ""
                  }`}
                  role="button" tabIndex={0} aria-label={hit.relPath}
                  onClick={() => setSelectedTreePath(hit.absPath)}
                  onDoubleClick={() => void openFilePreview(hit.absPath)}
                  onKeyDown={event => { if (event.key === "Enter") void openFilePreview(hit.absPath); }}
                >
                  <span className="file-icon-tag">📄</span>
                  <span className="diff-file-path">{hit.relPath}</span>
                </div>
              ))
            ) : dirError ? (
              <div className="empty-hint-small fe-dir-error">
                <span>⚠️ 目录无法访问或已失效</span>
                {cwd && currentDir !== cwd && (
                  <button
                    type="button"
                    className="ghost-btn compact"
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      setDirError(null);
                      setCurrentDir(cwd);
                    }}
                  >
                    返回工作区根目录
                  </button>
                )}
              </div>
            ) : dirEntries.length === 0 ? (
              <div className="empty-hint-small">
                {dirLoading ? "正在加载目录…" : "目录为空"}
              </div>
            ) : (
              dirEntries.map(item => <WorkspaceDirectoryEntry key={`${connectionIdentity}:${currentDir}:${item.path}`} item={item} depth={0} refreshToken={dirEntries} renderRow={renderFileTreeEntry}
                reveal={directoryReveal?.cwd === cwd && currentDir === (directoryReveal.root ?? cwd) ? directoryReveal : undefined} />)
            )}
          </div>

          </details>
          </WorkspaceFileTree>}
          {!filePreview && <div className="workspace-file-empty">从文件树选择文件，双击打开</div>}
          {filePreview && (
            <div className="file-editor-pane" ref={filePreviewPaneRef} tabIndex={-1}>
              <div className="file-editor-header">
                <span className="file-editor-title" title={filePreview.path}>
                  {filePreview.path.split(/[\\/]/).pop()}
                  {isDirty ? " •" : ""}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                  <input
                    className="in-file-search-input"
                    placeholder="查找内容..."
                    value={inFileSearch}
                    onChange={(e) => setInFileSearch(e.target.value)}
                  />
                  {inFileSearch.trim() && (
                    <span style={{ fontSize: "calc(11px * var(--font-ui-scale, 1))", color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>
                      {
                        editedContent
                          .toLowerCase()
                          .split(inFileSearch.toLowerCase()).length - 1
                      }{" "}
                      处匹配
                    </span>
                  )}
                </div>
                {!filePreview.isBinary && !filePreview.isImage && (
                  <button
                    className="primary-btn compact"
                    disabled={!isDirty || savingFile}
                    onClick={saveEditedFile}
                  >
                    {savingFile ? "保存中..." : isDirty ? "保存修改" : "已保存"}
                  </button>
                )}
                <button
                  type="button"
                  className="diff-tab-close"
                  title="关闭预览"
                  style={{ marginLeft: 4 }}
                  onClick={() => { void closeFilePreview(); }}
                >
                  <CloseIcon size={12} />
                </button>
              </div>
              {filePreview.isImage && filePreview.base64DataUrl ? (
                <div className="file-image-preview">
                  <img src={filePreview.base64DataUrl} alt="preview" />
                </div>
              ) : filePreview.isBinary ? (
                <div className="empty-hint-small">二进制文件无法直接编辑</div>
              ) : (
                <>
                {visibleReviewFinding && reviewPathKey(filePreview.path) === reviewPathKey(visibleReviewFinding.absolutePath) && <div>
                  <ModelFinding comment={visibleReviewFinding} />
                  {!reviewSelectionRange(filePreview.content ?? "", visibleReviewFinding.startLine, visibleReviewFinding.endLine) && <div className="diff-model-finding-location" role="status">发现所指行范围超出当前文件，未定位到该行</div>}
                </div>}
                <textarea
                  ref={fileEditorRef}
                  className="file-editor-textarea"
                  value={editedContent}
                  onChange={(e) => {
                    ++editRevisionRef.current;
                    isDirtyRef.current = true;
                    editedContentRef.current = e.target.value;
                    setEditedContent(e.target.value);
                    setIsDirty(true);
                  }}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                      e.preventDefault();
                      if (isDirty && !savingFile) {
                        void saveEditedFile();
                      }
                    } else if (e.key === "Tab") {
                      e.preventDefault();
                      const target = e.currentTarget;
                      const start = target.selectionStart;
                      const end = target.selectionEnd;
                      const val = target.value;
                      const next = val.substring(0, start) + "  " + val.substring(end);
                      ++editRevisionRef.current;
                      isDirtyRef.current = true;
                      editedContentRef.current = next;
                      setEditedContent(next);
                      setIsDirty(true);
                      window.requestAnimationFrame(() => {
                        target.selectionStart = target.selectionEnd = start + 2;
                      });
                    }
                  }}
                  spellCheck={false}
                />
                </>
              )}
            </div>
          )}
        </div>
      ) : null}

      {/* TAB 3: SUMMARY & ARTIFACTS */}
      {activeKind === "summary" ? (
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
      {discardConfirmation && <FileDiscardDialog onDecision={discard => {
        const resolve = discardResolverRef.current;
        discardResolverRef.current = null;
        setDiscardConfirmation(false);
        resolve?.(discard);
      }} />}
    </aside>
  );
};

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tauriListen } from "../bridge";
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
  CopyIcon,
  DiffIcon,
  DownloadIcon,
  EllipsisIcon,
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
  cwd: string;
  gitStatus: GitStatusInfo | null;
  branches?: string[];
  turns?: TurnData[];
  onRefreshGit: () => void;
  onClose: () => void;
  selectedPreviewFile?: string | null;
  onSelectPreviewFile?: (file: string | null) => void;
  onSendReviewComment?: (commentPrompt: string) => void;
  initialTab?: "newTab" | "changes" | "files" | "summary" | "browser" | "sideChat";
  initialSidePrompt?: string;
  onOpenTerminal?: () => void;
  onOpenSideChat?: () => void;
  onFocusMainChat?: () => void;
  onInsertToMainChat?: (content: string) => void;
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

/**
 * Mirror the legacy `fs_list_dir(showHidden=false)` filtering so switching to
 * `fs/readDirectory` (which returns every entry) does not change what is shown.
 */
function isHiddenEntryName(name: string): boolean {
  if (name === "node_modules" || name === "target" || name === ".git") return true;
  if (name.startsWith(".") && name !== ".env" && name !== ".gitignore") return true;
  return false;
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
    .filter((entry) => !isHiddenEntryName(entry.fileName))
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

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }
}

export const DiffDrawer: React.FC<DiffDrawerProps> = ({
  open = true,
  cwd,
  gitStatus,
  branches = [],
  turns = [],
  onRefreshGit,
  onClose,
  selectedPreviewFile,
  onSelectPreviewFile,
  onSendReviewComment,
  initialTab = "changes",
  initialSidePrompt,
  onOpenTerminal,
  onOpenSideChat,
  onFocusMainChat,
  onInsertToMainChat,
}) => {
  const [isFullWidth, setIsFullWidth] = useState(false);
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
  const [dirLoading, setDirLoading] = useState(false);
  const [watchActive, setWatchActive] = useState(false);
  const [explorerDraft, setExplorerDraft] = useState<ExplorerDraft | null>(null);
  const [explorerBusy, setExplorerBusy] = useState(false);
  const dirLoadSeqRef = useRef(0);

  const displayedEntries = useMemo(() => {
    const list = gitStatus?.entries || [];
    if (diffMode === "staged") {
      return list.filter((e) => e.staged);
    }
    return list;
  }, [gitStatus, diffMode]);
  const fsWatchTimerRef = useRef<number | null>(null);
  const lastExternalPreviewRef = useRef<string | null>(null);
  const appServerConnectedRef = useRef<boolean | null>(null);
  const [watchEpoch, setWatchEpoch] = useState(0);

  useEffect(() => {
    if (cwd) {
      setCurrentDir(cwd);
      setExplorerDraft(null);
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
      showHidden: false,
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
    } catch (listingError) {
      console.warn("directory listing failed:", listingError);
      if (seq !== dirLoadSeqRef.current) return;
      setDirEntries([]);
    } finally {
      if (seq === dirLoadSeqRef.current) setDirLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || activeTab !== "files" || !currentDir) return;
    void refreshDirectory(currentDir);
  }, [open, activeTab, currentDir, refreshDirectory]);

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

    fsWatchPath(currentDir, () => {
      if (disposed) return;
      if (fsWatchTimerRef.current !== null) {
        window.clearTimeout(fsWatchTimerRef.current);
      }
      fsWatchTimerRef.current = window.setTimeout(() => {
        fsWatchTimerRef.current = null;
        if (!disposed) void refreshDirectory(currentDir);
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
  }, [open, activeTab, currentDir, refreshDirectory, watchEpoch]);

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

  /**
   * Preview a file: `fs/readFile` (UTF-8) first; images / binary / oversized
   * files and protocol failures fall back to the legacy `fs_read_preview`.
   */
  const openFilePreview = async (
    path: string,
    options?: { silent?: boolean }
  ) => {
    try {
      const preview = await readTextPreviewViaProtocol(path);
      setFilePreview(preview);
      setEditedContent(preview.content ?? "");
      setIsDirty(false);
      return;
    } catch (protocolError) {
      if (!isPreviewFallbackError(protocolError)) {
        console.warn(
          "fs/readFile unavailable for preview, falling back to fs_read_preview:",
          protocolError
        );
      }
    }
    try {
      const res = await invoke<FilePreviewResult>("fs_read_preview", {
        path,
        maxBytes: MAX_TEXT_PREVIEW_BYTES,
      });
      setFilePreview(res);
      setEditedContent(res.content ?? "");
      setIsDirty(false);
    } catch (e) {
      if (!options?.silent) showToast(`读取文件失败: ${String(e)}`);
    }
  };

  const saveEditedFile = async () => {
    if (!filePreview) return;
    setSavingFile(true);
    const targetPath = filePreview.path;
    const content = editedContent;
    try {
      try {
        await fsWriteFileText(targetPath, content);
      } catch (protocolError) {
        console.warn(
          "fs/writeFile unavailable, falling back to fs_write_file:",
          protocolError
        );
        await invoke("fs_write_file", { path: targetPath, content });
      }
      setIsDirty(false);
      onRefreshGit();
      void refreshDirectory(currentDir);
      showToast("✓ 文件已保存");
    } catch (e) {
      showToast(`保存文件失败: ${String(e)}`);
    } finally {
      setSavingFile(false);
    }
  };

  // External file selection (timeline cards / @mentions / quick search): keep
  // the Changes tab behavior untouched, but warm up the Files tab preview.
  useEffect(() => {
    if (!open || !selectedPreviewFile) {
      if (!selectedPreviewFile) lastExternalPreviewRef.current = null;
      return;
    }
    if (lastExternalPreviewRef.current === selectedPreviewFile) return;
    if (filePreview?.path === selectedPreviewFile) {
      lastExternalPreviewRef.current = selectedPreviewFile;
      return;
    }
    // Never replace an open editor that has unsaved changes.
    if (isDirty) return;
    lastExternalPreviewRef.current = selectedPreviewFile;
    void openFilePreview(selectedPreviewFile, { silent: true });
  }, [open, selectedPreviewFile, filePreview?.path, isDirty]);

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
                <span className="diff-tab-label">{tab.title}</span>
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
          <button
            type="button"
            className="icon-btn"
            onClick={onRefreshGit}
            title="刷新工作区与 Git 状态"
          >
            <RefreshIcon size={14} />
          </button>
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
              className={`seg-btn ${diffMode === "working" ? "active" : ""}`}
              onClick={() => setDiffMode("working")}
            >
              未提交
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
          <div className="diff-content-scroll-area">
            {diffMode === "commits" ? (
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
                        <span className="muted-text" style={{ fontSize: 11 }}>
                          {c.relativeTime}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : displayedEntries.length === 0 ? (
              /* Official Codex App 1:1 Empty State Card */
              <div className="diff-empty-state-card">
                <div className="diff-empty-icon-circle">
                  <CheckIcon size={24} />
                </div>
                <div className="diff-empty-title">
                  {diffMode === "staged"
                    ? "没有已暂存的更改"
                    : diffMode === "working"
                    ? "工作树干净，没有未提交更改"
                    : "当前无文件差异"}
                </div>
                <div className="diff-empty-desc">
                  {diffMode === "staged"
                    ? "在更改列表中点击暂存按钮，将修改纳入提交范围"
                    : diffMode === "working"
                    ? "项目工作区当前没有变动，修改文件后将自动显示在这里"
                    : "此分支与基准分支内容一致"}
                </div>
              </div>
            ) : (
              <>
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
                      <button
                        type="button"
                        className="mini-link-btn"
                        onClick={() => setSelectedFile(null)}
                      >
                        全部
                      </button>
                      <button
                        type="button"
                        className="mini-link-btn"
                        onClick={() => handleStage()}
                      >
                        全暂存
                      </button>
                      <button
                        type="button"
                        className="mini-link-btn"
                        onClick={() => handleUnstage()}
                      >
                        全取消
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
                            {!entry.staged ? (
                              <button
                                type="button"
                                className="mini-action-btn"
                                onClick={() => handleStage(entry.path)}
                                title="暂存文件"
                              >
                                <PlusIcon size={12} />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="mini-action-btn"
                                onClick={() => handleUnstage(entry.path)}
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

                {/* Diff Code Viewer (Unified or Split + Inline Line Comments) */}
                <div className="diff-code-container">
                  {loadingDiff ? (
                    <div className="empty-hint-small">正在加载 Diff...</div>
                  ) : !diffContent.trim() ? (
                    <div className="empty-hint-small">选择文件以查看详细差异</div>
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
                                type="button"
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
              </>
            )}
          </div>

          {/* Docked Commit & Push Section at the Bottom */}
          {diffMode !== "commits" && (
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
                    <button
                      type="button"
                      className="primary-btn compact"
                      disabled={creatingPr || !prTitle.trim()}
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
                  placeholder="输入 Git 提交说明 (留空自动生成)..."
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      handleCommit();
                    }
                  }}
                />
                <button
                  type="button"
                  className="primary-btn compact"
                  disabled={committing || (!commitMessage.trim() && displayedEntries.length === 0)}
                  onClick={handleCommit}
                  title="git commit 提交更改"
                >
                  <CheckIcon size={13} />
                  <span>{committing ? "提交中" : "提交"}</span>
                </button>
                <button
                  type="button"
                  className="secondary-btn compact"
                  disabled={pushing}
                  onClick={handlePush}
                  title="git push 推送到远端分支"
                >
                  <span>{pushing ? "推送中..." : "推送 ↑"}</span>
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
                    checked={forceWithLease}
                    onChange={(e) => setForceWithLease(e.target.checked)}
                  />
                  <span>--force-with-lease</span>
                </label>
                <span className="muted-text" style={{ marginLeft: "auto", fontSize: 11 }}>
                  点击任意 Diff 行可向 Codex 发送行级评审
                </span>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* TAB 2: FILES & EDITOR */}
      {activeKind === "files" ? (
        <div className="diff-drawer-body">
          <div className="file-browser-path-bar">
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
                    const parent = parentFsPath(currentDir);
                    if (parent && parent !== currentDir) setCurrentDir(parent);
                  }}
                >
                  返回上级
                </button>
              )}
            </div>
          </div>

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
                  onClick={() => void openFilePreview(hit.absPath)}
                >
                  <span className="file-icon-tag">📄</span>
                  <span className="diff-file-path">{hit.relPath}</span>
                </div>
              ))
            ) : dirEntries.length === 0 ? (
              <div className="empty-hint-small">
                {dirLoading ? "正在加载目录…" : "目录为空"}
              </div>
            ) : (
              dirEntries.map((item) => {
                const isRenaming =
                  explorerDraft?.mode === "rename" &&
                  explorerDraft.targetPath === item.path;
                return (
                  <div
                    key={item.path}
                    className={`diff-file-row fe-file-row ${
                      filePreview?.path === item.path ? "active" : ""
                    } ${isRenaming ? "fe-renaming" : ""}`}
                    onClick={() => {
                      if (item.isDirectory) {
                        setExplorerDraft(null);
                        setCurrentDir(item.path);
                      } else {
                        void openFilePreview(item.path);
                      }
                    }}
                  >
                    <span className="file-icon-tag">
                      {item.isDirectory ? "📁" : "📄"}
                    </span>
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
              })
            )}
          </div>

          {filePreview && (
            <div className="file-editor-pane">
              <div className="file-editor-header">
                <span className="file-editor-title" title={filePreview.path}>
                  {filePreview.path.split(/[\\/]/).pop()}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                  <input
                    className="in-file-search-input"
                    placeholder="查找内容..."
                    value={inFileSearch}
                    onChange={(e) => setInFileSearch(e.target.value)}
                  />
                  {inFileSearch.trim() && (
                    <span style={{ fontSize: 11, color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>
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
    </aside>
  );
};

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Command,
  FileText,
  Folder,
  MessageSquare,
  Play,
  Search,
  Settings,
  X,
} from "lucide-react";
import { homeDir, normalize as normalizeFsPath } from "@tauri-apps/api/path";
import { callAppServer, isTauriRuntime, tauriInvoke } from "../bridge";
import { baseNameFsPath, getMetadata, joinFsPath } from "../fsClient";
import { createFuzzyFileSearch } from "../fuzzyFileSearch";
import { MainViewRoute, ProjectScriptCommands, SettingsSectionSlug, SkillInfoItem, ThreadSummary } from "../types";
import { SLASH_COMMANDS } from "../slashCommands";
import { SearchFolderDialog } from "./SearchFolderDialog";
import type { SlashCommand } from "../slashCommands";

export interface QuickSearchModalProps {
  open: boolean;
  mode?: "root" | "chats" | "files";
  initialQuery: { value: string };
  threads: ThreadSummary[];
  skills: SkillInfoItem[];
  projectScripts?: ProjectScriptCommands;
  /**
   * 当前工作区绝对路径（可选）。files 模式下用真实 fuzzy session 搜索。
   */
  workspacePath?: string;
  workspaceRoots?: readonly string[];
  workspaceLabel?: string;
  recentFiles?: readonly RecentFile[];
  onClose: () => void;
  onSelectThread: (threadId: string) => void;
  onSelectFile: (filePath: string, isDirectory?: boolean, chosenRoot?: string) => void;
  onSearchFiles: () => void;
  onSearchChats: () => void;
  onSelectSkill: (skillId: string) => void;
  onNavigateSettings: (slug: SettingsSectionSlug) => void;
  onNavigateRoute: (route: MainViewRoute) => void;
  onStartNewChat: () => void;
  onTriggerCommand: (cmd: string) => void;
  onSelectSlashCommand: (command: SlashCommand) => void;
}

interface SearchResultItem {
  id: string;
  category: "action" | "thread" | "file" | "skill" | "setting";
  section: string;
  title: string;
  subtitle?: string;
  shortcut?: string;
  rightLabel?: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

/* ------------------------------------------------------------------ */
/* 协议搜索结果（app-server）                                          */
/* ------------------------------------------------------------------ */

/** 查询词最短长度：过短的查询走本地过滤，避免协议搜索噪音。 */
const REMOTE_QUERY_MIN_LENGTH = 3;
/** 输入防抖窗口（毫秒）。 */
const REMOTE_DEBOUNCE_MS = 200;
/** 单次协议搜索返回上限（与本地结果数量保持平衡）。 */
const REMOTE_THREAD_LIMIT = 9;
const REMOTE_CHAT_LIMIT = 25;
const REMOTE_THREAD_STALE_MS = 30_000;
/** 查询 -> 结果缓存上限，避免反复输入同一查询词时重复请求。 */
const REMOTE_CACHE_LIMIT = 40;

/** `fuzzyFileSearch` 返回的文件项（实测结构，path 为相对 root 的路径）。 */
interface FuzzyFileSearchHit {
  root?: string;
  path?: string;
  match_type?: string;
  file_name?: string;
  score?: number;
  indices?: number[];
}

/** `thread/search` 返回的 thread 字段（schema: ThreadSearchResult.thread）。 */
interface ThreadSearchThread {
  id?: string;
  name?: string | null;
  preview?: string | null;
  cwd?: string | null;
}

/** `thread/search` 返回项：schema 为 { snippet, thread }，同时兼容扁平的 thread 数组。 */
interface ThreadSearchEntry extends ThreadSearchThread {
  snippet?: string;
  thread?: ThreadSearchThread;
}

interface RemoteFileResult {
  absPath: string;
  relPath: string;
  fileName: string;
}

export interface RecentFile {
  path: string;
  updatedAt: number;
}

interface RemoteThreadResult {
  id: string;
  name?: string | null;
  preview?: string | null;
  cwd?: string | null;
}

interface RemoteSearchResults {
  /** 产生这批结果的查询词（trim 后），用于丢弃与当前输入不匹配的旧结果。 */
  query: string;
  workspacePath?: string;
  fileScope?: string;
  mode: "root" | "chats" | "files";
  files: RemoteFileResult[];
  threads: RemoteThreadResult[];
  nextCursor?: string | null;
}

interface ChatSearchPage {
  threads: RemoteThreadResult[];
  nextCursor: string | null;
}

interface ChatPagination {
  scope: object;
  limit: number;
  threads: RemoteThreadResult[];
  nextCursor?: string | null;
  usedCursors: string[];
  loading: boolean;
}

/** Windows 下协议返回的 path 是相对 root 的路径，绝对路径 = root + "\\" + path。 */
function joinRootPath(root: string, relPath: string): string {
  const cleanRoot = root.replace(/[\\/]+$/, "");
  const cleanRel = relPath.replace(/^[\\/]+/, "");
  if (!cleanRel) return cleanRoot;
  const separator = cleanRoot.includes("\\") ? "\\" : "/";
  return `${cleanRoot}${separator}${cleanRel}`;
}

/** 文件去重键：统一分隔符；Windows 路径大小写不敏感。 */
function fileDedupeKey(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^(?:[a-z]:|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function fileSearchRoot(path: string, roots: readonly string[]): string | undefined {
  const key = fileDedupeKey(path);
  return roots.reduce<string | undefined>((match, root) => {
    const prefix = fileDedupeKey(root);
    return (key === prefix || key.startsWith(`${prefix}/`)) &&
      (match === undefined || prefix.length > fileDedupeKey(match).length) ? root : match;
  }, undefined);
}

export { fileDedupeKey, fileSearchRoot };

async function resolveFileSearchPath(query: string, roots: readonly string[]): Promise<string | null> {
  if (/[\r\n\0]/.test(query) || /^[\\/]{2}[?.][\\/]/.test(query)) return null;
  const fromHome = query === "~" || query.startsWith("~/");
  const path = await normalizeFsPath(fromHome ? joinFsPath(await homeDir(), query.slice(2)) : query);
  if (/^[a-zA-Z]:|^[\\/]{2}/.test(path) && path.split(/[\\/]+/).some(part => /[. ]$/.test(part))) return null;
  return fileSearchRoot(path, await Promise.all(roots.map(root => normalizeFsPath(root)))) !== undefined ? path : null;
}

function normalizeRemoteFileHits(
  raw: unknown,
  roots: readonly string[]
): RemoteFileResult[] {
  if (!Array.isArray(raw)) return [];
  const results: RemoteFileResult[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const hit = entry as FuzzyFileSearchHit;
    const relativePath = typeof hit.path === "string" ? hit.path.trim() : "";
    if (!relativePath || /^[\\/]|^[a-z]:/i.test(relativePath) || relativePath.split(/[\\/]/).includes("..")) continue;
    if (hit.match_type && hit.match_type !== "file") continue;
    if (relativePath.split(/[\\/]+/).some(part => [
      ".git", ".hg", ".next", ".pnpm-store", ".svn", ".turbo", ".yarn",
      "build", "coverage", "dist", "node_modules",
    ].includes(part))) continue;

    const root =
      typeof hit.root === "string" && hit.root.trim()
        ? hit.root.trim()
        : roots.length === 1 ? roots[0] : undefined;
    if (!root || !roots.some(candidate => fileDedupeKey(candidate) === fileDedupeKey(root))) continue;
    const absPath = joinRootPath(root, relativePath);
    const key = fileDedupeKey(absPath);
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      absPath,
      relPath: relativePath,
      fileName:
        typeof hit.file_name === "string" && hit.file_name
          ? hit.file_name
          : relativePath.split(/[\\/]/).pop() || relativePath,
    });
  }

  return results;
}

function normalizeRemoteThreadHits(raw: unknown, limit: number): RemoteThreadResult[] {
  if (!Array.isArray(raw)) return [];
  const results: RemoteThreadResult[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as ThreadSearchEntry;
    const thread: ThreadSearchThread =
      item.thread && typeof item.thread === "object" ? item.thread : item;
    const id = typeof thread.id === "string" ? thread.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);

    results.push({
      id,
      name: typeof thread.name === "string" ? thread.name : null,
      preview: typeof thread.preview === "string" ? thread.preview : null,
      cwd: typeof thread.cwd === "string" ? thread.cwd : null,
    });
    if (results.length >= limit) break;
  }

  return results;
}

/**
 * 调用 `thread/search` 搜索历史会话。
 * 返回结构为 `{ data: [{ snippet, thread }] }`（兼容 `threads` 扁平数组）。
 */
async function searchThreadsProtocol(query: string, limit: number, cursor?: string): Promise<ChatSearchPage | null> {
  try {
    const response = await callAppServer<
      | { data?: ThreadSearchEntry[]; threads?: ThreadSearchEntry[]; nextCursor?: string | null }
      | ThreadSearchEntry[]
    >("thread/search", {
      searchTerm: query,
      limit,
      archived: false,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    if (Array.isArray(response)) return { threads: normalizeRemoteThreadHits(response, limit), nextCursor: null };
    const entries = Array.isArray(response?.data)
      ? response.data
      : Array.isArray(response?.threads)
      ? response.threads
      : [];
    return { threads: normalizeRemoteThreadHits(entries, limit), nextCursor: typeof response?.nextCursor === "string" ? response.nextCursor : null };
  } catch {
    // 静默降级：无 app-server 时继续使用本地 threads 过滤。
    return null;
  }
}

export const QuickSearchModal: React.FC<QuickSearchModalProps> = ({
  open,
  mode = "root",
  initialQuery,
  threads,
  skills,
  projectScripts,
  workspacePath,
  workspaceRoots,
  workspaceLabel,
  recentFiles,
  onClose,
  onSelectThread,
  onSelectFile,
  onSearchFiles,
  onSearchChats,
  onSelectSkill,
  onNavigateSettings,
  onNavigateRoute,
  onStartNewChat,
  onTriggerCommand,
  onSelectSlashCommand,
}) => {
  const [draft, setDraft] = useState({ initialQuery, value: initialQuery.value });
  // A new opening takes effect before the search effects read the query.
  const query = draft.initialQuery === initialQuery ? draft.value : initialQuery.value;
  const setQuery = (value: string) => setDraft({ initialQuery, value });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [remoteResults, setRemoteResults] = useState<RemoteSearchResults | null>(
    null
  );
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [pathRetry, setPathRetry] = useState(0);
  const [recentRetry, setRecentRetry] = useState(0);
  const [selectedFolder, setSelectedFolder] = useState<{ projectScope: string; path: string } | null>(null);
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const trimmedQuery = query.trim();
  const chatSearchScope = useMemo(() => ({}), [open, mode, trimmedQuery, workspacePath, initialQuery]);
  const chatSearchScopeRef = useRef(chatSearchScope);
  chatSearchScopeRef.current = chatSearchScope;
  const chatPageRequest = useRef<object | null>(null);
  const [chatPagination, setChatPagination] = useState<ChatPagination | null>(null);
  const chatPaging = chatPagination?.scope === chatSearchScope ? chatPagination : null;
  const projectScope = JSON.stringify(workspaceRoots?.length ? workspaceRoots : workspacePath ? [workspacePath] : []);
  const projectRoots = useMemo(() => JSON.parse(projectScope) as string[], [projectScope]);
  const chosenFolder = selectedFolder?.projectScope === projectScope ? selectedFolder.path : undefined;
  const folderScope = mode === "files" ? chosenFolder : undefined;
  const fileScope = folderScope ? JSON.stringify([folderScope]) : projectScope;
  const fileRoots = useMemo(() => JSON.parse(fileScope) as string[], [fileScope]);
  const recentRequest = useMemo(() => open && mode === "files" && fileRoots.length > 0 && !trimmedQuery
    ? { roots: fileRoots } : null, [open, mode, fileRoots, trimmedQuery, recentRetry, initialQuery]);
  const [recentResult, setRecentResult] = useState<{ request: NonNullable<typeof recentRequest>; files?: RecentFile[] } | null>(null);
  const [historyResult, setHistoryResult] = useState<{ request: NonNullable<typeof recentRequest>; files: RecentFile[] } | null>(null);
  const recentLookup = recentResult?.request === recentRequest ? recentResult : null;
  const recentHistory = historyResult?.request === recentRequest ? historyResult.files : undefined;
  const pathQuery = mode === "files" && /^(?:~(?:\/|$)|[a-zA-Z]:[\\/]|\/|\\\\)/.test(trimmedQuery)
    ? trimmedQuery : null;
  const pathRequest = useMemo(() => open && fileRoots.length > 0 && pathQuery ? { pathQuery, roots: fileRoots } : null,
    [open, fileRoots, pathQuery, pathRetry, initialQuery]);
  const [pathResult, setPathResult] = useState<{
    request: NonNullable<typeof pathRequest>;
    match?: { path: string; isDirectory: boolean };
    failed?: boolean;
  } | null>(null);
  const pathLookup = pathResult?.request === pathRequest ? pathResult : null;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scopeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const scopeMenuRef = useRef<HTMLDivElement | null>(null);
  const scopeContext = useMemo(() => ({ open, projectScope, initialQuery }), [open, projectScope, initialQuery]);
  const [folderPicker, setFolderPicker] = useState<typeof scopeContext | null>(null);
  const scopeContextRef = useRef(scopeContext);
  scopeContextRef.current = scopeContext;
  const lastActiveElementRef = useRef<HTMLElement | null>(null);
  const fileSearchRef = useRef<ReturnType<typeof createFuzzyFileSearch> | null>(null);
  /** 查询词 -> 协议结果缓存：避免每次渲染/重复输入重复请求 app-server。 */
  const remoteCacheRef = useRef<
    Map<string, ChatSearchPage & { updatedAt: number }>
  >(new Map());

  const runCmd = projectScripts?.runCommand || "npm run dev";
  const testCmd = projectScripts?.testCommand || "npm test";
  const buildCmd = projectScripts?.buildCommand || "npm run build";

  const closeScopeMenu = () => {
    setScopeMenuOpen(false);
    scopeTriggerRef.current?.focus();
  };
  const pickSearchFolder = () => {
    setScopeMenuOpen(false);
    setFolderPicker(scopeContext);
  };
  const finishFolderPicker = (path?: string) => {
    if (scopeContextRef.current !== scopeContext) return;
    setFolderPicker(null);
    if (path) setSelectedFolder({ projectScope, path });
    requestAnimationFrame(() => {
      if (scopeContextRef.current === scopeContext) scopeTriggerRef.current?.focus();
    });
  };

  useEffect(() => { setScopeMenuOpen(false); setFolderPicker(null); }, [scopeContext]);
  useEffect(() => {
    if (scopeMenuOpen) scopeMenuRef.current?.querySelector("button")?.focus();
  }, [scopeMenuOpen]);

  useEffect(() => {
    if (open) {
      lastActiveElementRef.current = document.activeElement as HTMLElement | null;
      setSelectedIndex(0);
      const timer = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(timer);
    } else {
      if (lastActiveElementRef.current && typeof lastActiveElementRef.current.focus === "function") {
        lastActiveElementRef.current.focus();
      }
    }
  }, [open]);

  // 工作区切换后旧缓存不再适用（key 也带 workspacePath，这里主动释放内存）。
  useEffect(() => {
    remoteCacheRef.current.clear();
  }, [workspacePath]);

  useEffect(() => {
    if (!open || mode !== "files" || fileRoots.length === 0 || !isTauriRuntime()) return;
    let disposed = false;
    setRemoteResults(null);
    const search = createFuzzyFileSearch([...fileRoots], {
      onResults(response) {
        if (!disposed) setRemoteResults({
          query: response.query, workspacePath, fileScope, mode: "files",
          files: normalizeRemoteFileHits(response.files, fileRoots), threads: [],
        });
      },
      onLoading(loading) { if (!disposed) setRemoteLoading(loading); },
      onError(error) { console.warn("文件搜索失败", error); },
    });
    fileSearchRef.current = search;
    return () => {
      disposed = true;
      fileSearchRef.current = null;
      search.dispose();
    };
  }, [open, mode, workspacePath, fileRoots, fileScope]);

  useEffect(() => {
    if (open && mode === "files") void fileSearchRef.current?.update(pathQuery ? "" : query);
  }, [open, mode, fileRoots, query, pathQuery]);

  useEffect(() => {
    if (!recentRequest || !isTauriRuntime()) return;
    const requestId = crypto.randomUUID();
    let disposed = false;
    let settled = false;
    void tauriInvoke<RecentFile[]>("fs_recent_file_history", { roots: recentRequest.roots }).then(
      files => { if (!disposed) setHistoryResult({ request: recentRequest, files }); },
      error => { if (!disposed) console.warn("最近文件记录读取失败", error); },
    );
    void tauriInvoke<RecentFile[]>("fs_recent_workspace_files", { roots: recentRequest.roots, requestId }).then(
      files => { settled = true; if (!disposed) setRecentResult({ request: recentRequest, files }); },
      () => { settled = true; if (!disposed) setRecentResult({ request: recentRequest }); },
    );
    return () => {
      disposed = true;
      if (!settled) void tauriInvoke("fs_cancel_recent_workspace_files", { requestId }).catch(() => {});
    };
  }, [recentRequest]);

  useEffect(() => {
    if (!pathRequest || !isTauriRuntime()) return;
    let disposed = false;
    void (async () => {
      try {
        const path = await resolveFileSearchPath(pathRequest.pathQuery, pathRequest.roots);
        if (disposed) return;
        const metadata = path ? await getMetadata(path) : null;
        if (!disposed) setPathResult({
          request: pathRequest,
          match: path && (metadata?.isFile || metadata?.isDirectory) ? { path, isDirectory: metadata.isDirectory } : undefined,
        });
      } catch (error) {
        if (!disposed) setPathResult({
          request: pathRequest,
          failed: !/\(os error [23]\)|\bENOENT\b/i.test(String(error)),
        });
      }
    })();
    return () => { disposed = true; };
  }, [pathRequest]);

  // Root requires three characters. Dedicated chat search accepts any nonempty query.
  useEffect(() => {
    const trimmed = query.trim();
    const canSearch =
      open && (mode === "chats" ? trimmed.length > 0 : mode === "root" && trimmed.length >= REMOTE_QUERY_MIN_LENGTH) && isTauriRuntime();
    if (!canSearch) {
      if (mode !== "files" || !open || !workspacePath) {
        setRemoteResults(null);
        setRemoteLoading(false);
      }
      return;
    }

    const cacheKey = `${mode}\u0000${workspacePath || ""}\u0000${trimmed}`;
    const cached = remoteCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.updatedAt < REMOTE_THREAD_STALE_MS) {
      setRemoteResults({ query: trimmed, workspacePath, mode, files: [], threads: cached.threads, nextCursor: cached.nextCursor });
      setRemoteLoading(false);
      return;
    }

    // 不同查询词的结果不复用：先清掉旧结果，避免展示错配。
    setRemoteResults(null);
    setRemoteLoading(true);

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const page = await searchThreadsProtocol(trimmed, mode === "chats" ? REMOTE_CHAT_LIMIT + 1 : REMOTE_THREAD_LIMIT)
        ?? { threads: [], nextCursor: null };
      if (cancelled) return;

      const cache = remoteCacheRef.current;
      cache.set(cacheKey, { ...page, updatedAt: Date.now() });
      if (cache.size > REMOTE_CACHE_LIMIT) {
        const oldestKey = cache.keys().next().value as string | undefined;
        if (oldestKey !== undefined) cache.delete(oldestKey);
      }

      setRemoteResults({ query: trimmed, workspacePath, mode, files: [], ...page });
      setRemoteLoading(false);
    }, REMOTE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, workspacePath, mode]);

  const loadMoreChats = useCallback(async (cursor?: string | null) => {
    if (chatSearchScopeRef.current !== chatSearchScope || chatPageRequest.current === chatSearchScope) return;
    const page = chatPaging ?? { scope: chatSearchScope, limit: REMOTE_CHAT_LIMIT, threads: [], usedCursors: [], loading: false };
    const expanded = { ...page, limit: page.limit + REMOTE_CHAT_LIMIT };
    if (cursor == null) {
      setChatPagination(expanded);
      return;
    }
    chatPageRequest.current = chatSearchScope;
    setChatPagination({ ...expanded, loading: true });
    const next = await searchThreadsProtocol(trimmedQuery, REMOTE_CHAT_LIMIT + 1, cursor);
    if (chatPageRequest.current === chatSearchScope) chatPageRequest.current = null;
    if (chatSearchScopeRef.current !== chatSearchScope) return;
    if (!next) {
      setChatPagination({ ...page, loading: false });
      return;
    }
    const usedCursors = [...page.usedCursors, cursor];
    setChatPagination({ ...expanded, threads: [...page.threads, ...next.threads], loading: false, usedCursors,
      nextCursor: next.nextCursor !== null && usedCursors.includes(next.nextCursor) ? null : next.nextCursor });
  }, [chatPaging, chatSearchScope, trimmedQuery]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const trimmedQuery = query.trim();
    // 只采用与当前查询词匹配的协议结果。
    const remote =
      remoteResults && remoteResults.mode === mode && remoteResults.query === trimmedQuery && remoteResults.workspacePath === workspacePath &&
      (mode !== "files" || remoteResults.fileScope === fileScope)
        ? remoteResults
        : null;
    const results: SearchResultItem[] = [];
    const openResult = (path: string, isDirectory?: boolean) => {
      if (folderScope) onSelectFile(path, isDirectory, folderScope);
      else if (isDirectory === undefined) onSelectFile(path);
      else onSelectFile(path, isDirectory);
      onClose();
    };
    if (pathQuery) {
      if (pathLookup?.match) {
        const { path, isDirectory } = pathLookup.match;
        results.push({
          id: `rfile-${path}`, category: "file", section: "文件",
          title: baseNameFsPath(path) || path, subtitle: path,
          icon: isDirectory ? <Folder size={14} /> : <FileText size={14} />,
          onSelect: () => openResult(path, isDirectory),
        });
      } else if (pathLookup?.failed) {
        results.push({
          id: "retry-file-lookup", category: "action", section: "文件",
          title: "无法检查路径。选择此项以重试", icon: <FileText size={14} />,
          onSelect: () => { setPathRetry(value => value + 1); inputRef.current?.focus(); },
        });
      }
      return results;
    }

    if (mode === "files" && !trimmedQuery) {
      const seen = new Set<string>();
      const section = recentLookup?.files?.length ? "最近文件" : "最近打开";
      const candidates = [...(recentFiles ?? []), ...(recentHistory ?? []), ...(recentLookup?.files ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
      for (const { path } of candidates) {
        const key = fileDedupeKey(path);
        const root = fileSearchRoot(path, fileRoots);
        if (!root || seen.has(key)) continue;
        seen.add(key);
        const relative = path.replace(/\\/g, "/").slice(fileDedupeKey(root).length + 1);
        const separator = relative.lastIndexOf("/");
        const parent = separator < 0 ? "" : relative.slice(0, separator);
        const subtitle = fileRoots.length > 1 ? [baseNameFsPath(root) || root, parent].filter(Boolean).join("/") : parent;
        results.push({
          id: `recent-file-${key}`, category: "file", section,
          title: baseNameFsPath(path) || path, subtitle: subtitle || undefined,
          icon: <FileText size={14} />,
          onSelect: () => openResult(path),
        });
        if (results.length === 10) break;
      }
      if (recentLookup && !recentLookup.files) results.push({
        id: "retry-recent-files", category: "action", section,
        title: "无法加载最近修改的文件。选择此项以重试", icon: <FileText size={14} />,
        onSelect: () => { setRecentRetry(value => value + 1); inputRef.current?.focus(); },
      });
      return results;
    }

    // ── 0. 斜杠命令索引 (Slash commands) ──
    const isSlashOnly = q.startsWith("/");
    const matchingSlashCommands = SLASH_COMMANDS.filter((cmd) => {
      if (!q) return false;
      const cleanQ = q.startsWith("/") ? q.slice(1) : q;
      return (
        cmd.command.toLowerCase().includes(q) ||
        cmd.title.toLowerCase().includes(cleanQ) ||
        cmd.description.toLowerCase().includes(cleanQ)
      );
    });
    const slashItems: SearchResultItem[] = matchingSlashCommands.map((cmd) => ({
      id: `slash-${cmd.id}`,
      category: "action",
      section: "斜杠命令",
      title: `${cmd.command} ${cmd.title}`,
      subtitle: cmd.description,
      rightLabel: cmd.kind === "action" ? "动作" : "指令",
      icon: <Command size={14} />,
      onSelect: () => {
        onSelectSlashCommand(cmd);
        onClose();
      },
    }));
    if (isSlashOnly) {
      results.push(...slashItems);
    }

    // Quick Actions
    const defaultActions: SearchResultItem[] = [
      {
        id: "act-new-chat",
        category: "action",
        section: "快捷操作",
        title: "新建聊天会话",
        subtitle: "创建新的空白对话流",
        shortcut: "Ctrl+N",
        icon: <MessageSquare size={14} />,
        onSelect: () => {
          onStartNewChat();
          onClose();
        },
      },
      {
        id: "act-run-dev",
        category: "action",
        section: "快捷操作",
        title: `运行启动服务 (${runCmd})`,
        subtitle: "在集成终端中执行本地启动命令",
        icon: <Play size={14} />,
        onSelect: () => {
          onTriggerCommand(runCmd);
          onClose();
        },
      },
      {
        id: "act-run-test",
        category: "action",
        section: "快捷操作",
        title: `运行单元测试 (${testCmd})`,
        subtitle: "在集成终端中运行测试套件",
        icon: <Command size={14} />,
        onSelect: () => {
          onTriggerCommand(testCmd);
          onClose();
        },
      },
      {
        id: "act-run-build",
        category: "action",
        section: "快捷操作",
        title: `运行构建编译 (${buildCmd})`,
        subtitle: "在集成终端中执行生产打包命令",
        icon: <Play size={14} />,
        onSelect: () => {
          onTriggerCommand(buildCmd);
          onClose();
        },
      },
      {
        id: "act-projects",
        category: "action",
        section: "快捷操作",
        title: "打开项目中心",
        subtitle: "管理已注册的本地工作区目录",
        shortcut: "Ctrl+Shift+P",
        icon: <Folder size={14} />,
        onSelect: () => {
          onNavigateRoute("projects");
          onClose();
        },
      },
      {
        id: "act-settings",
        category: "action",
        section: "快捷操作",
        title: "打开设置中心",
        subtitle: "常规、外观、模型与提供商设置",
        shortcut: "Ctrl+,",
        icon: <Settings size={14} />,
        onSelect: () => {
          onNavigateRoute("settings");
          onClose();
        },
      },
    ];

    results.push(
      ...defaultActions.filter(
        (a) =>
          !q ||
          a.title.toLowerCase().includes(q) ||
          a.subtitle?.toLowerCase().includes(q)
      )
    );

    if (!isSlashOnly && slashItems.length > 0) {
      results.push(...slashItems);
    }

    // Threads —— 协议结果优先，本地结果按 id 去重补充。
    const remoteThreads = mode === "chats" && chatPaging?.threads.length
      ? [...new Map([...remote?.threads ?? [], ...chatPaging.threads].map(thread => [thread.id, thread])).values()]
      : remote?.threads ?? [];
    const remoteThreadIds = new Set(remoteThreads.map((t) => t.id));
    const threadLimit = mode === "chats" ? chatPaging?.limit ?? REMOTE_CHAT_LIMIT : REMOTE_THREAD_LIMIT;

    remoteThreads.slice(0, threadLimit).forEach((t) => {
      results.push({
        id: `rth-${t.id}`,
        category: "thread",
        section: "聊天",
        title: t.name || t.preview || t.id,
        subtitle: `历史会话${t.cwd ? ` · ${t.cwd}` : ""}`,
        rightLabel: t.cwd ? t.cwd.split(/[/\\]/).pop() : "Chat",
        icon: <MessageSquare size={14} />,
        onSelect: () => {
          onSelectThread(t.id);
          onClose();
        },
      });
    });

    const localThreads = threads
      .filter((t) => {
        if (mode === "files" || (mode === "root" && q.length < 2) || remoteThreadIds.has(t.id)) return false;
        return (
          t.name?.toLowerCase().includes(q) ||
          t.preview?.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q)
        );
      });
    localThreads
      .slice(0, Math.max(0, threadLimit - remoteThreads.length))
      .forEach((t) => {
        results.push({
          id: `th-${t.id}`,
          category: "thread",
          section: "聊天",
          title: t.name || t.preview || t.id,
          subtitle: `历史会话 · ${t.cwd || ""}`,
          rightLabel: t.cwd ? t.cwd.split(/[/\\]/).pop() : "Chat",
          icon: <MessageSquare size={14} />,
          onSelect: () => {
            onSelectThread(t.id);
            onClose();
          },
        });
      });

    if (mode === "chats") {
      const cursor = chatPaging?.nextCursor === undefined ? remote?.nextCursor : chatPaging.nextCursor;
      const chats = results.filter(item => item.category === "thread");
      if (chatPaging?.loading || remoteThreads.length + localThreads.length > threadLimit || cursor != null) {
        chats.push({
          id: "show-more-chats", category: "action", section: "聊天",
          title: chatPaging?.loading ? "正在搜索会话…" : "显示更多", icon: <MessageSquare size={14} />,
          onSelect: () => void loadMoreChats(cursor),
        });
      }
      return chats;
    }

    if (mode === "root" && (!q || "切换聊天… 搜索聊天 search chats switch chat".includes(q))) {
      results.push({
        id: "search-chats", category: "action", section: "操作",
        title: "切换聊天…", icon: <MessageSquare size={14} />,
        onSelect: () => { onSearchChats(); inputRef.current?.focus(); inputRef.current?.select(); },
      });
    }
    if (mode === "root" && (!q || "搜索文件 search files workspace project cmd+p".includes(q))) {
      results.push({
        id: "search-files", category: "action", section: "操作",
        title: "搜索文件", shortcut: "Ctrl+P", icon: <FileText size={14} />,
        onSelect: () => { setQuery(""); onSearchFiles(); inputRef.current?.focus(); },
      });
    }
    // File hits belong exclusively to files mode; no stale directory-list fallback.
    const remoteFiles = mode === "files" ? remote?.files ?? [] : [];
    remoteFiles.forEach((f) => {
      const root = fileSearchRoot(f.absPath, fileRoots);
      const relative = root ? f.absPath.replace(/\\/g, "/").slice(fileDedupeKey(root).length + 1) : f.relPath;
      results.push({
        id: `rfile-${f.absPath}`,
        category: "file",
        section: "文件",
        title: f.fileName,
        subtitle: fileRoots.length > 1 && root ? `${baseNameFsPath(root) || root}/${relative}` : f.relPath,
        rightLabel: "File",
        icon: <FileText size={14} />,
        onSelect: () => openResult(f.absPath),
      });
    });

    // Skills
    skills
      .filter((s) => {
        if (!q) return false;
        return (
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q)
        );
      })
      .slice(0, 4)
      .forEach((s) => {
        results.push({
          id: `sk-${s.id}`,
          category: "skill",
          section: "技能",
          title: `$${s.id} (${s.name})`,
          subtitle: s.description,
          rightLabel: "Skill",
          icon: <BookOpen size={14} />,
          onSelect: () => {
            onSelectSkill(s.id);
            onClose();
          },
        });
      });

    // Settings sections
    const settingsSections: Array<{
      slug: SettingsSectionSlug;
      title: string;
      subtitle: string;
      keywords: string;
    }> = [
      {
        slug: "general-settings",
        title: "常规设置 (General Settings)",
        subtitle: "默认工作区、Shell、终端位置与 App-Server 连接状态",
        keywords: "常规 general shell terminal app-server",
      },
      {
        slug: "notifications",
        title: "通知与免打扰 (Notifications & Sound Themes)",
        subtitle: "完成提示音主题、轮次通知策略与系统原生 Toast 提醒",
        keywords: "通知 提示音 免打扰 sound toast chime notification",
      },
      {
        slug: "profile",
        title: "开发者个人资料 (Developer Profile)",
        subtitle: "管理展示名称、用户名、开发者简介与头像",
        keywords: "个人 资料 profile avatar username bio",
      },
      {
        slug: "account",
        title: "账号与额度 (Account & Rate Limits)",
        subtitle: "查阅账号套餐、额度限制、Token 用量与活动统计",
        keywords: "账号 额度 用量 计费 account usage plan quota credits",
      },
      {
        slug: "code-review",
        title: "代码审查规范 (Code Review Preferences)",
        subtitle: "配置自动审查触发条件、阻断级别与路径排除规则",
        keywords: "审查 评审 代码审查 code review pr diff severity",
      },
      {
        slug: "git-settings",
        title: "Git 自动化偏好 (Git Preferences)",
        subtitle: "自动分支前缀、默认主分支、签署提交与 Conventional Commits",
        keywords: "git 分支 prefix branch commit conventional",
      },
      {
        slug: "worktrees",
        title: "工作树策略 (Worktrees Strategy)",
        subtitle: "独立实验工作区保留天数与依赖缓存共享软链",
        keywords: "工作树 隔离 worktree retention cache",
      },
      {
        slug: "appshots",
        title: "应用快照 (Appshots)",
        subtitle: "窗口截图注入、滚屏外长日志采集与全局截图快捷键",
        keywords: "快照 截屏 窗口 appshots screenshot window",
      },
      {
        slug: "computer-use",
        title: "电脑操控与桌面自动化 (Computer Use)",
        subtitle: "多模态桌面自动化、应用白名单与高风险操作二次确认",
        keywords: "电脑 操控 自动化 computer use desktop automation",
      },
      {
        slug: "browser-use",
        title: "浏览器操控 (Browser Use)",
        subtitle: "Chrome DevTools Protocol (CDP) 调试与 WebMCP 网页自动化",
        keywords: "浏览器 browser cdp webmcp devtools",
      },
      {
        slug: "cloud-settings",
        title: "Codex 云端偏好 (Cloud Preferences)",
        subtitle: "云端差异比对视图模式、云分支规范与默认容器环境",
        keywords: "云端 偏好 cloud preferences diff branch container",
      },
      {
        slug: "plugins-settings",
        title: "插件与技能市场设置 (Plugins Settings)",
        subtitle: "插件市场源、沙盒模式与自动更新策略",
        keywords: "插件 技能 市场 plugins skills marketplace",
      },
      {
        slug: "hooks-settings",
        title: "生命周期挂钩 (Lifecycle Hooks)",
        subtitle: "PreToolUse, PostToolUse 等 11 类生命周期实时事件",
        keywords: "挂钩 生命周期 hooks pretooluse posttooluse",
      },
      {
        slug: "agent",
        title: "智能体与模型参数设置 (Agent & Hyperparameters)",
        subtitle: "调节 Temperature, Top-P, Tokens 上限, WebSearch 与沙盒",
        keywords: "参数 超参数 agent model temperature top_p tokens reasoning approval sandbox",
      },
      {
        slug: "providers-models",
        title: "提供商与模型目录 (Providers & Models)",
        subtitle: "配置自定义 API Base URL, Key 与 Wire API",
        keywords: "模型 提供商 provider model catalog toml base_url",
      },
      {
        slug: "appearance",
        title: "外观与色彩主题 (Appearance & Themes)",
        subtitle: "切换 25+ 官方色彩主题与界面字号",
        keywords: "外观 主题 theme appearance font color",
      },
      {
        slug: "local-environments",
        title: "本地运行环境配置 (.codex/environments)",
        subtitle: "编辑测试与构建环境 default.toml",
        keywords: "环境 local environment default.toml",
      },
      {
        slug: "keyboard-shortcuts",
        title: "键盘快捷键一览 (Keyboard Shortcuts)",
        subtitle: "查看与设置 Ctrl+N, Ctrl+B, Ctrl+J, Ctrl+K 等快捷键",
        keywords: "快捷键 shortcuts hotkeys keybindings",
      },
      {
        slug: "personalization",
        title: "个性化与角色指令 (Personalization)",
        subtitle: "定制 Codex 的回复语气、角色定位与代码风格偏好",
        keywords: "个性化 指令 角色 persona instructions tone",
      },
      {
        slug: "pets",
        title: "虚拟宠物伴侣 (Mini & Pets)",
        subtitle: "管理 Codex 桌面伴侣外观、缩放比例与跟随常显",
        keywords: "宠物 伴侣 pets mini companion",
      },
      {
        slug: "voice",
        title: "智能语音输入 (Voice & Dictation)",
        subtitle: "麦克风语音输入、Whisper 语音模型与静音自动发送",
        keywords: "语音 听写 麦克风 voice whisper dictation microphone",
      },
      {
        slug: "archived-chats",
        title: "已归档聊天 (Archived Chats)",
        subtitle: "检索、还原或永久删除历史归档的会话记录",
        keywords: "归档 会话 历史 archive archived chats restore",
      },
      {
        slug: "storage",
        title: "存储空间与数据清理 (Storage & Cleanup)",
        subtitle: "工作树缓存、会话历史与磁盘占用分析",
        keywords: "存储 磁盘 清理 storage disk cache",
      },
      {
        slug: "import",
        title: "导入外部配置 (Import Settings)",
        subtitle: "从 Cursor, VS Code, Windsurf, Claude 导入规则与设置",
        keywords: "导入 import cursor vscode windsurf claude",
      },
    ];

    settingsSections
      .filter((s) => {
        if (!q) return false;
        return (
          s.title.toLowerCase().includes(q) ||
          s.subtitle.toLowerCase().includes(q) ||
          s.keywords.toLowerCase().includes(q)
        );
      })
      .forEach((s) => {
        results.push({
          id: `set-${s.slug}`,
          category: "setting",
          section: "设置",
          title: s.title,
          subtitle: s.subtitle,
          rightLabel: "Setting",
          icon: <Settings size={14} />,
          onSelect: () => {
            onNavigateSettings(s.slug);
            onClose();
          },
        });
      });

    return mode === "files" ? results.filter((item) => item.category === "file") : results;
  }, [
    query,
    mode,
    workspacePath,
    fileRoots,
    fileScope,
    folderScope,
    recentFiles,
    recentHistory,
    recentLookup,
    threads,
    skills,
    remoteResults,
    chatPaging,
    loadMoreChats,
    pathQuery,
    pathLookup,
    onStartNewChat,
    onTriggerCommand,
    onSelectSlashCommand,
    onNavigateSettings,
    onNavigateRoute,
    onSelectThread,
    onSelectFile,
    onSearchFiles,
    onSearchChats,
    onSelectSkill,
    onClose,
    runCmd,
    testCmd,
    buildCmd,
  ]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((idx) => (idx + 1) % Math.max(1, items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(
        (idx) => (idx - 1 + items.length) % Math.max(1, items.length)
      );
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (items.length === 0) { scopeTriggerRef.current?.focus(); return; }
      const currentSec = items[selectedIndex]?.section;
      if (!currentSec) return;
      if (e.shiftKey) {
        for (let i = selectedIndex - 1; i >= 0; i--) {
          if (items[i].section !== currentSec) {
            const prevSec = items[i].section;
            let firstOfPrev = i;
            while (firstOfPrev > 0 && items[firstOfPrev - 1].section === prevSec) firstOfPrev--;
            setSelectedIndex(firstOfPrev);
            return;
          }
        }
      } else {
        for (let i = selectedIndex + 1; i < items.length; i++) {
          if (items[i].section !== currentSec) {
            setSelectedIndex(i);
            return;
          }
        }
      }
      scopeTriggerRef.current?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[selectedIndex]) {
        items[selectedIndex].onSelect();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!open) return null;
  const recentLoading = !!recentRequest && isTauriRuntime() && !recentLookup;
  const loading = recentRequest ? recentLoading && items.length === 0
    : pathQuery ? !!pathRequest && isTauriRuntime() && !pathLookup : remoteLoading;
  const defaultScopeLabel = workspaceLabel || (projectRoots.length === 1
    ? `文件夹：${baseNameFsPath(projectRoots[0]) || projectRoots[0]}` : "文件夹");

  return (<>
    <div className="quick-search-backdrop" onClick={onClose}>
      <div
        className="quick-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="命令菜单"
        aria-description="搜索命令和过往对话记录。"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="quick-search-input-wrap">
          <Search size={16} className="quick-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="quick-search-input"
            aria-label={mode === "files" ? "搜索文件" : mode === "chats" ? "搜索聊天" : "搜索聊天或运行命令"}
            placeholder={mode === "files" ? "搜索文件" : mode === "chats" ? "搜索聊天" : "搜索聊天或运行命令"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {mode !== "chats" && isTauriRuntime() && <div className="quick-search-scope" onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) setScopeMenuOpen(false);
          }} onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Escape" && !scopeMenuOpen) return;
            event.stopPropagation();
            if (event.key === "Escape") { event.preventDefault(); closeScopeMenu(); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!scopeMenuOpen && projectRoots.length) setScopeMenuOpen(true);
              else if (scopeMenuOpen) {
                const buttons = scopeMenuRef.current?.querySelectorAll("button");
                if (buttons?.length) buttons[event.target === buttons[0] ? 1 : 0]?.focus();
              }
            }
          }}>
            <button type="button" ref={scopeTriggerRef} className="quick-search-scope-trigger"
              title={chosenFolder ?? projectRoots.join("\n")}
              aria-haspopup={projectRoots.length ? "menu" : "dialog"}
              aria-expanded={projectRoots.length ? scopeMenuOpen : undefined}
              onClick={() => projectRoots.length ? setScopeMenuOpen(value => !value) : void pickSearchFolder()}>
              <Folder size={14} aria-hidden="true" />
              <span>{chosenFolder ? `在 ${baseNameFsPath(chosenFolder) || chosenFolder} 中` : projectRoots.length ? defaultScopeLabel : "选择文件夹…"}</span>
              {projectRoots.length > 0 && <ChevronDown size={12} aria-hidden="true" />}
            </button>
            {scopeMenuOpen && <div ref={scopeMenuRef} className="quick-search-scope-menu" role="menu" aria-label="搜索范围">
              <button type="button" role="menuitemradio" aria-checked={!chosenFolder} onClick={() => { setSelectedFolder(null); closeScopeMenu(); }}>{defaultScopeLabel}</button>
              <button type="button" role="menuitem" onClick={() => void pickSearchFolder()}>选择文件夹…</button>
            </div>}
          </div>}
        </div>


        <div className="quick-search-results">
          {loading && (
            <div
              className="empty-hint-small"
              style={{ padding: "8px 12px", textAlign: "left", opacity: 0.75 }}
            >
              {recentLoading ? "正在加载最近文件…" : pathQuery ? "正在检查文件…" : mode === "files" ? "正在搜索文件…" : "正在搜索会话…"}
            </div>
          )}
          {items.length === 0 ? (
            loading ? null : (
              <div className="empty-hint-small" style={{ padding: "20px 0" }}>
                {pathQuery ? "未找到匹配的文件" : mode === "files" && !query.trim() ? "输入文件名进行搜索" : "未找到匹配项"}
              </div>
            )
          ) : (
            items.map((item, index) => {
              const showSectionHeader =
                index === 0 || items[index - 1].section !== item.section;
              return (
                <React.Fragment key={item.id}>
                  {showSectionHeader && (
                    <div className="quick-search-section-header">
                      {item.section}
                    </div>
                  )}
                  <div
                    className={`quick-search-row ${
                      index === selectedIndex ? "active" : ""
                    }`}
                    onClick={item.onSelect}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div className="quick-search-row-icon">{item.icon}</div>
                    <div className="quick-search-row-content">
                      <span className="quick-search-row-title">{item.title}</span>
                      {item.subtitle && (
                        <span className="quick-search-row-subtitle">
                          {item.subtitle}
                        </span>
                      )}
                    </div>
                    {item.shortcut ? (
                      <kbd className="quick-search-kbd">{item.shortcut}</kbd>
                    ) : item.rightLabel ? (
                      <span className="quick-search-right-label">
                        {item.rightLabel}
                      </span>
                    ) : null}
                  </div>
                </React.Fragment>
              );
            })
          )}
        </div>
      </div>
    </div>
    {folderPicker === scopeContext && <SearchFolderDialog initialPath={chosenFolder ?? projectRoots[0]} onClose={finishFolderPicker} />}
  </>);
};

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Command,
  FileText,
  Folder,
  MessageSquare,
  Play,
  Search,
  Settings,
  X,
} from "lucide-react";
import { callAppServer, isTauriRuntime } from "../bridge";
import { MainViewRoute, ProjectScriptCommands, SettingsSectionSlug, SkillInfoItem, ThreadSummary, WorkspaceFileHit } from "../types";

export interface QuickSearchModalProps {
  open: boolean;
  threads: ThreadSummary[];
  workspaceFileHits: WorkspaceFileHit[];
  skills: SkillInfoItem[];
  projectScripts?: ProjectScriptCommands;
  /**
   * 当前工作区绝对路径（可选）。传入后文件搜索会并行调用 app-server 的
   * `fuzzyFileSearch`；未传入时仅保留本地缓存结果，不发起文件协议搜索。
   */
  workspacePath?: string;
  onClose: () => void;
  onSelectThread: (threadId: string) => void;
  onSelectFile: (filePath: string) => void;
  onSelectSkill: (skillId: string) => void;
  onNavigateSettings: (slug: SettingsSectionSlug) => void;
  onNavigateRoute: (route: MainViewRoute) => void;
  onStartNewChat: () => void;
  onTriggerCommand: (cmd: string) => void;
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
const REMOTE_QUERY_MIN_LENGTH = 2;
/** 输入防抖窗口（毫秒）。 */
const REMOTE_DEBOUNCE_MS = 150;
/** 单次协议搜索返回上限（与本地结果数量保持平衡）。 */
const REMOTE_FILE_LIMIT = 8;
const REMOTE_THREAD_LIMIT = 6;
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

interface RemoteThreadResult {
  id: string;
  name?: string | null;
  preview?: string | null;
  cwd?: string | null;
}

interface RemoteSearchResults {
  /** 产生这批结果的查询词（trim 后），用于丢弃与当前输入不匹配的旧结果。 */
  query: string;
  files: RemoteFileResult[];
  threads: RemoteThreadResult[];
}

/** Windows 下协议返回的 path 是相对 root 的路径，绝对路径 = root + "\\" + path。 */
function joinRootPath(root: string, relPath: string): string {
  const cleanRoot = root.replace(/[\\/]+$/, "");
  const cleanRel = relPath.replace(/^[\\/]+/, "");
  if (!cleanRel) return cleanRoot;
  const separator = cleanRoot.includes("\\") ? "\\" : "/";
  return `${cleanRoot}${separator}${cleanRel}`;
}

/** 文件去重键：统一分隔符；Windows 盘符路径大小写不敏感。 */
function fileDedupeKey(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-zA-Z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

function normalizeRemoteFileHits(
  raw: unknown,
  fallbackRoot: string
): RemoteFileResult[] {
  if (!Array.isArray(raw)) return [];
  const results: RemoteFileResult[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const hit = entry as FuzzyFileSearchHit;
    const relativePath = typeof hit.path === "string" ? hit.path.trim() : "";
    if (!relativePath) continue;

    const root =
      typeof hit.root === "string" && hit.root.trim()
        ? hit.root.trim()
        : fallbackRoot;
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
    if (results.length >= REMOTE_FILE_LIMIT) break;
  }

  return results;
}

function normalizeRemoteThreadHits(raw: unknown): RemoteThreadResult[] {
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
    if (results.length >= REMOTE_THREAD_LIMIT) break;
  }

  return results;
}

/**
 * 调用 `fuzzyFileSearch` 搜索工作区文件。
 * 非 Tauri 环境、协议不可用或参数错误时静默降级为空结果（本地结果不受影响）。
 */
async function searchWorkspaceFiles(
  query: string,
  workspacePath?: string
): Promise<RemoteFileResult[]> {
  if (!workspacePath) return [];
  try {
    const response = await callAppServer<
      { files?: FuzzyFileSearchHit[] } | FuzzyFileSearchHit[]
    >("fuzzyFileSearch", {
      roots: [workspacePath],
      query,
      limit: REMOTE_FILE_LIMIT,
    });
    const files = Array.isArray(response) ? response : response?.files;
    return normalizeRemoteFileHits(files, workspacePath);
  } catch {
    // 静默降级：非 Tauri 环境 / app-server 未就绪 / 协议变更都只丢协议结果。
    return [];
  }
}

/**
 * 调用 `thread/search` 搜索历史会话。
 * 返回结构为 `{ data: [{ snippet, thread }] }`（兼容 `threads` 扁平数组）。
 */
async function searchThreadsProtocol(query: string): Promise<RemoteThreadResult[]> {
  try {
    const response = await callAppServer<
      | { data?: ThreadSearchEntry[]; threads?: ThreadSearchEntry[] }
      | ThreadSearchEntry[]
    >("thread/search", {
      searchTerm: query,
      limit: REMOTE_THREAD_LIMIT,
    });
    if (Array.isArray(response)) return normalizeRemoteThreadHits(response);
    const entries = Array.isArray(response?.data)
      ? response.data
      : Array.isArray(response?.threads)
      ? response.threads
      : [];
    return normalizeRemoteThreadHits(entries);
  } catch {
    // 静默降级：无 app-server 时继续使用本地 threads 过滤。
    return [];
  }
}

export const QuickSearchModal: React.FC<QuickSearchModalProps> = ({
  open,
  threads,
  workspaceFileHits,
  skills,
  projectScripts,
  workspacePath,
  onClose,
  onSelectThread,
  onSelectFile,
  onSelectSkill,
  onNavigateSettings,
  onNavigateRoute,
  onStartNewChat,
  onTriggerCommand,
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [remoteResults, setRemoteResults] = useState<RemoteSearchResults | null>(
    null
  );
  const [remoteLoading, setRemoteLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** 查询词 -> 协议结果缓存：避免每次渲染/重复输入重复请求 app-server。 */
  const remoteCacheRef = useRef<
    Map<string, { files: RemoteFileResult[]; threads: RemoteThreadResult[] }>
  >(new Map());

  const runCmd = projectScripts?.runCommand || "npm run dev";
  const testCmd = projectScripts?.testCommand || "npm test";
  const buildCmd = projectScripts?.buildCommand || "npm run build";

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  // 工作区切换后旧缓存不再适用（key 也带 workspacePath，这里主动释放内存）。
  useEffect(() => {
    remoteCacheRef.current.clear();
  }, [workspacePath]);

  // 协议搜索：>=2 字符时 150ms 防抖后并行查询 fuzzyFileSearch + thread/search。
  useEffect(() => {
    const trimmed = query.trim();
    const canSearch =
      open && trimmed.length >= REMOTE_QUERY_MIN_LENGTH && isTauriRuntime();
    if (!canSearch) {
      setRemoteResults(null);
      setRemoteLoading(false);
      return;
    }

    const cacheKey = `${workspacePath || ""}\u0000${trimmed}`;
    const cached = remoteCacheRef.current.get(cacheKey);
    if (cached) {
      setRemoteResults({ query: trimmed, files: cached.files, threads: cached.threads });
      setRemoteLoading(false);
      return;
    }

    // 不同查询词的结果不复用：先清掉旧结果，避免展示错配。
    setRemoteResults(null);
    setRemoteLoading(true);

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const [files, threads] = await Promise.all([
        searchWorkspaceFiles(trimmed, workspacePath),
        searchThreadsProtocol(trimmed),
      ]);
      if (cancelled) return;

      const cache = remoteCacheRef.current;
      cache.set(cacheKey, { files, threads });
      if (cache.size > REMOTE_CACHE_LIMIT) {
        const oldestKey = cache.keys().next().value as string | undefined;
        if (oldestKey !== undefined) cache.delete(oldestKey);
      }

      setRemoteResults({ query: trimmed, files, threads });
      setRemoteLoading(false);
    }, REMOTE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, workspacePath]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const trimmedQuery = query.trim();
    // 只采用与当前查询词匹配的协议结果。
    const remote =
      remoteResults && remoteResults.query === trimmedQuery
        ? remoteResults
        : null;
    const results: SearchResultItem[] = [];

    // Quick Actions
    const defaultActions: SearchResultItem[] = [
      {
        id: "act-new-chat",
        category: "action",
        section: "快捷操作 (Quick actions)",
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
        section: "快捷操作 (Quick actions)",
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
        section: "快捷操作 (Quick actions)",
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
        section: "快捷操作 (Quick actions)",
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
        section: "快捷操作 (Quick actions)",
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
        section: "快捷操作 (Quick actions)",
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

    // Threads —— 协议结果优先，本地结果按 id 去重补充。
    const remoteThreads = remote?.threads ?? [];
    const remoteThreadIds = new Set(remoteThreads.map((t) => t.id));

    remoteThreads.slice(0, REMOTE_THREAD_LIMIT).forEach((t) => {
      results.push({
        id: `rth-${t.id}`,
        category: "thread",
        section: "会话记录 (Chats)",
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

    threads
      .filter((t) => {
        if (!q || remoteThreadIds.has(t.id)) return false;
        return (
          t.name?.toLowerCase().includes(q) ||
          t.preview?.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q)
        );
      })
      .slice(0, 5)
      .forEach((t) => {
        results.push({
          id: `th-${t.id}`,
          category: "thread",
          section: "会话记录 (Chats)",
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

    // Workspace Files —— 协议结果优先，本地结果按绝对路径去重补充。
    const remoteFiles = remote?.files ?? [];
    const remoteFileKeys = new Set(
      remoteFiles.map((f) => fileDedupeKey(f.absPath))
    );

    remoteFiles.slice(0, REMOTE_FILE_LIMIT).forEach((f) => {
      results.push({
        id: `rfile-${f.absPath}`,
        category: "file",
        section: "工作区文件 (Files)",
        title: f.fileName,
        subtitle: f.relPath,
        rightLabel: "File",
        icon: <FileText size={14} />,
        onSelect: () => {
          onSelectFile(f.absPath);
          onClose();
        },
      });
    });

    workspaceFileHits
      .filter((f) => {
        if (!q) return false;
        if (remoteFileKeys.has(fileDedupeKey(f.absPath))) return false;
        return (
          f.name.toLowerCase().includes(q) || f.relPath.toLowerCase().includes(q)
        );
      })
      .slice(0, 6)
      .forEach((f) => {
        results.push({
          id: `file-${f.absPath}`,
          category: "file",
          section: "工作区文件 (Files)",
          title: f.name,
          subtitle: f.relPath,
          rightLabel: "File",
          icon: <FileText size={14} />,
          onSelect: () => {
            onSelectFile(f.absPath);
            onClose();
          },
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
          section: "扩展技能 (Skills)",
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
          section: "设置中心 (Settings)",
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

    return results;
  }, [
    query,
    threads,
    workspaceFileHits,
    skills,
    remoteResults,
    onStartNewChat,
    onTriggerCommand,
    onNavigateRoute,
    onSelectThread,
    onSelectFile,
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
      if (items.length === 0) return;
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

  return (
    <div className="quick-search-backdrop" onClick={onClose}>
      <div
        className="quick-search-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="quick-search-input-wrap">
          <Search size={16} className="quick-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="quick-search-input"
            placeholder="搜索会话、文件、技能、设置或执行快捷命令..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="quick-search-results">
          {remoteLoading && (
            <div
              className="empty-hint-small"
              style={{ padding: "8px 12px", textAlign: "left", opacity: 0.75 }}
            >
              正在从 Codex 服务端搜索工作区与会话…
            </div>
          )}
          {items.length === 0 ? (
            remoteLoading ? null : (
              <div className="empty-hint-small" style={{ padding: "20px 0" }}>
                未找到匹配项
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
  );
};

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  FolderIcon,
  LaptopIcon,
  WorktreeIcon,
  BranchIcon,
  ChevronDownIcon,
  PlusIcon,
  HandApprovalIcon,
  MicIcon,
  SendIcon,
  StopIcon,
  CheckIcon,
  CloseIcon,
  SparklesIcon,
  PaperclipIcon,
  CameraIcon,
  ShieldIcon,
} from "./Icons";
import {
  AttachedFileItem,
  GitStatusInfo,
  ModelInfo,
  SkillInfoItem,
  WorkspaceFileHit,
  WorkspaceRootItem,
} from "../types";
import { ComposerAutocomplete, AutocompleteItem, getAutocompleteItems } from "./ComposerAutocomplete";
import { ComposerAttachmentChip } from "./ComposerAttachmentChip";
import { createAttachedFileItem } from "../threadAttachments";
import { ModelSelector } from "./ModelSelector";
import { isTauriRuntime } from "../bridge";
import { baseNameFsPath } from "../fsClient";

import type { ComposerEnterBehavior } from "../composerPreferences";

export interface ComposerBoxProps {
  dictationSessionKey: string;
  composerEnterBehavior: ComposerEnterBehavior;
  variant: "home" | "thread";
  promptInput: string;
  onPromptInputChange: (val: string) => void;
  onSendMessage: () => void;
  onQueueMessage: () => void;
  onInterruptTurn?: () => void;
  isStreaming: boolean;
  // Workspace & Git
  workspaces: WorkspaceRootItem[];
  activeWorkspace: WorkspaceRootItem | null;
  onSelectWorkspace: (path: string) => void;
  onPickNewFolder: () => void;
  gitStatus: GitStatusInfo | null;
  gitBranches: string[];
  onSwitchBranch: (branch: string) => void;
  onCreateBranch: (branch: string) => void;
  // Execution mode & permissions
  useWorktree: boolean;
  onSetUseWorktree: (val: boolean) => void;
  permissionMode: "ask" | "auto" | "full";
  onSelectPermissionMode: (mode: "ask" | "auto" | "full") => void;
  // Model, effort, speed, plan mode
  models: ModelInfo[];
  modelsLoading?: boolean;
  modelsError?: string | null;
  onRefreshModels?: () => void;
  selectedModelId: string;
  defaultModelSelected: boolean;
  onSelectModel: (id: string, useDefault: boolean) => void;
  reasoningEffort: string;
  onSelectReasoningEffort: (effort: string) => void;
  fastMode: boolean;
  onToggleFastMode: () => void;
  planMode: boolean;
  onTogglePlanMode: () => void;
  // Attachments & Autocomplete
  attachedFiles: AttachedFileItem[];
  onAttachFiles: () => void;
  onAppshot?: () => void;
  onAddAttachedFiles?: (files: AttachedFileItem[]) => void;
  onRemoveAttachedFile: (id: string) => void;
  workspaceFiles: string[];
  workspaceFileHits: WorkspaceFileHit[];
  skills: SkillInfoItem[];
  onSlashAction?: (action: string) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

const PERMISSION_OPTIONS: Array<{
  id: "ask" | "auto" | "full";
  shortLabel: string;
  title: string;
  desc: string;
}> = [
  {
    id: "ask",
    shortLabel: "请求批准",
    title: "请求批准",
    desc: "编辑外部文件和使用互联网时始终询问",
  },
  {
    id: "auto",
    shortLabel: "帮我批准",
    title: "帮我批准",
    desc: "仅对检测到的风险操作请求批准",
  },
  {
    id: "full",
    shortLabel: "完全访问",
    title: "完全访问权限",
    desc: "可不受限制地访问互联网和你电脑上的任何文件",
  },
];

export const ComposerBox: React.FC<ComposerBoxProps> = ({
  dictationSessionKey,
  composerEnterBehavior,
  variant,
  promptInput,
  onPromptInputChange,
  onSendMessage,
  onQueueMessage,
  onInterruptTurn,
  isStreaming,
  workspaces,
  activeWorkspace,
  onSelectWorkspace,
  onPickNewFolder,
  gitStatus,
  gitBranches,
  onSwitchBranch,
  onCreateBranch,
  useWorktree,
  onSetUseWorktree,
  permissionMode,
  onSelectPermissionMode,
  models,
  modelsLoading,
  modelsError,
  onRefreshModels,
  selectedModelId,
  defaultModelSelected,
  onSelectModel,
  reasoningEffort,
  onSelectReasoningEffort,
  fastMode,
  onToggleFastMode,
  planMode,
  onTogglePlanMode,
  attachedFiles,
  onAttachFiles,
  onAppshot,
  onAddAttachedFiles,
  onRemoveAttachedFile,
  workspaceFiles,
  workspaceFileHits,
  skills,
  onSlashAction,
  textareaRef,
}) => {
  const internalTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const actualTextareaRef = textareaRef || internalTextareaRef;

  useLayoutEffect(() => {
    const input = actualTextareaRef.current;
    if (!input) return;
    const resize = () => {
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
    };
    resize();
    let width = input.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = input.getBoundingClientRect().width;
      if (width === nextWidth) return;
      width = nextWidth;
      resize();
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [promptInput, variant, actualTextareaRef]);

  const [openMenu, setOpenMenu] = useState<
    "project" | "env" | "branch" | "plus" | "permission" | "model" | null
  >(null);
  const [newBranchInput, setNewBranchInput] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [isDictating, setIsDictating] = useState(false);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const onAddAttachedFilesRef = useRef(onAddAttachedFiles);
  onAddAttachedFilesRef.current = onAddAttachedFiles;
  const recognitionRef = useRef<any>(null);
  const dictationContext = useRef({ key: dictationSessionKey, prompt: promptInput });
  dictationContext.current = { key: dictationSessionKey, prompt: promptInput };
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuTriggersRef = useRef<Record<string, HTMLButtonElement | null>>({});
  const focusLastMenuItemRef = useRef(false);

  const closeComposerMenu = () => {
    setOpenMenu(null);
    if (openMenu) menuTriggersRef.current[openMenu]?.focus({ preventScroll: true });
  };

  const handleComposerTriggerKeys = (event: React.KeyboardEvent<HTMLButtonElement>, menu: NonNullable<typeof openMenu>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    focusLastMenuItemRef.current = event.key === "ArrowUp";
    setOpenMenu(menu);
    if (openMenu === menu) {
      const controls = menuRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
      controls?.[focusLastMenuItemRef.current ? controls.length - 1 : 0]?.focus({ preventScroll: true });
    }
  };

  const handleComposerMenuKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeComposerMenu();
      return;
    }
    if (event.key === "Tab") {
      closeComposerMenu();
      return;
    }
    if ((event.target as HTMLElement).matches("input") && !["ArrowDown", "ArrowUp"].includes(event.key)) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"));
    if (!controls.length) return;
    event.preventDefault();
    const current = controls.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1
      : event.key === "ArrowDown" ? (current + 1) % controls.length
      : current < 0 ? controls.length - 1 : (current - 1 + controls.length) % controls.length;
    controls[next].focus({ preventScroll: true });
    controls[next].scrollIntoView({ block: "nearest" });
  };

  useEffect(() => {
    if (openMenu !== "project") setProjectQuery("");
    if (!openMenu || openMenu === "model") return;
    const updateBounds = () => {
      const menu = menuRef.current;
      const trigger = menuTriggersRef.current[openMenu];
      if (!menu || !trigger) return;
      menu.style.maxHeight = `${Math.max(0, trigger.getBoundingClientRect().top - 16)}px`;
      menu.style.left = "";
      const rect = menu.getBoundingClientRect();
      const shift = Math.max(8 - rect.left, Math.min(0, window.innerWidth - 8 - rect.right));
      if (shift) menu.style.left = `${shift}px`;
    };
    updateBounds();
    window.addEventListener("resize", updateBounds);
    const frame = requestAnimationFrame(() => {
      const controls = menuRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
      controls?.[focusLastMenuItemRef.current ? controls.length - 1 : 0]?.focus({ preventScroll: true });
      focusLastMenuItemRef.current = false;
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateBounds);
    };
  }, [openMenu]);

  const stopDictation = (updateState = true) => {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      rec.onresult = null; rec.onerror = null; rec.onend = null;
      try { rec.abort(); } catch { /* The browser may already have stopped. */ }
    }
    if (updateState) setIsDictating(false);
  };

  useEffect(() => {
    setIsDictating(false); setDictationError(null);
    return () => stopDictation(false);
  }, [dictationSessionKey]);

  // Browser fallback; official authenticated voice services are not connected.
  const toggleDictation = () => {
    if (recognitionRef.current) { stopDictation(); return; }
    const SpeechRec =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRec) {
      setDictationError("当前环境不支持浏览器 Web Speech 听写。");
      return;
    }
    setDictationError(null);
    try {
      const rec = new SpeechRec();
      recognitionRef.current = rec;
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language;
      const key = dictationContext.current.key;
      const prefix = dictationContext.current.prompt;
      let expected = prefix;
      rec.onresult = (event: any) => {
        if (recognitionRef.current !== rec || dictationContext.current.key !== key) return;
        if (dictationContext.current.prompt !== expected) { stopDictation(); return; }
        let transcript = "";
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        expected = `${prefix}${prefix && transcript ? " " : ""}${transcript}`;
        dictationContext.current.prompt = expected;
        onPromptInputChange(expected);
      };
      rec.onerror = (e: any) => {
        if (recognitionRef.current !== rec || dictationContext.current.key !== key) return;
        setDictationError(`浏览器听写失败：${e.error || "未知错误"}`);
        stopDictation();
      };
      rec.onend = () => {
        if (recognitionRef.current === rec && dictationContext.current.key === key) stopDictation();
      };
      rec.start();
      if (recognitionRef.current === rec) setIsDictating(true);
    } catch (err) {
      stopDictation();
      setDictationError(`无法启动浏览器听写：${String(err)}`);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isTauriRuntime()) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedItems: AttachedFileItem[] = [];
      let missingPath = false;
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        const filePath = (file as any).path;
        if (typeof filePath !== "string" || !/^(?:[a-z]:[\\/]|[\\/])/i.test(filePath)) {
          missingPath = true;
          continue;
        }
        droppedItems.push(createAttachedFileItem(filePath, file.name));
      }
      setDropError(missingPath ? "无法读取拖入文件的路径，请使用附件按钮添加。" : null);
      if (droppedItems.length > 0) {
        if (onAddAttachedFiles) {
          onAddAttachedFiles(droppedItems);
        }
      }
    }
  };

  // Autocomplete (@ and /)
  const [autocompleteMode, setAutocompleteMode] = useState<"slash" | "mention" | null>(null);
  const [autocompleteQuery, setAutocompleteQuery] = useState("");
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);

  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/webview").then(async ({ getCurrentWebview }) => {
      const off = await getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (disposed) return;
        if (payload.type === "leave") {
          setIsDragging(false);
          return;
        }
        const rect = boxRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = payload.position.x / window.devicePixelRatio;
        const y = payload.position.y / window.devicePixelRatio;
        const inside = x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
        setIsDragging(payload.type !== "drop" && inside);
        if (payload.type === "drop" && inside && payload.paths.length > 0) {
          setDropError(null);
          onAddAttachedFilesRef.current?.(payload.paths.map(path => createAttachedFileItem(path)));
        }
      });
      if (disposed) off();
      else unlisten = off;
    }).catch(error => console.warn("Composer native drag/drop listener failed:", error));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const activePermission =
    PERMISSION_OPTIONS.find((p) => p.id === permissionMode) || PERMISSION_OPTIONS[0];

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    onPromptInputChange(val);

    if (val.startsWith("/") && !val.includes(" ")) {
      setAutocompleteMode("slash");
      setAutocompleteQuery(val);
      setAutocompleteIndex(0);
    } else {
      const mentionMatch = val.match(/(?:^|\s)@([^\s@]*)$/);
      if (mentionMatch) {
        setAutocompleteMode("mention");
        setAutocompleteQuery(mentionMatch[1] || "");
        setAutocompleteIndex(0);
      } else {
        setAutocompleteMode(null);
      }
    }
  };

  const handleAutocompleteSelect = (item: AutocompleteItem) => {
    if (item.action && onSlashAction) {
      onSlashAction(item.action);
      if (!item.insertText) {
        onPromptInputChange("");
        setAutocompleteMode(null);
        return;
      }
    }
    if (item.type === "slash") {
      onPromptInputChange(item.insertText);
    } else {
      onPromptInputChange(
        promptInput.replace(/@[^\s@]*$/, item.insertText)
      );
    }
    setAutocompleteMode(null);
    actualTextareaRef.current?.focus();
  };

  const autocompleteItems = React.useMemo(() => autocompleteMode
    ? getAutocompleteItems(autocompleteMode, autocompleteQuery, workspaceFiles, workspaceFileHits, skills)
    : [], [autocompleteMode, autocompleteQuery, workspaceFiles, workspaceFileHits, skills]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (autocompleteMode && autocompleteItems.length > 0) {
      if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleAutocompleteSelect(autocompleteItems[Math.min(Math.max(0, autocompleteIndex), autocompleteItems.length - 1)]);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAutocompleteIndex((i) => i + 1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAutocompleteIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAutocompleteMode(null);
        return;
      }
    }
    if (e.key !== "Enter" || e.altKey) return;
    const modifier = e.metaKey || e.ctrlKey;
    if (e.repeat && modifier) {
      e.preventDefault();
      return;
    }
    const shouldQueue = isStreaming && modifier &&
      (composerEnterBehavior === "enter" ? !e.shiftKey : e.shiftKey);
    if (shouldQueue) {
      e.preventDefault();
      onQueueMessage();
      return;
    }
    const shouldSend =
      !e.shiftKey && (modifier || composerEnterBehavior === "enter" ||
        (composerEnterBehavior === "cmdIfMultiline" && !promptInput.includes("\n")));

    if (shouldSend) {
      e.preventDefault();
      onSendMessage();
    }
  };

  const projectName =
    activeWorkspace?.label?.trim() ||
    (activeWorkspace?.path ? baseNameFsPath(activeWorkspace.path) || activeWorkspace.path : "选择项目");

  const currentBranch = gitStatus?.branch || "main";
  const filteredWorkspaces = workspaces.filter(ws =>
    `${ws.label} ${ws.path}`.toLocaleLowerCase().includes(projectQuery.trim().toLocaleLowerCase()));

  return (
    <div
      className={`codex-two-tier-composer ${variant} ${isDragging ? "dragging-over" : ""}`}
      ref={boxRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ position: "relative" }}
    >
      {isDragging && (
        <div className="composer-drag-drop-overlay">
          <span>📎 释放鼠标以附带文件或图像至当前对话</span>
        </div>
      )}
      {/* ── Tier 1: Attached Top Context Bar (Matches ref-1-home.png) ── */}
      <div className="composer-context-topbar">
        <div className="composer-context-left">
          {/* 1. Project Pill */}
          <div className="composer-dropdown-anchor">
            <button
              ref={(node) => { menuTriggersRef.current.project = node; }}
              type="button"
              className="composer-top-chip"
              aria-haspopup="menu"
              aria-expanded={openMenu === "project"}
              aria-controls={openMenu === "project" ? "composer-project-menu" : undefined}
              onKeyDown={(event) => handleComposerTriggerKeys(event, "project")}
              onClick={() => setOpenMenu((m) => (m === "project" ? null : "project"))}
              title={activeWorkspace?.path ? `当前项目: ${activeWorkspace.path}` : "选择一个项目来运行聊天"}
            >
              <FolderIcon size={13} />
              <span>{projectName}</span>
            </button>

            {openMenu === "project" && (
              <div id="composer-project-menu" ref={menuRef} role="menu" aria-label="选择项目" className="composer-popover-menu top-left" onKeyDown={handleComposerMenuKeys}>
                <div className="popover-section-label">切换项目工作区</div>
                <input
                  className="popover-search-input"
                  aria-label="搜索项目"
                  placeholder="搜索项目"
                  value={projectQuery}
                  onChange={(event) => setProjectQuery(event.target.value)}
                />
                {filteredWorkspaces.map((ws) => {
                  const isCurrent = ws.path === activeWorkspace?.path;
                  return (
                    <button
                      key={ws.path}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isCurrent}
                      className={`popover-menu-item ${isCurrent ? "selected" : ""}`}
                      onClick={() => {
                        onSelectWorkspace(ws.path);
                        closeComposerMenu();
                      }}
                    >
                      <div className="popover-item-body">
                        <span className="popover-item-title">{ws.label?.trim() || baseNameFsPath(ws.path) || ws.path}</span>
                        <span className="popover-item-desc">{ws.path}</span>
                      </div>
                      {isCurrent && <CheckIcon size={13} />}
                    </button>
                  );
                })}
                {filteredWorkspaces.length === 0 && <div role="status" className="popover-section-label">未找到项目</div>}
                <div className="popover-divider" />
                <button
                  type="button"
                  role="menuitem"
                  className="popover-menu-item"
                  onClick={() => {
                    closeComposerMenu();
                    onPickNewFolder();
                  }}
                >
                  <div className="popover-item-header">
                    <PlusIcon size={13} />
                    <span className="popover-item-title">添加本地项目文件夹...</span>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* 2. Local / Worktree Environment Pill */}
          <div className="composer-dropdown-anchor">
            <button
              ref={(node) => { menuTriggersRef.current.env = node; }}
              type="button"
              className={`composer-top-chip ${useWorktree ? "worktree-active" : ""}`}
              aria-haspopup="menu"
              aria-expanded={openMenu === "env"}
              aria-controls={openMenu === "env" ? "composer-env-menu" : undefined}
              onKeyDown={(event) => handleComposerTriggerKeys(event, "env")}
              onClick={() => setOpenMenu((m) => (m === "env" ? null : "env"))}
              title="选择聊天运行位置"
            >
              {useWorktree ? <WorktreeIcon size={13} /> : <LaptopIcon size={13} />}
              <span>{useWorktree ? "新工作树" : "本地"}</span>
              <ChevronDownIcon size={11} />
            </button>

            {openMenu === "env" && (
              <div id="composer-env-menu" ref={menuRef} role="menu" aria-label="选择聊天运行位置" className="composer-popover-menu top-left" onKeyDown={handleComposerMenuKeys}>
                <div className="popover-section-label">启动位置 (Start in)</div>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={!useWorktree}
                  className={`popover-menu-item ${!useWorktree ? "selected" : ""}`}
                  onClick={() => {
                    onSetUseWorktree(false);
                    closeComposerMenu();
                  }}
                >
                  <div className="popover-item-body">
                    <div className="popover-item-header">
                      <LaptopIcon size={14} />
                      <span className="popover-item-title">本地 (Work locally)</span>
                    </div>
                    <span className="popover-item-desc">直接在当前项目目录中读取与修改代码</span>
                  </div>
                  {!useWorktree && <CheckIcon size={13} />}
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={useWorktree}
                  className={`popover-menu-item ${useWorktree ? "selected" : ""}`}
                  onClick={() => {
                    onSetUseWorktree(true);
                    closeComposerMenu();
                  }}
                >
                  <div className="popover-item-body">
                    <div className="popover-item-header">
                      <WorktreeIcon size={14} />
                      <span className="popover-item-title">新工作树 (New worktree)</span>
                    </div>
                    <span className="popover-item-desc">创建隔离的 Git Worktree 副本，互不干扰</span>
                  </div>
                  {useWorktree && <CheckIcon size={13} />}
                </button>
              </div>
            )}
          </div>

          {variant === "thread" && (
          <div className="composer-dropdown-anchor">
            <button
              ref={(node) => { menuTriggersRef.current.branch = node; }}
              type="button"
              className="composer-top-chip"
              aria-haspopup="menu"
              aria-expanded={openMenu === "branch"}
              aria-controls={openMenu === "branch" ? "composer-branch-menu" : undefined}
              onKeyDown={(event) => handleComposerTriggerKeys(event, "branch")}
              onClick={() => setOpenMenu((m) => (m === "branch" ? null : "branch"))}
              title="切换或新建 Git 分支"
            >
              <BranchIcon size={13} />
              <span>{currentBranch}</span>
              <ChevronDownIcon size={11} />
            </button>

            {openMenu === "branch" && (
              <div id="composer-branch-menu" ref={menuRef} role="menu" aria-label="切换或新建 Git 分支" className="composer-popover-menu top-left" style={{ minWidth: 250 }} onKeyDown={handleComposerMenuKeys}>
                <div className="popover-section-label">切换分支 (Switch branch)</div>
                <div style={{ maxHeight: 180, overflowY: "auto" }}>
                  {(gitBranches.length > 0 ? gitBranches : [currentBranch]).map((b) => {
                    const isCurrent = b === currentBranch;
                    return (
                      <button
                        key={b}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isCurrent}
                        className={`popover-menu-item ${isCurrent ? "selected" : ""}`}
                        onClick={() => {
                          onSwitchBranch(b);
                          closeComposerMenu();
                        }}
                      >
                        <div className="popover-item-header">
                          <BranchIcon size={13} />
                          <span className="popover-item-title">{b}</span>
                        </div>
                        {isCurrent && <CheckIcon size={13} />}
                      </button>
                    );
                  })}
                </div>
                <div className="popover-divider" />
                <div style={{ display: "flex", gap: 6, padding: "4px 4px 2px" }}>
                  <input
                    type="text"
                    className="popover-search-input"
                    style={{ marginBottom: 0, flex: 1 }}
                    placeholder="新建分支名 (如 codex/feat)..."
                    value={newBranchInput}
                    onChange={(e) => setNewBranchInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229 || e.repeat) return;
                      if (e.key === "Enter" && newBranchInput.trim()) {
                        e.preventDefault();
                        e.stopPropagation();
                        onCreateBranch(newBranchInput.trim());
                        setNewBranchInput("");
                        closeComposerMenu();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn-approve"
                    disabled={!newBranchInput.trim()}
                    style={{ padding: "4px 10px", fontSize: "calc(11.5px * var(--font-ui-scale, 1))" }}
                    onClick={() => {
                      if (newBranchInput.trim()) {
                        onCreateBranch(newBranchInput.trim());
                        setNewBranchInput("");
                        closeComposerMenu();
                      }
                    }}
                  >
                    创建
                  </button>
                </div>
              </div>
            )}
          </div>
          )}
        </div>

        {/* Right indicators on top bar */}
        <div className="composer-context-right">
          {variant === "home" && (
            <label className="composer-worktree-toggle">
              <span>工作树</span>
              <input
                type="checkbox"
                checked={useWorktree}
                onChange={(event) => onSetUseWorktree(event.target.checked)}
              />
            </label>
          )}
          {planMode && (
            <span className="composer-mode-badge plan" onClick={onTogglePlanMode} title="点击关闭计划模式">
              🗺️ 计划模式
            </span>
          )}
          {fastMode && (
            <span className="composer-mode-badge fast" onClick={onToggleFastMode} title="点击关闭极速模式">
              ⚡ Fast
            </span>
          )}
        </div>
      </div>

      {/* ── Tier 2: Inner Input Surface ── */}
      <div className="composer-inner-surface" style={{ position: "relative" }}>
        {autocompleteMode && (
          <ComposerAutocomplete
            items={autocompleteItems}
            selectedIndex={autocompleteIndex}
            onSelect={handleAutocompleteSelect}
            onClose={() => setAutocompleteMode(null)}
          />
        )}

        {/* Attached File Chips */}
        {dropError && <div role="alert">{dropError}</div>}
        {attachedFiles.length > 0 && (
          <div className="composer-attachments-row">
            {attachedFiles.map((file) => (
              <ComposerAttachmentChip
                key={file.id}
                file={file}
                onRemove={() => onRemoveAttachedFile(file.id)}
              />
            ))}
          </div>
        )}

        <textarea
          ref={actualTextareaRef}
          className="composer-textarea"
          rows={variant === "home" ? 2 : 2}
          placeholder={
            planMode
              ? "计划模式：描述你想实现的目标，Codex 将先分步制定计划再执行..."
              : variant === "home"
              ? "随心输入"
              : isStreaming
              ? "输入后续引导或排队消息..."
              : "随心输入 (@ 引用文件或技能，/ 快捷命令)"
          }
          value={promptInput}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPointerDown={() => setOpenMenu(null)}
        />

        {/* Bottom Controls inside Input Surface */}
        <div className="composer-bottom-bar">
          {/* Left: + button & Permission Pill */}
          <div className="composer-bottom-left">
            <div className="composer-dropdown-anchor">
              <button
                ref={(node) => { menuTriggersRef.current.plus = node; }}
                type="button"
                className="composer-icon-circle-btn"
                aria-haspopup="menu"
                aria-expanded={openMenu === "plus"}
                aria-controls={openMenu === "plus" ? "composer-plus-menu" : undefined}
                onKeyDown={(event) => handleComposerTriggerKeys(event, "plus")}
                onClick={() => setOpenMenu((m) => (m === "plus" ? null : "plus"))}
                title="添加文件、照片或切换模式"
              >
                <PlusIcon size={16} />
              </button>

              {openMenu === "plus" && (
                <div id="composer-plus-menu" ref={menuRef} role="menu" aria-label="添加文件、照片或切换模式" className="composer-popover-menu bottom-left" style={{ minWidth: 230 }} onKeyDown={handleComposerMenuKeys}>
                  <button
                    type="button"
                    role="menuitem"
                    className="popover-menu-item"
                    onClick={() => {
                      closeComposerMenu();
                      onAttachFiles();
                    }}
                  >
                    <div className="popover-item-header">
                      <PaperclipIcon size={14} />
                      <span className="popover-item-title">添加文件或图像...</span>
                    </div>
                  </button>
                  {onAppshot && (
                    <button
                      type="button"
                      role="menuitem"
                      className="popover-menu-item"
                      onClick={() => {
                        closeComposerMenu();
                        onAppshot();
                      }}
                    >
                      <div className="popover-item-header">
                        <CameraIcon size={14} />
                        <span className="popover-item-title">截屏（主屏幕）</span>
                      </div>
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="popover-menu-item"
                    onClick={() => {
                      closeComposerMenu();
                      onPromptInputChange(promptInput + (promptInput ? " " : "") + "@电脑 ");
                      actualTextareaRef.current?.focus();
                    }}
                  >
                    <div className="popover-item-header">
                      <LaptopIcon size={14} />
                      <span className="popover-item-title">操控桌面应用 (@电脑)</span>
                    </div>
                  </button>
                  <div className="popover-divider" />
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={planMode}
                    className={`popover-menu-item ${planMode ? "selected" : ""}`}
                    onClick={() => {
                      onTogglePlanMode();
                      closeComposerMenu();
                    }}
                  >
                    <div className="popover-item-header">
                      <SparklesIcon size={14} />
                      <span className="popover-item-title">计划模式 (Plan Mode)</span>
                    </div>
                    {planMode && <CheckIcon size={13} />}
                  </button>
                </div>
              )}
            </div>

            <div className="composer-dropdown-anchor">
              <button
                ref={(node) => {
                  menuTriggersRef.current.permission = node;
                }}
                type="button"
                className={`composer-inline-pill ${
                  permissionMode === "full" ? "danger-accent" : ""
                }`}
                aria-label="更改权限"
                aria-haspopup="menu"
                aria-expanded={openMenu === "permission"}
                aria-controls={openMenu === "permission" ? "composer-permission-menu" : undefined}
                onKeyDown={(event) => handleComposerTriggerKeys(event, "permission")}
                onClick={() =>
                  setOpenMenu((m) => (m === "permission" ? null : "permission"))
                }
                title="更改权限"
              >
                {permissionMode === "full" ? (
                  <ShieldIcon size={14} />
                ) : (
                  <HandApprovalIcon size={14} />
                )}
                <span>{activePermission.shortLabel}</span>
                <ChevronDownIcon size={11} />
              </button>

              {openMenu === "permission" && (
                <div
                  id="composer-permission-menu"
                  ref={menuRef}
                  className="composer-popover-menu bottom-left permission-popover"
                  role="menu"
                  aria-label="更改权限"
                  onKeyDown={handleComposerMenuKeys}
                >
                  <div className="permission-popover-heading">应如何批准 ChatGPT 操作？</div>
                  {PERMISSION_OPTIONS.map((opt) => {
                    const isSelected = opt.id === permissionMode;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isSelected}
                        className={`popover-menu-item permission-option ${isSelected ? "selected" : ""} ${opt.id === "full" ? "danger" : ""}`}
                        onClick={() => {
                          onSelectPermissionMode(opt.id);
                          closeComposerMenu();
                        }}
                      >
                        <div className="popover-item-body">
                          <span className="popover-item-title">{opt.title}</span>
                          <span className="popover-item-desc">{opt.desc}</span>
                        </div>
                        {isSelected && <CheckIcon size={13} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: Combined Model+Effort Dropdown + Mic + Send */}
          <div className="composer-bottom-right">
            <ModelSelector
              models={models}
              modelsLoading={modelsLoading}
              modelsError={modelsError}
              onRefreshModels={onRefreshModels}
              selectedModelId={selectedModelId}
              defaultModelSelected={defaultModelSelected}
              reasoningEffort={reasoningEffort}
              fastMode={fastMode}
              open={openMenu === "model"}
              onOpenChange={(open) => setOpenMenu(open ? "model" : null)}
              onSelectModel={onSelectModel}
              onSelectReasoningEffort={onSelectReasoningEffort}
              onToggleFastMode={onToggleFastMode}
            />

            {/* Mic / Voice Dictation Button */}
            <button
              type="button"
              className={`composer-icon-circle-btn ${isDictating ? "dictating" : ""}`}
              onClick={toggleDictation}
              aria-pressed={isDictating}
              title={isDictating ? "停止浏览器听写" : "浏览器 Web Speech 听写（回退）"}
            >
              <MicIcon size={15} />
            </button>
            {dictationError && <span role="alert">{dictationError}</span>}

            {/* Send / Stop Button */}
            {isStreaming ? (
              <button
                type="button"
                className="stop-action-btn"
                onClick={onInterruptTurn}
                title="停止当前任务"
              >
                <StopIcon size={13} />
              </button>
            ) : (
              <button
                type="button"
                className="send-action-btn"
                disabled={!promptInput.trim() && attachedFiles.length === 0}
                onClick={() => onSendMessage()}
                title={composerEnterBehavior === "cmdAlways" || (composerEnterBehavior === "cmdIfMultiline" && promptInput.includes("\n")) ? "发送 (Ctrl+Enter)" : "发送 (Enter)"}
              >
                <SendIcon size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

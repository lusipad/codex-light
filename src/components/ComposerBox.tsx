import React, { useEffect, useRef, useState } from "react";
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
import { ComposerAutocomplete, AutocompleteItem } from "./ComposerAutocomplete";

export interface ComposerBoxProps {
  variant: "home" | "thread";
  promptInput: string;
  onPromptInputChange: (val: string) => void;
  onSendMessage: () => void;
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
  selectedModelId: string;
  onSelectModelId: (id: string) => void;
  reasoningEffort: string;
  onSelectReasoningEffort: (effort: string) => void;
  fastMode: boolean;
  onToggleFastMode: () => void;
  planMode: boolean;
  onTogglePlanMode: () => void;
  // Attachments & Autocomplete
  attachedFiles: AttachedFileItem[];
  onAttachFiles: () => void;
  onAddAttachedFiles?: (files: AttachedFileItem[]) => void;
  onRemoveAttachedFile: (id: string) => void;
  workspaceFiles: string[];
  workspaceFileHits: WorkspaceFileHit[];
  skills: SkillInfoItem[];
  onSlashAction?: (action: string) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

const DEFAULT_MODELS: ModelInfo[] = [
  {
    id: "gpt-6.1-sol",
    displayName: "6.1 Sol",
    description: "超低延迟敏捷编码模型，适合日常快速修改与调试",
    tags: ["极速"],
  },
  {
    id: "gpt-6-astra",
    displayName: "6 Astra",
    description: "最强大的旗舰级深度推理与全栈工程架构模型",
    tags: ["旗舰"],
  },
  {
    id: "gpt-5.4",
    displayName: "GPT-5.4",
    description: "均衡全能旗舰编码模型，擅长多文件协同与代码审查",
    tags: ["推荐"],
  },
  {
    id: "gpt-5.3-codex",
    displayName: "5.3 Codex",
    description: "针对代码补丁、单测生成与命令执行深度优化的编码模型",
    tags: ["代码"],
  },
];

const EFFORT_OPTIONS = [
  { id: "low", shortLabel: "轻度", fullLabel: "轻度 (Low)", desc: "快速响应，轻量级推理" },
  { id: "medium", shortLabel: "中等", fullLabel: "中等 (Medium)", desc: "平衡速度与推理深度" },
  { id: "high", shortLabel: "高", fullLabel: "高 (High)", desc: "深度推演复杂逻辑与边界" },
  { id: "xhigh", shortLabel: "极高", fullLabel: "极高 (xHigh)", desc: "高强度推理，适合疑难重构" },
  { id: "max", shortLabel: "最高", fullLabel: "最高 (Max)", desc: "最大推理深度，适合最难的问题" },
  { id: "ultra", shortLabel: "极限", fullLabel: "极限 (Ultra)", desc: "最大推理深度并自动委派子任务" },
];

const PERMISSION_OPTIONS: Array<{
  id: "ask" | "auto" | "full";
  shortLabel: string;
  title: string;
  desc: string;
}> = [
  {
    id: "ask",
    shortLabel: "请求批准",
    title: "默认权限（请求批准）",
    desc: "读取工作区文件，运行命令或写入文件前请求批准",
  },
  {
    id: "auto",
    shortLabel: "自动",
    title: "自动（工作区读写）",
    desc: "允许在当前工作区内自动修改文件并执行安全命令",
  },
  {
    id: "full",
    shortLabel: "完整访问权限",
    title: "完整访问权限 (Full Access)",
    desc: "无沙盒限制自主执行命令、访问外部目录与网络",
  },
];

function formatShortModelName(model: ModelInfo): string {
  const name = model.displayName || model.id;
  return name.replace(/^GPT-/i, "");
}

export const ComposerBox: React.FC<ComposerBoxProps> = ({
  variant,
  promptInput,
  onPromptInputChange,
  onSendMessage,
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
  selectedModelId,
  onSelectModelId,
  reasoningEffort,
  onSelectReasoningEffort,
  fastMode,
  onToggleFastMode,
  planMode,
  onTogglePlanMode,
  attachedFiles,
  onAttachFiles,
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

  const [openMenu, setOpenMenu] = useState<
    "project" | "env" | "branch" | "plus" | "permission" | "model" | null
  >(null);
  const [newBranchInput, setNewBranchInput] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [isDictating, setIsDictating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Toggle real Speech Recognition
  const toggleDictation = () => {
    const SpeechRec =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRec) {
      alert("当前环境不支持 Web Speech 语音听写，请在支持麦克风权限的浏览器/WebView中使用。");
      return;
    }

    if (isDictating) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
        recognitionRef.current = null;
      }
      setIsDictating(false);
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "zh-CN";

      let accumulated = promptInput ? promptInput + " " : "";

      rec.onresult = (event: any) => {
        let interim = "";
        let finalTrans = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTrans += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        const spoken = (accumulated + finalTrans + interim).trim();
        if (spoken) {
          onPromptInputChange(spoken);
        }
      };

      rec.onerror = (e: any) => {
        console.warn("Speech recognition error:", e);
        setIsDictating(false);
      };

      rec.onend = () => {
        setIsDictating(false);
      };

      rec.start();
      recognitionRef.current = rec;
      setIsDictating(true);
    } catch (err) {
      console.warn("Failed to start speech recognition:", err);
      setIsDictating(false);
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

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedItems: AttachedFileItem[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        const filePath = (file as any).path || file.name;
        const isImage = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(file.name);
        droppedItems.push({
          id: `${file.name}-${Date.now()}-${i}`,
          name: file.name,
          path: filePath,
          kind: isImage ? "image" : "file",
        });
      }
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
    function handleOutsideClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const allModels = React.useMemo(() => {
    const map = new Map<string, ModelInfo>();
    for (const m of DEFAULT_MODELS) {
      map.set(m.id, m);
    }
    for (const m of models) {
      map.set(m.id, {
        ...map.get(m.id),
        ...m,
        displayName: m.displayName || map.get(m.id)?.displayName || m.id,
      });
    }
    return Array.from(map.values());
  }, [models]);

  const activeModel = allModels.find((m) => m.id === selectedModelId) || {
    id: selectedModelId,
    displayName: selectedModelId,
  };

  const activeEffort =
    EFFORT_OPTIONS.find((e) => e.id === reasoningEffort) || EFFORT_OPTIONS[0];

  const activePermission =
    PERMISSION_OPTIONS.find((p) => p.id === permissionMode) || PERMISSION_OPTIONS[0];

  const filteredModels = React.useMemo(() => {
    if (!modelSearch.trim()) return allModels;
    const q = modelSearch.toLowerCase();
    return allModels.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        (m.displayName && m.displayName.toLowerCase().includes(q)) ||
        (m.description && m.description.toLowerCase().includes(q))
    );
  }, [allModels, modelSearch]);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (autocompleteMode) {
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
  };

  const projectName =
    activeWorkspace?.label ||
    activeWorkspace?.path?.split(/[/\\]/).pop() ||
    "codex-app-offline";

  const currentBranch = gitStatus?.branch || "main";

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
              type="button"
              className="composer-top-chip"
              onClick={() => setOpenMenu((m) => (m === "project" ? null : "project"))}
              title={`当前项目: ${activeWorkspace?.path || projectName}`}
            >
              <FolderIcon size={13} />
              <span>{projectName}</span>
            </button>

            {openMenu === "project" && (
              <div className="composer-popover-menu top-left">
                <div className="popover-section-label">切换项目工作区</div>
                {workspaces.map((ws) => {
                  const isCurrent = ws.path === activeWorkspace?.path;
                  return (
                    <div
                      key={ws.path}
                      className={`popover-menu-item ${isCurrent ? "selected" : ""}`}
                      onClick={() => {
                        onSelectWorkspace(ws.path);
                        setOpenMenu(null);
                      }}
                    >
                      <div className="popover-item-body">
                        <span className="popover-item-title">{ws.label}</span>
                        <span className="popover-item-desc">{ws.path}</span>
                      </div>
                      {isCurrent && <CheckIcon size={13} />}
                    </div>
                  );
                })}
                <div className="popover-divider" />
                <div
                  className="popover-menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    onPickNewFolder();
                  }}
                >
                  <div className="popover-item-header">
                    <PlusIcon size={13} />
                    <span className="popover-item-title">添加本地项目文件夹...</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 2. Local / Worktree Environment Pill */}
          <div className="composer-dropdown-anchor">
            <button
              type="button"
              className={`composer-top-chip ${useWorktree ? "worktree-active" : ""}`}
              onClick={() => setOpenMenu((m) => (m === "env" ? null : "env"))}
              title="选择聊天运行位置"
            >
              {useWorktree ? <WorktreeIcon size={13} /> : <LaptopIcon size={13} />}
              <span>{useWorktree ? "新工作树" : "本地"}</span>
              <ChevronDownIcon size={11} />
            </button>

            {openMenu === "env" && (
              <div className="composer-popover-menu top-left">
                <div className="popover-section-label">启动位置 (Start in)</div>
                <div
                  className={`popover-menu-item ${!useWorktree ? "selected" : ""}`}
                  onClick={() => {
                    onSetUseWorktree(false);
                    setOpenMenu(null);
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
                </div>
                <div
                  className={`popover-menu-item ${useWorktree ? "selected" : ""}`}
                  onClick={() => {
                    onSetUseWorktree(true);
                    setOpenMenu(null);
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
                </div>
              </div>
            )}
          </div>

          {/* 3. Git Branch Pill */}
          <div className="composer-dropdown-anchor">
            <button
              type="button"
              className="composer-top-chip"
              onClick={() => setOpenMenu((m) => (m === "branch" ? null : "branch"))}
              title="切换或新建 Git 分支"
            >
              <BranchIcon size={13} />
              <span>{currentBranch}</span>
              <ChevronDownIcon size={11} />
            </button>

            {openMenu === "branch" && (
              <div className="composer-popover-menu top-left" style={{ minWidth: 250 }}>
                <div className="popover-section-label">切换分支 (Switch branch)</div>
                <div style={{ maxHeight: 180, overflowY: "auto" }}>
                  {(gitBranches.length > 0 ? gitBranches : [currentBranch]).map((b) => {
                    const isCurrent = b === currentBranch;
                    return (
                      <div
                        key={b}
                        className={`popover-menu-item ${isCurrent ? "selected" : ""}`}
                        onClick={() => {
                          onSwitchBranch(b);
                          setOpenMenu(null);
                        }}
                      >
                        <div className="popover-item-header">
                          <BranchIcon size={13} />
                          <span className="popover-item-title">{b}</span>
                        </div>
                        {isCurrent && <CheckIcon size={13} />}
                      </div>
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
                      if (e.key === "Enter" && newBranchInput.trim()) {
                        onCreateBranch(newBranchInput.trim());
                        setNewBranchInput("");
                        setOpenMenu(null);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn-approve"
                    style={{ padding: "4px 10px", fontSize: 11.5 }}
                    onClick={() => {
                      if (newBranchInput.trim()) {
                        onCreateBranch(newBranchInput.trim());
                        setNewBranchInput("");
                        setOpenMenu(null);
                      }
                    }}
                  >
                    创建
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right indicators on top bar */}
        <div className="composer-context-right">
          <button
            type="button"
            className="composer-mode-badge goal-pill"
            onClick={() => onSlashAction?.("open_goal_dialog")}
            title="启动自主目标模式 (/goal)"
            style={{
              cursor: "pointer",
              background: "rgba(16, 185, 129, 0.12)",
              color: "#10b981",
              border: "1px solid rgba(16, 185, 129, 0.28)",
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            🎯 目标模式
          </button>
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
            mode={autocompleteMode}
            query={autocompleteQuery}
            files={workspaceFiles}
            fileHits={workspaceFileHits}
            skills={skills}
            selectedIndex={autocompleteIndex}
            onSelect={handleAutocompleteSelect}
            onClose={() => setAutocompleteMode(null)}
          />
        )}

        {/* Attached File Chips */}
        {attachedFiles.length > 0 && (
          <div className="composer-attachments-row">
            {attachedFiles.map((file) => (
              <div key={file.id} className="composer-attachment-chip" title={file.path}>
                <PaperclipIcon size={12} />
                <span className="attachment-chip-name">{file.name}</span>
                <button
                  type="button"
                  className="attachment-chip-remove"
                  onClick={() => onRemoveAttachedFile(file.id)}
                >
                  <CloseIcon size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={actualTextareaRef}
          className="composer-textarea"
          rows={variant === "home" ? 2 : 2}
          placeholder={
            variant === "home"
              ? "随心输入"
              : isStreaming
              ? "输入后续引导或排队消息... (Enter 立即引导 / Alt+Enter 加入队列)"
              : "随心输入 (@ 引用文件或电脑，/ 快捷命令)"
          }
          value={promptInput}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
        />

        {/* Bottom Controls inside Input Surface */}
        <div className="composer-bottom-bar">
          {/* Left: + button & Permission Pill */}
          <div className="composer-bottom-left">
            <div className="composer-dropdown-anchor">
              <button
                type="button"
                className="composer-icon-circle-btn"
                onClick={() => setOpenMenu((m) => (m === "plus" ? null : "plus"))}
                title="添加文件、照片或切换模式"
              >
                <PlusIcon size={16} />
              </button>

              {openMenu === "plus" && (
                <div className="composer-popover-menu bottom-left" style={{ minWidth: 230 }}>
                  <div
                    className="popover-menu-item"
                    onClick={() => {
                      setOpenMenu(null);
                      onAttachFiles();
                    }}
                  >
                    <div className="popover-item-header">
                      <PaperclipIcon size={14} />
                      <span className="popover-item-title">添加文件或图像...</span>
                    </div>
                  </div>
                  <div
                    className="popover-menu-item"
                    onClick={() => {
                      setOpenMenu(null);
                      onPromptInputChange(promptInput + (promptInput ? " " : "") + "@电脑 ");
                      actualTextareaRef.current?.focus();
                    }}
                  >
                    <div className="popover-item-header">
                      <LaptopIcon size={14} />
                      <span className="popover-item-title">操控桌面应用 (@电脑)</span>
                    </div>
                  </div>
                  <div className="popover-divider" />
                  <div
                    className={`popover-menu-item ${planMode ? "selected" : ""}`}
                    onClick={() => {
                      onTogglePlanMode();
                      setOpenMenu(null);
                    }}
                  >
                    <div className="popover-item-header">
                      <SparklesIcon size={14} />
                      <span className="popover-item-title">计划模式 (Plan Mode)</span>
                    </div>
                    {planMode && <CheckIcon size={13} />}
                  </div>
                  <div
                    className="popover-menu-item"
                    onClick={() => {
                      onSlashAction?.("open_goal_dialog");
                      setOpenMenu(null);
                    }}
                  >
                    <div className="popover-item-header">
                      <span style={{ fontSize: 13, marginRight: 2 }}>🎯</span>
                      <span className="popover-item-title">自主目标模式 (/goal)</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Permission Mode Pill (Matches "✋ 请求批准 ⌄" in ref-1-home.png) */}
            <div className="composer-dropdown-anchor">
              <button
                type="button"
                className={`composer-inline-pill ${
                  permissionMode === "full" ? "danger-accent" : ""
                }`}
                onClick={() =>
                  setOpenMenu((m) => (m === "permission" ? null : "permission"))
                }
                title="沙盒与命令批准策略"
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
                <div className="composer-popover-menu bottom-left" style={{ minWidth: 290 }}>
                  <div className="popover-section-label">权限模式 (Permissions)</div>
                  {PERMISSION_OPTIONS.map((opt) => {
                    const isSelected = opt.id === permissionMode;
                    return (
                      <div
                        key={opt.id}
                        className={`popover-menu-item ${isSelected ? "selected" : ""}`}
                        onClick={() => {
                          onSelectPermissionMode(opt.id);
                          setOpenMenu(null);
                        }}
                      >
                        <div className="popover-item-body">
                          <span className="popover-item-title">{opt.title}</span>
                          <span className="popover-item-desc">{opt.desc}</span>
                        </div>
                        {isSelected && <CheckIcon size={14} />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: Combined Model+Effort Dropdown + Mic + Send */}
          <div className="composer-bottom-right">
            {/* Combined Model + Effort Dropdown (Matches "6.1 Sol 轻度 ⌄" in ref-1-home.png) */}
            <div className="composer-dropdown-anchor">
              <button
                type="button"
                className="composer-inline-pill model-effort-pill"
                onClick={() => {
                  setOpenMenu((m) => (m === "model" ? null : "model"));
                  setModelSearch("");
                }}
                title="选择模型、推理强度与生成速度"
              >
                <span>
                  {formatShortModelName(activeModel)} {activeEffort.shortLabel}
                </span>
                <ChevronDownIcon size={11} />
              </button>

              {openMenu === "model" && (
                <div className="composer-popover-menu bottom-right" style={{ minWidth: 330 }}>
                  <input
                    type="text"
                    className="popover-search-input"
                    placeholder="搜索模型..."
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    autoFocus
                  />

                  <div className="popover-section-label">模型 (Model)</div>
                  <div style={{ maxHeight: 190, overflowY: "auto" }}>
                    {filteredModels.map((m) => {
                      const isSelected = m.id === selectedModelId;
                      return (
                        <div
                          key={m.id}
                          className={`popover-menu-item ${isSelected ? "selected" : ""}`}
                          onClick={() => onSelectModelId(m.id)}
                        >
                          <div className="popover-item-body">
                            <div className="popover-item-header">
                              <span className="popover-item-title">
                                {m.displayName || m.id}
                              </span>
                              {m.tags?.map((tag) => (
                                <span
                                  key={tag}
                                  className={`popover-badge ${
                                    tag === "推荐" || tag === "旗舰"
                                      ? "recommended"
                                      : tag === "极速"
                                      ? "fast"
                                      : ""
                                  }`}
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                            {m.description && (
                              <span className="popover-item-desc">{m.description}</span>
                            )}
                          </div>
                          {isSelected && <CheckIcon size={14} />}
                        </div>
                      );
                    })}
                  </div>

                  <div className="popover-divider" />
                  <div className="popover-section-label">推理强度 (Reasoning Effort)</div>
                  <div className="effort-segmented-bar">
                    {EFFORT_OPTIONS.map((eff) => (
                      <button
                        key={eff.id}
                        type="button"
                        className={`effort-segment-btn ${
                          reasoningEffort === eff.id ? "active" : ""
                        }`}
                        onClick={() => onSelectReasoningEffort(eff.id)}
                        title={eff.desc}
                      >
                        {eff.shortLabel}
                      </button>
                    ))}
                  </div>

                  <div className="popover-divider" />
                  <div
                    className={`popover-menu-item ${fastMode ? "selected" : ""}`}
                    onClick={onToggleFastMode}
                  >
                    <div className="popover-item-body">
                      <span className="popover-item-title">⚡ 快速模式 (Fast 2x Speed)</span>
                      <span className="popover-item-desc">优先低延迟高吞吐通道生成</span>
                    </div>
                    {fastMode && <CheckIcon size={14} />}
                  </div>
                </div>
              )}
            </div>

            {/* Mic / Voice Dictation Button */}
            <button
              type="button"
              className={`composer-icon-circle-btn ${isDictating ? "dictating" : ""}`}
              onClick={toggleDictation}
              title={isDictating ? "正在听写... 点击停止并插入文字" : "语音输入 (实时语音识别听写)"}
            >
              <MicIcon size={15} />
            </button>

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
                onClick={onSendMessage}
                title="发送 (Enter)"
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

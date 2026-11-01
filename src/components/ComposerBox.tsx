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
import { ComposerAutocomplete, AutocompleteItem } from "./ComposerAutocomplete";
import { ComposerAttachmentChip } from "./ComposerAttachmentChip";
import { createAttachedFileItem } from "../threadAttachments";
import { ModelSelector } from "./ModelSelector";

export interface ComposerBoxProps {
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

  const [openMenu, setOpenMenu] = useState<
    "project" | "env" | "branch" | "plus" | "permission" | "model" | null
  >(null);
  const [newBranchInput, setNewBranchInput] = useState("");
  const [isDictating, setIsDictating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const recognitionRef = useRef<any>(null);
  const permissionTriggerRef = useRef<HTMLButtonElement | null>(null);

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
      let savedVoiceLang = "zh-CN";
      try {
        const raw = localStorage.getItem("codex_desktop_preferences");
        if (raw) {
          const p = JSON.parse(raw);
          if (p.voiceLanguage) savedVoiceLang = p.voiceLanguage;
        }
      } catch {}

      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = savedVoiceLang;

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
        droppedItems.push(
          createAttachedFileItem(filePath, file.name, isImage ? "image" : "file")
        );
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
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
    let sendShortcutPref = "enter";
    try {
      const raw = localStorage.getItem("codex_desktop_preferences");
      if (raw) {
        const p = JSON.parse(raw);
        if (p.sendShortcut) sendShortcutPref = p.sendShortcut;
      }
    } catch {}

    if (e.key !== "Enter" || e.altKey) return;
    const modifier = e.metaKey || e.ctrlKey;
    if (e.repeat && modifier) {
      e.preventDefault();
      return;
    }
    const shouldQueue = isStreaming && modifier &&
      (sendShortcutPref === "cmd-enter" ? e.shiftKey : !e.shiftKey);
    if (shouldQueue) {
      e.preventDefault();
      onQueueMessage();
      return;
    }
    const shouldSend =
      sendShortcutPref === "cmd-enter"
        ? modifier && !e.shiftKey
        : !e.shiftKey;

    if (shouldSend) {
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

          {variant === "thread" && (
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
                  {onAppshot && (
                    <div
                      className="popover-menu-item"
                      onClick={() => {
                        setOpenMenu(null);
                        onAppshot();
                      }}
                    >
                      <div className="popover-item-header">
                        <CameraIcon size={14} />
                        <span className="popover-item-title">当前屏幕快照 (Appshot)</span>
                      </div>
                    </div>
                  )}
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
                </div>
              )}
            </div>

            <div className="composer-dropdown-anchor">
              <button
                ref={permissionTriggerRef}
                type="button"
                className={`composer-inline-pill ${
                  permissionMode === "full" ? "danger-accent" : ""
                }`}
                aria-label="更改权限"
                aria-haspopup="menu"
                aria-expanded={openMenu === "permission"}
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
                  className="composer-popover-menu bottom-left permission-popover"
                  role="menu"
                  aria-label="更改权限"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setOpenMenu(null);
                      permissionTriggerRef.current?.focus({ preventScroll: true });
                    }
                  }}
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
                          setOpenMenu(null);
                          requestAnimationFrame(() => permissionTriggerRef.current?.focus({ preventScroll: true }));
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
                onClick={() => onSendMessage()}
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

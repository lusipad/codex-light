import React, { useEffect, useRef, useState } from "react";
import {
  OpenAIIcon,
  BrainIcon,
  ShieldIcon,
  BranchIcon,
  WorktreeIcon,
  ChevronDownIcon,
  CheckIcon,
} from "./Icons";
import { ModelInfo } from "../types";

export interface ComposerControlPillsProps {
  models: ModelInfo[];
  selectedModelId: string;
  onSelectModelId: (id: string) => void;
  reasoningEffort: string;
  onSelectReasoningEffort: (effort: string) => void;
  permissionMode: "ask" | "auto" | "full";
  onSelectPermissionMode: (mode: "ask" | "auto" | "full") => void;
  useWorktree: boolean;
  onToggleWorktree: () => void;
}

const DEFAULT_MODELS: ModelInfo[] = [
  {
    id: "gpt-6-astra",
    displayName: "GPT-6 Astra",
    description: "OpenAI 最先进的旗舰推理与全栈编码模型，擅长复杂工程架构与系统重构",
    contextWindow: 128000,
    tags: ["推荐", "旗舰"],
  },
  {
    id: "gpt-6.1-sol",
    displayName: "GPT-6.1 Sol",
    description: "超高吞吐率与超低时延敏捷编码模型，专注日常编辑与快速排错",
    contextWindow: 128000,
    tags: ["极速"],
  },
  {
    id: "gpt-5.4",
    displayName: "GPT-5.4",
    description: "高性价比综合模型，具备优秀的多任务规划与代码审查能力",
    contextWindow: 128000,
    tags: ["全能"],
  },
  {
    id: "gpt-5.3-codex",
    displayName: "GPT-5.3 Codex",
    description: "针对复杂代码补丁、单元测试生成与 AST 变换深度优化的经典模型",
    contextWindow: 128000,
    tags: ["代码专用"],
  },
];

const REASONING_OPTIONS = [
  {
    id: "low",
    name: "低思考 (Low)",
    desc: "轻量分析，迅速响应，适合简单查询与单行修补",
  },
  {
    id: "medium",
    name: "中思考 (Medium)",
    desc: "标准深度，兼顾响应时延与推演深度（推荐日常使用）",
  },
  {
    id: "high",
    name: "高思考 (High)",
    desc: "全面推演，深度规划调用顺序与边界条件",
  },
  {
    id: "extra_high",
    name: "极高思考 (Extra High)",
    desc: "终极推演，穷举可能错误与多模块协同影响",
  },
];

const PERMISSION_OPTIONS: Array<{
  id: "ask" | "auto" | "full";
  name: string;
  desc: string;
}> = [
  {
    id: "auto",
    name: "自动审批只读 (Auto-Read)",
    desc: "自动读取文件与分析，遇到执行命令或修改关键配置时进行确认",
  },
  {
    id: "ask",
    name: "每次询问审批 (Strict)",
    desc: "每次文件写入、脚本执行与终端操作均需人工确认",
  },
  {
    id: "full",
    name: "完全接管模式 (YOLO)",
    desc: "自主读取、创建、编辑代码与执行构建，快速迭代",
  },
];

export const ComposerControlPills: React.FC<ComposerControlPillsProps> = ({
  models,
  selectedModelId,
  onSelectModelId,
  reasoningEffort,
  onSelectReasoningEffort,
  permissionMode,
  onSelectPermissionMode,
  useWorktree,
  onToggleWorktree,
}) => {
  const [openPopover, setOpenPopover] = useState<"model" | "reasoning" | "permission" | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpenPopover(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Merge available models with default catalog models
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

  const activeReasoningName =
    reasoningEffort === "low"
      ? "思考: 低"
      : reasoningEffort === "high"
      ? "思考: 高"
      : reasoningEffort === "extra_high"
      ? "思考: 极高"
      : "思考: 中";

  const activePermissionName =
    permissionMode === "ask"
      ? "每次询问"
      : permissionMode === "full"
      ? "完全接管"
      : "自动只读";

  return (
    <div className="composer-pills-row" ref={containerRef}>
      {/* ── 1. Model Selection Pill ── */}
      <div className="control-pill-anchor">
        <button
          type="button"
          className={`control-pill-btn ${openPopover === "model" ? "open" : ""}`}
          onClick={() => {
            setOpenPopover((p) => (p === "model" ? null : "model"));
            setModelSearch("");
          }}
          title="选择推理模型"
        >
          <OpenAIIcon size={14} />
          <span>{activeModel.displayName || activeModel.id}</span>
          <ChevronDownIcon size={12} />
        </button>

        {openPopover === "model" && (
          <div className="control-pill-popover" style={{ minWidth: 320 }}>
            <input
              type="text"
              className="popover-search-input"
              placeholder="搜索模型名称或特性..."
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              autoFocus
            />
            {filteredModels.map((m) => {
              const isSelected = m.id === selectedModelId;
              return (
                <div
                  key={m.id}
                  className={`popover-menu-item ${isSelected ? "selected" : ""}`}
                  onClick={() => {
                    onSelectModelId(m.id);
                    setOpenPopover(null);
                  }}
                >
                  <div className="popover-item-body">
                    <div className="popover-item-header">
                      <span className="popover-item-title">{m.displayName || m.id}</span>
                      {m.tags?.map((tag: string) => (
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
        )}
      </div>

      {/* ── 2. Reasoning Effort Pill ── */}
      <div className="control-pill-anchor">
        <button
          type="button"
          className={`control-pill-btn ${openPopover === "reasoning" ? "open" : ""}`}
          onClick={() => setOpenPopover((p) => (p === "reasoning" ? null : "reasoning"))}
          title="调整模型推演深度"
        >
          <BrainIcon size={14} />
          <span>{activeReasoningName}</span>
          <ChevronDownIcon size={12} />
        </button>

        {openPopover === "reasoning" && (
          <div className="control-pill-popover" style={{ minWidth: 280 }}>
            {REASONING_OPTIONS.map((opt) => {
              const isSelected = opt.id === reasoningEffort;
              return (
                <div
                  key={opt.id}
                  className={`popover-menu-item ${isSelected ? "selected" : ""}`}
                  onClick={() => {
                    onSelectReasoningEffort(opt.id);
                    setOpenPopover(null);
                  }}
                >
                  <div className="popover-item-body">
                    <span className="popover-item-title">{opt.name}</span>
                    <span className="popover-item-desc">{opt.desc}</span>
                  </div>
                  {isSelected && <CheckIcon size={14} />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 3. Permission Mode Pill ── */}
      <div className="control-pill-anchor">
        <button
          type="button"
          className={`control-pill-btn ${openPopover === "permission" ? "open" : ""}`}
          onClick={() => setOpenPopover((p) => (p === "permission" ? null : "permission"))}
          title="设置终端与代码修改权限"
        >
          <ShieldIcon size={14} />
          <span>{activePermissionName}</span>
          <ChevronDownIcon size={12} />
        </button>

        {openPopover === "permission" && (
          <div className="control-pill-popover" style={{ minWidth: 300 }}>
            {PERMISSION_OPTIONS.map((opt) => {
              const isSelected = opt.id === permissionMode;
              return (
                <div
                  key={opt.id}
                  className={`popover-menu-item ${isSelected ? "selected" : ""}`}
                  onClick={() => {
                    onSelectPermissionMode(opt.id);
                    setOpenPopover(null);
                  }}
                >
                  <div className="popover-item-body">
                    <span className="popover-item-title">{opt.name}</span>
                    <span className="popover-item-desc">{opt.desc}</span>
                  </div>
                  {isSelected && <CheckIcon size={14} />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 4. Git Worktree Mode Pill ── */}
      <button
        type="button"
        className={`control-pill-btn ${useWorktree ? "active-blue" : ""}`}
        onClick={onToggleWorktree}
        title={useWorktree ? "已启用隔离 Worktree 模式" : "点击启用隔离 Worktree 模式"}
      >
        <WorktreeIcon size={14} />
        <span>{useWorktree ? "隔离 Worktree" : "当前工作区分支"}</span>
      </button>
    </div>
  );
};

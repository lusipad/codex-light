import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Target,
  Trash2,
  Zap,
} from "lucide-react";
import { tauriInvoke } from "../bridge";
import { AutomationItem, ModelInfo } from "../types";

interface AutomationsViewProps {
  activeWorkspaceRoot: string;
  models: ModelInfo[];
  onRunAutomationNow: (item: AutomationItem) => void;
}

const PRESET_TEMPLATES = [
  {
    title: "每日代码质量与测试巡检",
    kind: "cron" as const,
    rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
    prompt:
      "扫描当前工作区最近 24 小时的 Git 提交，运行构建与单元测试，总结潜在缺陷或未覆盖的边界条件。",
  },
  {
    title: "每周一依赖与安全漏洞审查",
    kind: "cron" as const,
    rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=10;BYMINUTE=0",
    prompt:
      "检查项目依赖配置（package.json / Cargo.toml 等），列出过期或有风险的依赖项并生成安全升级计划。",
  },
  {
    title: "长期自治目标 (/goal 持续推进)",
    kind: "goal" as const,
    rrule: "FREQ=HOURLY;INTERVAL=1",
    prompt:
      "持续推进当前项目的里程碑开发计划：检查剩余未完成模块、编写实现代码、执行编译与自动化测试，直到所有验收指标全部通过。",
  },
];

const SCHEDULE_PRESETS = [
  { label: "每天 09:00", rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0" },
  { label: "工作日 09:30", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=30" },
  { label: "每周一 10:00", rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=10;BYMINUTE=0" },
  { label: "每小时巡检", rrule: "FREQ=HOURLY;INTERVAL=1" },
];

export const AutomationsView: React.FC<AutomationsViewProps> = ({
  activeWorkspaceRoot,
  models,
  onRunAutomationNow,
}) => {
  const [automations, setAutomations] = useState<AutomationItem[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<"all" | "scheduled" | "goals">(
    "all"
  );
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "ACTIVE" | "PAUSED" | "COMPLETED"
  >("ALL");
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);

  const [name, setName] = useState<string>("");
  const [kind, setKind] = useState<"cron" | "heartbeat" | "goal">("cron");
  const [rrule, setRrule] = useState<string>("FREQ=DAILY;BYHOUR=9;BYMINUTE=0");
  const [prompt, setPrompt] = useState<string>("");
  const [execEnv, setExecEnv] = useState<"worktree" | "local">("worktree");
  const [selectedModel, setSelectedModel] = useState<string>("");

  const refresh = async () => {
    try {
      const list = await tauriInvoke<AutomationItem[]>("automations_list");
      setAutomations(list);
    } catch {}
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleCreate = async () => {
    if (!name.trim() || !prompt.trim()) return;
    const item: AutomationItem = {
      id: "",
      kind,
      name: name.trim(),
      prompt: prompt.trim(),
      status: "ACTIVE",
      rrule: rrule.trim() || "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      cwds: [activeWorkspaceRoot],
      executionEnvironment: execEnv,
      model: selectedModel || null,
      reasoningEffort: "medium",
      targetThreadId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const updated = await tauriInvoke<AutomationItem[]>("automation_save", {
      item,
    });
    setAutomations(updated);
    setName("");
    setPrompt("");
    setShowCreateForm(false);
  };

  const handleToggleStatus = async (item: AutomationItem, targetStatus?: string) => {
    const nextStatus =
      targetStatus || (item.status === "PAUSED" ? "ACTIVE" : "PAUSED");
    const next: AutomationItem = {
      ...item,
      status: nextStatus,
    };
    const updated = await tauriInvoke<AutomationItem[]>("automation_save", {
      item: next,
    });
    setAutomations(updated);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除该计划任务 / 目标吗？")) return;
    const updated = await tauriInvoke<AutomationItem[]>("automation_delete", {
      id,
    });
    setAutomations(updated);
  };

  const filteredItems = useMemo(() => {
    return automations.filter((item) => {
      if (activeSubTab === "scheduled" && item.kind === "goal") return false;
      if (activeSubTab === "goals" && item.kind !== "goal") return false;
      if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
      return true;
    });
  }, [automations, activeSubTab, statusFilter]);

  return (
    <div className="panel-page">
      <div className="panel-page-header">
        <div>
          <h2>计划任务与长期目标 (`~/.codex/automations`)</h2>
          <p className="subtitle">
            管理定时执行的后台自动化任务 (`automation.toml`) 与多轮持续推进的 `/goal` 长期目标。
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="primary-btn"
            onClick={() => setShowCreateForm((v) => !v)}
          >
            <Plus size={14} /> {showCreateForm ? "收起表单" : "新建任务 / 目标"}
          </button>
          <button type="button" className="secondary-btn" onClick={refresh}>
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
      </div>

      {/* Sub-Tabs & Status Filter Bar */}
      <div className="hub-filter-bar">
        <div className="sub-tabs">
          <button
            type="button"
            className={`sub-tab ${activeSubTab === "all" ? "active" : ""}`}
            onClick={() => setActiveSubTab("all")}
          >
            <Clock size={14} />
            <span>全部 ({automations.length})</span>
          </button>
          <button
            type="button"
            className={`sub-tab ${activeSubTab === "scheduled" ? "active" : ""}`}
            onClick={() => setActiveSubTab("scheduled")}
          >
            <Clock size={14} />
            <span>
              计划任务 ({automations.filter((a) => a.kind !== "goal").length})
            </span>
          </button>
          <button
            type="button"
            className={`sub-tab ${activeSubTab === "goals" ? "active" : ""}`}
            onClick={() => setActiveSubTab("goals")}
          >
            <Target size={14} />
            <span>
              长期目标 /goal ({automations.filter((a) => a.kind === "goal").length})
            </span>
          </button>
        </div>

        <div className="status-pill-group">
          {(["ALL", "ACTIVE", "PAUSED", "COMPLETED"] as const).map((st) => (
            <button
              key={st}
              type="button"
              className={`seg-btn ${statusFilter === st ? "active" : ""}`}
              onClick={() => setStatusFilter(st)}
            >
              {st === "ALL"
                ? "全部状态"
                : st === "ACTIVE"
                  ? "已开启"
                  : st === "PAUSED"
                    ? "已暂停"
                    : "已完成"}
            </button>
          ))}
        </div>
      </div>

      {/* Quick Preset Templates */}
      <div className="card-section">
        <h3>推荐预设模板（点击一键填入）</h3>
        <div className="preset-cards-grid">
          {PRESET_TEMPLATES.map((tpl, i) => (
            <div
              key={i}
              className="preset-template-card"
              onClick={() => {
                setName(tpl.title);
                setKind(tpl.kind);
                setRrule(tpl.rrule);
                setPrompt(tpl.prompt);
                setShowCreateForm(true);
              }}
            >
              <div className="preset-template-title">
                {tpl.kind === "goal" ? <Target size={14} /> : <Clock size={14} />}
                <span>{tpl.title}</span>
              </div>
              <p className="preset-template-desc">{tpl.prompt}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Create Automation / Goal Form */}
      {showCreateForm && (
        <div className="card-section">
          <h3>创建计划任务或长期目标</h3>
          <div className="form-grid-row">
            <div className="form-field">
              <label>任务 / 目标名称</label>
              <input
                type="text"
                placeholder="例如：每日代码质量巡检 或 完成全量重构"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label>类型</label>
              <select
                value={kind}
                onChange={(e) =>
                  setKind(e.target.value as "cron" | "heartbeat" | "goal")
                }
              >
                <option value="cron">Cron 定时计划任务</option>
                <option value="heartbeat">Heartbeat 会话巡检</option>
                <option value="goal">Goal 长期自治目标 (/goal)</option>
              </select>
            </div>
            <div className="form-field">
              <label>周期预设</label>
              <select
                value={
                  SCHEDULE_PRESETS.some((p) => p.rrule === rrule) ? rrule : "custom"
                }
                onChange={(e) => {
                  if (e.target.value !== "custom") {
                    setRrule(e.target.value);
                  }
                }}
              >
                {SCHEDULE_PRESETS.map((p) => (
                  <option key={p.rrule} value={p.rrule}>
                    {p.label}
                  </option>
                ))}
                <option value="custom">自定义 RRULE</option>
              </select>
            </div>
            <div className="form-field">
              <label>RRULE 规则字符串</label>
              <input
                type="text"
                value={rrule}
                onChange={(e) => setRrule(e.target.value)}
                placeholder="FREQ=DAILY;BYHOUR=9;BYMINUTE=0"
              />
            </div>
            <div className="form-field">
              <label>执行环境</label>
              <select
                value={execEnv}
                onChange={(e) =>
                  setExecEnv(e.target.value as "worktree" | "local")
                }
              >
                <option value="worktree">隔离 Worktree（安全推荐）</option>
                <option value="local">当前本地工作目录</option>
              </select>
            </div>
            <div className="form-field">
              <label>指定模型 (可选)</label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                <option value="">跟随全局默认模型</option>
                {models.map((m) => (
                  <option key={m.id || m.model} value={m.model || m.id}>
                    {m.displayName || m.model || m.id}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-field" style={{ marginTop: 10 }}>
            <label>Prompt 指令与验收标准</label>
            <textarea
              rows={3}
              placeholder="输入触发时发送给 Codex Agent 的完整指令或长期目标验收条件..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button
              type="button"
              className="primary-btn"
              onClick={handleCreate}
              disabled={!name.trim() || !prompt.trim()}
            >
              <Plus size={14} /> 保存到 automation.toml
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setShowCreateForm(false)}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Automations & Goals List */}
      <div className="card-section">
        <h3>任务列表 ({filteredItems.length})</h3>
        {filteredItems.length === 0 ? (
          <div className="empty-hint">
            当前筛选条件下暂无计划任务，可点击上方预设卡片或「新建任务 / 目标」快速创建。
          </div>
        ) : (
          <div className="item-cards-list">
            {filteredItems.map((item) => (
              <div key={item.id} className="item-card">
                <div className="item-card-main">
                  <div className="item-card-title-row">
                    {item.kind === "goal" ? (
                      <Target size={15} className="accent-icon" />
                    ) : (
                      <Clock size={15} className="accent-icon" />
                    )}
                    <strong>{item.name}</strong>
                    <span
                      className={`tag-badge ${
                        item.status === "ACTIVE" ? "accent" : ""
                      }`}
                    >
                      {item.status}
                    </span>
                    <span className="tag-badge">
                      {item.kind === "goal" ? "长期目标 /goal" : item.kind}
                    </span>
                    <span className="tag-badge">{item.executionEnvironment}</span>
                  </div>
                  <p className="item-card-desc">{item.prompt}</p>
                  <div className="item-card-meta">
                    <span>周期: {item.rrule}</span>
                    {item.cwds.length > 0 && <span>项目: {item.cwds[0]}</span>}
                    {item.model && <span>模型: {item.model}</span>}
                  </div>
                </div>
                <div className="item-card-actions">
                  <button
                    type="button"
                    className="primary-btn-sm"
                    onClick={() => onRunAutomationNow(item)}
                  >
                    <Zap size={13} /> 立即运行
                  </button>
                  <button
                    type="button"
                    className="secondary-btn-sm"
                    onClick={() => handleToggleStatus(item)}
                  >
                    {item.status === "PAUSED" ? (
                      <>
                        <Play size={12} /> 启用
                      </>
                    ) : (
                      <>
                        <Pause size={12} /> 暂停
                      </>
                    )}
                  </button>
                  {item.status !== "COMPLETED" && (
                    <button
                      type="button"
                      className="secondary-btn-sm"
                      onClick={() => handleToggleStatus(item, "COMPLETED")}
                      title="标记为已完成"
                    >
                      <CheckCircle2 size={12} /> 完成
                    </button>
                  )}
                  <button
                    type="button"
                    className="danger-btn-sm"
                    onClick={() => handleDelete(item.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

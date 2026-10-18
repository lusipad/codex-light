import React, { useEffect, useState } from "react";
import {
  Clock,
  Pause,
  Play,
  Plus,
  RefreshCw,
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

export const AutomationsView: React.FC<AutomationsViewProps> = ({
  activeWorkspaceRoot,
  models,
  onRunAutomationNow,
}) => {
  const [automations, setAutomations] = useState<AutomationItem[]>([]);
  const [name, setName] = useState<string>("");
  const [kind, setKind] = useState<"cron" | "heartbeat">("cron");
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
  };

  const handleToggleStatus = async (item: AutomationItem) => {
    const next: AutomationItem = {
      ...item,
      status: item.status === "PAUSED" ? "ACTIVE" : "PAUSED",
    };
    const updated = await tauriInvoke<AutomationItem[]>("automation_save", {
      item: next,
    });
    setAutomations(updated);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除该自动化任务吗？")) return;
    const updated = await tauriInvoke<AutomationItem[]>("automation_delete", {
      id,
    });
    setAutomations(updated);
  };

  return (
    <div className="panel-page">
      <div className="panel-page-header">
        <div>
          <h2>Automations 自动化任务 (`~/.codex/automations`)</h2>
          <p className="subtitle">
            兼容官方 `automation.toml` 格式的定时 Cron 与 Heartbeat 自动化任务管理。
          </p>
        </div>
        <button type="button" className="secondary-btn" onClick={refresh}>
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      {/* Create Automation Form */}
      <div className="card-section">
        <h3>新建自动化任务</h3>
        <div className="form-grid-row">
          <div className="form-field">
            <label>任务名称</label>
            <input
              type="text"
              placeholder="例如：每日代码质量巡检"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label>类型</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "cron" | "heartbeat")}
            >
              <option value="cron">Cron 定时任务</option>
              <option value="heartbeat">Heartbeat 会话巡检</option>
            </select>
          </div>
          <div className="form-field">
            <label>RRULE 周期规则</label>
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
              <option value="worktree">隔离 Worktree</option>
              <option value="local">当前工作目录</option>
            </select>
          </div>
          <div className="form-field">
            <label>指定模型 (可选)</label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              <option value="">默认模型</option>
              {models.map((m) => (
                <option key={m.model} value={m.model}>
                  {m.displayName || m.model}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-field" style={{ marginTop: 10 }}>
          <label>执行 Prompt 指令</label>
          <textarea
            rows={3}
            placeholder="输入触发时发送给 Codex Agent 的完整指令..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="primary-btn"
            onClick={handleCreate}
            disabled={!name.trim() || !prompt.trim()}
          >
            <Plus size={14} /> 保存到 automation.toml
          </button>
        </div>
      </div>

      {/* Automations List */}
      <div className="card-section">
        <h3>已配置的自动化任务 ({automations.length})</h3>
        {automations.length === 0 ? (
          <div className="empty-hint">暂无自动化任务</div>
        ) : (
          <div className="item-cards-list">
            {automations.map((item) => (
              <div key={item.id} className="item-card">
                <div className="item-card-main">
                  <div className="item-card-title-row">
                    <Clock size={15} className="accent-icon" />
                    <strong>{item.name}</strong>
                    <span
                      className={`tag-badge ${
                        item.status === "ACTIVE" ? "accent" : ""
                      }`}
                    >
                      {item.status}
                    </span>
                    <span className="tag-badge">{item.kind}</span>
                    <span className="tag-badge">{item.executionEnvironment}</span>
                  </div>
                  <p className="item-card-desc">{item.prompt}</p>
                  <div className="item-card-meta">
                    <span>RRULE: {item.rrule}</span>
                    {item.cwds.length > 0 && <span>目录: {item.cwds[0]}</span>}
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

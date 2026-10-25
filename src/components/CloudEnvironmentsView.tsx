import React, { useState, useEffect } from "react";
import {
  ExternalWindowIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  TrashIcon,
} from "./Icons";
import "./CloudEnvironmentsView.css";

export interface CloudEnvironment {
  id: string;
  name: string;
  repo: string;
  branch: string;
  image: string;
  resources: string;
  status: "running" | "stopped" | "provisioning";
  networkMode: "public" | "vpc";
  secretsCount: number;
  lastUsedAt: number;
}

const DEFAULT_ENVIRONMENTS: CloudEnvironment[] = [
  {
    id: "env-codex-core",
    name: "codex-desktop-native-builder",
    repo: "https://github.com/openai/codex-desktop-native",
    branch: "master",
    image: "rust-1.80-node20-tauri:latest",
    resources: "4 vCPU · 16 GB RAM · 60 GB NVMe",
    status: "running",
    networkMode: "public",
    secretsCount: 3,
    lastUsedAt: Date.now() - 3600000 * 2,
  },
  {
    id: "env-eval-swarm",
    name: "agent-eval-harness",
    repo: "https://github.com/internal/agent-eval-swarm",
    branch: "main",
    image: "python-3.11-deeplearning:v2",
    resources: "8 vCPU · 32 GB RAM · GPU-Enabled",
    status: "stopped",
    networkMode: "vpc",
    secretsCount: 5,
    lastUsedAt: Date.now() - 3600000 * 48,
  },
];

export interface CloudEnvironmentsViewProps {
  onStartChatInEnv?: (envName: string) => void;
}

export const CloudEnvironmentsView: React.FC<CloudEnvironmentsViewProps> = ({
  onStartChatInEnv,
}) => {
  const [environments, setEnvironments] = useState<CloudEnvironment[]>(() => {
    try {
      const saved = localStorage.getItem("codex_cloud_environments");
      return saved ? JSON.parse(saved) : DEFAULT_ENVIRONMENTS;
    } catch {
      return DEFAULT_ENVIRONMENTS;
    }
  });

  const [statusFilter, setStatusFilter] = useState<"all" | "running" | "stopped">("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedEnv, setSelectedEnv] = useState<CloudEnvironment | null>(null);
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);

  // Form states
  const [newEnvName, setNewEnvName] = useState<string>("");
  const [newEnvRepo, setNewEnvRepo] = useState<string>("");
  const [newEnvBranch, setNewEnvBranch] = useState<string>("main");
  const [newEnvImage, setNewEnvImage] = useState<string>("Ubuntu 24.04 + Node 20 / Rust");
  const [newEnvTier, setNewEnvTier] = useState<string>("4 vCPU · 16 GB RAM");

  useEffect(() => {
    localStorage.setItem("codex_cloud_environments", JSON.stringify(environments));
  }, [environments]);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleToggleStatus = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEnvironments((prev) =>
      prev.map((env) => {
        if (env.id !== id) return env;
        const newStatus = env.status === "running" ? "stopped" : "running";
        notify(newStatus === "running" ? `环境「${env.name}」已启动` : `环境「${env.name}」已暂停`);
        return { ...env, status: newStatus, lastUsedAt: Date.now() };
      })
    );
  };

  const handleResetCache = (id: string) => {
    notify("✓ 构建缓存已清空，正在重置容器层…");
  };

  const handleDelete = (id: string) => {
    setEnvironments((prev) => prev.filter((e) => e.id !== id));
    if (selectedEnv?.id === id) setSelectedEnv(null);
    notify("云开发环境已销毁");
  };

  const handleCreateEnv = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEnvName.trim()) return;

    const newRecord: CloudEnvironment = {
      id: `env-${Date.now()}`,
      name: newEnvName.trim(),
      repo: newEnvRepo.trim() || "local/active-repo",
      branch: newEnvBranch.trim() || "main",
      image: newEnvImage,
      resources: newEnvTier,
      status: "running",
      networkMode: "public",
      secretsCount: 0,
      lastUsedAt: Date.now(),
    };

    setEnvironments([newRecord, ...environments]);
    setShowCreateModal(false);
    setNewEnvName("");
    setNewEnvRepo("");
    notify(`✓ 云环境「${newRecord.name}」初始化完成并已分配算力`);
  };

  const filteredEnvs = environments.filter((env) => {
    if (statusFilter !== "all" && env.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        env.name.toLowerCase().includes(q) ||
        env.repo.toLowerCase().includes(q) ||
        env.image.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="cloud-envs-container">
      {toast && <div className="workbench-toast-banner">{toast}</div>}

      <div className="cloud-envs-header">
        <div>
          <h2>云开发环境 (Cloud Environments)</h2>
          <p className="subtitle">
            远程安全容器化运行环境，支持按仓库配置隔离的容器镜像、环境变量与 secrets，加速云端智能体并行构建与测试。
          </p>
        </div>
        <button
          type="button"
          className="primary-btn"
          onClick={() => setShowCreateModal(true)}
        >
          <PlusIcon size={14} /> 新建云环境
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="cloud-envs-filter-bar">
        <div className="status-tabs">
          <button
            type="button"
            className={`tab-chip ${statusFilter === "all" ? "active" : ""}`}
            onClick={() => setStatusFilter("all")}
          >
            全部 ({environments.length})
          </button>
          <button
            type="button"
            className={`tab-chip ${statusFilter === "running" ? "active" : ""}`}
            onClick={() => setStatusFilter("running")}
          >
            运行中 ({environments.filter((e) => e.status === "running").length})
          </button>
          <button
            type="button"
            className={`tab-chip ${statusFilter === "stopped" ? "active" : ""}`}
            onClick={() => setStatusFilter("stopped")}
          >
            已休眠 ({environments.filter((e) => e.status === "stopped").length})
          </button>
        </div>

        <div className="search-box">
          <SearchIcon size={14} />
          <input
            type="text"
            placeholder="搜索环境名称、镜像或绑定仓库…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Environments Grid */}
      {filteredEnvs.length === 0 ? (
        <div className="cloud-envs-empty">
          <p>暂无符合条件的云开发环境</p>
        </div>
      ) : (
        <div className="cloud-envs-grid">
          {filteredEnvs.map((env) => (
            <div
              key={env.id}
              className="env-card"
              onClick={() => setSelectedEnv(env)}
            >
              <div className="env-card-header">
                <span className={`status-tag ${env.status}`}>
                  <span className="dot" />
                  {env.status === "running" ? "运行中" : "已休眠"}
                </span>
                <span className="network-tag">{env.networkMode.toUpperCase()}</span>
              </div>

              <h3 className="env-title">{env.name}</h3>

              <div className="env-meta-list">
                <div className="meta-item">
                  <span className="meta-k">绑定仓库:</span>
                  <span className="meta-v code">{env.repo}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-k">分支:</span>
                  <span className="meta-v">🌿 {env.branch}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-k">基础镜像:</span>
                  <span className="meta-v">{env.image}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-k">算力规格:</span>
                  <span className="meta-v">{env.resources}</span>
                </div>
              </div>

              <div className="env-card-footer" onClick={(e) => e.stopPropagation()}>
                <span className="time-hint">
                  最近活跃: {new Date(env.lastUsedAt).toLocaleDateString()}
                </span>
                <div className="env-card-actions">
                  <button
                    type="button"
                    className="env-btn"
                    onClick={(e) => handleToggleStatus(env.id, e)}
                  >
                    {env.status === "running" ? "休眠" : "唤醒"}
                  </button>
                  <button
                    type="button"
                    className="env-btn secondary"
                    onClick={() => setSelectedEnv(env)}
                  >
                    配置
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Drawer */}
      {selectedEnv && (
        <div className="env-drawer-backdrop" onClick={() => setSelectedEnv(null)}>
          <div className="env-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="env-drawer-header">
              <div>
                <h2>{selectedEnv.name}</h2>
                <span className="drawer-subtitle">
                  {selectedEnv.resources} · {selectedEnv.image}
                </span>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setSelectedEnv(null)}
              >
                ✕
              </button>
            </div>

            <div className="env-drawer-body">
              <div className="drawer-section">
                <h4>环境状态与网络</h4>
                <div className="info-grid">
                  <div className="info-cell">
                    <span className="info-label">运行状态</span>
                    <strong className={selectedEnv.status === "running" ? "green" : "gray"}>
                      {selectedEnv.status === "running" ? "● 运行就绪" : "○ 已暂停休眠"}
                    </strong>
                  </div>
                  <div className="info-cell">
                    <span className="info-label">网络访问模式</span>
                    <strong>{selectedEnv.networkMode === "public" ? "公网出口 (Public)" : "私有安全通道 (VPC)"}</strong>
                  </div>
                </div>
              </div>

              <div className="drawer-section">
                <h4>安全与密钥 (Secrets & Variables)</h4>
                <p className="section-hint">当前已配置 {selectedEnv.secretsCount} 个密钥变量，注入在容器启动阶段。</p>
                <div className="secrets-mock">
                  <div className="secret-pill">🔒 GITHUB_TOKEN (******)</div>
                  <div className="secret-pill">🔒 DATABASE_URL (******)</div>
                  <div className="secret-pill">🔒 AWS_ACCESS_KEY (******)</div>
                </div>
              </div>

              <div className="drawer-section">
                <h4>操作与维护</h4>
                <div className="action-row">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => handleResetCache(selectedEnv.id)}
                  >
                    重置容器构建缓存 (Reset Cache)
                  </button>
                  {onStartChatInEnv && (
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={() => {
                        onStartChatInEnv(selectedEnv.name);
                        setSelectedEnv(null);
                      }}
                    >
                      <SparklesIcon size={14} /> 在此云环境中启动会话
                    </button>
                  )}
                </div>
              </div>

              <div className="drawer-section danger">
                <h4>销毁云环境</h4>
                <p>销毁后将释放当前容器关联的只读磁盘快照及 secrets 存储。</p>
                <button
                  type="button"
                  className="danger-btn"
                  onClick={() => handleDelete(selectedEnv.id)}
                >
                  <TrashIcon size={14} /> 彻底销毁此环境
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Env Modal */}
      {showCreateModal && (
        <div className="env-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="env-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>创建远程云开发环境</h3>
              <button
                type="button"
                className="close-btn"
                onClick={() => setShowCreateModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateEnv}>
              <div className="form-group">
                <label>环境名称</label>
                <input
                  type="text"
                  required
                  placeholder="例如：release-verify-env"
                  value={newEnvName}
                  onChange={(e) => setNewEnvName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Git 仓库地址</label>
                <input
                  type="text"
                  placeholder="https://github.com/org/repo"
                  value={newEnvRepo}
                  onChange={(e) => setNewEnvRepo(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>目标分支 (Branch)</label>
                <input
                  type="text"
                  value={newEnvBranch}
                  onChange={(e) => setNewEnvBranch(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>基础镜像 (Base Image)</label>
                <select
                  value={newEnvImage}
                  onChange={(e) => setNewEnvImage(e.target.value)}
                >
                  <option value="Ubuntu 24.04 + Node 20 / Rust">Ubuntu 24.04 LTS (Node 20, Rust, Go)</option>
                  <option value="Python 3.11 Data Science / ML">Python 3.11 (PyTorch, Pandas, Jupyter)</option>
                  <option value="Alpine Minimal CI Runner">Alpine 3.19 Minimal Runner</option>
                </select>
              </div>

              <div className="form-group">
                <label>规格规格 (Compute Spec)</label>
                <select
                  value={newEnvTier}
                  onChange={(e) => setNewEnvTier(e.target.value)}
                >
                  <option value="2 vCPU · 8 GB RAM">Standard (2 vCPU · 8 GB RAM · 30 GB NVMe)</option>
                  <option value="4 vCPU · 16 GB RAM">Performance (4 vCPU · 16 GB RAM · 60 GB NVMe)</option>
                  <option value="8 vCPU · 32 GB RAM">High-Compute (8 vCPU · 32 GB RAM · 120 GB NVMe)</option>
                </select>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setShowCreateModal(false)}
                >
                  取消
                </button>
                <button type="submit" className="primary-btn">
                  创建并拉起
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

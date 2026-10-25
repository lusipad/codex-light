import React, { useState, useEffect } from "react";
import {
  ExternalWindowIcon,
  FolderIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  SettingsIcon,
  TrashIcon,
} from "./Icons";
import "./SitesView.css";

export interface SiteRecord {
  id: string;
  name: string;
  subdomain: string;
  customDomain?: string;
  template: string;
  status: "ready" | "building" | "stopped";
  ownerType: "owned" | "shared";
  updatedAt: number;
  envVars?: { key: string; value: string }[];
}

const DEFAULT_SITES: SiteRecord[] = [
  {
    id: "site-codex-docs",
    name: "Codex Native 文档站",
    subdomain: "codex-native-docs.codex.app",
    customDomain: "docs.codex-desktop.dev",
    template: "Vite + React 文档模版",
    status: "ready",
    ownerType: "owned",
    updatedAt: Date.now() - 3600000 * 24,
    envVars: [{ key: "NODE_ENV", value: "production" }],
  },
  {
    id: "site-internal-dashboard",
    name: "研发能效看板",
    subdomain: "eng-metrics.codex.app",
    template: "Next.js Dashboard",
    status: "ready",
    ownerType: "owned",
    updatedAt: Date.now() - 3600000 * 48,
    envVars: [{ key: "API_BASE_URL", value: "https://api.internal/v1" }],
  },
  {
    id: "site-team-showcase",
    name: "智能体协作演示",
    subdomain: "agent-showcase.codex.app",
    template: "Static Tailwind Landing",
    status: "ready",
    ownerType: "shared",
    updatedAt: Date.now() - 3600000 * 12,
  },
];

export interface SitesViewProps {
  onStartChatForSite?: (siteName: string) => void;
}

export const SitesView: React.FC<SitesViewProps> = ({ onStartChatForSite }) => {
  const [sites, setSites] = useState<SiteRecord[]>(() => {
    try {
      const saved = localStorage.getItem("codex_sites_data");
      return saved ? JSON.parse(saved) : DEFAULT_SITES;
    } catch {
      return DEFAULT_SITES;
    }
  });

  const [activeTab, setActiveTab] = useState<"owned" | "shared">("owned");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedSite, setSelectedSite] = useState<SiteRecord | null>(null);
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newSiteName, setNewSiteName] = useState<string>("");
  const [newSiteSubdomain, setNewSiteSubdomain] = useState<string>("");
  const [newSiteTemplate, setNewSiteTemplate] = useState<string>("Vite + React");
  const [toast, setToast] = useState<string | null>(null);

  // Detail drawer sub-tab
  const [drawerTab, setDrawerTab] = useState<"preview" | "config" | "deployments">("preview");

  useEffect(() => {
    localStorage.setItem("codex_sites_data", JSON.stringify(sites));
  }, [sites]);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const filteredSites = sites.filter((s) => {
    const matchesTab = s.ownerType === activeTab;
    const matchesSearch =
      !searchQuery.trim() ||
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.subdomain.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTab && matchesSearch;
  });

  const handleCreateSite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSiteName.trim() || !newSiteSubdomain.trim()) return;

    const newRecord: SiteRecord = {
      id: `site-${Date.now()}`,
      name: newSiteName.trim(),
      subdomain: `${newSiteSubdomain.trim().toLowerCase()}.codex.app`,
      template: newSiteTemplate,
      status: "ready",
      ownerType: "owned",
      updatedAt: Date.now(),
      envVars: [{ key: "NODE_ENV", value: "production" }],
    };

    setSites([newRecord, ...sites]);
    setShowCreateModal(false);
    setNewSiteName("");
    setNewSiteSubdomain("");
    notify(`✓ 站点「${newRecord.name}」创建并部署成功！`);
  };

  const handleDeleteSite = (id: string) => {
    setSites(sites.filter((s) => s.id !== id));
    if (selectedSite?.id === id) {
      setSelectedSite(null);
    }
    notify("站点已移除");
  };

  return (
    <div className="sites-view-container">
      {toast && <div className="workbench-toast-banner">{toast}</div>}

      <div className="sites-view-header">
        <div>
          <h2>Sites 工作面</h2>
          <p className="subtitle">
            一键托管部署智能体前端应用、文档与演示原型，支持自定义域名、环境变量及自动化发布。
          </p>
        </div>
        <button
          type="button"
          className="primary-btn"
          onClick={() => setShowCreateModal(true)}
        >
          <PlusIcon size={14} /> 新建站点
        </button>
      </div>

      {/* Control bar: Tabs, Search, ViewMode */}
      <div className="sites-controls-bar">
        <div className="sites-tabs">
          <button
            type="button"
            className={`sites-tab-btn ${activeTab === "owned" ? "active" : ""}`}
            onClick={() => setActiveTab("owned")}
          >
            我创建的站点 ({sites.filter((s) => s.ownerType === "owned").length})
          </button>
          <button
            type="button"
            className={`sites-tab-btn ${activeTab === "shared" ? "active" : ""}`}
            onClick={() => setActiveTab("shared")}
          >
            共享给我的 ({sites.filter((s) => s.ownerType === "shared").length})
          </button>
        </div>

        <div className="sites-search-wrap">
          <SearchIcon size={14} />
          <input
            type="text"
            placeholder="搜索站点名称或域名…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="sites-layout-toggle">
          <button
            type="button"
            className={`layout-btn ${viewMode === "grid" ? "active" : ""}`}
            onClick={() => setViewMode("grid")}
            title="网格视图"
          >
            ⊞
          </button>
          <button
            type="button"
            className={`layout-btn ${viewMode === "list" ? "active" : ""}`}
            onClick={() => setViewMode("list")}
            title="列表视图"
          >
            ☰
          </button>
        </div>
      </div>

      {/* Sites Content */}
      {filteredSites.length === 0 ? (
        <div className="sites-empty-state">
          <div className="empty-icon">🌐</div>
          <h3>没有找到匹配的站点</h3>
          <p>点击上方「新建站点」开始部署你的第一个智能体前端应用。</p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="sites-grid">
          {filteredSites.map((site) => (
            <div
              key={site.id}
              className="site-card"
              onClick={() => setSelectedSite(site)}
            >
              <div className="site-card-header">
                <span className="site-template-badge">{site.template}</span>
                <span className={`site-status-dot ${site.status}`} title={site.status} />
              </div>
              <h3 className="site-name">{site.name}</h3>
              <div className="site-domain">
                <code>https://{site.subdomain}</code>
              </div>
              {site.customDomain && (
                <div className="site-custom-domain">
                  <span>自定义域名: {site.customDomain}</span>
                </div>
              )}
              <div className="site-card-footer">
                <span className="site-updated-date">
                  更新于 {new Date(site.updatedAt).toLocaleDateString()}
                </span>
                <div className="card-quick-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="icon-action-btn"
                    title="配置与详情"
                    onClick={() => setSelectedSite(site)}
                  >
                    <SettingsIcon size={14} />
                  </button>
                  <a
                    href={`https://${site.subdomain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="icon-action-btn"
                    title="新窗口打开"
                  >
                    <ExternalWindowIcon size={14} />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="sites-list-view">
          <table className="sites-table">
            <thead>
              <tr>
                <th>站点名称</th>
                <th>模版 / 架构</th>
                <th>域名</th>
                <th>状态</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredSites.map((site) => (
                <tr key={site.id} onClick={() => setSelectedSite(site)}>
                  <td className="bold-cell">{site.name}</td>
                  <td>{site.template}</td>
                  <td>
                    <code>https://{site.subdomain}</code>
                  </td>
                  <td>
                    <span className={`status-pill ${site.status}`}>
                      {site.status === "ready" ? "● 就绪" : "○ 停机"}
                    </span>
                  </td>
                  <td>{new Date(site.updatedAt).toLocaleDateString()}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setSelectedSite(site)}
                    >
                      配置
                    </button>
                    <button
                      type="button"
                      className="link-btn danger-link"
                      onClick={() => handleDeleteSite(site.id)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail & Configuration Drawer */}
      {selectedSite && (
        <div className="site-drawer-backdrop" onClick={() => setSelectedSite(null)}>
          <div className="site-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="site-drawer-header">
              <div>
                <h2>{selectedSite.name}</h2>
                <div className="drawer-subdomain">
                  <code>https://{selectedSite.subdomain}</code>
                </div>
              </div>
              <button
                type="button"
                className="close-drawer-btn"
                onClick={() => setSelectedSite(null)}
              >
                ✕
              </button>
            </div>

            <div className="drawer-tab-nav">
              <button
                type="button"
                className={`drawer-tab ${drawerTab === "preview" ? "active" : ""}`}
                onClick={() => setDrawerTab("preview")}
              >
                在线预览
              </button>
              <button
                type="button"
                className={`drawer-tab ${drawerTab === "config" ? "active" : ""}`}
                onClick={() => setDrawerTab("config")}
              >
                域名与环境变量
              </button>
              <button
                type="button"
                className={`drawer-tab ${drawerTab === "deployments" ? "active" : ""}`}
                onClick={() => setDrawerTab("deployments")}
              >
                发布流水线
              </button>
            </div>

            <div className="drawer-body">
              {drawerTab === "preview" && (
                <div className="preview-pane">
                  <div className="preview-toolbar">
                    <span className="dot red" />
                    <span className="dot yellow" />
                    <span className="dot green" />
                    <span className="preview-address-bar">
                      https://{selectedSite.subdomain}
                    </span>
                  </div>
                  <div className="preview-content-mock">
                    <div className="mock-site-hero">
                      <h3>欢迎访问 {selectedSite.name}</h3>
                      <p>由 Codex Native Sites 自动化托管与分发引擎驱动。</p>
                      <div className="mock-site-badges">
                        <span>Node 20+</span>
                        <span>Global Edge CDN</span>
                        <span>Auto SSL</span>
                      </div>
                    </div>
                  </div>
                  {onStartChatForSite && (
                    <div className="preview-chat-action">
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={() => {
                          onStartChatForSite(selectedSite.name);
                          setSelectedSite(null);
                        }}
                      >
                        <SparklesIcon size={14} /> 在会话中让智能体更新此站点代码
                      </button>
                    </div>
                  )}
                </div>
              )}

              {drawerTab === "config" && (
                <div className="config-pane">
                  <div className="config-group">
                    <label>自定义独立域名 (Custom Domain)</label>
                    <input
                      type="text"
                      defaultValue={selectedSite.customDomain || ""}
                      placeholder="e.g. app.mycompany.com"
                      onBlur={(e) => {
                        const updated = sites.map((s) =>
                          s.id === selectedSite.id ? { ...s, customDomain: e.target.value } : s
                        );
                        setSites(updated);
                        notify("域名配置已更新");
                      }}
                    />
                    <small>配置 CNAME 解析指向 <code>cname.codex.app</code> 即可完成绑定。</small>
                  </div>

                  <div className="config-group">
                    <label>环境变量 (Environment Variables)</label>
                    <div className="env-table">
                      {(selectedSite.envVars || []).map((env, i) => (
                        <div key={i} className="env-row">
                          <input type="text" readOnly value={env.key} />
                          <input type="text" readOnly value={env.value} />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="danger-zone">
                    <h4>危险操作</h4>
                    <p>删除此站点将立刻释放分配的域名与托管容器实例。</p>
                    <button
                      type="button"
                      className="danger-btn"
                      onClick={() => handleDeleteSite(selectedSite.id)}
                    >
                      <TrashIcon size={14} /> 删除此站点
                    </button>
                  </div>
                </div>
              )}

              {drawerTab === "deployments" && (
                <div className="deployments-pane">
                  <div className="timeline-item">
                    <div className="timeline-marker success" />
                    <div className="timeline-content">
                      <strong>Production 自动构建已完成</strong>
                      <p>Git commit <code>#6166bb5</code> · 部署耗时 18s</p>
                      <span className="timeline-time">
                        {new Date(selectedSite.updatedAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="timeline-item">
                    <div className="timeline-marker success" />
                    <div className="timeline-content">
                      <strong>首次初始化流水线成功</strong>
                      <p>模版初始化生成 · 部署耗时 24s</p>
                      <span className="timeline-time">
                        {new Date(selectedSite.updatedAt - 86400000).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New Site Modal */}
      {showCreateModal && (
        <div className="site-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="site-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>新建 Sites 托管站点</h3>
              <button
                type="button"
                className="close-drawer-btn"
                onClick={() => setShowCreateModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateSite}>
              <div className="form-group">
                <label>站点名称</label>
                <input
                  type="text"
                  required
                  placeholder="例如：智能客服演示原型"
                  value={newSiteName}
                  onChange={(e) => setNewSiteName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>专属子域名前缀 (*.codex.app)</label>
                <div className="subdomain-input-wrap">
                  <input
                    type="text"
                    required
                    placeholder="my-cool-site"
                    value={newSiteSubdomain}
                    onChange={(e) =>
                      setNewSiteSubdomain(e.target.value.replace(/[^a-zA-Z0-9-]/g, ""))
                    }
                  />
                  <span className="subdomain-suffix">.codex.app</span>
                </div>
              </div>

              <div className="form-group">
                <label>启动架构与前端模版</label>
                <select
                  value={newSiteTemplate}
                  onChange={(e) => setNewSiteTemplate(e.target.value)}
                >
                  <option value="Vite + React">Vite + React (单页应用 / 推荐)</option>
                  <option value="Next.js SSR/SSG">Next.js (服务端渲染/API 路由)</option>
                  <option value="Vue 3 + Vite">Vue 3 + Vite 现代化应用</option>
                  <option value="Static HTML/Tailwind">极简纯静态 + Tailwind CSS</option>
                  <option value="Docusaurus 文档">Docusaurus 技术文档模版</option>
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
                  创建并上线
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

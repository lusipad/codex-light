import React, { useEffect, useState } from "react";
import {
  AppWindow,
  BookOpen,
  Boxes,
  Download,
  Plus,
  RefreshCw,
  Save,
  Server,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { callAppServer, tauriInvoke } from "../bridge";
import {
  CodexConfigOverview,
  McpServerConfigItem,
  SkillInfoItem,
} from "../types";

interface SkillsMcpViewProps {
  activeWorkspaceRoot: string;
}

const CURATED_PLUGINS = [
  {
    id: "plugin-fullstack-qa",
    name: "Full-Stack QA & Playwright Suite",
    author: "OpenAI Codex Official",
    description:
      "集成浏览器自动化验收、端到端测试生成与视觉回归快照分析的完整插件包。",
    badges: ["Skill", "MCP", "Browser"],
    skillTemplate:
      "---\nname: fullstack-qa\ndescription: Automated E2E verification and browser visual check\n---\n\n# Full-Stack QA Skill\n\n1. Start dev server and inspect console logs.\n2. Verify responsive layout and interactive flows.\n3. Run unit and integration test suites before concluding.\n",
  },
  {
    id: "plugin-rust-tauri-pro",
    name: "Rust & Tauri v2 Native Kit",
    author: "Codex Community",
    description:
      "针对 Tauri 2.x + Rust 桌面端开发的架构规范、IPC 契约生成与 Cargo 性能调优技能包。",
    badges: ["Skill", "Rust", "Tauri"],
    skillTemplate:
      "---\nname: rust-tauri-pro\ndescription: Tauri v2 and Rust desktop engineering best practices\n---\n\n# Rust & Tauri v2 Pro Skill\n\n- Keep Tauri commands strongly typed with serde.\n- Avoid blocking the async runtime; use spawn_blocking for heavy I/O.\n- Verify with `cargo check` and `cargo test`.\n",
  },
  {
    id: "plugin-git-release",
    name: "Git Release & PR Architect",
    author: "OpenAI Codex Official",
    description:
      "自动汇总分支 Diff、生成符合 Conventional Commits 规范的提交说明与变更日志。",
    badges: ["Skill", "Git", "PR"],
    skillTemplate:
      "---\nname: git-release-architect\ndescription: Automated changelog, semantic commit, and PR summary builder\n---\n\n# Git Release Architect\n\nAnalyze `git diff` and commit history to produce structured release notes and PR descriptions.\n",
  },
];

const APP_CONNECTORS = [
  {
    id: "github",
    name: "GitHub",
    category: "代码托管与 PR",
    desc: "读取仓库 Issue、审查 Pull Request、查询 Actions 构建状态。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envHint: "GITHUB_PERSONAL_ACCESS_TOKEN",
  },
  {
    id: "linear",
    name: "Linear",
    category: "项目管理",
    desc: "同步项目看板 Issue、自动关联任务分支并更新工作进度。",
    command: "npx",
    args: ["-y", "mcp-remote", "https://mcp.linear.app/sse"],
    envHint: "LINEAR_API_KEY",
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    category: "数据库",
    desc: "只读检查数据库表结构、执行安全查询并验证数据迁移。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"],
    envHint: "DATABASE_URL",
  },
  {
    id: "playwright",
    name: "Playwright Browser",
    category: "浏览器自动化",
    desc: "允许 Codex 启动真实无头浏览器操作 DOM、截图并调试前端页面。",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    envHint: "",
  },
];

const MARKETPLACE_ITEMS = [
  {
    id: "filesystem",
    name: "MCP Filesystem Server",
    type: "MCP (STDIO)",
    desc: "官方模型上下文协议本地文件系统沙箱访问服务。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
  },
  {
    id: "context7",
    name: "Context7 Live Docs MCP",
    type: "MCP (STDIO)",
    desc: "实时拉取最新第三方框架与 SDK 官方文档，消除旧版本幻觉。",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp@latest"],
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking MCP",
    type: "MCP (STDIO)",
    desc: "结构化多步反思与复杂系统架构推演工具链。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
  },
  {
    id: "memory",
    name: "Knowledge Graph Memory MCP",
    type: "MCP (STDIO)",
    desc: "跨会话持久化本地知识图谱与项目架构记忆。",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
  },
];

export const SkillsMcpView: React.FC<SkillsMcpViewProps> = ({
  activeWorkspaceRoot,
}) => {
  const [subTab, setSubTab] = useState<
    "plugins" | "skills" | "mcp" | "apps" | "marketplaces"
  >("plugins");
  const [searchQuery, setSearchQuery] = useState("");
  const [skills, setSkills] = useState<SkillInfoItem[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillInfoItem | null>(null);
  const [newSkillId, setNewSkillId] = useState<string>("");
  const [skillContent, setSkillContent] = useState<string>("");

  // MCP State
  const [config, setConfig] = useState<CodexConfigOverview | null>(null);
  const [mcpLiveStatus, setMcpLiveStatus] = useState<any[]>([]);
  const [mcpTransport, setMcpTransport] = useState<"stdio" | "http">("stdio");
  const [mcpId, setMcpId] = useState<string>("");
  const [mcpCommand, setMcpCommand] = useState<string>("");
  const [mcpArgs, setMcpArgs] = useState<string>("");
  const [mcpUrl, setMcpUrl] = useState<string>("");
  const [mcpEnvText, setMcpEnvText] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const refreshAll = async () => {
    try {
      const localSkills = await tauriInvoke<SkillInfoItem[]>(
        "skills_list_local",
        { workspaceRoot: activeWorkspaceRoot }
      );
      setSkills(localSkills);
      if (localSkills.length > 0 && !selectedSkill) {
        setSelectedSkill(localSkills[0]);
        setNewSkillId(localSkills[0].id);
        setSkillContent(localSkills[0].content);
      }
    } catch {}

    try {
      const cfg = await tauriInvoke<CodexConfigOverview>("config_read");
      setConfig(cfg);
    } catch {}

    try {
      const statusRes = await callAppServer<any>("mcpServerStatus/list", {});
      const list = Array.isArray(statusRes?.data)
        ? statusRes.data
        : Array.isArray(statusRes?.servers)
          ? statusRes.servers
          : Array.isArray(statusRes)
            ? statusRes
            : [];
      setMcpLiveStatus(list);
    } catch {
      setMcpLiveStatus([]);
    }
  };

  useEffect(() => {
    refreshAll();
  }, [activeWorkspaceRoot]);

  const handleSaveSkill = async () => {
    if (!newSkillId.trim() || !skillContent.trim()) return;
    try {
      const saved = await tauriInvoke<SkillInfoItem>("skill_save_or_install", {
        id: newSkillId.trim(),
        content: skillContent,
        sourceDir: null,
      });
      await callAppServer("skills/list", {
        cwds: [activeWorkspaceRoot],
        forceReload: true,
      }).catch(() => {});
      await refreshAll();
      setSelectedSkill(saved);
      notify(`✓ 已保存技能 ${saved.id}`);
    } catch (err: any) {
      alert(err?.message || String(err));
    }
  };

  const handleInstallSeedSkill = async (skill: SkillInfoItem) => {
    try {
      await tauriInvoke<SkillInfoItem>("skill_save_or_install", {
        id: skill.id,
        content: skill.content,
        sourceDir: skill.dirPath,
      });
      await callAppServer("skills/list", {
        cwds: [activeWorkspaceRoot],
        forceReload: true,
      }).catch(() => {});
      await refreshAll();
      notify(`✓ 已安装技能 ${skill.name}`);
    } catch (err: any) {
      alert(err?.message || String(err));
    }
  };

  const handleDeleteSkill = async (skill: SkillInfoItem) => {
    if (!confirm(`确定要卸载技能 ${skill.name} 吗？`)) return;
    try {
      await tauriInvoke("skill_delete", { id: skill.id });
      setSelectedSkill(null);
      await refreshAll();
      notify(`已卸载技能 ${skill.name}`);
    } catch (err: any) {
      alert(err?.message || String(err));
    }
  };

  const handleAddMcpServer = async () => {
    if (!config || !mcpId.trim()) return;
    const envMap: Record<string, string> = {};
    mcpEnvText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((line) => {
        const idx = line.indexOf("=");
        if (idx > 0) {
          envMap[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      });

    const nextItem: McpServerConfigItem = {
      id: mcpId.trim(),
      command: mcpTransport === "stdio" ? mcpCommand.trim() || "npx" : null,
      args:
        mcpTransport === "stdio"
          ? mcpArgs
              .split(/\s+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      url: mcpTransport === "http" ? mcpUrl.trim() || null : null,
      env: envMap,
      enabled: true,
    };
    const nextServers = [
      ...config.mcpServers.filter((s) => s.id !== nextItem.id),
      nextItem,
    ];
    try {
      const updated = await tauriInvoke<CodexConfigOverview>("config_update", {
        payload: {
          mcpServers: nextServers,
        },
      });
      setConfig(updated);
      setMcpId("");
      setMcpCommand("");
      setMcpArgs("");
      setMcpUrl("");
      setMcpEnvText("");
      notify(`✓ 已连接 MCP 服务器: ${nextItem.id}`);
    } catch (err: any) {
      alert(err?.message || String(err));
    }
  };

  const handleToggleMcpServer = async (srv: McpServerConfigItem) => {
    if (!config) return;
    const nextServers = config.mcpServers.map((s) =>
      s.id === srv.id ? { ...s, enabled: !s.enabled } : s
    );
    const updated = await tauriInvoke<CodexConfigOverview>("config_update", {
      payload: { mcpServers: nextServers },
    });
    setConfig(updated);
  };

  const handleRemoveMcpServer = async (id: string) => {
    if (!config) return;
    const nextServers = config.mcpServers.filter((s) => s.id !== id);
    const updated = await tauriInvoke<CodexConfigOverview>("config_update", {
      payload: {
        mcpServers: nextServers,
      },
    });
    setConfig(updated);
    notify(`已移除 MCP 服务器 ${id}`);
  };

  const quickInstallMcp = async (
    id: string,
    command: string,
    args: string[]
  ) => {
    if (!config) return;
    const nextItem: McpServerConfigItem = {
      id,
      command,
      args,
      url: null,
      env: {},
      enabled: true,
    };
    const nextServers = [
      ...config.mcpServers.filter((s) => s.id !== id),
      nextItem,
    ];
    const updated = await tauriInvoke<CodexConfigOverview>("config_update", {
      payload: { mcpServers: nextServers },
    });
    setConfig(updated);
    notify(`✓ 已一键配置 MCP 服务器: ${id}`);
  };

  return (
    <div className="panel-page">
      <div className="panel-page-header">
        <div>
          <h2>插件、技能与 MCP 中心 (`/plugins`)</h2>
          <p className="subtitle">
            一站式管理 Codex 插件包、`~/.codex/skills` 技能库与 `config.toml` 自定义 MCP 服务器。
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            className="hub-search-input"
            placeholder="搜索插件、技能或 MCP..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button
            type="button"
            className="primary-btn"
            onClick={() => setSubTab("mcp")}
          >
            <Plus size={14} /> 连接至自定义 MCP
          </button>
          <button type="button" className="secondary-btn" onClick={refreshAll}>
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
      </div>

      {toast && <div className="workbench-toast-banner">{toast}</div>}

      {/* Official 5-Tab Bar */}
      <div className="sub-tabs" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={`sub-tab ${subTab === "plugins" ? "active" : ""}`}
          onClick={() => setSubTab("plugins")}
        >
          <Boxes size={15} />
          <span>插件 ({CURATED_PLUGINS.length})</span>
        </button>
        <button
          type="button"
          className={`sub-tab ${subTab === "skills" ? "active" : ""}`}
          onClick={() => setSubTab("skills")}
        >
          <BookOpen size={15} />
          <span>技能 ({skills.length})</span>
        </button>
        <button
          type="button"
          className={`sub-tab ${subTab === "mcp" ? "active" : ""}`}
          onClick={() => setSubTab("mcp")}
        >
          <Server size={15} />
          <span>MCP 服务器 ({config?.mcpServers?.length || 0})</span>
        </button>
        <button
          type="button"
          className={`sub-tab ${subTab === "apps" ? "active" : ""}`}
          onClick={() => setSubTab("apps")}
        >
          <AppWindow size={15} />
          <span>应用连接器 ({APP_CONNECTORS.length})</span>
        </button>
        <button
          type="button"
          className={`sub-tab ${subTab === "marketplaces" ? "active" : ""}`}
          onClick={() => setSubTab("marketplaces")}
        >
          <ShoppingBag size={15} />
          <span>市场 ({MARKETPLACE_ITEMS.length})</span>
        </button>
      </div>

      {/* TAB 1: PLUGINS */}
      {subTab === "plugins" && (
        <div className="card-section">
          <h3>精选与本地插件包</h3>
          <div className="item-cards-list">
            {CURATED_PLUGINS.filter(
              (p) =>
                !searchQuery.trim() ||
                p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                p.description.toLowerCase().includes(searchQuery.toLowerCase())
            ).map((plugin) => {
              const isInstalled = skills.some((s) =>
                plugin.id.includes(s.id)
              );
              return (
                <div key={plugin.id} className="item-card">
                  <div className="item-card-main">
                    <div className="item-card-title-row">
                      <Boxes size={15} className="accent-icon" />
                      <strong>{plugin.name}</strong>
                      <span className="tag-badge">{plugin.author}</span>
                      {plugin.badges.map((b) => (
                        <span key={b} className="tag-badge accent">
                          {b}
                        </span>
                      ))}
                    </div>
                    <p className="item-card-desc">{plugin.description}</p>
                  </div>
                  <div className="item-card-actions">
                    <button
                      type="button"
                      className="primary-btn-sm"
                      onClick={async () => {
                        const skillSlug = plugin.id.replace(/^plugin-/, "");
                        await tauriInvoke("skill_save_or_install", {
                          id: skillSlug,
                          content: plugin.skillTemplate,
                          sourceDir: null,
                        });
                        await refreshAll();
                        notify(`✓ 插件 ${plugin.name} 已启用`);
                      }}
                    >
                      <Download size={13} /> {isInstalled ? "重新同步" : "安装并启用"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: SKILLS */}
      {subTab === "skills" && (
        <div className="split-panel-layout">
          <div className="split-left-list">
            <div className="list-toolbar">
              <span>已安装 & 离线种子技能</span>
              <button
                type="button"
                className="mini-btn"
                onClick={() => {
                  setSelectedSkill(null);
                  setNewSkillId("my-custom-skill");
                  setSkillContent(
                    "---\nname: my-custom-skill\ndescription: 自定义技能描述\n---\n\n# My Custom Skill\n\n在这里编写技能指令...\n"
                  );
                }}
              >
                <Plus size={12} /> 新建技能
              </button>
            </div>
            <div className="scrollable-items">
              {skills
                .filter(
                  (sk) =>
                    !searchQuery.trim() ||
                    sk.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    sk.description
                      .toLowerCase()
                      .includes(searchQuery.toLowerCase())
                )
                .map((sk) => (
                  <div
                    key={sk.path}
                    className={`skill-list-row ${
                      selectedSkill?.path === sk.path ? "active" : ""
                    }`}
                    onClick={() => {
                      setSelectedSkill(sk);
                      setNewSkillId(sk.id);
                      setSkillContent(sk.content);
                    }}
                  >
                    <div className="skill-row-top">
                      <strong>{sk.name}</strong>
                      <span
                        className={`tag-badge ${sk.installed ? "accent" : ""}`}
                      >
                        {sk.installed ? "已安装" : "离线种子"}
                      </span>
                    </div>
                    <p className="skill-row-desc">{sk.description}</p>
                  </div>
                ))}
            </div>
          </div>

          <div className="split-right-editor">
            <div className="editor-header-bar">
              <div className="form-field-inline">
                <label>技能 ID (`$skill`):</label>
                <input
                  type="text"
                  value={newSkillId}
                  onChange={(e) => setNewSkillId(e.target.value)}
                  placeholder="skill-folder-name"
                />
              </div>
              <div className="editor-actions">
                {selectedSkill && !selectedSkill.installed && (
                  <button
                    type="button"
                    className="primary-btn-sm"
                    onClick={() => handleInstallSeedSkill(selectedSkill)}
                  >
                    <Download size={13} /> 一键安装到 ~/.codex/skills
                  </button>
                )}
                <button
                  type="button"
                  className="primary-btn-sm"
                  onClick={handleSaveSkill}
                >
                  <Save size={13} /> 保存 SKILL.md
                </button>
                {selectedSkill?.installed && (
                  <button
                    type="button"
                    className="danger-btn-sm"
                    onClick={() => handleDeleteSkill(selectedSkill)}
                  >
                    <Trash2 size={13} /> 卸载
                  </button>
                )}
              </div>
            </div>
            <textarea
              className="code-editor-textarea"
              value={skillContent}
              onChange={(e) => setSkillContent(e.target.value)}
              placeholder="编写 SKILL.md 内容..."
            />
          </div>
        </div>
      )}

      {/* TAB 3: MCP SERVERS */}
      {subTab === "mcp" && (
        <div className="mcp-management-body">
          <div className="card-section">
            <h3>连接至自定义 MCP 服务器 (`[mcp_servers.*]`)</h3>
            <div className="form-grid-row">
              <div className="form-field">
                <label>Server ID (唯一标识符)</label>
                <input
                  type="text"
                  placeholder="例如：filesystem 或 playwright"
                  value={mcpId}
                  onChange={(e) => setMcpId(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label>传输协议类型</label>
                <select
                  value={mcpTransport}
                  onChange={(e) =>
                    setMcpTransport(e.target.value as "stdio" | "http")
                  }
                >
                  <option value="stdio">STDIO (本地命令行进程)</option>
                  <option value="http">Streamable HTTP / SSE 远程端点</option>
                </select>
              </div>
              {mcpTransport === "stdio" ? (
                <>
                  <div className="form-field">
                    <label>可执行命令 (Command)</label>
                    <input
                      type="text"
                      placeholder="例如：npx 或 uvx"
                      value={mcpCommand}
                      onChange={(e) => setMcpCommand(e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label>启动参数 Args (空格分隔)</label>
                    <input
                      type="text"
                      placeholder="-y @modelcontextprotocol/server-filesystem ."
                      value={mcpArgs}
                      onChange={(e) => setMcpArgs(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <div className="form-field">
                  <label>HTTP / SSE 服务器 URL</label>
                  <input
                    type="text"
                    placeholder="https://example.com/mcp"
                    value={mcpUrl}
                    onChange={(e) => setMcpUrl(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="form-field" style={{ marginTop: 10 }}>
              <label>环境变量 Env (可选，每行一个 KEY=VALUE)</label>
              <textarea
                rows={2}
                placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx"
                value={mcpEnvText}
                onChange={(e) => setMcpEnvText(e.target.value)}
              />
            </div>
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="primary-btn"
                onClick={handleAddMcpServer}
                disabled={!mcpId.trim()}
              >
                <Plus size={14} /> 保存并连接 MCP Server
              </button>
            </div>
          </div>

          <div className="card-section">
            <h3>已配置的 MCP 服务器 ({config?.mcpServers?.length || 0})</h3>
            {(config?.mcpServers || []).length === 0 ? (
              <div className="empty-hint">
                暂未在 `config.toml` 中配置外部 MCP Server，可在上方填写或前往「市场」一键安装。
              </div>
            ) : (
              <div className="item-cards-list">
                {(config?.mcpServers || []).map((srv) => (
                  <div key={srv.id} className="item-card">
                    <div className="item-card-main">
                      <div className="item-card-title-row">
                        <Server size={15} className="accent-icon" />
                        <strong>{srv.id}</strong>
                        <span className="tag-badge accent">
                          {srv.url ? "Streamable HTTP" : "STDIO"}
                        </span>
                        <span className="tag-badge">
                          {srv.enabled ? "已启用" : "已禁用"}
                        </span>
                      </div>
                      <div className="item-card-meta">
                        {srv.command && (
                          <span className="mono-text">
                            {srv.command} {srv.args.join(" ")}
                          </span>
                        )}
                        {srv.url && <span className="mono-text">{srv.url}</span>}
                      </div>
                    </div>
                    <div className="item-card-actions">
                      <button
                        type="button"
                        className="secondary-btn-sm"
                        onClick={() => handleToggleMcpServer(srv)}
                      >
                        {srv.enabled ? "禁用" : "启用"}
                      </button>
                      <button
                        type="button"
                        className="danger-btn-sm"
                        onClick={() => handleRemoveMcpServer(srv.id)}
                      >
                        <Trash2 size={13} /> 删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {mcpLiveStatus.length > 0 && (
            <div className="card-section">
              <h3>App-Server 实时 MCP 运行状态</h3>
              <pre className="code-block-pre">
                <code>{JSON.stringify(mcpLiveStatus, null, 2)}</code>
              </pre>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: APP CONNECTORS */}
      {subTab === "apps" && (
        <div className="card-section">
          <h3>官方与第一方应用连接器</h3>
          <div className="item-cards-list">
            {APP_CONNECTORS.map((app) => {
              const connected = config?.mcpServers?.some((s) => s.id === app.id);
              return (
                <div key={app.id} className="item-card">
                  <div className="item-card-main">
                    <div className="item-card-title-row">
                      <AppWindow size={15} className="accent-icon" />
                      <strong>{app.name}</strong>
                      <span className="tag-badge">{app.category}</span>
                      {connected && (
                        <span className="tag-badge accent">已连接</span>
                      )}
                    </div>
                    <p className="item-card-desc">{app.desc}</p>
                    {app.envHint && (
                      <div className="item-card-meta">
                        <span>所需凭证环境变量: {app.envHint}</span>
                      </div>
                    )}
                  </div>
                  <div className="item-card-actions">
                    <button
                      type="button"
                      className="primary-btn-sm"
                      onClick={() =>
                        quickInstallMcp(app.id, app.command, app.args)
                      }
                    >
                      <Plus size={13} /> {connected ? "重新配置" : "一键连接"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 5: MARKETPLACES */}
      {subTab === "marketplaces" && (
        <div className="card-section">
          <h3>MCP 与技能社区市场目录</h3>
          <div className="item-cards-list">
            {MARKETPLACE_ITEMS.map((item) => {
              const installed = config?.mcpServers?.some((s) => s.id === item.id);
              return (
                <div key={item.id} className="item-card">
                  <div className="item-card-main">
                    <div className="item-card-title-row">
                      <ShoppingBag size={15} className="accent-icon" />
                      <strong>{item.name}</strong>
                      <span className="tag-badge accent">{item.type}</span>
                    </div>
                    <p className="item-card-desc">{item.desc}</p>
                    <div className="item-card-meta">
                      <span className="mono-text">
                        {item.command} {item.args.join(" ")}
                      </span>
                    </div>
                  </div>
                  <div className="item-card-actions">
                    <button
                      type="button"
                      className="primary-btn-sm"
                      onClick={() =>
                        quickInstallMcp(item.id, item.command, item.args)
                      }
                    >
                      <Download size={13} />{" "}
                      {installed ? "已安装 (更新)" : "添加到 config.toml"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

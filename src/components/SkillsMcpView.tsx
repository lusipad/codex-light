import React, { useEffect, useState } from "react";
import {
  BookOpen,
  Download,
  Plus,
  RefreshCw,
  Save,
  Server,
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

export const SkillsMcpView: React.FC<SkillsMcpViewProps> = ({
  activeWorkspaceRoot,
}) => {
  const [subTab, setSubTab] = useState<"skills" | "mcp">("skills");
  const [skills, setSkills] = useState<SkillInfoItem[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillInfoItem | null>(null);
  const [newSkillId, setNewSkillId] = useState<string>("");
  const [skillContent, setSkillContent] = useState<string>("");

  // MCP State
  const [config, setConfig] = useState<CodexConfigOverview | null>(null);
  const [mcpLiveStatus, setMcpLiveStatus] = useState<any[]>([]);
  const [mcpId, setMcpId] = useState<string>("");
  const [mcpCommand, setMcpCommand] = useState<string>("");
  const [mcpArgs, setMcpArgs] = useState<string>("");
  const [mcpUrl, setMcpUrl] = useState<string>("");

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
    } catch (err: any) {
      alert(err?.message || String(err));
    }
  };

  const handleAddMcpServer = async () => {
    if (!config || !mcpId.trim()) return;
    const nextItem: McpServerConfigItem = {
      id: mcpId.trim(),
      command: mcpCommand.trim() || null,
      args: mcpArgs
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean),
      url: mcpUrl.trim() || null,
      env: {},
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
    } catch (err: any) {
      alert(err?.message || String(err));
    }
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
  };

  return (
    <div className="panel-page">
      <div className="panel-page-header">
        <div className="sub-tabs">
          <button
            type="button"
            className={`sub-tab ${subTab === "skills" ? "active" : ""}`}
            onClick={() => setSubTab("skills")}
          >
            <BookOpen size={15} />
            <span>Skills 技能库 ({skills.length})</span>
          </button>
          <button
            type="button"
            className={`sub-tab ${subTab === "mcp" ? "active" : ""}`}
            onClick={() => setSubTab("mcp")}
          >
            <Server size={15} />
            <span>MCP 服务器 ({config?.mcpServers?.length || 0})</span>
          </button>
        </div>
        <button type="button" className="secondary-btn" onClick={refreshAll}>
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      {subTab === "skills" ? (
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
                <Plus size={12} /> 新建
              </button>
            </div>
            <div className="scrollable-items">
              {skills.map((sk) => (
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
                <label>技能 ID:</label>
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
      ) : (
        <div className="mcp-management-body">
          <div className="card-section">
            <h3>新增 / 更新 MCP 服务器 (`[mcp_servers.*]`)</h3>
            <div className="form-grid-row">
              <div className="form-field">
                <label>Server ID</label>
                <input
                  type="text"
                  placeholder="例如：filesystem 或 github"
                  value={mcpId}
                  onChange={(e) => setMcpId(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label>Command (本地 stdio 进程)</label>
                <input
                  type="text"
                  placeholder="例如：npx"
                  value={mcpCommand}
                  onChange={(e) => setMcpCommand(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label>Args 参数 (空格分隔)</label>
                <input
                  type="text"
                  placeholder="-y @modelcontextprotocol/server-filesystem ."
                  value={mcpArgs}
                  onChange={(e) => setMcpArgs(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label>或 HTTP/SSE URL</label>
                <input
                  type="text"
                  placeholder="http://127.0.0.1:8080/mcp"
                  value={mcpUrl}
                  onChange={(e) => setMcpUrl(e.target.value)}
                />
              </div>
              <div className="form-field form-field-end">
                <button
                  type="button"
                  className="primary-btn"
                  onClick={handleAddMcpServer}
                  disabled={!mcpId.trim()}
                >
                  <Plus size={14} /> 保存 MCP Server
                </button>
              </div>
            </div>
          </div>

          <div className="card-section">
            <h3>已配置的 MCP 服务器 ({config?.mcpServers?.length || 0})</h3>
            {(config?.mcpServers || []).length === 0 ? (
              <div className="empty-hint">
                暂未在 `config.toml` 中配置外部 MCP Server
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
                          {srv.url ? "HTTP/SSE" : "STDIO"}
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
    </div>
  );
};

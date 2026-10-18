import React, { useEffect, useState } from "react";
import {
  Check,
  FileCode,
  Plus,
  RefreshCw,
  Save,
  Sliders,
  Sparkles,
  Trash2,
} from "lucide-react";
import { tauriInvoke } from "../bridge";
import {
  AppServerStatus,
  CodexConfigOverview,
  ModelInfo,
  ModelProviderConfig,
} from "../types";

interface SettingsViewProps {
  appServerStatus: AppServerStatus;
  models: ModelInfo[];
  onRestartAppServer: (customCliPath?: string) => void;
  onConfigUpdated: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  appServerStatus,
  models,
  onRestartAppServer,
  onConfigUpdated,
}) => {
  const [mode, setMode] = useState<"visual" | "raw">("visual");
  const [config, setConfig] = useState<CodexConfigOverview | null>(null);
  const [rawToml, setRawToml] = useState<string>("");
  const [customCliPath, setCustomCliPath] = useState<string>("");
  const [saveBanner, setSaveBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Structured fields
  const [model, setModel] = useState<string>("");
  const [modelProvider, setModelProvider] = useState<string>("");
  const [reasoningEffort, setReasoningEffort] = useState<string>("medium");
  const [approvalPolicy, setApprovalPolicy] = useState<string>("on-request");
  const [sandboxMode, setSandboxMode] = useState<string>("workspace-write");
  const [modelCatalogJson, setModelCatalogJson] = useState<string>("");
  const [providers, setProviders] = useState<ModelProviderConfig[]>([]);

  // New provider inputs
  const [newProvId, setNewProvId] = useState<string>("");
  const [newProvName, setNewProvName] = useState<string>("");
  const [newProvUrl, setNewProvUrl] = useState<string>("");
  const [newProvEnvKey, setNewProvEnvKey] = useState<string>("");

  const loadConfig = async () => {
    try {
      const cfg = await tauriInvoke<CodexConfigOverview>("config_read");
      setConfig(cfg);
      setRawToml(cfg.rawToml);
      setModel(cfg.model || "");
      setModelProvider(cfg.modelProvider || "");
      setReasoningEffort(cfg.modelReasoningEffort || "medium");
      setApprovalPolicy(cfg.approvalPolicy || "on-request");
      setSandboxMode(cfg.sandboxMode || "workspace-write");
      setModelCatalogJson(cfg.modelCatalogJson || "");
      setProviders(cfg.providers || []);
      setErrorBanner(null);
    } catch (err: any) {
      setErrorBanner(err?.message || String(err));
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const flashSaved = (msg: string) => {
    setSaveBanner(msg);
    setTimeout(() => setSaveBanner(null), 2500);
  };

  const handleSaveVisual = async () => {
    setErrorBanner(null);
    try {
      const updated = await tauriInvoke<CodexConfigOverview>("config_update", {
        payload: {
          model,
          modelProvider,
          modelReasoningEffort: reasoningEffort,
          approvalPolicy,
          sandboxMode,
          modelCatalogJson,
          providers,
          mcpServers: null,
        },
      });
      setConfig(updated);
      setRawToml(updated.rawToml);
      flashSaved("已保存至 ~/.codex/config.toml（model_catalog_json 保持在根级键）");
      onConfigUpdated();
    } catch (err: any) {
      setErrorBanner(err?.message || String(err));
    }
  };

  const handleSaveRaw = async () => {
    setErrorBanner(null);
    try {
      const updated = await tauriInvoke<CodexConfigOverview>(
        "config_save_raw",
        { rawToml }
      );
      setConfig(updated);
      setRawToml(updated.rawToml);
      flashSaved("TOML 源码已校验并保存！");
      onConfigUpdated();
    } catch (err: any) {
      setErrorBanner(err?.message || String(err));
    }
  };

  const handleGenerateModelsApi = async () => {
    try {
      const path = await tauriInvoke<string>("config_generate_models_api");
      setModelCatalogJson(path);
      flashSaved(`已生成自定义模型目录: ${path}`);
    } catch (err: any) {
      setErrorBanner(err?.message || String(err));
    }
  };

  const handleAddProvider = () => {
    if (!newProvId.trim() || !newProvUrl.trim()) return;
    const item: ModelProviderConfig = {
      id: newProvId.trim(),
      name: newProvName.trim() || newProvId.trim(),
      baseUrl: newProvUrl.trim(),
      envKey: newProvEnvKey.trim() || "OPENAI_API_KEY",
      wireApi: "responses",
    };
    setProviders((prev) => [
      ...prev.filter((p) => p.id !== item.id),
      item,
    ]);
    setNewProvId("");
    setNewProvName("");
    setNewProvUrl("");
    setNewProvEnvKey("");
  };

  return (
    <div className="panel-page">
      <div className="panel-page-header">
        <div className="sub-tabs">
          <button
            type="button"
            className={`sub-tab ${mode === "visual" ? "active" : ""}`}
            onClick={() => setMode("visual")}
          >
            <Sliders size={15} />
            <span>可视化设置 & Provider</span>
          </button>
          <button
            type="button"
            className={`sub-tab ${mode === "raw" ? "active" : ""}`}
            onClick={() => setMode("raw")}
          >
            <FileCode size={15} />
            <span>config.toml 源码编辑器</span>
          </button>
        </div>
        <div className="header-right-btns">
          <button type="button" className="secondary-btn" onClick={loadConfig}>
            <RefreshCw size={14} /> 重新读取
          </button>
          {mode === "visual" ? (
            <button
              type="button"
              className="primary-btn"
              onClick={handleSaveVisual}
            >
              <Save size={14} /> 保存配置
            </button>
          ) : (
            <button
              type="button"
              className="primary-btn"
              onClick={handleSaveRaw}
            >
              <Save size={14} /> 校验并保存 TOML
            </button>
          )}
        </div>
      </div>

      {saveBanner && (
        <div className="success-banner">
          <Check size={14} /> {saveBanner}
        </div>
      )}
      {errorBanner && <div className="error-banner">{errorBanner}</div>}

      {mode === "visual" ? (
        <div className="settings-scroll-container">
          {/* App-Server Runtime Section */}
          <div className="card-section">
            <h3>Codex App-Server 运行时连接</h3>
            <div className="form-grid-row">
              <div className="form-field">
                <label>当前连接状态</label>
                <div className="status-pill-inline">
                  <span
                    className={`status-dot ${
                      appServerStatus.connected ? "online" : "offline"
                    }`}
                  />
                  <span>
                    {appServerStatus.connected
                      ? `已连接 (${appServerStatus.userAgent || "stdio"})`
                      : appServerStatus.connecting
                        ? "连接中..."
                        : `未连接: ${appServerStatus.lastError || ""}`}
                  </span>
                </div>
              </div>
              <div className="form-field">
                <label>自定义 Codex CLI 可执行文件路径 (可选)</label>
                <input
                  type="text"
                  placeholder={appServerStatus.binaryPath || "codex"}
                  value={customCliPath}
                  onChange={(e) => setCustomCliPath(e.target.value)}
                />
              </div>
              <div className="form-field form-field-end">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => onRestartAppServer(customCliPath || undefined)}
                >
                  <RefreshCw size={14} /> 重启 App-Server
                </button>
              </div>
            </div>
          </div>

          {/* Core Model & Sandbox Settings */}
          <div className="card-section">
            <h3>核心模型、推理强度与沙盒策略</h3>
            <div className="form-grid-row">
              <div className="form-field">
                <label>默认模型 (`model`)</label>
                <input
                  type="text"
                  list="codex-models-datalist"
                  placeholder="例如：gpt-5.4 或 gpt-6-astra"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
                <datalist id="codex-models-datalist">
                  {models.map((m) => (
                    <option key={m.model} value={m.model}>
                      {m.displayName || m.model}
                    </option>
                  ))}
                </datalist>
              </div>

              <div className="form-field">
                <label>默认 Provider (`model_provider`)</label>
                <input
                  type="text"
                  placeholder="留空使用官方默认，或填自定义 provider ID"
                  value={modelProvider}
                  onChange={(e) => setModelProvider(e.target.value)}
                />
              </div>

              <div className="form-field">
                <label>默认推理强度 (`model_reasoning_effort`)</label>
                <select
                  value={reasoningEffort}
                  onChange={(e) => setReasoningEffort(e.target.value)}
                >
                  <option value="low">low (快速)</option>
                  <option value="medium">medium (平衡)</option>
                  <option value="high">high (深度思考)</option>
                  <option value="xhigh">xhigh (极高推理)</option>
                  <option value="max">max (最大推理)</option>
                  <option value="ultra">ultra (Ultra 协同)</option>
                </select>
              </div>

              <div className="form-field">
                <label>命令审批策略 (`approval_policy`)</label>
                <select
                  value={approvalPolicy}
                  onChange={(e) => setApprovalPolicy(e.target.value)}
                >
                  <option value="on-request">on-request (按需弹窗审批)</option>
                  <option value="untrusted">untrusted (严格审批非受信操作)</option>
                  <option value="never">never (全自动免审批)</option>
                </select>
              </div>

              <div className="form-field">
                <label>沙盒模式 (`sandbox_mode`)</label>
                <select
                  value={sandboxMode}
                  onChange={(e) => setSandboxMode(e.target.value)}
                >
                  <option value="workspace-write">
                    workspace-write (允许读写当前工作区)
                  </option>
                  <option value="read-only">read-only (只读安全模式)</option>
                  <option value="danger-full-access">
                    danger-full-access (完全访问权限)
                  </option>
                </select>
              </div>
            </div>
          </div>

          {/* Custom Model Catalog JSON */}
          <div className="card-section">
            <h3>
              自定义模型目录 (`model_catalog_json`) — 自动固定于 `config.toml` 根级键
            </h3>
            <div className="form-grid-row">
              <div className="form-field" style={{ flex: 2 }}>
                <label>模型目录 JSON 路径</label>
                <input
                  type="text"
                  placeholder="例如：C:\Users\you\.codex\models-api.json"
                  value={modelCatalogJson}
                  onChange={(e) => setModelCatalogJson(e.target.value)}
                />
              </div>
              <div className="form-field form-field-end">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={handleGenerateModelsApi}
                >
                  <Sparkles size={14} /> 一键生成示例 models-api.json
                </button>
              </div>
            </div>
          </div>

          {/* Custom Model Providers */}
          <div className="card-section">
            <h3>自定义 Model Providers (`[model_providers.*]`)</h3>
            <div className="form-grid-row">
              <div className="form-field">
                <label>Provider ID</label>
                <input
                  type="text"
                  placeholder="例如：crs 或 deepseek"
                  value={newProvId}
                  onChange={(e) => setNewProvId(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label>显示名称</label>
                <input
                  type="text"
                  placeholder="例如：Custom Relay"
                  value={newProvName}
                  onChange={(e) => setNewProvName(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label>Base URL</label>
                <input
                  type="text"
                  placeholder="https://api.example.com/v1"
                  value={newProvUrl}
                  onChange={(e) => setNewProvUrl(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label>API Key 环境变量名 (`env_key`)</label>
                <input
                  type="text"
                  placeholder="OPENAI_API_KEY"
                  value={newProvEnvKey}
                  onChange={(e) => setNewProvEnvKey(e.target.value)}
                />
              </div>
              <div className="form-field form-field-end">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={handleAddProvider}
                  disabled={!newProvId.trim() || !newProvUrl.trim()}
                >
                  <Plus size={14} /> 添加到列表
                </button>
              </div>
            </div>

            {providers.length > 0 && (
              <div className="item-cards-list" style={{ marginTop: 12 }}>
                {providers.map((p) => (
                  <div key={p.id} className="item-card">
                    <div className="item-card-main">
                      <div className="item-card-title-row">
                        <strong>{p.name}</strong>
                        <span className="tag-badge accent">[{p.id}]</span>
                        <span className="tag-badge">
                          wire_api = {p.wireApi || "responses"}
                        </span>
                      </div>
                      <div className="item-card-meta">
                        <span className="mono-text">{p.baseUrl}</span>
                        {p.envKey && <span>env_key: {p.envKey}</span>}
                      </div>
                    </div>
                    <div className="item-card-actions">
                      <button
                        type="button"
                        className="secondary-btn-sm"
                        onClick={() => setModelProvider(p.id)}
                      >
                        设为默认 Provider
                      </button>
                      <button
                        type="button"
                        className="danger-btn-sm"
                        onClick={() =>
                          setProviders((prev) =>
                            prev.filter((x) => x.id !== p.id)
                          )
                        }
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
      ) : (
        <div className="raw-toml-editor-wrap">
          <div className="raw-toml-meta">
            配置文件路径: <code className="mono-text">{config?.configPath}</code>
          </div>
          <textarea
            className="code-editor-textarea"
            value={rawToml}
            onChange={(e) => setRawToml(e.target.value)}
            placeholder="# ~/.codex/config.toml"
          />
        </div>
      )}
    </div>
  );
};

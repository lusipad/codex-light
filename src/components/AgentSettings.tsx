import React, { useEffect, useRef, useState } from "react";
import { configBatchWrite, configRead, configRequirementsRead, getConfigValue, type ConfigEdit, type ConfigReadResult } from "../config";
import { findModel, getSupportedEfforts } from "../modelCapabilities";
import type { ModelInfo } from "../types";

const FIELDS = [
  ["model", "默认模型", null],
  ["model_reasoning_effort", "推理强度", null],
  ["model_verbosity", "输出详实度", ["low", "medium", "high"]],
  ["web_search", "联网搜索", ["disabled", "cached", "indexed", "live"]],
  ["approval_policy", "审批策略", ["on-request", "never"]],
  ["approvals_reviewer", "审批审查方", ["user", "auto_review"]],
  ["sandbox_mode", "沙盒模式", ["read-only", "workspace-write", "danger-full-access"]],
] as const;

export function userConfigLayer(snapshot: ConfigReadResult) {
  const layer = snapshot.layers?.find((entry: any) =>
    entry?.name?.type === "user" && !entry.name.profile && !entry.disabledReason
  ) as { name: { file: string }; version: string; config: Record<string, unknown> } | undefined;
  if (!layer?.name.file || !layer.version || !layer.config) {
    throw Error("无法确定可写的用户配置层，请重新加载配置。");
  }
  return layer;
}

function draftFrom(snapshot: ConfigReadResult) {
  const raw = userConfigLayer(snapshot).config;
  return Object.fromEntries(FIELDS.map(([key]) => [
    key, typeof raw[key] === "string" ? raw[key] : "",
  ]));
}

export function agentConfigEdits(snapshot: ConfigReadResult, draft: Record<string, string>): ConfigEdit[] {
  const initial = draftFrom(snapshot);
  return FIELDS.filter(([key]) => draft[key] !== initial[key]).map(([key]) => ({
    keyPath: key, value: draft[key].trim() || null, mergeStrategy: "replace",
  }));
}

export async function saveAgentConfig(snapshot: ConfigReadResult, draft: Record<string, string>) {
  const layer = userConfigLayer(snapshot);
  const edits = agentConfigEdits(snapshot, draft);
  if (!edits.length) return { snapshot, message: "没有未保存的修改。" };
  const result = await configBatchWrite(edits, {
    filePath: layer.name.file, expectedVersion: layer.version, reloadUserConfig: true,
  });
  let updated: ConfigReadResult;
  try {
    updated = await configRead(undefined, true);
    const saved = userConfigLayer(updated);
    for (const edit of edits) {
      if ((getConfigValue(saved.config, edit.keyPath) ?? null) !== edit.value) {
        throw Error(`${edit.keyPath} 的落盘值与提交值不同`);
      }
    }
  } catch (error) {
    throw Error(`写入已返回成功，但读回核验失败；草稿已保留，请重新加载后核对：${String(error)}`);
  }
  const overridden = edits.some(edit =>
    (getConfigValue(updated.config, edit.keyPath) ?? null) !== edit.value && edit.value !== null
  );
  return {
    snapshot: updated,
    message: result.status === "okOverridden" || overridden
      ? `已写入用户配置，但部分值被其他配置层覆盖。${result.overriddenMetadata?.message || ""}`
      : "已保存并读回核验。模型与推理默认值用于后续会话。",
  };
}

export function AgentSettings({ models, onConfigUpdated }: {
  models: ModelInfo[]; onConfigUpdated: () => void | Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<ConfigReadResult | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [requirements, setRequirements] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const operation = useRef(false);
  const generation = useRef(0);

  const load = async () => {
    if (operation.current) return;
    operation.current = true;
    const version = generation.current;
    setBusy(true); setError(null); setMessage(null);
    try {
      const config = await configRead(undefined, true);
      const managed = await configRequirementsRead();
      const values = draftFrom(config);
      if (version !== generation.current) return;
      setSnapshot(config); setDraft(values); setRequirements(managed.requirements);
    } catch (error) {
      if (version === generation.current) setError(`读取失败：${String(error)}`);
    } finally {
      if (version === generation.current) { operation.current = false; setBusy(false); }
    }
  };

  useEffect(() => {
    void load();
    return () => { generation.current += 1; operation.current = false; };
  }, []);

  const save = async () => {
    if (operation.current || !snapshot) return;
    operation.current = true;
    const version = generation.current;
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await saveAgentConfig(snapshot, draft);
      if (version !== generation.current) return;
      setSnapshot(result.snapshot); setDraft(draftFrom(result.snapshot)); setMessage(result.message);
      try { await onConfigUpdated(); } catch (error) {
        if (version === generation.current) setError(`配置已核验，但刷新应用失败：${String(error)}`);
      }
    } catch (error) {
      if (version === generation.current) setError(String(error));
    } finally {
      if (version === generation.current) { operation.current = false; setBusy(false); }
    }
  };

  const currentModel = findModel(models, draft.model || String(snapshot?.config.model || ""));
  const efforts = getSupportedEfforts(currentModel).map(entry => entry.reasoningEffort);
  return (
    <div className="settings-scroll-container">
      <div className="card-section">
        <h3>本地智能体默认设置</h3>
        <p className="card-subtitle-desc">保存到用户配置，项目设置可能覆盖这些默认值。留空表示恢复默认。</p>
        {requirements && <p role="status">部分设置受到组织策略约束，保存时会校验。</p>}
        {error && <div role="alert" className="error-banner">{error}</div>}
        {message && <div role="status" className="success-banner">{message}</div>}
        <fieldset disabled={busy || !snapshot} style={{ border: 0, padding: 0 }}>
          <div className="form-grid-row">
            {FIELDS.map(([key, label, choices]) => {
              const options: readonly string[] | null = key === "model_reasoning_effort" ? efforts : choices;
              const raw = snapshot ? userConfigLayer(snapshot).config[key] : undefined;
              const complex = raw != null && typeof raw !== "string";
              const effective = getConfigValue(snapshot?.config, key);
              const value = draft[key] || "";
              return (
                <div className="form-field" key={key}>
                  <label htmlFor={`agent-${key}`}>{label}</label>
                  {options ? (
                    <select id={`agent-${key}`} value={value} disabled={complex}
                      onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))}>
                      <option value="">使用默认值</option>
                      {value && !options.includes(value) && <option value={value}>{value}（当前配置值）</option>}
                      {options.map(option => <option key={option} value={option}>{option}</option>)}
                    </select>
                  ) : (
                    <input id={`agent-${key}`} value={value} list="agent-models"
                      onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))} />
                  )}
                  <span>当前生效：{effective == null ? "默认" : typeof effective === "string" ? effective : JSON.stringify(effective)}</span>
                  {complex && <span>当前为自定义对象，请在配置文件中编辑。</span>}
                </div>
              );
            })}
          </div>
        </fieldset>
        <datalist id="agent-models">{models.map(model => <option key={model.id} value={model.model || model.id}>{model.displayName}</option>)}</datalist>
      </div>
      <div className="settings-section-bottom-bar">
        <button type="button" className="primary-btn" disabled={busy || !snapshot} onClick={save}>{busy ? "处理中…" : "保存更改"}</button>
        <button type="button" className="secondary-btn" disabled={busy} onClick={load}>重新加载</button>
      </div>
    </div>
  );
}

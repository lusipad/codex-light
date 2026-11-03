import { useEffect, useRef, useState } from "react";
import { tauriInvoke, tauriListen } from "./bridge";
import { getConfigValue, type ConfigReadResult } from "./config";

export type AgentConfigurationFieldKey = "approval_policy" | "sandbox_mode" |
  "sandbox_workspace_write.network_access" | "web_search" | "model_verbosity" | "model_reasoning_summary";
export interface AgentConfigurationScope {
  id: string; kind: "user" | "project" | "managed"; label: string;
  filePath: string | null; version: string | null; config: Record<string, unknown>;
  disabledReason: string | null; cwd?: string; contents?: string | null;
}
export interface AgentConfigurationData {
  snapshot: ConfigReadResult; requirements: Record<string, unknown> | null;
  serverVersion: string | null; scopes: AgentConfigurationScope[];
}
export interface AgentConfigurationOption { value: string | null; label: string }
export interface AgentConfigurationField {
  key: AgentConfigurationFieldKey; label: string; description: string; value: unknown;
  effectiveValue: unknown; inherited: boolean; options: AgentConfigurationOption[];
  disabled: boolean; lockedReason: string | null; visible: boolean;
}
const options = (...entries: [string | null, string][]): AgentConfigurationOption[] => entries.map(([value, label]) => ({ value, label }));
export const AGENT_CONFIGURATION_FIELDS = [
  { key: "approval_policy", label: "批准策略", description: "选择 ChatGPT 何时请求批准", options: options(["on-request", "按请求"], ["never", "从不请求审批"]) },
  { key: "sandbox_mode", label: "沙盒设置", description: "选择 ChatGPT 运行命令时的权限范围", options: options(["read-only", "只读"], ["workspace-write", "工作空间写入"], ["danger-full-access", "完整访问权限"]) },
  { key: "sandbox_workspace_write.network_access", label: "允许网络访问", description: "当沙盒设为工作空间写入时允许网络访问", options: [] },
  { key: "web_search", label: "网页搜索", description: "选择 ChatGPT 访问网络的方式", options: options(["disabled", "禁用"], ["cached", "缓存"], ["indexed", "索引"], ["live", "实时"]) },
  { key: "model_verbosity", label: "输出详细程度", description: "选择 ChatGPT 回复包含细节的详细程度", options: options([null, "模型默认"], ["low", "低"], ["medium", "中"], ["high", "高"]) },
  { key: "model_reasoning_summary", label: "推理摘要", description: "选择 ChatGPT 总结其推理的方式", options: options(["auto", "自动"], ["concise", "简洁"], ["detailed", "详细"], ["none", "无"]) },
] satisfies { key: AgentConfigurationFieldKey; label: string; description: string; options: AgentConfigurationOption[] }[];

export function supportsIndexedSearch(version: string | null): boolean {
  if (version === "0.0.0") return true;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version ?? "");
  if (!match) return false;
  const core = match.slice(1, 4).map(Number);
  const threshold = [0, 142, 0];
  for (let i = 0; i < 3; i += 1) if (core[i] !== threshold[i]) return core[i] > threshold[i];
  if (!match[4]) return true;
  const left = match[4].split("."), right = ["alpha", "6"];
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i] === undefined) return false;
    if (right[i] === undefined) return true;
    if (left[i] === right[i]) continue;
    const a = /^\d+$/.test(left[i]), b = /^\d+$/.test(right[i]);
    return a && b ? Number(left[i]) > Number(right[i]) : a !== b ? !a : left[i] > right[i];
  }
  return true;
}

export function getScopeFieldValue(data: AgentConfigurationData, scope: AgentConfigurationScope | null, key: AgentConfigurationFieldKey): unknown {
  const own = getConfigValue(scope?.config, key);
  if (own != null) return own;
  const effective = getConfigValue(data.snapshot.config, key);
  if (effective != null) return effective;
  switch (key) {
    case "approval_policy": return "on-request";
    case "sandbox_mode": return "read-only";
    case "sandbox_workspace_write.network_access": return false;
    case "web_search": return getScopeFieldValue(data, scope, "sandbox_mode") === "danger-full-access" ? "live" : "cached";
    case "model_reasoning_summary": return "auto";
    default: return null;
  }
}

export function defaultAgentScope(data: AgentConfigurationData, cwd?: string): string | null {
  return (cwd ? data.scopes.find(scope => scope.kind === "project" && scope.cwd === cwd) ?? data.scopes.find(scope => scope.kind === "project") : undefined)?.id ??
    data.scopes.find(scope => scope.kind === "user")?.id ?? data.scopes[0]?.id ?? null;
}
export function agentConfigurationFields(data: AgentConfigurationData, scope: AgentConfigurationScope | null): AgentConfigurationField[] {
  const scopeReason = !scope ? "配置范围不可用。" : scope.kind === "managed" || !scope.filePath ? "无法在此处编辑该配置源。" : scope.disabledReason;
  return AGENT_CONFIGURATION_FIELDS.map(definition => {
    const { key } = definition;
    const value = getScopeFieldValue(data, scope, key);
    let candidates = [...definition.options];
    const requirementsKey = key === "approval_policy" ? "allowedApprovalPolicies" : key === "sandbox_mode" ? "allowedSandboxModes" : key === "web_search" ? "allowedWebSearchModes" : null;
    const allowed = requirementsKey ? data.requirements?.[requirementsKey] : undefined;
    if (Array.isArray(allowed)) candidates = candidates.filter(option => (key === "web_search" && option.value === "disabled") || allowed.includes(option.value));
    if (key === "web_search" && !supportsIndexedSearch(data.serverVersion)) candidates = candidates.filter(option => option.value !== "indexed");
    const origin = data.snapshot.origins[key] ?? (key.includes(".") ? data.snapshot.origins[key.split(".")[0]] : undefined);
    const managed = ["mdm", "sessionFlags", "legacyManagedConfigTomlFromFile", "legacyManagedConfigTomlFromMdm"].includes(String(origin?.name?.type));
    const complex = value != null && typeof value === "object";
    const noOptions = key !== "sandbox_workspace_write.network_access" && candidates.length === 0;
    const lockedReason = scopeReason || (managed ? "该值由管理员策略管理。" : complex ? "当前为自定义策略，请在配置文件中编辑。" : noOptions ? "此设置受此次安装的限制。" : null);
    return { ...definition, value, effectiveValue: getConfigValue(data.snapshot.config, key), inherited: getConfigValue(scope?.config, key) == null,
      options: candidates, disabled: !!lockedReason, lockedReason,
      visible: key !== "sandbox_workspace_write.network_access" || getScopeFieldValue(data, scope, "sandbox_mode") === "workspace-write" };
  });
}

export function useAgentConfiguration({ cwd, accountIdentity }: { cwd?: string; accountIdentity?: string } = {}) {
  const context = JSON.stringify([cwd ?? null, accountIdentity ?? null]);
  const [data, setData] = useState<AgentConfigurationData | null>(null);
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingKey, setPendingKey] = useState<AgentConfigurationFieldKey | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const live = useRef({ context, epoch: 0, request: 0, mounted: true, data, selectedScopeId, busy: false, reading: false, needsReload: false });
  if (live.current.context !== context) {
    live.current.context = context; live.current.epoch += 1; live.current.request += 1;
    live.current.data = null; live.current.selectedScopeId = null; live.current.busy = false;
  }
  const current = live.current;
  const valid = (epoch: number) => current.mounted && current.context === context && current.epoch === epoch;
  const reload = async () => {
    if (current.busy) { current.needsReload = true; return; }
    const epoch = current.epoch, request = ++current.request;
    current.reading = true; setLoading(true);
    try {
      const result = await tauriInvoke<AgentConfigurationData>("agent_configuration_read", { cwd: cwd ?? null });
      if (!valid(epoch) || request !== current.request) return;
      const selected = result.scopes.some(scope => scope.id === current.selectedScopeId) ? current.selectedScopeId : defaultAgentScope(result, cwd);
      current.data = result; current.selectedScopeId = selected;
      setData(result); setSelectedScopeId(selected); setErrors({});
    } catch (error) {
      if (valid(epoch) && request === current.request) { current.data = null; setData(null); setErrors({ _load: String(error) }); }
    } finally { if (valid(epoch) && request === current.request) { current.reading = false; setLoading(false); } }
  };
  useEffect(() => {
    current.mounted = true; setData(null); setSelectedScopeId(null); setPendingKey(null); setErrors({}); void reload();
    let disposed = false, unlisten: (() => void) | undefined;
    void tauriListen("agent-configuration-changed", () => {
      if (disposed) return;
      if (current.busy) current.needsReload = true; else void reload();
    }).then(stop => { if (disposed) stop(); else unlisten = stop; });
    return () => { disposed = true; unlisten?.(); current.mounted = false; current.epoch += 1; current.request += 1; };
  }, [context]);
  const selectScope = (id: string) => {
    if (!current.data?.scopes.some(scope => scope.id === id)) return;
    current.selectedScopeId = id; current.epoch += 1; current.request += 1; current.busy = false;
    setSelectedScopeId(id); setPendingKey(null); setErrors({}); void reload();
  };
  const change = async (key: AgentConfigurationFieldKey, value: unknown): Promise<boolean> => {
    const snapshot = current.data;
    const scope = snapshot?.scopes.find(scope => scope.id === current.selectedScopeId) ?? null;
    if (!snapshot || !scope || current.busy || current.reading) return false;
    const field = agentConfigurationFields(snapshot, scope).find(field => field.key === key);
    if (!field || field.disabled || !field.visible || (key === "sandbox_workspace_write.network_access" ? typeof value !== "boolean" : !field.options.some(option => option.value === value))) return false;
    if (Object.is(getConfigValue(scope.config, key) ?? null, value)) return true;
    const epoch = current.epoch;
    current.busy = true; current.request += 1; setPendingKey(key); setErrors({});
    try {
      const result = await tauriInvoke<AgentConfigurationData>("agent_configuration_write", {
        cwd: cwd ?? null, scopeId: scope.id, keyPath: key, value, expectedVersion: scope.version,
        expectedContents: scope.kind === "project" ? scope.contents ?? null : null,
      });
      if (!valid(epoch) || current.selectedScopeId !== scope.id) return false;
      const saved = result.scopes.find(entry => entry.id === scope.id);
      if (!saved || (getConfigValue(saved.config, key) ?? null) !== value) throw Error("写入已返回，但读回值与提交值不同，请重新加载后核对。");
      current.data = result; setData(result); return true;
    } catch (error) {
      if (valid(epoch)) setErrors({ [key]: String(error) });
      return false;
    } finally {
      if (valid(epoch)) {
        current.busy = false; setPendingKey(null);
        if (current.needsReload) { current.needsReload = false; void reload(); }
      }
    }
  };
  const openConfig = async () => {
    const id = current.selectedScopeId, epoch = current.epoch;
    if (!id) return;
    try { await tauriInvoke("agent_configuration_open", { cwd: cwd ?? null, scopeId: id }); }
    catch (error) { if (valid(epoch)) setErrors(previous => ({ ...previous, _open: String(error) })); }
  };
  const visibleData = current.context === context ? current.data : null;
  const scopes = visibleData?.scopes ?? [];
  const scope = scopes.find(scope => scope.id === selectedScopeId) ?? null;
  return { data: visibleData, scopes, scope, selectedScopeId, selectScope,
    fields: visibleData ? agentConfigurationFields(visibleData, scope).map(field => loading ? { ...field, disabled: true } : field) : [], loading, pendingKey, errors, reload, change, openConfig };
}

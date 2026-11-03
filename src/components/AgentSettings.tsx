import React, { useEffect, useRef, useState } from "react";
import { useAgentConfiguration, type AgentConfigurationFieldKey } from "../agentConfiguration";
import type { ModelInfo } from "../types";
import { CheckIcon, ChevronDownIcon, ExternalWindowIcon } from "./Icons";
import "./AgentSettings.css";

type Choice = { value: string | null; label: string; description?: string; group?: string };
// Fixed zh-CN-88ebb426d686.js: settings.agent.configuration.{webSearch,modelVerbosity,reasoningSummary}.option.*.description.
const OPTION_DESCRIPTIONS: Record<string, Record<string, string>> = {
  web_search: { disabled: "不允许网页搜索", cached: "使用 OpenAI 维护的搜索索引", indexed: "允许访问已索引的外部网页", live: "允许不受限制地访问当前网页" },
  model_verbosity: { low: "保持回复简洁", medium: "兼顾细节与简洁", high: "在回复中包含更多细节" },
  model_reasoning_summary: { auto: "让模型选择摘要详细程度", concise: "显示简要推理摘要", detailed: "显示更详细的推理摘要", none: "不显示推理摘要" },
};
const LEGACY_LABELS: Record<string, string> = { "on-failure": "失败时", untrusted: "不可信" };

function ConfigurationMenu({ id, label, value, options, disabled, describedBy, emptyLabel = "模型默认", onSelect }: {
  id: string; label: string; value: unknown; options: Choice[]; disabled: boolean;
  describedBy?: string; emptyLabel?: string; onSelect: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const selected = options.find(option => option.value === value);
  const text = selected?.label ?? (typeof value === "string" ? LEGACY_LABELS[value] ?? value : value == null ? emptyLabel : "自定义");
  const close = (restoreFocus: boolean) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    if (disabled) { setOpen(false); return; }
    const items = menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]");
    const selectedIndex = options.findIndex(option => option.value === value);
    items?.[Math.max(selectedIndex, 0)]?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, disabled]);
  return <div className="agent-configuration-menu" ref={root}>
    <button type="button" id={id} ref={trigger} className="agent-configuration-trigger"
      aria-label={label} aria-describedby={describedBy} aria-haspopup="menu" aria-expanded={open}
      aria-controls={`${id}-menu`} disabled={disabled} onClick={() => setOpen(!open)}
      onKeyDown={event => {
        if (!event.nativeEvent.isComposing && !disabled && ["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault(); setOpen(true);
        }
      }}><span>{text}</span><span aria-hidden="true"><ChevronDownIcon /></span></button>
    {open && !disabled && <div id={`${id}-menu`} className="agent-configuration-options" role="menu" aria-label={label} ref={menu}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
        if (event.key === "Tab") { close(true); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") ?? []);
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
      {options.map((option, index) => <React.Fragment key={option.value ?? "model-default"}>
        {option.group && option.group !== options[index - 1]?.group && <div className="agent-configuration-group" role="presentation">{option.group}</div>}
        <button type="button" role="menuitemradio" aria-checked={option.value === value}
          onClick={() => { close(true); onSelect(option.value); }}>
          <span className="agent-configuration-choice"><span>{option.label}</span>
            {option.description && <span className="agent-configuration-choice-description">{option.description}</span>}</span>
          <span aria-hidden="true">{option.value === value && <CheckIcon />}</span>
        </button>
      </React.Fragment>)}
    </div>}
  </div>;
}

export function AgentSettings({ cwd, accountIdentity, onConfigUpdated }: {
  models?: ModelInfo[]; cwd?: string; accountIdentity?: string;
  onConfigUpdated?: () => void | Promise<void>;
}) {
  const state = useAgentConfiguration({ cwd, accountIdentity });
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const alive = useRef(0);
  useEffect(() => { alive.current++; return () => { alive.current++; }; }, [cwd, accountIdentity]);
  const change = async (key: AgentConfigurationFieldKey, value: unknown) => {
    const generation = alive.current;
    setRefreshError(null);
    if (await state.change(key, value) && generation === alive.current) {
      try { await onConfigUpdated?.(); }
      catch { if (generation === alive.current) setRefreshError("设置已更新，但无法刷新应用。请重新加载。"); }
    }
  };
  return <div className="settings-scroll-container agent-configuration" aria-busy={state.loading}>
    <div className="agent-configuration-toolbar">
      <ConfigurationMenu id="agent-config-scope" label="配置范围" value={state.selectedScopeId}
        emptyLabel={state.loading ? "正在加载..." : "配置范围不可用。"}
        options={state.scopes.map(scope => ({ value: scope.id, label: scope.label, group: scope.kind === "project" ? "项目配置" : "全局配置" }))}
        disabled={state.loading || !state.scopes.length || state.pendingKey != null}
        onSelect={id => { if (id) { setRefreshError(null); state.selectScope(id); } }} />
      <button type="button" className="agent-configuration-open" disabled={state.loading || !state.scope?.filePath}
        onClick={() => void state.openConfig()}>打开 config.toml <span aria-hidden="true"><ExternalWindowIcon /></span></button>
    </div>
    {state.loading && !state.data && <p role="status" className="card-subtitle-desc">正在加载...</p>}
    {state.errors._load && <div role="alert" className="agent-configuration-error">{state.errors._load}
      <button type="button" className="agent-configuration-open" disabled={state.loading} onClick={() => void state.reload()}>重新加载</button>
    </div>}
    {state.errors._open && <p role="alert" className="agent-configuration-error">{state.errors._open}</p>}
    {refreshError && <p role="alert" className="agent-configuration-error">{refreshError}</p>}
    {state.scope?.disabledReason && <p role="alert" className="agent-configuration-lock">{state.scope.disabledReason}</p>}
    <div className="agent-configuration-rows">
      {state.fields.filter(field => field.visible).map(field => {
        const id = `agent-${field.key}`;
        const disabled = state.loading || field.disabled || state.pendingKey === field.key;
        return <div className="agent-configuration-row" key={field.key} aria-busy={state.pendingKey === field.key}>
          <div className="agent-configuration-copy">
            <label htmlFor={id}>{field.label}</label>
            <div id={`${id}-description`} className="agent-configuration-description">{field.description}</div>
            {field.lockedReason && <div className="agent-configuration-lock">{field.lockedReason}</div>}
            {state.errors[field.key] && <div role="alert" id={`${id}-error`} className="agent-configuration-error">{state.errors[field.key]}</div>}
          </div>
          {field.key === "sandbox_workspace_write.network_access"
            ? <button type="button" role="switch" id={id} aria-label={field.label} aria-checked={field.value === true}
              aria-describedby={`${id}-description${state.errors[field.key] ? ` ${id}-error` : ""}`}
              className="agent-configuration-switch" disabled={disabled} onClick={() => void change(field.key, field.value !== true)}><span /></button>
            : <ConfigurationMenu id={id} label={field.label} value={field.value} disabled={disabled}
              describedBy={`${id}-description${state.errors[field.key] ? ` ${id}-error` : ""}`}
              options={field.options.map(option => ({ ...option, description: OPTION_DESCRIPTIONS[field.key]?.[option.value ?? ""] }))}
              onSelect={value => void change(field.key, value)} />}
        </div>;
      })}
    </div>
  </div>;
}

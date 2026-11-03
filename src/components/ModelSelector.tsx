import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, SparklesIcon } from "./Icons";
import { findModel, getDefaultModel, getPickerModels, getSupportedEfforts, getModelServiceTiers, getModelEligibility, resolveServiceTier, resolveModelSelection, type ModelConfiguration, type ModelEligibilityContext, type ServiceTierAccess } from "../modelCapabilities";
import { ModelInfo } from "../types";
import "./ModelSelector.css";

const EFFORT_LABELS: Record<string, string> = {
  none: "无",
  minimal: "最少",
  light: "轻",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
  ultra: "极限",
  persistent: "持续",
};

function formatModelName(model?: ModelInfo): string {
  const name = model?.displayName || model?.id || "默认";
  return name;
}

export interface ModelSelectorProps {
  models: ModelInfo[];
  modelsLoading?: boolean;
  modelsError?: string | null;
  onRefreshModels?: () => void;
  selectedModelId: string;
  defaultModelSelected: boolean;
  reasoningEffort: string;
  fastMode: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectModel: (modelId: string, useDefault: boolean) => void;
  onSelectReasoningEffort: (effort: string) => void;
  onToggleFastMode: () => void;
  serviceTier?: string | null;
  serviceTierAccess?: ServiceTierAccess | null;
  modelEligibilityContext?: ModelEligibilityContext;
  selectionPending?: boolean;
  selectionError?: string | null;
  selectionDisabledReason?: string | null;
  recentModelConfigurations?: ModelConfiguration[];
  recentOpen?: boolean;
  onSelectServiceTier?: (tier: string | null) => void;
  onSelectConfiguration?: (configuration: ModelConfiguration, useDefault?: boolean) => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  models,
  modelsLoading = false,
  modelsError,
  onRefreshModels,
  selectedModelId,
  defaultModelSelected,
  reasoningEffort,
  fastMode,
  open,
  onOpenChange,
  onSelectModel,
  onSelectReasoningEffort,
  onToggleFastMode,
  serviceTier = null,
  serviceTierAccess,
  modelEligibilityContext,
  selectionPending = false,
  selectionError,
  selectionDisabledReason,
  recentModelConfigurations = [],
  recentOpen = false,
  onSelectServiceTier,
  onSelectConfiguration,
}) => {
  const [view, setView] = useState<"compact" | "models">("compact");
  const [query, setQuery] = useState("");
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<"first" | "last">("first");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const defaultModel = getDefaultModel(models, modelEligibilityContext);
  const visibleModels = useMemo(() => getPickerModels(models, modelEligibilityContext), [models, modelEligibilityContext]);
  const activeModel = findModel(models, selectedModelId)
    || (!selectedModelId ? defaultModel : undefined)
    || (selectedModelId ? { id: selectedModelId, displayName: selectedModelId } : undefined);
  const supportedEfforts = useMemo(() => getSupportedEfforts(activeModel, modelEligibilityContext), [activeModel, modelEligibilityContext]);
  const activeEffort = supportedEfforts.find((effort) => effort.reasoningEffort === reasoningEffort)
    || supportedEfforts.find((effort) => effort.reasoningEffort === activeModel?.defaultReasoningEffort)
    || supportedEfforts[0];
  const activeEffortIndex = Math.max(0, supportedEfforts.indexOf(activeEffort));
  const unavailable = selectionPending || modelsLoading;
  const activeDisabledReason = selectionDisabledReason || getModelEligibility(activeModel, modelEligibilityContext).reason;
  const tierOptions = activeModel ? [{ id: null, name: "标准" }, ...getModelServiceTiers(activeModel)
    .filter(tier => tier.id !== "default").map(tier => ({ id: tier.id, name: tier.name || tier.id }))] : [];
  const currentConfiguration: ModelConfiguration = {
    model: activeModel?.model || activeModel?.id || selectedModelId,
    reasoningEffort: activeEffort?.reasoningEffort || null,
    serviceTier,
  };
  const resolveChoice = (model: ModelInfo) => {
    const requested = { model: model.model || model.id, reasoningEffort, serviceTier };
    const resolved = resolveModelSelection(models, requested, modelEligibilityContext, serviceTierAccess);
    return resolved.available ? resolved
      : resolveModelSelection(models, { ...requested, serviceTier: null }, modelEligibilityContext, serviceTierAccess);
  };
  const recentCandidates = useMemo(() => {
    const candidates = [...recentModelConfigurations, currentConfiguration, ...visibleModels.map(model => ({
      model: model.model || model.id,
      reasoningEffort: model.defaultReasoningEffort || getSupportedEfforts(model, modelEligibilityContext)[0]?.reasoningEffort || null,
      serviceTier: null,
    }))];
    const seen = new Set<string>();
    return candidates.flatMap(configuration => {
      const resolved = resolveModelSelection(models, configuration, modelEligibilityContext, serviceTierAccess);
      if (!resolved.available || !resolved.configuration ||
          resolved.configuration.reasoningEffort !== configuration.reasoningEffort) return [];
      const key = JSON.stringify(resolved.configuration);
      if (seen.has(key)) return [];
      seen.add(key);
      return [resolved.configuration];
    }).slice(0, 3);
  }, [models, recentModelConfigurations, selectedModelId, reasoningEffort, serviceTier, serviceTierAccess, modelEligibilityContext]);
  const search = query.trim().toLowerCase();
  const matchingRecent = recentCandidates.filter(configuration => {
    const model = findModel(models, configuration.model);
    return !search || `${formatModelName(model)} ${configuration.model} ${configuration.reasoningEffort || ""}`.toLowerCase().includes(search);
  });
  const matchingModels = search ? visibleModels.filter(model =>
    `${formatModelName(model)} ${model.model || model.id}`.toLowerCase().includes(search)) : [];
  const selectConfiguration = (configuration: ModelConfiguration, useDefault = false) => {
    if (unavailable) return;
    if (onSelectConfiguration) onSelectConfiguration(configuration, useDefault);
    else {
      const model = findModel(models, configuration.model);
      if (!model) return;
      onSelectModel(model.id, useDefault);
      if (configuration.reasoningEffort) onSelectReasoningEffort(configuration.reasoningEffort);
      onSelectServiceTier?.(configuration.serviceTier);
    }
    closeMenu();
  };
  const progress = supportedEfforts.length > 1
    ? `${(activeEffortIndex / (supportedEfforts.length - 1)) * 100}%`
    : "0%";

  useEffect(() => {
    if (!open) {
      setView("compact");
      setQuery("");
      return;
    }
    const frame = requestAnimationFrame(() => {
      const controls = menuRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
      const index = initialFocusRef.current === "last" ? (controls?.length || 1) - 1 : 0;
      controls?.[index]?.focus({ preventScroll: true });
      initialFocusRef.current = "first";
    });
    const dismiss = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", dismiss);
    };
  }, [open, recentOpen]);

  const closeMenu = () => {
    onOpenChange(false);
    requestAnimationFrame(() => {
      if (document.hasFocus()) triggerRef.current?.focus({ preventScroll: true });
    });
  };

  const handleMenuKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        initialFocusRef.current = event.key === "ArrowUp" ? "last" : "first";
        onOpenChange(true);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    if ((event.target as HTMLElement).matches('input[type="range"], input[type="search"]') &&
        ["Home", "End"].includes(event.key)) return;
    if ((event.target as HTMLElement).matches('input[type="range"]')) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") || []);
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : event.key === "ArrowDown"
          ? (current + 1 + buttons.length) % buttons.length
          : current < 0 ? buttons.length - 1 : (current - 1 + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  return (
    <div ref={containerRef} className="composer-dropdown-anchor model-selector" onKeyDown={handleMenuKeys}>
      <button
        ref={triggerRef}
        type="button"
        className="composer-inline-pill model-effort-pill"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={selectionPending}
        onClick={() => (open ? closeMenu() : onOpenChange(true))}
        title={activeDisabledReason || "选择模型、推理强度与生成速度"}
      >
        <span>{formatModelName(activeModel)}{activeEffort ? ` ${EFFORT_LABELS[activeEffort.reasoningEffort] || activeEffort.reasoningEffort}` : ""}</span>
        <ChevronDownIcon size={11} />
      </button>
      {!open && selectionError && <span role="alert">{selectionError}</span>}
      {!open && selectionPending && <span className="sr-only" role="status">正在更新模型配置…</span>}

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className={`composer-popover-menu bottom-right model-selector-popover ${view === "models" ? "model-list-view" : ""}`}
          role="menu"
          aria-label={recentOpen ? "最近模型" : view === "models" ? "选择模型" : "模型与推理强度"}
          aria-busy={selectionPending}
          data-model-picker-view={recentOpen ? "recent" : view}
        >
          {selectionPending && <div role="status">正在更新模型配置…</div>}
          {selectionError && <div role="alert">{selectionError}</div>}
          {activeDisabledReason && <div role="status">{activeDisabledReason}</div>}
          {modelsLoading && <div role="status">正在加载模型…</div>}
          {modelsError && <div role="alert">
            {modelsError}
            <button type="button" disabled={modelsLoading} onClick={onRefreshModels}>重新读取</button>
          </div>}
          {!modelsLoading && !modelsError && visibleModels.length === 0 && <div role="status">暂无可用模型</div>}
          {recentOpen ? (
            <>
              <input type="search" className="model-search" aria-label="搜索模型" placeholder="搜索模型" value={query}
                onChange={event => setQuery(event.target.value)} />
              <div className="model-list-heading">最近模型</div>
              {matchingRecent.map(configuration => {
                const model = findModel(models, configuration.model);
                return <button key={JSON.stringify(configuration)} type="button" role="menuitem"
                  disabled={unavailable} className="popover-menu-item model-choice" onClick={() => selectConfiguration(configuration)}>
                  <span className="popover-item-title">{formatModelName(model)}</span>
                  <span className="popover-item-desc">{EFFORT_LABELS[configuration.reasoningEffort || ""] || configuration.reasoningEffort}{configuration.serviceTier ? ` · ${getModelServiceTiers(model).find(tier => tier.id === configuration.serviceTier)?.name || configuration.serviceTier}` : ""}</span>
                </button>;
              })}
              {search && <div className="model-list-heading">匹配的模型</div>}
              {matchingModels.map(model => {
                const resolved = resolveChoice(model);
                return <button key={model.id} type="button" role="menuitem" disabled={unavailable || !resolved.available}
                  title={resolved.reason} className="popover-menu-item model-choice"
                  onClick={() => resolved.configuration && selectConfiguration(resolved.configuration)}>{formatModelName(model)}</button>;
              })}
              {!matchingRecent.length && !matchingModels.length && <div role="status">没有匹配的模型</div>}
            </>
          ) : view === "compact" ? (
            <>
              <button
                type="button"
                role="menuitem"
                className="model-compact-current"
                onClick={() => {
                  setView("models");
                  requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>(".model-choice")?.focus());
                }}
              >
                <span>{formatModelName(activeModel)}{activeEffort ? ` ${EFFORT_LABELS[activeEffort.reasoningEffort] || activeEffort.reasoningEffort}` : ""}</span>
                <ChevronRightIcon size={13} />
              </button>
              <div className="model-compact-controls">
                <label className="model-effort-slider-label">
                  <span className="sr-only">推理强度</span>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, supportedEfforts.length - 1)}
                    step={1}
                    value={activeEffortIndex}
                    disabled={unavailable || !!activeDisabledReason || supportedEfforts.length < 2}
                    aria-valuetext={activeEffort
                      ? `${EFFORT_LABELS[activeEffort.reasoningEffort] || activeEffort.reasoningEffort}，第 ${activeEffortIndex + 1} 项，共 ${supportedEfforts.length} 项。${activeEffort.description || ""}`
                      : "当前模型没有可用推理档位"}
                    style={{ "--slider-progress": progress } as React.CSSProperties}
                    onChange={(event) => {
                      const effort = supportedEfforts[Number(event.target.value)];
                      if (effort) {
                        if (onSelectConfiguration) onSelectConfiguration({ ...currentConfiguration, reasoningEffort: effort.reasoningEffort });
                        else onSelectReasoningEffort(effort.reasoningEffort);
                      }
                    }}
                  />
                </label>
              </div>
              <div className="model-tier-options" role="group" aria-label="生成速度">
                {tierOptions.map(tier => {
                  const resolved = resolveServiceTier(activeModel, tier.id, serviceTierAccess);
                  return <button key={tier.id || "standard"} type="button" role="menuitemradio"
                    aria-checked={(serviceTier || null) === tier.id} disabled={unavailable || !!activeDisabledReason || !resolved.available}
                    title={resolved.reason} className="popover-menu-item model-choice"
                    onClick={() => {
                      if (onSelectConfiguration) onSelectConfiguration({ ...currentConfiguration, serviceTier: resolved.serviceTier });
                      else if (onSelectServiceTier) onSelectServiceTier(resolved.serviceTier);
                      else if (!!tier.id !== fastMode) onToggleFastMode();
                    }}>
                    <span>{tier.id && <SparklesIcon size={13} />}{tier.name}</span>
                    {(serviceTier || null) === tier.id && <CheckIcon size={13} />}
                  </button>;
                })}
              </div>
            </>
          ) : (
            <>
              <div className="model-list-heading">选择模型</div>
              {defaultModel && (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={defaultModelSelected}
                  disabled={unavailable}
                  className={`popover-menu-item model-choice model-default-choice ${defaultModelSelected ? "selected" : ""}`}
                  onClick={() => {
                    if (onSelectConfiguration) {
                      const resolved = resolveChoice(defaultModel);
                      if (resolved.configuration) selectConfiguration(resolved.configuration, true);
                    } else { onSelectModel(defaultModel.id, true); closeMenu(); }
                  }}
                >
                  <div className="popover-item-body">
                    <span className="popover-item-title">默认</span>
                    <span className="popover-item-desc">推荐模型集</span>
                  </div>
                  {defaultModelSelected && <CheckIcon size={13} />}
                </button>
              )}
              <div className="model-choice-list">
                {visibleModels.map((model) => {
                  const selected = !defaultModelSelected && (model.id === selectedModelId || model.model === selectedModelId);
                  const resolved = resolveChoice(model);
                  return (
                    <button
                      key={model.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      disabled={unavailable || !resolved.available}
                      title={resolved.reason}
                      className={`popover-menu-item model-choice ${selected ? "selected" : ""}`}
                      onClick={() => {
                        if (onSelectConfiguration && resolved.configuration) selectConfiguration(resolved.configuration);
                        else { onSelectModel(model.id, false); closeMenu(); }
                      }}
                    >
                      <span className="popover-item-title">{formatModelName(model)}</span>
                      {selected && <CheckIcon size={13} />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

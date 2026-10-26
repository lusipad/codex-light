import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, SparklesIcon } from "./Icons";
import { getDefaultModel, getSupportedEfforts, modelSupportsFast } from "../modelCapabilities";
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
  return name.replace(/-([A-Za-z]+)$/, " $1");
}

export interface ModelSelectorProps {
  models: ModelInfo[];
  selectedModelId: string;
  defaultModelSelected: boolean;
  reasoningEffort: string;
  fastMode: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectModel: (modelId: string, useDefault: boolean) => void;
  onSelectReasoningEffort: (effort: string) => void;
  onToggleFastMode: () => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  models,
  selectedModelId,
  defaultModelSelected,
  reasoningEffort,
  fastMode,
  open,
  onOpenChange,
  onSelectModel,
  onSelectReasoningEffort,
  onToggleFastMode,
}) => {
  const [view, setView] = useState<"compact" | "models">("compact");
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<"first" | "last">("first");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const defaultModel = getDefaultModel(models);
  const visibleModels = useMemo(() => models.filter((model) => !model.hidden), [models]);
  const activeModel = models.find((model) => model.id === selectedModelId)
    || defaultModel
    || (selectedModelId ? { id: selectedModelId, displayName: selectedModelId } : undefined);
  const supportedEfforts = useMemo(() => getSupportedEfforts(activeModel), [activeModel]);
  const activeEffort = supportedEfforts.find((effort) => effort.reasoningEffort === reasoningEffort)
    || supportedEfforts.find((effort) => effort.reasoningEffort === activeModel?.defaultReasoningEffort)
    || supportedEfforts[0];
  const activeEffortIndex = Math.max(0, supportedEfforts.indexOf(activeEffort));
  const fastSupported = modelSupportsFast(activeModel);
  const progress = supportedEfforts.length > 1
    ? `${(activeEffortIndex / (supportedEfforts.length - 1)) * 100}%`
    : "0%";

  useEffect(() => {
    if (!open) {
      setView("compact");
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
  }, [open]);

  const closeMenu = () => {
    onOpenChange(false);
    requestAnimationFrame(() => {
      if (document.hasFocus()) triggerRef.current?.focus({ preventScroll: true });
    });
  };

  const handleMenuKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
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
        onClick={() => (open ? closeMenu() : onOpenChange(true))}
        title="选择模型、推理强度与生成速度"
      >
        <span>{formatModelName(activeModel)}{activeEffort ? ` ${EFFORT_LABELS[activeEffort.reasoningEffort] || activeEffort.reasoningEffort}` : ""}</span>
        <ChevronDownIcon size={11} />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className={`composer-popover-menu bottom-right model-selector-popover ${view === "models" ? "model-list-view" : ""}`}
          role="menu"
          aria-label={view === "models" ? "选择模型" : "模型与推理强度"}
        >
          {view === "compact" ? (
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
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={fastMode && fastSupported}
                  className={`model-fast-toggle ${fastMode && fastSupported ? "active" : ""}`}
                  disabled={!fastSupported}
                  aria-label={fastSupported ? (fastMode ? "启用标准模式" : "启用快速模式，用量更多") : "当前模型不支持快速模式"}
                  title={fastSupported ? (fastMode ? "启用标准模式" : "启用快速模式 · 用量更多") : "当前模型不支持快速模式"}
                  onClick={onToggleFastMode}
                >
                  <SparklesIcon size={15} />
                </button>
                <label className="model-effort-slider-label">
                  <span className="sr-only">推理强度</span>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, supportedEfforts.length - 1)}
                    step={1}
                    value={activeEffortIndex}
                    disabled={supportedEfforts.length < 2}
                    aria-valuetext={activeEffort
                      ? `${EFFORT_LABELS[activeEffort.reasoningEffort] || activeEffort.reasoningEffort}，第 ${activeEffortIndex + 1} 项，共 ${supportedEfforts.length} 项。${activeEffort.description || ""}`
                      : "当前模型没有可用推理档位"}
                    style={{ "--slider-progress": progress } as React.CSSProperties}
                    onChange={(event) => {
                      const effort = supportedEfforts[Number(event.target.value)];
                      if (effort) onSelectReasoningEffort(effort.reasoningEffort);
                    }}
                  />
                </label>
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
                  className={`popover-menu-item model-choice model-default-choice ${defaultModelSelected ? "selected" : ""}`}
                  onClick={() => {
                    onSelectModel(defaultModel.id, true);
                    closeMenu();
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
                  const selected = !defaultModelSelected && model.id === selectedModelId;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className={`popover-menu-item model-choice ${selected ? "selected" : ""}`}
                      onClick={() => {
                        onSelectModel(model.id, false);
                        closeMenu();
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

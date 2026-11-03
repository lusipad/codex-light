import type { ModelConfiguration, ModelInfo, ModelReasoningOption, ModelServiceTier } from "./types";
export type { ModelConfiguration } from "./types";

export interface ModelEligibilityContext {
  configuredModel?: string | null;
  additionalAvailableModels?: readonly string[];
  availableModels?: readonly string[];
  useHiddenModels?: boolean;
  authMethod?: string | null;
  hasConfiguredModelCatalog?: boolean;
  isCustomModelProvider?: boolean;
  apiKeyDaybreakSupported?: boolean;
  enabledReasoningEfforts?: readonly string[];
  includeUltraReasoningEffort?: boolean;
}

export interface ServiceTierAccess { fast: boolean; ultrafast: boolean }

export function getSupportedEfforts(model?: ModelInfo | null, context: ModelEligibilityContext = {}): ModelReasoningOption[] {
  if (!Array.isArray(model?.supportedReasoningEfforts)) return [];
  const seen = new Set<string>();
  return model.supportedReasoningEfforts.flatMap(entry => {
    const option = typeof entry === "string" ? { reasoningEffort: entry } : entry;
    const effort = option?.reasoningEffort;
    if (typeof effort !== "string" || !effort.trim() || seen.has(effort)
      || effort === "ultra" && context.includeUltraReasoningEffort !== true
      || context.authMethod === "copilot" && effort !== "medium"
      || context.enabledReasoningEfforts && !context.enabledReasoningEfforts.includes(effort)) return [];
    seen.add(effort);
    return [{ reasoningEffort: effort, description: option.description }];
  });
}

export function resolveReasoningEffort(model: ModelInfo | null | undefined, previous?: string | null, context: ModelEligibilityContext = {}): string | null {
  const efforts = getSupportedEfforts(model, context);
  return efforts.find(option => option.reasoningEffort === previous)?.reasoningEffort
    ?? efforts.find(option => option.reasoningEffort === model?.defaultReasoningEffort)?.reasoningEffort
    ?? efforts[0]?.reasoningEffort ?? null;
}

export function getModelEligibility(model?: ModelInfo | null, context: ModelEligibilityContext = {}): { available: boolean; reason?: string } {
  if (!model || !(model.model || model.id)) return { available: false, reason: "模型不在当前目录中" };
  const name = model.model || model.id;
  if (name === "codex-auto-review") return { available: false, reason: "此模型不用于普通聊天" };
  const cyber = model.availableAccessPrograms?.cyber;
  if (cyber?.length && !cyber.includes("standard") && context.apiKeyDaybreakSupported !== true
    && !context.additionalAvailableModels?.includes(name) && !context.availableModels?.includes(name)) {
    return { available: false, reason: "此模型的访问资格尚未核实" };
  }
  if (context.authMethod === "apikey" && !context.apiKeyDaybreakSupported && cyber?.length && !cyber.includes("standard")) {
    return { available: false, reason: "当前 API 密钥不支持此模型" };
  }
  if (context.additionalAvailableModels?.includes(name)) return { available: true };
  const configured = context.configuredModel === name || context.configuredModel === model.id;
  const custom = context.isCustomModelProvider || context.authMethod === "amazonBedrock";
  const available = !model.hidden && (!context.useHiddenModels || custom || context.hasConfiguredModelCatalog
    || context.availableModels?.includes(name))
    || model.hidden && (configured || context.useHiddenModels && !custom && context.availableModels?.includes(name));
  return available ? { available: true } : { available: false, reason: "此模型不可用。请选择其他模型以继续。" };
}

export function getPickerModels(models: ModelInfo[], context: ModelEligibilityContext = {}): ModelInfo[] {
  return models.filter(model => {
    // Explicitly configured hidden models may remain executable, without exposing them in the ordinary list.
    if (model.hidden && !context.additionalAvailableModels?.includes(model.model || model.id)
      && !(context.useHiddenModels && context.availableModels?.includes(model.model || model.id))) return false;
    return getModelEligibility(model, context).available;
  });
}

export function getDefaultModel(models: ModelInfo[], context: ModelEligibilityContext = {}): ModelInfo | undefined {
  const visible = getPickerModels(models, context);
  return visible.find(model => model.isDefault) || visible[0];
}

export function findModel(models: ModelInfo[], id: string): ModelInfo | undefined {
  return models.find(model => model.id === id || model.model === id);
}

export function modelRequestName(models: ModelInfo[], id: string): string | undefined {
  const model = findModel(models, id);
  return model ? model.model || model.id : undefined;
}

export function getModelServiceTiers(model?: ModelInfo | null): ModelServiceTier[] {
  const seen = new Set<string>();
  return (model?.serviceTiers ?? []).filter(tier => {
    if (!tier || typeof tier.id !== "string" || !tier.id.trim() || seen.has(tier.id)) return false;
    seen.add(tier.id);
    return true;
  });
}

export function getServiceTierKind(tier: ModelServiceTier): "fast" | "ultrafast" | null {
  const name = tier.name?.trim().toLowerCase();
  if (tier.id === "fast" || tier.id === "priority" || name === "fast" || name === "priority") return "fast";
  return tier.id === "ultrafast" || name === "ultrafast" ? "ultrafast" : null;
}

export function getFastServiceTier(model?: ModelInfo | null): ModelServiceTier | undefined {
  return getModelServiceTiers(model).find(tier => getServiceTierKind(tier) === "fast");
}

// This is a catalog capability only; submission must also resolve account access.
export function modelSupportsFast(model?: ModelInfo | null): boolean {
  return getFastServiceTier(model) !== undefined;
}

export function resolveServiceTier(model: ModelInfo | null | undefined, requested: string | null | undefined, access?: ServiceTierAccess | null): { available: boolean; serviceTier: string | null; reason?: string } {
  const value = requested === undefined ? model?.defaultServiceTier : requested;
  if (value == null || value === "default") return { available: true, serviceTier: null };
  const tier = value === "fast" ? getFastServiceTier(model) : getModelServiceTiers(model).find(tier => tier.id === value);
  if (!tier) return { available: false, serviceTier: null, reason: "此模型不支持所选速度层" };
  // Official nht checks the submitted id, treating unknown non-flex ids as fast access.
  const accessKind = tier.id === "ultrafast" ? "ultrafast" : "fast";
  if (tier.id !== "flex" && access?.[accessKind] !== true) {
    return { available: false, serviceTier: null, reason: "所选速度层的账户资格尚未核实或不可用" };
  }
  return { available: true, serviceTier: tier.id };
}

export function resolveModelSelection(models: ModelInfo[], requested: { model: string; reasoningEffort?: string | null; serviceTier?: string | null }, context: ModelEligibilityContext = {}, access?: ServiceTierAccess | null): { available: boolean; model?: ModelInfo; configuration?: ModelConfiguration; reason?: string } {
  const model = findModel(models, requested.model);
  const eligibility = getModelEligibility(model, context);
  if (!model || !eligibility.available) return { available: false, model, reason: eligibility.reason };
  const tier = resolveServiceTier(model, requested.serviceTier, access);
  if (!tier.available) return { available: false, model, reason: tier.reason };
  return { available: true, model, configuration: {
    model: model.model || model.id,
    reasoningEffort: resolveReasoningEffort(model, requested.reasoningEffort, context),
    serviceTier: tier.serviceTier,
  } };
}

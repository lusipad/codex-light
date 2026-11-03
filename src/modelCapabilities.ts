import { ModelInfo, ModelReasoningOption } from "./types";

export function getSupportedEfforts(model?: ModelInfo | null): ModelReasoningOption[] {
  if (!Array.isArray(model?.supportedReasoningEfforts)) return [];
  return model.supportedReasoningEfforts.flatMap((entry) => {
    if (typeof entry === "string") {
      return entry ? [{ reasoningEffort: entry }] : [];
    }
    if (entry && typeof entry.reasoningEffort === "string" && entry.reasoningEffort) {
      return [{
        reasoningEffort: entry.reasoningEffort,
        description: entry.description,
      }];
    }
    return [];
  });
}

export function getDefaultModel(models: ModelInfo[]): ModelInfo | undefined {
  const visible = getPickerModels(models);
  return visible.find((model) => model.isDefault) || visible[0];
}

export function getPickerModels(models: ModelInfo[]): ModelInfo[] {
  return models.filter(model => !model.hidden && (model.model || model.id) !== "codex-auto-review");
}

export function findModel(models: ModelInfo[], id: string): ModelInfo | undefined {
  return models.find(model => model.id === id || model.model === id);
}

export function modelRequestName(models: ModelInfo[], id: string): string | undefined {
  return findModel(models, id)?.model || id || undefined;
}

export function modelSupportsFast(model?: ModelInfo | null): boolean {
  if (!model) return false;
  if (model.additionalSpeedTiers?.includes("fast")) return true;
  return model.serviceTiers?.some((tier) => tier.id === "fast" || tier.id === "priority") || false;
}

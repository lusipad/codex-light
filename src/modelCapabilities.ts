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
  return models.find((model) => model.isDefault && !model.hidden)
    || models.find((model) => !model.hidden)
    || models[0];
}

export function modelSupportsFast(model?: ModelInfo | null): boolean {
  if (!model) return false;
  if (model.additionalSpeedTiers?.includes("fast")) return true;
  return model.serviceTiers?.some((tier) => tier.id === "fast" || tier.id === "priority") || false;
}

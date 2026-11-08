import { callCloudThread, readCloudSetupModels, type ServiceIdentity } from "./chatgptService";
import { resolveServiceTier } from "./modelCapabilities";

export async function resolveCloudSetupModel(identity: ServiceIdentity, signal: AbortSignal) {
  const selected: { model: string | null; effort: string | null; serviceTier: string | null } = {
    model: null, effort: null, serviceTier: null,
  };
  try {
    const requirements = await callCloudThread({ kind: "requirements" }, identity, signal) as {
      requirements: { featureRequirements?: { fast_mode?: boolean | null; ultrafast_mode?: boolean | null } } | null;
      supportsIndependentSpeedModes?: boolean | null;
    };
    const features = requirements.requirements?.featureRequirements;
    const fast = features?.fast_mode !== false;
    const ultrafast = (requirements.supportsIndependentSpeedModes === true || fast) && features?.ultrafast_mode !== false;
    const { config } = await callCloudThread({ kind: "setup_preferences" }, identity, signal) as {
      config: { model: string | null; model_reasoning_effort: string | null; service_tier: string | null };
    };
    selected.model = config.model;
    selected.effort = config.model_reasoning_effort;
    const configured = config.service_tier;
    if (configured !== null) {
      const allowed = configured === "flex" || (configured === "ultrafast" ? ultrafast : fast);
      selected.serviceTier = configured !== "default" && allowed ? configured : null;
    } else {
      const models = await readCloudSetupModels(identity, signal);
      const model = models.find(row => selected.model === null ? row.isDefault === true : row.id === selected.model || row.model === selected.model);
      selected.serviceTier = resolveServiceTier(model, undefined, { fast, ultrafast }).serviceTier;
    }
  } catch (cause) {
    signal.throwIfAborted();
    if ((cause as { code?: string } | null)?.code === "account_changed") throw cause;
  }
  signal.throwIfAborted();
  return selected;
}

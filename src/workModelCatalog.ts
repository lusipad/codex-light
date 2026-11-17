import { readChatgptService, type ServiceIdentity } from "./chatgptService";
import { isWorkEnterprisePlan } from "./workRunLocation";

export type WorkThinkingEffort = "standard" | "extended" | "min" | "max" | "ultra" | "xhigh" | "zero";
export interface WorkModelSelection { slug: string; thinkingEffort: WorkThinkingEffort | null; versionId?: string | null }
export interface WorkModelOption extends WorkModelSelection { lane?: string; isAvailable?: boolean; title?: string | null; [key: string]: unknown }
interface WorkModelConfig { isWorkModeModel?: boolean; thinkingEfforts?: WorkThinkingEffort[]; defaultThinkingEffort?: WorkThinkingEffort | null; [key: string]: unknown }
interface WorkVersion { id: string; slugs: string[]; options: WorkModelOption[]; modelSlugByLane: Record<string, string>; enabled?: false; [key: string]: unknown }
export interface WorkModelCatalog {
  defaultModelSlug: string; modelConfigBySlug: Record<string, WorkModelConfig>; options: WorkModelOption[];
  internalOptions: WorkModelOption[]; chatAlphaOptions: WorkModelOption[]; categories: { defaultModel: string | null; supportedModels: string[]; lane?: string }[]; versionOptions: WorkVersion[]; sliderSettings: { modelSlug: string; thinkingEffort: WorkThinkingEffort }[];
  defaultThinkingEffortByModelSlug: Record<string, WorkThinkingEffort>; disabledVersionSlugs: string[];
  workspaceModelPolicy?: { selection: { model: string | null; thinkingEffort: WorkThinkingEffort | null; speedTier?: "standard" | "fast" | "ultrafast" | null; [key: string]: unknown }; newThreadPrecedence: "prefer_policy" | "prefer_user" | null; [key: string]: unknown };
}
const thinking = ["standard", "extended", "min", "max", "ultra", "xhigh", "zero"] as const;
const reasoning: Record<WorkThinkingEffort, string> = { standard: "medium", extended: "high", min: "low", max: "max", ultra: "ultra", xhigh: "xhigh", zero: "none" };
const reasoningOrder = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"];
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const effort = (value: unknown): WorkThinkingEffort | null => thinking.includes(value as WorkThinkingEffort) ? value as WorkThinkingEffort : null;
const tags = (value: unknown): string[] | undefined => Array.isArray(value) && value.every(item => typeof item === "string") ? value as string[] : undefined;
const entries = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.flatMap(value => object(value) ? [object(value)!] : []) : [];
const strings = (value: unknown): string[] => Array.isArray(value) && value.every(value => value === null || typeof value === "string") ? value.flatMap(value => text(value) ?? []) : [];
const uniqueOptions = (options: WorkModelOption[]): WorkModelOption[] => options.filter((option, index) => options.findIndex(other => other.slug === option.slug && other.thinkingEffort === option.thinkingEffort) === index);
const allOptions = (catalog: WorkModelCatalog): WorkModelOption[] => [...catalog.options, ...catalog.chatAlphaOptions, ...catalog.internalOptions, ...catalog.versionOptions.flatMap(version => version.options)];
function findOption(catalog: WorkModelCatalog, selection: WorkModelSelection): WorkModelOption | undefined {
  const options = allOptions(catalog), selectedEffort = selection.thinkingEffort ?? catalog.defaultThinkingEffortByModelSlug[selection.slug] ?? null;
  return options.find(option => option.slug === selection.slug && option.thinkingEffort === selectedEffort)
    ?? (selection.thinkingEffort === null ? options.find(option => option.slug === selection.slug) : undefined);
}
const versionId = (catalog: WorkModelCatalog, slug: string): string | null => catalog.versionOptions.find(version => version.id === "latest" && version.slugs.includes(slug))?.id
  ?? catalog.versionOptions.find(version => version.slugs.includes(slug))?.id ?? null;

/** Fixed merged HTTP catalog, distinct from the execution host's model/list. */
export function parseWorkModelCatalog(value: unknown): WorkModelCatalog {
  const source = object(value) ?? {}, models = new Map<string, Record<string, unknown>>();
  for (const model of entries(source.models)) { const slug = text(model.slug); if (slug) models.set(slug, model); }
  const categories = entries(source.categories).filter(category => category.disabled_by_admin !== true);
  const modelOption = (slug: string): WorkModelOption => ({ ...models.get(slug), slug, thinkingEffort: null, title: text(models.get(slug)?.title) });
  const categoryOption = (category: Record<string, unknown>): WorkModelOption | null => {
    const slug = text(category.default_model) ?? strings(category.supported_models)[0];
    if (!slug) return null;
    const model = modelOption(slug);
    return { ...category, ...model,
      title: text(model.displayTitleOverride) ?? text(category.title) ?? text(category.human_category_short_name) ?? text(category.human_category_name) ?? model.title ?? null,
      description: text(category.short_explainer) ?? text(category.tagline) ?? text(model.description),
      lane: typeof category.model_lane === "string" ? category.model_lane : undefined };
  };
  const presets = (version: Record<string, unknown>): WorkModelOption[] => {
    const slugs = strings(version.slugs), raw = entries(version.intelligence_presets);
    const valid = raw.filter(preset => text(preset.model_slug) && (preset.service_tier_options == null || Array.isArray(preset.service_tier_options) && preset.service_tier_options.every(value => { const tier = object(value); return tier && typeof tier.service_tier === "string" && (tier.title === undefined || typeof tier.title === "string") && (tier.subtitle == null || typeof tier.subtitle === "string"); })));
    const values = valid.length ? valid : version.id === "o3" ? [{ lane: "thinking", model_slug: "o3", title: "Medium" }] : [];
    return values.flatMap(preset => {
      let slug = text(preset.model_slug); if (!slug) return [];
      if (preset.lane === "instant") slug = text(categories.find(category => category.model_lane === "auto" && slugs.includes(text(category.default_model) ?? ""))?.default_model) ?? slug;
      return [{ ...preset, slug, thinkingEffort: effort(preset.thinking_effort), lane: typeof preset.lane === "string" ? preset.lane : undefined,
        isAvailable: preset.preset_type == null ? undefined : preset.preset_type === "available", title: text(preset.title) }];
    });
  };
  const versions = entries(source.versions).filter(version => text(version.id) && version.disabled !== true);
  const versionOptions = versions.flatMap(version => {
    const slugs = strings(version.slugs); if (!slugs.length) return [];
    const ownCategories = categories.filter(category => slugs.includes(text(category.default_model) ?? ""));
    const options = presets(version), modelSlugByLane: Record<string, string> = {};
    for (const category of ownCategories) if (typeof category.model_lane === "string" && text(category.default_model)) modelSlugByLane[category.model_lane] = text(category.default_model)!;
    return [{ ...version, ...(version.enabled === false ? { enabled: false as const } : { enabled: undefined }), id: text(version.id)!, slugs, options: options.length ? options : ownCategories.flatMap(category => categoryOption(category) ?? []), modelSlugByLane }];
  });
  const firstPresets = versions.map(presets).find(options => options.length);
  const categoryOptions = [...categories].reverse().flatMap(category => categoryOption(category) ?? []);
  const options = uniqueOptions(firstPresets ?? (categoryOptions.length ? categoryOptions : [...models.keys()].map(modelOption)));
  const groups = entries(source.internal_groups).filter(group => group.group === undefined || typeof group.group === "string");
  const internalOptions = uniqueOptions(groups.flatMap(group => strings(group.model_ids)).flatMap(slug => {
    const model = models.get(slug); if (!model || tags(model.tags)?.includes("hidden")) return [];
    const rawEfforts = entries(model.thinking_efforts), efforts = Array.isArray(model.thinking_efforts) && rawEfforts.length === model.thinking_efforts.length
      && rawEfforts.every(entry => effort(entry.thinking_effort)) ? rawEfforts.map(entry => effort(entry.thinking_effort)!) : [];
    return model.is_work_mode_model === true && efforts.length ? efforts.map(thinkingEffort => ({ ...modelOption(slug), thinkingEffort })) : [modelOption(slug)];
  }));
  const modelConfigBySlug: Record<string, WorkModelConfig> = Object.create(null), defaults: Record<string, WorkThinkingEffort> = Object.create(null);
  for (const [slug, model] of models) {
    const efforts = entries(model.thinking_efforts).flatMap(entry => effort(entry.thinking_effort) ?? []), defaultEffort = effort(model.default_thinking_effort);
    modelConfigBySlug[slug] = { ...model, tags: tags(model.tags), isWorkModeModel: typeof model.is_work_mode_model === "boolean" ? model.is_work_mode_model : undefined,
      disabledByAdmin: entries(source.categories).some(category => category.disabled_by_admin === true && (text(category.default_model) ?? strings(category.supported_models)[0]) === slug) || undefined,
      thinkingEfforts: Array.isArray(model.thinking_efforts) && entries(model.thinking_efforts).length === model.thinking_efforts.length
        && efforts.length === model.thinking_efforts.length ? efforts : undefined, defaultThinkingEffort: defaultEffort };
    if (defaultEffort) defaults[slug] = defaultEffort;
  }
  const alphaSlugs = strings(groups.find(group => group.group === "alpha")?.model_ids);
  const disabledVersions = entries(source.versions).filter(version => version.disabled === true).flatMap(version => [...strings(version.slugs), ...entries(version.intelligence_presets).flatMap(preset => text(preset.model_slug) ?? [])]);
  const chatAlphaOptions = internalOptions.filter(option => alphaSlugs.includes(option.slug) && models.get(option.slug)?.is_work_mode_model !== true
    && !disabledVersions.includes(option.slug) && (categories.some(category => text(category.default_model) === option.slug || strings(category.supported_models).includes(option.slug))
      || !entries(source.categories).some(category => category.disabled_by_admin === true && (text(category.default_model) === option.slug || strings(category.supported_models).includes(option.slug)))));
  const policy = object(source.workspace_model_policy), policySelection = object(policy?.selection);
  const validPolicy = policySelection !== null;
  return { defaultModelSlug: text(source.default_model_slug) ?? options[0]?.slug ?? "auto", modelConfigBySlug, options, internalOptions, chatAlphaOptions, categories: [...categories].reverse().map(category => ({ defaultModel: text(category.default_model), supportedModels: strings(category.supported_models), lane: typeof category.model_lane === "string" ? category.model_lane : undefined })), versionOptions,
    sliderSettings: entries(source.slider_settings).flatMap(entry => { const modelSlug = text(entry.model_slug), thinkingEffort = effort(entry.thinking_effort); return modelSlug && thinkingEffort ? [{ modelSlug, thinkingEffort }] : []; }),
    defaultThinkingEffortByModelSlug: defaults, disabledVersionSlugs: disabledVersions,
    ...(validPolicy && policySelection ? { workspaceModelPolicy: { ...policy, selection: { ...policySelection, model: text(policySelection.model), thinkingEffort: effort(policySelection.thinking_effort),
        speedTier: policySelection.speed_tier == null || ["standard", "fast", "ultrafast"].includes(String(policySelection.speed_tier)) ? policySelection.speed_tier as "standard" | "fast" | "ultrafast" | null | undefined : undefined },
      newThreadPrecedence: policy?.new_thread_precedence === "prefer_policy" || policy?.new_thread_precedence === "prefer_user" ? policy.new_thread_precedence : null } } : {}) };
}

function policySelection(catalog: WorkModelCatalog): WorkModelSelection | null {
  const policy = catalog.workspaceModelPolicy; if (!policy) return null;
  const requested = policy.selection.model ?? catalog.defaultModelSlug;
  const version = catalog.versionOptions.find(version => version.modelSlugByLane.instant === requested);
  const slug = version?.options.find(option => option.lane === "instant")?.slug ?? requested;
  if (!findOption(catalog, { slug, thinkingEffort: null })) return null;
  const wanted = policy.selection.thinkingEffort;
  const thinkingEffort = wanted && (catalog.sliderSettings.some(setting => setting.modelSlug === slug && setting.thinkingEffort === wanted) || findOption(catalog, { slug, thinkingEffort: wanted })) ? wanted : null;
  return { slug, thinkingEffort, versionId: version?.id ?? versionId(catalog, slug) };
}
function instantSelectionCatalog(catalog: WorkModelCatalog, slug: string): WorkModelCatalog {
  const aliases = (value: string) => [value, ...value.split(":").slice(1).filter(Boolean)];
  const category = catalog.categories.find(category => [category.defaultModel, ...category.supportedModels].some(model => model !== null && aliases(model).some(alias => aliases(slug).includes(alias))));
  if (category?.lane !== "instant") return catalog;
  const versions = catalog.versionOptions.filter(version => version.slugs.includes(slug)), older = versions.filter(version => version.id !== "latest"), candidates = older.length ? older : versions;
  if (candidates.length !== 1 || candidates[0].options.some(option => option.slug === slug)) return catalog;
  const version = candidates[0], slugs = new Set(version.options.filter(option => option.lane === "instant").map(option => option.slug));
  if (slugs.size !== 1 || version.modelSlugByLane.instant != null && !slugs.has(version.modelSlugByLane.instant)
    && (version.modelSlugByLane.auto == null || !slugs.has(version.modelSlugByLane.auto))) return catalog;
  if (version.modelSlugByLane.instant != null) slugs.add(version.modelSlugByLane.instant);
  const project = (option: WorkModelOption) => option.lane === "instant" && slugs.has(option.slug) ? { ...option, slug } : option;
  return { ...catalog, options: catalog.options.map(project), versionOptions: catalog.versionOptions.map(version => version.slugs.includes(slug) ? { ...version, options: version.options.map(project) } : version),
    sliderSettings: catalog.sliderSettings.map(setting => slugs.has(setting.modelSlug) ? { ...setting, modelSlug: slug } : setting) };
}
function validSelection(catalog: WorkModelCatalog, selection: WorkModelSelection | null, plan: string | null): WorkModelSelection | null {
  if (!selection || !text(selection.slug)) return null;
  let selected = selection;
  if (isWorkEnterprisePlan(plan) && selected.thinkingEffort !== null) {
    const configEfforts = catalog.modelConfigBySlug[selected.slug]?.thinkingEfforts;
    const available = configEfforts ?? [...allOptions(catalog).filter(option => option.slug === selected.slug && option.isAvailable !== false && option.thinkingEffort !== null).map(option => option.thinkingEffort!),
      ...catalog.sliderSettings.filter(setting => setting.modelSlug === selected.slug).map(setting => setting.thinkingEffort)];
    if (configEfforts !== undefined || available.length) {
      const rank = (value: WorkThinkingEffort) => reasoningOrder.indexOf(reasoning[value]);
      const bounded = available.filter(value => rank(value) <= rank(selected.thinkingEffort!)).sort((a, b) => rank(b) - rank(a))[0];
      if (!bounded) return null;
      selected = { ...selected, thinkingEffort: bounded };
    }
  }
  const selectable = instantSelectionCatalog(catalog, selected.slug);
  return findOption(selectable, selected) || selectable.sliderSettings.some(setting => setting.modelSlug === selected.slug && setting.thinkingEffort === selected.thinkingEffort) ? selected : null;
}
const sol = (model: string) => /(?:^|[-_.])sol(?:$|[-_.])/iu.test(model);
function defaultThinkingEffort(catalog: WorkModelCatalog): WorkThinkingEffort | null {
  const slug = catalog.defaultModelSlug, initial = catalog.defaultThinkingEffortByModelSlug[slug] ?? null;
  const base = catalog.versionOptions.find(version => version.slugs.includes(slug) && version.options.length)?.options
    ?? catalog.versionOptions.find(version => version.slugs.some(sol))?.options ?? catalog.options;
  const settings = catalog.sliderSettings.length ? catalog.sliderSettings : base.map(option => ({ modelSlug: option.slug, thinkingEffort: option.thinkingEffort }));
  const options = uniqueOptions([...base, ...settings.flatMap(setting => findOption(catalog, { slug: setting.modelSlug, thinkingEffort: setting.thinkingEffort }) ?? [])]);
  const power = settings.flatMap((setting, index) => {
    const option = options.find(option => option.slug === setting.modelSlug && option.thinkingEffort === setting.thinkingEffort)
      ?? findOption(catalog, { slug: setting.modelSlug, thinkingEffort: setting.thinkingEffort });
    return option ? [{ slug: setting.modelSlug, thinkingEffort: setting.thinkingEffort, index,
      reasoning: setting.thinkingEffort ? reasoning[setting.thinkingEffort] : option.lane === "instant" || option.lane === "auto" ? "none" : "medium" }] : [];
  });
  const wanted = settings.some(setting => setting.modelSlug === slug && setting.thinkingEffort === null) ? null : initial;
  const direct = power.find(option => option.slug === slug && option.thinkingEffort === wanted)
    ?? [...power].reverse().find(option => option.slug === slug && option.reasoning !== "ultra");
  const fallback = direct ?? power.find(option => sol(option.slug) && option.thinkingEffort === wanted)
    ?? power.find(option => sol(option.slug) && option.reasoning === "medium") ?? power.find(option => sol(option.slug))
    ?? power.find(option => option.reasoning === "medium") ?? power[0];
  const chosen = fallback && (slug === fallback.slug || sol(slug) && sol(fallback.slug)) && settings[fallback.index]?.thinkingEffort === wanted ? fallback : direct;
  return chosen ? settings[chosen.index].thinkingEffort : initial;
}

/** Preferences must come from the real persisted read; null means confirmed absent. */
export function selectWorkHomeModel(catalog: WorkModelCatalog, input: {
  homeSelection: WorkModelSelection | null; lastSelection: WorkModelSelection | null; plan: string | null;
  temporarySelection?: WorkModelSelection | null;
}): { selection: WorkModelSelection; isWorkModel: boolean; hasExplicitSelection: boolean } {
  const persisted = validSelection(catalog, input.homeSelection ?? input.lastSelection, input.plan), policy = policySelection(catalog);
  const chosen = validSelection(catalog, input.temporarySelection ?? null, input.plan)
    ?? (catalog.workspaceModelPolicy?.newThreadPrecedence === "prefer_policy" ? policy ?? persisted : persisted ?? policy);
  const selection = chosen ? { ...chosen, versionId: chosen.versionId ?? versionId(catalog, chosen.slug) }
    : { slug: catalog.defaultModelSlug, thinkingEffort: defaultThinkingEffort(catalog), versionId: versionId(catalog, catalog.defaultModelSlug) };
  return { selection, isWorkModel: catalog.modelConfigBySlug[selection.slug]?.isWorkModeModel === true, hasExplicitSelection: chosen !== null };
}
export function adaptWorkModelSelection(selection: WorkModelSelection, hostModels: readonly { model?: string }[]): { model: string; reasoningEffort: string | null } {
  const matched = hostModels.find(model => model.model === selection.slug) ?? hostModels.find(model => `${model.model}-wm` === selection.slug);
  return { model: matched?.model ?? selection.slug, reasoningEffort: selection.thinkingEffort ? reasoning[selection.thinkingEffort] ?? selection.thinkingEffort : null };
}
export async function readWorkModelCatalog(identity: ServiceIdentity, signal: AbortSignal): Promise<WorkModelCatalog> {
  signal.throwIfAborted();
  const body = await readChatgptService("work_models", {}, identity, signal);
  signal.throwIfAborted();
  return parseWorkModelCatalog(body);
}

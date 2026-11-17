import type { ChatgptConversationHistory } from "./chatgptConversationHistory";
import type { WorkModelCatalog, WorkModelSelection } from "./workModelCatalog";
import { readWorkModelCatalog } from "./workModelCatalog";
import { readChatgptService, readWorkAccountInfo, readWorkHomeState, serviceIdentity, type ServiceIdentity } from "./chatgptService";
import { parseWorkHomePreferences } from "./workHomePreferences";

export interface ChatgptHistoryModelOptions {
  /** null represents an auth snapshot without a confirmed plan. */
  plan: string | null;
  /** Same-owner general last-selected model, never the home-only preference. */
  lastSelection?: WorkModelSelection | null;
  /** Actual settings.model_picker_prefers_auto_for_instant_preset, if read. */
  prefersAutoForInstantPreset?: boolean | null;
}
const aliases = (slug: string) => [slug, ...slug.split(":").slice(1).filter(value => value.length > 0)];

/** Ordinary non-temporary cold history: Ow2S.e0 -> mNEt.G. No home policy,
 * model picker mutation, HTTP, or execution-host model/list participates. */
export function projectChatgptHistoryModel(
  catalog: WorkModelCatalog | null | undefined,
  history: Pick<ChatgptConversationHistory, "defaultModelSlug" | "thinkingEffort">,
  options: ChatgptHistoryModelOptions,
): WorkModelSelection | null {
  if (!catalog) return null;
  const allOptions = [...catalog.options, ...catalog.chatAlphaOptions, ...catalog.internalOptions,
    ...catalog.versionOptions.flatMap(version => version.options)];
  // TFzY.$ passes null effort, so its un fallback can match by actual slug.
  const available = (slug: string) => catalog.modelConfigBySlug[slug] != null || allOptions.some(option => option.slug === slug);
  const category = (slug: string) => {
    const wanted = new Set(aliases(slug));
    return catalog.categories.find(item => [item.defaultModel, ...item.supportedModels]
      .some(value => value !== null && aliases(value).some(alias => wanted.has(alias))));
  };
  let slug = history.defaultModelSlug;
  if (slug === null || !available(slug)) {
    const candidate = slug ?? options.lastSelection?.slug;
    const preferAuto = options.prefersAutoForInstantPreset ?? (candidate == null || category(candidate)?.lane !== "instant");
    const paid = options.plan !== null && !["free", "go", "free_workspace"].includes(options.plan);
    const laneSlug = paid ? catalog.versionOptions[0]?.slugs.find(value => category(value)?.lane === (preferAuto ? "auto" : "instant")) : undefined;
    slug = laneSlug != null && catalog.modelConfigBySlug[laneSlug] != null ? laneSlug : catalog.defaultModelSlug;
  }
  // An empty decoded catalog's defensive "auto" is not a verified service model.
  if (!available(slug)) return null;
  return { slug, thinkingEffort: history.thinkingEffort ?? catalog.defaultThinkingEffortByModelSlug[slug] ?? null,
    versionId: catalog.versionOptions.find(version => version.id === "latest" && version.slugs.includes(slug))?.id
      ?? catalog.versionOptions.find(version => version.slugs.includes(slug))?.id ?? null };
}

export async function readChatgptHistoryModelContext(identity: ServiceIdentity,
  history: Pick<ChatgptConversationHistory, "defaultModelSlug" | "thinkingEffort">, signal: AbortSignal) {
  const expected = { ...identity }, capturedHistory = { defaultModelSlug: history.defaultModelSlug, thinkingEffort: history.thinkingEffort };
  const current = async () => {
    signal.throwIfAborted();
    const actual = await serviceIdentity(signal);
    signal.throwIfAborted();
    if (actual.accountId !== expected.accountId || actual.userId !== expected.userId || actual.generation !== expected.generation) {
      throw Object.assign(Error("读取聊天模型期间账号已变化。"), { code: "account_changed" });
    }
  };
  await current();
  const [catalog, account] = await Promise.all([readWorkModelCatalog(expected, signal), readWorkAccountInfo(expected, signal)]);
  await current();
  const [preferences, settings] = await Promise.allSettled([
    readWorkHomeState(expected, signal).then(value => parseWorkHomePreferences(value, expected)),
    readChatgptService("library_settings", {}, expected, signal),
  ]);
  await current();
  for (const result of [preferences, settings]) {
    if (result.status === "rejected" && result.reason !== null && typeof result.reason === "object"
      && (result.reason.code === "account_changed" || result.reason.name === "AbortError")) throw result.reason;
  }
  const warnings: string[] = [];
  let lastSelection: WorkModelSelection | undefined, prefersAutoForInstantPreset: boolean | undefined;
  if (preferences.status === "fulfilled") {
    const atom = preferences.value.lastModel;
    if (atom.status === "value" && atom.value !== null && typeof atom.value === "object" && !Array.isArray(atom.value)
      && typeof (atom.value as Record<string, unknown>).slug === "string") {
      // Only slug participates in the fallback lane preference.
      lastSelection = { slug: (atom.value as { slug: string }).slug, thinkingEffort: null };
    } else if (atom.status === "unbound" || atom.status === "invalid") warnings.push("上次模型偏好尚未确认。");
  } else warnings.push("读取上次模型偏好失败。");
  if (settings.status === "fulfilled") {
    const body = settings.value;
    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
      const values = (body as Record<string, unknown>).settings;
      if (values !== null && typeof values === "object" && !Array.isArray(values)) {
        const preference = (values as Record<string, unknown>).model_picker_prefers_auto_for_instant_preset;
        if (typeof preference === "boolean") prefersAutoForInstantPreset = preference;
        else if (preference != null) warnings.push("模型显示偏好格式尚未确认。");
      } else if (values != null) warnings.push("模型显示偏好格式尚未确认。");
    } else warnings.push("模型显示偏好格式尚未确认。");
  } else warnings.push("读取模型显示偏好失败。");
  return { catalog, plan: account.plan,
    selection: projectChatgptHistoryModel(catalog, capturedHistory, { plan: account.plan, lastSelection, prefersAutoForInstantPreset }), warnings };
}

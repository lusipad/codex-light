import { useCallback, useEffect, useRef, useState } from "react";
import { callAppServer, tauriInvoke, tauriListen } from "./bridge";
import { findModel, getDefaultModel, getFastServiceTier, getServiceTierKind, resolveModelSelection, resolveServiceTier, type ModelEligibilityContext, type ServiceTierAccess } from "./modelCapabilities";
import type { ModelConfiguration, ModelInfo } from "./types";

export interface ModelPreferences {
  config: Record<string, unknown>;
  requirements: { requirements?: { featureRequirements?: Record<string, boolean> | null } | null; supportsIndependentSpeedModes?: boolean } | null;
  revision: string;
  profile: string | null;
  defaults: { model: string | null; reasoningEffort: string | null; serviceTier: string | null };
  recents: ModelConfiguration[];
  warning?: string | null;
}

export function getServiceTierAccess(preferences: ModelPreferences | null, authMethod?: string | null): ServiceTierAccess | null {
  if (!preferences?.requirements || !["chatgpt", "personalAccessToken", "amazonBedrock"].includes(authMethod || "")) return null;
  const response = preferences.requirements;
  const features = response.requirements?.featureRequirements;
  const fast = features?.fast_mode !== false;
  return { fast, ultrafast: (response.supportsIndependentSpeedModes === true || fast) && features?.ultrafast_mode !== false };
}

// Only UI-originated turn/start calls enter this ledger. An item may arrive before the RPC response.
export class ModelTurnLedger {
  private turns = new Map<string, ModelConfiguration>();
  private pending = new Map<string, { configuration: ModelConfiguration; early: Map<string, string> }>();
  private completed = new Set<string>();
  constructor(private record: (configuration: ModelConfiguration) => Promise<void>) {}
  async track<T>(threadId: string, configuration: ModelConfiguration, send: () => Promise<T>): Promise<T> {
    if (this.pending.has(threadId)) throw new Error("该会话的发送结果尚未确认");
    const attempt = { configuration: { ...configuration }, early: new Map<string, string>() };
    this.pending.set(threadId, attempt);
    try {
      const response = await send();
      const result = response as { turn?: { id?: string }; turnId?: string };
      const turnId = result?.turn?.id || result?.turnId;
      if (turnId) {
        this.turns.set(`${threadId}:${turnId}`, attempt.configuration);
        // A local history write must not turn a confirmed send into a failed send.
        for (const [earlyTurn, itemId] of attempt.early) if (earlyTurn === turnId) await this.complete(threadId, turnId, itemId).catch(() => {});
      }
      return response;
    } finally {
      if (this.pending.get(threadId) === attempt) this.pending.delete(threadId);
    }
  }
  async complete(threadId: string, turnId: string, itemId: string): Promise<void> {
    const key = `${threadId}:${turnId}`;
    const configuration = this.turns.get(key);
    if (!configuration) {
      this.pending.get(threadId)?.early.set(turnId, itemId);
      return;
    }
    if (this.completed.has(key)) return;
    this.completed.add(key);
    try { await this.record(configuration); }
    catch (error) { this.completed.delete(key); throw error; }
  }
}

interface ScopeSelection { configuration: ModelConfiguration; useDefault: boolean; tierKnown?: boolean }
export interface ThreadHydrationToken { mutationRevision: number; requestRevision: number; accountIdentity?: string; accountRevision?: number }
export interface ModelThreadSettings { model?: string | null; effort?: string | null; serviceTier?: string | null }
interface Options { models: ModelInfo[]; connected: boolean; modelsLoading?: boolean; threadId?: string | null; cwd?: string | null; authMethod?: string | null; accountIdentity?: string }

export function useModelSelection(options: Options) {
  const { models, connected, modelsLoading = false, threadId, cwd, authMethod, accountIdentity = authMethod || "" } = options;
  const [storedPreferences, setPreferences] = useState<ModelPreferences | null>(null);
  const [preferencesEpoch, setPreferencesEpoch] = useState(-1);
  const [selections, setSelections] = useState<Record<string, ScopeSelection>>({});
  const [, updatePendingWrites] = useState(0);
  const [loadingPreferences, setLoadingPreferences] = useState(true);
  const [selectionError, setSelectionError] = useState("");
  const requestRevision = useRef(0);
  const mutationRevision = useRef(0);
  const pendingWrites = useRef(new Set<string>());
  const scopeMutationRevisions = useRef(new Map<string, number>());
  const hydrationRevisions = useRef(new Map<string, number>());
  const observedSettings = useRef(new Map<string, { revision: number; configuration: ModelConfiguration }>());
  const identityEpoch = useRef({ identity: accountIdentity, revision: 0 });
  if (identityEpoch.current.identity !== accountIdentity) {
    identityEpoch.current = { identity: accountIdentity, revision: identityEpoch.current.revision + 1 };
    pendingWrites.current.clear();
    observedSettings.current.clear();
    scopeMutationRevisions.current.clear();
    hydrationRevisions.current.clear();
  }
  const accountRevision = identityEpoch.current.revision;
  const preferences = preferencesEpoch === accountRevision ? storedPreferences : null;
  const scope = threadId ? `thread:${threadId}` : `draft:${cwd || ""}`;
  const current = useRef({ scope, connected, modelsLoading, preferences, models, authMethod, cwd, threadId, accountIdentity, accountRevision });
  current.current = { scope, connected, modelsLoading, preferences, models, authMethod, cwd, threadId, accountIdentity, accountRevision };

  const refreshPreferences = useCallback(async () => {
    const revision = ++requestRevision.current;
    const target = current.current;
    if (!target.connected) { setPreferences(null); setLoadingPreferences(false); return; }
    setLoadingPreferences(true);
    try {
      const result = await tauriInvoke<ModelPreferences>("model_preferences_read", { cwd: target.cwd || undefined });
      if (revision !== requestRevision.current || target.cwd !== current.current.cwd || target.accountRevision !== current.current.accountRevision || !current.current.connected) return;
      setPreferences(result);
      setPreferencesEpoch(target.accountRevision);
      setSelectionError(result.warning || "");
    } catch (error) {
      if (revision === requestRevision.current && target.accountRevision === current.current.accountRevision) { setPreferences(null); setSelectionError(String(error)); }
    } finally { if (revision === requestRevision.current) setLoadingPreferences(false); }
  }, []);
  useEffect(() => { void refreshPreferences(); return () => { requestRevision.current++; }; }, [connected, cwd, authMethod, accountIdentity]);
  useEffect(() => {
    let stopped = false;
    let unlisten: (() => void) | undefined;
    void tauriListen("model-preferences-changed", () => { void refreshPreferences(); }).then(stop => { if (stopped) stop(); else unlisten = stop; });
    return () => { stopped = true; unlisten?.(); };
  }, [connected, cwd, authMethod, accountIdentity]);
  useEffect(() => { setSelectionError(""); }, [scope]);
  useEffect(() => { if (!connected) setSelections({}); }, [connected]);
  useEffect(() => { setSelections({}); setSelectionError(""); }, [accountIdentity]);

  const eligibilityContext: ModelEligibilityContext = { configuredModel: !threadId && selections[scope]?.useDefault
    ? preferences?.defaults.model : selections[scope]?.configuration.model || preferences?.defaults.model, authMethod,
    isCustomModelProvider: typeof preferences?.config.model_provider === "string" && preferences.config.model_provider !== "openai",
    hasConfiguredModelCatalog: typeof preferences?.config.model_catalog_json === "string" };
  const serviceTierAccess = getServiceTierAccess(preferences, authMethod);
  const fallback = getDefaultModel(models, eligibilityContext);
  const defaultModelName = preferences?.defaults.model || fallback?.model || fallback?.id || "";
  const defaultModel = findModel(models, defaultModelName);
  const configuredTier = preferences?.config.service_tier === "default" ? null : preferences?.defaults.serviceTier ?? undefined;
  const defaultTier = resolveServiceTier(defaultModel, configuredTier, serviceTierAccess);
  const defaultConfiguration: ModelConfiguration = {
    model: defaultModelName,
    reasoningEffort: preferences?.defaults.reasoningEffort ?? null,
    // Keep a denied default id for validation instead of silently converting it to standard.
    serviceTier: defaultTier.available ? defaultTier.serviceTier : configuredTier ?? defaultModel?.defaultServiceTier ?? null,
  };
  const selected = selections[scope] || { configuration: defaultConfiguration, useDefault: !preferences?.defaults.model };
  const configuration = !threadId && selected.useDefault ? defaultConfiguration : selected.configuration;
  const resolved = resolveModelSelection(models, configuration, eligibilityContext, serviceTierAccess);
  const hydrated = !threadId || !!selections[scope];
  const selectionPending = loadingPreferences || preferencesEpoch !== accountRevision || pendingWrites.current.has(scope) || !hydrated;
  const selectionDisabledReason = !connected ? "尚未连接" : modelsLoading ? "正在读取模型目录" : selectionPending ? "正在读取或保存模型配置"
    : threadId && selected.tierKnown === false ? "尚未取得此会话的速度配置，请重新选择模型配置" : resolved.available ? "" : resolved.reason || "模型不可用";
  const latest = useRef({ configuration, eligibilityContext, serviceTierAccess, selectionDisabledReason, selected });
  latest.current = { configuration, eligibilityContext, serviceTierAccess, selectionDisabledReason, selected };

  const getConfiguration = useCallback((): ModelConfiguration => {
    if (pendingWrites.current.has(current.current.scope)) throw new Error("正在保存模型配置");
    if (!current.current.connected || current.current.modelsLoading) throw new Error("尚未连接或正在读取模型目录");
    if (latest.current.selectionDisabledReason) throw new Error(latest.current.selectionDisabledReason);
    const result = resolveModelSelection(current.current.models, latest.current.configuration, latest.current.eligibilityContext, latest.current.serviceTierAccess);
    if (!result.configuration) throw new Error(result.reason || "模型配置不可用");
    return result.configuration;
  }, []);
  const selectConfiguration = async (next: ModelConfiguration, useDefault = false, persistAsDefault = true) => {
    const target = current.current;
    if (!target.connected || !target.preferences || target.modelsLoading || loadingPreferences || pendingWrites.current.has(target.scope)) return;
    const desired = resolveModelSelection(target.models, next, latest.current.eligibilityContext, latest.current.serviceTierAccess);
    if (!desired.configuration) { setSelectionError(desired.reason || "模型配置不可用"); return; }
    const mutation = ++mutationRevision.current;
    const serverRevision = observedSettings.current.get(target.scope)?.revision || 0;
    scopeMutationRevisions.current.set(target.scope, mutation);
    pendingWrites.current.add(target.scope);
    updatePendingWrites(value => value + 1); setSelectionError("");
    try {
      if (target.threadId) {
        await callAppServer("thread/settings/update", { threadId: target.threadId, model: desired.configuration.model,
          effort: desired.configuration.reasoningEffort, serviceTier: desired.configuration.serviceTier });
      } else if (persistAsDefault) {
        if (!target.preferences) throw new Error("尚未读取默认配置版本");
        const saved = await tauriInvoke<ModelPreferences>("model_preferences_write_default", { cwd: target.cwd || undefined,
          expectedVersion: target.preferences.revision, configuration: useDefault ? { model: null, reasoningEffort: null, serviceTier: null } : desired.configuration });
        if (target.accountRevision !== current.current.accountRevision) return;
        if (target.cwd === current.current.cwd && target.authMethod === current.current.authMethod && current.current.connected) setPreferences(saved);
      }
      if (target.accountRevision !== current.current.accountRevision) return;
      const serverSettings = observedSettings.current.get(target.scope);
      const confirmed = serverSettings && serverSettings.revision > serverRevision ? serverSettings.configuration : desired.configuration!;
      setSelections(previous => ({ ...previous, [target.scope]: { configuration: confirmed, useDefault, tierKnown: true } }));
    } catch (error) { if (target.scope === current.current.scope && target.accountRevision === current.current.accountRevision) setSelectionError(String(error)); }
    finally { if (target.accountRevision === current.current.accountRevision) { pendingWrites.current.delete(target.scope); updatePendingWrites(value => value + 1); } }
  };
  const selectModel = (id: string, useDefault = false) => {
    const next = useDefault ? { model: fallback?.model || fallback?.id || "", reasoningEffort: null, serviceTier: null }
      : id ? { ...latest.current.configuration, model: id } : defaultConfiguration;
    if (!resolveServiceTier(findModel(current.current.models, next.model), next.serviceTier, latest.current.serviceTierAccess).available) next.serviceTier = null;
    return selectConfiguration(next, useDefault);
  };
  const selectEffort = (effort: string) => selectConfiguration({ ...latest.current.configuration, reasoningEffort: effort });
  const selectTier = (tier: string | null) => selectConfiguration({ ...latest.current.configuration, serviceTier: tier });
  const toggleFast = () => {
    const model = findModel(current.current.models, latest.current.configuration.model);
    const next = latest.current.configuration.serviceTier ? null : getFastServiceTier(model)?.id;
    if (next === undefined) { setSelectionError("此模型不支持快速模式"); return Promise.resolve(); }
    return selectTier(next);
  };
  const beginThreadHydration = useCallback((id: string): ThreadHydrationToken => {
    const key = `thread:${id}`;
    const revision = (hydrationRevisions.current.get(key) || 0) + 1;
    hydrationRevisions.current.set(key, revision);
    return { mutationRevision: scopeMutationRevisions.current.get(key) || 0, requestRevision: revision, accountIdentity: current.current.accountIdentity, accountRevision: current.current.accountRevision };
  }, []);
  const applyThreadSettings = useCallback((id: string, settings: ModelThreadSettings) => {
    const key = `thread:${id}`;
    const revision = ++mutationRevision.current;
    scopeMutationRevisions.current.set(key, revision);
    // The server may normalize a requested speed, and notifications can precede the RPC ACK.
    const known = observedSettings.current.get(key)?.configuration;
    const configuration: ModelConfiguration = {
      model: settings.model || known?.model || (current.current.threadId === id ? latest.current.configuration.model : ""),
      reasoningEffort: settings.effort === undefined ? known?.reasoningEffort ?? null : settings.effort,
      serviceTier: settings.serviceTier === undefined ? known?.serviceTier ?? null : settings.serviceTier === "default" ? null : settings.serviceTier,
    };
    observedSettings.current.set(key, { revision, configuration });
    setSelections(previous => ({ ...previous, [key]: { useDefault: false,
      tierKnown: settings.serviceTier !== undefined || previous[key]?.tierKnown === true, configuration } }));
  }, []);
  const hydrateThread = useCallback((id: string, response: { model?: string | null; reasoningEffort?: string | null; serviceTier?: string | null; thread?: { model?: string | null; reasoningEffort?: string | null; serviceTier?: string | null } }, token?: ThreadHydrationToken) => {
    const result = response.thread ? { ...response.thread, ...response, thread: undefined } : response;
    const key = `thread:${id}`;
    if (pendingWrites.current.has(key)) return;
    if (token && (token.accountRevision !== current.current.accountRevision || token.mutationRevision !== (scopeMutationRevisions.current.get(key) || 0)
      || token.requestRevision !== hydrationRevisions.current.get(key))) return;
    // Resume belongs to its thread even when the user has already navigated elsewhere.
    setSelections(previous => ({ ...previous, [key]: { useDefault: false,
      tierKnown: result.serviceTier !== undefined || previous[key]?.tierKnown === true, configuration: {
      model: result.model || previous[key]?.configuration.model || "", reasoningEffort: result.reasoningEffort ?? null,
      serviceTier: result.serviceTier === undefined ? previous[key]?.configuration.serviceTier ?? null : result.serviceTier === "default" ? null : result.serviceTier,
    } } }));
  }, []);
  const ledger = useRef<{ revision: number; value: ModelTurnLedger } | null>(null);
  if (!ledger.current || ledger.current.revision !== accountRevision) ledger.current = { revision: accountRevision, value: new ModelTurnLedger(async used => {
    if (accountRevision !== current.current.accountRevision) return;
    try {
      const result = await tauriInvoke<{ recents: ModelConfiguration[] }>("model_recent_record", { configuration: used });
      if (accountRevision !== current.current.accountRevision) return;
      setPreferences(previous => previous ? { ...previous, recents: result.recents } : previous);
    } catch (error) { if (accountRevision === current.current.accountRevision) setSelectionError(`保存最近模型失败：${String(error)}`); throw error; }
  }) };
  const trackTurn = useCallback(<T,>(id: string, used: ModelConfiguration, send: () => Promise<T>) => ledger.current!.value.track(id, used, send), []);
  const onUserMessageCompleted = useCallback(async (id: string, turnId: string, itemId: string) => {
    try { await ledger.current!.value.complete(id, turnId, itemId); }
    catch (error) { setSelectionError(`保存最近模型失败：${String(error)}`); }
  }, []);
  const selectedModel = findModel(models, configuration.model);
  const tier = selectedModel?.serviceTiers?.find(value => value.id === configuration.serviceTier);
  return { selectedModelId: selectedModel?.id || configuration.model, defaultModelSelected: selected.useDefault,
    reasoningEffort: resolved.configuration ? resolved.configuration.reasoningEffort || "" : configuration.reasoningEffort || "",
    serviceTier: configuration.serviceTier, fastMode: !!tier && getServiceTierKind(tier) === "fast",
    eligibilityContext, serviceTierAccess, recentModelConfigurations: preferences?.recents || [],
    selectionPending, selectionError, selectionDisabledReason, selectModel, selectEffort, selectTier, selectConfiguration,
    toggleFast, beginThreadHydration, hydrateThread, applyThreadSettings, getConfiguration, refreshPreferences,
    trackTurn, onUserMessageCompleted,
  };
}

import { useLayoutEffect, useState } from "react";
import { serviceIdentity, saveWorkHomeModel, saveWorkHomeModelVersion, type ServiceIdentity } from "./chatgptService";
import { parseWorkHomePreferences } from "./workHomePreferences";
import { readWorkHomeModelPreparation, readWorkHomeNativeModelPreparation, type WorkCaptureTarget, type WorkLocalSubmissionPreparation } from "./workHomePreparation";
import { adaptWorkModelSelection, selectWorkHomeModel, type WorkModelCatalog, type WorkModelSelection } from "./workModelCatalog";

type Ready = Extract<WorkLocalSubmissionPreparation, { status: "ready" }>;
export interface WorkHomeVersionPreference { versionId: string; selectionMode: "default" | "model" }
export interface WorkHomeNativeDraft { model: string; reasoningEffort: string | null }
export interface WorkHomeModelSelectionInput {
  entryKey: string; target: WorkCaptureTarget | null; appServerVersion: string | null; hasAttachments: boolean;
  confirmNativeSelection?: (selection: WorkModelSelection, prepared: Ready, signal: AbortSignal) => Promise<boolean>;
  onApplied?: (selection: WorkModelSelection, mode: "work" | "chat", nativeDraft: WorkHomeNativeDraft | null) => void;
}
export interface WorkHomeModelSelectionState {
  catalog: WorkModelCatalog | null; selection: WorkModelSelection | null; versionPreference: WorkHomeVersionPreference | null;
  loading: boolean; pending: boolean; error: string; isWorkModel: boolean | null;
  nativeDraft: WorkHomeNativeDraft | null; chatDraft: WorkModelSelection | null;
  approvalState: "not-evaluated" | "confirmed"; remoteSync: "not-connected";
}
const empty = (): WorkHomeModelSelectionState => ({ catalog: null, selection: null, versionPreference: null, loading: false,
  pending: false, error: "", isWorkModel: null, nativeDraft: null, chatDraft: null, approvalState: "not-evaluated", remoteSync: "not-connected" });
const sameIdentity = (a: ServiceIdentity, b: ServiceIdentity) => a.accountId === b.accountId && a.userId === b.userId && a.generation === b.generation;
const selectionKey = (value: WorkModelSelection | null) => JSON.stringify(value && [value.slug, value.thinkingEffort, value.versionId ?? null]);
const version = (raw: unknown): WorkHomeVersionPreference | null => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  return typeof value.versionId === "string" && (value.selectionMode === "default" || value.selectionMode === "model")
    ? { versionId: value.versionId, selectionMode: value.selectionMode } : null;
};

/** The controller owns actual local draft selections. It never writes normal
 * config defaults, changes permissions, or claims background remote sync. */
export function createWorkHomeModelSelectionController() {
  let input: WorkHomeModelSelectionInput | null = null, key = "", epoch = 0, request = 0;
  let state = empty(), abort = new AbortController(), busy = false;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<WorkHomeModelSelectionState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const update = (next: WorkHomeModelSelectionInput) => {
    const nextKey = JSON.stringify([next.entryKey, next.target?.identity, next.target?.location,
      next.target?.selectedWorkProject, next.target?.selectedChatGptProjectId, next.target?.orchestration.accountInfo, next.appServerVersion]);
    input = next;
    if (key === nextKey && !abort.signal.aborted) return;
    key = nextKey; epoch++; request++; abort.abort(); abort = new AbortController(); busy = false;
    state = empty(); for (const listener of listeners) listener();
  };
  const alive = (generation: number) => generation === epoch && input !== null && !abort.signal.aborted;
  const fence = async (generation: number, identity: ServiceIdentity, signal: AbortSignal) => {
    signal.throwIfAborted(); const current = await serviceIdentity(signal); signal.throwIfAborted();
    if (!alive(generation) || !sameIdentity(identity, current)) throw Error("首页或账号身份已变化。");
  };
  const refresh = async () => {
    if (!input?.target || busy) return;
    const owner = input, target = input.target, generation = epoch, id = ++request, signal = abort.signal;
    publish({ loading: true, error: "" });
    try {
      const prepared = await readWorkHomeModelPreparation(target, { appServerVersion: owner.appServerVersion }, signal);
      await fence(generation, target.identity, signal);
      if (id !== request) return;
      if (prepared.status !== "ready") throw Error(`尚未取得首页模型输入：${prepared.missingInputs.join("、")}`);
      const atom = prepared.preferences.pickerVersion;
      if (atom?.status === "unbound" || atom?.status === "invalid") throw Error("模型版本偏好尚未绑定或无效。");
      publish({ catalog: prepared.catalog, selection: prepared.selection, isWorkModel: prepared.isWorkModel,
        versionPreference: atom?.status === "value" ? version(atom.value) : null,
        ...(selectionKey(state.selection) === selectionKey(prepared.selection) ? {} : { nativeDraft: null, chatDraft: null, approvalState: "not-evaluated" }) });
    } catch (error) { if (alive(generation) && id === request) publish({ error: String(error) }); }
    finally { if (alive(generation) && id === request) publish({ loading: false }); }
  };
  const commit = async (desired: WorkModelSelection): Promise<boolean> => {
    if (!input?.target || busy || state.loading || !state.selection || !state.catalog) return false;
    const owner = input, target = input.target, generation = epoch, signal = abort.signal, base = selectionKey(state.selection);
    busy = true; publish({ pending: true, error: "" });
    try {
      const prepared = await readWorkHomeModelPreparation(target, { appServerVersion: owner.appServerVersion }, signal);
      await fence(generation, target.identity, signal);
      if (prepared.status !== "ready" || selectionKey(prepared.selection) !== base || selectionKey(state.selection) !== base) throw Error("首页模型输入已变化，请重新选择。");
      const selected = selectWorkHomeModel(prepared.catalog, { homeSelection: null, lastSelection: null,
        temporarySelection: desired, plan: target.orchestration.accountInfo.plan });
      if (!selected.hasExplicitSelection || selected.selection.slug !== desired.slug || selected.selection.thinkingEffort !== desired.thinkingEffort) throw Error("此模型或推理档当前不可用。");
      const crossMode = prepared.isWorkModel !== selected.isWorkModel;
      if (crossMode && input?.hasAttachments) throw Error("请先发送或移除附件，再切换模型模式。");
      let nativeDraft: WorkHomeNativeDraft | null = null;
      const verifyNative = (current: WorkLocalSubmissionPreparation): Ready => {
        if (current.status !== "ready" || selectionKey(current.selection) !== base) throw Error("首页模型输入已变化，请重新选择。");
        const valid = selectWorkHomeModel(current.catalog, { homeSelection: null, lastSelection: null,
          temporarySelection: desired, plan: target.orchestration.accountInfo.plan });
        if (!valid.hasExplicitSelection || !valid.isWorkModel || valid.selection.slug !== desired.slug || valid.selection.thinkingEffort !== desired.thinkingEffort) throw Error("此 Work 模型或推理档当前不可用。");
        const mapped = adaptWorkModelSelection(desired, current.hostModels), host = current.hostModels.find(model => model.model === mapped.model);
        const efforts = host?.supportedReasoningEfforts?.map(value => typeof value === "string" ? value : value.reasoningEffort) ?? [];
        if (current.modelCatalogFilterMissingInputs.length || !host || mapped.reasoningEffort !== null && !efforts.includes(mapped.reasoningEffort)) throw Error("此模型或推理档尚不适用于当前 Work 主机。");
        nativeDraft = mapped; return current;
      };
      if (selected.isWorkModel) {
        const native = verifyNative(await readWorkHomeNativeModelPreparation(target, { appServerVersion: owner.appServerVersion }, signal));
        await fence(generation, target.identity, signal);
        if (!owner.confirmNativeSelection) throw Error("Work 模型权限确认尚未接入。");
        if (!await owner.confirmNativeSelection(desired, native, signal)) return false;
        await fence(generation, target.identity, signal);
        // Confirmation can await a dialog. Re-read actual target/preferences,
        // catalog and host data instead of treating the old snapshot as live.
        const current = verifyNative(await readWorkHomeNativeModelPreparation(target, { appServerVersion: owner.appServerVersion }, signal));
        const confirmedMapping = adaptWorkModelSelection(desired, native.hostModels), currentMapping = adaptWorkModelSelection(desired, current.hostModels);
        if (confirmedMapping.model !== currentMapping.model || confirmedMapping.reasoningEffort !== currentMapping.reasoningEffort) throw Error("确认期间 Work 主机模型映射已变化，请重新选择。");
        await fence(generation, target.identity, signal);
      }
      if (selectionKey(state.selection) !== base || crossMode && input?.hasAttachments) throw Error("首页模型或附件已变化，请重新选择。");
      const saved = parseWorkHomePreferences(await saveWorkHomeModel(target.identity, desired, signal), target.identity);
      await fence(generation, target.identity, signal);
      if (selectionKey(state.selection) !== base || crossMode && input?.hasAttachments) throw Error("首页模型或附件已变化，请重新读取。");
      if (saved.homeModel.status !== "value" || selectionKey(saved.homeModel.value as WorkModelSelection) !== selectionKey(desired)) throw Error("首页模型保存后的真实读回不一致。");
      publish({ selection: { ...desired }, isWorkModel: selected.isWorkModel, nativeDraft,
        chatDraft: selected.isWorkModel ? null : { ...desired }, approvalState: selected.isWorkModel ? "confirmed" : "not-evaluated" });
      owner.onApplied?.(desired, selected.isWorkModel ? "work" : "chat", nativeDraft);
      return true;
    } catch (error) { if (alive(generation)) publish({ error: String(error) }); return false; }
    finally { if (alive(generation)) { busy = false; publish({ pending: false }); } }
  };
  const saveVersion = async (value: WorkHomeVersionPreference): Promise<boolean> => {
    if (!input?.target || busy || !version(value)) return false;
    const owner = input, target = input.target, generation = epoch, signal = abort.signal;
    busy = true; publish({ pending: true, error: "" });
    try {
      await fence(generation, target.identity, signal);
      const saved = parseWorkHomePreferences(await saveWorkHomeModelVersion(target.identity, value, signal), target.identity);
      await fence(generation, target.identity, signal);
      const actual = saved.pickerVersion.status === "value" ? version(saved.pickerVersion.value) : null;
      if (actual?.versionId !== value.versionId || actual.selectionMode !== value.selectionMode) throw Error("模型版本保存后的真实读回不一致。");
      publish({ versionPreference: { ...value } }); return true;
    } catch (error) { if (alive(generation)) publish({ error: String(error) }); return false; }
    finally { if (alive(generation)) { busy = false; publish({ pending: false }); } }
  };
  return { update, refresh, commit, saveVersion, read: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { input = null; key = ""; epoch++; request++; abort.abort(); busy = false; state = empty(); } };
}

export function useWorkHomeModelSelection(input: WorkHomeModelSelectionInput) {
  const [controller] = useState(createWorkHomeModelSelectionController);
  const [snapshot, setSnapshot] = useState(controller.read);
  useLayoutEffect(() => controller.subscribe(() => setSnapshot(controller.read())), [controller]);
  useLayoutEffect(() => { controller.update(input); }, [controller, input.entryKey, input.target, input.appServerVersion,
    input.hasAttachments, input.onApplied, input.confirmNativeSelection]);
  useLayoutEffect(() => { void controller.refresh(); return () => controller.dispose(); },
    [controller, input.entryKey, input.target, input.appServerVersion]);
  return { ...snapshot, commit: controller.commit, saveVersion: controller.saveVersion, refresh: controller.refresh };
}

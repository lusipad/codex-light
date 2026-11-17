import { readWorkHomeState, type ServiceIdentity } from "./chatgptService";

// Fixed 26.1111 scalar atom keys (HP01–04). Identity belongs to the host owner
// view, not an invented account prefix on the model keys. This codec never
// adopts legacy state, persists defaults or decides model/project eligibility.
export type WorkHomeAtom = { status: "missing" | "unbound" } | { status: "value" | "invalid"; value: unknown };
type SelectedPlacement = "owner-value" | "legacy-root" | "legacy-atom" | "missing";
type LocalPlacement = "root" | "legacy-atom" | "missing";
export interface WorkHomePreferencesSnapshot {
  identity: ServiceIdentity;
  owner: "bound";
  runLocation: WorkHomeAtom;
  mode: WorkHomeAtom;
  homeModel: WorkHomeAtom;
  lastModel: WorkHomeAtom;
  defaultModeRequestUserInput: WorkHomeAtom;
  pickerVersion: WorkHomeAtom;
  /** Presence of the old root setting only; omitted means not established. */
  legacyDetail?: "missing" | "unbound";
  selectedProject: WorkHomeAtom & { placement: SelectedPlacement; binding: "confirmed" | "legacy-unbound" };
  localProjects: WorkHomeAtom & { placement: LocalPlacement };
}
const keys = {
  runLocation: "work-run-location-v1", mode: "home-composer-mode-v1",
  homeModel: "chatgpt-last-selected-home-model-v1", lastModel: "chatgpt-last-selected-model-v1",
  defaultModeRequestUserInput: "default-mode-request-user-input-enabled",
  pickerVersion: "chatgpt-merged-model-picker-version-v1",
} as const;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = () => Error("Work 首页偏好响应无效或身份已变化。");
const modelValue = (value: unknown) => value === null || record(value) && typeof value.slug === "string" && value.slug.length > 0
  && (value.thinkingEffort === undefined || value.thinkingEffort === null || typeof value.thinkingEffort === "string")
  && (value.versionId === undefined || value.versionId === null || typeof value.versionId === "string");

export function parseWorkHomePreferences(raw: unknown, identity: ServiceIdentity): WorkHomePreferencesSnapshot {
  if (!record(raw) || !record(raw.identity) || raw.identity.userId !== identity.userId || raw.identity.accountId !== identity.accountId
    || raw.identity.generation !== identity.generation || !identity.userId || !identity.accountId
    || !Number.isSafeInteger(identity.generation) || identity.generation < 0 || !record(raw.preferences)) throw invalid();
  const preferences = raw.preferences, atoms = preferences.atoms, unbound = preferences.unboundAtoms;
  if (preferences.legacyDetail !== undefined && preferences.legacyDetail !== "missing" && preferences.legacyDetail !== "unbound") throw invalid();
  if (preferences.owner !== "bound" || !record(atoms) || !Array.isArray(unbound)
    || unbound.some(key => typeof key !== "string" || !Object.values(keys).includes(key as typeof keys[keyof typeof keys]))) throw invalid();
  const atom = (key: string, valid: (value: unknown) => boolean): WorkHomeAtom => {
    if (unbound.includes(key)) return { status: "unbound" };
    if (!Object.hasOwn(atoms, key)) return { status: "missing" };
    const value = atoms[key];
    return { status: valid(value) ? "value" : "invalid", value };
  };
  const selected = preferences.selectedProject, local = preferences.localProjects;
  if (!record(selected) || !["owner-value", "legacy-root", "legacy-atom", "missing"].includes(String(selected.placement))
    || !["confirmed", "legacy-unbound"].includes(String(selected.binding))
    || !record(local) || !["root", "legacy-atom", "missing"].includes(String(local.placement))) throw invalid();
  const selectedAtom: WorkHomeAtom = selected.binding === "legacy-unbound" ? { status: "unbound" }
    : selected.placement === "missing" ? { status: "missing" }
      : { status: selected.value === null || record(selected.value) ? "value" : "invalid", value: selected.value };
  const localAtom: WorkHomeAtom = local.placement === "missing" ? { status: "missing" }
    : { status: local.value === null || record(local.value) ? "value" : "invalid", value: local.value };
  return {
    identity: { ...identity }, owner: "bound",
    ...(preferences.legacyDetail === undefined ? {} : { legacyDetail: preferences.legacyDetail }),
    runLocation: atom(keys.runLocation, value => value === null || value === "local" || value === "cloud"),
    mode: atom(keys.mode, value => value === null || value === "chat" || value === "work"),
    homeModel: atom(keys.homeModel, modelValue), lastModel: atom(keys.lastModel, modelValue),
    defaultModeRequestUserInput: atom(keys.defaultModeRequestUserInput, value => value === null || typeof value === "boolean"),
    pickerVersion: atom(keys.pickerVersion, value => value === null || record(value) && typeof value.versionId === "string"
      && ["default", "model"].includes(String(value.selectionMode))),
    selectedProject: { ...selectedAtom, placement: selected.placement as SelectedPlacement, binding: selected.binding as "confirmed" | "legacy-unbound" },
    localProjects: { ...localAtom, placement: local.placement as LocalPlacement },
  };
}

/** Only the restricted authenticated host view can establish owner binding.
 * No fallback to desktop_state_get or success-shaped empty data on failure. */
export async function readWorkHomePreferences(identity: ServiceIdentity, signal: AbortSignal): Promise<WorkHomePreferencesSnapshot> {
  signal.throwIfAborted();
  const expected = { ...identity };
  const response = await readWorkHomeState(expected, signal);
  signal.throwIfAborted();
  return parseWorkHomePreferences(response, expected);
}

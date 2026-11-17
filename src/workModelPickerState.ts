import type { WorkModelCatalog, WorkModelOption, WorkModelSelection, WorkThinkingEffort } from "./workModelCatalog";

type Version = WorkModelCatalog["versionOptions"][number];
interface Setting { modelSlug: string; thinkingEffort: WorkThinkingEffort | null }
interface Picker { options: WorkModelOption[]; settings: Setting[]; version?: Version; isDefault?: boolean }
export interface WorkPickerPowerOption {
  id: string; label: string; selection: WorkModelSelection; disabled: boolean;
  available: boolean; adminDisabled: boolean; reasoningEffort: string;
}
export interface WorkPickerRow {
  id: string; kind: "version" | "default" | "model"; versionId: string | null;
  label: string; description?: string; group?: string; selection: WorkModelSelection | null;
  selected: boolean; disabled: boolean; available?: boolean; adminDisabled?: boolean;
}
export interface WorkModelPickerState {
  label: string; powerOptions: WorkPickerPowerOption[]; selectedPowerId: string | null;
  rows: WorkPickerRow[]; defaultSelection: WorkModelSelection | null;
  activeVersionId: string | null; selectionMode: "default" | "model";
}
export interface WorkPickerVersionPreference { versionId: string | null; selectionMode: "default" | "model" }
const reasoning: Record<WorkThinkingEffort, string> = { standard: "medium", extended: "high", min: "low", max: "max", ultra: "ultra", xhigh: "xhigh", zero: "none" };
const text = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: WorkModelSelection) => `${value.slug}:${value.thinkingEffort ?? ""}`;
const equal = (a: WorkModelSelection, b: WorkModelSelection) => a.slug === b.slug && (a.thinkingEffort ?? null) === b.thinkingEffort;
const sol = (slug: string) => /(?:^|[-_.])sol(?:$|[-_.])/iu.test(slug);
const unique = <T>(values: T[], key: (value: T) => string): T[] => values.filter((value, index) => values.findIndex(other => key(value) === key(other)) === index);
const versionId = (catalog: WorkModelCatalog, slug: string): string | null => catalog.versionOptions.find(version => version.id === "latest" && version.slugs.includes(slug))?.id
  ?? catalog.versionOptions.find(version => version.slugs.includes(slug))?.id ?? null;

function optionMetadata(catalog: WorkModelCatalog, option: WorkModelOption, internal = false): WorkModelOption {
  const config = catalog.modelConfigBySlug[option.slug], rawEfforts = config?.thinking_efforts;
  const raw = internal && option.thinkingEffort !== null && Array.isArray(rawEfforts)
    ? rawEfforts.find(value => record(value) && value.thinking_effort === option.thinkingEffort) : undefined;
  const effortLabel = record(raw) ? text(raw.short_label) ?? text(raw.full_label) ?? option.thinkingEffort : undefined;
  const modelTitle = text(option.modelTitle) ?? text(config?.title);
  return { ...option, ...(effortLabel ? { title: effortLabel, modelTitle, selectedLabel: modelTitle ? `${modelTitle} ${effortLabel}` : undefined } : {}),
    selectedLabel: text(option.selectedLabel) ?? text(option.selected_display_title) ?? (effortLabel && modelTitle ? `${modelTitle} ${effortLabel}` : undefined),
    selectedDisplayVersion: text(option.selectedDisplayVersion) ?? text(option.selected_display_version),
    versionLabel: text(option.versionLabel) ?? text(option.subtitle), modelTitle };
}
function allOptions(catalog: WorkModelCatalog): WorkModelOption[] {
  return [...catalog.options, ...catalog.chatAlphaOptions, ...catalog.internalOptions, ...catalog.versionOptions.flatMap(version => version.options)];
}
function findOption(catalog: WorkModelCatalog, selection: WorkModelSelection): WorkModelOption | undefined {
  const options = allOptions(catalog), effort = selection.thinkingEffort ?? catalog.defaultThinkingEffortByModelSlug[selection.slug] ?? null;
  const found = options.find(option => option.slug === selection.slug && option.thinkingEffort === effort)
    ?? (selection.thinkingEffort === null ? options.find(option => option.slug === selection.slug) : undefined);
  return found && optionMetadata(catalog, found, catalog.internalOptions.includes(found));
}
function makePicker(catalog: WorkModelCatalog, options: WorkModelOption[], version?: Version): Picker {
  const settings = unique<Setting>([...options.map(option => ({ modelSlug: option.slug, thinkingEffort: option.thinkingEffort ?? null })),
    ...catalog.sliderSettings.filter(setting => options.some(option => option.slug === setting.modelSlug))], value => `${value.modelSlug}:${value.thinkingEffort ?? ""}`);
  const extra = settings.flatMap(setting => options.find(option => option.slug === setting.modelSlug && option.thinkingEffort === setting.thinkingEffort)
    ?? findOption(catalog, { slug: setting.modelSlug, thinkingEffort: setting.thinkingEffort }) ?? []);
  return { options: unique([...options, ...extra].map(option => optionMetadata(catalog, option, catalog.internalOptions.includes(option))), id), settings, version };
}
function currentVersion(catalog: WorkModelCatalog, selection: WorkModelSelection, preferred: string | null): Version | undefined {
  const explicit = catalog.versionOptions.find(version => version.id === preferred && version.slugs.includes(selection.slug));
  if (explicit && (explicit.id === "latest" ? makePicker(catalog, explicit.options).options : explicit.options).some(option => equal(option, selection))) return explicit;
  const latest = catalog.versionOptions.find(version => version.id === "latest");
  const ordered = latest ? [latest, ...catalog.versionOptions.filter(version => version !== latest)] : catalog.versionOptions;
  return ordered.find(version => version.slugs.includes(selection.slug) && version.options.some(option => equal(option, selection)))
    ?? ordered.find(version => version.slugs.includes(selection.slug));
}
function modelLabel(option: WorkModelOption, fallback: string): string {
  const title = option.selectedLabel ?? option.modelTitle ?? option.title ?? fallback;
  let label = text(option.selectedDisplayVersion) ?? String(title);
  if (option.selectedDisplayVersion == null && title === option.title) label = text(option.modelTitle) ?? String(title);
  else if (option.selectedDisplayVersion == null && String(title).endsWith(` ${option.title}`)) label = String(title).slice(0, -` ${option.title}`.length);
  return label;
}
function powers(catalog: WorkModelCatalog, picker: Picker): (WorkPickerPowerOption & { index: number })[] {
  return picker.settings.flatMap((setting, index) => {
    const option = picker.options.find(option => option.slug === setting.modelSlug && option.thinkingEffort === setting.thinkingEffort)
      ?? findOption(catalog, { slug: setting.modelSlug, thinkingEffort: setting.thinkingEffort });
    if (!option) return [];
    const label = text(option.selectedLabel) ?? text(option.title) ?? modelLabel(option, "选择 ChatGPT 模型");
    return [{ id: `${setting.modelSlug}:${setting.thinkingEffort ?? ""}`, label,
      selection: { slug: setting.modelSlug, thinkingEffort: setting.thinkingEffort,
        versionId: picker.version?.slugs.includes(setting.modelSlug) ? picker.version.id : versionId(catalog, setting.modelSlug) },
      disabled: false, available: option.isAvailable !== false, adminDisabled: catalog.modelConfigBySlug[setting.modelSlug]?.disabledByAdmin === true,
      reasoningEffort: setting.thinkingEffort ? reasoning[setting.thinkingEffort] : option.lane === "instant" || option.lane === "auto" ? "none" : "medium", index }];
  });
}
function defaultPower(catalog: WorkModelCatalog, picker: Picker, options: ReturnType<typeof powers>) {
  const effort = picker.settings.some(setting => setting.modelSlug === catalog.defaultModelSlug && setting.thinkingEffort === null) ? null
    : catalog.defaultThinkingEffortByModelSlug[catalog.defaultModelSlug] ?? null;
  const wanted = `${catalog.defaultModelSlug}:${effort ?? ""}`;
  const direct = picker.isDefault ? options.find(option => option.id === wanted)
    ?? [...options].reverse().find(option => option.selection.slug === catalog.defaultModelSlug && option.reasoningEffort !== "ultra") : undefined;
  const fallback = direct ?? options.find(option => option.id === wanted)
    ?? options.find(option => sol(option.selection.slug) && option.id.slice(option.id.lastIndexOf(":") + 1) === (effort ?? ""))
    ?? options.find(option => sol(option.selection.slug) && option.reasoningEffort === "medium") ?? options.find(option => sol(option.selection.slug))
    ?? options.find(option => option.reasoningEffort === "medium") ?? options[0];
  return fallback && (catalog.defaultModelSlug === fallback.selection.slug || sol(catalog.defaultModelSlug) && sol(fallback.selection.slug))
    && picker.settings[fallback.index]?.thinkingEffort === effort ? fallback : direct;
}
function versionSelection(catalog: WorkModelCatalog, version: Version, selected: WorkModelOption | undefined): WorkModelSelection {
  const options = version.options;
  const choose = (option: WorkModelOption) => ({ slug: option.slug, thinkingEffort: option.thinkingEffort ?? null, versionId: version.id });
  if (selected?.lane != null) {
    const lane = selected.slug === "auto" ? "auto" : selected.lane, other = lane === "auto" ? "instant" : lane === "instant" ? "auto" : undefined;
    const found = options.find(option => option.lane === lane && (option.thinkingEffort ?? null) === (selected.thinkingEffort ?? null))
      ?? options.find(option => option.lane === lane && option.thinkingEffort === catalog.defaultThinkingEffortByModelSlug[option.slug])
      ?? options.find(option => option.lane === lane) ?? (other ? options.find(option => option.lane === other) : undefined);
    if (found) return choose(found);
    const slug = version.modelSlugByLane[lane] ?? (other ? version.modelSlugByLane[other] : undefined) ?? text(version.defaultModelSlug) ?? version.slugs[0];
    const same = options.filter(option => option.slug === slug);
    const result = same.find(option => (option.thinkingEffort ?? null) === (selected.thinkingEffort ?? null))
      ?? same.find(option => option.thinkingEffort === catalog.defaultThinkingEffortByModelSlug[slug]) ?? same[0];
    return result ? choose(result) : { slug, thinkingEffort: null, versionId: version.id };
  }
  const found = options.find(option => selected?.thinkingEffort != null && option.thinkingEffort === selected.thinkingEffort) ?? options[0];
  return found ? choose(found) : { slug: text(version.defaultModelSlug) ?? version.slugs[0], thinkingEffort: null, versionId: version.id };
}

/** Merged home projection only: no fabricated limits, alpha gates, speed,
 * Daybreak, synthetic default radio or execution-host model substitution. */
export function projectWorkModelPickerState({ catalog, selection, versionPreference }: { catalog: WorkModelCatalog; selection: WorkModelSelection;
  versionPreference?: WorkPickerVersionPreference | null }): WorkModelPickerState {
  const version = currentVersion(catalog, selection, versionPreference?.versionId ?? null);
  const internal = catalog.internalOptions.filter(option => option.slug === selection.slug);
  const options = version?.options ?? (internal.length && catalog.versionOptions.length ? internal : catalog.options);
  const picker = makePicker(catalog, options, version), powerOptions = powers(catalog, picker);
  const effort = picker.options.some(option => option.slug === selection.slug && option.thinkingEffort === null) ? null
    : selection.thinkingEffort ?? catalog.defaultThinkingEffortByModelSlug[selection.slug] ?? null;
  const defaultEffort = picker.settings.some(setting => setting.modelSlug === catalog.defaultModelSlug && setting.thinkingEffort === null) ? null
    : catalog.defaultThinkingEffortByModelSlug[catalog.defaultModelSlug] ?? null;
  const defaultCandidate = defaultPower(catalog, picker, powerOptions);
  const selectedPower = (selection.thinkingEffort !== null ? powerOptions.find(option => option.id === id(selection)) : undefined)
    ?? powerOptions.find(option => option.id === `${selection.slug}:${effort ?? ""}`)
    ?? (selection.slug === catalog.defaultModelSlug && effort === defaultEffort && defaultCandidate
      && picker.settings[defaultCandidate.index]?.thinkingEffort === effort ? defaultCandidate : undefined)
    ?? (selection.thinkingEffort === null ? powerOptions.find(option => option.selection.slug === selection.slug) : undefined);
  const selectedOption = picker.options.find(option => option.slug === selection.slug && option.thinkingEffort === effort)
    ?? (selection.thinkingEffort === null ? picker.options.find(option => option.slug === selection.slug) : undefined);
  const displayed = selectedPower ? picker.options.find(option => equal(option, selectedPower.selection)) ?? selectedOption : selectedOption;
  const title = text(displayed?.selectedLabel) ?? text(displayed?.title) ?? text(catalog.modelConfigBySlug[selection.slug]?.title) ?? "选择 ChatGPT 模型";
  const prefix = text(displayed?.selectedDisplayVersion);
  const rows: WorkPickerRow[] = catalog.versionOptions.map(entry => {
    const value = versionSelection(catalog, entry, displayed);
    return { id: entry.id, kind: "version", versionId: entry.id,
      label: text(entry.label) ?? text(entry.display_text_for_intelligence) ?? text(entry.display_text) ?? text(entry.display_text_full) ?? entry.id,
      description: text(entry.description), group: text(entry.pickerGroup) ?? text(entry.picker_group), selection: value,
      selected: entry === version && (selectedPower !== undefined || powerOptions.length === 0 || !powerOptions.some(option => option.selection.slug === selection.slug)),
      disabled: false, available: entry.enabled !== false, adminDisabled: catalog.modelConfigBySlug[value.slug]?.disabledByAdmin === true };
  });
  if (catalog.versionOptions.length === 0) for (const raw of catalog.options) {
    const option = optionMetadata(catalog, raw);
    rows.push({ id: id(option), kind: "model", versionId: null, label: text(option.title) ?? "选择 ChatGPT 模型", description: text(option.description),
      selection: { slug: option.slug, thinkingEffort: option.thinkingEffort ?? null, versionId: null }, selected: equal(option, selection),
      disabled: false, available: option.isAvailable !== false, adminDisabled: catalog.modelConfigBySlug[option.slug]?.disabledByAdmin === true });
  }
  const baseOptions = catalog.versionOptions.find(entry => entry.slugs.includes(catalog.defaultModelSlug) && entry.options.length)?.options
    ?? catalog.versionOptions.find(entry => entry.slugs.some(sol))?.options ?? catalog.options;
  const defaults = makePicker(catalog, baseOptions);
  defaults.settings = catalog.sliderSettings.length ? catalog.sliderSettings : baseOptions.map(option => ({ modelSlug: option.slug, thinkingEffort: option.thinkingEffort ?? null }));
  defaults.isDefault = true;
  const defaultChoice = defaultPower(catalog, defaults, powers(catalog, defaults));
  return { label: prefix && prefix !== title ? `${prefix} ${title}` : title,
    powerOptions: powerOptions.map(({ index: _index, ...option }) => option), selectedPowerId: selectedPower?.id ?? null, rows,
    defaultSelection: defaultChoice?.selection ?? null, activeVersionId: version?.id ?? null, selectionMode: version?.id === "latest" ? "default" : "model" };
}

import githubDark from "./themes/github-dark-default.json";
import githubLight from "./themes/github-light-default.json";
import dracula from "./themes/dracula.json";
import ayu from "./themes/ayu-dark.json";
import catppuccinLight from "./themes/catppuccin-latte.json";
import catppuccinDark from "./themes/catppuccin-mocha.json";
import darkPlus from "./themes/dark-plus.json";
import lightPlus from "./themes/light-plus.json";
import everforestDark from "./themes/everforest-dark.json";
import everforestLight from "./themes/everforest-light.json";
import gruvboxDark from "./themes/gruvbox-dark-medium.json";
import gruvboxLight from "./themes/gruvbox-light-medium.json";
import material from "./themes/material-theme-darker.json";
import monokai from "./themes/monokai.json";
import nightOwl from "./themes/night-owl.json";
import nord from "./themes/nord.json";
import oneDark from "./themes/one-dark-pro.json";
import oneLight from "./themes/one-light.json";
import rosePineDark from "./themes/rose-pine-moon.json";
import rosePineLight from "./themes/rose-pine-dawn.json";
import solarizedDark from "./themes/solarized-dark.json";
import solarizedLight from "./themes/solarized-light.json";
import tokyoNight from "./themes/tokyo-night.json";

export type ThemeVariant = "light" | "dark";
export interface ThemeFontFace { family: string; fullName: string; postscriptName: string }
export const escapeThemeFont = (value: string) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
export function firstThemeFontFamily(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  let quote = "", end = value.length;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "\\") i++;
    else if (quote) { if (char === quote) quote = ""; }
    else if (char === '"' || char === "'") quote = char;
    else if (char === ",") { end = i; break; }
  }
  return value.slice(0, end).trim().replace(/^["']|["']$/g, "").replace(/\\(.)/gsu, "$1") || undefined;
}
export function themeFontFamily(value: string, face?: ThemeFontFace): string {
  return face && firstThemeFontFamily(value)?.toLowerCase() === face.family.toLowerCase()
    ? `"${escapeThemeFont(`Codex selected ${face.postscriptName}`)}", ${value}` : value;
}
const fontLoads = new WeakMap<FontFaceSet, Map<string, Promise<boolean>>>();
export async function loadThemeFonts(themes: Pick<ChromeTheme, "fonts">[]): Promise<void> {
  if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) return;
  const fonts = document.fonts;
  let loads = fontLoads.get(fonts);
  if (!loads) { loads = new Map(); fontLoads.set(fonts, loads); }
  const requested = new Map<string, ThemeFontFace>();
  for (const theme of themes) for (const key of ["ui", "content", "code"] as const) {
    const face = theme.fonts[`${key}Face`];
    if (face && firstThemeFontFamily(theme.fonts[key])?.toLowerCase() === face.family.toLowerCase()) requested.set(`Codex selected ${face.postscriptName}`, face);
  }
  await Promise.all([...requested].map(([alias, face]) => {
    if (loads!.has(alias)) return loads!.get(alias);
    const load = Promise.resolve().then(() => new FontFace(alias,
      `local("${escapeThemeFont(face.postscriptName)}"), local("${escapeThemeFont(face.fullName)}")`).load())
      .then(font => { fonts.add(font); return true; }).catch(() => { loads!.delete(alias); return false; });
    loads!.set(alias, load); return load;
  }));
}
export interface ChromeTheme {
  accent: string;
  accentSource?: "chatgpt" | "custom";
  contrast: number;
  fonts: {
    code: string | null; ui: string | null; content?: string | null;
    codeFace?: ThemeFontFace; uiFace?: ThemeFontFace; contentFace?: ThemeFontFace;
  };
  ink: string;
  opaqueWindows: boolean;
  semanticColors: { diffAdded: string; diffRemoved: string; skill: string };
  surface: string;
}
export interface SharedTheme { variant: ThemeVariant; theme: ChromeTheme; codeThemeId: string }

export function defaultChromeTheme(variant: ThemeVariant): ChromeTheme {
  const dark = variant === "dark";
  return {
    accent: "#339cff", accentSource: "chatgpt", contrast: dark ? 60 : 45,
    fonts: { code: null, ui: null }, ink: dark ? "#ffffff" : "#1a1c1f",
    opaqueWindows: false, surface: dark ? "#181818" : "#ffffff",
    semanticColors: dark
      ? { diffAdded: "#40c977", diffRemoved: "#fa423e", skill: "#ad7bf9" }
      : { diffAdded: "#00a240", diffRemoved: "#ba2623", skill: "#924ff7" },
  };
}
const object = (value: unknown): value is Record<string, unknown> => value != null && typeof value === "object" && !Array.isArray(value);
const color = (value: unknown) => typeof value === "string" && /^#[\da-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : undefined;
const font = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const face = (value: unknown): value is ThemeFontFace => object(value) && ["family", "fullName", "postscriptName"].every(key => typeof value[key] === "string");

export function normalizeChromeTheme(input: unknown, variant: ThemeVariant): ChromeTheme {
  const fallback = defaultChromeTheme(variant), value = object(input) ? input : {};
  const fonts = object(value.fonts) ? value.fonts : {};
  const normalizedFonts: ChromeTheme["fonts"] = { code: font(fonts.code), ui: font(fonts.ui) };
  if (fonts.content != null) normalizedFonts.content = font(fonts.content);
  for (const key of ["code", "ui", "content"] as const) {
    const faceKey = `${key}Face` as const;
    if (normalizedFonts[key] != null && face(fonts[faceKey])) normalizedFonts[faceKey] = { ...fonts[faceKey] };
  }
  const semantic = object(value.semanticColors) ? value.semanticColors : {};
  const result: ChromeTheme = {
    accent: color(value.accent) ?? fallback.accent,
    contrast: typeof value.contrast === "number" && Number.isFinite(value.contrast) ? Math.min(100, Math.max(0, Math.round(value.contrast))) : fallback.contrast,
    fonts: normalizedFonts, ink: color(value.ink) ?? fallback.ink,
    opaqueWindows: typeof value.opaqueWindows === "boolean" ? value.opaqueWindows : fallback.opaqueWindows,
    semanticColors: {
      diffAdded: color(semantic.diffAdded) ?? fallback.semanticColors.diffAdded,
      diffRemoved: color(semantic.diffRemoved) ?? fallback.semanticColors.diffRemoved,
      skill: color(semantic.skill) ?? fallback.semanticColors.skill,
    }, surface: color(value.surface) ?? fallback.surface,
  };
  if (value.accentSource === "chatgpt" || value.accentSource === "custom") result.accentSource = value.accentSource;
  else if (input == null || ["accent", "ink", "surface", "contrast"].every(key => value[key] === fallback[key as keyof ChromeTheme])) result.accentSource = "chatgpt";
  return result;
}

export function validChromeTheme(input: unknown): input is ChromeTheme {
  if (!object(input) || !object(input.fonts) || !object(input.semanticColors)) return false;
  if (![input.accent, input.ink, input.surface, ...["diffAdded", "diffRemoved", "skill"].map(key => (input.semanticColors as Record<string, unknown>)[key])].every(value => typeof value === "string" && /^#[\da-f]{6}$/i.test(value))) return false;
  if (typeof input.contrast !== "number" || !Number.isInteger(input.contrast) || input.contrast < 0 || input.contrast > 100 || typeof input.opaqueWindows !== "boolean") return false;
  if (input.accentSource !== undefined && input.accentSource !== "chatgpt" && input.accentSource !== "custom") return false;
  for (const key of ["ui", "code", "content"] as const) {
    if (key === "content" && input.fonts[key] === undefined) continue;
    if (input.fonts[key] !== null && typeof input.fonts[key] !== "string") return false;
  }
  const fonts = input.fonts;
  return ["uiFace", "codeFace", "contentFace"].every(key => fonts[key] === undefined || face(fonts[key]));
}

export function themeKeys(variant: ThemeVariant) {
  return variant === "light"
    ? { chrome: "appearanceLightChromeTheme", code: "appearanceLightCodeThemeId" }
    : { chrome: "appearanceDarkChromeTheme", code: "appearanceDarkCodeThemeId" };
}
export function resetAdvancedTheme(theme: ChromeTheme, variant: ThemeVariant, backdropSupported = true): ChromeTheme {
  const result = normalizeChromeTheme(theme, variant), defaults = defaultChromeTheme(variant);
  result.contrast = defaults.contrast;
  if (backdropSupported) result.opaqueWindows = defaults.opaqueWindows;
  result.fonts = { code: null, content: null, ui: result.fonts.ui };
  return result;
}
export function serializeTheme(value: SharedTheme): string { return `codex-theme-v1:${JSON.stringify(value)}`; }
export function parseTheme(text: string, variant: ThemeVariant, allowedCodeThemeIds: readonly string[] = ["codex"]): SharedTheme {
  const trimmed = text.trim(), prefix = "codex-theme-v1:";
  if (!trimmed.startsWith(prefix)) throw new Error("主题分享格式无效");
  const payload = trimmed.slice(prefix.length);
  const result: unknown = JSON.parse(payload.startsWith("{") ? payload : decodeURIComponent(payload));
  if (!object(result) || result.variant !== variant || !validChromeTheme(result.theme) || typeof result.codeThemeId !== "string" || !allowedCodeThemeIds.includes(result.codeThemeId)) throw new Error("主题模式、配色或字段无效");
  return { variant, theme: normalizeChromeTheme(result.theme, variant), codeThemeId: result.codeThemeId };
}

type RGB = [number, number, number];
const black: RGB = [0, 0, 0], white: RGB = [255, 255, 255];
const rgb = (value: string): RGB => [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16)) as RGB;
const mix = (a: RGB, b: RGB, fraction: number): RGB => a.map((value, index) => Math.round(value + (b[index] - value) * Math.min(1, Math.max(0, fraction)))) as RGB;
const hex = (value: RGB) => `#${value.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
const solid = (value: RGB) => `rgb(${value.join(", ")})`;
const alpha = (value: RGB, opacity: number) => `rgba(${value.join(", ")}, ${Math.min(1, Math.max(0, opacity)).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")})`;

interface CodeThemeData {
  colors: Record<string, unknown>;
  tokenColors?: { scope?: string | string[]; settings: { foreground?: string; fontStyle?: string } }[];
  semanticTokenColors?: Record<string, unknown>;
}
const presetData: Record<string, { label: string; light?: CodeThemeData; dark?: CodeThemeData }> = {
  codex: { label: "Codex" }, ayu: { label: "Ayu", dark: ayu },
  catppuccin: { label: "Catppuccin", light: catppuccinLight, dark: catppuccinDark },
  dracula: { label: "Dracula", dark: dracula }, everforest: { label: "Everforest", light: everforestLight, dark: everforestDark },
  github: { label: "GitHub", light: githubLight, dark: githubDark }, gruvbox: { label: "Gruvbox", light: gruvboxLight, dark: gruvboxDark },
  material: { label: "Material", dark: material }, monokai: { label: "Monokai", dark: monokai },
  "night-owl": { label: "Night Owl", dark: nightOwl }, nord: { label: "Nord", dark: nord },
  one: { label: "One", light: oneLight, dark: oneDark }, "rose-pine": { label: "Rosé Pine", light: rosePineLight, dark: rosePineDark },
  solarized: { label: "Solarized", light: solarizedLight, dark: solarizedDark }, "tokyo-night": { label: "Tokyo Night", dark: tokyoNight },
  "vscode-plus": { label: "Visual Studio Code", light: lightPlus, dark: darkPlus },
};
export function themePresets(variant: ThemeVariant): { id: string; label: string }[] {
  return Object.entries(presetData).filter(([id, data]) => id === "codex" || data[variant]).map(([id, data]) => ({ id, label: data.label })).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}
function presetTheme(id: string, variant: ThemeVariant): CodeThemeData | undefined {
  const entry = presetData[id];
  if (!entry || (id !== "codex" && !entry[variant])) throw new Error("此模式不支持该代码主题");
  return entry[variant];
}
const distance = (a: string, b: string) => Math.hypot(...rgb(a).map((channel, index) => channel - rgb(b)[index]));
function opaqueColor(value: unknown, chromatic = false): string | undefined {
  if (typeof value !== "string" || !/^#[\da-f]{6}([\da-f]{2})?$/i.test(value)) return;
  const channels = rgb(value), opacity = value.length === 9 ? parseInt(value.slice(7), 16) / 255 : 1;
  if (opacity < (chromatic ? .45 : .98) || (chromatic && Math.max(...channels) - Math.min(...channels) < 24)) return;
  return value.slice(0, 7).toLowerCase();
}
function themeSeed(data: CodeThemeData, variant: ThemeVariant): ChromeTheme {
  const fallback = defaultChromeTheme(variant);
  const first = (keys: string[], chromatic = false) => keys.map(key => opaqueColor(data.colors[key], chromatic)).find(Boolean);
  const surface = first(["editor.background", "sideBar.background", "editorGroupHeader.tabsBackground", "panel.background", "activityBar.background"]) ?? fallback.surface;
  const ink = first(["editor.foreground", "sideBarTitle.foreground", "sideBar.foreground", "foreground"]) ?? fallback.ink;
  const usable = (value: string) => distance(value, surface) >= 42 && distance(value, ink) >= 42;
  const score = (value: string) => { const channels = rgb(value); return Math.max(...channels) - Math.min(...channels) + distance(value, surface) / 4 + distance(value, ink) / 4; };
  const tokenColors = (data.tokenColors ?? []).map(token => token.settings.foreground);
  const candidates = [...new Set([...Object.values(data.colors), ...tokenColors].map(value => opaqueColor(value, true)).filter((value): value is string => Boolean(value)))].filter(usable);
  const accent = ["activityBarBadge.background", "textLink.foreground", "editorCursor.foreground", "focusBorder", "button.background", "activityBar.activeBorder"].map(key => opaqueColor(data.colors[key], true)).find(value => value && usable(value))
    ?? tokenColors.map(value => opaqueColor(value, true)).filter((value): value is string => Boolean(value && usable(value))).sort((a, b) => score(b) - score(a))[0] ?? fallback.accent;
  const semantic = (keys: string[], min: number, max: number, target: number) => {
    const direct = first(keys); if (direct) return direct;
    let selected: string | undefined, best = -1;
    for (const value of candidates) {
      const channels = rgb(value).map(channel => channel / 255), top = Math.max(...channels), range = top - Math.min(...channels);
      if (!range) continue;
      const [r, g, b] = channels;
      const hue = ((top === r ? (g - b) / range % 6 : top === g ? (b - r) / range + 2 : (r - g) / range + 4) * 60 + 360) % 360;
      if (!(min <= max ? hue >= min && hue <= max : hue >= min || hue <= max)) continue;
      const delta = Math.abs(hue - target), rank = score(value) - Math.min(delta, 360 - delta) * 2;
      if (rank > best) { best = rank; selected = value; }
    }
    return selected;
  };
  return { ...fallback, accent, accentSource: "custom", ink, surface, semanticColors: {
    diffAdded: semantic(["gitDecoration.addedResourceForeground", "gitDecoration.untrackedResourceForeground", "terminal.ansiGreen", "terminal.ansiBrightGreen"], 80, 170, 125) ?? fallback.semanticColors.diffAdded,
    diffRemoved: semantic(["gitDecoration.deletedResourceForeground", "terminal.ansiRed", "terminal.ansiBrightRed"], 345, 15, 0) ?? fallback.semanticColors.diffRemoved,
    skill: semantic(["charts.purple", "terminal.ansiMagenta", "terminal.ansiBrightMagenta"], 210, 320, 265) ?? (usable(accent) ? accent : fallback.semanticColors.skill),
  } };
}
export async function loadThemePreset(id: string, variant: ThemeVariant): Promise<ChromeTheme> {
  const data = presetTheme(id, variant);
  if (data) return themeSeed(data, variant);
  // CODEX seed and these basic token categories are measured values; no proprietary module is distributed.
  return { ...defaultChromeTheme(variant), accent: "#0169cc", accentSource: "custom", surface: variant === "dark" ? "#111111" : "#ffffff", ink: variant === "dark" ? "#fcfcfc" : "#0d0d0d", semanticColors: { diffAdded: "#00a240", diffRemoved: "#e02e2a", skill: variant === "dark" ? "#b06dff" : "#751ed9" } };
}
export function codeThemeVariables(id: string, variant: ThemeVariant): Record<string, string> {
  const data = presetTheme(id, variant), dark = variant === "dark";
  const defaults: Record<string, string> = dark
    ? { background: "#111111", foreground: "#fcfcfc", comment: "#999999", string: "#85df7b", number: "#6dcbf4", boolean: "#6dcbf4", keyword: "#f67576", function: "#b06dff", type: "#b06dff", variable: "#fa994c", regexp: "#3d8dff" }
    : { background: "#ffffff", foreground: "#0d0d0d", comment: "#666666", string: "#008809", number: "#0071ea", boolean: "#0071ea", keyword: "#d53538", function: "#751ed9", type: "#751ed9", variable: "#bd5800", regexp: "#001bcb" };
  if (!data) return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [`--code-${key}`, value]));
  const variables: Record<string, string> = { "--code-background": opaqueColor(data.colors["editor.background"]) ?? defaults.background, "--code-foreground": opaqueColor(data.colors["editor.foreground"]) ?? defaults.foreground };
  const scopes: Record<string, string> = { comment: "comment", string: "string", number: "constant.numeric", boolean: "constant.language.boolean", keyword: "keyword", function: "entity.name.function", type: "entity.name.type", variable: "variable", regexp: "string.regexp" };
  for (const [name, scope] of Object.entries(scopes)) {
    let foreground: string | undefined, specificity = -1;
    for (const token of data.tokenColors ?? []) {
      const selectors = Array.isArray(token.scope) ? token.scope : token.scope?.split(",") ?? [];
      for (const selector of selectors.map(selector => selector.trim())) {
        if (selector && (scope === selector || scope.startsWith(`${selector}.`)) && selector.length >= specificity && token.settings.foreground) { foreground = token.settings.foreground; specificity = selector.length; }
      }
    }
    const semantic = data.semanticTokenColors?.[name];
    variables[`--code-${name}`] = (typeof semantic === "string" ? semantic : object(semantic) && typeof semantic.foreground === "string" ? semantic.foreground : foreground) ?? variables["--code-foreground"];
  }
  return variables;
}
function foreground(accent: RGB): RGB {
  const [r, g, b] = accent;
  const linear = (channel: number) => channel / 255 <= .04045 ? channel / 255 / 12.92 : ((channel / 255 + .055) / 1.055) ** 2.4;
  const luminance = linear(r) * .2126 + linear(g) * .7152 + linear(b) * .0722;
  if (b > r && b > g) {
    const range = b - Math.min(r, g), hue = ((r - g) / range + 4) * 60;
    if ((range / b >= .8 && hue >= 205 && hue <= 212) || (range / b >= .6 && hue >= 218 && hue <= 233 && luminance <= .21)) return white;
  }
  return luminance > .179 ? black : white;
}

/** Mathematical seed-to-semantic mapping verified against the fixed Store reference. */
export function themeVariables(input: ChromeTheme, variant: ThemeVariant): Record<string, string> {
  const theme = normalizeChromeTheme(input, variant), light = variant === "light";
  const surface = rgb(theme.surface), ink = rgb(theme.ink), accent = rgb(theme.accent);
  const base = light ? 45 : 60;
  const rawContrast = theme.contrast / 100 + (theme.contrast - base) / 60 * .7;
  const c = theme.contrast <= base ? rawContrast : base / 100 + (rawContrast - base / 100) * 2;
  const blend = (a: RGB, b: RGB, n: number) => hex(mix(a, b, n));
  const under = blend(surface, light ? ink : black, (light ? .04 : .16) + (theme.contrast - base) * (light ? .0012 : .0015));
  const editor = mix(surface, light ? white : ink, light ? .12 : .07);
  const control = mix(surface, light ? white : ink, light ? .09 + c * .04 : .06 + c * .05);
  const elevated = mix(surface, light ? white : ink, light ? .16 + c * .12 : .08 + c * .08);
  const secondary = mix(surface, white, .08 + c * .08);
  const tint = mix(accent, white, .3 + c * .15);
  const darkButton = mix(surface, black, .38 + c * .12);
  const defaults = defaultChromeTheme(variant);
  const defaultDark = !light && theme.accent === defaults.accent && theme.contrast === defaults.contrast && theme.ink === defaults.ink && theme.surface === defaults.surface && theme.opaqueWindows === defaults.opaqueWindows && !Object.values(theme.fonts).some(value => value != null) && Object.entries(defaults.semanticColors).every(([key, value]) => theme.semanticColors[key as keyof ChromeTheme["semanticColors"]] === value);
  const variables: Record<string, string> = {
    "--codex-base-accent": theme.accent, "--codex-base-contrast": String(theme.contrast), "--codex-base-ink": theme.ink, "--codex-base-surface": theme.surface,
    "--app-color-accent-blue": theme.accent, "--app-color-accent-purple": theme.semanticColors.skill,
    "--app-color-background-accent": blend(light ? surface : black, accent, light ? .11 + c * .04 : .2 + c * .08),
    "--app-color-background-accent-active": blend(light ? surface : black, accent, light ? .13 + c * .05 : .22 + c * .12),
    "--app-color-background-accent-hover": blend(light ? surface : black, accent, light ? .12 + c * .045 : .21 + c * .1),
    "--app-color-background-surface": theme.surface, "--app-color-background-surface-under": under,
    "--app-color-background-application-menu": blend(surface, ink, .02 + c * .02),
    "--app-color-background-control": alpha(control, .96), "--color-background-control-opaque": solid(control),
    "--app-color-background-editor-opaque": solid(editor),
    "--app-color-background-elevated-primary": alpha(elevated, .96), "--app-color-background-elevated-primary-opaque": solid(elevated),
    "--app-color-background-elevated-secondary": light ? alpha(secondary, .96) : alpha(ink, .02 + c * .02),
    "--app-color-background-elevated-secondary-opaque": light ? solid(secondary) : blend(surface, ink, .04 + c * .05),
    "--app-color-background-elevated-tertiary-opaque": light ? blend(secondary, ink, .04 + c * .02) : solid(editor),
    "--app-color-border": alpha(ink, .06 + c * .04), "--app-color-border-light": alpha(ink, light ? .04 + c * .02 : .03 + c * .02),
    "--app-color-border-heavy": alpha(ink, light ? .09 + c * .06 : .12 + c * .06),
    "--app-color-border-focus": light ? theme.accent : alpha(tint, .7 + c * .1),
    "--app-color-decoration-added": theme.semanticColors.diffAdded, "--app-color-decoration-deleted": theme.semanticColors.diffRemoved,
    "--app-color-editor-added": alpha(rgb(theme.semanticColors.diffAdded), light ? .15 : .23), "--app-color-editor-deleted": alpha(rgb(theme.semanticColors.diffRemoved), light ? .15 : .23),
    "--app-color-icon-accent": light ? theme.accent : solid(tint), "--app-color-icon-primary": light ? theme.ink : alpha(ink, .82 + c * .14),
    "--app-color-icon-secondary": alpha(ink, .65 + c * .1), "--app-color-icon-tertiary": alpha(ink, .45 + c * .1),
    "--app-color-text-accent": light ? theme.accent : solid(tint), "--app-color-text-on-accent": solid(foreground(accent)),
    "--gray-fixed-150": "#dfdfdf",
    "--app-color-text-foreground": defaultDark ? "var(--gray-fixed-150)" : theme.ink, "--app-color-text-foreground-secondary": alpha(ink, .65 + c * .1),
    "--app-color-text-foreground-tertiary": alpha(ink, light ? .45 + c * .1 : .42 + c * .13),
    "--app-color-simple-scrim": alpha(light ? black : ink, .08 + c * .04),
    "--color-background-panel": blend(surface, light ? white : ink, (light ? .18 : .03) + c * (light ? .008 : .03)),
    "--color-background-user-message": "color-mix(in oklab, var(--color-text) 5%, transparent)", "--color-text-user-message": "var(--color-text)",
  };
  const button: Record<string, [number, number, number]> = light ? {
    "primary-active": [.1, .12, 0], "primary-hover": [.05, .06, 0], "primary-inactive": [.18, .14, 0],
    secondary: [.04, .02, 0], "secondary-active": [.03, .02, 0], "secondary-hover": [.04, .03, 0], "secondary-inactive": [.01, .02, 0],
    tertiary: [0, 0, 0], "tertiary-active": [.16, .08, 0], "tertiary-hover": [.08, .04, 0],
  } : {
    "primary-active": [.07, .05, 0], "primary-hover": [.04, .03, 0], "primary-inactive": [.02, .02, 0],
    secondary: [.04, .02, 0], "secondary-active": [.09, .05, 0], "secondary-hover": [.06, .03, 0], "secondary-inactive": [.02, .03, 0],
    tertiary: [.02, .015, 0], "tertiary-active": [.07, .05, 0], "tertiary-hover": [.05, .03, 0],
  };
  for (const [name, [a, b]] of Object.entries(button)) variables[`--app-color-background-button-${name}`] = alpha(ink, a + c * b);
  variables["--app-color-background-button-primary"] = light ? theme.ink : solid(darkButton);
  variables["--app-color-text-button-primary"] = light ? theme.surface : solid(darkButton);
  variables["--app-color-text-button-secondary"] = light ? theme.ink : blend(ink, surface, .7 + c * .1);
  variables["--app-color-text-button-tertiary"] = alpha(ink, .45 + c * .1);
  variables["--app-color-border-application-menu-separator"] = light ? variables["--app-color-border-heavy"] : blend(mix(surface, ink, .02 + c * .02), ink, .28);
  const aliases: Record<string, string> = {
    "--bg-primary": "--app-color-background-surface", "--bg-main": "--app-color-background-surface", "--bg-secondary": "--app-color-background-surface-under",
    "--bg-titlebar": "--app-color-background-surface-under", "--bg-nav-rail": "--app-color-background-surface-under", "--bg-sidebar": "--app-color-background-surface-under",
    "--bg-tertiary": "--app-color-background-elevated-secondary-opaque", "--bg-hover": "--app-color-background-button-tertiary-hover", "--bg-card": "--app-color-background-elevated-primary-opaque",
    "--bg-composer": "--app-color-background-control", "--bg-composer-context": "--app-color-background-surface-under", "--bg-composer-surface": "--color-background-control-opaque", "--bg-input": "--app-color-background-surface",
    "--bg-pill": "--app-color-background-button-secondary", "--bg-pill-hover": "--app-color-background-button-secondary-hover", "--bg-pill-active": "--app-color-background-button-secondary-active",
    "--text-primary": "--app-color-text-foreground", "--text-secondary": "--app-color-text-foreground-secondary", "--text-tertiary": "--app-color-text-foreground-tertiary", "--text-disabled": "--app-color-icon-tertiary",
    "--border-subtle": "--app-color-border-light", "--border-default": "--app-color-border", "--border-strong": "--app-color-border-heavy", "--border-focus": "--app-color-border-focus",
    "--accent-blue": "--app-color-accent-blue", "--accent-green": "--app-color-decoration-added", "--accent-red": "--app-color-decoration-deleted",
    "--diff-added-bg": "--app-color-editor-added", "--diff-removed-bg": "--app-color-editor-deleted", "--selection-bg": "--app-color-background-accent-active",
  };
  for (const [name, target] of Object.entries(aliases)) variables[name] = variables[target];
  variables["--color-text"] = theme.ink;
  variables["--color-background-text-selection"] = variables["--selection-bg"];
  variables["--color-background-attribution-highlight"] = variables["--selection-bg"];
  variables["--font-sans"] = theme.fonts.ui ? `${themeFontFamily(theme.fonts.ui, theme.fonts.uiFace)}, sans-serif` : '"OpenAI Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  variables["--font-mono"] = theme.fonts.code ? `${themeFontFamily(theme.fonts.code, theme.fonts.codeFace)}, monospace` : '"Cascadia Code", Consolas, Menlo, monospace';
  variables["--font-content"] = theme.fonts.content ? `${themeFontFamily(theme.fonts.content, theme.fonts.contentFace)}, sans-serif` : "var(--font-sans)";
  return variables;
}

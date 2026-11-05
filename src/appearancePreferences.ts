import { useCallback, useEffect, useRef, useState } from "react";
import { tauriInvoke, tauriListen } from "./bridge";
import { defaultChromeTheme, normalizeChromeTheme, validChromeTheme, themeVariables, themePresets, codeThemeVariables, loadThemeFonts,
  type ChromeTheme, type ThemeVariant } from "./appearanceTheme";

export interface AppearancePreferences {
  appearanceTheme: "system" | "light" | "dark";
  sansFontSize: number;
  codeFontSize: number;
  "reduced-motion-preference": "system" | "on" | "off";
  appearanceLightChromeTheme: ChromeTheme;
  appearanceDarkChromeTheme: ChromeTheme;
  appearanceLightCodeThemeId: string;
  appearanceDarkCodeThemeId: string;
}
export type AppearanceKey = keyof AppearancePreferences;
export const DEFAULT_APPEARANCE: AppearancePreferences = {
  appearanceTheme: "system", sansFontSize: 14, codeFontSize: 12,
  "reduced-motion-preference": "system",
  appearanceLightChromeTheme: defaultChromeTheme("light"), appearanceDarkChromeTheme: defaultChromeTheme("dark"),
  appearanceLightCodeThemeId: "codex", appearanceDarkCodeThemeId: "codex",
};

export function parseAppearanceFontSize(key: "sansFontSize" | "codeFontSize", text: string): number | null {
  const value = parseFloat(text);
  const [min, max] = key === "sansFontSize" ? [11, 16] : [8, 24];
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

export function normalizeAppearanceValue<K extends AppearanceKey>(key: K, value: unknown): AppearancePreferences[K] {
  if (key === "appearanceLightChromeTheme" || key === "appearanceDarkChromeTheme") {
    return normalizeChromeTheme(value, key === "appearanceLightChromeTheme" ? "light" : "dark") as AppearancePreferences[K];
  }
  if (key === "appearanceLightCodeThemeId" || key === "appearanceDarkCodeThemeId") {
    return (typeof value === "string" && value.length > 0 && value.length <= 100 && !/[\x00-\x1f\x7f]/.test(value) ? value : "codex") as AppearancePreferences[K];
  }
  if (key === "sansFontSize" || key === "codeFontSize") {
    return (typeof value === "number" ? parseAppearanceFontSize(key, String(value)) ?? DEFAULT_APPEARANCE[key] : DEFAULT_APPEARANCE[key]) as AppearancePreferences[K];
  }
  const allowed = key === "appearanceTheme" ? ["system", "light", "dark"] : ["system", "on", "off"];
  return (allowed.includes(value as string) ? value : "system") as AppearancePreferences[K];
}

export function applyAppearance(preferences: AppearancePreferences): () => void {
  const root = document.documentElement;
  const theme = window.matchMedia("(prefers-color-scheme: dark)");
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const update = () => {
    root.dataset.theme = preferences.appearanceTheme === "system" ? (theme.matches ? "dark" : "light") : preferences.appearanceTheme;
    const variant = root.dataset.theme as ThemeVariant;
    const chrome = variant === "light" ? preferences.appearanceLightChromeTheme : preferences.appearanceDarkChromeTheme;
    for (const [key, value] of Object.entries(themeVariables(chrome, variant))) root.style.setProperty(key, value);
    void loadThemeFonts([chrome]);
    const codeId = variant === "light" ? preferences.appearanceLightCodeThemeId : preferences.appearanceDarkCodeThemeId;
    const renderId = themePresets(variant).some(preset => preset.id === codeId) ? codeId : "codex";
    for (const [key, value] of Object.entries(codeThemeVariables(renderId, variant))) root.style.setProperty(key, value);
    root.dataset.reducedMotion = String(preferences["reduced-motion-preference"] === "on" ||
      (preferences["reduced-motion-preference"] === "system" && motion.matches));
  };
  root.style.setProperty("--font-ui-size", `${preferences.sansFontSize}px`);
  root.style.setProperty("--font-code-size", `${preferences.codeFontSize}px`);
  root.style.setProperty("--font-ui-scale", String(preferences.sansFontSize / 14));
  for (const [name, size] of Object.entries({ "4xl": 72, "3xl": 48, "2xl": 36, xl: 28, lg: 16,
    base: 14, sm: 13, xs: 12, "heading-lg": 24, "heading-app": 28, "heading-md": 20, "heading-sm": 18 })) {
    root.style.setProperty(`--text-${name}`, `${Math.round(size * preferences.sansFontSize / 14)}px`);
  }
  update();
  theme.addEventListener("change", update);
  motion.addEventListener("change", update);
  return () => { theme.removeEventListener("change", update); motion.removeEventListener("change", update); };
}

export function useAppearancePreferences() {
  const [preferences, setPreferences] = useState<AppearancePreferences>(DEFAULT_APPEARANCE);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [variant, setVariant] = useState<ThemeVariant>(() => window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const pending = useRef(true);
  const alive = useRef(true);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const changedWhilePending = useRef(false);
  const clearReadError = useRef(true);
  const themeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const themeWrites = useRef(0);
  const read = async () => {
    const values = await tauriInvoke<Record<string, unknown>>("appearance_preferences_read");
    if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("外观配置格式无效");
    return Object.fromEntries((Object.keys(DEFAULT_APPEARANCE) as AppearanceKey[])
      .map(key => [key, normalizeAppearanceValue(key, values[key])])) as unknown as AppearancePreferences;
  };
  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    pending.current = true;
    setBusy(true);
    if (clearReadError.current) setError(null);
    clearReadError.current = true;
    read().then(snapshot => {
      if (!cancelled) { preferencesRef.current = snapshot; setPreferences(snapshot); }
    }).catch(reason => { if (!cancelled) setError(`读取外观设置失败：${String(reason)}`); })
      .finally(() => { if (!cancelled) { pending.current = false; setBusy(false); refreshAfterWrite(); } });
    return () => { cancelled = true; alive.current = false; };
  }, [refresh]);
  useEffect(() => applyAppearance(preferences), [preferences]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setVariant(preferences.appearanceTheme === "system" ? (media.matches ? "dark" : "light") : preferences.appearanceTheme);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preferences.appearanceTheme]);
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void tauriListen<{ key: string }>("appearance-preferences-changed", event => {
      if (cancelled || !Object.hasOwn(DEFAULT_APPEARANCE, event.key)) return;
      if (pending.current) changedWhilePending.current = true;
      else { clearReadError.current = false; setRefresh(value => value + 1); }
    }).then(stop => { if (cancelled) stop(); else unlisten = stop; })
      .catch(reason => { if (!cancelled) setError(`订阅外观更新失败：${String(reason)}`); });
    return () => { cancelled = true; unlisten?.(); };
  }, []);
  const refreshAfterWrite = () => {
    if (changedWhilePending.current && alive.current) {
      changedWhilePending.current = false;
      clearReadError.current = false;
      setRefresh(value => value + 1);
    }
  };

  const save = useCallback(async <K extends AppearanceKey>(key: K, value: AppearancePreferences[K]): Promise<"saved" | "unconfirmed" | "failed"> => {
    if (pending.current) return "failed";
    const normalized = normalizeAppearanceValue(key, value);
    if (JSON.stringify(normalized) !== JSON.stringify(value)) return "failed";
    pending.current = true;
    setBusy(true);
    setError(null);
    let written = false;
    const optimistic = key !== "appearanceTheme";
    const previous = preferences[key];
    if (optimistic) setPreferences(current => ({ ...current, [key]: value }));
    try {
      await tauriInvoke("appearance_preference_write", { key, value });
      written = true;
      const saved = await read();
      if (JSON.stringify(saved[key]) !== JSON.stringify(value)) throw new Error("外观偏好读回不一致");
      if (alive.current) { preferencesRef.current = saved; setPreferences(saved); }
      return "saved";
    } catch (reason) {
      if (alive.current && optimistic && !written) setPreferences(current => ({ ...current, [key]: previous }));
      if (alive.current) setError(`${written ? "已保存，但读取确认失败" : "保存失败"}：${String(reason)}`);
      return written ? "unconfirmed" : "failed";
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
      refreshAfterWrite();
    }
  }, [preferences]);
  const saveTheme = useCallback((targetVariant: ThemeVariant, theme: ChromeTheme, codeThemeId: string): Promise<"saved" | "unconfirmed" | "failed"> => {
    const themeKey = targetVariant === "light" ? "appearanceLightChromeTheme" : "appearanceDarkChromeTheme";
    const codeKey = targetVariant === "light" ? "appearanceLightCodeThemeId" : "appearanceDarkCodeThemeId";
    if (!alive.current || (pending.current && themeWrites.current === 0) || !validChromeTheme(theme)
      || (!themePresets(targetVariant).some(preset => preset.id === codeThemeId)
        && preferencesRef.current[codeKey] !== codeThemeId)) return Promise.resolve("failed");
    const desired = normalizeChromeTheme(theme, targetVariant);
    themeWrites.current += 1;
    pending.current = true;
    setBusy(true);
    const run = async (): Promise<"saved" | "unconfirmed" | "failed"> => {
      if (!alive.current) return "failed";
      setError(null);
      const previous = preferencesRef.current;
      let written = false;
      let codeWritten = false;
      let rollbackError: unknown;
      try {
        await tauriInvoke("appearance_preference_write", { key: themeKey, value: desired });
        written = true;
        if (previous[codeKey] !== codeThemeId) {
          try {
            await tauriInvoke("appearance_preference_write", { key: codeKey, value: codeThemeId });
            codeWritten = true;
          } catch (reason) {
            try {
              await tauriInvoke("appearance_preference_write", { key: themeKey, value: previous[themeKey] });
              written = false;
            } catch (error) { rollbackError = error; }
            throw reason;
          }
        }
        const saved = await read();
        if (JSON.stringify(saved[themeKey]) !== JSON.stringify(desired) || saved[codeKey] !== codeThemeId) throw new Error("主题读回不一致");
        if (alive.current) { preferencesRef.current = saved; setPreferences(saved); }
        return "saved";
      } catch (reason) {
        let readError: unknown;
        try {
          const saved = await read();
          if (alive.current) { preferencesRef.current = saved; setPreferences(saved); }
        } catch (error) { readError = error; }
        if (alive.current) setError(`${written || codeWritten ? "部分设置已保存，结果待确认" : "保存主题失败"}：${String(reason)}${rollbackError ? `；恢复失败：${String(rollbackError)}` : ""}${readError ? `；重新读取失败：${String(readError)}` : ""}`);
        return written || codeWritten ? "unconfirmed" : "failed";
      }
    };
    const operation = themeQueue.current.then(run, run);
    themeQueue.current = operation.finally(() => {
      themeWrites.current -= 1;
      if (themeWrites.current === 0) {
        pending.current = false;
        if (alive.current) setBusy(false);
        refreshAfterWrite();
      }
    });
    return operation;
  }, []);
  return { preferences, variant, busy, error, save, saveTheme, reload: () => { if (!pending.current) setRefresh(value => value + 1); } };
}
export type AppearanceState = ReturnType<typeof useAppearancePreferences>;

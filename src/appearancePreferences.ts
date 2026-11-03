import { useCallback, useEffect, useRef, useState } from "react";
import { tauriInvoke } from "./bridge";

export interface AppearancePreferences {
  appearanceTheme: "system" | "light" | "dark";
  sansFontSize: number;
  codeFontSize: number;
  "reduced-motion-preference": "system" | "on" | "off";
}
export type AppearanceKey = keyof AppearancePreferences;
export const DEFAULT_APPEARANCE: AppearancePreferences = {
  appearanceTheme: "system", sansFontSize: 14, codeFontSize: 12,
  "reduced-motion-preference": "system",
};

export function parseAppearanceFontSize(key: "sansFontSize" | "codeFontSize", text: string): number | null {
  const value = parseFloat(text);
  const [min, max] = key === "sansFontSize" ? [11, 16] : [8, 24];
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

export function normalizeAppearanceValue<K extends AppearanceKey>(key: K, value: unknown): AppearancePreferences[K] {
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
  const pending = useRef(true);
  const alive = useRef(true);
  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    pending.current = true;
    setBusy(true);
    setError(null);
    const keys = Object.keys(DEFAULT_APPEARANCE) as AppearanceKey[];
    Promise.all(keys.map(async key => [key, normalizeAppearanceValue(key,
      await tauriInvoke("desktop_state_get", { key }))] as const)).then(entries => {
      if (!cancelled) setPreferences(Object.fromEntries(entries) as unknown as AppearancePreferences);
    }).catch(reason => { if (!cancelled) setError(`读取外观设置失败：${String(reason)}`); })
      .finally(() => { if (!cancelled) { pending.current = false; setBusy(false); } });
    return () => { cancelled = true; alive.current = false; };
  }, [refresh]);
  useEffect(() => applyAppearance(preferences), [preferences]);

  const save = useCallback(async <K extends AppearanceKey>(key: K, value: AppearancePreferences[K]): Promise<"saved" | "unconfirmed" | "failed"> => {
    if (pending.current) return "failed";
    const normalized = normalizeAppearanceValue(key, value);
    if (normalized !== value) return "failed";
    pending.current = true;
    setBusy(true);
    setError(null);
    let written = false;
    const optimistic = key !== "appearanceTheme";
    const previous = preferences[key];
    if (optimistic) setPreferences(current => ({ ...current, [key]: value }));
    try {
      await tauriInvoke("desktop_state_set", { key, value });
      written = true;
      const saved = await tauriInvoke("desktop_state_get", { key });
      if (saved !== value) throw new Error("外观偏好读回不一致");
      if (alive.current) setPreferences(previous => ({ ...previous, [key]: value }));
      return "saved";
    } catch (reason) {
      if (alive.current && optimistic && !written) setPreferences(current => ({ ...current, [key]: previous }));
      if (alive.current) setError(`${written ? "已保存，但读取确认失败" : "保存失败"}：${String(reason)}`);
      return written ? "unconfirmed" : "failed";
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }, [preferences]);
  return { preferences, busy, error, save, reload: () => { if (!pending.current) setRefresh(value => value + 1); } };
}
export type AppearanceState = ReturnType<typeof useAppearancePreferences>;

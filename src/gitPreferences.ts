import { useEffect, useRef, useState } from "react";
import { tauriInvoke } from "./bridge";

export const GIT_DEFAULTS = {
  "git-review-mode": "full" as "full" | "last-turn-only",
  "git-always-force-push": false,
  "git-create-pull-request-as-draft": true,
};
export type GitPreferences = typeof GIT_DEFAULTS;
type GitKey = keyof GitPreferences;

export function normalizeGitPreference<K extends GitKey>(key: K, value: unknown): GitPreferences[K] {
  if (key === "git-review-mode") return (value === "last-turn-only" ? value : "full") as GitPreferences[K];
  return (typeof value === "boolean" ? value : GIT_DEFAULTS[key]) as GitPreferences[K];
}

export function useGitPreferences() {
  const [preferences, setPreferences] = useState<GitPreferences>(GIT_DEFAULTS);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(false);
  const generation = useRef(0);
  const reload = async () => {
    if (operation.current) return;
    operation.current = true;
    const version = generation.current;
    setBusy(true); setError(null); setReady(false);
    try {
      const entries = await Promise.all((Object.keys(GIT_DEFAULTS) as GitKey[]).map(async key =>
        [key, normalizeGitPreference(key, await tauriInvoke("desktop_state_get", { key }))]));
      if (version === generation.current) { setPreferences(Object.fromEntries(entries) as GitPreferences); setReady(true); }
    } catch (error) {
      if (version === generation.current) setError(`读取 Git 设置失败：${String(error)}`);
    } finally {
      if (version === generation.current) { operation.current = false; setBusy(false); }
    }
  };
  useEffect(() => {
    void reload();
    return () => { generation.current += 1; operation.current = false; };
  }, []);
  const save = async <K extends GitKey>(key: K, value: GitPreferences[K]) => {
    if (operation.current || !ready || normalizeGitPreference(key, value) !== value) return false;
    operation.current = true;
    const version = generation.current;
    setBusy(true); setError(null);
    try {
      await tauriInvoke("desktop_state_set", { key, value });
      const readback = await tauriInvoke("desktop_state_get", { key });
      if (readback !== value) throw Error("已写入，但读回不一致，请重新读取后核对。");
      if (version !== generation.current) return false;
      setPreferences(previous => ({ ...previous, [key]: value }));
      return true;
    } catch (error) {
      if (version === generation.current) { setError(`保存 Git 设置失败：${String(error)}`); setReady(false); }
      return false;
    } finally {
      if (version === generation.current) { operation.current = false; setBusy(false); }
    }
  };
  return { preferences, ready, busy, error, reload, save };
}
export type GitPreferencesState = ReturnType<typeof useGitPreferences>;

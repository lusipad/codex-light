import { useEffect, useRef, useState } from "react";
import { tauriInvoke } from "./bridge";

export const GIT_DEFAULTS = {
  "git-review-mode": "full" as "full" | "last-turn-only",
  "git-always-force-push": false,
  "git-create-pull-request-as-draft": true,
  "git-commit-instructions": "",
  "git-pr-instructions": "",
};
export type GitPreferences = typeof GIT_DEFAULTS;
export type GitKey = keyof GitPreferences;

export function normalizeGitPreference<K extends GitKey>(key: K, value: unknown): GitPreferences[K] {
  if (key === "git-review-mode") return (value === "last-turn-only" ? value : "full") as GitPreferences[K];
  if (key === "git-commit-instructions" || key === "git-pr-instructions") return (typeof value === "string" ? value : "") as GitPreferences[K];
  return (typeof value === "boolean" ? value : GIT_DEFAULTS[key]) as GitPreferences[K];
}

export function useGitPreferences() {
  const [preferences, setPreferences] = useState<GitPreferences>(GIT_DEFAULTS);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef(false), readyRef = useRef(false), instructionsLoaded = useRef(false), mounted = useRef(true);
  const pending = useRef(new Map<GitKey, { value: GitPreferences[GitKey]; promise: Promise<boolean> }>());
  const errorKey = useRef<GitKey | null>(null);
  const generation = useRef(0);
  const reload = async () => {
    if (loading.current || pending.current.size) return;
    loading.current = true; readyRef.current = false;
    const version = generation.current;
    setBusy(true); errorKey.current = null; setError(null); setReady(false);
    try {
      const entries = await Promise.all((Object.keys(GIT_DEFAULTS) as GitKey[]).map(async key =>
        [key, normalizeGitPreference(key, await tauriInvoke("desktop_state_get", { key }))]));
      if (mounted.current && version === generation.current) { readyRef.current = true; instructionsLoaded.current = true; setPreferences(Object.fromEntries(entries) as GitPreferences); setReady(true); }
    } catch (error) {
      if (mounted.current && version === generation.current) setError(`读取 Git 设置失败：${String(error)}`);
    } finally {
      if (mounted.current && version === generation.current) { loading.current = false; setBusy(pending.current.size > 0); }
    }
  };
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => { mounted.current = false; generation.current += 1; loading.current = false; };
  }, []);
  const save = <K extends GitKey>(key: K, value: GitPreferences[K]): Promise<boolean> => {
    const previous = pending.current.get(key);
    if (previous?.value === value) return previous.promise;
    const instruction = key === "git-commit-instructions" || key === "git-pr-instructions";
    if ((!readyRef.current && !(instruction && instructionsLoaded.current && !loading.current)) || normalizeGitPreference(key, value) !== value) return Promise.resolve(false);
    const version = generation.current;
    if (mounted.current) {
      setBusy(true);
      if (errorKey.current === key) { errorKey.current = null; setError(null); }
    }
    const execute = async () => {
      try {
        await tauriInvoke("desktop_state_set", { key, value });
        const readback = await tauriInvoke("desktop_state_get", { key });
        if (readback !== value) throw Error("已写入，但读回不一致，请重新读取后核对。");
        if (mounted.current && version === generation.current) setPreferences(previous => ({ ...previous, [key]: value }));
        return true;
      } catch (error) {
        if (mounted.current && version === generation.current && pending.current.get(key)?.promise === promise) {
          errorKey.current = key;
          setError(`保存 Git 设置失败：${String(error)}`);
          if (typeof GIT_DEFAULTS[key] !== "string" || key === "git-review-mode") { readyRef.current = false; setReady(false); }
        }
        return false;
      } finally {
        if (pending.current.get(key)?.promise === promise) pending.current.delete(key);
        if (mounted.current && version === generation.current) setBusy(loading.current || pending.current.size > 0);
      }
    };
    const promise = (previous?.promise ?? Promise.resolve(true)).then(execute);
    pending.current.set(key, { value, promise });
    return promise;
  };
  return { preferences, ready, instructionsReady: instructionsLoaded.current && !loading.current, busy, error, reload, save };
}
export type GitPreferencesState = ReturnType<typeof useGitPreferences>;

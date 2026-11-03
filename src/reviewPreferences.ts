import { useEffect, useRef, useState } from "react";
import { tauriInvoke, tauriListen } from "./bridge";
import { openWebLink } from "./webLinks";

export interface ReviewPreferences {
  githubLinkTarget: string;
  configuredGithubLinkTarget: string | null;
  localReviewInstructions: string;
}

export function parseReviewPreferences(value: unknown): ReviewPreferences {
  const data = value as Partial<ReviewPreferences> | null;
  if (!data || typeof data.githubLinkTarget !== "string" || typeof data.localReviewInstructions !== "string"
    || (data.configuredGithubLinkTarget !== null && typeof data.configuredGithubLinkTarget !== "string")) {
    throw Error("审查偏好响应格式无效");
  }
  return { githubLinkTarget: data.githubLinkTarget, configuredGithubLinkTarget: data.configuredGithubLinkTarget, localReviewInstructions: data.localReviewInstructions };
}

export async function readReviewPreferences() {
  return parseReviewPreferences(await tauriInvoke("code_review_preferences_get"));
}

export function useCodeReviewPreferences() {
  const [preferences, setPreferences] = useState<ReviewPreferences>({ githubLinkTarget: "github", configuredGithubLinkTarget: null, localReviewInstructions: "" });
  const [draft, setDraftValue] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [subscriptionAttempt, setSubscriptionAttempt] = useState(0);
  const generation = useRef(0);
  const readRevision = useRef(0);
  const preferencesRef = useRef(preferences);
  const draftRef = useRef(draft);
  const changedWhilePending = useRef(false);
  const loading = useRef(false);
  const loaded = useRef(false);
  const pending = useRef<{ patch: string; promise: Promise<boolean> } | null>(null);
  const setDraft = (value: string) => { draftRef.current = value; setDraftValue(value); };
  const refresh = () => {
    changedWhilePending.current = true;
    if (!loading.current && !pending.current) {
      changedWhilePending.current = false;
      void load(true);
    }
  };
  const load = async (preserveDraft = false) => {
    if (loading.current || pending.current) { changedWhilePending.current = true; return; }
    loading.current = true;
    if (!preserveDraft) loaded.current = false;
    const version = generation.current;
    const ticket = ++readRevision.current;
    setBusy(true); setError(null);
    try {
      const value = await readReviewPreferences();
      if (version !== generation.current || ticket !== readRevision.current) return;
      loaded.current = true;
      if (!preserveDraft || draftRef.current === preferencesRef.current.localReviewInstructions) setDraft(value.localReviewInstructions);
      preferencesRef.current = value;
      setPreferences(value); setReady(true);
    } catch (error) {
      if (version === generation.current && ticket === readRevision.current) {
        setError(`读取审查偏好失败：${String(error)}`);
        if (!preserveDraft) setReady(false);
      }
    } finally {
      if (version === generation.current) {
        loading.current = false; setBusy(pending.current !== null);
        if (changedWhilePending.current && !pending.current) refresh();
      }
    }
  };
  useEffect(() => {
    void load();
    return () => { generation.current += 1; loading.current = false; loaded.current = false; pending.current = null; changedWhilePending.current = false; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    setSyncError(null);
    void tauriListen("code-review-preferences-changed", () => { if (!cancelled) refresh(); })
      .then(stop => { if (cancelled) stop(); else { unlisten = stop; refresh(); } })
      .catch(reason => { if (!cancelled) setSyncError(`订阅审查偏好失败：${String(reason)}`); });
    return () => { cancelled = true; unlisten?.(); };
  }, [subscriptionAttempt]);
  const save = (patch: Partial<Pick<ReviewPreferences, "githubLinkTarget" | "localReviewInstructions">>): Promise<boolean> => {
    const previous = pending.current;
    const snapshot = { ...patch };
    const identity = JSON.stringify(snapshot);
    if (previous?.patch === identity) return previous.promise;
    if (!loaded.current) return Promise.resolve(false);
    readRevision.current += 1;
    const version = generation.current;
    setBusy(true); setError(null);
    const execute = async () => {
      if (version !== generation.current) return false;
      try {
        const result = parseReviewPreferences(await tauriInvoke("code_review_preferences_update", { patch: snapshot }));
        const readback = await readReviewPreferences();
        for (const key of Object.keys(snapshot) as (keyof typeof snapshot)[]) {
          if (readback[key] !== snapshot[key] || result[key] !== snapshot[key]) throw Error("保存后读回不一致");
        }
        if (version !== generation.current) return false;
        if (snapshot.localReviewInstructions === undefined && draftRef.current === preferencesRef.current.localReviewInstructions) {
          setDraft(readback.localReviewInstructions);
        }
        preferencesRef.current = readback;
        setPreferences(readback);
        if (pending.current?.promise === promise) setError(null);
        return true;
      } catch (error) {
        if (version === generation.current && pending.current?.promise === promise) setError(`保存审查偏好失败：${String(error)}`);
        return false;
      } finally {
        if (pending.current?.promise === promise) pending.current = null;
        if (version === generation.current) {
          setBusy(loading.current || pending.current !== null);
          if (changedWhilePending.current && !loading.current && !pending.current) refresh();
        }
      }
    };
    const promise = (previous?.promise ?? Promise.resolve(true)).then(execute);
    pending.current = { patch: identity, promise };
    return promise;
  };
  return { preferences, draft, setDraft, ready, busy, error, syncError, retrySync: () => setSubscriptionAttempt(value => value + 1), load, save };
}
export type CodeReviewPreferencesState = ReturnType<typeof useCodeReviewPreferences>;

export async function runPullRequestReview(
  _request: { title: string; number: number; head_ref_name?: string },
  _start: (value: { kind: "branch"; branch: string; instructions: string }) => Promise<void> | void,
  isCurrent: () => boolean,
) {
  if (!isCurrent()) return;
  throw Error("私人 PR 审查尚未接入选定账号与固定远程提交比较。请使用本地审查入口；此处不会改为审查本地同名分支。");
}

export async function openReviewLink(url: string, showDetails: () => void, isCurrent: () => boolean) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw Error("审查链接必须为无凭据的 HTTPS 地址。");
  const preferences = await readReviewPreferences();
  if (!isCurrent()) return;
  if (preferences.githubLinkTarget === "code-review-tab") return showDetails();
  if (preferences.githubLinkTarget !== "github") throw Error("请在代码审查设置中选择当前支持的链接打开位置。");
  await openWebLink(parsed.href, isCurrent);
}

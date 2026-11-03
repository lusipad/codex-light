import { useEffect, useRef, useState } from "react";
import { tauriInvoke } from "./bridge";

export interface ReviewPreferences {
  githubLinkTarget: string;
  localReviewInstructions: string;
}

export function parseReviewPreferences(value: unknown): ReviewPreferences {
  const data = value as Partial<ReviewPreferences> | null;
  if (!data || typeof data.githubLinkTarget !== "string" || typeof data.localReviewInstructions !== "string") {
    throw Error("审查偏好响应格式无效");
  }
  return { githubLinkTarget: data.githubLinkTarget, localReviewInstructions: data.localReviewInstructions };
}

export async function readReviewPreferences() {
  return parseReviewPreferences(await tauriInvoke("code_review_preferences_get"));
}

export function useCodeReviewPreferences() {
  const [preferences, setPreferences] = useState<ReviewPreferences>({ githubLinkTarget: "code-review-tab", localReviewInstructions: "" });
  const [draft, setDraft] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const load = async () => {
    if (pending.current) return;
    pending.current = true;
    const version = generation.current;
    setBusy(true); setError(null);
    try {
      const value = await readReviewPreferences();
      if (version !== generation.current) return;
      setPreferences(value); setDraft(value.localReviewInstructions); setReady(true);
    } catch (error) {
      if (version === generation.current) { setError(`读取审查偏好失败：${String(error)}`); setReady(false); }
    } finally {
      if (version === generation.current) { pending.current = false; setBusy(false); }
    }
  };
  useEffect(() => {
    void load();
    return () => { generation.current += 1; pending.current = false; };
  }, []);
  const save = async (patch: Partial<ReviewPreferences>) => {
    if (pending.current || !ready) return false;
    pending.current = true;
    const version = generation.current;
    setBusy(true); setError(null);
    try {
      const result = parseReviewPreferences(await tauriInvoke("code_review_preferences_update", { patch }));
      const readback = await readReviewPreferences();
      for (const key of Object.keys(patch) as (keyof ReviewPreferences)[]) {
        if (readback[key] !== patch[key] || result[key] !== patch[key]) throw Error("保存后读回不一致");
      }
      if (version !== generation.current) return false;
      setPreferences(readback);
      return true;
    } catch (error) {
      if (version === generation.current) setError(`保存审查偏好失败：${String(error)}`);
      return false;
    } finally {
      if (version === generation.current) { pending.current = false; setBusy(false); }
    }
  };
  return { preferences, draft, setDraft, ready, busy, error, load, save };
}
export type CodeReviewPreferencesState = ReturnType<typeof useCodeReviewPreferences>;

export async function runPullRequestReview(
  request: { title: string; number: number; head_ref_name?: string },
  start: (value: { kind: "branch"; branch: string; instructions: string }) => Promise<void> | void,
  isCurrent: () => boolean,
) {
  const preferences = await readReviewPreferences();
  if (!isCurrent()) return;
  if (!request.head_ref_name?.trim()) throw Error("Pull Request 缺少源分支，无法启动审查。");
  await start({
    kind: "branch", branch: request.head_ref_name,
    instructions: [`请全面审查 Pull Request #${request.number}: ${request.title}`, preferences.localReviewInstructions].filter(Boolean).join("\n\n"),
  });
}

export async function openReviewLink(url: string, showDetails: () => void, isCurrent: () => boolean) {
  const preferences = await readReviewPreferences();
  if (!isCurrent()) return;
  if (preferences.githubLinkTarget === "code-review-tab") return showDetails();
  if (preferences.githubLinkTarget !== "external-browser") throw Error("请在代码审查设置中选择当前支持的链接打开位置。");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw Error("审查链接必须为 HTTPS。");
  await tauriInvoke("review_link_open", { url: parsed.href });
}

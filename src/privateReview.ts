import { tauriListen } from "./bridge";
import { cancelPrivateReviewRequest, readPrivateReviewPreflight, serviceIdentity } from "./chatgptService";

export interface PrivateReviewProgress {
  reviewId: string;
  state: "starting" | "running" | "unavailable" | "failed" | "cancelled";
  error?: string;
}

export interface PrivateReviewAvailability {
  reviewId: string;
  snapshotId: string;
  commitSha: string | null;
  available: false;
  reason: string;
  missing: string[];
  coverage: "unverified";
  runtime: { modelId: string; disabledPluginIds: string[]; tools: string[] };
}

export async function checkPrivateReviewAvailability(url: string, snapshotId: string, commitSha: string | null, reviewId: string,
  signal: AbortSignal, onProgress: (event: PrivateReviewProgress) => void): Promise<PrivateReviewAvailability> {
  if (signal.aborted) throw Error("检查已取消");
  let submitted = false;
  const cancel = () => { if (submitted) void cancelPrivateReviewRequest(reviewId).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  let stop: (() => void) | undefined;
  try {
    stop = await tauriListen<PrivateReviewProgress>("remote-review-progress", event => {
      if (signal.aborted || event?.reviewId !== reviewId || !["starting", "running", "unavailable", "failed", "cancelled"].includes(event.state) ||
        (event.error !== undefined && typeof event.error !== "string")) return;
      onProgress(event);
    });
    if (signal.aborted) throw Error("检查已取消");
    const identity = await serviceIdentity(signal);
    if (signal.aborted) throw Error("检查已取消");
    submitted = true;
    const response = await readPrivateReviewPreflight(url, snapshotId, commitSha, identity, reviewId) as PrivateReviewAvailability | null;
    if (signal.aborted) throw Error("检查已取消");
    if (!response || response.reviewId !== reviewId || response.snapshotId !== snapshotId || response.commitSha !== commitSha ||
      response.available !== false || response.coverage !== "unverified" || typeof response.reason !== "string" || !response.reason.trim() ||
      !Array.isArray(response.missing) || response.missing.length === 0 || response.missing.some(value => typeof value !== "string" || !value.trim()) ||
      typeof response.runtime?.modelId !== "string" || !response.runtime.modelId || !Array.isArray(response.runtime.disabledPluginIds) ||
      !Array.isArray(response.runtime.tools) || [...response.runtime.disabledPluginIds, ...response.runtime.tools].some(value => typeof value !== "string"))
      throw Error("审查能力响应不完整或不属于当前固定比较。");
    return response;
  } finally { signal.removeEventListener("abort", cancel); stop?.(); }
}

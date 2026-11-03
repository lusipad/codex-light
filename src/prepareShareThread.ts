import { readShareThreadHistory, type ShareThreadHistory } from "./shareThreadHistory";
import {
  buildShareSnapshot, collectShareAssetCandidates,
  type ShareAssetCandidate, type ShareAssetDimension,
} from "./shareSnapshot";
import { serializeRedactedShareSnapshot } from "./shareRedaction";

const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const imageMime = /^image\/(?:png|jpeg|jpg|webp|gif|avif)$/i;

export interface ShareAssetBytes {
  bytes: Uint8Array;
  mimeType: string;
  width?: number;
  height?: number;
}

/** The reader must enforce source permissions, URL safety and bounded streaming. */
export type ShareAssetReader = (
  candidate: ShareAssetCandidate,
  context: { thread: ShareThreadHistory; signal: AbortSignal },
) => Promise<ShareAssetBytes | null>;

export async function prepareShareThread(
  options: { threadId: string; signal: AbortSignal; assertCurrent?: () => void },
  dependencies: {
    request: Parameters<typeof readShareThreadHistory>[1];
    readAsset: ShareAssetReader;
  },
) {
  const collection = new AbortController();
  const signal = AbortSignal.any([options.signal, collection.signal]);
  const checkCurrent = () => {
    if (signal.aborted) throw Error("分享已取消。");
    try { options.assertCurrent?.(); } catch (error) {
      collection.abort();
      throw error;
    }
  };
  const thread = await readShareThreadHistory({ ...options, signal }, dependencies.request);
  checkCurrent();
  const candidates = collectShareAssetCandidates(thread);
  const selected = candidates.slice(-64);
  const metrics = {
    candidateCount: candidates.length, countLimitExcluded: candidates.length - selected.length,
    collectionFailed: 0, individualSizeExcluded: 0, totalSizeExcluded: 0,
  };
  const collected: (ShareAssetBytes | null)[] = selected.map(() => null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => {
    while (next < selected.length) {
      checkCurrent();
      const index = next++, candidate = selected[index];
      let asset: ShareAssetBytes | null;
      try {
        asset = await dependencies.readAsset(candidate, { thread, signal });
      } catch {
        checkCurrent();
        metrics.collectionFailed++;
        continue;
      }
      checkCurrent();
      if (!asset || !ArrayBuffer.isView(asset.bytes) || asset.bytes.BYTES_PER_ELEMENT !== 1 ||
        !(candidate.kind === "visualization" ? asset.mimeType === "application/octet-stream" : imageMime.test(asset.mimeType))) {
        metrics.collectionFailed++;
      } else if (asset.bytes.byteLength > MAX_ASSET_BYTES) {
        metrics.individualSizeExcluded++;
      } else collected[index] = asset;
    }
  }));
  checkCurrent();
  let total = 0;
  for (let index = collected.length - 1; index >= 0; index--) {
    const asset = collected[index];
    if (!asset) continue;
    if (total + asset.bytes.byteLength > MAX_TOTAL_BYTES) {
      collected[index] = null;
      metrics.totalSizeExcluded++;
    } else total += asset.bytes.byteLength;
  }
  const assets: (ShareAssetBytes & { assetId: string })[] = [];
  const references = new Map<string, string>();
  const dimensions: ShareAssetDimension[] = [];
  for (let index = 0; index < collected.length; index++) {
    const asset = collected[index];
    if (!asset) continue;
    const assetId = `asset-${assets.length + 1}`;
    assets.push({ ...asset, assetId });
    references.set(selected[index].source, `codex:shared-asset/${assetId}`);
    if (imageMime.test(asset.mimeType) && Number.isInteger(asset.width) && asset.width! > 0 &&
      Number.isInteger(asset.height) && asset.height! > 0) {
      dimensions.push({ asset_id: assetId, width: asset.width!, height: asset.height! });
    }
  }
  const snapshot = buildShareSnapshot(thread, references, dimensions);
  const serialized = serializeRedactedShareSnapshot(snapshot);
  checkCurrent();
  return {
    threadId: thread.id, ...serialized, assets, metrics,
  };
}

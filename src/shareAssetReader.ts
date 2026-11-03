import { tauriInvoke } from "./bridge";
import { sharedImageUrlSafe, type ServiceIdentity } from "./chatgptService";
import { base64ToBytes } from "./fsClient";
import type { ShareAssetBytes, ShareAssetReader } from "./prepareShareThread";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const imageMime = /^image\/(?:png|jpeg|jpg|webp|gif|avif)$/i;

function decodeImageData(source: string): ShareAssetBytes | null {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif|avif));base64,([A-Za-z0-9+/=\s]*)$/i.exec(source);
  if (!match || match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return null;
  const bytes = base64ToBytes(match[2]);
  return bytes.length && bytes.length <= MAX_IMAGE_BYTES ? { bytes, mimeType: match[1].toLowerCase() } : null;
}

async function imageDimensions(asset: ShareAssetBytes, signal: AbortSignal): Promise<ShareAssetBytes> {
  if (!imageMime.test(asset.mimeType) || typeof createImageBitmap !== "function") return asset;
  let image: ImageBitmap | undefined;
  try {
    image = await createImageBitmap(new Blob([asset.bytes.slice().buffer], { type: asset.mimeType }));
    signal.throwIfAborted();
    return { ...asset, width: image.width, height: image.height };
  } catch {
    signal.throwIfAborted();
    return asset;
  } finally { image?.close(); }
}

async function remoteImage(url: string, signal: AbortSignal): Promise<ShareAssetBytes | null> {
  const response = await fetch(url, { credentials: "omit", redirect: "error", signal });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return null;
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  const declared = response.headers.get("content-length");
  if (!imageMime.test(mimeType) ||
    (declared != null && (!/^\d+$/.test(declared) || Number(declared) > MAX_IMAGE_BYTES))) {
    await response.body.cancel();
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) return null;
      chunks.push(value);
    }
    if (!size) return null;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { bytes, mimeType };
  } finally {
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
}

export function createShareAssetReader(identity: ServiceIdentity): ShareAssetReader {
  return async (candidate, { thread, signal }) => {
    signal.throwIfAborted();
    let asset: ShareAssetBytes | null;
    if (candidate.kind === "image" && /^data:/i.test(candidate.source)) {
      asset = decodeImageData(candidate.source);
    } else if (candidate.kind === "image" && /^https?:\/\//i.test(candidate.source)) {
      if (!await sharedImageUrlSafe(candidate.source, identity, signal)) return null;
      signal.throwIfAborted();
      asset = await remoteImage(candidate.source, signal);
    } else {
      // The host obtains roots from this actual thread; renderer cwd is never authority.
      const result = await tauriInvoke<{ dataBase64: string; mimeType: string } | null>("share_thread_asset_read", {
        expectedIdentity: identity, hostId: "local", threadId: thread.id,
        kind: candidate.kind, source: candidate.source,
      });
      signal.throwIfAborted();
      if (!result || typeof result.dataBase64 !== "string" || typeof result.mimeType !== "string" ||
        result.dataBase64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return null;
      asset = { bytes: base64ToBytes(result.dataBase64), mimeType: result.mimeType };
    }
    signal.throwIfAborted();
    return asset ? imageDimensions(asset, signal) : null;
  };
}

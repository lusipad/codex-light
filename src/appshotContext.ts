/** A dedicated attachment context, not an extra app-server turn parameter.
 * Capture IDs belong to the local attachment wrapper, not this serialized data.
 * Sources: fixed 26.1111 evsE/OoLr/LnAF and ordered user-input history parser.
 */
export interface AppshotContext {
  appName: string;
  bundleIdentifier: string;
  windowTitle: string | null;
  axTree: string;
  imagePath: string | null;
  imageName: string | null;
  imageDataUrl?: string | null;
  transitionSnapshotDataUrl?: string | null;
  transitionSnapshotHeight?: number | null;
  appIconDataUrl?: string | null;
}

/** Local draft identity only; never spread this wrapper into a turn request. */
export interface DraftAppshot {
  id: string;
  context: AppshotContext;
  /** Local attachment provenance only; never part of the serialized context. */
  capture?: { scope: string; generation: number; order?: number };
}

/** Original target metadata plus the actual completed capture. A missing image
 * is a failed capture, even when accessibility text was returned. */
export function capturedAppshotContext(capture: {
  appName: string;
  bundleIdentifier: string;
  windowTitle: string | null;
  axTree: string | null;
  imageDataUrl: string | null;
}, requestedAt: string): AppshotContext | null {
  if (!capture.imageDataUrl) return null;
  const axTree = capture.axTree ?? "";
  const title = /^Window:\s*"(.*)",\s*App:/.exec(axTree)?.[1]?.trim();
  const name = capture.appName.replaceAll("/", "-").replaceAll(":", "-").replace(/\s+/g, " ").trim() || "App";
  const extension = capture.imageDataUrl.startsWith("data:image/jpeg;") ? "jpg" : "png";
  return {
    appName: capture.appName,
    bundleIdentifier: capture.bundleIdentifier,
    windowTitle: title || capture.windowTitle?.trim() || null,
    axTree,
    imagePath: null,
    imageName: `${name} Appshot ${requestedAt.replaceAll(":", "-")}.${extension}`,
    imageDataUrl: capture.imageDataUrl,
    transitionSnapshotDataUrl: null,
    transitionSnapshotHeight: null,
    appIconDataUrl: null,
  };
}

export const APP_SHOT_REQUEST_DELIMITER = "## My request:";

export type AppshotImageInput = { type: "image"; url: string } | { type: "localImage"; path: string };

const escapeAttribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const decodeAttribute = (value: string) => value.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const decodeBody = (value: string) => value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

/** Only the appshot block; shared prompt headings/separators are caller-owned. */
export function serializeAppshotContext(context: AppshotContext): string {
  const attributes = [`app="${escapeAttribute(context.appName)}"`, `bundle-identifier="${escapeAttribute(context.bundleIdentifier)}"`];
  const title = context.windowTitle?.trim();
  if (title) attributes.push(`window-title="${escapeAttribute(title)}"`);
  const image = context.imageName ?? context.imagePath;
  if (image != null) attributes.push(`image="${escapeAttribute(image)}"`);
  const body = context.axTree.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return [`<appshot ${attributes.join(" ")}>`, body, "</appshot>"].join("\n");
}

/** The appshot-only portion of yJfM.Y. Merge with other proven context sections
 * before the shared `## My request:` separator; never append it to user input.
 */
export function serializeAppshotPromptContext(contexts: readonly AppshotContext[]): string {
  return contexts.length ? "\n# Applications mentioned by the user:\n" + contexts.map(context => `\n${serializeAppshotContext(context)}\n`).join("") : "";
}

/** Plain-prompt, no-messageSender branch of F/Y. Selected-text transformation,
 * other context sections and remote upload Composer routing are caller-owned.
 * Without appshots preserve the existing application sender's exact semantics.
 */
export function buildAppshotPrompt(prompt: string, contexts: readonly AppshotContext[]): string {
  return contexts.length ? `${serializeAppshotPromptContext(contexts)}\n${APP_SHOT_REQUEST_DELIMITER}\n${prompt}\n` : prompt;
}

/** Extract known history contexts without stripping or rewriting user text.
 * The source accepts an opening-tag-only form and trims the AX body on read.
 * This is the fixed appshot grammar, not a general XML/HTML parser.
 */
export function parseAppshotContexts(text: string): AppshotContext[] {
  const tags = /<appshot\b([^>]*)>([\s\S]*?)<\/appshot>|<appshot\b([^>]*)>/g;
  const contexts: AppshotContext[] = [];
  for (const match of text.matchAll(tags)) {
    const attributes = new Map<string, string>();
    for (const attribute of (match[1] ?? match[3] ?? "").matchAll(/([A-Za-z][A-Za-z0-9-]*)="([^"]*)"/g)) {
      attributes.set(attribute[1], decodeAttribute(attribute[2] ?? ""));
    }
    const appName = attributes.get("app"), bundleIdentifier = attributes.get("bundle-identifier");
    const axTree = decodeBody((match[2] ?? "").trim()), image = attributes.get("image");
    if (appName == null || bundleIdentifier == null || !appName.trim() || !bundleIdentifier.trim() || !axTree.length && !image?.trim()) continue;
    contexts.push({ appName, bundleIdentifier, windowTitle: attributes.get("window-title") ?? null,
      axTree, imagePath: image ?? null, imageName: image ?? null });
  }
  return contexts;
}

/** Remove only recognized blocks, preserving every other user-text byte.
 * This does not establish provenance or image ownership: callers with unknown
 * image classification must retain the original message instead of binding it.
 */
export function extractAppshotContexts(text: string): { text: string; appshots: AppshotContext[] } {
  const appshots: AppshotContext[] = [];
  const remaining = text.replace(/<appshot\b([^>]*)>([\s\S]*?)<\/appshot>|<appshot\b([^>]*)>/g, block => {
    const context = parseAppshotContexts(block)[0];
    if (!context) return block;
    appshots.push(context);
    return "";
  });
  return { text: remaining, appshots };
}

/** Only appshot image items; preserve ordinary/MCP/comment ordering in the caller.
 * URL/path ownership must be validated by the host before constructing contexts.
 */
export function appshotImageInputs(contexts: readonly AppshotContext[], isRemoteHost = false): AppshotImageInput[] {
  return contexts.flatMap<AppshotImageInput>(context => {
    const source = context.imageDataUrl ?? context.imagePath;
    if (source == null) return [];
    if (!isRemoteHost && context.imagePath) return [{ type: "localImage" as const, path: context.imagePath }];
    if (/^data:image\//i.test(source)) return [{ type: "image" as const, url: source }];
    let path = source;
    if (source.startsWith("file://")) {
      try { path = decodeURIComponent(source.replace(/^file:\/\//i, "")); }
      catch { path = source; }
    }
    return [{ type: "localImage" as const, path }];
  });
}

/** Codex input-history ordering only. ChatGPT metadata/name/asset binding is a
 * separate producer and must not call this with an unordered asset collection.
 */
export function bindAppshotImages(contexts: readonly AppshotContext[], imageUrls: readonly string[], commentImageCount = 0): {
  nonAppshotImageUrls: string[];
  appshotContextsWithImageSources: AppshotContext[];
} {
  if (!contexts.length || !imageUrls.length) return { nonAppshotImageUrls: [...imageUrls], appshotContextsWithImageSources: [...contexts] };
  const count = Math.min(contexts.length, imageUrls.length);
  const start = Math.max(imageUrls.length - commentImageCount - count, 0);
  const sources = imageUrls.slice(start, start + count);
  return { nonAppshotImageUrls: [...imageUrls.slice(0, start), ...imageUrls.slice(start + count)],
    appshotContextsWithImageSources: contexts.map((context, index) => {
      const source = sources[index];
      if (source == null) return context;
      // The history image is authoritative. The source's independent spread
      // updates can leave a tag's display name as localPath (or an old dataURL),
      // which the image-input encoder would then prefer on resend.
      return /^data:image\//i.test(source) ? { ...context, imagePath: null, imageDataUrl: source }
        : { ...context, imagePath: source, imageDataUrl: null };
    }) };
}

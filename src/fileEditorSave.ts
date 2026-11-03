import { readFileBytes, writeFileText } from "./fsClient";

export type FileEditorSaveResult = "saved" | "conflict" | "obsolete";

/**
 * Content preflight and readback, not an atomic compare-and-swap.
 * A failed write may already have taken effect: never retry through another backend.
 */
export async function saveFileEditorSnapshot(
  path: string,
  baseContent: string,
  content: string,
  isCurrent: () => boolean,
): Promise<FileEditorSaveResult> {
  const read = async () => new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(await readFileBytes(path));
  const disk = await read();
  if (!isCurrent()) return "obsolete";
  // Also recovers an earlier write whose acknowledgement/readback failed.
  if (disk === content) return "saved";
  if (disk !== baseContent) return "conflict";
  await writeFileText(path, content);
  const written = await read();
  if (!isCurrent()) return "obsolete";
  if (written !== content) return "conflict";
  return "saved";
}

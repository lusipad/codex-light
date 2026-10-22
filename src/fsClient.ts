/**
 * fsClient.ts — app-server `fs/*` protocol client.
 *
 * Wraps the Codex app-server filesystem protocol (codex-cli 0.159.x):
 *   fs/readDirectory, fs/readFile, fs/writeFile, fs/createDirectory,
 *   fs/remove, fs/copy, fs/getMetadata, fs/watch, fs/unwatch
 * plus UTF-8/base64 codecs, cross-platform path helpers and a
 * self-cleaning `watchPath()` helper driven by the `fs/changed`
 * notification (`app-server:notification` Tauri event).
 *
 * Every protocol call rejects on failure so callers can fall back to the
 * legacy local Tauri commands (`fs_list_dir` / `fs_read_preview` /
 * `fs_write_file`) when app-server is offline or the method is rejected.
 *
 * Verified against a real app-server:
 *  - `fs/readFile` → `{ dataBase64 }` (standard base64, no data: prefix)
 *  - `fs/writeFile` params `{ path, dataBase64 }`
 *  - `fs/readDirectory` → `{ entries: [{ fileName, isDirectory, isFile }] }`
 *    (no size/mtime; callers may use fs/getMetadata when they need it)
 *  - `fs/copy` silently overwrites an existing destination, so callers must
 *    check the destination first (see `renamePath`).
 *  - `fs/watch` watches only the immediate path (non-recursive) and returns
 *    `{ path }` (canonicalized); `fs/changed` params are
 *    `{ watchId, changedPaths: string[] }` with absolute paths.
 */
import { callAppServer, tauriListen } from "./bridge";
import { NOTIFICATION } from "./protocol";

/* ------------------------------------------------------------------ */
/* Protocol payload types                                               */
/* ------------------------------------------------------------------ */

/** One direct child entry returned by `fs/readDirectory`. */
export interface FsDirectoryEntry {
  fileName: string;
  isDirectory: boolean;
  isFile: boolean;
}

/** Response of `fs/readFile`. */
export interface FsReadFileResponse {
  dataBase64: string;
}

/** Response of `fs/getMetadata`. */
export interface FsMetadata {
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  createdAtMs: number;
  modifiedAtMs: number;
}

/** Payload of an `fs/changed` server notification. */
export interface FsChangedEvent {
  watchId: string;
  changedPaths: string[];
  /** Wall-clock time the client received the notification. */
  receivedAt: number;
}

export type FsChangedListener = (event: FsChangedEvent) => void;

/** Idempotent teardown returned by {@link watchPath}. */
export type FsUnwatch = () => Promise<void>;

export interface FsRemoveOptions {
  /** Recurse into directories. Defaults to `true` (protocol default). */
  recursive?: boolean;
  /** Ignore missing paths. Defaults to `true` (protocol default). */
  force?: boolean;
}

export interface FsCopyOptions {
  /** Required for directory copies. Defaults to `false`. */
  recursive?: boolean;
}

/* ------------------------------------------------------------------ */
/* Base64 / UTF-8 codecs                                               */
/* ------------------------------------------------------------------ */

/** Encode raw bytes as standard base64 (chunked to avoid call-stack limits). */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/** Decode standard base64 into raw bytes. Throws on malformed input. */
export function base64ToBytes(dataBase64: string): Uint8Array {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** UTF-8 text → standard base64 (what `fs/writeFile` expects). */
export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

/** Standard base64 → UTF-8 text (BOM is stripped by TextDecoder). */
export function base64ToUtf8(dataBase64: string): string {
  return new TextDecoder("utf-8").decode(base64ToBytes(dataBase64));
}

/**
 * Heuristic binary sniff: a NUL byte inside the first `checkBytes` bytes
 * (same heuristic the legacy Rust `fs_read_preview` uses).
 */
export function isBinaryBytes(bytes: Uint8Array, checkBytes = 8192): boolean {
  const limit = Math.min(bytes.length, checkBytes);
  for (let i = 0; i < limit; i += 1) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Cross-platform path helpers                                         */
/* ------------------------------------------------------------------ */

function separatorFor(pathValue: string): "\\" | "/" {
  if (/^[a-zA-Z]:/.test(pathValue) || pathValue.includes("\\")) return "\\";
  return "/";
}

function lastSeparatorIndex(pathValue: string): number {
  return Math.max(pathValue.lastIndexOf("\\"), pathValue.lastIndexOf("/"));
}

/** Join a directory path and a direct child name, preserving separator style. */
export function joinFsPath(dir: string, name: string): string {
  const trimmed = dir.replace(/[\\/]+$/, "");
  const sep = separatorFor(dir);
  if (!trimmed) return `${sep}${name}`;
  return `${trimmed}${sep}${name}`;
}

/** Parent directory of a path; drive roots keep their trailing separator. */
export function parentFsPath(pathValue: string): string {
  const trimmed = pathValue.replace(/[\\/]+$/, "");
  if (!trimmed) return pathValue;
  const index = lastSeparatorIndex(trimmed);
  if (index < 0) return trimmed;
  const parent = trimmed.slice(0, index);
  if (!parent) return trimmed.slice(0, 1);
  return /^[a-zA-Z]:$/.test(parent) ? `${parent}\\` : parent;
}

/** Final path segment (file or directory name). */
export function baseNameFsPath(pathValue: string): string {
  const trimmed = pathValue.replace(/[\\/]+$/, "");
  const index = lastSeparatorIndex(trimmed);
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

/* ------------------------------------------------------------------ */
/* Protocol calls                                                      */
/* ------------------------------------------------------------------ */

function assertDirectoryResponse(
  res: unknown
): FsDirectoryEntry[] {
  const entries = (res as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) {
    throw new Error("fs/readDirectory: response is missing `entries`");
  }
  return entries
    .filter(
      (entry): entry is FsDirectoryEntry =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as FsDirectoryEntry).fileName === "string"
    )
    .map((entry) => ({
      fileName: entry.fileName,
      isDirectory: Boolean(entry.isDirectory),
      isFile: Boolean(entry.isFile),
    }));
}

function assertReadFileResponse(res: unknown): string {
  const dataBase64 = (res as { dataBase64?: unknown } | null)?.dataBase64;
  if (typeof dataBase64 !== "string") {
    throw new Error("fs/readFile: response is missing `dataBase64`");
  }
  return dataBase64;
}

/** `fs/readDirectory` → direct child entries (no size/mtime fields). */
export async function readDirectory(path: string): Promise<FsDirectoryEntry[]> {
  const res = await callAppServer<{ entries: FsDirectoryEntry[] }>(
    "fs/readDirectory",
    { path }
  );
  return assertDirectoryResponse(res);
}

/** `fs/readFile` → raw base64 payload. */
export async function readFileBase64(path: string): Promise<string> {
  const res = await callAppServer<FsReadFileResponse>("fs/readFile", { path });
  return assertReadFileResponse(res);
}

/** `fs/readFile` → raw bytes. */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  return base64ToBytes(await readFileBase64(path));
}

/** `fs/readFile` → UTF-8 text. */
export async function readFileText(path: string): Promise<string> {
  return base64ToUtf8(await readFileBase64(path));
}

/** `fs/writeFile` from a base64 payload. */
export async function writeFileBase64(
  path: string,
  dataBase64: string
): Promise<void> {
  await callAppServer("fs/writeFile", { path, dataBase64 });
}

/** `fs/writeFile` from UTF-8 text. */
export async function writeFileText(path: string, text: string): Promise<void> {
  await writeFileBase64(path, utf8ToBase64(text));
}

/** `fs/createDirectory` (recursive by default). */
export async function createDirectory(
  path: string,
  recursive = true
): Promise<void> {
  await callAppServer("fs/createDirectory", { path, recursive });
}

/** Remove a file or directory tree. */
export async function removePath(
  path: string,
  options: FsRemoveOptions = {}
): Promise<void> {
  const params: Record<string, unknown> = { path };
  if (options.recursive !== undefined) params.recursive = options.recursive;
  if (options.force !== undefined) params.force = options.force;
  await callAppServer("fs/remove", params);
}

/** Copy a file or directory tree. Note: overwrites an existing destination. */
export async function copyPath(
  sourcePath: string,
  destinationPath: string,
  options: FsCopyOptions = {}
): Promise<void> {
  const params: Record<string, unknown> = { sourcePath, destinationPath };
  if (options.recursive !== undefined) params.recursive = options.recursive;
  await callAppServer("fs/copy", params);
}

/** `fs/getMetadata`; rejects when the path does not exist. */
export async function getMetadata(path: string): Promise<FsMetadata> {
  return callAppServer<FsMetadata>("fs/getMetadata", { path });
}

/** `fs/unwatch` a previously started watch id. */
export async function unwatch(watchId: string): Promise<void> {
  await callAppServer("fs/unwatch", { watchId });
}

/**
 * `fs/copy` + `fs/remove` composition (the protocol has no fs/rename).
 * Callers must ensure `destinationPath` does not exist: `fs/copy`
 * overwrites silently.
 */
export async function renamePath(
  sourcePath: string,
  destinationPath: string
): Promise<void> {
  if (sourcePath === destinationPath) return;
  const meta = await getMetadata(sourcePath);
  await copyPath(sourcePath, destinationPath, {
    recursive: meta.isDirectory,
  });
  await removePath(sourcePath, {
    recursive: meta.isDirectory,
    force: false,
  });
}

/* ------------------------------------------------------------------ */
/* fs/watch                                                            */
/* ------------------------------------------------------------------ */

let watchSequence = 0;

function createWatchId(): string {
  watchSequence += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `ui-fs-watch-${Date.now().toString(36)}-${watchSequence}-${random}`;
}

/**
 * Start watching an absolute path and invoke `onChange` for every
 * `fs/changed` notification whose `watchId` matches this watch.
 *
 * Watches are **non-recursive**: each directory level needs its own watch.
 * Resolves to an idempotent `unwatch` function that removes the Tauri event
 * listener and calls `fs/unwatch`. Errors from the teardown itself are only
 * logged (cleanup must stay safe), while a failed `fs/watch` rejects.
 */
export async function watchPath(
  path: string,
  onChange: FsChangedListener
): Promise<FsUnwatch> {
  const watchId = createWatchId();
  let disposed = false;
  let unlisten: (() => void) | null = null;

  // Subscribe before fs/watch so no event can fall through the gap.
  unlisten = await tauriListen<{ method?: string; params?: any }>(
    "app-server:notification",
    (payload) => {
      if (disposed) return;
      if (!payload || payload.method !== NOTIFICATION.FS_CHANGED) return;
      const params = payload.params || {};
      if (params.watchId !== watchId) return;
      const changedPaths: string[] = Array.isArray(params.changedPaths)
        ? params.changedPaths.filter(
            (p: unknown): p is string => typeof p === "string"
          )
        : [];
      try {
        onChange({ watchId, changedPaths, receivedAt: Date.now() });
      } catch (err) {
        console.warn("fs/watch onChange handler failed:", err);
      }
    }
  );

  try {
    await callAppServer("fs/watch", { path, watchId });
  } catch (err) {
    disposed = true;
    try {
      unlisten();
    } catch {
      /* ignore teardown failures */
    }
    unlisten = null;
    throw err;
  }

  let teardown: Promise<void> | null = null;
  const stop: FsUnwatch = () => {
    if (teardown) return teardown;
    disposed = true;
    teardown = (async () => {
      if (unlisten) {
        try {
          unlisten();
        } catch (err) {
          console.warn("fs/watch listener cleanup failed:", err);
        }
        unlisten = null;
      }
      try {
        await unwatch(watchId);
      } catch (err) {
        console.warn("fs/unwatch failed:", err);
      }
    })();
    return teardown;
  };

  return stop;
}

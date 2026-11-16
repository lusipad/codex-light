import { callAppServer } from "./bridge";
import { AttachedFileItem } from "./types";

interface ThreadAttachmentRecord {
  id: string;
  attachmentType: string;
  identityKey: string;
  createdAt: number;
  payload?: {
    path?: unknown;
    name?: unknown;
  } | null;
}

interface ThreadAttachmentListResponse {
  data?: ThreadAttachmentRecord[];
  nextCursor?: string | null;
}

export interface AttachmentPersistFailure {
  file: AttachedFileItem;
  message: string;
}

export function attachmentTypeForFile(file: AttachedFileItem): "file" | "image" {
  return file.attachmentType ?? (file.kind === "image" ? "image" : "file");
}

export function attachmentIdentityKey(pathValue: string): string {
  const trimmed = pathValue.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const windowsPath = /^[a-zA-Z]:[\\/]/.test(pathValue) || pathValue.startsWith("\\\\");
  return windowsPath ? trimmed.toLowerCase() : trimmed;
}

export function isImageAttachmentPath(pathValue: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(pathValue);
}

export function createAttachedFileItem(
  pathValue: string,
  name?: string,
  kind?: AttachedFileItem["kind"]
): AttachedFileItem {
  const resolvedKind = kind ?? (isImageAttachmentPath(pathValue) ? "image" : "file");
  return {
    id: attachmentIdentityKey(pathValue),
    name: name || pathValue.split(/[/\\]/).pop() || pathValue,
    path: pathValue,
    kind: resolvedKind,
    attachmentType: resolvedKind === "image" ? "image" : "file",
  };
}

export function mergeAttachmentItems(
  current: AttachedFileItem[],
  additions: AttachedFileItem[]
): AttachedFileItem[] {
  const merged = new Map<string, AttachedFileItem>();
  for (const file of current) merged.set(attachmentIdentityKey(file.path), file);
  for (const file of additions) {
    const key = attachmentIdentityKey(file.path);
    const previous = merged.get(key);
    merged.set(key, previous
      ? { ...file, persisted: previous.persisted, createdAt: previous.createdAt }
      : file);
  }
  return Array.from(merged.values());
}

function mapAttachmentRecord(record: ThreadAttachmentRecord): AttachedFileItem | null {
  const path = typeof record.payload?.path === "string" ? record.payload.path : null;
  if (!path) return null;
  const name = typeof record.payload?.name === "string"
    ? record.payload.name
    : path.split(/[/\\]/).pop() || path;
  const kind = record.attachmentType === "image" || record.attachmentType === "localImage"
    ? "image"
    : "file";
  return {
    id: record.identityKey,
    name,
    path,
    kind,
    attachmentType: kind === "image" ? "image" : "file",
    persisted: true,
    createdAt: record.createdAt,
  };
}

export async function listThreadAttachments(threadId: string): Promise<AttachedFileItem[]> {
  const files: AttachedFileItem[] = [];
  let cursor: string | null = null;
  do {
    const response: ThreadAttachmentListResponse = await callAppServer("thread/attachment/list", {
      threadId,
      cursor,
      limit: 100,
    });
    for (const record of response.data ?? []) {
      const file = mapAttachmentRecord(record);
      if (file) files.push(file);
    }
    cursor = response.nextCursor ?? null;
  } while (cursor);
  return files;
}

export async function persistThreadAttachments(
  threadId: string,
  files: AttachedFileItem[]
): Promise<{ attachments: AttachedFileItem[]; errors: AttachmentPersistFailure[] }> {
  const attachments: AttachedFileItem[] = [];
  const errors: AttachmentPersistFailure[] = [];
  for (const file of files) {
    if (file.imageDataUrl) {
      attachments.push(file);
      continue;
    }
    try {
      const response = await callAppServer<{
        attachment: ThreadAttachmentRecord;
        outcome: "created" | "existing";
      }>("thread/attachment/add", {
        threadId,
        attachmentType: attachmentTypeForFile(file),
        identityKey: attachmentIdentityKey(file.path),
        payload: { path: file.path, name: file.name },
      });
      attachments.push(
        mapAttachmentRecord(response.attachment) ?? {
          ...file,
          persisted: true,
        }
      );
    } catch (error) {
      errors.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { attachments, errors };
}

export async function removeThreadAttachment(
  threadId: string,
  file: AttachedFileItem
): Promise<void> {
  await callAppServer("thread/attachment/remove", {
    threadId,
    attachmentType: attachmentTypeForFile(file),
    identityKey: attachmentIdentityKey(file.path),
  });
}

import { readChatgptService, type ServiceIdentity } from "./chatgptService";

export interface StorageUsage {
  usedBytes: number;
  allowedBytes: number;
  remainingBytes: number;
  isOverLimit: boolean;
  limitTier: string | null;
  planType: string | null;
}

export function parseStorageUsage(value: unknown): StorageUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("无法确认云端存储配额，请重新读取。");
  const data = value as Record<string, unknown>;
  const bytes = (key: string, negative = false): number => {
    const result = data[key];
    if (typeof result !== "number" || !Number.isFinite(result) || (!negative && result < 0))
      throw Error("云端存储配额数据不完整，请重新读取。");
    return result;
  };
  const plan = (key: string): string | null => {
    const result = data[key];
    if (result == null) return null;
    if (typeof result !== "string" || !result.trim()) throw Error("云端存储套餐数据不完整，请重新读取。");
    return result;
  };
  if (typeof data.is_over_limit !== "boolean") throw Error("云端存储配额数据不完整，请重新读取。");
  return {
    usedBytes: bytes("used_bytes"), allowedBytes: bytes("allowed_bytes"),
    // The official fullness consumer accepts remaining_bytes <= 0, including overage.
    remainingBytes: bytes("remaining_bytes", true), isOverLimit: data.is_over_limit,
    limitTier: plan("limit_tier"), planType: plan("plan_type"),
  };
}

export function storageFullness(usage: StorageUsage): "full" | "almostFull" | "normal" {
  if (usage.isOverLimit || usage.remainingBytes <= 0) return "full";
  if (usage.allowedBytes > 0 && usage.remainingBytes / usage.allowedBytes <= .1) return "almostFull";
  return "normal";
}

export async function readStorageUsage(identity: ServiceIdentity, signal: AbortSignal): Promise<StorageUsage> {
  return parseStorageUsage(await readChatgptService("storage_usage", {}, identity, signal));
}

export function formatStorageBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes, unit = 0;
  while (Math.abs(value) >= 1024 && unit < units.length - 1) { value /= 1024; ++unit; }
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value)} ${units[unit]}`;
}

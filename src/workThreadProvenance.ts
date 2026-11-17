import { tauriInvoke } from "./bridge";
import type { ServiceIdentity } from "./chatgptService";

export interface WorkThreadProvenance {
  threadId: string; accountId: string; userId: string; hostIdentity: string;
  serviceName: "codex_work_desktop" | null;
}
const key = (id: string) => `codex-native-work-thread:${id}`;
const known = new Map<string, WorkThreadProvenance>();
function parse(raw: unknown, threadId: string): WorkThreadProvenance {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw Error("Work 会话来源记录无效，未切换为普通聊天。");
  const value = raw as Record<string, unknown>;
  if (value.threadId !== threadId || ![value.accountId, value.userId, value.hostIdentity].every(item => typeof item === "string" && item.length > 0)
    || value.serviceName !== null && value.serviceName !== "codex_work_desktop") throw Error("Work 会话来源记录无效，未切换为普通聊天。");
  return { threadId, accountId: value.accountId as string, userId: value.userId as string,
    hostIdentity: value.hostIdentity as string, serviceName: value.serviceName };
}
/** Internal provenance only, never invented app-server metadata. Read errors
 * cannot be treated as proof that an existing Work thread is ordinary Codex. */
export async function readWorkThreadProvenance(threadId: string): Promise<WorkThreadProvenance | null> {
  let raw: unknown;
  try { raw = await tauriInvoke("desktop_state_get", { key: key(threadId) }); }
  catch (error) { if (known.has(threadId)) return { ...known.get(threadId)! }; throw error; }
  if (raw == null) return known.has(threadId) ? { ...known.get(threadId)! } : null;
  const value = parse(raw, threadId);
  known.set(threadId, value);
  return { ...value };
}
export function assertWorkThreadOwner(value: WorkThreadProvenance, identity: ServiceIdentity, hostIdentity: string): void {
  if (value.userId !== identity.userId || value.accountId !== identity.accountId || value.hostIdentity !== hostIdentity) throw Error("Work 会话所属账号或执行宿主已变化。");
}
export async function persistWorkThreadProvenance(threadId: string, identity: ServiceIdentity, hostIdentity: string,
  serviceName: "codex_work_desktop" | null,
): Promise<void> {
  const value = parse({ threadId, accountId: identity.accountId, userId: identity.userId, hostIdentity, serviceName }, threadId);
  // The server has already acknowledged this ID. A failed disk write must not
  // make it ordinary within this process; durable confirmation still reads IPC.
  known.set(threadId, value);
  await tauriInvoke("desktop_state_set", { key: key(threadId), value });
  const confirmed = parse(await tauriInvoke("desktop_state_get", { key: key(threadId) }), threadId);
  if (JSON.stringify(confirmed) !== JSON.stringify(value)) throw Error("Work 会话来源尚未保存，输入已保留。");
}

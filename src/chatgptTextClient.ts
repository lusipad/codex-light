import { Channel } from "@tauri-apps/api/core";
import { tauriInvoke } from "./bridge";
import { serviceIdentity, type ServiceIdentity } from "./chatgptService";
import { collectChatgptRequirementsEnvironment, createChatgptRequirementsKey } from "./chatgptRequirements";
import type { createChatgptTextRequest } from "./chatgptMessages";
import type { ChatgptStreamFrame } from "./chatgptStreamState";

const sameIdentity = (a: ServiceIdentity, b: ServiceIdentity) => a.accountId === b.accountId
  && a.userId === b.userId && a.generation === b.generation;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Observed context, not an official identity or attestation. The Chat device
 * key belongs to the source conversation surface, independently of other APIs. */
function chatProfile() {
  const browser = (navigator as Navigator & { userAgentData?: {
    brands: { brand: string; version: string }[]; platform: string;
  } }).userAgentData;
  if (!browser?.brands?.length || !browser.platform) throw Error("无法读取 ChatGPT 浏览器上下文。");
  let deviceId: string | null = null;
  try { deviceId = localStorage.getItem("codex.chatgpt-conversations.device-id"); } catch { /* Source persistence is best effort. */ }
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    try { localStorage.setItem("codex.chatgpt-conversations.device-id", deviceId); } catch { /* Keep the actual generated value. */ }
  }
  return { language: "zh-CN", deviceId, userAgent: navigator.userAgent,
    userAgentClientHints: browser.brands.map(item => `${JSON.stringify(item.brand)};v=${JSON.stringify(item.version)}`).join(", "),
    platformClientHint: JSON.stringify(browser.platform) };
}

export interface ChatgptTextReceipt {
  requestId: string; identity: ServiceIdentity; status: "transport-complete"; eventCount: number;
}
interface ChatgptTextFailureReceipt {
  requestId: string; identity: ServiceIdentity; status: "transport-error"; eventCount: number;
  error: { code: string; message: string; status?: number | null };
}

/** Per-request channel; no global listener, ordinary CLI fallback or paid retry.
 * The receiver owns business decoding and request/draft admission. */
export async function submitChatgptText(input: {
  identity: ServiceIdentity; body: ReturnType<typeof createChatgptTextRequest>;
  signal: AbortSignal; onFrame: (frame: ChatgptStreamFrame) => void;
}): Promise<ChatgptTextReceipt> {
  const identity = { ...input.identity }, signal = input.signal, body = structuredClone(input.body);
  signal.throwIfAborted();
  if (!sameIdentity(identity, await serviceIdentity(signal))) throw Error("ChatGPT 账号已变化。");
  signal.throwIfAborted();
  const profile = chatProfile(), requirementsKey = createChatgptRequirementsKey(collectChatgptRequirementsEnvironment());
  const requestId = crypto.randomUUID();
  let alive = true, sequence = 0, streamError: unknown = null, expectedCount: number | null = null;
  let wake: (() => void) | null = null;
  const cancel = () => { void tauriInvoke("chatgpt_service_cancel", { requestId }).catch(() => {}); wake?.(); };
  const channel = new Channel<unknown>(packet => {
    if (!alive || signal.aborted || streamError !== null) return;
    try {
      if (!record(packet) || packet.requestId !== requestId || !record(packet.identity)
        || !sameIdentity(identity, packet.identity as unknown as ServiceIdentity)
        || !Number.isSafeInteger(packet.sequence) || packet.sequence !== sequence + 1
        || expectedCount !== null && sequence >= expectedCount
        || typeof packet.event !== "string" || typeof packet.data !== "string" || typeof packet.id !== "string") {
        throw Error("ChatGPT 流作用域或顺序无法确认。");
      }
      sequence++;
      input.onFrame({ event: packet.event, data: packet.data, id: packet.id });
    } catch (error) { streamError = error; cancel(); }
    if (streamError !== null || expectedCount !== null && sequence >= expectedCount) wake?.();
  });
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    const result = await tauriInvoke<ChatgptTextReceipt | ChatgptTextFailureReceipt>("chatgpt_text_submit", {
      onFrame: channel, request: { requestId, expectedIdentity: identity, profile, requirementsKey, body },
    });
    signal.throwIfAborted();
    if (streamError !== null) throw streamError;
    if (!record(result) || result.requestId !== requestId || !record(result.identity)
      || !sameIdentity(identity, result.identity as unknown as ServiceIdentity)
      || !["transport-complete", "transport-error"].includes(result.status) || !Number.isSafeInteger(result.eventCount)
      || result.status === "transport-error" && (!record(result.error) || typeof result.error.code !== "string" || typeof result.error.message !== "string")
      || result.eventCount < sequence) throw Error("ChatGPT 流返回了未确认的回执。");
    expectedCount = result.eventCount;
    if (sequence < expectedCount) {
      // Command resolution and Channel delivery are distinct IPC queues. This
      // local deadline detects a lost IPC tail, never manufactures model text.
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(Error("ChatGPT 流尾部传递超时，结果尚未确认。")), 30_000);
        wake = () => { window.clearTimeout(timeout); wake = null; resolve(); };
        if (signal.aborted || streamError !== null || sequence >= expectedCount!) wake();
      });
    }
    signal.throwIfAborted();
    if (streamError !== null) throw streamError;
    if (sequence !== expectedCount) throw Error("ChatGPT 流尾部尚未完整传递。");
    if (result.status === "transport-error") throw result.error;
    if (!sameIdentity(identity, await serviceIdentity(signal))) throw Error("ChatGPT 流结束时账号已变化。");
    signal.throwIfAborted();
    if (streamError !== null) throw streamError;
    if (sequence !== expectedCount) throw Error("ChatGPT 流的最终顺序已变化。");
    return result;
  } catch (error) {
    cancel();
    throw streamError ?? error;
  } finally {
    alive = false; wake = null;
    signal.removeEventListener("abort", cancel);
    channel.onmessage = () => {};
  }
}

export async function stopChatgptText(principal: ServiceIdentity, conversationId: string, signal: AbortSignal): Promise<void> {
  const identity = { ...principal };
  signal.throwIfAborted();
  if (!sameIdentity(identity, await serviceIdentity(signal))) throw Error("ChatGPT 账号已变化。");
  signal.throwIfAborted();
  const requestId = crypto.randomUUID(), cancel = () => { void tauriInvoke("chatgpt_service_cancel", { requestId }).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const result = await tauriInvoke<unknown>("chatgpt_text_stop", { request: {
      requestId, expectedIdentity: { ...identity }, profile: chatProfile(), conversationId,
    } });
    signal.throwIfAborted();
    if (!record(result) || result.requestId !== requestId || !record(result.identity)
      || !sameIdentity(identity, result.identity as unknown as ServiceIdentity) || result.status !== "accepted") throw Error("ChatGPT 停止请求尚未确认。");
    if (!sameIdentity(identity, await serviceIdentity(signal))) throw Error("ChatGPT 停止请求期间账号已变化。");
    signal.throwIfAborted();
  } finally { signal.removeEventListener("abort", cancel); }
}

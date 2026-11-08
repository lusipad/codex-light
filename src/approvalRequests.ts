import type { PendingServerRequest } from "./types";

export function pendingRequestKey(request: Pick<PendingServerRequest, "id" | "generation">): string {
  return `${request.generation}:${typeof request.id}:${request.id}`;
}

export function requestThreadId(request: PendingServerRequest): string | undefined {
  return request.params?.threadId ?? request.params?.thread_id ?? request.params?.conversationId;
}

export function requestsForThread(requests: PendingServerRequest[], threadId: string | null): PendingServerRequest[] {
  return threadId ? requests.filter(request => requestThreadId(request) === threadId) : [];
}

export function fileChangeApprovalForItem(requests: PendingServerRequest[], turnId: string, itemId: string | undefined): PendingServerRequest | undefined {
  if (!itemId) return undefined;
  return requests.find(request => request.method === "item/fileChange/requestApproval"
    && request.params?.turnId === turnId && request.params?.itemId === itemId);
}

export interface RequestResponseState {
  sending?: boolean;
  error?: string;
}

import type { ThreadSummary } from "./types";
import { isThreadReadState } from "./protocol";

export function threadNeedsAttention(thread: ThreadSummary): boolean {
  const status = thread.status;
  const type = typeof status === "string" ? status : status?.type;
  const flags = typeof status === "object" && status ? status.activeFlags ?? [] : [];
  return (isThreadReadState(thread.readState) && thread.readState.firstUnread != null) ||
    type === "waitingOnApproval" || type === "waitingOnUserInput" ||
    flags.includes("waitingOnApproval") || flags.includes("waitingOnUserInput");
}

export function threadHasActivity(thread: ThreadSummary): boolean {
  const type = typeof thread.status === "string" ? thread.status : thread.status?.type;
  return threadNeedsAttention(thread) || type === "active" || type === "running";
}

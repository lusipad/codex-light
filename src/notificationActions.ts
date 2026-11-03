import { commandApprovalResponse, fileChangeApprovalResponse } from "./protocol";
import type { PendingServerRequest } from "./types";

// app-runtime-e4b4e09bd942.js EU: native action titles are literal English.
export function notificationApprovalActions(request: PendingServerRequest) {
  if (!request.notificationNonce || !["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(request.method)) return undefined;
  return [{ id: "approve", title: "Approve" }, { id: "approve-for-session", title: "Approve for session" },
    { id: "decline", title: "Decline" }];
}

export function notificationApprovalResponse(request: PendingServerRequest, action: string) {
  if (request.responseDeliveryUnknown) return null;
  const decision = action === "approve" ? "accept" : action === "approve-for-session" ? "acceptForSession" : action === "decline" ? "decline" : null;
  if (!decision) return null;
  if (request.method === "item/commandExecution/requestApproval") return commandApprovalResponse(decision);
  if (request.method === "item/fileChange/requestApproval") return fileChangeApprovalResponse(decision);
  return null;
}

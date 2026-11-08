import { readCloudService, type ServiceIdentity } from "./chatgptService";
import { parseCloudDetail, type CloudDetail } from "./cloudEnvironmentService";

type Account = Pick<ServiceIdentity, "accountId" | "userId">;
export interface CloudDraftBinding extends Account {
  configId: string;
  draftId: string | null;
  environmentId: string;
  name: string;
  repositoryNamesById: Record<string, string>;
}

const key = "environment-setup-server-configs-v1";

function bindingFrom(value: unknown): CloudDraftBinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { accountId, userId, configId, draftId, environmentId, name, repositoryNamesById } = value as CloudDraftBinding;
  if (![accountId, userId, configId, environmentId].every(id => typeof id === "string" && id.length > 0)
    || (draftId !== null && (typeof draftId !== "string" || !draftId))
    || typeof name !== "string" || !repositoryNamesById || typeof repositoryNamesById !== "object"
    || Array.isArray(repositoryNamesById) || Object.values(repositoryNamesById).some(name => typeof name !== "string")) return null;
  return { accountId, userId, configId, draftId, environmentId, name, repositoryNamesById };
}

function bindings(): Map<string, CloudDraftBinding> {
  const entries = new Map<string, CloudDraftBinding>();
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      for (const [threadId, value] of Object.entries(stored).slice(-100)) {
        const binding = bindingFrom(value);
        if (threadId && binding) entries.set(threadId, binding);
      }
    }
  } catch { /* Missing or unreadable storage has no recoverable bindings. */ }
  return entries;
}

function sameAccount(binding: Account, identity: Account): boolean {
  return binding.accountId === identity.accountId && binding.userId === identity.userId;
}

export function readCloudDraftBinding(threadId: string, identity: Account): CloudDraftBinding | null {
  const binding = bindings().get(threadId);
  return binding && sameAccount(binding, identity) ? binding : null;
}

export function listCloudDraftBindings(configId: string, identity: Account) {
  return [...bindings()].reverse().filter(([, binding]) => binding.configId === configId && sameAccount(binding, identity));
}

// Store only confirmed receipts. Generation is checked by the active operation, not persisted.
export function rememberCloudDraftBinding(threadId: string, value: CloudDraftBinding): boolean {
  const binding = bindingFrom(value);
  if (!threadId || !binding) return false;
  const current = bindings();
  current.delete(threadId);
  current.set(threadId, binding);
  try {
    localStorage.setItem(key, JSON.stringify(Object.fromEntries([...current].slice(-100))));
    return true;
  } catch { return false; }
}

export async function readBoundCloudDraft(binding: CloudDraftBinding, identity: ServiceIdentity, signal: AbortSignal): Promise<CloudDetail> {
  signal.throwIfAborted();
  if (!sameAccount(binding, identity)) throw Error("环境草稿与当前账号不匹配。");
  const value = await (binding.draftId
    ? readCloudService("draft", { id: binding.configId, draftId: binding.draftId }, identity, signal)
    : readCloudService("detail", { id: binding.configId }, identity, signal));
  signal.throwIfAborted();
  return parseCloudDetail(value, binding.configId, binding.draftId ?? undefined);
}

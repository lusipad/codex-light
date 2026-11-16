import { accountRead } from "./config";
import { readChatgptService, readRemotePluginDirectoryList, serviceIdentity, type ServiceIdentity, type PluginDirectoryListKind } from "./chatgptService";
import { selectedServiceAccount } from "./serviceAccounts";
import { mergePluginDirectoryEntries, parsePluginDirectoryEntries, type PluginDirectoryEntry, type PluginDirectoryEntrySource } from "./pluginDirectoryEntries";

export type PluginDirectoryAccount = { kind: "unauthenticated" } | {
  kind: "ready"; identity: ServiceIdentity; structure: "personal" | "workspace"; name: string | null;
};
type ReadyAccount = Extract<PluginDirectoryAccount, { kind: "ready" }>;
export interface PluginDirectoryOriginPage { entries: PluginDirectoryEntry[]; nextCursor: string | null }
export interface PluginDirectoryCreatedCursor { userPageToken: string | null; workspaceCreatedPageToken: string | null }
export interface PluginDirectoryCreatedPage { entries: PluginDirectoryEntry[]; nextCursor: PluginDirectoryCreatedCursor | null }

const current = (signal: AbortSignal) => { if (signal.aborted) throw Error("请求已取消"); };
const changed = () => Error("读取期间账号发生变化，请重新刷新。");
const sameIdentity = (a: ServiceIdentity, b: ServiceIdentity) =>
  a.accountId === b.accountId && a.userId === b.userId && a.generation === b.generation;

async function verifyIdentity(identity: ServiceIdentity, signal: AbortSignal): Promise<void> {
  current(signal);
  const [account, actual] = await Promise.all([accountRead(), serviceIdentity(signal)]);
  current(signal);
  if (account.account?.type !== "chatgpt" || !sameIdentity(identity, actual) ||
      (account.workspaceRouting?.chatgptAccountId && account.workspaceRouting.chatgptAccountId !== identity.accountId)) throw changed();
}

export async function loadPluginDirectoryAccount(signal: AbortSignal): Promise<PluginDirectoryAccount> {
  current(signal);
  const account = await accountRead();
  current(signal);
  if (account.account?.type !== "chatgpt") return { kind: "unauthenticated" };
  const identity = await serviceIdentity(signal);
  current(signal);
  if (account.workspaceRouting?.chatgptAccountId && account.workspaceRouting.chatgptAccountId !== identity.accountId) throw changed();
  const selected = selectedServiceAccount(await readChatgptService("share_accounts", {}, identity, signal), identity.accountId);
  current(signal);
  if (selected.account.is_deactivated === true || selected.can_access_with_session === false) throw Error("当前账号无法访问插件目录。");
  const name = selected.account.name;
  if (name != null && typeof name !== "string") throw Error("无法识别当前工作空间名称。");
  await verifyIdentity(identity, signal);
  return { kind: "ready", identity, structure: selected.account.structure, name: typeof name === "string" ? name.trim() || null : null };
}

const sources: Record<PluginDirectoryListKind, PluginDirectoryEntrySource> = {
  workspace: "workspace", personal: "user", created: "workspace-created", shared: "workspace-shared",
};

async function readPage(account: ReadyAccount, kind: PluginDirectoryListKind, limit: 9 | 50, cursor: string | null, signal: AbortSignal): Promise<PluginDirectoryOriginPage> {
  current(signal);
  if (kind !== "personal" && account.structure !== "workspace") throw Error("当前账号不支持此工作空间插件来源。");
  const page = await readRemotePluginDirectoryList(account.identity, kind, limit, cursor, signal);
  current(signal);
  return { entries: parsePluginDirectoryEntries(page.plugins, sources[kind]), nextCursor: page.nextCursor };
}

/** Personal/created here are homepage summaries, never substitutes for complete Created pagination. */
export async function readPluginDirectoryOriginPage(
  account: ReadyAccount, kind: PluginDirectoryListKind, cursor: string | null, signal: AbortSignal,
): Promise<PluginDirectoryOriginPage> {
  const summary = kind === "personal" || kind === "created";
  if (summary && cursor !== null) throw Error("插件首页摘要不支持分页，请打开完整分类。");
  await verifyIdentity(account.identity, signal);
  const page = await readPage(account, kind, summary ? 9 : 50, cursor, signal);
  await verifyIdentity(account.identity, signal);
  return { entries: page.entries, nextCursor: summary ? null : page.nextCursor };
}

/** null means initial fetch; within a cursor, null means that individual stream has ended. */
export async function readPluginDirectoryCreatedPage(
  account: ReadyAccount, cursor: PluginDirectoryCreatedCursor | null, signal: AbortSignal,
): Promise<PluginDirectoryCreatedPage> {
  await verifyIdentity(account.identity, signal);
  const user = cursor === null || cursor.userPageToken !== null;
  const workspace = account.structure === "workspace" && (cursor === null || cursor.workspaceCreatedPageToken !== null);
  const [createdPage, userPage] = await Promise.all([
    workspace ? readPage(account, "created", 50, cursor?.workspaceCreatedPageToken ?? null, signal) : null,
    user ? readPage(account, "personal", 50, cursor?.userPageToken ?? null, signal) : null,
  ]);
  current(signal);
  await verifyIdentity(account.identity, signal);
  const nextCursor = { userPageToken: userPage?.nextCursor ?? null, workspaceCreatedPageToken: createdPage?.nextCursor ?? null };
  return {
    entries: mergePluginDirectoryEntries([createdPage?.entries ?? [], userPage?.entries ?? []]),
    nextCursor: nextCursor.userPageToken !== null || nextCursor.workspaceCreatedPageToken !== null ? nextCursor : null,
  };
}

export async function loadPluginDirectoryPersonalSummary(account: ReadyAccount, signal: AbortSignal): Promise<{
  created: PluginDirectoryEntry[]; shared: PluginDirectoryOriginPage | null;
}> {
  await verifyIdentity(account.identity, signal);
  const [created, user, shared] = await Promise.all([
    account.structure === "workspace" ? readPage(account, "created", 9, null, signal) : null,
    readPage(account, "personal", 9, null, signal),
    account.structure === "workspace" ? readPage(account, "shared", 50, null, signal) : null,
  ]);
  current(signal);
  await verifyIdentity(account.identity, signal);
  return { created: mergePluginDirectoryEntries([created?.entries ?? [], user.entries]), shared };
}

export function mergePluginDirectoryOriginPages(pages: readonly (readonly PluginDirectoryEntry[])[], kind: PluginDirectoryListKind): PluginDirectoryEntry[] {
  return mergePluginDirectoryEntries(pages, { hideReferencedTemplates: kind === "workspace" });
}

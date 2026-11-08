import { useRef, useState } from "react";
import { useArchiveReadLifecycle } from "./archiveReadLifecycle";
import { readCloudRecentChats, sameCloudRecentIdentity, type CloudRecentChat } from "./cloudRecentChats";
import { serviceErrorMessage, serviceIdentity, type ServiceIdentity } from "./chatgptService";
import { accountRead } from "./config";

interface Snapshot {
  items: (CloudRecentChat & { id: string })[];
  identity: ServiceIdentity | null;
  status: "signed_out" | "unsupported_auth" | "loading" | "ready" | "error";
  error: string | null;
}

export interface ArchivedDurableChatsState extends Snapshot {
  readVersion: number;
  reload: () => void;
  retryListeners: () => void;
  isCurrentIdentity: (identity: ServiceIdentity) => boolean;
  canUnarchive: (id: string, identity: ServiceIdentity) => boolean;
  forgetAccepted: (id: string, identity: ServiceIdentity) => boolean;
}

const empty = (status: Snapshot["status"] = "signed_out", error: string | null = null): Snapshot =>
  ({ items: [], identity: null, status, error });

export function useArchivedDurableChats({ enabled, scope, connected }: {
  enabled: boolean; scope: string; connected: boolean;
}): ArchivedDurableChatsState {
  const [view, setView] = useState({ scope, snapshot: empty() });
  const snapshot = useRef(view.snapshot);
  const request = useRef<AbortController | null>(null);
  const readVersion = useRef(0);
  const latestRead = useRef<(version: number) => void>(() => {});
  const publish = (next: Snapshot) => { snapshot.current = next; setView({ scope, snapshot: next }); };
  const abort = () => { request.current?.abort(); request.current = null; };
  const { epoch, valid, retryListeners } = useArchiveReadLifecycle({ enabled, scope, connected,
    onReset: disconnected => {
      abort();
      publish(disconnected ? empty("error", "连接已断开。") : empty(enabled ? "loading" : "signed_out"));
    },
    onReady: version => latestRead.current(version),
    onListenerError: () => publish(empty("error", "无法监听账号更新。")),
    onCleanup: abort,
  });
  const renderEpoch = epoch.current;
  const read = async (version: number) => {
    if (!valid(version, scope) || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const { signal } = controller;
    const active = () => !signal.aborted && valid(version, scope);
    publish({ ...snapshot.current, status: "loading", error: null });
    try {
      const account = await accountRead();
      if (!active()) return;
      if (account.account?.type !== "chatgpt") {
        publish(empty(account.account ? "unsupported_auth" : "signed_out"));
        return;
      }
      const identity = await serviceIdentity(signal);
      if (!active()) return;
      const expected = account.workspaceRouting?.chatgptAccountId;
      if (expected && expected !== identity.accountId) throw Object.assign(Error("云端账号已更改。"), { code: "account_changed" });
      if (snapshot.current.identity && !sameCloudRecentIdentity(snapshot.current.identity, identity)) publish(empty("loading"));
      const items = await readCloudRecentChats(identity, signal, true);
      if (!active()) return;
      readVersion.current++;
      publish({ items: items.map(chat => ({ ...chat, id: chat.session.threadId })), identity, status: "ready", error: null });
    } catch (cause) {
      if (!active()) return;
      const code = (cause as { code?: string } | null)?.code;
      const error = serviceErrorMessage(cause);
      publish(code === "account_changed" || code === "not_logged_in" || code?.startsWith("auth_")
        ? empty("error", error) : { ...snapshot.current, status: "error", error });
    } finally {
      if (request.current === controller) request.current = null;
    }
  };
  latestRead.current = version => void read(version);
  const isCurrentIdentity = (identity: ServiceIdentity) =>
    valid(renderEpoch, scope) && sameCloudRecentIdentity(snapshot.current.identity ?? undefined, identity);
  return {
    ...(!enabled ? empty() : !connected ? empty("error", "连接已断开。") : view.scope === scope ? view.snapshot : empty("loading")),
    readVersion: readVersion.current, reload: () => void read(renderEpoch), retryListeners, isCurrentIdentity,
    canUnarchive: (id, identity) => isCurrentIdentity(identity) && snapshot.current.status === "ready" &&
      snapshot.current.items.some(chat => chat.session.threadId === id),
    forgetAccepted: (id, identity) => {
      if (!isCurrentIdentity(identity)) return false;
      abort();
      publish({ ...snapshot.current, items: snapshot.current.items.filter(chat => chat.session.threadId !== id) });
      return true;
    },
  };
}

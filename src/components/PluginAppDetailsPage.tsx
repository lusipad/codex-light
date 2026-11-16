import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { pluginAppAccountNickname, pluginAppProfileIdentity, selectPluginAppLinks, type PluginAppLink } from "../pluginAppDetails";
import { persistPluginAppSelection, pluginAppAccountsPresentation } from "../pluginAppAccounts";
import { usePluginAppDetails } from "../pluginAppDetailsState";
import { PluginAccountRenameDialog } from "./PluginAccountRenameDialog";
import { PluginAccountMenu } from "./PluginAccountMenu";
import "./PluginManagementDetail.css";
import "./PluginAppDetailsPage.css";

interface PluginAppDetailsPageProps {
  connectionIdentity: string;
  pluginId: string;
  appId: string;
  onBack: () => void;
  onOpenPlugin: () => void;
  onUnavailable: () => void;
  selectedLinkId: string | null;
  onSelectLink: (linkId: string | null, expectedLinkId?: string) => boolean;
  onRenamed?: () => void;
  onDisconnected?: () => void;
}

function accountIdentity(link: PluginAppLink, appName: string): string {
  return pluginAppProfileIdentity(link) || (appName
    ? link.auth_type === "NONE" ? `${appName}（未关联账户）` : `${appName} 账户`
    : "账户");
}

export function PluginAppDetailsPage({ connectionIdentity, pluginId, appId, onBack, onOpenPlugin, onUnavailable, selectedLinkId, onSelectLink, onRenamed, onDisconnected }: PluginAppDetailsPageProps) {
  const { state, reload, rename, disconnect, clearRenameError } = usePluginAppDetails(connectionIdentity, pluginId, appId);
  const unavailable = useRef(onUnavailable); unavailable.current = onUnavailable;
  useEffect(() => { if (state.unavailable) unavailable.current(); }, [state.unavailable]);
  const accountsId = useId(), details = state.snapshot?.details;
  const scope = JSON.stringify([connectionIdentity, pluginId, appId]);
  const current = useRef({ scope, version: 0, mounted: false, state });
  const version = current.current.version + (current.current.scope === scope ? 0 : 1);
  current.current = { scope, version, mounted: current.current.mounted, state };
  const active = () => current.current.mounted && current.current.scope === scope && current.current.version === version;
  const sequence = useRef(0);
  const [renaming, setRenaming] = useState<{ scope: string; version: number; linkId: string; token: number } | null>(null);
  const disconnectAttempt = useRef<{ scope: string; version: number; linkId: string; running: boolean } | null>(null);
  useLayoutEffect(() => {
    current.current.mounted = true;
    return () => { current.current.mounted = false; };
  }, [scope]);
  useLayoutEffect(() => {
    const snapshot = state.snapshot;
    if (!active() || !snapshot) return;
    try { persistPluginAppSelection(snapshot.identity, snapshot.details.connector.id, selectedLinkId); }
    catch (error) { console.warn("无法保存账户选择。", error); }
  }, [scope, state.snapshot?.identity.accountId, state.snapshot?.identity.userId, details?.connector.id, selectedLinkId]);
  const title = details?.connector.name ?? "";
  const selected = details?.links ? selectPluginAppLinks(details, selectedLinkId) : null;
  const accounts = selected?.accounts ?? [];
  // The shared account section consumes its explicit selection even when the
  // surrounding single-account detail keeps its own first-link fallback.
  const selectedAccountId = accounts.find(link => link.id === selectedLinkId)?.id ?? selected?.selectedLink?.id;
  const presentation = details ? pluginAppAccountsPresentation(details, accounts) : { visible: false, canRename: false };
  const pending = state.pendingLinkId != null;
  const selectLink = (linkId: string) => {
    if (!active() || current.current.state.pendingLinkId != null) return false;
    const snapshot = current.current.state.snapshot;
    if (!snapshot?.details.links || !selectPluginAppLinks(snapshot.details, null).accounts.some(link => link.id === linkId)) return false;
    if (!onSelectLink(linkId)) return false;
    try { persistPluginAppSelection(snapshot.identity, snapshot.details.connector.id, linkId); }
    catch (error) { console.warn("无法保存账户选择。", error); }
    return true;
  };
  const openRename = (linkId: string) => {
    const actual = current.current.state, snapshot = actual.snapshot;
    if (!active() || actual.loading || actual.blocked || actual.pendingLinkId != null || !snapshot?.details.links) return;
    const matches = selectPluginAppLinks(snapshot.details, null).accounts;
    if (!pluginAppAccountsPresentation(snapshot.details, matches).canRename || matches.filter(link => link.id === linkId).length !== 1) return;
    if (!selectLink(linkId)) return;
    clearRenameError();
    setRenaming({ scope, version, linkId, token: ++sequence.current });
  };
  const selection = renaming?.scope === scope && renaming.version === version ? renaming : null;
  const renameLink = selection ? accounts.find(link => link.id === selection.linkId) : undefined;
  const finishDisconnect = (snapshot: NonNullable<typeof state.snapshot>, linkId: string) => {
    const remaining = selectPluginAppLinks(snapshot.details, null).accounts;
    const next = remaining.find(link => link.auth_status !== "REAUTH_REQUIRED")?.id ?? remaining[0]?.id ?? null;
    // The parent checks the live URL, including changes occurring before React
    // commits the selection made immediately before DELETE.
    if (onSelectLink(next, linkId)) {
      try { persistPluginAppSelection(snapshot.identity, snapshot.details.connector.id, next); }
      catch (error) { console.warn("无法保存账户选择。", error); }
    }
    onDisconnected?.();
  };
  const disconnectAccount = async (linkId: string) => {
    const actual = current.current.state, attempt = disconnectAttempt.current;
    if (!active() || selection || actual.loading || actual.blocked || actual.pendingLinkId != null ||
      attempt?.scope === scope && attempt.version === version && attempt.running) return;
    const operation = { scope, version, linkId, running: true };
    disconnectAttempt.current = operation;
    if (!selectLink(linkId)) { disconnectAttempt.current = null; return; }
    let snapshot;
    try { snapshot = await disconnect(linkId); }
    finally { operation.running = false; }
    if (!active() || disconnectAttempt.current !== operation) return;
    if (snapshot?.details.links != null && !snapshot.details.links.some(link => link.id === linkId)) {
      disconnectAttempt.current = null;
      finishDisconnect(snapshot, linkId);
    }
  };
  useEffect(() => {
    const attempt = disconnectAttempt.current, snapshot = state.snapshot;
    if (!active() || !attempt || attempt.scope !== scope || attempt.version !== version) return;
    if (!state.loading && !pending && !state.blocked && state.writeError) { disconnectAttempt.current = null; return; }
    if (attempt.running ||
      state.loading || pending || state.blocked || state.error || state.writeError || snapshot?.details.links == null) return;
    disconnectAttempt.current = null;
    if (!snapshot.details.links.some(link => link.id === attempt.linkId)) finishDisconnect(snapshot, attempt.linkId);
  }, [scope, state.snapshot, state.loading, state.blocked, state.error, state.writeError, pending]);
  const closeRename = () => {
    // The dialog owns pending dismissal. A confirmed save can finish before
    // React commits the render clearing pendingLinkId.
    if (!active() || !selection) return;
    setRenaming(value => value?.token === selection.token ? null : value);
    clearRenameError();
  };
  const retry = () => { void reload(); };
  return <article className="pmd-detail" aria-busy={state.loading || pending}>
    <nav className="pmd-breadcrumb" aria-label="面包屑导航">
      <button type="button" onClick={onBack}>插件设置</button>
      {details && <><span aria-hidden="true">/</span><button type="button" onClick={onOpenPlugin}>{details.pluginName}</button>
        <span aria-hidden="true">/</span><span aria-current="page">{title}</span></>}
    </nav>
    {details && <header className="pmd-header"><div className="pmd-heading">
      <h1>{title}</h1>
      {details.connector.description && <p className="pmd-description">{details.connector.description}</p>}
    </div></header>}
    {state.loading && !details && <p role="status">正在加载…</p>}
    {(state.error || state.writeError) && <div role="alert"><p>{state.writeError || state.error}</p>
      <button type="button" className="secondary-btn-sm" disabled={state.loading || pending} onClick={retry}>重试</button>
    </div>}
    {details?.linksError && <div role="alert"><p>无法加载已连接的帐户</p>
      <button type="button" className="secondary-btn-sm" disabled={state.loading} onClick={retry}>重试</button>
    </div>}
    {accounts.length > 0 && presentation.visible && <section id={`plugin-connected-accounts-${details!.appId}`} className="pap-accounts" aria-labelledby={accountsId}>
      <h2 id={accountsId}>已连接的账户</h2>
      <div className="pap-account-list">{accounts.map((link, index) => {
        const identity = accountIdentity(link, title.trim());
        const nickname = pluginAppAccountNickname(link, title);
        const rowId = `${accountsId}-${index}`, warningId = link.auth_status === "REAUTH_REQUIRED" ? `${rowId}-warning` : undefined;
        const copy = <span className="pap-account-copy">
            <span className="pap-account-identity" title={identity}>{identity}</span>
            {nickname && nickname !== identity && <span id={`${rowId}-nickname`} className="pap-account-nickname" title={nickname}>{nickname}</span>}
          </span>;
        return <div className="pap-account" key={link.id}>
          {presentation.canRename ? <button type="button" className="pap-account-open" disabled={state.loading || pending || state.blocked}
            aria-label={`重命名 ${identity}${nickname && nickname !== identity ? `（${nickname}）` : ""}`} onClick={() => openRename(link.id)}>{copy}</button>
            : details?.connector.enable_multi_links !== true && accounts.length > 1 ? <button type="button" className="pap-account-open"
              id={`${rowId}-select`} disabled={pending} aria-label={`选择 ${identity}`}
              aria-labelledby={nickname && nickname !== identity ? `${rowId}-select ${rowId}-nickname` : undefined}
              aria-describedby={warningId} aria-pressed={selectedAccountId === link.id} onClick={() => selectLink(link.id)}>{copy}</button>
            : <div className="pap-account-readonly" role="group" aria-label={identity} aria-describedby={warningId}>{copy}</div>}
          {warningId && <span id={warningId} className="sr-only">需要更新身份验证</span>}
          <PluginAccountMenu identity={JSON.stringify([scope, version])} linkId={link.id} accountName={identity} nickname={nickname}
            pending={state.loading || pending || state.blocked || selection !== null}
            disconnecting={state.pendingAction === "disconnect" && state.pendingLinkId === link.id}
            onRename={presentation.canRename ? () => openRename(link.id) : null} onDisconnect={() => disconnectAccount(link.id)} />
        </div>;
      })}</div>
    </section>}
    {selection && renameLink && <PluginAccountRenameDialog key={JSON.stringify([scope, selection.linkId, selection.token])}
      identity={JSON.stringify([scope, selection.token])} linkId={renameLink.id} accountIdentity={accountIdentity(renameLink, title.trim())}
      initialNickname={pluginAppAccountNickname(renameLink, title) ?? ""} currentName={renameLink.name ?? ""}
      pending={pending || state.loading} blocked={state.blocked} error={state.writeError || state.error}
      onClose={closeRename} onRetry={reload} onSave={async name => {
        const confirmed = await rename(renameLink.id, name);
        if (!confirmed || !active()) return false;
        onRenamed?.(); return true;
      }} />}
  </article>;
}

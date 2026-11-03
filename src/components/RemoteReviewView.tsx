import React, { useEffect, useRef, useState } from "react";
import { tauriListen } from "../bridge";
import { readRemotePullRequest, serviceIdentity } from "../chatgptService";
import { parseRemotePullRequestUrl, type RemotePullRequest } from "../remoteReview";
import { openWebLink } from "../webLinks";
import { MarkdownView } from "./MarkdownView";
import { PinnedReviewChanges } from "./PinnedReviewChanges";
import "./CodeReviewView.css";
import "./RemoteReviewView.css";

export function RemoteReviewView({ url, scope, onOpenUrl, onBack }: {
  url: string; scope: string; onOpenUrl: (url: string) => void; onBack: () => void;
}) {
  const [draft, setDraft] = useState(url);
  const [snapshot, setSnapshot] = useState<{ url: string; scope: string; value: RemotePullRequest } | null>(null);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const current = useRef({ url, scope });
  current.current = { url, scope };
  const epoch = useRef(0);
  const operation = useRef<AbortController | null>(null);
  const value = snapshot?.url === url && snapshot.scope === scope ? snapshot.value : null;
  useEffect(() => { setDraft(url); }, [url]);
  useEffect(() => {
    let alive = true;
    const listeners: (() => void)[] = [];
    const valid = (ticket: number) => alive && current.current.scope === scope && current.current.url === url && epoch.current === ticket;
    const load = async () => {
      if (!alive || current.current.scope !== scope || current.current.url !== url) return;
      const ticket = ++epoch.current;
      operation.current?.abort();
      const controller = new AbortController();
      operation.current = controller;
      setSnapshot(null); setError(""); setBusy(!!url);
      if (!url) return;
      try {
        const identity = await serviceIdentity(controller.signal);
        if (!valid(ticket)) return;
        const next = await readRemotePullRequest(url, identity, controller.signal);
        if (valid(ticket)) setSnapshot({ url, scope, value: next });
      } catch (cause) {
        if (valid(ticket)) setError(String(cause));
      } finally {
        if (valid(ticket)) setBusy(false);
      }
    };
    const register = async (name: string, handler: (payload: any) => void) => {
      try {
        const stop = await tauriListen(name, handler);
        if (alive) listeners.push(stop); else stop();
      } catch (cause) {
        if (alive && current.current.scope === scope && current.current.url === url) setSyncError(`无法订阅代码审查状态：${String(cause)}`);
      }
    };
    setSyncError("");
    void Promise.all([
      register("code-review-provider-preferences-changed", () => { void load(); }),
      register("app-server:notification", payload => { if (payload?.method === "account/updated") void load(); }),
      register("app-server:status", () => { void load(); }),
    ]).then(() => { if (alive) void load(); });
    return () => { alive = false; ++epoch.current; operation.current?.abort(); listeners.forEach(stop => stop()); };
  }, [url, scope, retry]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const target = parseRemotePullRequestUrl(draft);
      setDraft(target.url);
      if (target.url === url) { if (!busy) setRetry(value => value + 1); }
      else onOpenUrl(target.url);
    } catch (cause) { setError(String(cause)); }
  };
  const openExternal = async () => {
    const ticket = epoch.current;
    const valid = () => current.current.scope === scope && current.current.url === url && epoch.current === ticket;
    try { await openWebLink(parseRemotePullRequestUrl(url).url, valid); }
    catch (cause) { if (valid()) setError(String(cause)); }
  };

  return <section className="code-review-view remote-review-view" aria-label="代码审查">
    <header className="review-header">
      <div className="review-header-left"><button type="button" className="review-back-btn" onClick={onBack}>返回</button>
        <h2 className="review-title">代码审查</h2></div>
      {url && <button type="button" className="secondary-btn-sm" onClick={() => void openExternal()}>在浏览器中打开</button>}
    </header>
    <form onSubmit={submit} className="remote-review-url-form">
      <label className="form-field"><span>GitHub Pull Request</span><input type="text" inputMode="url" autoCapitalize="none" spellCheck={false} aria-label="Pull Request 链接"
        value={draft} placeholder="https://github.com/owner/repository/pull/123" onChange={event => setDraft(event.target.value)} /></label>
      <button type="submit" className="primary-btn" disabled={!draft.trim()}>打开 Pull Request</button>
    </form>
    {syncError && <p role="alert" className="error-banner">{syncError} <button type="button" className="secondary-btn-sm"
      onClick={() => setRetry(value => value + 1)}>重试同步</button></p>}
    {error && <p role="alert" className="error-banner">{error} {url && <button type="button" className="secondary-btn-sm" disabled={busy}
      onClick={() => setRetry(value => value + 1)}>重新读取</button>}</p>}
    {busy && <p role="status">正在读取所选账号和 Pull Request…</p>}
    {!url && <p role="status">打开 Pull Request 后查看描述和更改。</p>}
    {value && <>
      <header className="remote-review-summary">
        <p>{value.pullRequest.owner}/{value.pullRequest.repository} · PR #{value.pullRequest.number}</p>
        {value.summary.title !== null && <h3>{value.summary.title}</h3>}
        <p>{({ open: "Open", closed: "Closed", merged: "Merged" } as const)[value.summary.state]}
          {value.summary.isDraft === true ? " · Draft" : ""} · {value.account.hostname} / {value.account.login}</p>
        {(value.summary.baseBranch !== null || value.summary.headBranch !== null) &&
          <p>{value.summary.headBranch ?? "—"} → {value.summary.baseBranch ?? "—"}</p>}
        <p>{value.metadata.changedFiles ?? "—"} files · +{value.metadata.additions ?? "—"} −{value.metadata.deletions ?? "—"}</p>
      </header>
      <section className="card-section" aria-label="Pull Request 描述">
        <MarkdownView content={value.description} remoteContent />
      </section>
      <PinnedReviewChanges url={url} scope={scope} />
    </>}
  </section>;
}

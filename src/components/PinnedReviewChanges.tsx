import React, { useEffect, useRef, useState } from "react";
import { readPinnedReviewComparison, serviceIdentity } from "../chatgptService";
import type { PinnedReviewComparison } from "../remoteReview";
import { PrivateReviewPanel } from "./PrivateReviewPanel";
import { RemoteRevisionFiles } from "./RemoteRevisionFiles";

export function PinnedReviewChanges({ url, scope }: { url: string; scope: string }) {
  const [loaded, setLoaded] = useState<{ url: string; scope: string; commitSha: string | null; value: PinnedReviewComparison } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const operation = useRef<AbortController | null>(null);
  const current = useRef({ url, scope });
  current.current = { url, scope };
  const selected = loaded?.url === url && loaded.scope === scope ? loaded : null;
  const load = async (refresh: boolean, commitSha: string | null = null) => {
    const ticket = ++epoch.current;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    const valid = () => !controller.signal.aborted && epoch.current === ticket && current.current.url === url && current.current.scope === scope;
    setBusy(true); setError("");
    try {
      const identity = await serviceIdentity(controller.signal);
      if (!valid()) return;
      const value = await readPinnedReviewComparison(url, identity, controller.signal, refresh ? null : selected?.value.snapshotId ?? null, commitSha);
      if (valid()) setLoaded({ url, scope, commitSha, value });
    } catch (cause) {
      if (valid()) {
        setError(String(cause));
        const failure = cause as { code?: string; status?: number } | null;
        const code = failure?.code ?? /^([a-z][a-z0-9_]*):/i.exec(String(cause))?.[1] ?? "";
        if (failure?.status === 401 || failure?.status === 403 ||
          /account|identity|connection|provider|reauth|resource_not_found|snapshot_unavailable|gate|unauthorized|forbidden|ip_not_authorized/i.test(code) ||
          /账号|授权|权限|实例|GitHub 连接/.test(String(cause))) setLoaded(null);
      }
    } finally { if (valid()) setBusy(false); }
  };
  useEffect(() => {
    setLoaded(null);
    void load(true);
    return () => { ++epoch.current; operation.current?.abort(); };
  }, [url, scope]);

  const value = selected?.value;
  return <><section className="card-section" aria-label="Pull Request 固定提交差异">
    <div className="remote-review-comparison-header">
      <h3>Changes</h3>
      {value && <label className="form-field"><span className="sr-only">比较来源</span>
        <select aria-label="比较来源" disabled={busy} value={selected.commitSha ?? ""}
          onChange={event => void load(false, event.target.value || null)}>
          <option value="">All PR changes</option>
          {value.snapshot.commits?.map(commit => <option key={commit.sha} value={commit.sha} disabled={commit.parentSha === null}>
            {commit.sha.slice(0, 7)} {commit.title}
          </option>)}
        </select></label>}
      <button type="button" className="secondary-btn-sm" disabled={busy} onClick={() => void load(true)}>{value ? "刷新" : "重新读取差异"}</button>
    </div>
    {busy && <p role="status">正在读取固定提交比较…</p>}
    {error && <p role="alert" className="error-banner">{error}</p>}
    {value && <>
      <p className="remote-review-revision">{value.comparison.baseRevision} → {value.comparison.headRevision}</p>
      {value.diff.unifiedDiff ? <>
        <pre className="remote-review-diff" tabIndex={0}>{value.diff.unifiedDiff}</pre>
        <RemoteRevisionFiles url={url} scope={scope} value={value} commitSha={selected.commitSha} disabled={busy} />
      </>
        : <p role="status">此提交没有差异。</p>}
    </>}
  </section>
    {value && <PrivateReviewPanel url={url} scope={scope} snapshotId={value.snapshotId} commitSha={selected.commitSha} disabled={busy} />}
  </>;
}

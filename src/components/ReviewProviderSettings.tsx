import React, { useEffect, useRef, useState } from "react";
import { tauriListen } from "../bridge";
import { serviceIdentity, readReviewProviderAccess, updateReviewProviderPreference,
  type ReviewProviderAccess, type ReviewProviderPreferences } from "../chatgptService";

// 修改前用例：CRB06 身份/作用域晚到隔离；CRB07 gate 回退不写回；
// CRB08 真实实例/失效选择、保存失败重试、监听失败恢复。
type Change = { [K in keyof ReviewProviderPreferences]: { field: K; value: ReviewProviderPreferences[K] } }[keyof ReviewProviderPreferences];
export function ReviewProviderSettings({ scope }: { scope: string }) {
  const [snapshot, setSnapshot] = useState<{ scope: string; access: ReviewProviderAccess } | null>(null);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState<Change | null>(null);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const epoch = useRef(0);
  const operation = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const queuedRefresh = useRef<(() => void) | null>(null);
  const access = snapshot?.scope === scope ? snapshot.access : null;

  useEffect(() => {
    let alive = true;
    const unlisten: (() => void)[] = [];
    const valid = (ticket: number) => alive && currentScope.current === scope && epoch.current === ticket;
    const load = async (preserveFailure = false) => {
      if (!alive || currentScope.current !== scope) return;
      const ticket = ++epoch.current;
      operation.current?.abort();
      const controller = new AbortController();
      operation.current = controller;
      saving.current = false;
      queuedRefresh.current = null;
      setSnapshot(null); setBusy(false);
      if (!preserveFailure) { setError(""); setFailed(null); }
      try {
        const identity = await serviceIdentity(controller.signal);
        if (!valid(ticket)) return;
        const next = await readReviewProviderAccess(identity, controller.signal);
        if (valid(ticket)) setSnapshot({ scope, access: next });
      } catch (cause) {
        if (valid(ticket)) setError(String(cause));
      }
    };
    const register = async (name: string, handler: (payload: any) => void) => {
      try {
        const stop = await tauriListen(name, handler);
        if (alive) unlisten.push(stop); else stop();
      } catch (cause) {
        if (alive && currentScope.current === scope) setSyncError(`提供商设置同步失败：${String(cause)}`);
      }
    };
    setSyncError("");
    void Promise.all([
      register("code-review-provider-preferences-changed", () => {
        if (!alive) return;
        if (saving.current) queuedRefresh.current = () => { void load(true); };
        else void load(true);
      }),
      register("app-server:notification", payload => { if (alive && payload?.method === "account/updated") void load(); }),
      register("app-server:status", () => { if (alive) void load(); }),
    ]).then(() => { if (alive) void load(); });
    return () => {
      alive = false; ++epoch.current; operation.current?.abort();
      saving.current = false; queuedRefresh.current = null; unlisten.forEach(stop => stop());
    };
  }, [scope, retry]);

  const save = async (change: Change) => {
    if (!access || saving.current || currentScope.current !== scope) return;
    saving.current = true; setBusy(true); setError(""); setFailed(null);
    const ticket = ++epoch.current;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    const valid = () => currentScope.current === scope && epoch.current === ticket && !controller.signal.aborted;
    try {
      const next = await updateReviewProviderPreference(change.field, change.value, access.identity, controller.signal, access.preferences[change.field]);
      if (valid()) setSnapshot({ scope, access: next });
    } catch (cause) {
      if (valid()) { setError(String(cause)); setFailed(change); }
    } finally {
      if (valid()) {
        saving.current = false; setBusy(false);
        const refresh = queuedRefresh.current;
        queuedRefresh.current = null;
        refresh?.();
      }
    }
  };
  const stored = access?.preferences.gitHostingProvider;
  const known = stored === "github" || stored === "gitlab";
  const effective = stored === "gitlab" && access?.capabilities.gitlab !== true ? "github" : stored;
  const selected = access?.preferences.githubConnection;
  const connectionsError = access?.githubConnectionsError;
  const connections = access?.githubConnections ?? [];
  const connectionIndex = selected ? connections.findIndex(item => item.hostname === selected.hostname &&
    item.connection.connectorId === selected.connectorId && item.connection.accountLinkId === selected.accountLinkId) : -1;
  const gitlabError = access?.gitlabInstancesError;
  const gitlabInstances = [...(access?.gitlabInstances ?? [])].sort((left, right) => left.hostname.localeCompare(right.hostname));
  const gitlabSelected = access?.preferences.gitlabConnectorId;
  const gitlabDefault = gitlabSelected === null || gitlabSelected === "connector_0c9786b2f41f41558056126bdb46c9bd";
  const gitlabFound = gitlabInstances.some(item => item.connectorId === gitlabSelected);
  return <>
    {syncError && <p role="alert" className="error-banner">{syncError} <button type="button" className="secondary-btn-sm"
      onClick={() => setRetry(value => value + 1)}>重试同步</button></p>}
    {error && <p role="alert" className="error-banner">{error} <button type="button" className="secondary-btn-sm" disabled={busy}
      onClick={() => failed && access ? void save(failed) : setRetry(value => value + 1)}>重试</button>
      {failed && <button type="button" className="secondary-btn-sm" disabled={busy} onClick={() => setRetry(value => value + 1)}>重新读取</button>}</p>}
    {!access && !error && <p role="status">正在读取代码审查提供商…</p>}
    {access && <>
      <label className="form-field"><span>代码审查提供商</span>
        <select aria-label="代码审查提供商" value={effective} disabled={busy} onChange={event => {
          if (event.target.value === "github" || (event.target.value === "gitlab" && access.capabilities.gitlab === true))
            void save({ field: "gitHostingProvider", value: event.target.value });
        }}>
          {!known && <option value={stored} disabled>不支持的原值：{stored}</option>}
          <option value="github">GitHub</option>
          {access.capabilities.gitlab === true && <option value="gitlab">GitLab</option>}
        </select>
      </label>
      {stored === "gitlab" && effective === "github" && <p role="status">当前无法确认 GitLab 使用资格，暂用 GitHub；已保存的 GitLab 偏好未更改。</p>}
      {!known && <p role="status">已保留原提供商设置，请明确选择支持的提供商。</p>}
      {effective === "github" && access.capabilities.githubInstances === true && <>
        <label className="form-field"><span>GitHub 实例</span>
          <select aria-label="GitHub 实例" disabled={busy || !!connectionsError || access.githubConnections === null} value={!selected ? "default" : connectionIndex < 0 ? "unavailable" : String(connectionIndex)}
            onChange={event => {
              if (busy || connectionsError || access.githubConnections === null) return;
              const item = connections[Number(event.target.value)];
              if (event.target.value === "default") void save({ field: "githubConnection", value: null });
              else if (item) void save({ field: "githubConnection", value: { hostname: item.hostname, ...item.connection } });
            }}>
            <option value="default">github.com</option>
            {selected && connectionIndex < 0 && <option value="unavailable" disabled>{selected.hostname}{connectionsError ? "（连接读取失败，保留原值）" : "（已保存连接不可用）"}</option>}
            {connections.map((item, index) => <option key={`${item.hostname}:${item.connection.connectorId}:${item.connection.accountLinkId}`} value={String(index)}>{item.name ? `${item.hostname} — ${item.name}` : item.hostname}</option>)}
          </select>
        </label>
        {connectionsError && <p role="alert" className="error-banner">{connectionsError} <button type="button" className="secondary-btn-sm" disabled={busy}
          onClick={() => setRetry(value => value + 1)}>重试读取实例</button></p>}
        {!connectionsError && selected && connectionIndex < 0 && <p role="status">已保存连接不在当前账号的可用列表中，未自动替换。</p>}
      </>}
      {effective === "gitlab" && <>
        <label className="form-field"><span>GitLab 实例</span>
          <select aria-label="GitLab 实例" disabled={busy || !!gitlabError || access.gitlabInstances === null}
            value={gitlabDefault ? "default" : gitlabFound ? gitlabSelected : "unavailable"}
            onChange={event => {
              if (busy || gitlabError || access.gitlabInstances === null) return;
              if (event.target.value === "default") void save({ field: "gitlabConnectorId", value: null });
              else if (gitlabInstances.some(item => item.connectorId === event.target.value))
                void save({ field: "gitlabConnectorId", value: event.target.value });
            }}>
            <option value="default">gitlab.com</option>
            {!gitlabDefault && !gitlabFound && <option value="unavailable" disabled>{gitlabError ? "已保存的企业连接（读取失败，保留原值）" : "已保存的企业连接（当前不可用）"}</option>}
            {gitlabInstances.map(item => <option key={item.connectorId} value={item.connectorId}>{item.name ? `${item.hostname} — ${item.name}` : item.hostname}</option>)}
          </select>
        </label>
        {gitlabError && <p role="alert" className="error-banner">{gitlabError} <button type="button" className="secondary-btn-sm" disabled={busy}
          onClick={() => setRetry(value => value + 1)}>重试读取 GitLab 实例</button></p>}
        {!gitlabError && !gitlabDefault && !gitlabFound && <p role="status">已保存连接不在当前账号的 GitLab 可用列表中，未自动替换。</p>}
      </>}
      {busy && <p role="status">正在保存提供商设置…</p>}
    </>}
  </>;
}

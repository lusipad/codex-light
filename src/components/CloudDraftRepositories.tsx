import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { serviceErrorMessage, type ServiceIdentity } from "../chatgptService";
import { loadRepositoryConnections, loadRepositoryInstallations, loadRepositoryPage,
  type RepositoryCandidate, type RepositoryConnection, type RepositoryInstallation } from "../cloudRepositoryDiscovery";
import type { CloudRepository } from "../cloudEnvironmentService";

export type RepositorySelection = CloudRepository & { name: string; repositoryName?: string | null };
type Selection = RepositorySelection;
const connectionKey = (connection: RepositoryConnection) => JSON.stringify([connection.connectorId, connection.linkId]);

export function sameRepositorySelection(left: readonly CloudRepository[], right: readonly CloudRepository[]) {
  return left.length === right.length && left.every(repo => right.some(other => other.id === repo.id));
}

export function CloudDraftRepositories({ original, selection, disabled, identity, scope, onChange }: {
  original: Selection[]; selection: Selection[]; disabled: boolean; identity: ServiceIdentity; scope: AbortSignal;
  onChange: (selection: Selection[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <section>
    <header className="cloud-draft-repository-heading"><h3>代码仓库</h3>
      <button ref={trigger} type="button" className="back-to-app-pill" aria-label="Manage repositories"
        aria-haspopup="dialog" disabled={disabled} onClick={() => setOpen(true)}>Manage</button>
    </header>
    {selection.map(repo => <div key={repo.id} className="cloud-envs-config-repo"><span>{repo.name}</span><span>{repo.ref}</span>
      <button type="button" className="window-chrome-icon-btn" aria-label={`Remove ${repo.name}`} disabled={disabled}
        onClick={() => onChange(selection.filter(row => row.id !== repo.id))}><X size={13} aria-hidden="true" /></button>
    </div>)}
    {open && <CloudRepositoryDialog original={original} initial={selection} identity={identity} scope={scope}
      onClose={() => setOpen(false)} onRestoreFocus={() => trigger.current?.focus()} onSave={next => { onChange(next); setOpen(false); }} />}
  </section>;
}

export function CloudRepositoryDialog({ original, initial, identity, scope, onClose, onRestoreFocus, onSave, create = false }: {
  original: Selection[]; initial: Selection[]; identity: ServiceIdentity; scope: AbortSignal;
  onClose: () => void; onRestoreFocus: () => void; onSave: (selection: Selection[]) => void;
  create?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef(onRestoreFocus);
  const heading = useId();
  const [selected, setSelected] = useState(initial);
  const [connections, setConnections] = useState<RepositoryConnection[] | null>(null);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const maxRepositories = create ? 100 : 16;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); restoreFocus.current(); };
  }, []);
  useEffect(() => {
    const request = new AbortController();
    const signal = AbortSignal.any([scope, request.signal]);
    setConnections(null); setError(null);
    void loadRepositoryConnections(identity, signal).then(result => {
      if (!signal.aborted) {
        setConnections(result);
        const initial = result.find(item => item.status === "connected") ?? result.find(item => item.status !== "disabled") ?? result[0];
        setChoice(initial ? connectionKey(initial) : "");
      }
    }, cause => { if (!signal.aborted) setError(serviceErrorMessage(cause)); });
    return () => request.abort();
  }, [identity, scope, attempt]);
  const connection = connections?.find(item => connectionKey(item) === choice);
  const change = (candidate: RepositoryCandidate, checked: boolean) => {
    setSelected(current => {
      if (!checked) return current.filter(repo => repo.id !== candidate.id);
      if (current.length >= maxRepositories || current.some(repo => repo.id === candidate.id)) return current;
      const retained = original.find(repo => repo.id === candidate.id) ?? initial.find(repo => repo.id === candidate.id);
      return retained ? [...current, retained] : candidate.default_branch
        ? [...current, { id: candidate.id, name: candidate.repository_full_name, ref: candidate.default_branch,
          ...(create ? { repositoryName: candidate.name } : {}) }] : current;
    });
  };
  const validSelection = create ? !!selected[0]?.repositoryName : !sameRepositorySelection(initial, selected);
  return <dialog ref={dialog} className={`cloud-draft-domain-dialog cloud-draft-repository-dialog${create ? " cloud-create-repository-dialog" : ""}`} aria-labelledby={heading}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type === "search") event.preventDefault();
      if (event.key === "Escape" && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
    }}>
    <div>
      <header className="cloud-draft-repository-heading"><h3 id={heading}>{create ? "创建云端环境" : "Add git repository"}</h3>
        <button type="button" className="window-chrome-icon-btn" aria-label="关闭仓库选择器" onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </header>
      {create && <p>选择代码仓库，以便 Codex 确定需要安装哪些内容以及如何配置你的环境</p>}
      {error ? <div role="alert">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>再次尝试加载 GitHub 连接</button></div>
        : connections === null ? <p role="status">正在加载 GitHub 连接…</p> : <>
          {connections.length > 0 && <label>GitHub 连接<select value={choice} onChange={event => setChoice(event.target.value)}>
            {connections.map(item => <option key={connectionKey(item)} value={connectionKey(item)}>{item.label}</option>)}
          </select></label>}
          {connection?.status === "connected" ? <ConnectionRepositories key={choice} connection={connection} identity={identity} scope={scope}
            selected={selected} retained={[...original, ...initial]} maxRepositories={maxRepositories} onChange={change} />
            : <p role="status">{connection?.status === "reconnect" ? "请重新连接 GitHub，以加载你的代码仓库"
              : connection?.status === "disabled" ? "此 GitHub 连接已被管理员禁用。" : "连接 GitHub，即可查看你的代码仓库"}</p>}
        </>}
      {create && selected.length > 0 && !validSelection && <p role="alert">首个仓库缺少名称，请选择其他仓库。</p>}
      <footer className="cloud-envs-footer">
        {create && <span className="cloud-create-repository-count" role="status">{selected.length ? `已选择 ${selected.length} 项` : "未选择任何项"}</span>}
        <button type="button" onClick={onClose}>取消</button>
        <button type="button" disabled={selected.length > maxRepositories || !validSelection}
          onClick={() => onSave(selected)}>{create ? "开始设置" : "Save"}</button></footer>
    </div>
  </dialog>;
}

function ConnectionRepositories({ connection, identity, scope, selected, retained, maxRepositories, onChange }: {
  connection: RepositoryConnection; identity: ServiceIdentity; scope: AbortSignal; selected: Selection[]; retained: Selection[];
  maxRepositories: number;
  onChange: (candidate: RepositoryCandidate, checked: boolean) => void;
}) {
  const [installations, setInstallations] = useState<RepositoryInstallation[] | null>(null);
  const [installationId, setInstallationId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const request = new AbortController();
    const signal = AbortSignal.any([scope, request.signal]);
    setInstallations(null); setError(null);
    void loadRepositoryInstallations(connection, identity, signal).then(value => {
      if (!signal.aborted) setInstallations(value);
    }, cause => { if (!signal.aborted) setError(serviceErrorMessage(cause)); });
    return () => request.abort();
  }, [connection, identity, scope, attempt]);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const installation = installations?.find(item => item.id === installationId) ?? null;
  return <>
    <label>GitHub 账户<select value={installationId} onChange={event => setInstallationId(event.target.value)}>
      <option value="">全部代码仓库</option>
      {installations?.map(item => <option key={item.id} value={item.id}>{item.account_login}</option>)}
    </select></label>
    {error ? <p role="alert">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>重试载入组织</button></p>
      : installations === null && <p role="status">组织加载中…</p>}
    <input type="search" aria-label="搜索代码仓库" placeholder="搜索" value={query} onChange={event => setQuery(event.target.value)} />
    {query.trim() === debounced ? <RepositoryResults key={JSON.stringify([installation?.id, debounced])}
      {...{ connection, identity, scope, installation, selected, retained, maxRepositories, onChange }} query={debounced} />
      : <p role="status">代码仓库加载中…</p>}
  </>;
}

function RepositoryResults({ connection, identity, scope, installation, query, selected, retained, maxRepositories, onChange }: {
  connection: RepositoryConnection; identity: ServiceIdentity; scope: AbortSignal; installation: RepositoryInstallation | null;
  query: string; selected: Selection[]; retained: Selection[]; onChange: (candidate: RepositoryCandidate, checked: boolean) => void;
  maxRepositories: number;
}) {
  const [rows, setRows] = useState<RepositoryCandidate[]>([]);
  const [page, setPage] = useState(1);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    const signal = AbortSignal.any([scope, request.signal]);
    setPending(true); setError(null);
    void loadRepositoryPage(connection, installation, query, page, identity, signal).then(result => {
      if (signal.aborted) return;
      setRows(previous => {
        const unique = new Map(previous.map(row => [row.id, row]));
        for (const row of result.rows) if (!unique.has(row.id)) unique.set(row.id, row);
        return [...unique.values()];
      });
      setNextPage(result.nextPage); setPending(false);
    }, cause => { if (!signal.aborted) { setError(serviceErrorMessage(cause)); setPending(false); } });
    return () => request.abort();
  }, [attempt, connection, identity, installation, page, query, scope]);
  return <div aria-label="代码仓库结果">
    {rows.map(row => {
      const checked = selected.some(repo => repo.id === row.id);
      const missingBranch = row.default_branch === null && !retained.some(repo => repo.id === row.id);
      return <label className="cloud-draft-repository-option" key={row.id}><input type="checkbox" checked={checked}
        disabled={!checked && (selected.length >= maxRepositories || missingBranch)}
        onChange={event => onChange(row, event.target.checked)} />{row.repository_full_name}{missingBranch && "（缺少默认分支）"}</label>;
    })}
    {pending ? <p role="status">{page === 1 ? "代码仓库加载中…" : "正在加载更多…"}</p>
      : error ? <p role="alert">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>重新尝试加载代码仓库</button></p>
      : rows.length === 0 ? <p role="status">{query ? `未找到与“${query}”匹配的代码仓库` : "此连接没有可用的代码仓库"}</p>
      : nextPage !== null && <button type="button" onClick={() => { setPending(true); setPage(nextPage); }}>加载更多代码仓库</button>}
  </div>;
}

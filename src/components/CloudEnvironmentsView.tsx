import React, { useEffect, useRef, useState } from "react";
import { tauriListen } from "../bridge";
import { cloudServiceAccess, readCloudService, serviceErrorMessage, type CloudAccess } from "../chatgptService";
import { filterCloudCatalog, loadCloudCatalog, loadRepositoryName, parseCloudDetail,
  type CloudCatalog, type CloudDetail, type RepositoryName } from "../cloudEnvironmentService";
import "./CloudEnvironmentsView.css";

export const CloudEnvironmentsView: React.FC = () => {
  const [revision, setRevision] = useState(0);
  const [access, setAccess] = useState<CloudAccess | null>(null);
  const [catalog, setCatalog] = useState<CloudCatalog | null>(null);
  const [names, setNames] = useState<Record<string, RepositoryName>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CloudDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const source = useRef<AbortController | null>(null);
  const detailSource = useRef<AbortController | null>(null);
  const catalogBusy = useRef(false);
  const noResultRefresh = useRef<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const visible = filterCloudCatalog(catalog?.items ?? [], query, names);

  const readCatalog = async (current: CloudAccess) => {
    const controller = source.current;
    if (!controller || controller.signal.aborted || catalogBusy.current) return;
    catalogBusy.current = true; setLoading(true); setError(null); setNames({});
    try {
      const result = await loadCloudCatalog(current.identity, controller.signal);
      if (controller.signal.aborted) return;
      setCatalog(result);
      const repositoryIds = [...new Set(result.items.flatMap(item => item.repositories.map(repo => repo.id)))];
      await Promise.all(repositoryIds.map(async id => {
        const name = await loadRepositoryName(id, current.identity, controller.signal);
        if (!controller.signal.aborted) setNames(value => ({ ...value, [id]: name }));
      }));
    } catch (cause) { if (!controller.signal.aborted) setError(serviceErrorMessage(cause)); }
    finally { if (!controller.signal.aborted) { catalogBusy.current = false; setLoading(false); } }
  };
  useEffect(() => {
    let disposed = false;
    const subscription = tauriListen("chatgpt-service:invalidated", () => {
      if (disposed) return;
      source.current?.abort(); detailSource.current?.abort();
      setAccess(null); setCatalog(null); setNames({}); setSelectedId(null); setRevision(value => value + 1);
    });
    return () => { disposed = true; void subscription.then(unlisten => unlisten()); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); source.current = controller;
    catalogBusy.current = false; setAccess(null); setCatalog(null); setNames({}); setLoading(true); setError(null); setSelectedId(null);
    void (async () => {
      try {
        const current = await cloudServiceAccess(controller.signal); if (controller.signal.aborted) return;
        setAccess(current);
        if (current.gateEvidence === "personal-plan-branch") await readCatalog(current); else setLoading(false);
      } catch (cause) { if (!controller.signal.aborted) { setError(serviceErrorMessage(cause)); setLoading(false); } }
    })();
    return () => { controller.abort(); detailSource.current?.abort(); };
  }, [revision]);
  useEffect(() => { noResultRefresh.current = null; }, [query]);
  useEffect(() => {
    const search = query.trim();
    if (!access || !catalog || loading || !search || visible.length || noResultRefresh.current === search) return;
    const timer = setTimeout(() => { noResultRefresh.current = search; void readCatalog(access); }, 300);
    return () => clearTimeout(timer);
  }, [access, catalog, loading, query, visible.length]);
  useEffect(() => {
    if (!selectedId) return;
    const dialog = dialogRef.current; dialog?.showModal();
    return () => { dialog?.close(); detailTrigger.current?.focus(); };
  }, [selectedId]);
  const openDetail = async (id: string) => {
    if (!access || source.current?.signal.aborted) return;
    detailSource.current?.abort(); const controller = new AbortController(); detailSource.current = controller;
    setSelectedId(id); setDetail(null); setDetailError(null);
    try {
      const value = parseCloudDetail(await readCloudService("detail", { id }, access.identity, controller.signal), id);
      if (controller.signal.aborted || source.current?.signal.aborted) return;
      setDetail(value);
      const repositoryIds = [...new Set((value.draft ?? value).repositories.map(repo => repo.id))];
      await Promise.all(repositoryIds.filter(repositoryId => !names[repositoryId]).map(async repositoryId => {
        const name = await loadRepositoryName(repositoryId, access.identity, controller.signal);
        if (!controller.signal.aborted && !source.current?.signal.aborted) setNames(current => ({ ...current, [repositoryId]: name }));
      }));
    } catch (cause) { if (!controller.signal.aborted) setDetailError(serviceErrorMessage(cause)); }
  };
  const closeDetail = () => { detailSource.current?.abort(); setSelectedId(null); };
  const repositoryLabel = (id: string) => names[id]?.name ?? (names[id]?.error === "未知仓库" ? "未知仓库" : names[id]?.error ? "仓库名称读取失败" : "仓库名称尚未解析");
  const effective = detail?.draft ?? detail;
  const hasScopeError = Boolean(catalog && Object.keys(catalog.errors).length);
  return <div className="cloud-envs-container">
    <div className="cloud-envs-header"><h2>Codex Cloud</h2><p role="status">新建、编辑与删除暂不可用。</p></div>
    {loading && <p role="status">正在读取云端环境…</p>}
    {error && <section><p role="alert">{error}</p><button type="button" onClick={() => setRevision(value => value + 1)}>重试</button></section>}
    {access?.gateEvidence === "incomplete" && <p role="status">官方云访问资格尚未完成核对。</p>}
    {access && <>
      <div className="cloud-envs-filter-bar"><div className="search-box"><input aria-label="搜索云端环境" maxLength={128} placeholder="搜索环境或仓库…" value={query} onChange={event => setQuery(event.target.value.slice(0, 128))} /></div>
        <button type="button" disabled={loading} onClick={() => void readCatalog(access)}>{catalog ? "刷新" : "读取云环境"}</button></div>
      {catalog && Object.entries(catalog.errors).map(([scope, message]) => <p role="alert" key={scope}>{scope === "user" ? "个人" : "工作区"}目录读取未完成：{message}</p>)}
      {hasScopeError && <button type="button" disabled={loading} onClick={() => void readCatalog(access)}>重试目录</button>}
      {catalog && !loading && !error && !hasScopeError && !visible.length && <p role="status">没有匹配的环境配置。</p>}
      {catalog && <table className="cloud-envs-table"><thead><tr><th>环境</th><th>共享</th></tr></thead><tbody>{visible.map(item => <tr key={item.id}>
        <td><button type="button" className="link-btn" onClick={event => { detailTrigger.current = event.currentTarget; void openDetail(item.id); }}>{item.name}</button>
          {item.repositories.map(repo => <div className="cloud-envs-repository" key={repo.id}>{repositoryLabel(repo.id)}</div>)}</td><td>{item.shareSettings === "private" ? "私密" : "工作区"}</td>
      </tr>)}</tbody></table>}
    </>}
    {selectedId && <dialog ref={dialogRef} aria-label="云端环境详情" onCancel={event => { event.preventDefault(); closeDetail(); }}>
      <button type="button" onClick={closeDetail}>关闭</button>
      {detailError ? <><p role="alert">{detailError}</p><button type="button" onClick={() => void openDetail(selectedId)}>重试详情</button></> : !detail || !effective ? <p role="status">正在读取详情…</p> : <>
        <h2>{detail.name}</h2><p>配置状态：{detail.status}</p><p>版本：{detail.versionId}</p><p>共享：{detail.shareSettings === "private" ? "私密" : "工作区"}</p>
        {detail.draft && <p>正在显示草稿配置（修订 {detail.draft.revision}）。</p>}
        <section><h3>仓库</h3>{!effective.repositories.length && <p>暂无仓库。</p>}{effective.repositories.map(repo => <p key={repo.id}>{repositoryLabel(repo.id)} · {repo.ref} <code>{repo.id}</code>{repo.depth != null && <span> 深度 {repo.depth}</span>}</p>)}</section>
        <section><h3>网络</h3><p>{effective.network.type === "disabled" ? "禁用" : effective.network.type === "unrestricted" ? "不受限" : "受限"}</p>
          {effective.network.packageManagers && <p>允许软件包管理器</p>}{effective.network.hosts.map(host => <p key={host}>{host}</p>)}</section>
        {effective.cwd != null && <p>工作目录：{effective.cwd}</p>}{effective.installScript != null && <section><h3>安装脚本</h3><pre>{effective.installScript}</pre></section>}
        {effective.startSkill != null && <section><h3>启动技能</h3><pre>{effective.startSkill}</pre></section>}
        <section><h3>Secret 元数据</h3>{!effective.secrets.length && <p>暂无 Secret。</p>}{effective.secrets.map((secret, index) => <div key={index}><p>{secret.name} · {secret.source} · {secret.target}</p>{secret.domains.map(domain => <p key={domain}>{domain}</p>)}{secret.error && <p role="alert">{secret.error}</p>}</div>)}</section>
      </>}
    </dialog>}
  </div>;
};

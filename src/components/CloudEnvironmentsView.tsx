import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Ellipsis, Plus, Search } from "lucide-react";
import { tauriListen } from "../bridge";
import { readCloudEnvironmentAccess, type CloudEnvironmentAccess } from "../cloudEnvironmentAccess";
import { readCloudService, serviceErrorMessage } from "../chatgptService";
import { createCloudDraftSession, type CloudDraftSession } from "../cloudDraftSession";
import { pendingRepositoryApplySession } from "../cloudDraftRepositoryApply";
import { hasPendingCloudEnvironmentSetup, openCloudEnvironmentSetup } from "../cloudEnvironmentSetup";
import { pendingCloudReplySession } from "../cloudEnvironmentReply";
import { cloudSharingLabel, filterCloudCatalog, loadCloudCatalog, loadRepositoryName, parseCloudDetail,
  type CloudCatalog, type CloudDetail, type CloudSummary, type RepositoryName } from "../cloudEnvironmentService";
import "./CloudEnvironmentsView.css";

export function renderCloudEnvironmentFields({ detail, repository, showScripts = true, showNetwork = true, showMetadata = true, showRepositories = true }: { detail: CloudDetail; repository: (id: string) => React.ReactNode; showScripts?: boolean; showNetwork?: boolean; showMetadata?: boolean; showRepositories?: boolean }) {
  const effective = detail.draft ?? detail;
  return <div aria-label="环境设置" className="cloud-envs-config">
    {showMetadata && detail.description && <p className="cloud-envs-description">{detail.description}</p>}
    {showMetadata && <section><h3>共享</h3><p>{cloudSharingLabel(detail)}</p></section>}
    {showRepositories && <section><h3>代码仓库</h3>{effective.repositories.map(repo => <div className="cloud-envs-config-repo" key={repo.id}>{repository(repo.id)}<span>{repo.ref}</span></div>)}</section>}
    {showNetwork && <section><h3>网络</h3><p>{effective.network.type === "disabled" ? "禁用" : effective.network.type === "unrestricted" ? "不受限" : "受限"}</p>{effective.network.packageManagers && <p>允许软件包管理器</p>}{effective.network.hosts.map(host => <p key={host}>{host}</p>)}</section>}
    {effective.cwd != null && <section><h3>工作目录</h3><pre>{effective.cwd}</pre></section>}
    {showScripts && effective.installScript != null && <section><h3>安装脚本</h3><pre>{effective.installScript}</pre></section>}
    {showScripts && effective.startSkill != null && <section><h3>启动技能</h3><pre>{effective.startSkill}</pre></section>}
    <section><h3>密钥</h3>{!effective.secrets.length && <p>暂无密钥。</p>}{effective.secrets.map((secret, index) => <div key={index}><p>{secret.name} · {secret.source} · {secret.target}</p>{secret.domains.map(domain => <p key={domain}>{domain}</p>)}{secret.error && <p role="alert">{secret.error}</p>}</div>)}</section>
  </div>;
}

export type OpenCloudDraft = (session: CloudDraftSession, persisted: boolean) => void;

export const CloudEnvironmentsView: React.FC<{ embedded?: boolean; onOpenDraft?: OpenCloudDraft; returnFocusId?: string }> = ({ embedded = false, onOpenDraft, returnFocusId }) => {
  const [revision, setRevision] = useState(0);
  const [access, setAccess] = useState<CloudEnvironmentAccess | null>(null);
  const [catalog, setCatalog] = useState<CloudCatalog | null>(null);
  const [names, setNames] = useState<Record<string, RepositoryName>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CloudDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ item: CloudSummary; left: number; top: number; trigger: HTMLButtonElement } | null>(null);
  const source = useRef<AbortController | null>(null);
  const detailSource = useRef<AbortController | null>(null);
  const creating = useRef<AbortController | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [setupPending, setSetupPending] = useState(false);
  const returnedFocus = useRef(false);
  const catalogBusy = useRef(false);
  const catalogSequence = useRef(0);
  const noResultRefresh = useRef<string | null>(null);
  const rowTriggers = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocus = useRef<string | null>(null);
  const detailTitle = useRef<HTMLHeadingElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const visible = filterCloudCatalog(catalog?.items ?? [], query, names);

  const readCatalog = async (current: CloudEnvironmentAccess) => {
    const controller = source.current;
    if (!controller || controller.signal.aborted || catalogBusy.current || !current.available) return;
    const sequence = ++catalogSequence.current;
    catalogBusy.current = true; setLoading(true); setError(null);
    try {
      const result = await loadCloudCatalog(current.identity, controller.signal);
      if (controller.signal.aborted || sequence !== catalogSequence.current) return;
      setCatalog(result); setNames({}); setLoading(false); catalogBusy.current = false;
      const repositoryIds = [...new Set(result.items.flatMap(item => item.repositories.map(repo => repo.id)))];
      await Promise.all(repositoryIds.map(async id => {
        const name = await loadRepositoryName(id, current.identity, controller.signal);
        if (!controller.signal.aborted && sequence === catalogSequence.current) setNames(value => ({ ...value, [id]: name }));
      }));
    } catch (cause) { if (!controller.signal.aborted && sequence === catalogSequence.current) setError(serviceErrorMessage(cause)); }
    finally { if (!controller.signal.aborted && sequence === catalogSequence.current) { catalogBusy.current = false; setLoading(false); } }
  };
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const controller = new AbortController(); source.current = controller;
    catalogBusy.current = false; noResultRefresh.current = null;
    setAccess(null); setSetupPending(false); setCatalog(null); setNames({}); setLoading(true); setError(null); setSelectedId(null); setDetail(null); setMenu(null);
    void (async () => {
      try {
        const stop = await tauriListen("chatgpt-service:invalidated", () => {
          if (disposed) return;
          controller.abort(); detailSource.current?.abort(); creating.current?.abort(); setCreatingId(null); setCreateError(null); setAccess(null); setCatalog(null); setNames({}); setSelectedId(null); setDetail(null); setMenu(null);
          restoreFocus.current = null; setRevision(value => value + 1);
        });
        if (disposed) { stop(); return; }
        unlisten = stop;
        const current = await readCloudEnvironmentAccess(controller.signal);
        if (controller.signal.aborted) return;
        setAccess(current);
        if (current.canCreate) {
          try { setSetupPending(hasPendingCloudEnvironmentSetup(current.identity)); }
          catch (cause) { setCreateError(serviceErrorMessage(cause)); }
        }
        if (current.available) await readCatalog(current); else setLoading(false);
      } catch (cause) { if (!controller.signal.aborted) { setError(serviceErrorMessage(cause)); setLoading(false); } }
    })();
    return () => { disposed = true; controller.abort(); detailSource.current?.abort(); creating.current?.abort(); unlisten?.(); };
  }, [revision]);
  useEffect(() => { noResultRefresh.current = null; }, [query]);
  useEffect(() => {
    const search = query.trim();
    if (!access?.available || !catalog || loading || error || selectedId || !search || visible.length || noResultRefresh.current === search) return;
    const timer = setTimeout(() => { noResultRefresh.current = search; void readCatalog(access); }, 300);
    return () => clearTimeout(timer);
  }, [access, catalog, loading, error, selectedId, query, visible.length]);
  useLayoutEffect(() => {
    if (selectedId) detailTitle.current?.focus();
    else if (restoreFocus.current) { rowTriggers.current.get(restoreFocus.current)?.focus(); restoreFocus.current = null; }
  }, [selectedId]);
  useLayoutEffect(() => {
    if (!returnFocusId || returnedFocus.current) return;
    const trigger = rowTriggers.current.get(returnFocusId);
    if (trigger) { trigger.focus(); returnedFocus.current = true; }
  }, [returnFocusId, catalog, loading]);
  useLayoutEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
    const close = (returnFocus: boolean) => { setMenu(null); if (returnFocus) menu.trigger.focus(); };
    const pointer = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node) && !menu.trigger.contains(event.target as Node)) close(false); };
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
      else if (event.key === "Tab") close(false);
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus(); }
    };
    const reposition = () => close(false);
    document.addEventListener("pointerdown", pointer); document.addEventListener("keydown", key);
    window.addEventListener("resize", reposition); window.addEventListener("scroll", reposition, true);
    return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", key); window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, [menu]);
  const openDetail = async (id: string) => {
    if (!access?.available || source.current?.signal.aborted) return;
    detailSource.current?.abort(); const controller = new AbortController(); detailSource.current = controller;
    setMenu(null); setSelectedId(id); setDetail(null); setDetailError(null);
    try {
      const value = parseCloudDetail(await readCloudService("detail", { id }, access.identity, controller.signal), id);
      if (controller.signal.aborted || source.current?.signal.aborted) return;
      setDetail(value);
      const ids = [...new Set((value.draft ?? value).repositories.map(repo => repo.id))];
      await Promise.all(ids.filter(id => !names[id]).map(async id => {
        const name = await loadRepositoryName(id, access.identity, controller.signal);
        if (!controller.signal.aborted && !source.current?.signal.aborted) setNames(current => ({ ...current, [id]: name }));
      }));
    } catch (cause) { if (!controller.signal.aborted) setDetailError(serviceErrorMessage(cause)); }
  };
  const closeDetail = () => { detailSource.current?.abort(); restoreFocus.current = selectedId; setSelectedId(null); setDetail(null); setDetailError(null); };
  const repositoryLabel = (id: string) => names[id]?.name ?? "未知代码仓库";
  const repository = (id: string) => names[id] ? <span title={repositoryLabel(id)}>{repositoryLabel(id)}</span>
    : <span className="cloud-envs-repo-loading" role="status" aria-label="正在加载代码仓库…"><span /></span>;
  const selected = catalog?.items.find(item => item.id === selectedId);
  const menuCanEdit = menu && access && (access.rbacEnabled === false || access.available
    && (menu.item.shareSettings === "workspace" ? access.canManage : menu.item.isOwner !== false));
  const openEdit = async () => {
    if (!menuCanEdit || !menu || !access?.available || !onOpenDraft || creating.current || source.current?.signal.aborted) return;
    const { item, trigger } = menu;
    const controller = new AbortController();
    creating.current = controller;
    setCreatingId(item.id); setCreateError(null); setMenu(null);
    try {
      const pending = pendingCloudReplySession(item.id, access.identity) ?? pendingRepositoryApplySession(item.id, access.identity);
      if (pending) { onOpenDraft(pending, true); return; }
      const repositoryNames = Object.fromEntries(item.repositories.flatMap(({ id }) => names[id]?.name ? [[id, names[id].name]] : []));
      const { session, persisted } = await createCloudDraftSession(item, repositoryNames, access.identity, controller.signal);
      if (!controller.signal.aborted) onOpenDraft(session, persisted);
    } catch (cause) {
      if (!controller.signal.aborted) { setCreateError(serviceErrorMessage(cause)); trigger.focus(); }
    } finally {
      if (creating.current === controller) creating.current = null;
      if (!controller.signal.aborted) setCreatingId(null);
    }
  };
  const openSetup = async () => {
    if (!access?.canCreate || (!access.directCreate && !setupPending) || !onOpenDraft
      || creating.current || source.current?.signal.aborted) return;
    const controller = new AbortController();
    creating.current = controller;
    setCreatingId("new-setup"); setCreateError(null);
    try {
      const selection = setupPending ? null : { name: "New environment", repositories: [] };
      const result = await openCloudEnvironmentSetup(selection, access.identity, controller.signal);
      if (controller.signal.aborted) return;
      if (result?.status === "ready") onOpenDraft(result.session, result.persisted);
      else if (result) setCreateError(result.status === "config_unconfirmed"
        ? "环境创建结果尚未确认，请先核对环境列表。" : "环境已保存，设置会话仍待确认。");
    } catch (cause) {
      if (!controller.signal.aborted) setCreateError(serviceErrorMessage(cause));
    } finally {
      if (creating.current === controller) creating.current = null;
      if (!controller.signal.aborted) {
        setCreatingId(null);
        try { setSetupPending(hasPendingCloudEnvironmentSetup(access.identity)); }
        catch (cause) { setCreateError(serviceErrorMessage(cause)); }
      }
    }
  };
  return <div className={`cloud-envs-page${embedded ? " cloud-envs-embedded" : ""}`}>
    <div className="cloud-envs-content">
      {selectedId ? <>
        <nav className="cloud-envs-breadcrumb" aria-label="环境导航"><button type="button" onClick={closeDetail}>环境</button><ChevronRight size={14} /><span>{detail?.name ?? selected?.name}</span></nav>
        <h2 ref={detailTitle} tabIndex={-1} className="cloud-envs-detail-title">{detail?.name ?? selected?.name}</h2>
        {!detail ? <div className="cloud-envs-state" role={detailError ? "alert" : "status"}>{detailError ? <><span>未能加载环境</span><p>{detailError}</p><button type="button" onClick={() => void openDetail(selectedId)}>重试</button></> : "正在载入环境…"}<button type="button" onClick={closeDetail}>取消</button></div> : <>
          {renderCloudEnvironmentFields({ detail, repository })}
          <footer className="cloud-envs-footer"><button type="button" onClick={closeDetail}>取消</button><button type="button" disabled title="环境配置保存尚未接入">保存更改</button></footer>
        </>}
      </> : <>
        <header className="cloud-envs-page-header"><h2>Codex 云端</h2><p>设置云端环境，为 Codex 在你的项目中开展工作提供所需的代码仓库、工具和设置</p></header>
        <div className="cloud-envs-controls"><div className="cloud-envs-tabs" role="tablist" aria-label="Codex 云端设置"><button type="button" role="tab" aria-selected="true">环境</button><button type="button" role="tab" aria-selected="false" disabled title="个人保险库尚未接入">个人保险库</button></div>
          <div className="cloud-envs-toolbar"><label className="cloud-envs-search"><Search size={16} aria-hidden="true" /><input aria-label="搜索环境" maxLength={128} placeholder="搜索" value={query} onChange={event => setQuery(event.target.value.slice(0, 128))} /></label><button type="button" className="cloud-envs-create"
            disabled={!access?.canCreate || (!access.directCreate && !setupPending) || !onOpenDraft || !!creatingId} onClick={() => void openSetup()}>
            <Plus size={16} aria-hidden="true" />{setupPending ? "继续创建环境" : "创建环境"}
          </button></div>
        </div>
        {loading && <p className="cloud-envs-state" role="status">正在加载已保存的环境…</p>}
        {creatingId && <p className="cloud-envs-state" role="status">{creatingId === "new-setup" ? "正在启动设置…" : "正在创建环境草稿…"}</p>}
        {createError && <p className="cloud-envs-state" role="alert">{createError}</p>}
        {error && <section className="cloud-envs-state" role="alert"><span>无法加载已保存的环境</span><p>{error}</p><button type="button" onClick={() => setRevision(value => value + 1)}>重试</button></section>}
        {access && !access.available && !loading && <p className="cloud-envs-state" role="status">此工作空间无法设置云环境</p>}
        {access?.available && catalog && !loading && !error && <section className="cloud-envs-list" aria-label="已保存的环境">
          {visible.length > 0 && <div className="cloud-envs-columns"><span>环境</span><span>共享</span><span /></div>}
          {visible.map(item => <div className="cloud-envs-row" key={item.id}><div className="cloud-envs-row-label"><div className="cloud-envs-row-info"><div className="cloud-envs-name"><span title={item.name}>{item.name}</span>{item.versionRevision === 1 && <span className="cloud-envs-unpublished" title="发布后即可使用">未发布</span>}</div>{item.description && <span className="cloud-envs-description" title={item.description}>{item.description}</span>}
            <div className="cloud-envs-repositories">{item.repositories[0] && repository(item.repositories[0].id)}{item.repositories.length > 1 && <span className="cloud-envs-more-repos" tabIndex={0} title={item.repositories.slice(1).map(repo => repositoryLabel(repo.id)).join("\n")}>+{item.repositories.length - 1} 个仓库</span>}</div></div><span className="cloud-envs-sharing">{cloudSharingLabel(item)}</span></div>
            <button type="button" className="cloud-envs-actions" aria-label={`针对 ${item.name} 的操作`} aria-haspopup="menu" aria-expanded={menu?.item.id === item.id} ref={node => { if (node) rowTriggers.current.set(item.id, node); else rowTriggers.current.delete(item.id); }} onClick={event => { const trigger = event.currentTarget; const rect = trigger.getBoundingClientRect(); setMenu(menu?.item.id === item.id ? null : { item, trigger, left: Math.max(8, Math.min(rect.right - 220, window.innerWidth - 228)), top: rect.bottom + 128 < window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - 124) }); }}><Ellipsis size={16} /></button>
          </div>)}
          {!visible.length && <p className="cloud-envs-state" role="status">{query.trim() ? "没有匹配的环境" : "暂无已保存的环境"}</p>}
        </section>}
      </>}
    </div>
    {menu && createPortal(<div ref={menuRef} className="cloud-envs-menu" role="menu" aria-label={`针对 ${menu.item.name} 的操作`} style={{ left: menu.left, top: menu.top }}>{menuCanEdit && <button type="button" role="menuitem" disabled={!onOpenDraft || !!creatingId} onClick={() => void openEdit()}>{menu.item.versionRevision === 1 ? "继续设置" : "编辑"}</button>}<button type="button" role="menuitem" onClick={() => void openDetail(menu.item.id)}>查看</button><button type="button" role="menuitem" disabled title="环境删除尚未接入">删除环境</button></div>, document.body)}
  </div>;
};

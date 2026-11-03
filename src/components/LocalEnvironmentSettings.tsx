import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Play, Wrench, Bug, FlaskConical } from "lucide-react";
import { environmentDraft, environmentDraftError, environmentFromDraft, environmentPlatforms, lifecyclePreview, listLocalEnvironments, readLocalEnvironment, saveLocalEnvironment, getLocalEnvironmentSelection, selectLocalEnvironment, localEnvironmentAction,
  type EnvironmentDraft, type EnvironmentSnapshot, type EnvironmentList, type EnvironmentSelection, type EnvironmentPlatform, type EnvironmentIcon } from "../localEnvironments";
import "./LocalEnvironmentSettings.css";

type Project = { path: string; name: string };
type Guard = (action: () => void) => boolean;
type Catalog = { list?: EnvironmentList; selection?: EnvironmentSelection; loading: boolean; error?: string; selectionError?: string };
type View = { project: Project; snapshot: EnvironmentSnapshot | null; requestedPath?: string; editing: boolean; draft: EnvironmentDraft | null; initial: EnvironmentDraft | null };
const platformLabels = { default: "默认", darwin: "macOS", linux: "Linux", win32: "Windows" };
const actionIcons = { tool: Wrench, run: Play, debug: Bug, test: FlaskConical };

export function LocalEnvironmentSettings({ cwd, projects, connectionIdentity = "local", onRunCommand, onNavigationGuardChange, onAddProject }: {
  cwd: string; projects?: Project[]; connectionIdentity?: string; onRunCommand: (cwd: string, command: string) => void | Promise<void>;
  onNavigationGuardChange?: (guard: Guard | null) => void; onAddProject?: () => void;
}) {
  const projectList = [...new Map((projects ?? (cwd ? [{ path: cwd, name: cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd }] : [])).map(project => [project.path, project])).values()];
  const projectKey = JSON.stringify(projectList), context = JSON.stringify([projectKey, connectionIdentity]);
  const [catalogs, setCatalogs] = useState<Record<string, Catalog>>({}), [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({}), [inherited, setInherited] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<View | null>(null), [busy, setBusy] = useState(false), [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null), [selectionFailed, setSelectionFailed] = useState(false);
  const [setupPlatform, setSetupPlatform] = useState<"default" | EnvironmentPlatform>("default"), [cleanupPlatform, setCleanupPlatform] = useState<"default" | EnvironmentPlatform>("default");
  const [openCommands, setOpenCommands] = useState<Record<number, boolean>>({}), [confirmation, setConfirmation] = useState(false);
  const current = useRef(view); current.current = view;
  const currentContext = useRef(context); currentContext.current = context;
  const generation = useRef(0), detailRequest = useRef(0), mounted = useRef(false), operation = useRef(false), actionId = useRef(0);
  const requests = useRef(new Map<string, number>()), pendingAction = useRef<(() => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), keepEditing = useRef<HTMLButtonElement>(null), nameInput = useRef<HTMLInputElement>(null);
  const updateView = (next: View | null) => { current.current = next; setView(next); };
  const valid = (ticket: number, key: string) => mounted.current && generation.current === ticket && currentContext.current === key;
  const focusEditor = () => { const ticket = generation.current, key = currentContext.current; requestAnimationFrame(() => { if (valid(ticket, key)) nameInput.current?.focus(); }); };
  const dirty = () => Boolean(current.current?.editing && (!current.current.snapshot || JSON.stringify(current.current.draft) !== JSON.stringify(current.current.initial)));
  const guard: Guard = action => {
    if (operation.current) return false;
    if (!dirty()) return true;
    pendingAction.current = action; setConfirmation(true); return false;
  };
  const navigate = (action: () => void) => { if (guard(action)) action(); };
  const back = () => navigate(() => { detailRequest.current++; updateView(null); setError(null); setMessage(null); setSelectionFailed(false); });
  const loadProject = async (project: Project) => {
    const ticket = generation.current, key = currentContext.current, request = (requests.current.get(project.path) ?? 0) + 1; requests.current.set(project.path, request);
    setCatalogs(previous => ({ ...previous, [project.path]: { ...previous[project.path], loading: true, error: undefined, selectionError: undefined } }));
    const [list, selection] = await Promise.allSettled([listLocalEnvironments(project.path), getLocalEnvironmentSelection(project.path)]);
    if (!valid(ticket, key) || requests.current.get(project.path) !== request) return;
    setCatalogs(previous => ({ ...previous, [project.path]: { ...previous[project.path], loading: false,
      ...(list.status === "fulfilled" ? { list: list.value } : { error: String(list.reason) }), ...(selection.status === "fulfilled" ? { selection: selection.value } : { selectionError: String(selection.reason) }) } }));
  };
  const loadDetail = async (project: Project, configPath: string) => {
    const ticket = generation.current, key = context, request = ++detailRequest.current;
    updateView({ project, snapshot: null, requestedPath: configPath, editing: false, draft: null, initial: null }); setError(null); setMessage(null); setSelectionFailed(false); setLoadingDetail(true); setOpenCommands({});
    try { const snapshot = await readLocalEnvironment(project.path, configPath); if (valid(ticket, key) && request === detailRequest.current) updateView({ project, snapshot, editing: false, draft: null, initial: null }); }
    catch (cause) { if (valid(ticket, key) && request === detailRequest.current) setError(`无法加载此环境文件：${String(cause)}`); }
    finally { if (valid(ticket, key) && request === detailRequest.current) setLoadingDetail(false); }
  };
  useEffect(() => {
    mounted.current = true; generation.current++; detailRequest.current++; operation.current = false; setBusy(false); setLoadingDetail(false); setCatalogs({}); setError(null); setMessage(null); setConfirmation(false); pendingAction.current = null;
    if (!dirty()) updateView(null);
    projectList.forEach(project => { void loadProject(project); });
    return () => { mounted.current = false; generation.current++; detailRequest.current++; operation.current = false; };
  }, [context]);
  useEffect(() => { onNavigationGuardChange?.(guard); return () => onNavigationGuardChange?.(null); }, [context, onNavigationGuardChange]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty() || operation.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  useEffect(() => { if (confirmation) { dialog.current?.showModal(); keepEditing.current?.focus(); } else dialog.current?.close(); }, [confirmation]);
  const edit = () => {
    if (!current.current?.snapshot) return;
    const draft = environmentDraft(current.current.snapshot.environment); updateView({ ...current.current, editing: true, draft, initial: draft }); setError(null); setMessage(null);
    focusEditor();
  };
  const create = (project: Project) => navigate(() => {
    detailRequest.current++; const draft = environmentDraft(); updateView({ project, snapshot: null, editing: true, draft, initial: null }); setError(null); setMessage(null); setSelectionFailed(false); setSetupPlatform("default"); setCleanupPlatform("default");
    focusEditor();
  });
  const change = (draft: EnvironmentDraft) => { if (!operation.current && current.current) { updateView({ ...current.current, draft }); setError(null); setMessage(null); } };
  const select = async (project: Project, configPath: string | null) => {
    if (operation.current) return false;
    const ticket = generation.current, key = context; operation.current = true; setBusy(true); setError(null);
    try { const selection = await selectLocalEnvironment(project.path, configPath); if (!valid(ticket, key)) return false; setCatalogs(previous => ({ ...previous, [project.path]: { ...previous[project.path], selection, loading: false, selectionError: undefined } })); setSelectionFailed(false); setMessage(configPath ? "已选择本地环境" : "已选择不使用环境"); return true; }
    catch (cause) { if (valid(ticket, key)) setError(`无法选择环境：${String(cause)}`); return false; }
    finally { if (valid(ticket, key)) { operation.current = false; setBusy(false); } }
  };
  const save = async () => {
    const editor = current.current;
    if (operation.current || !editor?.editing || !editor.draft || !projectList.some(project => project.path === editor.project.path)) return false;
    const validation = environmentDraftError(editor.draft); if (validation) { setError(validation); return false; }
    const ticket = generation.current, key = context; operation.current = true; setBusy(true); setError(null); setMessage(null);
    try {
      const saved = await saveLocalEnvironment(editor.project.path, editor.snapshot?.path ?? null, environmentFromDraft(editor.draft), editor.snapshot?.expectedContent ?? null);
      if (!valid(ticket, key)) return false;
      if (!saved.exists || saved.schemaError || !saved.environment) throw Error(saved.schemaError || "保存读回未返回有效环境");
      updateView({ project: editor.project, snapshot: saved, editing: false, draft: null, initial: null }); setMessage("已保存本地环境");
      try { const selection = await selectLocalEnvironment(editor.project.path, saved.path); if (!valid(ticket, key)) return false; setCatalogs(previous => ({ ...previous, [editor.project.path]: { ...previous[editor.project.path], selection, loading: false } })); setSelectionFailed(false); }
      catch (cause) { if (valid(ticket, key)) { setSelectionFailed(true); setError(`已保存环境文件，但无法选中它：${String(cause)}`); void loadProject(editor.project); } return false; }
      if (valid(ticket, key)) void loadProject(editor.project);
      return true;
    } catch (cause) { if (valid(ticket, key)) setError(`无法保存环境：${String(cause)}`); return false; }
    finally { if (valid(ticket, key)) { operation.current = false; setBusy(false); } }
  };
  const run = async (index: number) => {
    const detail = current.current; if (operation.current || !detail?.snapshot?.exists || detail.snapshot.schemaError || dirty()) return;
    const ticket = generation.current, key = context; operation.current = true; setBusy(true); setError(null); setMessage(null);
    try { const command = await localEnvironmentAction(detail.project.path, detail.snapshot.path, detail.snapshot.content, index); if (!valid(ticket, key)) return; await onRunCommand(detail.snapshot.cwd, command); if (valid(ticket, key)) setMessage("操作已发送到终端，请查看执行输出。"); }
    catch (cause) { if (valid(ticket, key)) setError(`无法运行动作：${String(cause)}`); }
    finally { if (valid(ticket, key)) { operation.current = false; setBusy(false); } }
  };
  const draft = view?.draft, validation = draft ? environmentDraftError(draft) : null;
  const scriptSection = (kind: "setup" | "cleanup", title: string, platform: "default" | EnvironmentPlatform, setPlatform: (value: "default" | EnvironmentPlatform) => void) => {
    const lifecycle = draft ? draft[kind] : view?.snapshot?.environment?.[kind] ?? null;
    const value = draft ? platform === "default" ? lifecycle?.script ?? "" : lifecycle?.[platform]?.script ?? "" : lifecyclePreview(lifecycle, platform);
    return <section className="local-environment-section"><div className="local-environment-section-header"><div><h4>{title}</h4><p>{kind === "setup" ? "此脚本会在创建工作树时运行" : "保存清理脚本；目前尚未在删除工作树时自动运行"}</p></div>
      <select aria-label={`${title}平台`} value={platform} onChange={event => setPlatform(event.target.value as typeof platform)}>{Object.entries(platformLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      {draft ? <textarea aria-label={title} rows={6} value={value} disabled={busy} onChange={event => change({ ...draft, [kind]: platform === "default" ? { ...draft[kind], script: event.target.value } : { ...draft[kind], [platform]: { script: event.target.value } } })} /> : value ? <pre><code>{value}</code></pre> : <p className="card-subtitle-desc">未配置脚本</p>}
      {platform !== "default" && !lifecycle?.[platform]?.script && lifecycle?.script && <p className="card-subtitle-desc">无平台覆盖。使用默认脚本</p>}
    </section>;
  };
  return <div className="settings-scroll-container local-environments">
    {error && <p role="alert" className="error-banner">{error}</p>}{message && <p role="status">{message}</p>}
    {!view ? <><header className="local-environment-header"><h3>选择项目</h3>{onAddProject && <button type="button" className="secondary-btn" onClick={onAddProject}>添加项目</button>}</header>
      {!projectList.length && <p>尚无项目。添加一个项目以配置本地环境。</p>}
      {projectList.map(project => { const catalog = catalogs[project.path], environments = catalog?.list?.environments ?? [], parents = environments.filter(environment => environment.inherited); const automatic = !!catalog?.selection && !catalog.selection.explicit;
        return <section className="local-environment-project" key={project.path}><button type="button" className="local-environment-project-title" data-project-open={project.path} aria-expanded={!!expandedProjects[project.path]} onClick={() => setExpandedProjects(previous => ({ ...previous, [project.path]: !previous[project.path] }))}>{expandedProjects[project.path] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<span><strong>{project.name}</strong><small>{project.path}</small></span></button>
          {catalog?.loading && <p role="status">正在加载环境…</p>}{(catalog?.error || catalog?.selectionError) && <p role="alert">{catalog.error || catalog.selectionError}<button type="button" className="secondary-btn-sm" onClick={() => void loadProject(project)}>重试</button></p>}
          {expandedProjects[project.path] && <div className="local-environment-project-body"><div className="local-environment-section-header"><label>工作树环境 <select aria-label={`项目环境 ${project.path}`} disabled={busy || !catalog?.selection || !catalog.list} value={!catalog?.selection ? "__unknown__" : automatic ? "__default__" : catalog.selection.configPath ?? "__none__"} onChange={event => { if (!["__default__", "__unknown__"].includes(event.target.value)) void select(project, event.target.value === "__none__" ? null : event.target.value); }}>
            {!catalog?.selection && <option value="__unknown__" disabled>未读取环境选择</option>}{automatic && <option value="__default__" disabled>默认环境</option>}<option value="__none__">不使用环境</option>{environments.map(snapshot => <option key={snapshot.path} value={snapshot.path} disabled={!!snapshot.schemaError}>{snapshot.environment?.name || snapshot.fileName}</option>)}
          </select></label><button type="button" className="secondary-btn-sm" onClick={() => create(project)}>创建本地环境</button></div>
            {!environments.length && !catalog?.loading && !catalog?.error && <p>此项目尚未配置本地环境</p>}
            {environments.filter(snapshot => !snapshot.inherited || inherited[project.path]).map(snapshot => <div className="local-environment-index-row" key={snapshot.path}><button type="button" className="local-environment-open" data-environment-open={snapshot.path} onClick={() => navigate(() => { void loadDetail(project, snapshot.path); })}><strong>{snapshot.environment?.name || snapshot.fileName}</strong><small>{snapshot.path}</small>{snapshot.schemaError && <span role="alert">{snapshot.schemaError}</span>}</button>{catalog?.selection && (catalog.selection.explicit ? catalog.selection.configPath === snapshot.path : catalog?.list?.defaultPath === snapshot.path) && !snapshot.schemaError && <span>当前选择</span>}</div>)}
            {parents.length > 0 && <button type="button" className="secondary-btn-sm" aria-expanded={!!inherited[project.path]} onClick={() => setInherited(previous => ({ ...previous, [project.path]: !previous[project.path] }))}>继承环境（{parents.length}）</button>}
          </div>}
        </section>;
      })}
    </> : <>
      <nav className="local-environment-breadcrumb"><button type="button" className="secondary-btn-sm" onClick={back}>环境</button><span>/</span><span>{view.project.name}</span><span>/</span><span>{view.editing ? view.snapshot ? "编辑" : "创建本地环境" : view.snapshot?.environment?.name || view.snapshot?.fileName}</span></nav>
      <header className="local-environment-header"><h3>{view.editing ? view.snapshot ? "编辑本地环境" : "创建本地环境" : view.snapshot?.environment?.name || "本地环境"}</h3><div>
        {view.snapshot && <button type="button" className="secondary-btn-sm" disabled={busy} onClick={() => navigate(() => { void loadDetail(view.project, view.snapshot!.path); })}>重新读取</button>}
        {view.editing ? <><button type="button" className="secondary-btn-sm" onClick={() => navigate(() => { if (view.snapshot) updateView({ ...view, editing: false, draft: null, initial: null }); else updateView(null); })}>取消</button><button type="button" className="primary-btn" disabled={busy || !!validation || !dirty() || !projectList.some(project => project.path === view.project.path)} title={validation ?? undefined} onClick={() => void save()}>保存</button></> : view.snapshot && <><button type="button" className="secondary-btn" disabled={busy || !!view.snapshot.schemaError} onClick={() => void select(view.project, view.snapshot!.path)}>选择此环境</button><button type="button" className="secondary-btn" disabled={busy} onClick={edit}>编辑</button></>}
      </div></header>
      {loadingDetail && <p role="status">正在获取项目配置…</p>}{view.snapshot?.schemaError && <p role="alert">此环境文件无效。保存将替换其内容：{view.snapshot.schemaError}</p>}
      {selectionFailed && view.snapshot && <button type="button" className="secondary-btn" disabled={busy} onClick={() => void select(view.project, view.snapshot!.path)}>重试选择</button>}
      {draft && <label className="local-environment-field">名称<input ref={nameInput} aria-label="环境名称" value={draft.name} disabled={busy} onChange={event => change({ ...draft, name: event.target.value })} /></label>}
      {(draft || view.snapshot?.environment) && <>{scriptSection("setup", "设置脚本", setupPlatform, setSetupPlatform)}{scriptSection("cleanup", "清理脚本", cleanupPlatform, setCleanupPlatform)}
        <section className="local-environment-section"><div className="local-environment-section-header"><div><h4>操作</h4><p>保存操作，并在此页面将命令发送到终端</p></div>{draft && <button type="button" className="secondary-btn-sm" disabled={busy} onClick={() => change({ ...draft, actions: [...draft.actions, { id: `new-${++actionId.current}`, name: "", command: "", icon: "tool", platform: null }] })}>添加操作</button>}</div>
          {(draft?.actions ?? view.snapshot?.environment?.actions ?? []).map((action, index) => { const Icon = action.icon ? actionIcons[action.icon] : Wrench; return draft ? <div className="local-environment-action" key={draft.actions[index].id}>
            <div className="local-environment-section-header"><label>名称<input aria-label={`操作 ${index + 1} 名称`} value={action.name} disabled={busy} onChange={event => change({ ...draft, actions: draft.actions.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })} /></label><button type="button" className="secondary-btn-sm" aria-label={`删除操作 ${index + 1}`} disabled={busy} onClick={() => change({ ...draft, actions: draft.actions.filter((_, i) => i !== index) })}>删除</button></div>
            <label>图标<select aria-label={`操作 ${index + 1} 图标`} value={action.icon ?? ""} disabled={busy} onChange={event => change({ ...draft, actions: draft.actions.map((item, i) => i === index ? { ...item, icon: (event.target.value || null) as EnvironmentIcon | null } : item) })}><option value="">无</option><option value="tool">工具</option><option value="run">运行</option><option value="debug">调试</option><option value="test">测试</option></select></label>
            <label>平台<select aria-label={`操作 ${index + 1} 平台`} value={action.platform ?? ""} disabled={busy} onChange={event => change({ ...draft, actions: draft.actions.map((item, i) => i === index ? { ...item, platform: (event.target.value || null) as EnvironmentPlatform | null } : item) })}><option value="">所有平台</option>{environmentPlatforms.map(platform => <option key={platform} value={platform}>{platformLabels[platform]}</option>)}</select></label>
            <label>操作脚本<textarea aria-label={`操作 ${index + 1} 脚本`} rows={4} value={action.command} disabled={busy} onChange={event => change({ ...draft, actions: draft.actions.map((item, i) => i === index ? { ...item, command: event.target.value } : item) })} /></label>
          </div> : <div className="local-environment-action" key={index}><div className="local-environment-section-header"><strong><Icon size={16} /> {action.name}</strong><button type="button" className="secondary-btn-sm" disabled={busy || !!view.snapshot?.schemaError} onClick={() => void run(index)}>运行 {action.name}</button></div><code>{openCommands[index] ? action.command : action.command.split(/\r?\n/)[0]}</code>{action.command.includes("\n") && <button type="button" className="local-environment-command-toggle" aria-expanded={!!openCommands[index]} onClick={() => setOpenCommands(previous => ({ ...previous, [index]: !previous[index] }))}>{openCommands[index] ? `隐藏 ${action.name} 的完整命令` : `显示 ${action.name} 的完整命令`}</button>}</div>; })}
          {!(draft?.actions ?? view.snapshot?.environment?.actions)?.length && <p>添加操作，以便从本地工具栏运行命令</p>}
        </section></>}
      {error && !view.snapshot && !view.editing && <><button type="button" className="secondary-btn" onClick={back}>返回</button>{view.requestedPath && <button type="button" className="secondary-btn" onClick={() => void loadDetail(view.project, view.requestedPath!)}>重试</button>}</>}
    </>}
    <dialog ref={dialog} className="local-environment-discard" aria-labelledby="local-environment-discard-title" onCancel={event => { event.preventDefault(); setConfirmation(false); pendingAction.current = null; focusEditor(); }}>
      <h3 id="local-environment-discard-title">是否放弃本地环境草稿？</h3><p>你对该本地环境做出的所有更改都将丢失</p><div>
        <button ref={keepEditing} type="button" className="secondary-btn" onClick={() => { setConfirmation(false); pendingAction.current = null; focusEditor(); }}>继续编辑</button>
        <button type="button" className="secondary-btn" onClick={() => { const action = pendingAction.current; pendingAction.current = null; if (current.current) updateView({ ...current.current, editing: false, draft: null, initial: null }); setConfirmation(false); action?.(); }}>放弃</button>
        <button type="button" className="primary-btn" disabled={busy || !!validation} onClick={async () => { const action = pendingAction.current; pendingAction.current = null; const ok = await save(); setConfirmation(false); if (ok) action?.(); }}>保存并继续</button>
      </div>
    </dialog>
  </div>;
}

import React, { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { siteSettingsState, newEnvironmentDraft, STORED_SECRET, type EnvironmentDraft, type SiteSettingsState } from "../siteSettingsState";
import { safeSiteUrl, type SiteRecord, type SiteEnvironmentSnapshot } from "../sitesService";
import type { SiteAssetRef } from "../chatgptService";
import type { SitesClientAccess } from "../sitesClient";
import "./SiteSettingsForm.css";

interface Props {
  access: SitesClientAccess; site: SiteRecord; snapshot: SiteEnvironmentSnapshot | null; scope: AbortSignal;
  environmentError?: string; loading: boolean; sharingText: string;
  onSite: (result: { site: SiteRecord; assets: SiteAssetRef[] }) => void;
  onError?: (message: string) => void;
}
const composing = (event: React.KeyboardEvent) => event.nativeEvent.isComposing || event.keyCode === 229;
function SaveState({ status, error, unknown, onRetry }: { status: string; error: string | null; unknown?: boolean; onRetry: () => void }) {
  return <>{status === "saving" && <span role="status">正在保存…</span>}{status === "saved" && <span role="status">已保存</span>}
    {error && <div className="site-setting-save-error" role="alert"><p>{error}</p><button type="button" disabled={status === "saving"} onClick={onRetry}>{unknown ? "重新读取当前状态" : "重试"}</button></div>}</>;
}
function EnvironmentRow({ entry, index, state, change, remove }: { entry: EnvironmentDraft; index: number; state: SiteSettingsState;
  change: (entry: EnvironmentDraft) => void; remove: () => void }) {
  const replaceButton = useRef<HTMLButtonElement>(null), valueInput = useRef<HTMLInputElement>(null), returnFocus = useRef(false);
  const stored = Boolean(entry.secret && entry.storedSecret && entry.previousKey !== undefined), replacing = stored && entry.value !== STORED_SECRET, busy = state.environmentStatus === "saving";
  useEffect(() => { if (replacing) valueInput.current?.focus(); else if (returnFocus.current) { replaceButton.current?.focus(); returnFocus.current = false; } }, [replacing]);
  const restoreSecret = () => { if (entry.storedSecret && !entry.value) change({ ...entry, value: STORED_SECRET }); };
  return <div className="site-environment-edit-row" role="group" aria-label={`环境变量 ${index + 1}`} onBlur={event => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (replacing && !entry.value) restoreSecret();
    void state.commitEnvironment();
  }} onKeyDown={event => {
    if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT" && !composing(event)) { event.preventDefault(); void state.commitEnvironment(); }
  }}>
    <div className="site-environment-key"><input aria-label="密钥" placeholder="密钥" autoComplete="off" value={entry.key} disabled={stored || Boolean(busy && entry.storedSecret)} onChange={event => change({ ...entry, key: event.target.value })} /></div>
    <div className="site-environment-value">{stored && !replacing ? <button ref={replaceButton} type="button" disabled={busy} aria-label={`替换 ${entry.key} 的密钥值`} onClick={() => change({ ...entry, value: "" })}>替换密钥</button>
      : <input ref={valueInput} aria-label="值" placeholder="值" type={entry.secret ? "password" : "text"} autoComplete={entry.secret ? "new-password" : "off"} value={entry.value} disabled={Boolean(busy && entry.storedSecret)}
        onChange={event => change({ ...entry, value: event.target.value })} onKeyDown={event => { if (event.key === "Escape" && stored) { event.preventDefault(); event.stopPropagation(); returnFocus.current = true; change({ ...entry, value: STORED_SECRET }); } }} />}</div>
    <div className="site-environment-secret" title={state.environment?.requiresSecrets ? "根据数据驻留要求，所有值都必须设为机密值" : undefined}><span role={state.environment?.requiresSecrets ? "group" : undefined} tabIndex={state.environment?.requiresSecrets ? 0 : undefined}><input type="checkbox" aria-label={entry.key ? `将 ${entry.key} 视为机密` : `将环境变量 ${index + 1} 视为机密`} checked={entry.secret} disabled={Boolean(stored || state.environment?.requiresSecrets || busy && entry.storedSecret)} onChange={event => { change({ ...entry, secret: event.target.checked }); void state.commitEnvironment(); }} /></span></div>
    <button type="button" className="site-environment-remove" aria-label="删除此项" disabled={busy} onClick={remove}><Trash2 size={16} /></button>
  </div>;
}
export function SiteSettingsForm({ access, site, snapshot, scope, environmentError, loading, sharingText, onSite, onError }: Props) {
  const state = siteSettingsState(access, site, snapshot, scope, onSite, onError), [, update] = useState(0), [deleteTarget, setDeleteTarget] = useState<{ rowId: string; key: string } | null>(null);
  const confirmation = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null), removedTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => state.subscribe(() => update(value => value + 1)), [state]);
  useEffect(() => () => state.flush(), [state]);
  useEffect(() => { if (deleteTarget !== null) { confirmation.current?.showModal(); cancel.current?.focus(); } }, [deleteTarget]);
  const closeDelete = () => { confirmation.current?.close(); setDeleteTarget(null); removedTrigger.current?.focus(); };
  const change = (index: number, entry: EnvironmentDraft) => state.editEnvironment(state.entries!.map((value, i) => i === index ? entry : value));
  const remove = (index: number) => { state.editEnvironment(state.entries!.filter((_, i) => i !== index)); void state.commitEnvironment(); };
  return <>
    <section className="site-general-edit"><h2>常规</h2><div className="sites-setting-row site-title-setting"><div><label htmlFor={`site-title-${site.id}`}>名称</label><p>你的站点名称</p></div><input id={`site-title-${site.id}`} aria-label="站点标题" maxLength={100} value={state.title} onChange={event => state.changeTitle(event.target.value)}
      onCompositionStart={() => state.composeTitle(true)} onCompositionEnd={() => state.composeTitle(false)} onBlur={() => void state.commitTitle()} onKeyDown={event => { if (event.key === "Enter" && !composing(event)) { event.preventDefault(); void state.commitTitle(); } }} /></div>
      <SaveState status={state.titleStatus} error={state.titleError} unknown={state.titleUnknown} onRetry={() => void (state.titleUnknown ? state.recoverTitle() : state.commitTitle())} />
      <div className="sites-setting-row"><div>URL<p>{safeSiteUrl(site.hostedUrl ?? site.liveUrl) ?? "未发布"}</p></div><button type="button" disabled title="站点 URL 更改尚未接入">更改</button></div>
      <div className="sites-setting-row"><div>共享设置<p>{sharingText}</p></div><button type="button" disabled title="共享设置写入尚未接入">管理</button></div>
    </section>
    <section className="site-environment-edit"><div className="site-environment-heading"><div><h2>环境变量</h2><p>添加网站所需的 API 密钥和其他环境变量</p></div>{state.entries && <button className="site-environment-add" type="button" onClick={() => state.editEnvironment([...state.entries!, newEnvironmentDraft(state.environment?.requiresSecrets === true)])}><Plus size={16} />添加变量</button>}</div>{loading && <p role="status">正在读取配置…</p>}{environmentError && <p role="alert">{environmentError}</p>}
      {Boolean(state.entries?.length) && <div className="site-environment-grid"><div className="site-environment-columns" aria-hidden="true"><span>键</span><span>值</span><span>机密</span><span /></div>{state.entries?.map((entry, index) => <EnvironmentRow key={entry.rowId} entry={entry} index={index} state={state} change={value => change(index, value)} remove={() => {
        if (state.needsDeleteConfirmation(entry)) { removedTrigger.current = document.activeElement as HTMLButtonElement; setDeleteTarget({ rowId: entry.rowId, key: entry.key }); } else remove(index);
      }} />)}</div>}
      {state.validation && <p role="alert">{state.validation}</p>}
      <SaveState status={state.environmentStatus} error={state.environmentError} unknown={state.environmentUnknown} onRetry={() => void state.recoverEnvironment()} />
    </section>
    {deleteTarget !== null && <dialog ref={confirmation} className="site-environment-delete" aria-labelledby={`site-delete-title-${site.id}`} aria-describedby={`site-delete-description-${site.id}`} onCancel={event => { event.preventDefault(); closeDelete(); }}><h2 id={`site-delete-title-${site.id}`}>确定要删除环境变量吗？</h2><p id={`site-delete-description-${site.id}`}>{deleteTarget.key ? `这将删除 ${deleteTarget.key}。` : ""}依赖此变量的网站功能可能会停止运行。此操作无法撤销。</p><div><button ref={cancel} type="button" onClick={closeDelete}>取消</button><button type="button" disabled={state.environmentStatus === "saving" || !state.entries?.some(entry => entry.rowId === deleteTarget.rowId && entry.key === deleteTarget.key)} onClick={() => { const index = state.entries?.findIndex(entry => entry.rowId === deleteTarget.rowId && entry.key === deleteTarget.key) ?? -1; if (index >= 0) remove(index); closeDelete(); }}>删除变量</button></div></dialog>}
  </>;
}

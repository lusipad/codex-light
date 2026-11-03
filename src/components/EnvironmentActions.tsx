import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Play, Wrench, Bug, FlaskConical, Check } from "lucide-react";
import { environmentActionItems, environmentActionRequest, getEnvironmentRuntime, getRecentEnvironmentActions, recordEnvironmentAction, selectEnvironmentRuntime, sortEnvironmentActions } from "../environmentActions";
import type { EnvironmentActionItem, EnvironmentActionRunRequest, EnvironmentRuntime } from "../environmentActions";
import { readLocalEnvironment, saveLocalEnvironment } from "../localEnvironments";
import type { EnvironmentSnapshot } from "../localEnvironments";
import { effectiveBindings } from "../shortcuts";
import type { KeyBinding } from "../shortcuts";
import "./EnvironmentActions.css";

interface Props {
  cwd: string; conversationId: string | null; connectionIdentity: string;
  onRun: (request: EnvironmentActionRunRequest) => Promise<void>;
  onOpenSettings: (target: { cwd: string; configPath: string | null; edit?: boolean }) => void;
  onRegisterRun?: (runner: ((index: number) => boolean) | null) => void;
  keyBindings?: KeyBinding[];
}
const actionIcon = (icon: string | null) => icon === "run" ? Play : icon === "debug" ? Bug : icon === "test" ? FlaskConical : Wrench;
export function EnvironmentActions({ cwd, conversationId, connectionIdentity, onRun, onOpenSettings, onRegisterRun, keyBindings = [] }: Props) {
  const [runtime, setRuntime] = useState<EnvironmentRuntime | null>(null), [recent, setRecent] = useState<string[]>([]), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [status, setStatus] = useState(""), [open, setOpen] = useState(false), [environmentsOpen, setEnvironmentsOpen] = useState(false), [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false), [revision, setRevision] = useState<EnvironmentSnapshot | null>(null), [name, setName] = useState(""), [command, setCommand] = useState(""), [icon, setIcon] = useState("tool");
  const scope = `${connectionIdentity}\u0000${cwd}\u0000${conversationId}`, currentScope = useRef(scope), generation = useRef(0), running = useRef(false), mounted = useRef(true);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDialogElement>(null);
  currentScope.current = scope;
  const valid = (ticket: number, key: string) => mounted.current && generation.current === ticket && currentScope.current === key;
  const close = () => { setOpen(false); setEnvironmentsOpen(false); trigger.current?.focus(); };
  const apply = async (value: EnvironmentRuntime, ticket: number, key: string) => {
    if (!valid(ticket, key)) return;
    setRuntime(value); setRecent([]);
    if (value.selected?.environment && !value.selected.schemaError) {
      const next = await getRecentEnvironmentActions(cwd, value.selected.path);
      if (valid(ticket, key)) setRecent(next);
    }
  };
  const load = async () => {
    const ticket = ++generation.current, key = scope; setLoading(true); setError("");
    try { await apply(await getEnvironmentRuntime(cwd), ticket, key); } catch (cause) { if (valid(ticket, key)) setError(String(cause)); }
    finally { if (valid(ticket, key)) setLoading(false); }
  };
  useEffect(() => { mounted.current = true; setRuntime(null); setRecent([]); setStatus(""); setOpen(false); setEnvironmentsOpen(false); setAdding(false); setRevision(null); running.current = false; setBusy(false); void load(); return () => { mounted.current = false; generation.current++; }; }, [scope]);
  const selected = runtime?.selected ?? null;
  const items = environmentActionItems(selected, runtime?.platform ?? "win32"), sorted = sortEnvironmentActions(items, recent);
  const unavailable = loading || busy || !conversationId || !selected?.exists || !selected.environment || !!selected.schemaError;
  const run = async (item: EnvironmentActionItem, snapshot = selected) => {
    if (!conversationId || !snapshot?.exists || !snapshot.environment || snapshot.schemaError || running.current || loading) return;
    const ticket = generation.current, key = scope; running.current = true; setBusy(true); setError(""); setStatus(""); close();
    try {
      await onRun(environmentActionRequest(conversationId, cwd, snapshot, item));
      if (!valid(ticket, key)) return;
      setStatus("操作已发送到终端");
      const next = await recordEnvironmentAction(cwd, snapshot, item.index);
      if (valid(ticket, key)) setRecent(next);
    } catch (cause) { if (valid(ticket, key)) setError(String(cause)); }
    finally { if (valid(ticket, key)) { running.current = false; setBusy(false); } }
  };
  const runner = useRef<(index: number) => boolean>(() => false);
  runner.current = index => { const item = items[index]; if (unavailable || running.current || !item || adding) return false; void run(item); return true; };
  useEffect(() => { onRegisterRun?.(index => runner.current(index)); return () => onRegisterRun?.(null); }, [onRegisterRun]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", outside); return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => { if (adding && dialog.current && !dialog.current.open) dialog.current.showModal(); else if (!adding && dialog.current?.open) dialog.current.close(); }, [adding]);
  const settings = () => { close(); onOpenSettings({ cwd, configPath: selected?.path ?? runtime?.selection.configPath ?? null }); };
  const select = async (configPath: string | null) => {
    if (running.current || loading) return;
    const ticket = ++generation.current, key = scope; running.current = true; setBusy(true); setError(""); setStatus(""); close();
    try { const value = await selectEnvironmentRuntime(cwd, configPath); if (value.selection.configPath !== configPath || !value.selection.explicit) throw Error("环境选择读回不一致，请重试"); await apply(value, ticket, key); }
    catch (cause) { if (valid(ticket, key)) setError(String(cause)); }
    finally { if (valid(ticket, key)) { running.current = false; setBusy(false); } }
  };
  const add = async () => {
    if (!selected?.exists || running.current) return;
    const ticket = generation.current, key = scope; close(); setAdding(true); setRevision(null); setName(""); setCommand(""); setIcon("tool"); setError("");
    try { const value = await readLocalEnvironment(cwd, selected.path); if (valid(ticket, key)) { if (!value.environment || value.schemaError || !value.exists) throw Error("无法加载环境文件。请关闭此对话框后重试"); setRevision(value); } }
    catch (cause) { if (valid(ticket, key)) setError(String(cause)); }
  };
  const save = async () => {
    if (!revision?.environment || !name.trim() || !command.trim() || running.current) return;
    const ticket = generation.current, key = scope; running.current = true; setBusy(true); setError("");
    const action = { name: name.trim(), command, icon: icon as "tool" | "run" | "debug" | "test", platform: null };
    const index = revision.environment.actions.length;
    try {
      const saved = await saveLocalEnvironment(cwd, revision.path, { ...revision.environment, actions: [...revision.environment.actions, action] }, revision.content);
      if (!valid(ticket, key)) return;
      const read = await readLocalEnvironment(cwd, saved.path);
      if (!valid(ticket, key)) return;
      const actual = read.environment?.actions[index];
      if (read.content !== saved.content || !actual || actual.name !== action.name || actual.command !== action.command || actual.icon !== action.icon || actual.platform !== null) throw Error("操作保存读回不一致，未运行操作");
      setRuntime(previous => previous ? { ...previous, selected: read, list: { ...previous.list, environments: previous.list.environments.map(value => value.path === read.path ? read : value) } } : previous);
      setAdding(false); setRevision(null); running.current = false; setBusy(false);
      const ordinal = environmentActionItems(read, runtime?.platform ?? "win32").find(item => item.index === index)?.ordinal;
      if (ordinal !== undefined) await run({ action: actual, index, ordinal }, read);
    } catch (cause) { if (valid(ticket, key)) setError(String(cause)); }
    finally { if (valid(ticket, key)) { running.current = false; setBusy(false); } }
  };
  const keydown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === "Tab") { close(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (!buttons.length) return;
    event.preventDefault(); event.stopPropagation(); const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };
  const primary = sorted[0], Icon = actionIcon(primary?.action.icon ?? null);
  return <div className="environment-actions" ref={root}>
    <button className="environment-actions-trigger" type="button" ref={trigger} aria-label="操作" title="操作" aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(!open); setEnvironmentsOpen(false); }}><ChevronDown size={16} /></button>
    {primary && !selected?.schemaError && <button className="environment-actions-trigger" type="button" aria-label={`运行：${primary.action.name}`} title={`运行：${primary.action.name}`} disabled={unavailable} onClick={() => void run(primary)}><Icon size={16} /></button>}
    {open && <div className="environment-actions-menu" role="menu" aria-label="操作" ref={menu} onKeyDown={keydown}>
      {loading ? <span role="status">正在加载环境…</span> : <>
        {selected?.schemaError || (selected && !selected.exists) || (runtime?.selection.configPath && !selected) ? <button role="menuitem" type="button" onClick={settings}>修复本地环境</button> : null}
        {!!sorted.length && <><div className="environment-actions-title">操作</div><div className="environment-actions-list">{sorted.map(item => { const ItemIcon = actionIcon(item.action.icon); return <button role="menuitem" type="button" key={item.index} disabled={unavailable} onClick={() => void run(item)} data-environment-action-index={item.index}><ItemIcon size={16} /><span>{item.action.name}</span><kbd>{effectiveBindings(`environment-action-${item.ordinal + 1}`, keyBindings).join(" / ")}</kbd></button>; })}</div></>}
        {selected?.exists && selected.environment && !selected.schemaError && <button role="menuitem" type="button" disabled={busy} onClick={() => void add()}>添加操作</button>}
        <button role="menuitem" type="button" aria-haspopup="menu" aria-expanded={environmentsOpen} disabled={busy} onClick={() => setEnvironmentsOpen(!environmentsOpen)}>更改环境</button>
        {environmentsOpen && <div role="menu" aria-label="更改环境" className="environment-actions-environments"><button role="menuitemradio" aria-checked={!!runtime?.selection.explicit && runtime.selection.configPath === null} type="button" onClick={() => void select(null)}>无环境</button>{runtime?.list.environments.map(value => <button role="menuitemradio" aria-checked={selected?.path === value.path} type="button" key={value.path} disabled={busy} onClick={() => void select(value.path)}>{selected?.path === value.path && <Check size={14} />}<span>{value.environment?.name || value.fileName}{runtime.list.defaultPath === value.path ? " · 默认环境" : ""}</span><small>{value.path}</small></button>)}</div>}
        <button role="menuitem" type="button" onClick={settings}>环境设置</button>
      </>}
      {!!error && <><p role="alert">{error}</p><button role="menuitem" type="button" disabled={busy} onClick={() => void load()}>重新加载环境</button></>}
    </div>}
    {!!error && !open && !adding && <span className="environment-actions-feedback" role="alert">{error}</span>}
    {!!status && <span className="environment-actions-feedback" role="status">{status}</span>}
    <dialog className="environment-action-dialog" ref={dialog} aria-label="添加操作" onCancel={event => { event.preventDefault(); if (!busy) { setAdding(false); trigger.current?.focus(); } }}>
      {adding && <><h3>添加操作</h3><p>创建可从工具栏运行的新命令</p><label>操作名称<input aria-label="操作名称" value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label><label>图标<select aria-label="操作图标" value={icon} disabled={busy} onChange={event => setIcon(event.target.value)}><option value="tool">工具</option><option value="run">运行</option><option value="debug">调试</option><option value="test">测试</option></select></label><label>命令<textarea aria-label="操作命令" rows={4} value={command} disabled={busy} onChange={event => setCommand(event.target.value)} /></label>{!revision && !error && <span role="status">正在加载环境…</span>}{!!error && <p role="alert">{error}</p>}<footer><button type="button" disabled={busy} onClick={() => { setAdding(false); trigger.current?.focus(); }}>取消</button><button type="button" disabled={busy || !revision || !name.trim() || !command.trim()} onClick={() => void save()}>保存</button></footer></>}
    </dialog>
  </div>;
}

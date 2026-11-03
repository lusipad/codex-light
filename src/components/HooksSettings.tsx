import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, FileText, Folder, Puzzle, TriangleAlert } from "lucide-react";
import { listHooks, type HookInfo, type HooksListResult } from "../hooksClient";
import { writeHookState } from "../hookState";
import { buildHookSourceSections, groupHookEvents, hookNeedsReview, type HookSourceEntry, type HookSourceId } from "../hooksSettingsModel";
import { tauriInvoke } from "../bridge";
import "./HooksSettings.css";

const sourceLabels: Record<HookSourceId, string> = { plugin: "插件", user: "用户配置", admin: "管理员配置", project: "项目配置", sessionFlags: "会话标记", unknown: "未知来源" };
const events: Record<string, [string, string]> = {
  preToolUse: ["PreToolUse", "工具执行前"], permissionRequest: ["PermissionRequest", "当请求权限时"], postToolUse: ["PostToolUse", "工具执行后"],
  preCompact: ["PreCompact", "在 ChatGPT 压缩对话之前"], postCompact: ["PostCompact", "在 ChatGPT 压缩对话之后"],
  sessionStart: ["SessionStart", "当新会话开始时"], sessionEnd: ["会话结束", "会话结束时"], userPromptSubmit: ["UserPromptSubmit", "当用户提交提示时"],
  subagentStart: ["子智能体启动", "子智能体启动时"], subagentStop: ["子智能体停止", "当子智能体停止时"], stop: ["Stop", "在 ChatGPT 结束本轮响应之前"],
  interrupt: ["中断", "当某个轮次被中断时"], preModelRequest: ["模型请求前", "在向模型发送请求之前"], postModelRequest: ["模型请求后", "收到模型响应后"],
};
const managed = (hook: HookInfo) => hook.isManaged || hook.trustStatus === "managed";
const sourceTitle = (entry: HookSourceEntry) => entry.source === "plugin" ? entry.pluginId?.split("@")[0] || "未知插件" : entry.source === "project" ? entry.cwd.split(/[\\/]/).filter(Boolean).at(-1) || entry.cwd : sourceLabels[entry.source];
const hookTitle = (hook: HookInfo, index: number) => hook.statusMessage?.trim() ? `${index + 1} - ${hook.statusMessage.trim()}` : `钩子 ${index + 1}`;

export function HooksSettings({ activeWorkspaceRoot, workspaceRoots, connectionIdentity = "local" }: { activeWorkspaceRoot: string; workspaceRoots?: string[]; connectionIdentity?: string }) {
  const cwds = workspaceRoots ?? (activeWorkspaceRoot ? [activeWorkspaceRoot] : []);
  const context = JSON.stringify([activeWorkspaceRoot, cwds, connectionIdentity]);
  const [data, setData] = useState<HooksListResult | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const [selection, setSelection] = useState<string | null>(null), [expanded, setExpanded] = useState<Record<string, string | null>>({});
  const [issuesExpanded, setIssuesExpanded] = useState(false);
  const generation = useRef(0), viewGeneration = useRef(0), operation = useRef(false), active = useRef(false);
  const currentContext = useRef(context); currentContext.current = context;
  const selectedKey = useRef(selection); selectedKey.current = selection;
  const dialog = useRef<HTMLDialogElement>(null), closeButton = useRef<HTMLButtonElement>(null), reloadButton = useRef<HTMLButtonElement>(null);
  const sourceButtons = useRef(new Map<string, HTMLButtonElement>()), previous = useRef<{ context: string; key: string } | null>(null);
  const valid = (version: number, key: string) => active.current && generation.current === version && currentContext.current === key;
  const run = async (action: () => Promise<HooksListResult>, saved = false, view = viewGeneration.current) => {
    if (operation.current || !cwds.length) return;
    const version = generation.current, key = context;
    operation.current = true; setBusy(true); setError(null); setMessage(null);
    try {
      const updated = await action();
      if (!valid(version, key) || saved && viewGeneration.current !== view) return;
      setData(updated); if (saved) setMessage("已保存");
    } catch (cause) {
      if (valid(version, key) && (!saved || viewGeneration.current === view)) setError(String(cause));
    } finally {
      if (valid(version, key)) { operation.current = false; setBusy(false); }
    }
  };
  useEffect(() => {
    active.current = true; generation.current++; viewGeneration.current++; operation.current = false;
    selectedKey.current = null; previous.current = null; setSelection(null); setExpanded({}); setIssuesExpanded(false); setData(null); setError(null); setMessage(null);
    if (cwds.length) void run(() => listHooks(cwds));
    else { setBusy(false); setData({ groups: [], hooks: [], warnings: [], errors: [] }); }
    return () => { active.current = false; generation.current++; viewGeneration.current++; operation.current = false; };
  }, [context]);
  useEffect(() => {
    if (selection && selectedKey.current === selection) {
      previous.current = { context, key: selection };
      if (!dialog.current?.open) dialog.current?.showModal(); closeButton.current?.focus();
    } else {
      dialog.current?.close(); const old = previous.current; previous.current = null;
      if (old?.context === context) requestAnimationFrame(() => {
        if (active.current && currentContext.current === old.context && !selectedKey.current) (sourceButtons.current.get(old.key) ?? reloadButton.current)?.focus();
      });
    }
  }, [selection, context]);
  const sections = data ? buildHookSourceSections(data) : [];
  const entries = sections.flatMap(section => section.entries.length ? section.entries : section.entry ? [section.entry] : []).filter(entry => entry.source !== "project" || cwds.includes(entry.cwd));
  const selected = entries.find(entry => entry.key === selection) ?? null;
  const groups = selected ? groupHookEvents(selected) : [];
  const review = selected?.hooks.filter(hook => !managed(hook) && hookNeedsReview(hook)) ?? [];
  const close = () => { viewGeneration.current++; selectedKey.current = null; setSelection(null); setExpanded({}); setIssuesExpanded(false); setError(null); setMessage(null); };
  const open = (entry: HookSourceEntry) => { viewGeneration.current++; selectedKey.current = entry.key; setSelection(entry.key); setExpanded({}); setIssuesExpanded(false); setError(null); setMessage(null); };
  const write = (hooks: HookInfo[], change: "trust" | boolean) => {
    if (!selection || hooks.some(hook => managed(hook) || !hook.currentHash || !hook.raw?.key || change !== "trust" && hook.trustStatus !== "trusted")) return;
    const view = viewGeneration.current, version = generation.current, key = context, source = selection;
    void run(() => writeHookState(cwds, hooks, change, { isCurrent: () => valid(version, key) && selectedKey.current === source && viewGeneration.current === view }), true, view);
  };
  const openFile = async (hook: HookInfo) => {
    const version = generation.current, key = context, view = viewGeneration.current;
    try { await tauriInvoke("open_path_external", { path: hook.sourcePath }); }
    catch (cause) { if (valid(version, key) && viewGeneration.current === view) setError(String(cause)); }
  };
  const indexGroups: [string, HookSourceId[]][] = [["来自配置", ["user", "admin"]], ["来自插件", ["plugin"]], ["来自项目配置文件", ["project"]], ["其他来源", ["sessionFlags", "unknown"]]];
  const issues = selected ? selected.warnings.length + selected.errors.length : 0;
  return <div className="settings-scroll-container hooks-settings">
    <div className="hooks-settings-header"><h3>钩子</h3><button ref={reloadButton} type="button" className="secondary-btn" disabled={busy || !cwds.length} onClick={() => void run(() => listHooks(cwds))}>重新加载钩子</button></div>
    {busy && !data && <p role="status">正在加载钩子…</p>}
    {!selection && error && <p role="alert" className="error-banner">无法加载钩子：{error}</p>}
    {data && !entries.length && <div className="hooks-empty"><strong>未找到钩子</strong><p>已配置的钩子将显示在此处</p></div>}
    {indexGroups.map(([label, sources]) => {
      const rows = entries.filter(entry => sources.includes(entry.source));
      return rows.length > 0 && <section className="hooks-source-section" key={label}><h4>{label}</h4><div className="hooks-source-list">
        {rows.map(entry => <button ref={node => { if (node) sourceButtons.current.set(entry.key, node); else sourceButtons.current.delete(entry.key); }} key={entry.key}
          type="button" className="hooks-source-row" data-hook-source={entry.key} aria-label={`查看来源：${sourceTitle(entry)}`} onClick={() => open(entry)}>
          <span className="hooks-source-icon" aria-hidden="true">{entry.source === "plugin" ? <Puzzle size={18} /> : entry.source === "project" ? <Folder size={18} /> : <FileText size={18} />}</span>
          <span className="hooks-source-main"><strong>{sourceTitle(entry)}</strong><span>{entry.installed} 个钩子</span></span>
          <span className="hooks-source-attention">{entry.needsReview > 0 && `${entry.needsReview} 项待审核`}{entry.needsReview > 0 && entry.errors.length + entry.warnings.length > 0 && " · "}{entry.errors.length + entry.warnings.length > 0 && `${entry.errors.length + entry.warnings.length} 个问题`}</span>
          {entry.needsReview + entry.errors.length + entry.warnings.length > 0 && <TriangleAlert size={15} className="hooks-attention-icon" aria-label="需要注意" />}<ChevronRight size={16} aria-hidden="true" />
        </button>)}
      </div></section>;
    })}
    <dialog ref={dialog} className="hooks-source-drawer" aria-labelledby="hooks-source-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className="hooks-drawer-content"><header className="hooks-drawer-header"><div><h2 id="hooks-source-title">{selected ? sourceTitle(selected) : "钩子"}</h2><p>{selected?.source === "project" ? selected.cwd : "所有项目"}</p></div><button ref={closeButton} type="button" className="secondary-btn-sm" onClick={close}>关闭</button></header>
        <div className="hooks-drawer-body">
          {busy && <p role="status">正在处理…</p>}{error && <div role="alert" className="error-banner">{error}<button type="button" className="secondary-btn-sm" disabled={busy} onClick={() => void run(() => listHooks(cwds))}>重新加载钩子</button></div>}{message && <p role="status">{message}</p>}
          {!selected && <p>此来源已不可用，请重新加载钩子。</p>}
          {issues > 0 && <div className="hooks-issues"><button type="button" className="hooks-review-button" aria-expanded={issuesExpanded} onClick={() => setIssuesExpanded(value => !value)}>此源有 {issues} 个钩子加载问题</button>
            {issuesExpanded && <ul>{selected?.warnings.map(item => <li key={`warning:${item}`}>{item}</li>)}{selected?.errors.map(item => <li key={`${item.path}:${item.message}`} role="alert">{item.path}：{item.message}</li>)}</ul>}</div>}
          {review.length > 0 && <div className="hooks-review-summary"><p>Hook 在沙盒外运行，可能存在安全风险</p><button type="button" className="secondary-btn" disabled={busy || review.some(hook => !hook.currentHash || !hook.raw?.key)} onClick={() => write(review, "trust")}>全部信任</button></div>}
          {groups.map(group => <section className="hooks-event-group" key={group.event}><header><h4>{events[group.event]?.[0] ?? group.event}</h4>{events[group.event] && <p>{events[group.event][1]}</p>}{group.needsReview > 0 && <span className="hooks-review-count">{group.needsReview} 项待审核</span>}</header>
            {group.hooks.map((hook, index) => {
              const title = hookTitle(hook, index), isManaged = managed(hook), needsReview = hookNeedsReview(hook), isOpen = expanded[group.event] === hook.id;
              const disabled = busy || isManaged || hook.trustStatus !== "trusted" || !hook.currentHash || !hook.raw?.key;
              const hint = isManaged ? "受管理的钩子始终处于开启状态" : needsReview ? "钩子在标记为可信之前保持禁用" : undefined;
              const canOpenFile = !isManaged && typeof hook.sourcePath === "string" && /^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(hook.sourcePath);
              return <div className="hooks-hook-row" key={hook.id}><div className="hooks-hook-controls">
                <button type="button" className="hooks-review-button" data-hook-row={hook.id} aria-expanded={isOpen} onClick={() => setExpanded(current => ({ ...current, [group.event]: isOpen ? null : hook.id }))}>{isOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}{title}</button>
                {canOpenFile && <button type="button" className="hooks-open-file" aria-label={`打开配置文件：${title}`} title="打开配置文件" onClick={() => void openFile(hook)}><ExternalLink size={14} /></button>}
                <span className="hooks-toggle-wrap" role={disabled ? "switch" : undefined} tabIndex={disabled ? 0 : undefined} aria-label={disabled ? title : undefined}
                  aria-checked={disabled ? isManaged || hook.enabled && !needsReview : undefined} aria-disabled={disabled || undefined} aria-description={hint} title={hint}>
                  <button type="button" role={disabled ? undefined : "switch"} className="hooks-toggle" data-hook-toggle={hook.id} aria-label={title} aria-checked={isManaged || hook.enabled && !needsReview} aria-hidden={disabled || undefined} tabIndex={disabled ? -1 : undefined} disabled={disabled}
                    onClick={() => write([hook], !hook.enabled)}><span /></button>
                </span>
              </div>
                {isOpen && <div className="hooks-hook-details">
                  {needsReview && !isManaged && <div className="hooks-review-summary"><span>{hook.trustStatus === "modified" ? "钩子自上次标记为可信后已更改" : "新钩子"}</span><button type="button" className="secondary-btn-sm" disabled={busy || !hook.currentHash || !hook.raw?.key} onClick={() => write([hook], "trust")}>信任</button></div>}
                  <dl><dt>来源</dt><dd>{hook.sourcePath || (selected ? sourceTitle(selected) : hook.source)}</dd><dt>Hook 类型</dt><dd>{events[hook.event]?.[0] ?? hook.event}</dd>
                    {(hook.handlerType === "prompt" || hook.handlerType === "agent") && <><dt>处理程序</dt><dd>{hook.handlerType === "prompt" ? "提示" : "智能体"}</dd></>}
                    {hook.handlerType === "command" && typeof (hook.raw?.command ?? hook.command) === "string" && <><dt>命令</dt><dd><code>{String(hook.raw?.command ?? hook.command)}</code></dd></>}
                    {hook.handlerType === "mcpTool" && <>{typeof hook.raw?.server === "string" && <><dt>MCP 服务器</dt><dd><code>{hook.raw.server}</code></dd></>}{typeof hook.raw?.tool === "string" && <><dt>工具</dt><dd><code>{hook.raw.tool}</code></dd></>}</>}
                    {hook.matcher != null && <><dt>匹配器</dt><dd><code>{hook.matcher}</code></dd></>}{typeof hook.timeoutSec === "number" && <><dt>超时</dt><dd>{hook.timeoutSec} 秒</dd></>}
                  </dl>
                </div>}
              </div>;
            })}
          </section>)}
        </div>
      </div>
    </dialog>
  </div>;
}

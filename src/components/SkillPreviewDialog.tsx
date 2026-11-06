import React, { useEffect, useRef, useState } from "react";
import { BookOpen, MoreHorizontal, X } from "lucide-react";
import { copyTextToClipboard } from "../clipboard";
import { tauriInvoke } from "../bridge";
import { skillPreviewMarkdown } from "../skillPreview";
import { MarkdownView } from "./MarkdownView";
import "./SkillPreviewDialog.css";

interface SkillPreviewDialogProps {
  identity: string;
  name: string;
  rawName: string;
  description: string;
  path: string;
  enabled?: boolean;
  busy: boolean;
  localHost: boolean;
  canRetry?: boolean;
  actionFeedback?: { kind: "success" | "error"; text: string } | null;
  loadContents: () => Promise<string>;
  onClose: () => void;
  onToggle?: () => void;
  onOpen?: () => boolean | Promise<boolean>;
  onTry?: () => boolean | Promise<boolean>;
  onUninstall?: () => void;
}

export function SkillPreviewDialog({ name, rawName, description, path, enabled, busy, localHost, canRetry = !!path, actionFeedback, loadContents, onClose, onToggle, onOpen, onTry, onUninstall }: SkillPreviewDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [contents, setContents] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [hostBusy, setHostBusy] = useState(false);
  const hostPending = useRef(false);
  const mounted = useRef(false);
  const transferFocus = useRef(false);
  const composing = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const previousFocus = document.activeElement;
    dialogRef.current?.showModal();
    return () => {
      mounted.current = false;
      dialogRef.current?.close();
      if (!transferFocus.current && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    let current = true;
    setContents(undefined);
    setError(null);
    void loadContents().then(value => {
      if (current) setContents(value);
    }, failure => {
      if (current) setError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => { current = false; };
  }, [attempt]);

  useEffect(() => {
    if (menuOpen) dialogRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [menuOpen]);

  useEffect(() => { setFeedback(null); }, [actionFeedback]);

  const acceptHostAction = async (action: (() => boolean | Promise<boolean>) | undefined) => {
    if (!action || hostPending.current) return;
    hostPending.current = true;
    setHostBusy(true);
    transferFocus.current = true;
    try {
      if (await action() === true) { if (mounted.current) onClose(); }
      else {
        transferFocus.current = false;
        if (mounted.current) setFeedback("未打开，请先处理工作区中的未保存修改后重试。");
      }
    } catch (failure) {
      transferFocus.current = false;
      if (mounted.current) setFeedback(`无法打开技能：${String(failure)}`);
    } finally {
      hostPending.current = false;
      if (mounted.current) setHostBusy(false);
    }
  };
  const markdown = contents === undefined ? "" : skillPreviewMarkdown(contents, path, rawName);
  return <dialog ref={dialogRef} className="pm-skill-preview" aria-labelledby="pm-skill-preview-title"
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={event => {
      event.stopPropagation();
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
        if (event.key === "Enter" || event.key === "Escape") event.preventDefault();
        return;
      }
      if (event.key === "Tab") {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'))
          .filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1), active = event.currentTarget.ownerDocument.activeElement;
        if (!first) event.preventDefault();
        else if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) { event.preventDefault(); first.focus(); }
      }
    }}
    onCancel={event => {
      event.preventDefault();
      if (menuOpen) { setMenuOpen(false); menuButtonRef.current?.focus(); }
      else onClose();
    }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="pm-skill-preview-inner" onClick={() => { if (menuOpen) setMenuOpen(false); }}>
      <header className="pm-skill-preview-header">
        <span className="pm-skill-preview-icon"><BookOpen size={24} /></span>
        <div className="pm-skill-preview-heading">
          <h2 id="pm-skill-preview-title"><span className="pm-skill-preview-title">{name}</span>{enabled === false && <span className="tag-badge">已禁用</span>}</h2>
          {description && <p className="pm-skill-preview-description">{description}</p>}
        </div>
        <div className="pm-skill-preview-actions">
          {enabled !== undefined && onToggle && <button type="button" role="switch" aria-checked={enabled}
            className={`pm-skill-toggle ${enabled ? "on" : ""}`} aria-label={enabled ? "禁用技能" : "启用技能"}
            disabled={busy} onClick={onToggle} />}
          <div className="pm-skill-preview-more">
            <button type="button" ref={menuButtonRef} className="pm-skill-preview-icon-button" aria-label="更多操作"
              aria-haspopup="menu" aria-expanded={menuOpen} onClick={event => { event.stopPropagation(); setMenuOpen(!menuOpen); }}><MoreHorizontal size={18} /></button>
            {menuOpen && <div className="pm-skill-preview-menu" role="menu" aria-label="技能操作" onClick={event => event.stopPropagation()}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); menuButtonRef.current?.focus(); }
                else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
                  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                  buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length]?.focus();
                }
              }}>
              <button type="button" role="menuitem" disabled={!localHost || !path || !onOpen || hostBusy} onClick={() => acceptHostAction(onOpen)}>打开</button>
              <button type="button" role="menuitem" disabled={!localHost || !path} onClick={async () => {
                setMenuOpen(false);
                try { await tauriInvoke("reveal_path_in_explorer", { path }); }
                catch (failure) { if (mounted.current) setFeedback(`无法显示技能文件：${String(failure)}`); }
              }}>在文件资源管理器中显示</button>
              <button type="button" role="menuitem" disabled={contents === undefined || error !== null} onClick={async () => {
                if (contents === undefined) return;
                setMenuOpen(false);
                const copied = await copyTextToClipboard(contents);
                if (mounted.current) setFeedback(copied ? "已复制 SKILL.md" : "无法复制 SKILL.md");
              }}>复制 Markdown</button>
            </div>}
          </div>
          <button type="button" className="pm-skill-preview-icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </div>
      </header>
      <div className="pm-skill-preview-body">
        {error !== null ? <div role="alert" className="pm-skill-preview-state">无法加载技能内容。<span>{error}</span>{canRetry && <button type="button" className="secondary-btn-sm" onClick={() => setAttempt(value => value + 1)}>重试</button>}</div>
          : contents === undefined ? <div role="status" className="pm-skill-preview-state">正在加载技能内容…</div>
          : markdown.trim() ? <MarkdownView content={markdown} />
          : <div className="pm-skill-preview-state">暂无说明</div>}
      </div>
      {(feedback || actionFeedback) && <div className="pm-skill-preview-feedback" role={!feedback && actionFeedback?.kind === "error" ? "alert" : "status"}>{feedback || actionFeedback?.text}</div>}
      <footer className="pm-skill-preview-footer">
        <div>{onUninstall && <button type="button" className="secondary-btn-sm" disabled={busy} onClick={onUninstall}>卸载</button>}</div>
        <button type="button" className="primary-btn-sm" disabled={enabled !== true || busy || hostBusy || !onTry} onClick={() => acceptHostAction(onTry)}>立即试用</button>
      </footer>
    </div>
  </dialog>;
}

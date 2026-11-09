import React, { useEffect, useRef, useState } from "react";
import { tauriInvoke } from "../bridge";
import "./WorktreeSettings.css";

type WorktreePreferences = { autoCleanupEnabled: boolean; keepCount: number; upstreamRefreshMode: "never" | "best-effort"; confirmBeforeDelete: boolean };
type PreferenceSnapshot = { hostId: string; preferences: WorktreePreferences; expected: Record<string, unknown> };

export function WorktreeSettings() {
  const [saved, setSaved] = useState("");
  const [draft, setDraft] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const [preferences, setPreferences] = useState<PreferenceSnapshot | null>(null);
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [preferenceNotice, setPreferenceNotice] = useState<string | null>(null);
  const [countDraft, setCountDraft] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const preferencePending = useRef(false);
  const latestPreferences = useRef(preferences); latestPreferences.current = preferences;
  const latestCountDraft = useRef(countDraft); latestCountDraft.current = countDraft;
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const cancelDisable = useRef<HTMLButtonElement>(null);
  const autoCleanupControl = useRef<HTMLButtonElement>(null);
  const [snapshotInfoOpen, setSnapshotInfoOpen] = useState(false);
  const snapshotInfo = useRef<HTMLSpanElement>(null);
  const snapshotInfoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotInfoVisible = useRef(false); snapshotInfoVisible.current = snapshotInfoOpen;
  const hideSnapshotInfo = () => {
    if (snapshotInfoTimer.current !== null) clearTimeout(snapshotInfoTimer.current);
    snapshotInfoTimer.current = null;
    setSnapshotInfoOpen(false);
  };
  const readPreferences = () => tauriInvoke<PreferenceSnapshot>("worktree_preferences_read", { hostId: "local" });
  const reloadPreferences = async (version = generation.current) => {
    if (preferencePending.current) return;
    preferencePending.current = true; setPreferenceBusy(true); setPreferenceError(null);
    try {
      const result = await readPreferences();
      if (version !== generation.current) return;
      if (result.hostId !== "local") throw Error("工作树偏好返回了不同的主机作用域。");
      latestPreferences.current = result; setPreferences(result);
    } catch (error) {
      if (version === generation.current) setPreferenceError(`读取工作树偏好失败：${String(error)}`);
    } finally {
      if (version === generation.current) { preferencePending.current = false; setPreferenceBusy(false); }
    }
  };
  const readRoot = async () => {
    const value = await tauriInvoke<unknown>("desktop_state_get", { key: "git-worktree-root" });
    if (value !== null && typeof value !== "string") throw Error("工作树目录配置不是字符串。");
    return value ?? "";
  };
  useEffect(() => {
    const version = ++generation.current;
    void readRoot().then(value => {
      if (version !== generation.current) return;
      setSaved(value); setDraft(value); setReady(true);
    }).catch(error => {
      if (version === generation.current) setError(`读取工作树目录失败：${String(error)}`);
    });
    void reloadPreferences(version);
    const closeSnapshotInfo = (event: PointerEvent) => {
      if ((snapshotInfoVisible.current || snapshotInfoTimer.current !== null) && !snapshotInfo.current?.contains(event.target as Node)) hideSnapshotInfo();
    };
    if (typeof document !== "undefined") document.addEventListener("pointerdown", closeSnapshotInfo);
    return () => {
      generation.current += 1; preferencePending.current = false; confirmDialog.current?.close();
      if (snapshotInfoTimer.current !== null) clearTimeout(snapshotInfoTimer.current);
      snapshotInfoTimer.current = null;
      if (typeof document !== "undefined") document.removeEventListener("pointerdown", closeSnapshotInfo);
    };
  }, []);
  const save = async () => {
    if (pending.current || !ready || draft === saved) return;
    pending.current = true;
    const version = generation.current;
    const value = draft.trim();
    setBusy(true); setError(null); setNotice(null);
    try {
      await tauriInvoke("desktop_state_set", { key: "git-worktree-root", value });
      if (version !== generation.current) return;
      const readback = await readRoot();
      if (readback !== value) throw Error("保存后读回不一致，请核对目录。");
      if (version !== generation.current) return;
      setSaved(readback); setDraft(readback); setNotice("已保存工作树根目录");
    } catch (error) {
      if (version === generation.current) setError(`未成功保存工作树根目录：${String(error)}`);
    } finally {
      if (version === generation.current) { pending.current = false; setBusy(false); }
    }
  };
  const savePreferences = async (patch: Partial<WorktreePreferences>, success: string, failure: string) => {
    const before = latestPreferences.current;
    if (preferencePending.current || !before) return;
    const next = { ...before.preferences, ...patch };
    if (Object.entries(next).every(([key, value]) => before.preferences[key as keyof WorktreePreferences] === value)) {
      if (patch.keepCount !== undefined) { latestCountDraft.current = null; setCountDraft(null); }
      return;
    }
    preferencePending.current = true; setPreferenceBusy(true); setPreferenceError(null); setPreferenceNotice(null);
    const version = generation.current;
    try {
      const written = await tauriInvoke<PreferenceSnapshot>("worktree_preferences_write", { hostId: "local", preferences: next, expected: before.expected });
      if (version !== generation.current) return;
      const readback = await readPreferences();
      if (version !== generation.current) return;
      if (written.hostId !== "local" || readback.hostId !== "local" ||
        !Object.entries(next).every(([key, value]) => readback.preferences[key as keyof WorktreePreferences] === value) ||
        JSON.stringify(written.expected) !== JSON.stringify(readback.expected)) throw Error("保存后读回不一致，请重新读取。");
      latestPreferences.current = readback; setPreferences(readback); setPreferenceNotice(success);
      if (patch.keepCount !== undefined) { latestCountDraft.current = null; setCountDraft(null); }
    } catch (error) {
      if (version === generation.current) setPreferenceError(`${failure}：${String(error)}`);
    } finally {
      if (version === generation.current) { preferencePending.current = false; setPreferenceBusy(false); }
    }
  };
  const saveCount = () => {
    const current = latestPreferences.current;
    if (preferencePending.current || !current?.preferences.autoCleanupEnabled || latestCountDraft.current === null) return;
    const value = latestCountDraft.current.trim();
    const number = Number(value);
    if (!value || !Number.isFinite(number)) { latestCountDraft.current = null; setCountDraft(null); return; }
    void savePreferences({ keepCount: Math.max(1, Math.trunc(number)) }, "已保存自动删除限制", "无法保存自动删除限制");
  };
  const closeDisable = () => {
    confirmDialog.current?.close(); setConfirmDisable(false);
    const version = generation.current;
    requestAnimationFrame(() => { if (version === generation.current) autoCleanupControl.current?.focus(); });
  };
  const values = preferences?.preferences;
  const preferenceDisabled = !values || preferenceBusy;
  return <div className="settings-scroll-container"><section className="card-section worktree-preferences" aria-labelledby="worktree-preferences-title" aria-busy={preferenceBusy}
    onKeyDown={event => {
      if (!ready || busy || draft === saved || confirmDisable || event.nativeEvent.isComposing || event.keyCode === 229) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault(); event.stopPropagation(); void save();
      }
    }}>
    <h3 id="worktree-preferences-title">创建与清理</h3>
    {error && <p role="alert" className="error-banner">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="worktree-preference-row worktree-root-row">
      <div><label htmlFor="worktree-root">工作树根目录</label><p id="worktree-root-hint">留空以使用默认位置</p></div>
      <div className="form-field worktree-root-control">
        <input id="worktree-root" type="text" aria-label="工作树根目录" aria-describedby="worktree-root-hint" value={draft} disabled={!ready || busy}
          onChange={event => { setDraft(event.target.value); setNotice(null); }} onBlur={() => void save()} />
      </div>
    </div>
    {preferenceBusy && !preferences && <p role="status">正在加载工作树偏好…</p>}
    {preferenceError && <div role="alert" className="error-banner">{preferenceError}<button type="button" className="secondary-btn" disabled={preferenceBusy} onClick={() => void reloadPreferences()}>重新读取</button></div>}
    {preferenceNotice && <p role="status">{preferenceNotice}</p>}
    <div className="worktree-preference-row">
      <div><label htmlFor="worktree-upstream-refresh">创建工作树前始终获取上游更新</label></div>
      <button id="worktree-upstream-refresh" type="button" role="switch" aria-label="创建工作树前始终获取上游更新" aria-checked={values?.upstreamRefreshMode === "best-effort"}
        className="worktree-preference-switch" disabled={preferenceDisabled} onClick={() => void savePreferences({ upstreamRefreshMode: values?.upstreamRefreshMode === "never" ? "best-effort" : "never" }, values?.upstreamRefreshMode === "never" ? "上游刷新已启用" : "上游刷新已禁用", "保存上游刷新设置失败")}><span /></button>
    </div>
    <div className="worktree-preference-row">
      <div><label htmlFor="worktree-auto-cleanup">自动删除旧工作树</label><p>先保存一份恢复快照 <span id="worktree-snapshot-info-container" ref={snapshotInfo} className="worktree-snapshot-info" onKeyDown={event => {
        if (event.key === "Escape" && (snapshotInfoOpen || snapshotInfoTimer.current !== null)) { event.preventDefault(); event.stopPropagation(); hideSnapshotInfo(); }
      }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) hideSnapshotInfo(); }}>
        <button id="worktree-snapshot-info" type="button" aria-label="关于恢复快照" aria-expanded={snapshotInfoOpen} aria-describedby={snapshotInfoOpen ? "worktree-snapshot-details" : undefined}
          onPointerEnter={event => {
            if (event.pointerType === "touch" || snapshotInfoOpen || snapshotInfoTimer.current !== null) return;
            snapshotInfoTimer.current = setTimeout(() => { snapshotInfoTimer.current = null; setSnapshotInfoOpen(true); }, 150);
          }} onPointerLeave={hideSnapshotInfo}
          onFocus={event => { if (event.currentTarget.matches(":focus-visible")) setSnapshotInfoOpen(true); }}
          onClick={() => setSnapshotInfoOpen(true)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" /><path d="M8 7v4M8 4.5v.5" stroke="currentColor" strokeLinecap="round" /></svg>
        </button>
        {snapshotInfoOpen && <span id="worktree-snapshot-details" role="tooltip">将本地提交和当前文件更改（包括未被 Git 忽略的未跟踪文件）保存到原始代码仓库中，以便恢复工作树</span>}
      </span></p></div>
      <button id="worktree-auto-cleanup" ref={autoCleanupControl} type="button" role="switch" aria-label="自动删除旧工作树" aria-checked={values?.autoCleanupEnabled ?? false}
        aria-haspopup={values?.autoCleanupEnabled ? "dialog" : undefined} aria-expanded={values?.autoCleanupEnabled ? confirmDisable : undefined}
        className="worktree-preference-switch" disabled={preferenceDisabled} onClick={() => {
          if (preferencePending.current || !values) return;
          if (!values.autoCleanupEnabled) { void savePreferences({ autoCleanupEnabled: true }, "自动删除功能已启用", "无法保存自动删除设置"); return; }
          setConfirmDisable(true); confirmDialog.current?.showModal(); cancelDisable.current?.focus();
        }}><span /></button>
    </div>
    <div className="worktree-preference-row">
      <div><label htmlFor="worktree-keep-count">保留的工作树数量</label><p>较旧的工作树会自动删除。已置顶或进行中的聊天所用的工作树会保留。</p></div>
      <div className="form-field worktree-count-control"><input id="worktree-keep-count" type="number" inputMode="numeric" min={1} step={1} value={countDraft ?? String(values?.keepCount ?? 15)}
        disabled={preferenceDisabled || !values?.autoCleanupEnabled} onChange={event => {
          if (preferencePending.current || !values?.autoCleanupEnabled) return;
          const next = event.target.value === String(values.keepCount) ? null : event.target.value;
          latestCountDraft.current = next; setCountDraft(next); setPreferenceNotice(null);
        }} onBlur={saveCount} onKeyDown={event => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); saveCount(); }
        }} /></div>
    </div>
    <div className="worktree-preference-row">
      <div><label htmlFor="worktree-confirm-delete">删除工作树前询问</label></div>
      <button id="worktree-confirm-delete" type="button" role="switch" aria-label="删除工作树前询问" aria-checked={values?.confirmBeforeDelete ?? true}
        className="worktree-preference-switch" disabled={preferenceDisabled} onClick={() => void savePreferences({ confirmBeforeDelete: !values?.confirmBeforeDelete }, "", "未能保存工作树删除偏好设置")}><span /></button>
    </div>
    <dialog ref={confirmDialog} className="codex-modal-dialog worktree-disable-dialog" aria-labelledby="worktree-disable-title" aria-describedby="worktree-disable-description"
      onCancel={event => { event.preventDefault(); closeDisable(); }} onKeyDown={event => {
        if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) { event.preventDefault(); event.stopPropagation(); }
      }}>
      <h3 id="worktree-disable-title">关闭工作树自动删除功能？</h3>
      <p id="worktree-disable-description">旧工作树会一直保留在磁盘上，直至你将其删除</p>
      <div className="worktree-disable-actions">
        <button ref={cancelDisable} type="button" className="secondary-btn" onClick={closeDisable}>取消</button>
        <button type="button" className="primary-btn" disabled={preferenceBusy} onClick={() => {
          if (preferencePending.current) return;
          closeDisable(); latestCountDraft.current = null; setCountDraft(null);
          void savePreferences({ autoCleanupEnabled: false }, "自动删除功能已禁用", "无法保存自动删除设置");
        }}>关闭</button>
      </div>
    </dialog>
  </section></div>;
}

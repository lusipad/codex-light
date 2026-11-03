import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseAppearanceFontSize, type AppearanceState } from "../appearancePreferences";
import { copyTextToClipboard } from "../clipboard";
import { loadThemePreset, parseTheme, resetAdvancedTheme, serializeTheme, themePresets,
  type ChromeTheme, type ThemeVariant } from "../appearanceTheme";

function FontSizeField({ setting, state, label }: {
  setting: "sansFontSize" | "codeFontSize"; state: AppearanceState; label: string;
}) {
  const saved = state.preferences[setting];
  const [draft, setDraft] = useState(String(saved));
  const committing = useRef(false);
  useEffect(() => { setDraft(String(saved)); }, [saved]);
  const commit = async () => {
    if (committing.current || state.busy) return;
    const value = parseAppearanceFontSize(setting, draft);
    if (value === null) { setDraft(String(saved)); return; }
    if (value === saved) { setDraft(String(saved)); return; }
    committing.current = true;
    const result = await state.save(setting, value);
    setDraft(String(result === "failed" ? saved : value));
    committing.current = false;
  };
  return <div className="form-field">
    <label htmlFor={setting}>{label}</label>
    {setting === "codeFontSize" && <p className="card-subtitle-desc">调整聊天和差异视图中代码使用的基础字号</p>}
    <input id={setting} type="number" step={1} min={setting === "sansFontSize" ? 11 : 8}
      max={setting === "sansFontSize" ? 16 : 24} value={draft} disabled={state.busy}
      onChange={event => setDraft(event.target.value)} onBlur={() => void commit()}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Enter") { event.preventDefault(); void commit(); }
      }} />
  </div>;
}

function ThemeTextField({ label, value, disabled, color = false, onSave }: {
  label: string; value: string; disabled: boolean; color?: boolean; onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const composing = useRef(false);
  useEffect(() => { setDraft(value); setInvalid(false); }, [value]);
  const persist = () => {
    if (composing.current || disabled) return;
    const next = draft.trim();
    if (color && !/^#[\da-f]{6}$/i.test(next)) { setInvalid(true); return; }
    setInvalid(false);
    if (next !== value) onSave(next);
  };
  return <div className="appearance-value-control">
    {color && <input type="color" aria-label={`${label}选择器`} value={/^#[\da-f]{6}$/i.test(draft) ? draft : value} disabled={disabled}
      onChange={event => { setDraft(event.target.value); setInvalid(false); }} onBlur={persist} />}
    <input type="text" aria-label={label} aria-invalid={invalid || undefined} value={draft}
      placeholder={color ? "#RRGGBB" : "系统"} disabled={disabled}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onChange={event => { setDraft(event.target.value); setInvalid(false); }} onBlur={persist}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Enter") { event.preventDefault(); persist(); }
        if (event.key === "Escape") { setDraft(value); setInvalid(false); }
      }} />
    {invalid && <span role="alert">请输入完整的 #RRGGBB 颜色</span>}
  </div>;
}

function ThemeImportDialog({ variant, busy, onClose, onImport }: {
  variant: ThemeVariant; busy: boolean; onClose: () => void; onImport: (text: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const name = variant === "light" ? "浅色" : "深色";
  useEffect(() => {
    restoreFocus.current = document.activeElement as HTMLElement | null;
    field.current?.focus();
    return () => { restoreFocus.current?.focus(); };
  }, []);
  return createPortal(<div className="appearance-dialog-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !busy) onClose();
  }}><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="appearance-import-title"
    className="appearance-import-dialog" tabIndex={-1} onKeyDown={event => {
      if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }
      if (event.key !== "Tab") return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('textarea:not(:disabled), button:not(:disabled)') ?? [])];
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); dialog.current?.focus(); }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <h3 id="appearance-import-title">导入主题</h3>
    <textarea ref={field} aria-label={`${name} 主题分享字符串`} value={value} disabled={busy}
      placeholder="codex-theme-v1:" onChange={event => { setValue(event.target.value); setError(false); }} />
    {error && <p role="alert">无法导入 {name} 主题</p>}
    <div className="appearance-dialog-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button>
      <button type="button" disabled={busy || !value.trim()} onClick={async () => {
        const saved = await onImport(value); if (!saved) setError(true);
      }}>导入主题</button></div>
  </div></div>, document.body);
}

function ThemeContrast({ value, disabled, label, onSave }: {
  value: number; disabled: boolean; label: string; onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const persist = (event: React.SyntheticEvent<HTMLInputElement>) => {
    const next = Number(event.currentTarget.value); if (!disabled && next !== value) onSave(next);
  };
  return <><input type="range" min={0} max={100} step={1} aria-label={label} value={draft} disabled={disabled}
    onChange={event => setDraft(Number(event.target.value))} onPointerUp={persist} onKeyUp={persist} onBlur={persist} /><output>{draft}</output></>;
}

function ThemeCard({ state, variant, advanced = false, showTitle, editRevision }: {
  state: AppearanceState; variant: ThemeVariant; advanced?: boolean; showTitle: boolean; editRevision: { current: number };
}) {
  const theme = variant === "light" ? state.preferences.appearanceLightChromeTheme : state.preferences.appearanceDarkChromeTheme;
  const latestTheme = useRef(theme);
  latestTheme.current = theme;
  const codeThemeId = variant === "light" ? state.preferences.appearanceLightCodeThemeId : state.preferences.appearanceDarkCodeThemeId;
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const [importing, setImporting] = useState(false);
  const [loadingPreset, setLoadingPreset] = useState(false);
  const presetRequest = useRef(0);
  const pending = useRef(false);
  const alive = useRef(true);
  const name = variant === "light" ? "浅色" : "深色";
  const presets = themePresets(variant);
  useEffect(() => { alive.current = true; return () => { alive.current = false; editRevision.current++; }; }, [editRevision]);
  const persistTheme = async (next: ChromeTheme, nextId = codeThemeId) => {
    if (pending.current || state.busy) return false;
    editRevision.current++;
    pending.current = true;
    setFailure(""); setNotice("");
    try {
      const result = await state.saveTheme(variant, next, nextId);
      return result === "saved";
    } catch {
      if (alive.current) setFailure("无法应用主题");
      return false;
    } finally { pending.current = false; }
  };
  const patch = (value: Partial<ChromeTheme>) => { void persistTheme({ ...theme, ...value }); };
  const fontField = (key: "ui" | "content" | "code", label: string) => <div className="appearance-setting-row" key={key}>
    <span>{label}</span><ThemeTextField label={`${name} ${label}`} value={theme.fonts[key] ?? ""} disabled={state.busy}
      onSave={value => {
        const fonts = { ...theme.fonts, [key]: value || null }; delete fonts[`${key}Face`]; patch({ fonts });
      }} />
  </div>;
  const fontStyle = (key: "ui" | "content" | "code", label: string) => {
    const face = theme.fonts[`${key}Face`];
    return <div className="appearance-setting-row" key={`${key}Style`}><span>{label}</span>
      <select aria-label={`${name} ${label}`} value={face ? "selected" : "regular"} disabled={state.busy || !face}
        onChange={() => { const fonts = { ...theme.fonts }; delete fonts[`${key}Face`]; patch({ fonts }); }}>
        {face && <option value="selected">{face.fullName}</option>}<option value="regular">常规</option>
      </select></div>;
  };
  return <section className="appearance-theme-card" aria-label={`${name}${advanced ? "高级" : ""}主题`}>
    {(showTitle || !advanced) && <div className="appearance-theme-heading"><h4>{showTitle ? `${name}主题` : "主题"}</h4>
      {!advanced && <div className="appearance-theme-actions">
        <button type="button" aria-label={`导入${name}主题`} disabled={state.busy} onClick={() => setImporting(true)}>导入</button>
        <button type="button" aria-label={`复制${name}主题`} disabled={state.busy} onClick={async () => {
          const copied = await copyTextToClipboard(serializeTheme({ variant, theme, codeThemeId }));
          if (!alive.current) return;
          setNotice(copied ? `已复制${name}主题` : ""); setFailure(copied ? "" : "复制主题失败");
        }}>复制</button>
        <select aria-label={`${name} 代码主题`} value={codeThemeId} disabled={state.busy} aria-busy={loadingPreset}
          onChange={async event => {
            const id = event.target.value, revision = ++editRevision.current, request = ++presetRequest.current;
            setLoadingPreset(true); setFailure(""); setNotice("");
            try {
              const next = await loadThemePreset(id, variant);
              if (alive.current && revision === editRevision.current) await persistTheme({
                ...latestTheme.current, accent: next.accent, ink: next.ink, surface: next.surface,
                semanticColors: next.semanticColors, accentSource: "custom",
              }, id);
            } catch { if (alive.current && revision === editRevision.current) setFailure("无法应用主题"); }
            finally { if (alive.current && request === presetRequest.current) setLoadingPreset(false); }
          }}>
          {!presets.some(preset => preset.id === codeThemeId) && <option value={codeThemeId}>{codeThemeId}</option>}
          {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
        </select>
      </div>}
    </div>}
    {!advanced && <>
      {!presets.some(preset => preset.id === codeThemeId) && <p role="status">当前代码主题暂不可用，已保留原选择。请选择其他主题以应用配色。</p>}
      <div className="appearance-theme-preview" aria-hidden="true" style={{ background: theme.surface, color: theme.ink, borderColor: theme.accent }}>
        <span style={{ fontFamily: theme.fonts.ui ?? undefined }}>Aa</span><i style={{ background: theme.accent }} />
      </div>
      {([["accent", "强调色"], ["surface", "背景"], ["ink", "前景"]] as const).map(([key, label]) =>
        <div className="appearance-setting-row" key={key}><span>{label}</span><ThemeTextField label={`${name} ${label}`}
          color value={theme[key]} disabled={state.busy} onSave={value => patch({ [key]: value, ...(key === "accent" ? { accentSource: "custom" as const } : {}) })} /></div>)}
      {fontField("ui", "字体")}
    </>}
    {advanced && <>
      {fontStyle("ui", "界面字体样式")}
      {fontField("content", "内容字体")}{fontStyle("content", "内容字体样式")}
      {fontField("code", "代码字体")}{fontStyle("code", "代码字体样式")}
      <div className="appearance-setting-row"><span>对比度</span><ThemeContrast label={`${name} 对比度`}
        value={theme.contrast} disabled={state.busy} onSave={contrast => patch({ contrast })} /></div>
    </>}
    {loadingPreset && <p role="status">正在加载主题…</p>}{notice && <p role="status">{notice}</p>}{failure && <p role="alert">{failure}</p>}
    {importing && <ThemeImportDialog variant={variant} busy={state.busy} onClose={() => setImporting(false)} onImport={async text => {
      try {
        const value = parseTheme(text, variant, presets.map(preset => preset.id));
        if (!await persistTheme(value.theme, value.codeThemeId)) return false;
        if (alive.current) { setImporting(false); setNotice(`已导入 ${name} 主题`); }
        return true;
      } catch { return false; }
    }} />}
  </section>;
}

export const AppearanceSettings: React.FC<{ state: AppearanceState }> = ({ state }) => {
  const [advanced, setAdvanced] = useState(false);
  const [separateModes, setSeparateModes] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState(false);
  const resetPending = useRef(false);
  const themeRevisions = useRef({ light: { current: 0 }, dark: { current: 0 } });
  const variants: ThemeVariant[] = separateModes ? ["light", "dark"] : [state.variant];
  const reset = async () => {
    if (resetPending.current || state.busy) return;
    resetPending.current = true; setResetting(true); setResetError(false); setSeparateModes(false);
    themeRevisions.current.light.current++; themeRevisions.current.dark.current++;
    let failed = false;
    for (const variant of ["light", "dark"] as const) {
      const theme = variant === "light" ? state.preferences.appearanceLightChromeTheme : state.preferences.appearanceDarkChromeTheme;
      const id = variant === "light" ? state.preferences.appearanceLightCodeThemeId : state.preferences.appearanceDarkCodeThemeId;
      try { if (await state.saveTheme(variant, resetAdvancedTheme(theme, variant, false), id) !== "saved") failed = true; } catch { failed = true; }
    }
    for (const [key, value] of [["sansFontSize", 14], ["codeFontSize", 12], ["reduced-motion-preference", "system"]] as const) {
      try { if (await state.save(key, value) !== "saved") failed = true; } catch { failed = true; }
    }
    setResetError(failed); setResetting(false); resetPending.current = false;
  };
  const controlsState = resetting ? { ...state, busy: true } : state;
  return <>
    <div className="card-section">
      <h3>视觉风格</h3>
      <fieldset disabled={state.busy || resetting} className="appearance-mode-options">
        <legend>模式</legend>
        {([["system", "系统"], ["light", "浅色"], ["dark", "深色"]] as const).map(([value, label]) =>
          <label key={value}><input type="radio" name="appearance-mode" value={value}
            checked={state.preferences.appearanceTheme === value} onChange={() => void state.save("appearanceTheme", value)} />{label}</label>)}
      </fieldset>
      {variants.map(variant => <ThemeCard key={variant} state={controlsState} variant={variant} showTitle={separateModes} editRevision={themeRevisions.current[variant]} />)}
    </div>
    <div className="card-section">
      <div className="appearance-theme-heading"><h3><button type="button" className="appearance-advanced-toggle" aria-expanded={advanced}
        aria-controls="appearance-advanced" onClick={() => setAdvanced(value => !value)}>高级 <span aria-hidden="true">{advanced ? "⌃" : "⌄"}</span></button></h3>
        <button type="button" disabled={state.busy || resetting} onClick={() => void reset()}>重置为默认设置</button></div>
      {advanced && <div id="appearance-advanced">
        <div className="appearance-setting-row"><label htmlFor="appearance-separate">分别设置浅色和深色模式</label>
          <input type="checkbox" id="appearance-separate" checked={separateModes} disabled={resetting}
            onChange={event => setSeparateModes(event.target.checked)} /></div>
        <p className="card-subtitle-desc">分别选择各自的主题、颜色和字体</p>
        {variants.map(variant => <ThemeCard key={variant} state={controlsState} variant={variant} advanced showTitle={separateModes} editRevision={themeRevisions.current[variant]} />)}
        <div className="form-grid-row"><FontSizeField setting="sansFontSize" state={controlsState} label="界面字号" />
          <FontSizeField setting="codeFontSize" state={controlsState} label="代码字体大小" /></div>
        <div className="form-field"><label htmlFor="reduced-motion">减少动态效果</label>
          <select id="reduced-motion" disabled={state.busy || resetting} value={state.preferences["reduced-motion-preference"]}
            onChange={event => void state.save("reduced-motion-preference", event.target.value as "system" | "on" | "off")}>
            <option value="system">系统</option><option value="on">开启</option><option value="off">关闭</option>
          </select></div>
      </div>}
    </div>
    {resetError && <div role="alert">部分外观设置无法重置。请重试。</div>}
    {state.error && <div role="alert">{state.error}<button type="button" disabled={state.busy || resetting} onClick={state.reload}>重新读取</button></div>}
  </>;
};

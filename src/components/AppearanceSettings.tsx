import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseAppearanceFontSize, type AppearanceState } from "../appearancePreferences";
import { copyTextToClipboard } from "../clipboard";
import { loadThemePreset, parseTheme, resetAdvancedTheme, serializeTheme, themePresets,
  type ChromeTheme, type ThemeVariant } from "../appearanceTheme";
import { GeneralPreferenceSelect } from "./GeneralPreferenceSelect";
import { AppearanceFontPicker } from "./AppearanceFontPicker";
import { AppearanceColorPicker } from "./AppearanceColorPicker";
import "./AppearanceSettings.css";

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
  return <div className="appearance-setting-row appearance-font-size">
    <div><label htmlFor={setting}>{label}</label>
      <p className="card-subtitle-desc">{setting === "codeFontSize" ? "调整聊天和差异视图中代码使用的基础字号" : "调整 ChatGPT 的基础字号"}</p></div>
    <div className="appearance-size-control"><input id={setting} type="number" step={1} min={setting === "sansFontSize" ? 11 : 8}
      max={setting === "sansFontSize" ? 16 : 24} value={draft} disabled={state.busy}
      onChange={event => setDraft(event.target.value)} onBlur={() => void commit()}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Enter") { event.preventDefault(); void commit(); }
      }} /><span>px</span></div>
  </div>;
}

function ThemeTextField({ label, value, disabled, colorPending = false, onSave }: {
  label: string; value: string; disabled: boolean; colorPending?: boolean; onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);
  useEffect(() => { setDraft(value); }, [value]);
  const editColor = (text: string) => {
    const hex = text.toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 6);
    setDraft(`#${hex}`);
    if (!disabled && hex.length === 6 && (colorPending || `#${hex}`.toLowerCase() !== value.toLowerCase())) onSave(`#${hex.toLowerCase()}`);
  };
  return <div className="appearance-value-control appearance-color-control">
    {<AppearanceColorPicker label={`${label}选择器`} value={value} disabled={disabled} pending={colorPending} onChange={onSave} />}
    <input type="text" aria-label={label} value={!composing.current ? draft.toUpperCase() : draft}
      placeholder="#RRGGBB" disabled={disabled}
      spellCheck={false}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={event => {
        composing.current = false; editColor(event.currentTarget.value);
      }}
      onChange={event => {
        if (!composing.current) editColor(event.target.value);
        else { setDraft(event.target.value); }
      }} onBlur={() => setDraft(value)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Enter") event.preventDefault();
        if (event.key === "Escape") { event.stopPropagation(); setDraft(value); }
      }} />
  </div>;
}

function ThemeImportDialog({ variant, busy, exampleValue, isValid, onClose, onImport }: {
  variant: ThemeVariant; busy: boolean; exampleValue: string; isValid: (text: string) => boolean;
  onClose: () => void; onImport: (text: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const composing = useRef(false);
  const [saving, setSaving] = useState(false);
  const locked = busy || saving;
  const restoreFocus = useRef<HTMLElement | null>(null);
  const name = variant === "light" ? "浅色" : "深色";
  useEffect(() => {
    restoreFocus.current = document.activeElement as HTMLElement | null;
    field.current?.focus();
    return () => { restoreFocus.current?.focus(); };
  }, []);
  return createPortal(<div className="appearance-dialog-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !locked) onClose();
  }}><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="appearance-import-title"
    className="appearance-import-dialog" tabIndex={-1} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composing.current) {
        if (event.key === "Enter") event.preventDefault();
        return;
      }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!locked) onClose(); }
      if (event.key !== "Tab") return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? [])];
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); dialog.current?.focus(); }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <form onSubmit={async event => {
      event.preventDefault();
      if (locked || submitting.current || composing.current || !isValid(value)) return;
      submitting.current = true; setSaving(true); setError(false); dialog.current?.focus({ preventScroll: true });
      try { if (!await onImport(value)) setError(true); }
      catch { setError(true); }
      finally { submitting.current = false; setSaving(false); }
    }}>
    <div className="appearance-import-heading"><h3 id="appearance-import-title">导入主题</h3>
      {!locked && <button type="button" aria-label="关闭" className="appearance-import-close" onClick={onClose}>×</button>}</div>
    <input ref={field} type="text" spellCheck={false} aria-label={`${name} 主题分享字符串`} value={value} disabled={locked}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      placeholder={exampleValue} onChange={event => { setValue(event.target.value); setError(false); }} />
    {error && <p role="alert">无法导入 {name} 主题</p>}
    <div className="appearance-dialog-actions"><button type="button" disabled={locked} onClick={onClose}>取消</button>
      <button type="submit" disabled={locked || !isValid(value)} aria-busy={saving || undefined}>导入主题</button></div>
    </form>
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
  const [colorDraft, setColorDraft] = useState<ChromeTheme | null>(null);
  const colorSaving = colorDraft !== null;
  const colorWrites = useRef(0), desiredColorTheme = useRef<ChromeTheme | null>(null);
  const presetRequest = useRef(0);
  const pending = useRef(false);
  const alive = useRef(true);
  const name = variant === "light" ? "浅色" : "深色";
  const presets = themePresets(variant);
  useEffect(() => { alive.current = true; return () => { alive.current = false; editRevision.current++; }; }, [editRevision]);
  const persistTheme = async (next: ChromeTheme, nextId = codeThemeId) => {
    if (pending.current || colorWrites.current || state.busy) return false;
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
  const patchColor = (key: "accent" | "surface" | "ink", value: string) => {
    if (pending.current || (state.busy && !colorWrites.current)) return;
    const next = { ...(desiredColorTheme.current ?? latestTheme.current), [key]: value,
      ...(key === "accent" ? { accentSource: "custom" as const } : {}) };
    desiredColorTheme.current = next; colorWrites.current++; editRevision.current++; setColorDraft(next);
    setNotice(""); setFailure("");
    void state.saveTheme(variant, next, codeThemeId).catch(() => {
      if (alive.current) setFailure("无法应用主题");
    }).finally(() => {
      if (--colorWrites.current === 0) { desiredColorTheme.current = null; if (alive.current) setColorDraft(null); }
    });
  };
  const fontControl = (key: "ui" | "content" | "code", label: string, controls: "family" | "style" | "both" = "both") =>
    <div className="appearance-setting-row" key={key}><span>{label}</span>
      <AppearanceFontPicker id={`appearance-${variant}-${key}-font`} label={`${name} ${label}`}
        styleLabel={`${name} ${key === "ui" ? "界面字体样式" : `${label}样式`}`} controls={controls}
        value={theme.fonts[key] ?? null} face={theme.fonts[`${key}Face`]} disabled={state.busy} content={key === "content"} monospace={key === "code"}
        onChange={(value, face) => {
          const fonts = { ...theme.fonts, [key]: value };
          if (face) fonts[`${key}Face`] = face; else delete fonts[`${key}Face`];
          patch({ fonts });
        }} /></div>;
  return <section className="appearance-theme-card" aria-label={`${name}${advanced ? "高级" : ""}主题`}>
    {(showTitle || !advanced) && <div className="appearance-theme-heading"><h4>{showTitle ? `${name}主题` : "主题"}</h4>
      {!advanced && <div className="appearance-theme-actions">
        <button type="button" className="appearance-icon-button" aria-label={`导入${name}主题`} title={`导入${name}主题`} disabled={state.busy} onClick={() => setImporting(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5" /></svg></button>
        <button type="button" className="appearance-icon-button" aria-label={`复制${name}主题`} title={`复制${name}主题`} disabled={state.busy} onClick={async () => {
          const copied = await copyTextToClipboard(serializeTheme({ variant, theme, codeThemeId }));
          if (!alive.current) return;
          setNotice(copied ? `已复制${name}主题` : ""); setFailure(copied ? "" : "复制主题失败");
        }}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg></button>
        <div className="appearance-preset-control" aria-busy={loadingPreset}>
          <span className="appearance-preset-swatches" aria-hidden="true">{[theme.surface, theme.ink, theme.accent].map((color, index) => <i key={index} style={{ background: color }} />)}</span>
          <GeneralPreferenceSelect id={`appearance-${variant}-preset`} label={`${name} 代码主题`} value={codeThemeId} disabled={state.busy}
          options={[...(!presets.some(preset => preset.id === codeThemeId) ? [{ value: codeThemeId, label: codeThemeId }] : []), ...presets.map(preset => ({ value: preset.id, label: preset.label }))]}
          onChange={async id => {
            const revision = ++editRevision.current, request = ++presetRequest.current;
            setLoadingPreset(true); setFailure(""); setNotice("");
            try {
              const next = await loadThemePreset(id, variant);
              if (alive.current && revision === editRevision.current) await persistTheme({
                ...latestTheme.current, accent: next.accent, ink: next.ink, surface: next.surface,
                semanticColors: next.semanticColors, accentSource: "custom",
              }, id);
            } catch { if (alive.current && revision === editRevision.current) setFailure("无法应用主题"); }
            finally { if (alive.current && request === presetRequest.current) setLoadingPreset(false); }
          }} /></div>
      </div>}
    </div>}
    {!advanced && <>
      {!presets.some(preset => preset.id === codeThemeId) && <p role="status">当前代码主题暂不可用，已保留原选择。请选择其他主题以应用配色。</p>}
      {([["accent", "强调色"], ["surface", "背景"], ["ink", "前景"]] as const).map(([key, label]) =>
        <div className="appearance-setting-row" key={key}><span>{label}</span><ThemeTextField label={`${name} ${label}`}
          value={(colorDraft ?? theme)[key]} colorPending={colorSaving} disabled={state.busy && !colorSaving} onSave={value => patchColor(key, value)} /></div>)}
      {fontControl("ui", "字体", "family")}
    </>}
    {advanced && <>
      {fontControl("ui", "界面字体样式", "style")}
      {fontControl("content", "内容字体")}
      {fontControl("code", "代码字体")}
      <div className="appearance-setting-row"><span>对比度</span><ThemeContrast label={`${name} 对比度`}
        value={theme.contrast} disabled={state.busy} onSave={contrast => patch({ contrast })} /></div>
    </>}
    {loadingPreset && <p role="status">正在加载主题…</p>}{notice && <p role="status">{notice}</p>}{failure && <p role="alert">{failure}</p>}
    {importing && <ThemeImportDialog variant={variant} busy={state.busy}
      exampleValue={serializeTheme({ variant, theme, codeThemeId })}
      isValid={text => { try { parseTheme(text, variant, presets.map(preset => preset.id)); return true; } catch { return false; } }}
      onClose={() => setImporting(false)} onImport={async text => {
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
  const hasAdvancedChanges = separateModes || state.preferences.sansFontSize !== 14 || state.preferences.codeFontSize !== 12 ||
    state.preferences["reduced-motion-preference"] !== "system" || (["light", "dark"] as const).some(variant => {
      const theme = variant === "light" ? state.preferences.appearanceLightChromeTheme : state.preferences.appearanceDarkChromeTheme;
      return theme.contrast !== (variant === "light" ? 45 : 60) || theme.fonts.code != null || theme.fonts.content != null ||
        theme.fonts.uiFace != null || theme.fonts.contentFace != null || theme.fonts.codeFace != null;
    });
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
  return <div className="appearance-settings">
    <div className="card-section">
      <h3>视觉风格</h3>
      <div className="appearance-mode-row"><span>模式</span><fieldset disabled={state.busy || resetting} className="appearance-mode-options" aria-label="模式">
        <legend className="appearance-sr-only">模式</legend>
        {([["system", "系统"], ["light", "浅色"], ["dark", "深色"]] as const).map(([value, label]) =>
          <label key={value} title={label}><input type="radio" name="appearance-mode" value={value} aria-label={label}
            checked={state.preferences.appearanceTheme === value} onChange={() => void state.save("appearanceTheme", value)} />
            <span className="appearance-mode-preview" data-mode={value} aria-hidden="true"><span className="appearance-mode-window"><i /><span /><span /><span /><b /><b /><em /></span></span></label>)}
      </fieldset></div>
      {variants.map(variant => <ThemeCard key={variant} state={controlsState} variant={variant} showTitle={separateModes} editRevision={themeRevisions.current[variant]} />)}
    </div>
    <div className="card-section">
      <div className="appearance-theme-heading"><h3><button type="button" className="appearance-advanced-toggle" aria-expanded={advanced}
        aria-controls="appearance-advanced" onClick={() => setAdvanced(value => !value)}>高级 <span aria-hidden="true">{advanced ? "⌃" : "⌄"}</span></button></h3>
        {hasAdvancedChanges && <button type="button" className="appearance-reset" disabled={state.busy || resetting} onClick={() => void reset()}>重置为默认设置</button>}</div>
      {advanced && <div id="appearance-advanced">
        <div className="appearance-advanced-group"><FontSizeField setting="sansFontSize" state={controlsState} label="界面字号" />
          <FontSizeField setting="codeFontSize" state={controlsState} label="代码字体大小" /></div>
        <div className="appearance-advanced-group"><div className="appearance-setting-row"><div><span>减少动态效果</span>
          <p className="card-subtitle-desc">减少动画效果或匹配系统设置</p></div>
          <GeneralPreferenceSelect id="reduced-motion" label="减少动态效果" disabled={state.busy || resetting} value={state.preferences["reduced-motion-preference"]}
            options={[{ value: "system", label: "系统" }, { value: "on", label: "开启" }, { value: "off", label: "关闭" }]}
            onChange={value => void state.save("reduced-motion-preference", value as "system" | "on" | "off")} /></div>
        <div className="appearance-setting-row"><label htmlFor="appearance-separate">分别设置浅色和深色模式</label>
          <input type="checkbox" role="switch" id="appearance-separate" checked={separateModes} disabled={state.busy || resetting}
            onChange={event => setSeparateModes(event.target.checked)} /></div>
        <p className="card-subtitle-desc appearance-separate-description">分别选择各自的主题、颜色和字体</p></div>
        {variants.map(variant => <ThemeCard key={variant} state={controlsState} variant={variant} advanced showTitle={separateModes} editRevision={themeRevisions.current[variant]} />)}
      </div>}
    </div>
    {resetError && <div role="alert">部分外观设置无法重置。请重试。</div>}
    {state.error && <div role="alert">{state.error}<button type="button" disabled={state.busy || resetting} onClick={state.reload}>重新读取</button></div>}
  </div>;
};

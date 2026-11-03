import React, { useEffect, useRef, useState } from "react";
import { parseAppearanceFontSize, type AppearanceState } from "../appearancePreferences";

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

export const AppearanceSettings: React.FC<{ state: AppearanceState }> = ({ state }) => <>
  <div className="card-section">
    <h3>视觉风格</h3>
    <fieldset disabled={state.busy} className="appearance-mode-options">
      <legend>模式</legend>
      {([ ["system", "系统"], ["light", "浅色"], ["dark", "深色"] ] as const).map(([value, label]) =>
        <label key={value}><input type="radio" name="appearance-mode" value={value}
          checked={state.preferences.appearanceTheme === value}
          onChange={() => void state.save("appearanceTheme", value)} />{label}</label>)}
    </fieldset>
    <div className="form-field">
      <label htmlFor="reduced-motion">减少动态效果</label>
      <select id="reduced-motion" disabled={state.busy} value={state.preferences["reduced-motion-preference"]}
        onChange={event => void state.save("reduced-motion-preference", event.target.value as "system" | "on" | "off")}>
        <option value="system">系统</option><option value="on">开启</option><option value="off">关闭</option>
      </select>
    </div>
  </div>
  <div className="card-section">
    <h3>高级</h3>
    <div className="form-grid-row">
      <FontSizeField setting="sansFontSize" state={state} label="界面字号" />
      <FontSizeField setting="codeFontSize" state={state} label="代码字体大小" />
    </div>
  </div>
  {state.error && <div role="alert">{state.error}<button type="button" disabled={state.busy} onClick={state.reload}>重新读取</button></div>}
</>;

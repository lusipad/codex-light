import React, { useId, useRef, useState } from "react";
import { isPluginSettingValue, pluginSettingsGroups, type PluginProvidedSettingsView, type PluginSettingField, type PluginSettingValue } from "../pluginProvidedSettings";
import { usePluginProvidedSettingsView } from "../pluginProvidedSettingsState";
import { GeneralPreferenceSelect } from "./GeneralPreferenceSelect";
import "./PluginProvidedSettingsForm.css";

interface Props { view: PluginProvidedSettingsView; identity: string; disabled?: boolean }
interface InputProps { id: string; name: string; field: PluginSettingField; value: string | number; disabled: boolean; change: (name: string, value: PluginSettingValue) => Promise<void> }

function SettingInput({ id, name, field, value, disabled, change }: InputProps) {
  const [draft, setDraft] = useState(String(value));
  const submitted = useRef<string | null>(null);
  const numeric = field.type === "number" || field.type === "integer";
  const commit = (input: HTMLInputElement) => {
    if (disabled || submitted.current === draft) return;
    input.setCustomValidity("");
    const actual = numeric ? draft.trim() === "" ? NaN : Number(draft) : draft;
    if (field.type === "integer" && typeof actual === "number" && Number.isFinite(actual) && !Number.isInteger(actual)) {
      input.setCustomValidity("请输入整数");
    } else if (!isPluginSettingValue(field, actual)) {
      input.setCustomValidity("请输入符合此设置要求的值");
    }
    if (!input.reportValidity() || !isPluginSettingValue(field, actual) || actual === value) return;
    submitted.current = draft;
    void change(name, actual);
  };
  return <input id={id} className="plugin-provided-setting-input" aria-label={field.title} type={numeric ? "number" : "text"}
    value={draft} disabled={disabled} required={numeric} step={numeric ? "any" : undefined}
    min={numeric ? field.minimum : undefined} max={numeric ? field.maximum : undefined}
    minLength={!numeric ? field.minLength : undefined} maxLength={!numeric ? field.maxLength : undefined}
    onChange={event => { event.currentTarget.setCustomValidity(""); submitted.current = null; setDraft(event.currentTarget.value); }}
    onBlur={event => commit(event.currentTarget)} onKeyDown={event => {
      if (event.key !== "Enter" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      event.preventDefault(); event.stopPropagation(); commit(event.currentTarget);
    }} />;
}

export const PluginProvidedSettingsForm: React.FC<Props> = ({ view, identity, disabled = false }) => {
  const state = usePluginProvidedSettingsView(view, identity);
  const id = useId();
  const busy = disabled || state.loading || !!state.pending || !!state.actionPending || !!state.error;
  const locked = busy || state.updateUnavailable;
  const definition = state.definition;
  return <div className="plugin-provided-settings-form" aria-busy={state.loading || !!state.pending || !!state.actionPending}>
    {state.loading && !definition && <div className="plugin-provided-settings-loading" role="status">正在加载…</div>}
    {state.error && <div className="plugin-provided-settings-error" role="alert">
      <span>无法加载或保存设置。请重试。</span>
      <button type="button" disabled={disabled || state.loading || !!state.pending || !!state.actionPending} onClick={() => { void state.reload(); }}>重试</button>
    </div>}
    {state.updateUnavailable && <div className="plugin-provided-settings-error" role="alert">此服务器的设置更新工具不可用</div>}
    {definition && pluginSettingsGroups(definition).map((group, groupIndex) => <section className="plugin-provided-settings-group" key={groupIndex}>
      {(group.title || group.other) && <h3>{group.title ?? "其他设置"}</h3>}
      <div className="plugin-provided-settings-rows">{group.items.map((item, index) => {
        if (item.kind === "tool") {
          const result = state.actionResults[item.tool];
          const tool = view.tools.find(tool => tool.name === item.tool);
          const annotations = tool?.annotations;
          const rawTitle = tool?.title ?? (annotations && typeof annotations === "object" && !Array.isArray(annotations)
            ? (annotations as Record<string, unknown>).title : undefined);
          const actionTitle = typeof rawTitle === "string" && rawTitle.trim() || item.tool;
          return <div className="plugin-provided-setting-row" key={`tool-${index}`}>
            <div className="plugin-provided-setting-label"><span>{actionTitle}</span>{item.description && <p>{item.description}</p>}</div>
            <button type="button" className="plugin-provided-setting-action" disabled={busy || !state.actionAvailable(item.tool)}
              title={result?.error ? "无法完成此操作。请重试。" : result?.text ?? item.description ?? actionTitle}
              onClick={() => { if (!busy && state.actionAvailable(item.tool)) void state.runAction(item.tool); }}>{actionTitle}</button>
          </div>;
        }
        const name = item.property, field = definition.schema.properties[name];
        const value = state.pending?.name === name ? state.pending.value : definition.values[name];
        const controlId = `${id}-${groupIndex}-${index}`;
        return <div className="plugin-provided-setting-row" key={name}>
          <label className="plugin-provided-setting-label" htmlFor={controlId}><span>{field.title}</span>{field.description && <p>{field.description}</p>}</label>
          {field.type === "boolean" ? <button id={controlId} type="button" role="switch" className={`pm-skill-toggle ${value ? "on" : ""}`}
            aria-label={field.title} aria-checked={value === true} disabled={locked} onClick={() => { if (!locked) void state.change(name, !value); }}><span /></button>
            : field.type === "string" && field.enum ? <GeneralPreferenceSelect id={controlId} label={field.title} value={String(value)} plainItems
              options={field.enum.map(value => ({ value, label: value }))} disabled={locked} className="plugin-provided-setting-select"
              onChange={next => { if (!locked && next !== value && field.enum?.includes(next)) void state.change(name, next); }} />
              : <SettingInput key={`${name}:${String(value)}:${locked}`} id={controlId} name={name} field={field} value={value as string | number} disabled={locked} change={state.change} />}
        </div>;
      })}</div>
    </section>)}
  </div>;
};

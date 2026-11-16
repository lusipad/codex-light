import React, { useEffect, useRef, useState } from "react";
import { tauriInvoke } from "../bridge";
import { pluginPermissionOptions } from "../pluginPermissions";
import { usePluginPermissions } from "../pluginPermissionsState";
import { GeneralPreferenceSelect } from "./GeneralPreferenceSelect";
import "./PluginPermissionsSettings.css";

const helpUrl = "https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt#:~:text=App%20permission%20settings%20determine";
export function PluginPermissionsSettings({ identity, onUnavailable }: { identity: string; onUnavailable: () => void }) {
  const { state, reload, change } = usePluginPermissions(identity);
  const unavailable = useRef(onUnavailable); unavailable.current = onUnavailable;
  const scope = useRef(identity); scope.current = identity;
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkRequest = useRef(0);
  useEffect(() => { if (state?.snapshot?.access === "denied") unavailable.current(); }, [state?.snapshot]);
  useEffect(() => { linkRequest.current++; setLinkError(null); return () => { linkRequest.current++; }; }, [identity]);
  return <article className="pm-permissions-page" aria-busy={!state || state.loading || state.pending}>
    <header><h1>权限</h1><p>选择使用插件时何时请求批准</p></header>
    {(!state || state.loading && !state.snapshot) && <p role="status">正在加载…</p>}
    {state?.snapshot?.access === "allowed" && <section className="settings-general-group">
      <div className="form-field"><label htmlFor="plugin-default-permission">默认权限</label>
        <GeneralPreferenceSelect id="plugin-default-permission" label="默认权限" value={state.snapshot.value ?? ""}
          options={pluginPermissionOptions} placeholder={state.snapshot.value === "full_access" ? "允许使用所有工具" : "默认"}
          disabled={state.loading || state.pending || state.blocked} onChange={value => { void change(value); }} />
      </div>
      <footer><a href={helpUrl} onClick={event => {
        event.preventDefault(); const request = ++linkRequest.current, origin = identity; setLinkError(null);
        void tauriInvoke("review_link_open", { url: helpUrl }).catch(() => {
          if (scope.current === origin && request === linkRequest.current) setLinkError("无法打开链接。请重试。");
        });
      }}>了解更多关于插件权限的信息</a></footer>
    </section>}
    {state?.error && <div role="alert"><p>{state.error}</p><button type="button" className="secondary-btn-sm"
      disabled={state.loading || state.pending} onClick={() => { void reload(); }}>重试</button></div>}
    {linkError && <p role="alert">{linkError}</p>}
  </article>;
}

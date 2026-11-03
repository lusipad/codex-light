import React, { useEffect, useRef, useState } from "react";
import { useAccountSession } from "../accountSession";
import "./AccountSettings.css";

export function AccountSettings({ active, accountIdentity = "", connectionIdentity, onAccountChanged }: {
  active: boolean; accountIdentity?: string; connectionIdentity: string; onAccountChanged?: () => void | Promise<void>;
}) {
  const state = useAccountSession({ active, accountIdentity, connectionIdentity, onAccountChanged });
  const [apiEntry, setApiEntry] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const apiInput = useRef<HTMLInputElement>(null);
  const apiEntryButton = useRef<HTMLButtonElement>(null);
  const currentContext = useRef({ active, accountIdentity, connectionIdentity, busy: false });
  useEffect(() => { setApiKey(""); setApiEntry(false); }, [active, accountIdentity, connectionIdentity]);
  useEffect(() => { if (state.info?.account) { setApiKey(""); setApiEntry(false); } }, [state.info?.account?.type]);
  useEffect(() => { if (active && apiEntry) apiInput.current?.focus(); }, [active, apiEntry]);
  const busy = state.loading || state.phase !== null;
  currentContext.current = { active, accountIdentity, connectionIdentity, busy };
  if (!active) return null;
  const account = state.info?.account;
  const cancelApiEntry = () => {
    if (busy) return;
    setApiKey(""); setApiEntry(false);
    const context = currentContext.current;
    requestAnimationFrame(() => {
      const latest = currentContext.current;
      if (latest.active && !latest.busy && latest.accountIdentity === context.accountIdentity && latest.connectionIdentity === context.connectionIdentity) apiEntryButton.current?.focus();
    });
  };
  const submitApi = () => { const key = apiKey; setApiKey(""); void state.loginApiKey(key); };
  return <div className="settings-scroll-container account-settings" aria-busy={busy}>
    {state.error && <div role="alert" className="error-banner">{state.error}</div>}
    {state.loading && !state.info && <p role="status">正在加载…</p>}
    {state.info && account && <div>
      <div className="account-settings-row"><span>姓名</span><span className="account-settings-value">未取得</span></div>
      <div className="account-settings-row"><span>用户名</span><span className="account-settings-value">未取得</span></div>
      <div className="account-settings-row"><span>电子邮箱</span><span className="account-settings-value">{account.type === "chatgpt" && account.email ? account.email : "未取得"}</span></div>
      <div className="account-settings-row"><span>账户状态</span><span className="account-settings-value">{account.type === "chatgpt" ? "已通过 ChatGPT 登录" : account.type === "apiKey" ? "已通过 API 密钥登录" : account.type === "amazonBedrock" ? "已通过 Amazon Bedrock 登录" : "无法识别的账户类型"}</span></div>
      <div className="account-settings-actions"><button type="button" className="secondary-btn" disabled={busy} onClick={() => void state.logout()}>退出登录</button></div>
    </div>}
    {state.info && !account && <div className="account-settings-login">
      <h3>登录或注册</h3>
      {state.methods.status === "loading" && <p role="status">正在加载登录要求…</p>}
      {state.methods.status === "unsupported" && <p role="alert">请更新此计算机上的 Codex，以便读取其托管登录要求</p>}
      {state.methods.status === "error" && <p role="alert">无法加载登录要求</p>}
      {state.methods.status === "ready" && !state.methods.api && !state.methods.chatgpt && <p role="alert">你的管理员已禁用所有可用的登录方式</p>}
      {state.methods.status === "ready" && <div className="account-settings-login-actions">
        {state.methods.chatgpt && !apiEntry && <button type="button" className="primary-btn" disabled={state.loading || !state.eventsReady || (state.phase !== null && state.phase !== "chatgpt")}
          onClick={() => void (state.phase === "chatgpt" ? state.cancelLogin() : state.startChatgpt())}>{state.phase === "chatgpt" || state.phase === "cancel" ? "取消登录" : "使用 ChatGPT 继续"}</button>}
        {state.phase === "chatgpt" && <p role="status">请继续在浏览器中登录</p>}
        {state.methods.api && !apiEntry && state.phase === null && <button type="button" ref={apiEntryButton} className="secondary-btn" disabled={busy || !state.eventsReady} onClick={() => setApiEntry(true)}>输入 API 密钥</button>}
        {state.methods.api && apiEntry && <div className="account-settings-api-entry" onKeyDown={event => {
          if (event.key === "Escape" && !busy) { event.preventDefault(); cancelApiEntry(); }
          if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229 && !busy && apiKey.trim()) { event.preventDefault(); submitApi(); }
        }}>
          <label htmlFor="account-api-key">OpenAI API 密钥</label>
          <input id="account-api-key" ref={apiInput} type="password" autoComplete="off" spellCheck={false} placeholder="sk-…" value={apiKey}
            disabled={busy} onChange={event => setApiKey(event.target.value)} />
          <p>使用 OpenAI 开发者平台，按用量单独计费</p>
          <div className="account-settings-actions"><button type="button" className="secondary-btn" disabled={busy} onClick={cancelApiEntry}>取消</button>
            <button type="button" className="primary-btn" disabled={busy || !apiKey.trim() || !state.eventsReady} onClick={submitApi}>继续</button></div>
        </div>}
      </div>}
    </div>}
    {(state.error || (!state.loading && (!state.info || state.methods.status !== "ready" || !state.methods.api && !state.methods.chatgpt))) &&
      <button type="button" className="secondary-btn" disabled={busy} onClick={() => void state.reload()}>重试</button>}
  </div>;
}

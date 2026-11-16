import React, { useEffect, useId, useRef } from "react";
import { pluginAppAccountNickname, pluginAppProfileIdentity, selectPluginAppLinks, type PluginAppLink } from "../pluginAppDetails";
import { usePluginAppDetails } from "../pluginAppDetailsState";
import "./PluginManagementDetail.css";
import "./PluginAppDetailsPage.css";

interface PluginAppDetailsPageProps {
  connectionIdentity: string;
  pluginId: string;
  appId: string;
  onBack: () => void;
  onOpenPlugin: () => void;
  onUnavailable: () => void;
}

function accountIdentity(link: PluginAppLink, appName: string): string {
  return pluginAppProfileIdentity(link) || (appName
    ? link.auth_type === "NONE" ? `${appName}（未关联账户）` : `${appName} 账户`
    : "账户");
}

export function PluginAppDetailsPage({ connectionIdentity, pluginId, appId, onBack, onOpenPlugin, onUnavailable }: PluginAppDetailsPageProps) {
  const { state, reload } = usePluginAppDetails(connectionIdentity, pluginId, appId);
  const unavailable = useRef(onUnavailable); unavailable.current = onUnavailable;
  useEffect(() => { if (state.unavailable) unavailable.current(); }, [state.unavailable]);
  const accountsId = useId(), details = state.snapshot?.details;
  const title = details?.connector.name ?? "";
  const accounts = details?.links ? selectPluginAppLinks(details, null).accounts : [];
  const retry = () => { void reload(); };
  return <article className="pmd-detail" aria-busy={state.loading}>
    <nav className="pmd-breadcrumb" aria-label="面包屑导航">
      <button type="button" onClick={onBack}>插件设置</button>
      {details && <><span aria-hidden="true">/</span><button type="button" onClick={onOpenPlugin}>{details.pluginName}</button>
        <span aria-hidden="true">/</span><span aria-current="page">{title}</span></>}
    </nav>
    {details && <header className="pmd-header"><div className="pmd-heading">
      <h1>{title}</h1>
      {details.connector.description && <p className="pmd-description">{details.connector.description}</p>}
    </div></header>}
    {state.loading && !details && <p role="status">正在加载…</p>}
    {state.error && <div role="alert"><p>{state.error}</p>
      <button type="button" className="secondary-btn-sm" disabled={state.loading} onClick={retry}>重试</button>
    </div>}
    {details?.linksError && <div role="alert"><p>无法加载已连接的帐户</p>
      <button type="button" className="secondary-btn-sm" disabled={state.loading} onClick={retry}>重试</button>
    </div>}
    {accounts.length > 0 && <section className="pap-accounts" aria-labelledby={accountsId}>
      <h2 id={accountsId}>已连接的账户</h2>
      <div className="pap-account-list">{accounts.map(link => {
        const identity = accountIdentity(link, title.trim());
        const nickname = pluginAppAccountNickname(link, title);
        return <div className="pap-account" key={link.id}>
          <div className="pap-account-copy">
            <span className="pap-account-identity" title={identity}>{identity}</span>
            {nickname && nickname !== identity && <span className="pap-account-nickname" title={nickname}>{nickname}</span>}
          </div>
          {link.auth_status === "REAUTH_REQUIRED" && <span className="sr-only">需要更新身份验证</span>}
        </div>;
      })}</div>
    </section>}
  </article>;
}

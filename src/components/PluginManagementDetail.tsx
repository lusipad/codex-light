import React, { useEffect, useId, useRef, useState } from "react";
import type { PluginDetail } from "../plugins";
import { tauriInvoke } from "../bridge";
import { PluginLogo } from "./PluginLogo";
import { usePluginDetailExpansion } from "./PluginDirectoryDetail";
import "./PluginManagementDetail.css";

interface PluginManagementDetailProps {
  detail: PluginDetail;
  identity: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  onBack: () => void;
  onViewDetails?: () => void;
}

function safeLink(value?: string | null): string | null {
  if (!value || /[\x00-\x20]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function pluginManagementDetailPresentation(detail: PluginDetail) {
  const summary = detail.summary, info = summary.interface, source = summary.source;
  const rows: { label: string; value: string; href?: string }[] = [];
  const add = (label: string, value?: string | null) => { if (value?.trim()) rows.push({ label, value }); };
  add("类别", info?.category?.trim());
  add("开发者", info?.developerName);
  add("版本", summary.localVersion ?? summary.version);
  if (source.type !== "remote") add("市场", detail.marketplaceName);
  if (source.type === "local") add("来源", source.path);
  if (source.type === "git") add("来源", [source.url, source.path, source.refName, source.sha].filter(Boolean).join(" · "));
  if (source.type === "npm") add("来源", [[source.package, source.version].filter(Boolean).join("@"), source.registry].filter(Boolean).join(" · "));
  for (const [label, value, caption] of [
    ["网站", info?.websiteUrl, info?.websiteUrl],
    ["隐私政策", info?.privacyPolicyUrl, "查看隐私政策"],
    ["服务条款", info?.termsOfServiceUrl, "查看条款"],
  ]) {
    const href = safeLink(value);
    if (href) rows.push({ label: label!, value: caption!, href });
  }
  return { title: info?.displayName ?? summary.name, description: info?.shortDescription ?? detail.description ?? "", rows };
}

export function PluginManagementDetail({ detail, identity, actions, children, onBack, onViewDetails }: PluginManagementDetailProps) {
  const model = pluginManagementDetailPresentation(detail), descriptionId = useId(), aboutId = useId();
  const expansion = usePluginDetailExpansion(`${identity}\0${model.description}`, 3);
  const [linkError, setLinkError] = useState<string | null>(null);
  const currentIdentity = useRef(identity), request = useRef(0);
  currentIdentity.current = identity;
  useEffect(() => { request.current++; setLinkError(null); return () => { request.current++; }; }, [identity]);
  const openLink = async (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    event.preventDefault();
    const url = safeLink(href);
    if (!url) return;
    const ticket = ++request.current, origin = identity;
    setLinkError(null);
    try { await tauriInvoke("review_link_open", { url }); }
    catch (error) {
      if (ticket === request.current && currentIdentity.current === origin) setLinkError(`无法打开链接：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return <article className="pmd-detail">
    <nav className="pmd-breadcrumb" aria-label="面包屑"><button type="button" onClick={onBack}>插件设置</button><span aria-hidden="true">/</span><span aria-current="page">{model.title}</span></nav>
    <header className="pmd-header">
      <div className="pmd-identity"><PluginLogo plugin={detail.summary} className="pmd-logo" />
        <div className="pmd-heading"><h1>{model.title}</h1>
          {model.description && <div className="pmd-description">
            <div id={descriptionId} ref={expansion.ref} className="pmd-description-text" style={{ maxHeight: expansion.expanded ? expansion.fullHeight : expansion.maxHeight }}>{model.description}</div>
            {(expansion.overflowing || expansion.expanded) && <button type="button" className="pmd-expand" aria-controls={descriptionId} aria-expanded={expansion.expanded} onClick={expansion.toggle}>{expansion.expanded ? "收起" : "展开"}</button>}
          </div>}
        </div>
      </div>
      {(onViewDetails || actions) && <div className="pmd-actions">{onViewDetails && <button type="button" className="secondary-btn-sm" onClick={onViewDetails}>查看详情</button>}{actions}</div>}
    </header>
    {children}
    {model.rows.length > 0 && <section className="pmd-about" aria-labelledby={aboutId}><h2 id={aboutId}>关于</h2><dl>
      {model.rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.href ? <a href={row.href} onClick={event => { void openLink(event, row.href!); }}>{row.value}</a> : row.value}</dd></div>)}
    </dl></section>}
    {linkError && <p role="alert">{linkError}</p>}
  </article>;
}

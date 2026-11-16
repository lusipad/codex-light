import React, { useEffect, useRef, useState } from "react";
import { Ban, ExternalLink, Plug } from "lucide-react";
import type { AppTemplateSummary } from "../plugins";
import "./PluginTemplateRows.css";

export interface PluginTemplateRowsProps {
  templates: AppTemplateSummary[];
  managementUrl: (templateId: string) => string | null;
  onManage: (templateId: string) => Promise<void>;
  busyTemplateId?: string | null;
}

function isDarkTheme() {
  const theme = document.documentElement.getAttribute("data-theme");
  return theme === "dark" || theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function safeLogoUrl(value?: string | null) {
  if (!value || /[\x00-\x20]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function PluginTemplateLogo({ template }: { template: AppTemplateSummary }) {
  const [dark, setDark] = useState(isDarkTheme);
  const [failed, setFailed] = useState<{ identity: string; urls: string[] }>({ identity: "", urls: [] });
  useEffect(() => {
    const update = () => setDark(isDarkTheme());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    update();
    return () => { observer.disconnect(); media.removeEventListener("change", update); };
  }, []);
  const urls = (dark ? [template.logoUrlDark, template.logoUrl] : [template.logoUrl, template.logoUrlDark])
    .map(safeLogoUrl).filter((value): value is string => value !== null);
  const identity = JSON.stringify([template.templateId, urls]);
  const rejected = failed.identity === identity ? failed.urls : [];
  const src = urls.find(url => !rejected.includes(url));
  return <span className="ptr-icon" aria-hidden="true">
    {src ? <img src={src} alt="" onError={() => setFailed(previous => ({
      identity,
      urls: [...(previous.identity === identity ? previous.urls : []), src],
    }))} /> : <Plug size={18} />}
  </span>;
}

export function PluginTemplateRows(props: PluginTemplateRowsProps) {
  const latest = useRef(props);
  latest.current = props;
  const locks = useRef(new Set<string>());
  const [pending, setPending] = useState<Set<string>>(() => new Set());

  const manage = async (templateId: string, event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const current = latest.current;
    const template = current.templates.find(item => item.templateId === templateId);
    if (!template || template.materializedAppIds.length > 0 || !current.managementUrl(templateId) ||
        current.busyTemplateId === templateId || locks.current.has(templateId)) return;
    locks.current.add(templateId);
    setPending(new Set(locks.current));
    try {
      await current.onManage(templateId);
    } finally {
      locks.current.delete(templateId);
      setPending(new Set(locks.current));
    }
  };

  return <>{props.templates.filter(template => template.materializedAppIds.length === 0).map(template => {
    const href = props.managementUrl(template.templateId);
    const busy = props.busyTemplateId === template.templateId || pending.has(template.templateId);
    return <div key={template.templateId} className={`ptr-row${href ? "" : " ptr-unavailable"}`}
      data-app-template={template.templateId}>
      <PluginTemplateLogo template={template} />
      <div className="ptr-copy">
        <span className="ptr-name">{template.name}</span>
        <span className="ptr-description">{template.description ?? <span aria-hidden="true" />}</span>
      </div>
      {href ? <a className="ptr-manage" href={href} aria-disabled={busy || undefined}
        aria-busy={busy || undefined} tabIndex={busy ? -1 : undefined}
        onAuxClick={event => { event.preventDefault(); event.stopPropagation(); }}
        onClick={event => manage(template.templateId, event)}>
        管理应用<ExternalLink size={16} aria-hidden="true" />
      </a> : <span className="ptr-disabled" role="img" aria-label="已被管理员禁用" title="已被管理员禁用">
        <Ban size={18} aria-hidden="true" />
      </span>}
    </div>;
  })}</>;
}

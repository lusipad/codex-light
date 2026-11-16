import React, { useEffect, useId, useRef, useState } from "react";
import type { AppInfo, PluginDetail } from "../plugins";
import { MarkdownView } from "./MarkdownView";
import { tauriInvoke } from "../bridge";
import { PluginLogo } from "./PluginLogo";
import { PluginDirectoryLegal } from "./PluginDirectoryLegal";
import "./PluginDirectoryDetail.css";

interface PluginDirectoryDetailProps {
  detail: PluginDetail;
  actions: React.ReactNode;
  included?: React.ReactNode;
  onActivatePrompt?: (text: string, index: number) => boolean | Promise<boolean>;
  promptDisabledReason?: string;
  apps?: AppInfo[];
}

const nonempty = (...values: (string | null | undefined)[]) => values.find(value => value?.trim())?.trim() ?? "";
function externalUrl(value?: string | null): string | null {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

export function pluginDetailPresentation(detail: PluginDetail) {
  const summary = detail.summary, info = summary.interface;
  const tagline = nonempty(info?.shortDescription, detail.description, info?.longDescription);
  const long = nonempty(info?.longDescription, detail.description, info?.shortDescription);
  const information: { label: string; value: string; href?: string }[] = [];
  if (info) {
    const fields = [
      ["功能", info.capabilities?.join(", ")], ["开发者", info.developerName],
      ["分类", info.category], ["版本", summary.localVersion ?? summary.version],
    ];
    for (const [label, value] of fields) if (value?.trim()) information.push({ label: label!, value: value.trim() });
    const website = externalUrl(info.websiteUrl), privacy = externalUrl(info.privacyPolicyUrl), terms = externalUrl(info.termsOfServiceUrl);
    if (information.length || website || privacy || terms) information.push({ label: "网站", value: website ?? "不可用", ...(website ? { href: website } : {}) });
    if (privacy) information.push({ label: "隐私政策", value: privacy, href: privacy });
    if (terms) information.push({ label: "服务条款", value: terms, href: terms });
  }
  return {
    title: info?.displayName ?? summary.name, tagline, description: long === tagline ? "" : long,
    developer: info?.developerName?.trim() ?? "",
    prompts: (info?.defaultPrompt ?? []).map(text => text.trim()).filter(Boolean), information,
  };
}

/** Measures rendered layout rather than guessing line count from text length. */
export function usePluginDetailExpansion(identity: string, lines: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  const [fullHeight, setFullHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    setExpanded(false);
    let active = true;
    const measure = () => {
      const element = ref.current;
      if (!active || !element) return;
      const style = getComputedStyle(element);
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
      const height = lineHeight * lines;
      setMaxHeight(height);
      setFullHeight(element.scrollHeight);
      const overflows = element.scrollHeight > height + 1;
      setOverflowing(overflows);
      if (!overflows) setExpanded(false);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (ref.current) observer?.observe(ref.current);
    window.addEventListener("resize", measure);
    document.fonts?.addEventListener("loadingdone", measure);
    void document.fonts?.ready.then(measure);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      document.fonts?.removeEventListener("loadingdone", measure);
    };
  }, [identity, lines]);
  return { ref, expanded, overflowing, maxHeight, fullHeight, toggle: () => {
    if (expanded) ref.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
    setExpanded(value => !value);
  } };
}

function ExpandableContent({ identity, lines, children }: { identity: string; lines: number; children: React.ReactNode }) {
  const id = useId(), state = usePluginDetailExpansion(identity, lines);
  return <div className="plugin-detail-expandable">
    <div id={id} ref={state.ref} className="plugin-detail-expansion-content" style={{ maxHeight: state.expanded ? state.fullHeight : state.maxHeight }}>
      {children}
    </div>
    {state.overflowing && <button type="button" className="plugin-detail-expand" aria-controls={id} aria-expanded={state.expanded} onClick={state.toggle}>{state.expanded ? "收起" : "显示更多"}</button>}
  </div>;
}

export function PluginDirectoryDetail({ detail, actions, included, onActivatePrompt, promptDisabledReason, apps }: PluginDirectoryDetailProps) {
  const model = pluginDetailPresentation(detail);
  const identity = `${detail.marketplaceName}\0${detail.marketplacePath ?? ""}\0${detail.summary.id}`;
  const [pending, setPending] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const inFlight = useRef(false), generation = useRef(0);
  useEffect(() => { generation.current++; inFlight.current = false; setPending(false); setPromptError(null); setLinkError(null); return () => { generation.current++; }; }, [identity]);
  const openLink = async (event: React.MouseEvent<HTMLElement>) => {
    const anchor = (event.target as Element).closest?.("a[href]");
    if (!anchor || !event.currentTarget.contains(anchor)) return;
    event.preventDefault();
    const url = externalUrl(anchor.getAttribute("href"));
    if (!url) return;
    const current = generation.current;
    setLinkError(null);
    try { await tauriInvoke("review_link_open", { url }); }
    catch (error) { if (current === generation.current) setLinkError(`无法打开链接：${String(error)}`); }
  };
  const activate = async (text: string, index: number) => {
    if (inFlight.current || promptDisabledReason || !onActivatePrompt) return;
    inFlight.current = true; setPending(true); setPromptError(null);
    const current = generation.current;
    try { await onActivatePrompt(text, index); }
    catch (error) { if (generation.current === current) setPromptError(error instanceof Error ? error.message : String(error)); }
    finally { if (generation.current === current) { inFlight.current = false; setPending(false); } }
  };
  return <article className="plugin-directory-detail" onClick={openLink}>
    <header className="plugin-detail-header">
      <div className="plugin-detail-heading-row"><div className="plugin-detail-identity">
      <PluginLogo plugin={detail.summary} className="plugin-detail-logo" />
      <div className="plugin-detail-heading"><h1>{model.title}</h1>
        {(model.developer || model.tagline) && <p title={model.developer ? `由 ${model.developer} ${model.tagline ? `发布 • ${model.tagline}` : "提供"}` : model.tagline}>
          {model.developer ? `由 ${model.developer} ${model.tagline ? `发布 • ${model.tagline}` : "提供"}` : model.tagline}
        </p>}
      </div>
      </div><div className="plugin-detail-actions">{actions}</div></div>
    </header>
    {model.prompts.length > 0 && <div className="plugin-detail-prompts">
      {model.prompts.map((text, index) => <button key={`${text}-${index}`} type="button" disabled={pending || !!promptDisabledReason || !onActivatePrompt} title={promptDisabledReason} aria-busy={pending} onClick={() => { void activate(text, index); }}>{text}</button>)}
    </div>}
    {promptError && <p role="alert">{promptError}</p>}
    {linkError && <p role="alert">{linkError}</p>}
    {model.description && <ExpandableContent key={`${identity}-description`} identity={`${identity}\0${model.description}`} lines={15}>
      <MarkdownView content={model.description} remoteContent="no-remote-images" />
    </ExpandableContent>}
    {included}
    {model.information.length > 0 && <section className="plugin-detail-information" aria-labelledby="plugin-information-title">
      <h2 id="plugin-information-title">信息</h2><dl>
        {model.information.map(row => <div key={row.label} data-align={row.label === "功能" ? "start" : "center"}><dt>{row.label}</dt><dd>
          {row.href ? <a href={row.href} target="_blank" rel="noreferrer">{row.value}</a> : row.label === "功能" ? <ExpandableContent identity={`${identity}\0${row.value}`} lines={3}>{row.value}</ExpandableContent> : row.value}
        </dd></div>)}
      </dl>
    </section>}
    <PluginDirectoryLegal detail={detail} apps={apps} />
  </article>;
}

import React, { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  readRecommendedSkills, installRecommendedSkill, verifyRecommendedSkillDiscovery,
  recommendedSkillFilePath, recommendedSkillDisplayName, matchRecommendedSkill,
  type RecommendedSkill, type RecommendedSkillsResponse, type InstalledRecommendedSkill,
} from "../recommendedSkills";
import { readFileText } from "../fsClient";
import { SkillPreviewDialog } from "./SkillPreviewDialog";

const featuredSkillRanks = new Map(
  ["imagegen", "sora", "pdf", "doc", "spreadsheet", "playwright"].map((name, index) => [name, index]),
);
const featuredLimit = 6;

interface Props {
  workspaceRoot: string;
  onInstalled: () => Promise<void>;
  writeBusy: boolean;
  beginInstall: () => boolean;
  finishInstall: () => void;
  installedSkills: InstalledRecommendedSkill[];
  renderInstalledSkill: (key: string, searchActive?: boolean) => React.ReactNode;
  onInstalledCardKeysChange: (keys: string[]) => void;
  searchQuery?: string;
  activeSearchResultIndex?: number;
  onSearchResultCountChange?: (count: number) => void;
}

export function RecommendedSkillsPanel({ workspaceRoot, onInstalled, writeBusy, beginInstall, finishInstall, installedSkills, renderInstalledSkill, onInstalledCardKeysChange, searchQuery = "", activeSearchResultIndex, onSearchResultCountChange }: Props) {
  const [catalog, setCatalog] = useState<RecommendedSkillsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, { kind: "success" | "error"; text: string }>>({});
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const alive = useRef(true);
  const readPending = useRef<Promise<void> | null>(null);
  const installPending = useRef(false);
  const copiedIds = useRef(new Set<string>());

  const query = searchQuery.trim().toLowerCase();
  const searching = query.length > 0;
  const skills = catalog?.skills ?? [];
  const candidates = searching
    ? skills.filter(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(query))
    : skills.map(skill => ({ skill, rank: featuredSkillRanks.get(recommendedSkillDisplayName(skill.name).trim().toLowerCase()) }))
      .filter(entry => entry.rank !== undefined || featuredSkillRanks.has(entry.skill.name.trim().toLowerCase()))
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
      .map(entry => entry.skill);
  const entries = candidates.map(skill => ({ skill, installed: matchRecommendedSkill(skill, installedSkills) }))
    .filter(entry => installedIds.has(entry.skill.id) || !entry.installed);
  const canExpand = !searching && entries.length >= featuredLimit + 3;
  const visibleEntries = canExpand && !expanded ? entries.slice(0, featuredLimit) : entries;
  const hiddenNames = canExpand ? entries.slice(featuredLimit).map(entry => entry.skill.name) : [];
  const installedKeys = JSON.stringify([...new Set(visibleEntries.flatMap(entry => installedSkills
    .filter(item => matchRecommendedSkill(entry.skill, [item])).map(item => item.key)))]);
  useEffect(() => { onInstalledCardKeysChange(JSON.parse(installedKeys)); }, [installedKeys, onInstalledCardKeysChange]);
  useEffect(() => { if (searching) setExpanded(false); }, [searching]);
  const searchResultCount = searching ? visibleEntries.length : 0;
  useEffect(() => { onSearchResultCountChange?.(searchResultCount); }, [searchResultCount, onSearchResultCountChange]);
  const preview = catalog?.skills.find(skill => skill.id === previewId);
  const previewInstalledKey = preview ? matchRecommendedSkill(preview, installedSkills)?.key : undefined;
  useEffect(() => { if (!preview || previewInstalledKey) setPreviewId(null); }, [preview?.id, previewInstalledKey]);

  const load = (refresh = false): Promise<void> => {
    if (readPending.current) return readPending.current;
    setLoading(true);
    setError(null);
    const pending = (async () => {
      try {
        const result = await readRecommendedSkills(refresh);
        if (alive.current) { setCatalog(result); setError(result.error); }
      } catch (err) {
        if (alive.current) setError(`推荐目录读取失败：${String(err)}`);
      } finally {
        readPending.current = null;
        if (alive.current) setLoading(false);
      }
    })();
    readPending.current = pending;
    return pending;
  };

  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; };
  }, []);

  const install = async (skill: RecommendedSkill) => {
    if (installPending.current || copiedIds.current.has(skill.id) || matchRecommendedSkill(skill, installedSkills) || !beginInstall()) return;
    installPending.current = true;
    setBusyId(skill.id);
    setOutcomes(current => ({ ...current, [skill.id]: { kind: "success", text: "正在安装…" } }));
    let destination: string | null = null;
    try {
      const result = await installRecommendedSkill(skill, null);
      destination = result.destination;
      if (!alive.current) return;
      copiedIds.current.add(skill.id);
      setInstalledIds(current => new Set(current).add(skill.id));
      setOutcomes(current => ({ ...current, [skill.id]: { kind: "success", text: "文件已安装，正在确认技能发现…" } }));
      const discovery = await verifyRecommendedSkillDiscovery(destination, workspaceRoot || null);
      if (!alive.current) return;
      setOutcomes(current => ({ ...current, [skill.id]: { kind: discovery.found ? "success" : "error", text: discovery.found
        ? `已安装并发现：${destination}${discovery.errors.length ? `；${discovery.errors.join("；")}` : ""}`
        : `文件已安装，技能发现待确认：${destination}${discovery.errors.length ? `；${discovery.errors.join("；")}` : ""}` },
      }));
      await onInstalled();
    } catch (err) {
      if (alive.current) setOutcomes(current => ({ ...current, [skill.id]: { kind: "error", text: destination
        ? `文件已安装，刷新失败：${destination}；${String(err)}`
        : `安装失败或结果未确认：${String(err)}` },
      }));
    } finally {
      installPending.current = false;
      finishInstall();
      if (alive.current) setBusyId(null);
    }
  };

  return <section className="pm-recommended-skills" aria-label="推荐技能">
    <div className="list-toolbar">
      <strong>推荐</strong>
      <button type="button" className="secondary-btn-sm" disabled={loading} onClick={() => void load(true)}>
        {loading ? "正在读取…" : "刷新推荐目录"}
      </button>
    </div>
    {error && <p role="alert">{error}{catalog?.skills.length ? "；仍显示已读取的目录。" : ""}</p>}
    {catalog && <p className="item-card-desc">
      {catalog.source === "local-source" ? "本地推荐来源" : catalog.source === "cache" ? "推荐目录缓存" : "推荐目录"}
      {catalog.fetchedAt !== null ? ` · ${new Date(catalog.fetchedAt).toLocaleString()}` : ""}
    </p>}
    {!loading && catalog?.skills.length === 0 && <p className="empty-hint">推荐目录没有可用技能。</p>}
    <div className="scrollable-items pm-recommended-skills-grid">
      {visibleEntries.map(({ skill, installed }, index) =>
        <div className={installed ? "pm-recommended-installed" : "item-card"} key={skill.id}
          role={installed ? "group" : "button"} tabIndex={installed ? -1 : 0} aria-label={installed ? `${installed.displayName ?? skill.name} 已安装` : undefined}
          data-skill-search-result={searching && !installed ? String(index === activeSearchResultIndex) : undefined}
          onClick={installed ? undefined : () => setPreviewId(skill.id)} onKeyDown={installed ? undefined : event => {
            if (event.target !== event.currentTarget || event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setPreviewId(skill.id); }
          }}>
        {installed ? <>{renderInstalledSkill(installed.key, searching ? index === activeSearchResultIndex : undefined)}
          {outcomes[skill.id]?.kind === "error" && <p role="alert">{outcomes[skill.id].text}</p>}
        </> : <><div className="item-card-main">
          <strong>{recommendedSkillDisplayName(skill.name)}</strong>
          <p className="item-card-desc">{skill.description}</p>
          {outcomes[skill.id]?.text && <p role={outcomes[skill.id].kind === "error" ? "alert" : "status"}>{outcomes[skill.id].text}</p>}
        </div>
        <button type="button" className="secondary-btn-sm" disabled={writeBusy || busyId !== null || installedIds.has(skill.id)} aria-busy={busyId === skill.id && !installedIds.has(skill.id)}
          onClick={event => { event.stopPropagation(); void install(skill); }}>{busyId === skill.id && !installedIds.has(skill.id) && <Loader2 size={14} className="pm-spin" aria-hidden="true" />}{installedIds.has(skill.id) ? "已安装" : "安装技能"}</button></>}
      </div>)}
    </div>
    {canExpand && <button type="button" className="pm-recommended-disclosure" aria-expanded={expanded}
      onClick={() => setExpanded(current => !current)}>
      {expanded ? "收起" : `查看${hiddenNames.slice(0, 2).join(", ")}，另有 ${hiddenNames.length - 2} 项`}
    </button>}
    {preview && catalog && !previewInstalledKey && <SkillPreviewDialog
      key={preview.id} identity={preview.id} name={recommendedSkillDisplayName(preview.name)} rawName={preview.name}
      description={preview.description} path={recommendedSkillFilePath(catalog.repoRoot, preview)} busy={writeBusy || busyId !== null}
      localHost={true} showMoreActions={false} loadContents={() => readFileText(recommendedSkillFilePath(catalog.repoRoot, preview))}
      onClose={() => setPreviewId(null)}
      actionFeedback={outcomes[preview.id]?.text ? outcomes[preview.id] : null}
      footer={<div className="pm-recommended-preview-footer"><button type="button" className="primary-btn-sm"
        disabled={writeBusy || busyId !== null || installedIds.has(preview.id)} aria-busy={busyId === preview.id && !installedIds.has(preview.id)} onClick={event => { event.stopPropagation(); void install(preview); }}>
        {busyId === preview.id && !installedIds.has(preview.id) && <Loader2 size={14} className="pm-spin" aria-hidden="true" />}{installedIds.has(preview.id) ? "已安装" : "安装技能"}
      </button></div>} />}
  </section>;
}

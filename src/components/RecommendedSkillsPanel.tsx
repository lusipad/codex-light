import React, { useEffect, useRef, useState } from "react";
import {
  readRecommendedSkills, installRecommendedSkill, verifyRecommendedSkillDiscovery,
  type RecommendedSkill, type RecommendedSkillsResponse,
} from "../recommendedSkills";

interface Props {
  workspaceRoot: string;
  onInstalled: () => Promise<void>;
  writeBusy: boolean;
  beginInstall: () => boolean;
  finishInstall: () => void;
}

export function RecommendedSkillsPanel({ workspaceRoot, onInstalled, writeBusy, beginInstall, finishInstall }: Props) {
  const [catalog, setCatalog] = useState<RecommendedSkillsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState("user");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const alive = useRef(true);
  const readPending = useRef<Promise<void> | null>(null);
  const installPending = useRef(false);

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
    if (installPending.current || !beginInstall()) return;
    installPending.current = true;
    setBusyId(skill.id);
    const root = scope === "project" ? workspaceRoot : null;
    setOutcomes(current => ({ ...current, [skill.id]: "正在安装…" }));
    let destination: string | null = null;
    try {
      const result = await installRecommendedSkill(skill, root);
      destination = result.destination;
      if (!alive.current) return;
      const discovery = await verifyRecommendedSkillDiscovery(destination, workspaceRoot || null);
      if (!alive.current) return;
      setOutcomes(current => ({ ...current, [skill.id]: discovery.found
        ? `已安装并发现：${destination}${discovery.errors.length ? `；${discovery.errors.join("；")}` : ""}`
        : `文件已安装，技能发现待确认：${destination}${discovery.errors.length ? `；${discovery.errors.join("；")}` : ""}`,
      }));
      await onInstalled();
    } catch (err) {
      if (alive.current) setOutcomes(current => ({ ...current, [skill.id]: destination
        ? `文件已安装，刷新失败：${destination}；${String(err)}`
        : `安装失败或结果未确认：${String(err)}`,
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
      <label>安装到 <select aria-label="技能安装范围" value={scope} disabled={writeBusy || busyId !== null}
        onChange={event => setScope(event.target.value)}>
        <option value="user">用户</option>
        {workspaceRoot && <option value="project">当前项目</option>}
      </select></label>
      <button type="button" className="secondary-btn-sm" disabled={loading} onClick={() => void load(true)}>
        {loading ? "正在读取…" : "刷新推荐目录"}
      </button>
    </div>
    {scope === "project" && <p className="item-card-desc">项目：{workspaceRoot}</p>}
    {error && <p role="alert">{error}{catalog?.skills.length ? "；仍显示已读取的目录。" : ""}</p>}
    {catalog && <p className="item-card-desc">
      {catalog.source === "local-source" ? "本地推荐来源" : catalog.source === "cache" ? "推荐目录缓存" : "推荐目录"}
      {catalog.fetchedAt !== null ? ` · ${new Date(catalog.fetchedAt).toLocaleString()}` : ""}
    </p>}
    {!loading && catalog?.skills.length === 0 && <p className="empty-hint">推荐目录没有可用技能。</p>}
    <div className="scrollable-items pm-recommended-skills-grid">
      {catalog?.skills.map(skill => <div className="item-card" key={skill.id}>
        <div className="item-card-main">
          <strong>{skill.name}</strong>
          <p className="item-card-desc">{skill.description}</p>
          <span className="pm-mono">{skill.repoPath}</span>
          {outcomes[skill.id] && <p role="status">{outcomes[skill.id]}</p>}
        </div>
        <button type="button" className="secondary-btn-sm" disabled={writeBusy || busyId !== null}
          onClick={() => void install(skill)}>{busyId === skill.id ? "安装中…" : "安装"}</button>
      </div>)}
    </div>
  </section>;
}

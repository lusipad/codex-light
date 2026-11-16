import React, { useEffect, useState } from "react";
import { BookOpen, Boxes, Plug, Workflow } from "lucide-react";
import type { PluginDetail, SkillMetadata, SkillSummary } from "../plugins";
import { recommendedSkillDisplayName } from "../recommendedSkills";
import { SkillPreviewDialog } from "./SkillPreviewDialog";
import { PluginManagementMcp } from "./PluginManagementMcp";
import { PluginProvidedSettings } from "./PluginProvidedSettings";
import "./PluginDirectoryIncluded.css";

interface PluginDirectoryIncludedProps {
  presentation?: "directory" | "settings";
  detail: PluginDetail;
  installedSkills: SkillMetadata[] | null;
  connectionIdentity: string;
  workspaceRoot: string;
  loadSkillContents?: (skill: SkillSummary, installed: SkillMetadata | null) => Promise<string>;
  onOpenMcpSettings?: () => void;
  onOpenHooksSettings?: () => void;
  onOpenSkillFile?: (path: string) => boolean | Promise<boolean>;
  onTrySkill?: (skill: SkillMetadata) => boolean | Promise<boolean>;
  onToggleSkill?: (skill: SkillMetadata) => void;
  skillBusy?: boolean;
  mcpCwd?: string;
  onConfigUpdated?: () => void | Promise<void>;
}

// Fixed-version oszP.r8: paths and protocol names establish ownership, never display names.
export function resolveIncludedSkill(skill: SkillSummary, pluginName: string, installedSkills: SkillMetadata[] | null): SkillMetadata | null {
  if (!installedSkills) return null;
  if (skill.path) {
    const exactPath = installedSkills.filter(item => item.path === skill.path).at(-1);
    if (exactPath) return exactPath;
  }
  let name = skill.name;
  if (!skill.path && !name.includes(":")) {
    if (!pluginName.trim()) return null;
    name = `${pluginName.trim()}:${name}`;
  }
  const exactName = installedSkills.filter(item => item.name === name).at(-1);
  if (exactName) return exactName;
  const comparable = (value: string) => value.trim().toLowerCase().split(":").map(part => part.replace(/[\s_-]/g, "")).join(":");
  const candidates = installedSkills.filter(item => comparable(item.name) === comparable(name));
  return candidates.length === 1 ? candidates[0] : null;
}

const skillTitle = (skill: SkillSummary | SkillMetadata) => skill.interface?.displayName?.trim() || recommendedSkillDisplayName(skill.name.split(":").at(-1) || skill.name);
const skillDescription = (skill: SkillSummary | SkillMetadata) => skill.interface?.shortDescription?.trim() || skill.shortDescription?.trim() || skill.description;

export function PluginDirectoryIncluded({ presentation = "directory", detail, installedSkills, connectionIdentity, workspaceRoot, loadSkillContents,
  onOpenMcpSettings, onOpenHooksSettings, onOpenSkillFile, onTrySkill, onToggleSkill, skillBusy = false, mcpCwd, onConfigUpdated }: PluginDirectoryIncludedProps) {
  const identity = JSON.stringify([connectionIdentity, workspaceRoot, detail.marketplaceName, detail.marketplacePath, detail.summary.id]);
  const [selection, setSelection] = useState<{ identity: string; index: number } | null>(null);
  useEffect(() => { setSelection(null); }, [identity]);
  const blocked = detail.summary.availability === "DISABLED_BY_ADMIN";
  const blockedReason = detail.summary.disabledReason?.trim() || "由于插件不可用，无法查看此技能";
  const canRead = (skill: SkillSummary, installed: SkillMetadata | null) => !!loadSkillContents && !!(
    installed?.path || skill.path || (detail.summary.source.type === "remote" && detail.summary.remotePluginId && detail.marketplaceName));
  const selectedSkill = selection?.identity === identity ? detail.skills[selection.index] : undefined;
  const selectedInstalled = selectedSkill ? resolveIncludedSkill(selectedSkill, detail.summary.name, installedSkills) : null;
  const previewSkill = selectedInstalled || selectedSkill;
  const path = selectedInstalled?.path || selectedSkill?.path || "";
  const canWrite = !blocked && selectedInstalled !== null && selectedInstalled.scope !== "admin";
  const skills = detail.skills.map((skill, index) => ({ skill, index, actual: resolveIncludedSkill(skill, detail.summary.name, installedSkills) }));
  const sectionHeading = (label: string, count: number) => <h2>{label}<span className="pm-detail-included-count">{count}</span></h2>;
  return <div className={`pm-detail-included${presentation === "settings" ? " pm-detail-included-settings-view" : ""}`}>
    {detail.apps.length > 0 && <section aria-label={presentation === "settings" ? "使用的应用" : "应用"}>
      {sectionHeading(presentation === "settings" ? "使用的应用" : "应用", detail.apps.length)}
      <div className="pm-detail-included-list">{detail.apps.map(app => <div className="pm-detail-included-row" key={app.id}>
        <span className="pm-detail-included-icon"><Boxes size={24} aria-hidden="true" /></span>
        <div className="pm-detail-included-copy"><span>{app.name}</span>{app.description && <p>{app.description}</p>}</div>
      </div>)}</div>
    </section>}
    {detail.mcpServers.length > 0 && (presentation === "settings" ? <PluginManagementMcp key={identity} identity={identity} detail={detail}
      cwd={mcpCwd} onOpenSettings={onOpenMcpSettings} onConfigUpdated={onConfigUpdated} /> : <section aria-label="MCP 服务器">
      <div className="pm-detail-included-heading">{sectionHeading("MCP 服务器", detail.mcpServers.length)}
        {onOpenMcpSettings && <button type="button" className="pm-detail-included-settings" onClick={onOpenMcpSettings}>设置</button>}</div>
      <div className="pm-detail-included-list">{detail.mcpServers.map(name => <div className="pm-detail-included-row" key={name}>
        <span className="pm-detail-included-icon"><Plug size={24} aria-hidden="true" /></span><span className="pm-detail-included-copy">{name}</span>
      </div>)}</div>
    </section>)}
    {presentation === "settings" && <PluginProvidedSettings detail={detail} identity={identity} />}
    {detail.skills.length > 0 && <section aria-label="技能">
      {sectionHeading("技能", detail.skills.length)}
      <div className="pm-detail-included-list">{[...skills.filter(item => item.actual), ...skills.filter(item => !item.actual)].map(({ skill, index, actual }) => {
        const shown = actual || skill;
        const readable = canRead(skill, actual);
        return <div className="pm-detail-included-skill" key={`${skill.path || skill.name}:${index}`}>
          <button type="button" className="pm-detail-included-row pm-detail-included-preview" data-skill-preview={skill.name}
            disabled={blocked || !readable} title={blocked ? blockedReason : !readable ? "此技能没有可读取的内容来源" : undefined}
            aria-label={`预览 ${skillTitle(shown)}`} onClick={() => setSelection({ identity, index })}>
            <span className="pm-detail-included-icon"><BookOpen size={24} aria-hidden="true" /></span>
            <span className="pm-detail-included-copy"><span>{skillTitle(shown)}</span><span className="pm-detail-included-description">{skillDescription(shown)}</span></span>
          </button>
          {!blocked && actual && actual.scope !== "admin" && onToggleSkill && <button type="button" role="switch" aria-checked={actual.enabled}
            className={`pm-skill-toggle ${actual.enabled ? "on" : ""}`} aria-label={`${actual.enabled ? "禁用" : "启用"} ${skillTitle(actual)}`}
            disabled={skillBusy} onClick={() => onToggleSkill(actual)} />}
        </div>;
      })}</div>
    </section>}
    {detail.hooks.length > 0 && <section aria-label="钩子">
      <div className="pm-detail-included-heading">{sectionHeading("钩子", detail.hooks.length)}
        {onOpenHooksSettings && <button type="button" className="pm-detail-included-settings" onClick={onOpenHooksSettings}>{presentation === "settings" ? "在设置中管理" : "设置"}</button>}</div>
      <div className="pm-detail-included-list">{detail.hooks.map(hook => <div className="pm-detail-included-row" key={hook.key}>
        <span className="pm-detail-included-icon"><Workflow size={24} aria-hidden="true" /></span><span className="pm-detail-included-copy">{hook.eventName}</span>
      </div>)}</div>
    </section>}
    {!blocked && selectedSkill && previewSkill && canRead(selectedSkill, selectedInstalled) && <SkillPreviewDialog
      key={JSON.stringify([identity, selection?.index, selectedSkill.name, path, detail.summary.remotePluginId, detail.summary.localVersion, detail.summary.version])} identity={identity}
      name={skillTitle(previewSkill)} rawName={selectedSkill.name} description={skillDescription(previewSkill)} path={path}
      enabled={selectedInstalled?.enabled} busy={skillBusy} localHost={!!path} canRetry={true}
      loadContents={() => loadSkillContents!(selectedSkill, selectedInstalled)}
      onClose={() => setSelection(null)}
      onToggle={canWrite && onToggleSkill ? () => onToggleSkill(selectedInstalled!) : undefined}
      onOpen={path && onOpenSkillFile ? () => onOpenSkillFile(path) : undefined}
      onTry={presentation === "directory" && selectedInstalled?.enabled && detail.summary.enabled && path && onTrySkill ? () => onTrySkill(selectedInstalled) : undefined}
      showMoreActions={presentation === "directory" && !!selectedInstalled}
      footer={presentation === "settings" ? null : !selectedInstalled ? <button type="button" className="primary-btn-sm" onClick={() => setSelection(null)}>关闭</button> : undefined}
    />}
  </div>;
}

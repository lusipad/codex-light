import React, { useLayoutEffect, useRef, useState } from "react";
import type { PluginCanonicalRootSnapshot } from "../pluginCanonicalRoot";
import type { PluginAppLink } from "../pluginAppDetails";
import type { PluginDetail } from "../plugins";
import { canonicalMcpAppId } from "../pluginManagementMcp";
import { usePluginSkillToggle } from "../pluginSkillToggle";
import { ChevronRightIcon } from "./Icons";
import { PluginSkillContentsDialog } from "./PluginSkillContentsDialog";
import "./PluginServiceSkillRow.css";

interface PluginServiceSkillRowProps {
  scope: string;
  snapshot: PluginCanonicalRootSnapshot;
  skill: PluginDetail["skills"][number];
  links: PluginAppLink[] | null;
  linksError: string | null;
  selectedSkillName?: string | null;
  onCloseSkill?: () => void;
  onRetryRequirements?: () => void;
  isCurrent: () => boolean;
}

export function PluginServiceSkillRow({ scope, snapshot, skill, links, linksError, selectedSkillName, onCloseSkill, onRetryRequirements, isCurrent }: PluginServiceSkillRowProps) {
  const lifetime = useRef({ scope, snapshot, skill, selectedSkillName, mounted: false });
  if (lifetime.current.scope !== scope || lifetime.current.snapshot !== snapshot || lifetime.current.skill !== skill || lifetime.current.selectedSkillName !== selectedSkillName) {
    lifetime.current = { scope, snapshot, skill, selectedSkillName, mounted: false };
  }
  const ticket = lifetime.current;
  const current = () => lifetime.current === ticket && ticket.mounted && isCurrent();
  const rowScope = JSON.stringify([scope, snapshot.pluginId, snapshot.identity.accountId, snapshot.identity.userId, snapshot.identity.generation, skill.name]);
  const toggle = usePluginSkillToggle(rowScope, snapshot, skill.name, current);
  const row = useRef<HTMLButtonElement>(null), flight = useRef<object | null>(null), returnAfterClose = useRef<typeof ticket | null>(null);
  const [opened, setOpened] = useState<typeof ticket | null>(null), [working, setWorking] = useState<typeof ticket | null>(null);
  useLayoutEffect(() => {
    ticket.mounted = true; flight.current = null;
    const origin = returnAfterClose.current;
    returnAfterClose.current = null;
    if (origin && origin.scope === scope && origin.snapshot === snapshot && origin.skill === skill && selectedSkillName == null && isCurrent() && row.current?.isConnected) row.current.focus({ preventScroll: true });
    return () => { ticket.mounted = false; flight.current = null; };
  }, [ticket]);
  const appIds = snapshot.genericUsage.flatMap(entry => entry.id === null ? [] : [entry.id]);
  const usable = links !== null && appIds.some(appId => {
    const matching = links.filter(link => canonicalMcpAppId(link.connector_id) === canonicalMcpAppId(appId));
    const visible = matching.filter(link => link.visibility !== "HIDDEN" && !link.id.startsWith("implicit_link::"));
    return matching.length !== visible.length || visible.some(link => link.auth_status !== "REAUTH_REQUIRED");
  });
  const requirementsBlocked = !toggle.checked && appIds.length > 0 && (links === null || linksError !== null || !usable);
  const disabled = toggle.adminDisabled || toggle.busy || toggle.pending || requirementsBlocked || working === ticket;
  const latest = useRef({ toggle, disabled }); latest.current = { toggle, disabled };
  const run = async (verify: boolean) => {
    const actual = latest.current;
    if (!current() || flight.current !== null || actual.toggle.busy || (verify ? !actual.toggle.pending : !actual.toggle.installed || actual.disabled)) return;
    const token = {}; flight.current = token; setWorking(ticket);
    try {
      if (verify) await actual.toggle.verify();
      else await actual.toggle.change(!actual.toggle.checked);
    } catch { /* The shared toggle hook owns mutation and verification errors. */ }
    finally {
      if (lifetime.current === ticket && ticket.mounted && flight.current === token) { flight.current = null; setWorking(null); }
    }
  };
  const name = skill.interface?.displayName ?? skill.name;
  const description = skill.interface?.shortDescription ?? skill.description;
  const switchElement = toggle.installed ? <button type="button" role="switch" className={`pssr-toggle${toggle.checked ? " on" : ""}`}
    aria-checked={toggle.checked} aria-label={`使用 ${name}`} disabled={disabled}
    title={!toggle.checked && appIds.length > 0 && links !== null && !linksError && !usable ? "需要先关联应用" : undefined}
    onClick={event => { event.stopPropagation(); void run(false); }} /> : undefined;
  const open = opened === ticket || selectedSkillName === skill.name;
  const feedback = (linksError && appIds.length > 0 || toggle.error || toggle.pending) ? <>
    {linksError && appIds.length > 0 && <div className="pssr-feedback"><span role="alert">无法加载插件设置</span>
      {onRetryRequirements && <button type="button" className="secondary-btn-sm" onClick={() => { if (current()) onRetryRequirements(); }}>重试</button>}
    </div>}
    {toggle.error && <div className="pssr-feedback" role="alert">无法更新此技能。请重试</div>}
    {toggle.pending && <div className="pssr-feedback"><button type="button" className="secondary-btn-sm" disabled={toggle.busy || working === ticket}
      onClick={() => { void run(true); }}>核验技能状态</button></div>}
  </> : undefined;
  return <div className="pssr-skill">
    <div className="pssr-row">
      <button type="button" className="pssr-main" ref={node => { if (node) row.current = node; }}
        onClick={() => { if (current()) setOpened(ticket); }}>
        <span className="pssr-label"><span>{name}</span>{description && <span className="pssr-description">{description}</span>}</span>
        <span className="pssr-chevron" aria-hidden="true"><ChevronRightIcon /></span>
      </button>
      {switchElement && <div className="pssr-switch">{switchElement}</div>}
    </div>
    {feedback}
    {open && <PluginSkillContentsDialog scope={rowScope} pluginId={snapshot.pluginId} skill={skill} identity={snapshot.identity}
      isCurrent={current} headerActions={switchElement} footer={feedback} returnFocusRef={row} onClose={() => {
        if (!current()) return;
        setOpened(null);
        if (selectedSkillName === skill.name && onCloseSkill) { returnAfterClose.current = ticket; onCloseSkill(); }
      }} />}
  </div>;
}

import React, { useLayoutEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { pluginAppSyncBadge, pluginAppSyncSummary, selectPluginAppSync } from "../pluginAppSync";
import { usePluginAppSync } from "../pluginAppSyncState";
import "./PluginAppSyncPage.css";

export function PluginAppSyncEntry({ connectionIdentity, pluginId, appId, selectedLinkId, disabled, onOpen }: {
  connectionIdentity: string; pluginId: string; appId: string; selectedLinkId: string | null; disabled: boolean;
  onOpen: (linkId: string | null) => void;
}) {
  const { state } = usePluginAppSync(connectionIdentity, pluginId, appId, selectedLinkId);
  const identity = state.snapshot?.identity;
  const scope = JSON.stringify([connectionIdentity, pluginId, appId, selectedLinkId, state.snapshot?.appId, identity?.accountId, identity?.userId, identity?.generation]);
  const generation = useRef({ scope }), mounted = useRef(false), latest = useRef({ state, disabled });
  if (generation.current.scope !== scope) generation.current = { scope };
  latest.current = { state, disabled };
  const token = generation.current;
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, [token]);
  const summary = state.snapshot ? pluginAppSyncSummary(state.snapshot.statuses) : null;
  if (!summary || state.loading || state.error || state.blocked) return null;
  const badge = pluginAppSyncBadge(summary.user_connection_details.activation_status);
  return <button key={scope} type="button" className="pas-entry" disabled={disabled} onClick={() => {
    const actual = latest.current;
    if (!mounted.current || generation.current !== token || actual.disabled || actual.state.loading || actual.state.error || actual.state.blocked || !actual.state.snapshot?.statuses.length) return;
    const selected = selectPluginAppSync(actual.state.snapshot.details, selectedLinkId, actual.state.snapshot.statuses);
    onOpen(selected.selectedLink?.id ?? null);
  }}><span>同步</span><span className={`pas-badge pas-badge-${badge.variant}`}>{badge.label}</span><ChevronRight size={16} aria-hidden="true" /></button>;
}

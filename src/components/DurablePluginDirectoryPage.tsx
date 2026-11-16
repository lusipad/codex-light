import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadDurablePluginDetail } from "../durablePluginDetail";
import type { PluginSummary } from "../plugins";
import { PluginDirectoryDetail } from "./PluginDirectoryDetail";
import { PluginDirectoryIncluded } from "./PluginDirectoryIncluded";

type Snapshot = Awaited<ReturnType<typeof loadDurablePluginDetail>>;
interface Props {
  connectionIdentity: string;
  pluginId: string;
  onBack: () => void;
  onManage?: (rawId: string) => void;
  onTryPlugin?: (summary: PluginSummary, prompt: string) => boolean | Promise<boolean>;
}
interface State { scope: string; version: number; loading: boolean; snapshot: Snapshot | null; error: boolean }

export function DurablePluginDirectoryPage({ connectionIdentity, pluginId, onBack, onManage, onTryPlugin }: Props) {
  const scope = JSON.stringify([connectionIdentity, pluginId]);
  const lifetime = useRef({ scope, version: 0, mounted: false });
  if (lifetime.current.scope !== scope) lifetime.current = { scope, version: lifetime.current.version + 1, mounted: false };
  const version = lifetime.current.version;
  const active = () => lifetime.current.mounted && lifetime.current.scope === scope && lifetime.current.version === version;
  const [state, setState] = useState<State>({ scope, version, loading: true, snapshot: null, error: false });
  const decision = useRef(state); decision.current = state;
  const request = useRef<{ scope: string; version: number; controller: AbortController } | null>(null), sequence = useRef(0);
  const promptFlight = useRef<object | null>(null);
  const visible = state.scope === scope && state.version === version ? state : null;
  const snapshot = visible?.snapshot ?? null;
  const ready = () => active() && decision.current.scope === scope && decision.current.version === version && !decision.current.loading &&
    !decision.current.error && decision.current.snapshot === snapshot && snapshot !== null;
  const reload = () => {
    if (!active() || decision.current.scope === scope && decision.current.version === version && decision.current.loading && request.current?.scope === scope && request.current.version === version && !request.current.controller.signal.aborted) return;
    request.current?.controller.abort();
    const controller = new AbortController(), token = ++sequence.current;
    request.current = { scope, version, controller };
    const pending = { scope, version, loading: true, snapshot: null, error: false };
    decision.current = pending; setState(pending);
    void loadDurablePluginDetail(pluginId, controller.signal).then(next => {
      if (!next?.detail || next.detail.summary?.remotePluginId !== pluginId || next.detail.summary.source.type !== "remote") throw Error("Invalid durable detail identity");
      return next;
    }).then(next => {
      if (!active() || controller.signal.aborted || sequence.current !== token) return;
      const loaded = { scope, version, loading: false, snapshot: next, error: false };
      decision.current = loaded; setState(loaded);
    }, () => {
      if (!active() || controller.signal.aborted || sequence.current !== token) return;
      const failed = { scope, version, loading: false, snapshot: null, error: true };
      decision.current = failed; setState(failed);
    });
  };
  useLayoutEffect(() => {
    lifetime.current.mounted = true;
    promptFlight.current = null;
    return () => { if (lifetime.current.scope === scope && lifetime.current.version === version) lifetime.current.mounted = false; };
  }, [scope, version]);
  useEffect(() => {
    reload();
    return () => { const owned = request.current; if (owned?.scope === scope && owned.version === version) owned.controller.abort(); };
  }, [scope, version]);
  useEffect(() => {
    if (!snapshot || !ready()) return;
    const previous = document.title;
    document.title = snapshot.detail.summary.interface?.displayName ?? snapshot.detail.summary.name;
    return () => { document.title = previous; };
  }, [scope, version, snapshot]);

  const detail = snapshot?.detail, summary = detail?.summary;
  const disabledReason = !summary?.installed ? "此入口暂不支持安装插件。" : summary.availability === "DISABLED_BY_ADMIN" ? "插件已被管理员禁用。"
    : !summary.enabled ? "插件已禁用，请在设置中管理。" : summary.remotePolicyKnown !== true ? "无法确认插件可用性，请重新读取。"
      : !onTryPlugin ? "当前入口暂不支持将插件添加到草稿。" : undefined;
  const activate = async (text: string, index: number): Promise<boolean> => {
    if (!ready() || disabledReason || !summary || !onTryPlugin || promptFlight.current !== null) return false;
    const prompts = (summary.interface?.defaultPrompt ?? []).map(value => value.trim()).filter(Boolean);
    if (!Number.isInteger(index) || index < 0 || index >= prompts.length || !text.trim() || text !== prompts[index]) return false;
    const operation = {}; promptFlight.current = operation;
    try { const result = await onTryPlugin(summary, text); return ready() && promptFlight.current === operation && result === true; }
    finally { if (promptFlight.current === operation) promptFlight.current = null; }
  };
  return <section className="pm-catalog-detail" aria-busy={visible?.loading ?? true}>
    <a href="/plugins?hostId=durable" className="pm-catalog-back" onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); if (active()) onBack();
    }}>插件</a>
    {!visible || visible.loading ? <p role="status">正在加载…</p> : visible.error || !detail ? <div role="alert">
      <p>无法加载插件</p><button type="button" className="secondary-btn-sm" onClick={reload}>重试</button>
    </div> : <PluginDirectoryDetail key={JSON.stringify([scope, version, snapshot?.identity])} detail={detail}
      promptDisabledReason={disabledReason} onActivatePrompt={activate}
      actions={summary!.installed ? onManage && <button type="button" className="secondary-btn-sm"
        onClick={() => { if (ready()) onManage(pluginId); }}>管理</button>
        : <button type="button" className="primary-btn-sm" disabled title="此入口暂不支持安装插件。">安装</button>}
      included={<PluginDirectoryIncluded detail={detail} installedSkills={null}
        connectionIdentity={JSON.stringify([scope, version, snapshot?.identity])} workspaceRoot="" />} />}
  </section>;
}

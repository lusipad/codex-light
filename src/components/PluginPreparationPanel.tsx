import React, { useEffect, useRef, useState } from "react";
import { tauriInvoke } from "../bridge";
import { readPluginPreparationState, type PluginInstallResponse, type PluginPreparationState } from "../plugins";

export function pluginInstallLink(value: string | null | undefined): string | null {
  if (!value || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

interface Props {
  name: string;
  result: PluginInstallResponse;
  onRefresh: () => Promise<void>;
  onVerify?: () => Promise<string>;
  verificationUnavailableReason?: string;
}

export function PluginPreparationPanel({ name, result, onRefresh, onVerify, verificationUnavailableReason }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [snapshot, setSnapshot] = useState<PluginPreparationState | null>(null);
  const [waiting, setWaiting] = useState<string[]>([]);
  const [opening, setOpening] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verification, setVerification] = useState<string | null>(null);
  const alive = useRef(true);
  const request = useRef(0);
  const checkPending = useRef<Promise<void> | null>(null);
  const openPending = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; ++request.current; };
  }, []);

  const check = (): Promise<void> => {
    if (checkPending.current) return checkPending.current;
    const revision = ++request.current;
    const current = () => alive.current && request.current === revision;
    setChecking(true);
    setError(null);
    setVerification(null);
    // Once refreshing starts, a previous successful read is no longer current.
    setSnapshot(null);
    const operation = (async () => {
      try {
        const value = await readPluginPreparationState({ forceRefetch: true });
        if (!current()) return;
        setSnapshot(value);
        await onRefresh();
        if (!current()) return;
        if (onVerify) {
          const message = await onVerify();
          if (current()) setVerification(message);
        }
      } catch (err) {
        if (current()) setError(`连接状态读取失败：${String(err)}`);
      } finally {
        if (current()) setChecking(false);
        checkPending.current = null;
      }
    })();
    checkPending.current = operation;
    return operation;
  };

  const connect = async (id: string, link: string | null) => {
    if (!link || openPending.current) return;
    openPending.current = true;
    const revision = request.current;
    setOpening(id);
    setError(null);
    try {
      await tauriInvoke("review_link_open", { url: link });
      if (alive.current && request.current === revision) {
        setWaiting(items => items.includes(id) ? items : [...items, id]);
      }
    } catch (err) {
      if (alive.current && request.current === revision) setError(`无法打开连接页面：${String(err)}`);
    } finally {
      openPending.current = false;
      if (alive.current) setOpening(null);
    }
  };

  return (
    <section className="item-card pm-detail-panel" aria-label={`${name} 连接准备`}>
      <div className="item-card-title-row">
        <strong>{name} · 连接应用</strong>
        <button type="button" className="secondary-btn-sm" onClick={() => setExpanded(value => !value)}>
          {expanded ? "收起连接准备" : "继续连接"}
        </button>
      </div>
      {expanded && <>
        <p className="item-card-desc">
          {result.authPolicy === "ON_INSTALL" ? "安装完成后需要连接以下应用。" : "以下应用可在使用时连接。"}
          在浏览器中完成操作后，请检查连接状态。
        </p>
        {result.appsNeedingAuth.map(app => {
          const catalog = snapshot?.catalog.find(item => item.id === app.id);
          const runtime = snapshot?.installed.find(item => item.id === app.id);
          const link = pluginInstallLink(catalog?.installUrl ?? app.installUrl);
          return <div key={app.id} className="pm-detail-item">
            <strong>{app.name}</strong>
            <span>{waiting.includes(app.id) ? "已打开连接页面，等待检查" : "待连接"}</span>
            <button type="button" className="secondary-btn-sm" disabled={!link || opening !== null || checking}
              onClick={() => connect(app.id, link)}>
              {opening === app.id ? "正在打开…" : "连接"}
            </button>
            {!link && <span>连接链接不可用，请检查状态后重试。</span>}
            {snapshot && <div role="status">
              {snapshot.source === "runtime" ? "运行时访问" : "目录访问"}：{catalog?.isAccessible === true ? "可访问" : catalog?.isAccessible === false ? "不可访问" : "尚未确认"}；
              运行时：{runtime ? runtime.callable ? "可调用" : runtime.enabled ? "已启用，尚不可调用" : "未启用" : "未发现"}
            </div>}
          </div>;
        })}
        <button type="button" className="secondary-btn-sm" disabled={checking || opening !== null} onClick={() => void check()}>
          {checking ? "正在检查…" : "检查连接状态"}
        </button>
        {snapshot && !verification && <p className="item-card-desc">已读取当前可用状态，授权结果仍待确认。</p>}
        {!!verificationUnavailableReason && <p role="alert">{verificationUnavailableReason}</p>}
        {verification && <p role="status">{verification}</p>}
        {error && <p role="alert">{error}</p>}
      </>}
    </section>
  );
}

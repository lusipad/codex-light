import React from "react";
import { defaultUsageGroups, useAccountUsage, type UsageWindow } from "../accountUsage";
import "./UsageSettings.css";

export function usageWindowLabel(minutes: number): string {
  const near = (target: number) => Math.abs(minutes - target) <= target * .05;
  if (near(300)) return "5 小时限额";
  if (near(10080)) return "每周限额";
  if (near(43200)) return "每月使用限额";
  if (near(1440)) return "每日使用限额";
  return "用量限制";
}

function UsageLimit({ window }: { window: UsageWindow }) {
  const date = window.resetsAt === null ? null : new Date(window.resetsAt * 1000);
  const reset = date && Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN") : null;
  return <div className="usage-limit">
    <span className="usage-limit-label">{usageWindowLabel(window.minutes)}</span>
    <div className="usage-limit-heading"><span>{reset ? `重置时间：${reset}` : ""}</span>
      <span>{window.remaining === null ? "暂不可用" : `剩余 ${Math.round(window.remaining)}%`}</span></div>
    {window.remaining !== null && <progress max={100} value={window.remaining} aria-label={`${usageWindowLabel(window.minutes)}剩余`} className={window.remaining <= 10 ? "usage-limit-low" : undefined} />}
  </div>;
}

export function UsageSettings({ accountIdentity, connectionIdentity }: { accountIdentity?: string; connectionIdentity: string }) {
  const { data, loading, error, refresh } = useAccountUsage(accountIdentity, connectionIdentity);
  const groups = data ? (data.source === "service" ? defaultUsageGroups(data.groups) : data.groups) : [];
  return <div className="settings-scroll-container usage-settings" aria-busy={loading}>
    <div className="usage-settings-heading"><h3>使用情况和计费</h3>
      <button type="button" className="secondary-btn" disabled={loading} onClick={() => void refresh()}>刷新</button></div>
    {loading && <p role="status">正在加载使用情况设置…</p>}
    {error && <p role="alert" className="error-banner">{error}</p>}
    {data?.mode === "signed-out" && <p>请先登录以查看使用情况。</p>}
    {data?.mode === "other" && <p>当前登录方式不提供 ChatGPT 使用情况。</p>}
    {data?.mode === "chatgpt" && <>
      <section className="usage-plan"><h4>当前套餐</h4><span>{data.plan || "暂不可用"}</span></section>
      {data.warning && <p role="status" className="usage-settings-notice">{data.warning}</p>}
      {data.source === "connection" && <p className="usage-settings-notice">当前连接的用量限制</p>}
      <section className="usage-limits">
        {groups.filter(group => group.windows.length > 0).map(group => <section className="usage-limit-section" key={group.key}>
          <h4>{group.name ? `${group.name} 使用限额` : "套餐限额"}</h4>
          <div className="usage-limit-group">{group.windows.map(window => <UsageLimit key={window.key} window={window} />)}</div>
        </section>)}
        {!groups.some(group => group.windows.length > 0) && <p>用量限制暂不可用。</p>}
      </section>
      {data.credits && <section className="usage-credits"><h4>额度</h4>
        <span>{data.credits.unlimited === true ? "不限额" : data.credits.balance !== null ? data.credits.balance : data.credits.available === false ? "无可用额度" : "余额暂不可用"}</span>
      </section>}
    </>}
  </div>;
}

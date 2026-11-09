import React, { useId, useMemo, useState } from "react";
import "./TokenUsageMeter.css";

export interface TokenUsageSnapshot {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  modelContextWindow?: number;
  contextWindow?: number;
  percentRemaining?: number;
  [key: string]: any;
}

export interface TokenUsageMeterProps {
  usage: TokenUsageSnapshot | null;
  variant?: "compact" | "popover";
  rateLimits?: any | null;
}

interface UsageDetail {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningOutputTokens: number | null;
  totalTokens: number | null;
  contextWindow: number | null;
  remainingPercent: number | null;
  usedPercent: number | null;
}

interface UsageRow {
  label: string;
  value: string;
  emphasis?: boolean;
}

interface RateLimitEntry {
  key: string;
  label: string;
  usedPercent: number | null;
  resetsAt: number | null;
  windowMins: number | null;
}

const RING_SIZE = 20;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function ComposerContextUsage({ usage }: { usage: TokenUsageSnapshot | null }) {
  const tooltipId = useId();
  const [dismissed, setDismissed] = useState(false);
  const capacity = usage?.modelContextWindow;
  const last = usage?.last?.totalTokens;
  if (typeof capacity !== "number" || !Number.isFinite(capacity) || capacity <= 0 ||
      typeof last !== "number" || !Number.isFinite(last) || last < 0) return null;
  const used = Math.min(last, capacity);
  const ratio = used / capacity;
  const percent = Math.round(ratio * 100);
  return <span className="composer-context-usage" tabIndex={0} data-dismissed={dismissed}
    role="img" aria-label={`上下文用量：${percent}%`} aria-describedby={tooltipId}
    onFocus={() => setDismissed(false)} onPointerEnter={() => setDismissed(false)}
    onKeyDown={event => {
      if (event.key !== "Escape" || event.nativeEvent.isComposing || event.keyCode === 229) return;
      event.stopPropagation();
      setDismissed(true);
    }}>
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".35" />
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5"
        pathLength="100" strokeDasharray={`${ratio * 100} 100`} transform="rotate(-90 6 6)" />
    </svg>
    <span id={tooltipId} className="composer-context-tooltip" role="tooltip">
      <span>背景信息窗口：</span>
      <span className={percent >= 50 ? "composer-context-tooltip-used" : undefined}>
        {percent}% 已用{percent < 50 ? `（剩余 ${100 - percent}%）` : ""}
      </span>
      <span>已用 {Math.round(used / 1000)}k 标记，共 {Math.round(capacity / 1000)}k</span>
    </span>
  </span>;
}

function toFiniteNumber(value: any): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstNumber(...values: any[]): number | null {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function trimDecimal(value: number): string {
  const abs = Math.abs(value);
  const fixed = abs >= 100 ? value.toFixed(0) : abs >= 10 ? value.toFixed(1) : value.toFixed(2);
  if (!fixed.includes(".")) return fixed;
  return fixed.replace(/0+$/, "").replace(/\.$/, "");
}

/** K/M token formatting: 1320 → 1.3K, 128000 → 128K, 1500000 → 1.5M. */
function formatTokenCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trimDecimal(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${trimDecimal(value / 1_000)}K`;
  return `${Math.round(value)}`;
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${Math.round(value)}%`;
}

function readUsage(usage: TokenUsageSnapshot | null): UsageDetail {
  const empty: UsageDetail = {
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    reasoningOutputTokens: null,
    totalTokens: null,
    contextWindow: null,
    remainingPercent: null,
    usedPercent: null,
  };
  if (!usage || typeof usage !== "object") return empty;

  // Server snapshots may arrive flat or nested under total/lastTurn objects.
  const nested = [usage.total, usage.lastTurn, usage.totalTokenUsage, usage.lastTurnTokenUsage].find(
    (candidate) => candidate && typeof candidate === "object"
  ) as Record<string, any> | undefined;

  const inputTokens = firstNumber(usage.inputTokens, nested?.inputTokens);
  const cachedInputTokens = firstNumber(usage.cachedInputTokens, nested?.cachedInputTokens);
  const outputTokens = firstNumber(usage.outputTokens, nested?.outputTokens);
  const reasoningOutputTokens = firstNumber(
    usage.reasoningOutputTokens,
    nested?.reasoningOutputTokens
  );
  let totalTokens = firstNumber(usage.totalTokens, nested?.totalTokens);
  if (totalTokens === null && (inputTokens !== null || outputTokens !== null)) {
    totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);
  }
  const contextWindow = firstNumber(
    usage.modelContextWindow,
    usage.contextWindow,
    nested?.modelContextWindow,
    nested?.contextWindow
  );

  const percentRemaining = firstNumber(usage.percentRemaining, nested?.percentRemaining);
  let remainingPercent: number | null =
    percentRemaining === null ? null : clampPercent(percentRemaining);
  let usedPercent: number | null =
    remainingPercent === null ? null : clampPercent(100 - remainingPercent);

  // Fallback: derive the ratio from totalTokens / contextWindow.
  if (usedPercent === null && totalTokens !== null && contextWindow !== null && contextWindow > 0) {
    usedPercent = clampPercent((totalTokens / contextWindow) * 100);
    remainingPercent = clampPercent(100 - usedPercent);
  }

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
    contextWindow,
    remainingPercent,
    usedPercent,
  };
}

function hasUsageDetail(detail: UsageDetail): boolean {
  return (
    detail.inputTokens !== null ||
    detail.cachedInputTokens !== null ||
    detail.outputTokens !== null ||
    detail.reasoningOutputTokens !== null ||
    detail.totalTokens !== null ||
    detail.contextWindow !== null ||
    detail.usedPercent !== null
  );
}

function severityOf(usedPercent: number | null): "empty" | "normal" | "warn" | "danger" {
  if (usedPercent === null) return "empty";
  if (usedPercent >= 90) return "danger";
  if (usedPercent >= 70) return "warn";
  return "normal";
}

function buildCompactTitle(detail: UsageDetail): string {
  if (!hasUsageDetail(detail)) return "暂无用量数据";
  const parts: string[] = [];
  if (detail.usedPercent !== null) {
    parts.push(`上下文已用 ${formatPercent(detail.usedPercent)}`);
  }
  if (detail.remainingPercent !== null) {
    parts.push(`剩余 ${formatPercent(detail.remainingPercent)}`);
  }
  if (detail.totalTokens !== null && detail.contextWindow !== null) {
    parts.push(`${formatTokenCount(detail.totalTokens)} / ${formatTokenCount(detail.contextWindow)} tokens`);
  } else if (detail.totalTokens !== null) {
    parts.push(`${formatTokenCount(detail.totalTokens)} tokens`);
  }
  return parts.length > 0 ? parts.join(" · ") : "暂无用量数据";
}

function buildRemainingValue(detail: UsageDetail): string {
  const parts: string[] = [];
  if (detail.remainingPercent !== null) {
    parts.push(formatPercent(detail.remainingPercent));
  }
  if (detail.contextWindow !== null && detail.totalTokens !== null) {
    parts.push(formatTokenCount(Math.max(0, detail.contextWindow - detail.totalTokens)));
  }
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function formatResetTime(resetsAt: number | null): string | null {
  if (resetsAt === null || !Number.isFinite(resetsAt)) return null;
  // Protocol sends unix seconds; tolerate milliseconds just in case.
  const ms = Math.abs(resetsAt) > 1_000_000_000_000 ? resetsAt : resetsAt * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return date.toISOString();
  }
}

function windowLabel(windowMins: number | null): string | null {
  if (windowMins === null || windowMins <= 0) return null;
  if (windowMins % 1440 === 0) return `${windowMins / 1440} 天限额`;
  if (windowMins % 60 === 0) return `${windowMins / 60} 小时限额`;
  return `${windowMins} 分钟限额`;
}

function readRateLimitEntry(raw: any, fallbackLabel: string): RateLimitEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const usedPercent = firstNumber(raw.usedPercent, raw.used_percent, raw.percentUsed);
  const resetsAt = firstNumber(raw.resetsAt, raw.resets_at, raw.resetAt);
  const windowMins = firstNumber(
    raw.windowDurationMins,
    raw.windowMinutes,
    raw.window_minutes,
    raw.windowMins
  );
  if (usedPercent === null && resetsAt === null && windowMins === null) return null;
  return {
    key: fallbackLabel,
    label: windowLabel(windowMins) || fallbackLabel,
    usedPercent: usedPercent === null ? null : clampPercent(usedPercent),
    resetsAt,
    windowMins,
  };
}

/**
 * `rateLimits` may be the raw `account/rateLimits/read` response (snapshot nested
 * under `.rateLimits`), the snapshot itself, or a `rateLimitsByLimitId` map.
 */
function resolveRateLimitSnapshot(rateLimits: any): any {
  if (!rateLimits || typeof rateLimits !== "object") return null;
  if (rateLimits.rateLimits && typeof rateLimits.rateLimits === "object") {
    return rateLimits.rateLimits;
  }
  if (rateLimits.primary || rateLimits.secondary || rateLimits.credits) {
    return rateLimits;
  }
  if (rateLimits.rateLimitsByLimitId && typeof rateLimits.rateLimitsByLimitId === "object") {
    const first = Object.values(rateLimits.rateLimitsByLimitId).find(
      (entry) => entry && typeof entry === "object"
    );
    if (first) return first;
  }
  return rateLimits;
}

function readRateLimits(rateLimits: any): RateLimitEntry[] {
  const snapshot = resolveRateLimitSnapshot(rateLimits);
  if (!snapshot || typeof snapshot !== "object") return [];
  const entries: RateLimitEntry[] = [];
  const primary = readRateLimitEntry(snapshot.primary, "主限额");
  if (primary) entries.push(primary);
  const secondary = readRateLimitEntry(snapshot.secondary, "次限额");
  if (secondary) entries.push(secondary);
  if (entries.length === 0) {
    const single = readRateLimitEntry(snapshot, "速率限制");
    if (single) entries.push(single);
  }
  return entries;
}

interface CreditsDetail {
  unlimited: boolean;
  balance: string | null;
  hasCredits: boolean | null;
}

function readCredits(rateLimits: any): CreditsDetail | null {
  const snapshot = resolveRateLimitSnapshot(rateLimits);
  if (!snapshot || typeof snapshot !== "object") return null;
  const raw = snapshot.credits ?? snapshot.credit ?? null;
  if (!raw || typeof raw !== "object") return null;
  const balanceRaw = raw.balance ?? raw.remaining ?? null;
  const balance =
    balanceRaw === null || balanceRaw === undefined
      ? null
      : typeof balanceRaw === "number"
        ? trimDecimal(balanceRaw)
        : String(balanceRaw);
  return {
    unlimited: raw.unlimited === true,
    balance,
    hasCredits: typeof raw.hasCredits === "boolean" ? raw.hasCredits : null,
  };
}

function creditsValue(credits: CreditsDetail): string {
  if (credits.unlimited) return "无限";
  if (credits.balance !== null) return credits.balance;
  if (credits.hasCredits === false) return "无可用额度";
  return "—";
}

export const TokenUsageMeter: React.FC<TokenUsageMeterProps> = ({
  usage,
  variant = "compact",
  rateLimits = null,
}) => {
  const detail = useMemo<UsageDetail>(() => readUsage(usage), [usage]);
  const limits = useMemo<RateLimitEntry[]>(() => readRateLimits(rateLimits), [rateLimits]);
  const credits = useMemo<CreditsDetail | null>(() => readCredits(rateLimits), [rateLimits]);

  const severity = severityOf(detail.usedPercent);
  const hasData = hasUsageDetail(detail);
  const compactTitle = buildCompactTitle(detail);
  const compactLabel =
    detail.remainingPercent !== null
      ? formatPercent(detail.remainingPercent)
      : detail.usedPercent !== null
        ? formatPercent(detail.usedPercent)
        : "—";
  const dashOffset = RING_CIRCUMFERENCE * (1 - (detail.usedPercent ?? 0) / 100);

  if (variant === "popover") {
    const rows: UsageRow[] = [
      { label: "输入", value: formatTokenCount(detail.inputTokens) },
      { label: "缓存输入", value: formatTokenCount(detail.cachedInputTokens) },
      { label: "输出", value: formatTokenCount(detail.outputTokens) },
      { label: "推理输出", value: formatTokenCount(detail.reasoningOutputTokens) },
      { label: "总计", value: formatTokenCount(detail.totalTokens), emphasis: true },
      { label: "上下文窗口", value: formatTokenCount(detail.contextWindow) },
      { label: "剩余", value: buildRemainingValue(detail) },
    ];

    return (
      <div className="token-usage-popover" role="group" aria-label="上下文用量">
        <div className="token-usage-popover-header">
          <span className="token-usage-popover-title">上下文用量</span>
          <span className="token-usage-popover-subtitle">
            {detail.remainingPercent !== null
              ? `剩余 ${formatPercent(detail.remainingPercent)}`
              : detail.usedPercent !== null
                ? `已用 ${formatPercent(detail.usedPercent)}`
                : "—"}
          </span>
        </div>

        {hasData ? (
          <>
            {detail.usedPercent !== null && (
              <div
                className={`token-usage-progress token-usage-progress--${severity}`}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(detail.usedPercent)}
                aria-label="上下文占用比例"
              >
                <div
                  className="token-usage-progress-fill"
                  style={{ width: `${detail.usedPercent}%` }}
                />
              </div>
            )}

            <div className="token-usage-rows">
              {rows.map((row) => (
                <div
                  className={`token-usage-row${row.emphasis ? " is-emphasis" : ""}`}
                  key={row.label}
                >
                  <span className="token-usage-row-label">{row.label}</span>
                  <span className="token-usage-row-value">{row.value}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="token-usage-empty">暂无用量数据</div>
        )}

        {(limits.length > 0 || credits) && (
          <div className="token-usage-rate-limits">
            <div className="token-usage-rate-title">速率限制</div>
            {limits.map((limit) => {
              const resetLabel = formatResetTime(limit.resetsAt);
              const limitSeverity = severityOf(limit.usedPercent);
              return (
                <div className="token-usage-rate-entry" key={limit.key}>
                  <div className="token-usage-rate-head">
                    <span>{limit.label}</span>
                    <span className="token-usage-rate-value">
                      {limit.usedPercent !== null
                        ? `已用 ${formatPercent(limit.usedPercent)}`
                        : "—"}
                    </span>
                  </div>
                  {limit.usedPercent !== null && (
                    <div className={`token-usage-rate-bar token-usage-rate-bar--${limitSeverity}`}>
                      <div
                        className="token-usage-rate-bar-fill"
                        style={{ width: `${limit.usedPercent}%` }}
                      />
                    </div>
                  )}
                  {resetLabel && (
                    <div className="token-usage-rate-reset">重置于 {resetLabel}</div>
                  )}
                </div>
              );
            })}
            {credits && (
              <div className="token-usage-row token-usage-credits-row">
                <span className="token-usage-row-label">Credits</span>
                <span className="token-usage-row-value">{creditsValue(credits)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <span
      className={`token-usage-compact token-usage-compact--${severity}`}
      role="img"
      aria-label={compactTitle}
      title={compactTitle}
    >
      <svg
        className="token-usage-ring"
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        aria-hidden="true"
      >
        <circle
          className="token-usage-ring-track"
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
        />
        <circle
          className={`token-usage-ring-fill token-usage-ring-fill--${severity}`}
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      </svg>
      <span className="token-usage-compact-label">{compactLabel}</span>
    </span>
  );
};

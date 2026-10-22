import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  History,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Target,
  Trash2,
  Zap,
} from "lucide-react";
import { tauriInvoke } from "../bridge";
import {
  getSchedulerStatus,
  isSchedulerUnavailableError,
  refreshSchedule,
  runAutomationNow,
  subscribeAutomationEvents,
  type AutomationRunFinishedEvent,
  type AutomationRunStartedEvent,
  type SchedulerEntry,
  type SchedulerStatus,
} from "../automationsClient";
import { AutomationItem, ModelInfo } from "../types";

interface AutomationsViewProps {
  activeWorkspaceRoot: string;
  models: ModelInfo[];
  onRunAutomationNow: (item: AutomationItem) => void;
}

const PRESET_TEMPLATES = [
  {
    title: "每日代码质量与测试巡检",
    kind: "cron" as const,
    rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
    prompt:
      "扫描当前工作区最近 24 小时的 Git 提交，运行构建与单元测试，总结潜在缺陷或未覆盖的边界条件。",
  },
  {
    title: "每周一依赖与安全漏洞审查",
    kind: "cron" as const,
    rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=10;BYMINUTE=0",
    prompt:
      "检查项目依赖配置（package.json / Cargo.toml 等），列出过期或有风险的依赖项并生成安全升级计划。",
  },
  {
    title: "长期自治目标 (/goal 持续推进)",
    kind: "goal" as const,
    rrule: "FREQ=HOURLY;INTERVAL=1",
    prompt:
      "持续推进当前项目的里程碑开发计划：检查剩余未完成模块、编写实现代码、执行编译与自动化测试，直到所有验收指标全部通过。",
  },
];

const SCHEDULE_PRESETS = [
  { label: "每天 09:00", rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0" },
  { label: "工作日 09:30", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=30" },
  { label: "每周一 10:00", rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=10;BYMINUTE=0" },
  { label: "每小时巡检", rrule: "FREQ=HOURLY;INTERVAL=1" },
];

const MAX_RUN_HISTORY = 20;

type SchedulerUiState = "loading" | "ready" | "unavailable" | "error";
type RunRecordStatus = "running" | "completed" | "failed";
type NoticeKind = "success" | "error" | "info";

interface RunHistoryRecord {
  key: string;
  automationId: string;
  name: string;
  status: RunRecordStatus;
  startedAt: number;
  finishedAt?: number;
  threadId?: string;
  error?: string;
}

interface Notice {
  kind: NoticeKind;
  text: string;
}

function formatDateTime(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return date.toLocaleString("zh-CN", {
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

function formatClock(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return date.toLocaleTimeString("zh-CN", { hour12: false });
  } catch {
    return date.toISOString();
  }
}

/** "3 小时后" / "2 分钟前" style relative label. */
function formatRelativeTime(target: number, now: number): string {
  const diff = target - now;
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  const suffix = diff >= 0 ? "后" : "前";
  if (abs < minute) return "即将";
  if (abs < hour) return `${Math.round(abs / minute)} 分钟${suffix}`;
  if (abs < day) return `${Math.round(abs / hour)} 小时${suffix}`;
  return `${Math.round(abs / day)} 天${suffix}`;
}

function shortId(id?: string | null, length = 8): string {
  if (!id) return "";
  return id.length > length ? `${id.slice(0, length)}…` : id;
}

function truncateText(text: string, max = 60): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function runStatusLabel(status?: string | null): string {
  const value = (status || "").toLowerCase();
  if (value === "running") return "运行中";
  if (value === "completed" || value === "success" || value === "succeeded") return "成功";
  if (value === "failed" || value === "error") return "失败";
  return "未运行";
}

function runStatusColor(status?: string | null): string {
  const value = (status || "").toLowerCase();
  if (value === "running") return "var(--accent-blue)";
  if (value === "completed" || value === "success" || value === "succeeded") {
    return "var(--accent-green)";
  }
  if (value === "failed" || value === "error") return "var(--accent-red)";
  return "var(--text-tertiary)";
}

function runStatusBackground(status?: string | null): string {
  const value = (status || "").toLowerCase();
  if (value === "running") return "rgba(58, 131, 247, 0.15)";
  if (value === "completed" || value === "success" || value === "succeeded") {
    return "rgba(16, 163, 127, 0.15)";
  }
  if (value === "failed" || value === "error") return "rgba(239, 68, 68, 0.15)";
  return "rgba(255, 255, 255, 0.08)";
}

function noticeColor(kind: NoticeKind): string {
  if (kind === "success") return "var(--accent-green)";
  if (kind === "error") return "var(--accent-red)";
  return "var(--accent-blue)";
}

function appendRunRecord(
  records: RunHistoryRecord[],
  record: RunHistoryRecord
): RunHistoryRecord[] {
  return [record, ...records].slice(0, MAX_RUN_HISTORY);
}

function applyStartedEvent(
  records: RunHistoryRecord[],
  event: AutomationRunStartedEvent
): RunHistoryRecord[] {
  const runningIndex = records.findIndex(
    (record) => record.automationId === event.id && record.status === "running"
  );
  if (runningIndex >= 0) {
    const next = [...records];
    next[runningIndex] = {
      ...next[runningIndex],
      name: event.name || next[runningIndex].name,
      startedAt: event.at || next[runningIndex].startedAt,
    };
    return next;
  }
  return appendRunRecord(records, {
    key: `started:${event.id}:${event.at}`,
    automationId: event.id,
    name: event.name,
    status: "running",
    startedAt: event.at,
  });
}

function applyFinishedEvent(
  records: RunHistoryRecord[],
  event: AutomationRunFinishedEvent
): RunHistoryRecord[] {
  const runningIndex = records.findIndex(
    (record) => record.automationId === event.id && record.status === "running"
  );
  if (runningIndex >= 0) {
    const next = [...records];
    next[runningIndex] = {
      ...next[runningIndex],
      name: event.name || next[runningIndex].name,
      status: event.status,
      finishedAt: event.finishedAt,
      threadId: event.threadId ?? next[runningIndex].threadId,
      error: event.error ?? next[runningIndex].error,
    };
    return next;
  }
  return appendRunRecord(records, {
    key: `finished:${event.id}:${event.finishedAt}`,
    automationId: event.id,
    name: event.name,
    status: event.status,
    startedAt: event.finishedAt,
    finishedAt: event.finishedAt,
    threadId: event.threadId ?? undefined,
    error: event.error ?? undefined,
  });
}

export const AutomationsView: React.FC<AutomationsViewProps> = ({
  activeWorkspaceRoot,
  models,
  onRunAutomationNow,
}) => {
  const [automations, setAutomations] = useState<AutomationItem[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<"all" | "scheduled" | "goals">(
    "all"
  );
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "ACTIVE" | "PAUSED" | "COMPLETED"
  >("ALL");
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);

  const [name, setName] = useState<string>("");
  const [kind, setKind] = useState<"cron" | "heartbeat" | "goal">("cron");
  const [rrule, setRrule] = useState<string>("FREQ=DAILY;BYHOUR=9;BYMINUTE=0");
  const [prompt, setPrompt] = useState<string>("");
  const [execEnv, setExecEnv] = useState<"worktree" | "local">("worktree");
  const [selectedModel, setSelectedModel] = useState<string>("");

  // ── Scheduler state (Rust automation scheduler) ──
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [schedulerState, setSchedulerState] = useState<SchedulerUiState>("loading");
  const [schedulerError, setSchedulerError] = useState<string>("");
  const [schedulerBusy, setSchedulerBusy] = useState<boolean>(false);
  const [runBusyId, setRunBusyId] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<RunHistoryRecord[]>([]);
  const [runThreads, setRunThreads] = useState<Record<string, string>>({});
  const [clock, setClock] = useState<number>(Date.now());
  const [notice, setNotice] = useState<Notice | null>(null);
  const recordSeqRef = useRef<number>(0);

  const makeRecordKey = useCallback((prefix: string, id: string): string => {
    recordSeqRef.current += 1;
    return `${prefix}:${id}:${Date.now()}:${recordSeqRef.current}`;
  }, []);

  const refresh = async () => {
    try {
      const list = await tauriInvoke<AutomationItem[]>("automations_list");
      setAutomations(list);
    } catch {
      // automations_list already existed before the scheduler task; keep silent.
    }
  };

  const loadScheduler = useCallback(async (options?: { silent?: boolean }) => {
    try {
      const status = await getSchedulerStatus();
      setScheduler(status);
      setSchedulerState("ready");
      setSchedulerError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setScheduler(null);
      if (isSchedulerUnavailableError(error)) {
        setSchedulerState("unavailable");
        setSchedulerError("");
      } else {
        setSchedulerState("error");
        setSchedulerError(message);
      }
      if (!options?.silent) {
        setNotice({ kind: "info", text: `无法获取调度器状态：${message}` });
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    void loadScheduler({ silent: true });
  }, [loadScheduler]);

  // Recompute the scheduler plan after an automation is created/updated/deleted.
  // Degrades silently when the scheduler backend is not available yet.
  const syncScheduleAfterConfigChange = useCallback(async () => {
    try {
      const status = await refreshSchedule();
      setScheduler(status);
      setSchedulerState("ready");
      setSchedulerError("");
    } catch (error) {
      if (isSchedulerUnavailableError(error)) {
        setSchedulerState("unavailable");
        setScheduler(null);
        setSchedulerError("");
      } else {
        const message = error instanceof Error ? error.message : String(error);
        setSchedulerState("error");
        setSchedulerError(message);
        void loadScheduler({ silent: true });
      }
    }
  }, [loadScheduler]);

  // Live "current time" for the scheduler status bar.
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Auto-dismiss transient notices.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Subscribe to realtime run events emitted by the Rust scheduler.
  useEffect(() => {
    const unsubscribe = subscribeAutomationEvents((event) => {
      if (event.kind === "started") {
        setRunHistory((prev) => applyStartedEvent(prev, event));
        void loadScheduler({ silent: true });
        return;
      }
      setRunHistory((prev) => applyFinishedEvent(prev, event));
      if (event.threadId) {
        const threadId = event.threadId;
        setRunThreads((prev) => ({ ...prev, [event.id]: threadId }));
      }
      setNotice(
        event.status === "failed"
          ? {
              kind: "error",
              text: `「${event.name}」运行失败${
                event.error ? `：${truncateText(event.error, 120)}` : ""
              }`,
            }
          : {
              kind: "success",
              text: `「${event.name}」运行完成${
                event.threadId ? `（线程 ${shortId(event.threadId)}）` : ""
              }`,
            }
      );
      void loadScheduler({ silent: true });
    });
    return unsubscribe;
  }, [loadScheduler]);

  // Reconcile locally-created "running" history records if the backend does not
  // emit a finished event (uses the refreshed scheduler entry timestamps).
  useEffect(() => {
    if (!scheduler) return;
    setRunHistory((prev) => {
      let changed = false;
      const next = prev.map((record) => {
        if (record.status !== "running") return record;
        const entry = scheduler.entries.find((candidate) => candidate.id === record.automationId);
        if (!entry) return record;
        const status = (entry.lastStatus || "").toLowerCase();
        const finishedAt = entry.lastRunAt;
        if (
          (status === "completed" || status === "failed") &&
          typeof finishedAt === "number" &&
          finishedAt >= record.startedAt - 1000
        ) {
          changed = true;
          return {
            ...record,
            status: status as RunRecordStatus,
            finishedAt,
            error: entry.lastError ?? record.error,
          };
        }
        return record;
      });
      return changed ? next : prev;
    });
  }, [scheduler]);

  const handleCreate = async () => {
    if (!name.trim() || !prompt.trim()) return;
    const item: AutomationItem = {
      id: "",
      kind,
      name: name.trim(),
      prompt: prompt.trim(),
      status: "ACTIVE",
      rrule: rrule.trim() || "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      cwds: [activeWorkspaceRoot],
      executionEnvironment: execEnv,
      model: selectedModel || null,
      reasoningEffort: "medium",
      targetThreadId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const updated = await tauriInvoke<AutomationItem[]>("automation_save", {
      item,
    });
    setAutomations(updated);
    setName("");
    setPrompt("");
    setShowCreateForm(false);
    void syncScheduleAfterConfigChange();
  };

  const handleToggleStatus = async (item: AutomationItem, targetStatus?: string) => {
    const nextStatus =
      targetStatus || (item.status === "PAUSED" ? "ACTIVE" : "PAUSED");
    const next: AutomationItem = {
      ...item,
      status: nextStatus,
    };
    const updated = await tauriInvoke<AutomationItem[]>("automation_save", {
      item: next,
    });
    setAutomations(updated);
    void syncScheduleAfterConfigChange();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除该计划任务 / 目标吗？")) return;
    const updated = await tauriInvoke<AutomationItem[]>("automation_delete", {
      id,
    });
    setAutomations(updated);
    void syncScheduleAfterConfigChange();
  };

  const handleRunNow = async (item: AutomationItem) => {
    if (runBusyId) return;

    // Scheduler missing / not supported: keep the previous local behavior.
    if (schedulerState === "unavailable") {
      onRunAutomationNow(item);
      setNotice({
        kind: "info",
        text: "调度器不可用（后端未就绪），已回退为本地立即运行。",
      });
      return;
    }
    if (schedulerState === "loading") {
      setNotice({ kind: "info", text: "调度器状态加载中，请稍候再试。" });
      return;
    }

    setRunBusyId(item.id);
    try {
      const result = await runAutomationNow(item.id);
      const threadId = result.threadId;
      if (threadId) {
        setRunThreads((prev) => ({ ...prev, [item.id]: threadId }));
      }
      setRunHistory((prev) =>
        appendRunRecord(prev, {
          key: makeRecordKey("scheduler-run", item.id),
          automationId: item.id,
          name: item.name,
          status: "running",
          startedAt: Date.now(),
          threadId: threadId || undefined,
        })
      );
      setNotice({
        kind: "success",
        text: `已触发「${item.name}」${
          threadId ? `（线程 ${shortId(threadId)}）` : ""
        }，调度器正在执行…`,
      });
      void loadScheduler({ silent: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isSchedulerUnavailableError(error)) {
        setSchedulerState("unavailable");
        setScheduler(null);
        onRunAutomationNow(item);
        setNotice({
          kind: "info",
          text: "调度器不可用（后端未就绪），已回退为本地立即运行。",
        });
      } else {
        setNotice({ kind: "error", text: `立即运行失败：${message}` });
      }
    } finally {
      setRunBusyId(null);
    }
  };

  const handleRefreshSchedule = async () => {
    if (schedulerBusy) return;
    setSchedulerBusy(true);
    try {
      const status = await refreshSchedule();
      setScheduler(status);
      setSchedulerState("ready");
      setSchedulerError("");
      setNotice({
        kind: "success",
        text: `调度已刷新：${status.entries.length} 个任务已注册到调度器${
          status.running ? "" : "（调度器当前未运行）"
        }。`,
      });
      void refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isSchedulerUnavailableError(error)) {
        setSchedulerState("unavailable");
        setScheduler(null);
        setSchedulerError("");
        setNotice({ kind: "error", text: "调度器不可用（后端未就绪）" });
      } else {
        setSchedulerState("error");
        setSchedulerError(message);
        setNotice({ kind: "error", text: `刷新调度失败：${message}` });
      }
    } finally {
      setSchedulerBusy(false);
    }
  };

  const filteredItems = useMemo(() => {
    return automations.filter((item) => {
      if (activeSubTab === "scheduled" && item.kind === "goal") return false;
      if (activeSubTab === "goals" && item.kind !== "goal") return false;
      if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
      return true;
    });
  }, [automations, activeSubTab, statusFilter]);

  const schedulerEntriesById = useMemo(() => {
    const map = new Map<string, SchedulerEntry>();
    for (const entry of scheduler?.entries ?? []) {
      map.set(entry.id, entry);
    }
    return map;
  }, [scheduler]);

  const configuredCount = scheduler?.entries?.length ?? automations.length;

  const nextScheduledEntry = useMemo<SchedulerEntry | null>(() => {
    const candidates = (scheduler?.entries ?? []).filter(
      (entry) => typeof entry.nextRunAt === "number" && (entry.nextRunAt as number) > clock
    );
    candidates.sort((a, b) => (a.nextRunAt as number) - (b.nextRunAt as number));
    return candidates[0] ?? null;
  }, [scheduler, clock]);

  const runningAutomationIds = useMemo(() => {
    const running = new Set<string>();
    for (const record of runHistory) {
      if (record.status === "running") running.add(record.automationId);
    }
    for (const entry of scheduler?.entries ?? []) {
      if ((entry.lastStatus || "").toLowerCase() === "running") running.add(entry.id);
    }
    return running;
  }, [runHistory, scheduler]);

  const schedulerDotColor =
    schedulerState === "ready"
      ? scheduler?.running
        ? "var(--accent-green)"
        : "var(--accent-amber)"
      : schedulerState === "error"
        ? "var(--accent-red)"
        : schedulerState === "unavailable"
          ? "var(--text-tertiary)"
          : "var(--accent-blue)";

  const schedulerStateText =
    schedulerState === "ready"
      ? scheduler?.running
        ? "运行中"
        : "未运行"
      : schedulerState === "unavailable"
        ? "不可用"
        : schedulerState === "error"
          ? "异常"
          : "连接中…";

  return (
    <div className="panel-page">
      <div className="panel-page-header">
        <div>
          <h2>计划任务与长期目标 (`~/.codex/automations`)</h2>
          <p className="subtitle">
            管理定时执行的后台自动化任务 (`automation.toml`) 与多轮持续推进的 `/goal` 长期目标。
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="primary-btn"
            onClick={() => setShowCreateForm((v) => !v)}
          >
            <Plus size={14} /> {showCreateForm ? "收起表单" : "新建任务 / 目标"}
          </button>
          <button type="button" className="secondary-btn" onClick={refresh}>
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
      </div>

      {/* Scheduler status bar */}
      <div className="card-section">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span
              aria-hidden="true"
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: schedulerDotColor,
                flex: "0 0 auto",
                boxShadow:
                  schedulerState === "ready" && scheduler?.running
                    ? "0 0 0 3px rgba(16, 163, 127, 0.16)"
                    : "none",
              }}
            />
            <strong style={{ fontSize: 13.5 }}>
              调度器{schedulerStateText}
            </strong>
            <span className="tag-badge">当前时间 {formatClock(clock)}</span>
            <span className="tag-badge">已配置 {configuredCount} 个任务</span>
            <span
              className="tag-badge"
              title={
                nextScheduledEntry
                  ? `${nextScheduledEntry.name} · ${formatDateTime(nextScheduledEntry.nextRunAt)}`
                  : "暂无可预计的下次运行"
              }
            >
              下次运行{" "}
              {nextScheduledEntry
                ? formatDateTime(nextScheduledEntry.nextRunAt)
                : "暂无"}
            </span>
          </div>
          <button
            type="button"
            className="secondary-btn"
            onClick={handleRefreshSchedule}
            disabled={schedulerBusy || schedulerState === "loading"}
            title="重新计算下一次调度计划"
          >
            <RefreshCw size={14} /> {schedulerBusy ? "刷新中…" : "刷新调度"}
          </button>
        </div>

        {schedulerState === "unavailable" && (
          <p
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              margin: 0,
              fontSize: 12,
              color: "var(--accent-amber)",
            }}
          >
            <AlertTriangle size={13} /> 调度器不可用（后端未就绪）。任务的新建 / 编辑 /
            启停 / 删除仍可正常使用；「立即运行」将回退为本地执行。
          </p>
        )}

        {schedulerState === "error" && (
          <p
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              margin: 0,
              fontSize: 12,
              color: "var(--accent-red)",
            }}
          >
            <AlertTriangle size={13} /> 调度器异常：{schedulerError || "未知错误"}
            （任务 CRUD 不受影响，可尝试「刷新调度」重试）
          </p>
        )}

        {nextScheduledEntry && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-tertiary)" }}>
            下次运行摘要：{nextScheduledEntry.name} 将于{" "}
            {formatDateTime(nextScheduledEntry.nextRunAt)}（
            {formatRelativeTime(nextScheduledEntry.nextRunAt as number, clock)}）触发，
            可执行任务共 {scheduler?.entries.length ?? 0} 项。
          </p>
        )}

        {notice && (
          <p style={{ margin: 0, fontSize: 12, color: noticeColor(notice.kind) }}>
            {notice.text}
          </p>
        )}
      </div>

      {/* Sub-Tabs & Status Filter Bar */}
      <div className="hub-filter-bar">
        <div className="sub-tabs">
          <button
            type="button"
            className={`sub-tab ${activeSubTab === "all" ? "active" : ""}`}
            onClick={() => setActiveSubTab("all")}
          >
            <Clock size={14} />
            <span>全部 ({automations.length})</span>
          </button>
          <button
            type="button"
            className={`sub-tab ${activeSubTab === "scheduled" ? "active" : ""}`}
            onClick={() => setActiveSubTab("scheduled")}
          >
            <Clock size={14} />
            <span>
              计划任务 ({automations.filter((a) => a.kind !== "goal").length})
            </span>
          </button>
          <button
            type="button"
            className={`sub-tab ${activeSubTab === "goals" ? "active" : ""}`}
            onClick={() => setActiveSubTab("goals")}
          >
            <Target size={14} />
            <span>
              长期目标 /goal ({automations.filter((a) => a.kind === "goal").length})
            </span>
          </button>
        </div>

        <div className="status-pill-group">
          {(["ALL", "ACTIVE", "PAUSED", "COMPLETED"] as const).map((st) => (
            <button
              key={st}
              type="button"
              className={`seg-btn ${statusFilter === st ? "active" : ""}`}
              onClick={() => setStatusFilter(st)}
            >
              {st === "ALL"
                ? "全部状态"
                : st === "ACTIVE"
                  ? "已开启"
                  : st === "PAUSED"
                    ? "已暂停"
                    : "已完成"}
            </button>
          ))}
        </div>
      </div>

      {/* Quick Preset Templates */}
      <div className="card-section">
        <h3>推荐预设模板（点击一键填入）</h3>
        <div className="preset-cards-grid">
          {PRESET_TEMPLATES.map((tpl, i) => (
            <div
              key={i}
              className="preset-template-card"
              onClick={() => {
                setName(tpl.title);
                setKind(tpl.kind);
                setRrule(tpl.rrule);
                setPrompt(tpl.prompt);
                setShowCreateForm(true);
              }}
            >
              <div className="preset-template-title">
                {tpl.kind === "goal" ? <Target size={14} /> : <Clock size={14} />}
                <span>{tpl.title}</span>
              </div>
              <p className="preset-template-desc">{tpl.prompt}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Create Automation / Goal Form */}
      {showCreateForm && (
        <div className="card-section">
          <h3>创建计划任务或长期目标</h3>
          <div className="form-grid-row">
            <div className="form-field">
              <label>任务 / 目标名称</label>
              <input
                type="text"
                placeholder="例如：每日代码质量巡检 或 完成全量重构"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label>类型</label>
              <select
                value={kind}
                onChange={(e) =>
                  setKind(e.target.value as "cron" | "heartbeat" | "goal")
                }
              >
                <option value="cron">Cron 定时计划任务</option>
                <option value="heartbeat">Heartbeat 会话巡检</option>
                <option value="goal">Goal 长期自治目标 (/goal)</option>
              </select>
            </div>
            <div className="form-field">
              <label>周期预设</label>
              <select
                value={
                  SCHEDULE_PRESETS.some((p) => p.rrule === rrule) ? rrule : "custom"
                }
                onChange={(e) => {
                  if (e.target.value !== "custom") {
                    setRrule(e.target.value);
                  }
                }}
              >
                {SCHEDULE_PRESETS.map((p) => (
                  <option key={p.rrule} value={p.rrule}>
                    {p.label}
                  </option>
                ))}
                <option value="custom">自定义 RRULE</option>
              </select>
            </div>
            <div className="form-field">
              <label>RRULE 规则字符串</label>
              <input
                type="text"
                value={rrule}
                onChange={(e) => setRrule(e.target.value)}
                placeholder="FREQ=DAILY;BYHOUR=9;BYMINUTE=0"
              />
            </div>
            <div className="form-field">
              <label>执行环境</label>
              <select
                value={execEnv}
                onChange={(e) =>
                  setExecEnv(e.target.value as "worktree" | "local")
                }
              >
                <option value="worktree">隔离 Worktree（安全推荐）</option>
                <option value="local">当前本地工作目录</option>
              </select>
            </div>
            <div className="form-field">
              <label>指定模型 (可选)</label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                <option value="">跟随全局默认模型</option>
                {models.map((m) => (
                  <option key={m.id || m.model} value={m.model || m.id}>
                    {m.displayName || m.model || m.id}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-field" style={{ marginTop: 10 }}>
            <label>Prompt 指令与验收标准</label>
            <textarea
              rows={3}
              placeholder="输入触发时发送给 Codex Agent 的完整指令或长期目标验收条件..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button
              type="button"
              className="primary-btn"
              onClick={handleCreate}
              disabled={!name.trim() || !prompt.trim()}
            >
              <Plus size={14} /> 保存到 automation.toml
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setShowCreateForm(false)}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Automations & Goals List */}
      <div className="card-section">
        <h3>任务列表 ({filteredItems.length})</h3>
        {filteredItems.length === 0 ? (
          <div className="empty-hint">
            当前筛选条件下暂无计划任务，可点击上方预设卡片或「新建任务 / 目标」快速创建。
          </div>
        ) : (
          <div className="item-cards-list">
            {filteredItems.map((item) => {
              const entry = schedulerEntriesById.get(item.id);
              const itemRunning = runningAutomationIds.has(item.id);
              const itemThreadId = runThreads[item.id];
              const showSchedulerMeta =
                schedulerState === "ready" || Boolean(entry) || Boolean(itemThreadId);
              return (
                <div key={item.id} className="item-card">
                  <div className="item-card-main">
                    <div className="item-card-title-row">
                      {item.kind === "goal" ? (
                        <Target size={15} className="accent-icon" />
                      ) : (
                        <Clock size={15} className="accent-icon" />
                      )}
                      <strong>{item.name}</strong>
                      <span
                        className={`tag-badge ${
                          item.status === "ACTIVE" ? "accent" : ""
                        }`}
                      >
                        {item.status}
                      </span>
                      <span className="tag-badge">
                        {item.kind === "goal" ? "长期目标 /goal" : item.kind}
                      </span>
                      <span className="tag-badge">{item.executionEnvironment}</span>
                      {itemRunning && (
                        <span
                          className="tag-badge"
                          style={{
                            color: "var(--accent-blue)",
                            background: "rgba(58, 131, 247, 0.15)",
                          }}
                        >
                          运行中…
                        </span>
                      )}
                    </div>
                    <p className="item-card-desc">{item.prompt}</p>
                    <div className="item-card-meta">
                      <span>周期: {item.rrule}</span>
                      {item.cwds.length > 0 && <span>项目: {item.cwds[0]}</span>}
                      {item.model && <span>模型: {item.model}</span>}
                    </div>
                    {showSchedulerMeta && (
                      <div
                        className="item-card-meta"
                        style={{ flexWrap: "wrap", rowGap: 4 }}
                      >
                        <span
                          title={
                            entry?.nextRunAt
                              ? formatDateTime(entry.nextRunAt)
                              : "调度器尚未给出下次运行时间"
                          }
                        >
                          下次运行:{" "}
                          {entry?.nextRunAt
                            ? `${formatDateTime(entry.nextRunAt)}（${formatRelativeTime(
                                entry.nextRunAt,
                                clock
                              )}）`
                            : "—"}
                        </span>
                        <span
                          style={{ color: runStatusColor(entry?.lastStatus) }}
                          title={entry?.lastError || undefined}
                        >
                          上次运行:{" "}
                          {entry?.lastRunAt
                            ? `${formatDateTime(entry.lastRunAt)} · ${runStatusLabel(
                                entry.lastStatus
                              )}`
                            : runStatusLabel(entry?.lastStatus)}
                        </span>
                        <span>运行次数: {entry?.runCount ?? 0}</span>
                        {itemThreadId && (
                          <span title={itemThreadId}>线程: {shortId(itemThreadId)}</span>
                        )}
                        {entry?.lastError && (
                          <span
                            style={{ color: "var(--accent-red)" }}
                            title={entry.lastError}
                          >
                            错误: {truncateText(entry.lastError, 60)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="item-card-actions">
                    <button
                      type="button"
                      className="primary-btn-sm"
                      onClick={() => handleRunNow(item)}
                      disabled={runBusyId !== null}
                      title={
                        schedulerState === "unavailable"
                          ? "调度器不可用（后端未就绪），将回退为本地立即运行"
                          : "通过调度器立即执行一次"
                      }
                    >
                      <Zap size={13} />{" "}
                      {runBusyId === item.id ? "触发中…" : "立即运行"}
                    </button>
                    <button
                      type="button"
                      className="secondary-btn-sm"
                      onClick={() => handleToggleStatus(item)}
                    >
                      {item.status === "PAUSED" ? (
                        <>
                          <Play size={12} /> 启用
                        </>
                      ) : (
                        <>
                          <Pause size={12} /> 暂停
                        </>
                      )}
                    </button>
                    {item.status !== "COMPLETED" && (
                      <button
                        type="button"
                        className="secondary-btn-sm"
                        onClick={() => handleToggleStatus(item, "COMPLETED")}
                        title="标记为已完成"
                      >
                        <CheckCircle2 size={12} /> 完成
                      </button>
                    )}
                    <button
                      type="button"
                      className="danger-btn-sm"
                      onClick={() => handleDelete(item.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Scheduler run history (latest 20, clearable) */}
      <div className="card-section">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <h3 style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <History size={14} /> 运行历史（最近 {runHistory.length} /{" "}
            {MAX_RUN_HISTORY} 条）
          </h3>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              setRunHistory([]);
              setNotice({ kind: "info", text: "运行历史已清空。" });
            }}
            disabled={runHistory.length === 0}
          >
            <Trash2 size={13} /> 清空
          </button>
        </div>
        {runHistory.length === 0 ? (
          <div className="empty-hint">
            尚未收到调度器运行事件。开启调度器或点击「立即运行」后，运行记录会实时出现在这里。
          </div>
        ) : (
          <div className="item-cards-list">
            {runHistory.map((record) => (
              <div key={record.key} className="item-card">
                <div className="item-card-main" style={{ flex: 1 }}>
                  <div className="item-card-title-row">
                    <strong>{record.name}</strong>
                    <span
                      className="tag-badge"
                      style={{
                        color: runStatusColor(record.status),
                        background: runStatusBackground(record.status),
                      }}
                    >
                      {runStatusLabel(record.status)}
                    </span>
                    {record.threadId && (
                      <span className="tag-badge" title={record.threadId}>
                        线程 {shortId(record.threadId)}
                      </span>
                    )}
                  </div>
                  {record.error && (
                    <p
                      className="item-card-desc"
                      style={{ color: "var(--accent-red)", margin: 0 }}
                      title={record.error}
                    >
                      {truncateText(record.error, 160)}
                    </p>
                  )}
                </div>
                <div className="item-card-actions">
                  <span
                    style={{
                      fontSize: 11.5,
                      color: "var(--text-tertiary)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {record.status === "running"
                      ? `开始于 ${formatDateTime(record.startedAt)}`
                      : `完成于 ${formatDateTime(
                          record.finishedAt ?? record.startedAt
                        )}`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

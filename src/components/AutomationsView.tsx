import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Edit2,
  Check,
  ListFilter,
  X,
  CheckCircle2,
  Clock,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { tauriInvoke } from "../bridge";
import { ThreadActionsMenu } from "./ThreadActionsMenu";
import "./AutomationsView.css";
import {
  getSchedulerStatus,
  isSchedulerUnavailableError,
  markActivityRunRead,
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
  onSelectThread?: (threadId: string) => void;
  onSelectHistoryThread?: (threadId: string) => void;
  onRunRead?: () => void;
  threadTask?: { id: string; threadId: string; onClose: () => void };
  onNavigationGuardChange?: (guard: ((action: () => void) => boolean) | null) => void;
}

const SCHEDULE_PRESETS = [
  { label: "每天 09:00", rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0" },
  { label: "工作日 09:30", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=30" },
  { label: "每周一 10:00", rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=10;BYMINUTE=0" },
  { label: "每小时", rrule: "FREQ=HOURLY;INTERVAL=1" },
];

const SCHEDULE_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const SCHEDULE_TIME = new Intl.DateTimeFormat("zh-CN", { hour: "numeric", minute: "2-digit" });
const ONCE_DATE = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" });
const ONCE_TIME = new Intl.DateTimeFormat("zh-CN", { timeStyle: "short" });
const SCHEDULE_FALLBACK = "自定义安排";

function intervalScheduleLabel(minutes: number): string {
  const format = (count: number) => count.toLocaleString("zh-CN");
  if (minutes === 1) return "每分钟";
  if (minutes === 60) return "每小时";
  if (minutes === 1440) return "每天";
  if (minutes === 10080) return "每周";
  if (minutes % 10080 === 0) return `每 ${format(minutes / 10080)} 周`;
  if (minutes % 1440 === 0) return `每${format(minutes / 1440)} 天`;
  if (minutes % 60 === 0) return `每 ${format(minutes / 60)} 小时`;
  return `每 ${format(minutes)} 分钟`;
}

function scheduleLabel(item: AutomationItem, nextRunAt?: number | null): string {
  if (item.kind.toLowerCase() === "cron" && item.executionEnvironment.toLowerCase() === "local") {
    const once = /^DTSTART:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\r?\nRRULE:(?:FREQ=DAILY;COUNT=1|COUNT=1;FREQ=DAILY)$/i.exec(item.rrule.trim());
    if (once) {
      const [, year, month, day, hour, minute, second] = once;
      const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
      const anchor = new Date(iso);
      if (Number.isFinite(anchor.getTime()) && anchor.getTime() >= 0 && anchor.toISOString() === iso) {
        const next = new Date(nextRunAt ?? NaN);
        const date = Number.isFinite(next.getTime()) ? next : anchor;
        return `${ONCE_DATE.format(date)} · ${ONCE_TIME.format(date)}`;
      }
    }
  }
  const fields = new Map<string, string>();
  for (const part of item.rrule.trim().toUpperCase().replace(/^RRULE:/, "").split(";")) {
    if (!part.trim()) continue;
    const [key, value, extra] = part.split("=").map(text => text.trim());
    if (!value || extra !== undefined || fields.has(key) ||
        !["FREQ", "INTERVAL", "BYDAY", "BYHOUR", "BYMINUTE", "WKST"].includes(key)) return SCHEDULE_FALLBACK;
    fields.set(key, value);
  }
  const intervalText = fields.get("INTERVAL") ?? "1";
  const interval = Number(intervalText);
  const weekStart = fields.get("WKST");
  if (!/^\+?\d+$/.test(intervalText) || interval < 1 || interval > 0xffffffff ||
      (weekStart && !SCHEDULE_DAYS.includes(weekStart))) return SCHEDULE_FALLBACK;

  const days = fields.get("BYDAY")?.split(",").map(day => day.trim()).filter(Boolean) ?? [];
  if (days.some(day => !SCHEDULE_DAYS.includes(day))) return SCHEDULE_FALLBACK;
  const weekdays = SCHEDULE_DAYS.filter(day => days.includes(day));
  const everyDay = weekdays.length === 0 || weekdays.length === 7;
  const hour = fields.get("BYHOUR");
  const minute = fields.get("BYMINUTE");
  if ((hour !== undefined && (!/^\+?\d+$/.test(hour) || Number(hour) > 23)) ||
      (minute !== undefined && (!/^\+?\d+$/.test(minute) || Number(minute) > 59))) return SCHEDULE_FALLBACK;

  const freq = fields.get("FREQ");
  if (freq === "MINUTELY") {
    return item.kind.toLowerCase() === "heartbeat" && item.targetThreadId?.trim() &&
      item.executionEnvironment.toLowerCase() === "local" &&
      [...fields.keys()].every(key => key === "FREQ" || key === "INTERVAL")
      ? intervalScheduleLabel(interval) : SCHEDULE_FALLBACK;
  }
  if (freq === "HOURLY") {
    // The local hourly scheduler has no weekday filter.
    if (!everyDay || hour !== undefined) return SCHEDULE_FALLBACK;
    return intervalScheduleLabel(interval * 60);
  }
  if (interval !== 1 || hour === undefined || minute === undefined ||
      (freq !== "DAILY" && (freq !== "WEEKLY" || !weekdays.length))) return SCHEDULE_FALLBACK;

  const time = SCHEDULE_TIME.format(new Date(2024, 0, 1, Number(hour), Number(minute)));
  if (everyDay) return `每天 ${time}`;
  const indices = weekdays.map(day => SCHEDULE_DAYS.indexOf(day));
  if (indices.join() === "1,2,3,4,5") return `工作日 ${time}`;
  if (indices.join() === "0,6") return `周末 ${time}`;
  const names = indices.map(index => `星期${"日一二三四五六"[index]}`);
  const dayLabel = indices.length > 2
    ? indices.every((index, i) => index === indices[0] + i)
      ? `${names[0].slice(-1)}-${names.at(-1)?.slice(-1)}`
      : new Intl.ListFormat("zh-CN").format(names.map(name => name.slice(-1)))
    : new Intl.ListFormat("zh-CN").format(names);
  return `${dayLabel}（时间：${time}）`;
}

const MAX_RUN_HISTORY = 20;

type SchedulerUiState = "loading" | "ready" | "unavailable" | "error";
type RunRecordStatus = "running" | "completed" | "failed" | "interrupted" | "unknown";
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

type RunDisplayRecord = {
  startedAt: number;
  finishedAt?: number | null;
  status: string | null;
  threadId?: string | null;
  error?: string | null;
};

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
  if (value === "interrupted") return "已中断";
  if (value === "unknown") return "结果未知";
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
  if (records.some(record => record.automationId === event.id && record.startedAt === event.at)) {
    return records;
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
    (record) => record.automationId === event.id &&
      (event.startedAt != null ? record.startedAt === event.startedAt : record.status === "running")
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
    startedAt: event.startedAt ?? event.finishedAt,
    finishedAt: event.finishedAt,
    threadId: event.threadId ?? undefined,
    error: event.error ?? undefined,
  });
}

export const AutomationsView: React.FC<AutomationsViewProps> = ({
  activeWorkspaceRoot,
  models,
  onSelectThread,
  onSelectHistoryThread,
  onRunRead,
  threadTask,
  onNavigationGuardChange,
}) => {
  const [automations, setAutomations] = useState<AutomationItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "PAUSED" | "COMPLETED">("ACTIVE");
  const [sortOrder, setSortOrder] = useState<"automatic" | "next_run_asc" | "updated_at_desc" | "title_asc">("automatic");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(threadTask?.id ?? null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [clock, setClock] = useState(Date.now());
  const rowTriggerRef = useRef<HTMLButtonElement | null>(null);
  const detailCloseRef = useRef<HTMLButtonElement | null>(null);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  const filterFocusLastRef = useRef(false);
  const configurationBaselineRef = useRef(JSON.stringify(["", "cron", SCHEDULE_PRESETS[0].rrule, "", "worktree", ""]));
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<AutomationItem | null>(null);

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
  const [notice, setNotice] = useState<Notice | null>(null);
  const writePendingRef = useRef(false);
  const runPendingRef = useRef(false);
  const listRequestRef = useRef(0);
  const [writeBusy, setWriteBusy] = useState(false);

  const refresh = async () => {
    const request = ++listRequestRef.current;
    setListLoading(true);
    setListError("");
    try {
      const list = await tauriInvoke<AutomationItem[]>("automations_list");
      if (request === listRequestRef.current) setAutomations(list);
    } catch (error) {
      if (request === listRequestRef.current) {
        setListError(`读取任务失败：${String(error)}`);
      }
    } finally {
      if (request === listRequestRef.current) setListLoading(false);
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
    return () => { ++listRequestRef.current; };
  }, []);

  useEffect(() => {
    void loadScheduler({ silent: true });
  }, [loadScheduler]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!filterOpen) return;
    const controls = filterMenuRef.current?.querySelectorAll<HTMLButtonElement>("button");
    controls?.[filterFocusLastRef.current ? controls.length - 1 : 0]?.focus();
  }, [filterOpen]);

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
          : event.status === "completed" ? {
              kind: "success",
              text: `「${event.name}」运行完成${
                event.threadId ? `（线程 ${shortId(event.threadId)}）` : ""
              }`,
            } : {
              kind: "info",
              text: `「${event.name}」${event.status === "interrupted" ? "已中断" : "执行结果未知"}${event.error ? `：${event.error}` : ""}`,
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
        const finishedAt = entry.lastFinishedAt;
        if (
          ["completed", "failed", "interrupted", "unknown"].includes(status) &&
          typeof finishedAt === "number" &&
          entry.lastRunAt === record.startedAt
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

  const handleStartEdit = (item: AutomationItem) => {
    if (writePendingRef.current) return;
    configurationBaselineRef.current = JSON.stringify([
      item.name, ["cron", "heartbeat", "goal"].includes(item.kind) ? item.kind : "cron", item.rrule,
      item.prompt, item.executionEnvironment === "local" ? "local" : "worktree", item.model || "",
    ]);
    setEditingItem(item);
    setName(item.name);
    setKind(
      item.kind === "cron" || item.kind === "heartbeat" || item.kind === "goal"
        ? item.kind
        : "cron"
    );
    setRrule(item.rrule);
    setPrompt(item.prompt);
    setExecEnv(item.executionEnvironment === "local" ? "local" : "worktree");
    setSelectedModel(item.model || "");
    setShowCreateForm(true);
  };

  const handleCreate = async () => {
    if (writePendingRef.current || !name.trim() || !prompt.trim()) return;
    const item: AutomationItem = {
      id: editingItem ? editingItem.id : "",
      kind,
      name: name.trim(),
      prompt: prompt.trim(),
      status: editingItem ? editingItem.status : "ACTIVE",
      rrule: rrule.includes("\n") && editingItem?.rrule === rrule ? rrule : rrule.trim() || "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      cwds: editingItem ? editingItem.cwds : [activeWorkspaceRoot],
      executionEnvironment: execEnv,
      model: selectedModel || null,
      reasoningEffort: editingItem ? editingItem.reasoningEffort : "medium",
      targetThreadId: editingItem ? editingItem.targetThreadId : null,
      createdAt: editingItem ? editingItem.createdAt : Date.now(),
      updatedAt: Date.now(),
    };
    writePendingRef.current = true;
    setWriteBusy(true);
    ++listRequestRef.current;
    try {
      const updated = await tauriInvoke<AutomationItem[]>("automation_save", { item });
      ++listRequestRef.current;
      setAutomations(updated);
      setListLoading(false);
      setListError("");
      setName("");
      setPrompt("");
      setEditingItem(null);
      setShowCreateForm(false);
      void syncScheduleAfterConfigChange();
    } catch (error) {
      setNotice({ kind: "error", text: `保存任务失败：${String(error)}` });
    } finally {
      writePendingRef.current = false;
      setWriteBusy(false);
      setListLoading(false);
    }
  };

  const handleToggleStatus = async (item: AutomationItem, targetStatus?: string) => {
    if (writePendingRef.current) return;
    const nextStatus =
      targetStatus || (item.status === "PAUSED" ? "ACTIVE" : "PAUSED");
    const next: AutomationItem = {
      ...item,
      status: nextStatus,
    };
    writePendingRef.current = true;
    setWriteBusy(true);
    ++listRequestRef.current;
    try {
      const updated = await tauriInvoke<AutomationItem[]>("automation_save", { item: next });
      ++listRequestRef.current;
      setAutomations(updated);
      setListLoading(false);
      setListError("");
      void syncScheduleAfterConfigChange();
    } catch (error) {
      setNotice({ kind: "error", text: `更新任务状态失败：${String(error)}` });
    } finally {
      writePendingRef.current = false;
      setWriteBusy(false);
      setListLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (writePendingRef.current) return;
    if (!confirm("确定要删除该计划任务 / 目标吗？")) return;
    writePendingRef.current = true;
    setWriteBusy(true);
    ++listRequestRef.current;
    try {
      const updated = await tauriInvoke<AutomationItem[]>("automation_delete", { id });
      ++listRequestRef.current;
      setAutomations(updated);
      setListLoading(false);
      setListError("");
      void syncScheduleAfterConfigChange();
    } catch (error) {
      setNotice({ kind: "error", text: `删除任务失败：${String(error)}` });
    } finally {
      writePendingRef.current = false;
      setWriteBusy(false);
      setListLoading(false);
    }
  };

  const handleRunNow = async (item: AutomationItem) => {
    if (runPendingRef.current) return;

    if (schedulerState === "unavailable") {
      setNotice({
        kind: "error",
        text: "调度器不可用，任务尚未运行。请恢复调度器后重试。",
      });
      return;
    }
    if (schedulerState === "loading") {
      setNotice({ kind: "info", text: "调度器状态加载中，请稍候再试。" });
      return;
    }

    runPendingRef.current = true;
    setRunBusyId(item.id);
    try {
      const result = await runAutomationNow(item.id);
      const threadId = result.threadId;
      if (threadId) {
        setRunThreads((prev) => ({ ...prev, [item.id]: threadId }));
      }
      setRunHistory((prev) => applyStartedEvent(prev, {
        kind: "started", id: item.id, name: item.name, at: result.startedAt ?? Date.now(),
      }));
      setNotice({
        kind: "info",
        text: `已触发「${item.name}」${
          threadId ? `（线程 ${shortId(threadId)}）` : ""
        }，请在运行记录或会话中查看结果。`,
      });
      void loadScheduler({ silent: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isSchedulerUnavailableError(error)) {
        setSchedulerState("unavailable");
        setScheduler(null);
        setNotice({
          kind: "error",
          text: "调度器不可用，任务尚未运行。请恢复调度器后重试。",
        });
      } else {
        setNotice({ kind: "error", text: `立即运行失败：${message}` });
      }
    } finally {
      runPendingRef.current = false;
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

  const schedulerEntriesById = useMemo(() => {
    const map = new Map<string, SchedulerEntry>();
    for (const entry of scheduler?.entries ?? []) map.set(entry.id, entry);
    return map;
  }, [scheduler]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase();
    const items = automations.filter(item => {
      if (item.status === "DELETED") return false;
      const status = item.status === "PAUSED" ? "PAUSED" : "ACTIVE";
      if (statusFilter !== "ALL" && statusFilter !== status) return false;
      return !q || [item.name, item.prompt, ...item.cwds, scheduleLabel(item, schedulerEntriesById.get(item.id)?.nextRunAt)]
        .some(value => value.toLocaleLowerCase().includes(q));
    });
    if (sortOrder === "title_asc") items.sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true, sensitivity: "base" }));
    if (sortOrder === "updated_at_desc") items.sort((a, b) => b.updatedAt - a.updatedAt);
    if (sortOrder === "next_run_asc") items.sort((a, b) =>
      (schedulerEntriesById.get(a.id)?.nextRunAt ?? Infinity) - (schedulerEntriesById.get(b.id)?.nextRunAt ?? Infinity));
    return items;
  }, [automations, statusFilter, searchQuery, sortOrder, schedulerEntriesById]);

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

  const selectedItem = automations.find(item => item.id === selectedAutomationId &&
    (!threadTask || (item.status !== "DELETED" && item.targetThreadId === threadTask.threadId)));
  const selectedEntry = selectedItem ? schedulerEntriesById.get(selectedItem.id) : undefined;
  const lastRunThreadId = selectedItem ? runThreads[selectedItem.id] ?? selectedEntry?.lastThreadId : null;
  const runsByStart = new Map<number, RunDisplayRecord>();
  if (selectedItem) {
    for (const run of runHistory) if (run.automationId === selectedItem.id) runsByStart.set(run.startedAt, run);
    for (const run of scheduler?.recentRuns ?? []) if (run.automationId === selectedItem.id) runsByStart.set(run.startedAt, run);
  }
  if (selectedEntry?.lastRunAt != null && !runsByStart.has(selectedEntry.lastRunAt)) {
    runsByStart.set(selectedEntry.lastRunAt, {
      startedAt: selectedEntry.lastRunAt, finishedAt: selectedEntry.lastFinishedAt, status: selectedEntry.lastStatus,
      threadId: selectedEntry.lastThreadId, error: selectedEntry.lastError,
    });
  }
  const selectedRuns = [...runsByStart.values()].sort((a, b) => b.startedAt - a.startedAt);
  const displayedRun = selectedRuns[0];
  const matchesDisplayedRun = displayedRun
    ? displayedRun.status === "completed" && displayedRun.startedAt === selectedEntry?.lastRunAt &&
      (!displayedRun.threadId || displayedRun.threadId === selectedEntry?.lastThreadId)
    : lastRunThreadId === selectedEntry?.lastThreadId;
  const readableRun = !threadTask && !showCreateForm && selectedEntry?.lastRunUnread && matchesDisplayedRun
    ? selectedEntry : null;
  const readTaskId = readableRun?.id;
  const readStartedAt = readableRun?.lastRunAt;
  const readThreadId = readableRun?.lastThreadId;
  useEffect(() => {
    if (!readTaskId || readStartedAt == null || !readThreadId) return;
    let active = true;
    void markActivityRunRead(readTaskId, readStartedAt, readThreadId).then(() => {
      onRunRead?.();
      if (active) void loadScheduler({ silent: true });
    }).catch(error => {
      if (active) setNotice({ kind: "error", text: `更新运行已读状态失败：${String(error)}` });
    });
    return () => { active = false; };
  }, [readTaskId, readStartedAt, readThreadId, loadScheduler, onRunRead]);
  const stateOptions = [["ALL", "全部"], ["ACTIVE", "已开启"], ["PAUSED", "已暂停"], ["COMPLETED", "已完成"]] as const;
  const sortOptions = [["automatic", "自动"], ["next_run_asc", "下次运行"], ["updated_at_desc", "最近更新"], ["title_asc", "名称"]] as const;
  const configurationDirty = showCreateForm && JSON.stringify([name, kind, rrule, prompt, execEnv, selectedModel]) !== configurationBaselineRef.current;
  useEffect(() => {
    if (!onNavigationGuardChange) return;
    onNavigationGuardChange(() => !writePendingRef.current &&
      (!configurationDirty || confirm("放弃未保存的更改？")));
    return () => onNavigationGuardChange(null);
  }, [configurationDirty, onNavigationGuardChange]);
  const hasThreadTaskDetail = threadTask != null && selectedItem != null;
  useEffect(() => {
    if (threadTask) detailCloseRef.current?.focus({ preventScroll: true });
  }, [threadTask?.id, hasThreadTaskDetail]);
  const nextRunLabel = (item: AutomationItem) => {
    if (item.status === "PAUSED") return "已暂停";
    const nextRunAt = schedulerEntriesById.get(item.id)?.nextRunAt;
    if (typeof nextRunAt !== "number" || !Number.isFinite(nextRunAt)) return "—";
    const date = new Date(nextRunAt), today = new Date(clock), tomorrow = new Date(clock);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const day = date.toDateString();
    const prefix = day === today.toDateString() ? "今天" : day === tomorrow.toDateString() ? "明天" : null;
    return prefix ? `${prefix} ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}` : formatDateTime(nextRunAt);
  };
  const closeTaskPanel = () => {
    if (writePendingRef.current) return;
    if (configurationDirty && !confirm("放弃未保存的更改？")) return;
    const returnToId = showCreateForm && editingItem ? editingItem.id : null;
    if (threadTask && !returnToId) {
      threadTask.onClose();
      return;
    }
    setShowCreateForm(false);
    setEditingItem(null);
    setSelectedAutomationId(returnToId);
    if (!returnToId) rowTriggerRef.current?.focus();
  };
  const startCreate = () => {
    if (writePendingRef.current) return;
    if (configurationDirty && !confirm("放弃未保存的更改？")) return;
    configurationBaselineRef.current = JSON.stringify(["", "cron", SCHEDULE_PRESETS[0].rrule, "", "worktree", ""]);
    setSelectedAutomationId(null);
    setEditingItem(null);
    setName(""); setPrompt(""); setKind("cron");
    setRrule(SCHEDULE_PRESETS[0].rrule);
    setExecEnv("worktree"); setSelectedModel("");
    setShowCreateForm(true);
    return true;
  };
  const renderRunResult = (record: RunDisplayRecord, select: typeof onSelectThread) =>
    <div className="automation-run-result" key={record.startedAt}>
      <span style={{color:runStatusColor(record.status)}}>{runStatusLabel(record.status)}</span>
      <time>{formatDateTime(record.finishedAt ?? record.startedAt)}</time>
      {record.error && <p role="alert">{record.error}</p>}
      {record.threadId && <button type="button" className="secondary-btn" disabled={!select}
        onClick={() => select?.(record.threadId!)}>查看会话</button>}
    </div>;

  return (
    <section className="automation-page" aria-label="定时任务" onKeyDown={threadTask ? event => {
      if (event.key !== "Escape" || event.nativeEvent.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopPropagation();
      closeTaskPanel();
    } : undefined}>
      {!threadTask && <header className="automation-page-header">
        <h1>定时任务</h1>
        <button type="button" className="automation-add" onClick={event => {
          if (startCreate()) rowTriggerRef.current = event.currentTarget;
        }} disabled={writeBusy}>
          <Plus size={16} /> 添加
        </button>
      </header>}
      <div className="automation-layout">
        {!threadTask && <div className="automation-list-pane">
          <div className="automation-toolbar">
            <div className="automation-filter" onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFilterOpen(false);
            }}>
              <button type="button" className="automation-filter-trigger" aria-label="筛选和排序任务"
                aria-haspopup="menu" aria-expanded={filterOpen} onClick={() => {
                  filterFocusLastRef.current = false; setFilterOpen(value => !value);
                }} onKeyDown={event => {
                  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                  event.preventDefault(); filterFocusLastRef.current = event.key === "ArrowUp"; setFilterOpen(true);
                }}>
                <ListFilter size={16} /><span>{stateOptions.find(([value]) => value === statusFilter)?.[1]}</span>
              </button>
              {filterOpen && <div ref={filterMenuRef} className="automation-filter-menu" role="menu" aria-label="筛选和排序任务"
                onKeyDown={event => {
                  if (event.key === "Escape") {
                    event.preventDefault(); setFilterOpen(false);
                    event.currentTarget.parentElement?.querySelector("button")?.focus();
                  } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                    event.preventDefault();
                    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
                    const index = controls.indexOf(document.activeElement as HTMLButtonElement);
                    const next = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1 :
                      (index + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length;
                    controls[next]?.focus();
                  }
                }}>
                <span className="automation-menu-heading">状态</span>
                {stateOptions.map(([value, label]) => <button type="button" key={value} role="menuitemradio"
                  aria-checked={statusFilter === value} onClick={event => {
                    setStatusFilter(value); setFilterOpen(false);
                    event.currentTarget.closest(".automation-filter")?.querySelector("button")?.focus();
                  }}>{label}{statusFilter === value && <Check size={14} />}</button>)}
                <span className="automation-menu-heading">排序</span>
                {sortOptions.map(([value, label]) => <button type="button" key={value} role="menuitemradio"
                  aria-checked={sortOrder === value} onClick={event => {
                    setSortOrder(value); setFilterOpen(false);
                    event.currentTarget.closest(".automation-filter")?.querySelector("button")?.focus();
                  }}>{label}{sortOrder === value && <Check size={14} />}</button>)}
              </div>}
            </div>
            <label className="automation-search"><Search size={15} />
              <input aria-label="搜索任务" placeholder="搜索任务" maxLength={256} value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)} />
            </label>
          </div>
          {notice && <p className={`automation-notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
          {listError ? <div className="automation-list-message" role="alert">
            <p>{listError}</p><button type="button" className="secondary-btn" onClick={refresh}>重试</button>
          </div> : listLoading ? <p className="automation-list-message" role="status">正在加载任务…</p> : <>
            <div className="automation-table-heading" aria-hidden="true"><span>任务</span><span>下次运行</span><span>已安排</span></div>
            {filteredItems.length === 0 ? <p className="automation-list-message">没有符合筛选条件的任务</p> :
              <div className="automation-task-list" aria-label="任务列表">
                {filteredItems.map(item => <div className="automation-task-row-wrap" key={item.id}>
                  <button type="button" className={`automation-task-row ${selectedAutomationId === item.id ? "selected" : ""}`}
                    aria-label={item.name} aria-expanded={selectedAutomationId === item.id} onClick={event => {
                      if (writePendingRef.current) return;
                      if (configurationDirty && !confirm("放弃未保存的更改？")) return;
                      rowTriggerRef.current = event.currentTarget;
                      setShowCreateForm(false); setEditingItem(null); setSelectedAutomationId(item.id);
                    }}>
                    <span className="automation-task-name"><Clock size={16} /><span>{item.name}</span>
                      {runningAutomationIds.has(item.id) && <span className="automation-running">运行中…</span>}</span>
                    <span className="automation-task-time">{nextRunLabel(item)}</span>
                    <span className="automation-task-schedule">{scheduleLabel(item, schedulerEntriesById.get(item.id)?.nextRunAt)}</span>
                  </button>
                </div>)}
              </div>}
          </>}
        </div>}
        {threadTask && !showCreateForm && !selectedItem && <aside className="automation-detail" aria-label="任务详情">
          <header className="automation-detail-header"><h2>已安排任务</h2>
            <button ref={detailCloseRef} type="button" className="automation-close" aria-label="关闭任务详情" onClick={threadTask.onClose}><X size={16} /></button>
          </header>
          <p role="status">{listLoading ? "正在读取定时任务…" : listError || "未找到已安排任务"}</p>
          {listError && <button type="button" className="secondary-btn" onClick={() => void refresh()}>重试</button>}
        </aside>}
        {(showCreateForm || selectedItem) && <aside className="automation-detail" aria-label={showCreateForm ? "任务配置" : "任务详情"}>
          <header className="automation-detail-header"><h2>{showCreateForm ? editingItem ? "编辑定时任务" : "添加定时任务" : selectedItem?.name}</h2>
            <div className="automation-detail-header-actions">
              {!showCreateForm && selectedItem && <>
                <ThreadActionsMenu
                  key={selectedItem.id}
                  triggerAriaLabel="已安排任务操作"
                  items={[
                    { id: "run", label: runBusyId === selectedItem.id ? "触发中…" : "立即运行", icon: <Play size={14} />,
                      disabled: writeBusy || runBusyId !== null },
                    { id: "status", label: selectedItem.status === "PAUSED" ? "继续" : "暂停",
                      icon: selectedItem.status === "PAUSED" ? <Play size={14} /> : <Pause size={14} />, disabled: writeBusy },
                    { id: "delete", label: "删除", icon: <Trash2 size={14} />, danger: true, disabled: writeBusy },
                  ]}
                  onSelect={id => {
                    if (writePendingRef.current) return;
                    if (id === "run") return handleRunNow(selectedItem);
                    if (id === "status") return handleToggleStatus(selectedItem);
                    if (id === "delete") return handleDelete(selectedItem.id);
                  }}
                />
                <button type="button" className="automation-close" aria-label="编辑任务" title="编辑任务"
                  disabled={writeBusy} onClick={() => handleStartEdit(selectedItem)}><Edit2 size={16} /></button>
              </>}
              <button ref={detailCloseRef} type="button" className="automation-close" aria-label="关闭任务详情" disabled={writeBusy} onClick={closeTaskPanel}><X size={16} /></button>
            </div>
          </header>
      {showCreateForm && (
        <fieldset className="automation-config-fieldset" disabled={writeBusy} style={{ minWidth: 0 }}>
          <div className="form-grid-row">
            <div className="form-field">
              <label>名称</label>
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
              {editingItem?.rrule.includes("\n") ? <textarea rows={2} value={rrule} onChange={e => setRrule(e.target.value)} /> : <input
                type="text"
                value={rrule}
                onChange={(e) => setRrule(e.target.value)}
                placeholder="FREQ=DAILY;BYHOUR=9;BYMINUTE=0"
              />}
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
            <label>指令</label>
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
              {editingItem ? <Edit2 size={14} /> : <Plus size={14} />} {editingItem ? "保存修改" : "创建"}
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                if (configurationDirty && !confirm("放弃未保存的更改？")) return;
                if (editingItem) detailCloseRef.current?.focus();
                else rowTriggerRef.current?.focus();
                setShowCreateForm(false);
                setEditingItem(null);
                setName("");
                setPrompt("");
              }}
            >
              取消
            </button>
          </div>
        </fieldset>
      )}
          {!showCreateForm && selectedItem && <>
            <p className="automation-detail-prompt">{selectedItem.prompt}</p>
            <dl className="automation-detail-metadata">
              <div><dt>状态</dt><dd>{selectedItem.status === "PAUSED" ? "已暂停" : selectedItem.status === "COMPLETED" ? "已完成" : "已开启"}</dd></div>
              <div><dt>下次运行</dt><dd>{nextRunLabel(selectedItem)}</dd></div>
              <div><dt>已安排</dt><dd>{scheduleLabel(selectedItem, selectedEntry?.nextRunAt)}</dd></div>
            </dl>
            {selectedItem.kind === "goal" && selectedItem.status !== "COMPLETED" && <button type="button" className="secondary-btn" disabled={writeBusy}
              onClick={() => handleToggleStatus(selectedItem, "COMPLETED")}><CheckCircle2 size={14} />完成</button>}
            {(schedulerState === "unavailable" || schedulerState === "error") && <div className="automation-detail-error" role="status">
              <p>{schedulerState === "unavailable" ? "调度器不可用，任务尚未运行。" : schedulerError}</p>
              <button type="button" className="secondary-btn" onClick={handleRefreshSchedule} disabled={schedulerBusy}>{schedulerBusy ? "刷新中…" : "重试"}</button>
            </div>}
            <section className="automation-run-results" aria-label="上次运行"><h3>上次运行</h3>
              {displayedRun ? renderRunResult(displayedRun, onSelectThread) : <p>尚未运行</p>}
              {selectedRuns.length === 0 && lastRunThreadId && <button type="button" className="secondary-btn" disabled={!onSelectThread}
                onClick={() => onSelectThread?.(lastRunThreadId)}>查看会话</button>}
              {selectedEntry?.lastError && selectedEntry.lastError !== displayedRun?.error && <p role="alert">{selectedEntry.lastError}</p>}
            </section>
            {selectedRuns.length > 1 && <section className="automation-run-results" aria-label="运行历史记录"><h3>运行历史记录</h3>
              {selectedRuns.slice(1).map(record => renderRunResult(record, onSelectHistoryThread ?? onSelectThread))}
            </section>}
          </>}
        </aside>}
      </div>
    </section>
  );
};

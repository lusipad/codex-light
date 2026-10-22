//! Local automation scheduler (the "cron" half of the Automations feature).
//!
//! The Codex desktop app persists automations as
//! `~/.codex/automations/<id>/automation.toml` (read by
//! [`crate::config_skills::list_automations`]). The official Electron app runs a
//! main-process scheduler that fires due automations; this module restores that
//! behavior for the Tauri client:
//!
//! * scans every 30 s (first scan after 5 s),
//! * computes the next occurrence from the automation's RRULE,
//! * persists scheduling bookkeeping in
//!   `~/.codex/.codex-native/scheduler-state.json` (atomic tmp + rename; user
//!   `automation.toml` files are never modified),
//! * when due, starts a real app-server thread/turn
//!   (`thread/start` + `turn/start`, approval policy `never`, sandbox
//!   `workspace-write`) and emits `automation:run-started` /
//!   `automation:run-finished` events for the UI.
//!
//! Scheduling is anchored to the automation's `created_at`/`updated_at`
//! baseline (file mtime) and a stable per-id jitter derived from
//! `~/.codex/automations/.run-jitter-salt`, so newly discovered automations are
//! scheduled into the future instead of all firing at startup.
//!
//! Known limitation: nothing runs while the desktop app is closed (no OS-level
//! service is installed).

use crate::config_skills::{self, AutomationItem};
use crate::state::codex_home_dir;
use crate::AppState;
use chrono::{
    Datelike, Duration as ChronoDuration, Local, Months, NaiveDate, NaiveDateTime, TimeZone,
    Timelike, Weekday,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration as StdDuration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

/// Delay before the very first scan, giving the app-server connection a head start.
const INITIAL_SCAN_DELAY: StdDuration = StdDuration::from_secs(5);
/// How often automations are re-evaluated.
const SCAN_INTERVAL: StdDuration = StdDuration::from_secs(30);
/// Maximum stable jitter (in seconds) added on top of a scheduled occurrence.
const MAX_JITTER_SECS: u64 = 60;
/// Version of the on-disk scheduler state file.
const STATE_VERSION: u32 = 1;
/// Salt used when `~/.codex/automations/.run-jitter-salt` is missing.
const FALLBACK_JITTER_SALT: &[u8] = b"codex-native-automation-scheduler";

/* ------------------------------------------------------------------ */
/* Small time helpers                                                  */
/* ------------------------------------------------------------------ */

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// Convert a unix-millisecond timestamp into local wall-clock time.
fn datetime_from_ms(ms: u64) -> NaiveDateTime {
    let clamped = ms.min(i64::MAX as u64) as i64;
    Local
        .timestamp_millis_opt(clamped)
        .earliest()
        .map(|datetime| datetime.naive_local())
        .unwrap_or_else(|| Local::now().naive_local())
}

/// Convert local wall-clock time into a unix-millisecond timestamp.
/// Returns `None` for nonexistent local times (spring-forward DST gap).
fn ms_from_datetime(naive: NaiveDateTime) -> Option<u64> {
    Local
        .from_local_datetime(&naive)
        .earliest()
        .map(|datetime| datetime.timestamp_millis().max(0) as u64)
}

fn compute_next_run_ms(rule: &Rrule, anchor_ms: u64, after_ms: u64) -> Option<u64> {
    let anchor = datetime_from_ms(anchor_ms);
    let mut after = datetime_from_ms(after_ms.max(anchor_ms));
    // Skip nonexistent local times (DST gap) rather than dropping the schedule.
    for _ in 0..6 {
        let candidate = next_occurrence_naive(rule, anchor, after)?;
        if let Some(ms) = ms_from_datetime(candidate) {
            return Some(ms);
        }
        after = candidate;
    }
    None
}

/* ------------------------------------------------------------------ */
/* RRULE parsing                                                       */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Freq {
    Hourly,
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

/// Supported subset of RFC 5545 RRULE:
/// `FREQ=HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY`, `INTERVAL`, `BYHOUR`,
/// `BYMINUTE`, `BYDAY`, `BYMONTHDAY` (positive and negative days) and `WKST`.
/// Anything else is rejected with an explanatory error (caller logs and skips
/// the automation instead of crashing).
#[derive(Debug, Clone)]
struct Rrule {
    freq: Freq,
    interval: u32,
    by_hour: Vec<u32>,
    by_minute: Vec<u32>,
    by_day: Vec<Weekday>,
    by_month_day: Vec<i32>,
    week_start: Weekday,
}

impl Rrule {
    fn parse(raw: &str) -> Result<Self, String> {
        let normalized = raw.trim().to_ascii_uppercase();
        let body = normalized.strip_prefix("RRULE:").unwrap_or(&normalized);
        if body.trim().is_empty() {
            return Err("empty RRULE".to_string());
        }

        let mut freq: Option<Freq> = None;
        let mut interval: u32 = 1;
        let mut by_hour: Vec<u32> = Vec::new();
        let mut by_minute: Vec<u32> = Vec::new();
        let mut by_day: Vec<Weekday> = Vec::new();
        let mut by_month_day: Vec<i32> = Vec::new();
        let mut week_start = Weekday::Mon;

        for part in body.split(';').map(str::trim).filter(|part| !part.is_empty()) {
            let (key, value) = part
                .split_once('=')
                .ok_or_else(|| format!("malformed RRULE part `{part}`"))?;
            let key = key.trim();
            let value = value.trim();
            match key {
                "FREQ" => {
                    freq = Some(match value {
                        "HOURLY" => Freq::Hourly,
                        "DAILY" => Freq::Daily,
                        "WEEKLY" => Freq::Weekly,
                        "MONTHLY" => Freq::Monthly,
                        "YEARLY" => Freq::Yearly,
                        other => return Err(format!("unsupported FREQ `{other}`")),
                    });
                }
                "INTERVAL" => {
                    let parsed: u32 = value
                        .parse()
                        .map_err(|_| format!("invalid INTERVAL `{value}`"))?;
                    if parsed == 0 {
                        return Err("INTERVAL must be at least 1".to_string());
                    }
                    interval = parsed;
                }
                "BYHOUR" => {
                    by_hour = parse_u32_list(value, "BYHOUR")?;
                    if let Some(bad) = by_hour.iter().find(|hour| **hour > 23) {
                        return Err(format!("BYHOUR out of range: {bad}"));
                    }
                }
                "BYMINUTE" => {
                    by_minute = parse_u32_list(value, "BYMINUTE")?;
                    if let Some(bad) = by_minute.iter().find(|minute| **minute > 59) {
                        return Err(format!("BYMINUTE out of range: {bad}"));
                    }
                }
                "BYDAY" => {
                    for token in value.split(',').map(str::trim).filter(|t| !t.is_empty()) {
                        by_day.push(parse_weekday(token)?);
                    }
                    by_day.sort_by_key(|day| day.num_days_from_monday());
                    by_day.dedup();
                }
                "BYMONTHDAY" => {
                    for token in value.split(',').map(str::trim).filter(|t| !t.is_empty()) {
                        let parsed: i32 = token
                            .parse()
                            .map_err(|_| format!("invalid BYMONTHDAY `{token}`"))?;
                        if parsed == 0 || !(-31..=31).contains(&parsed) {
                            return Err(format!("BYMONTHDAY out of range: {parsed}"));
                        }
                        by_month_day.push(parsed);
                    }
                    by_month_day.sort_unstable();
                    by_month_day.dedup();
                }
                "WKST" => {
                    week_start = parse_weekday(value)?;
                }
                other => {
                    return Err(format!("unsupported RRULE part `{other}`"));
                }
            }
        }

        let freq = freq.ok_or_else(|| "RRULE is missing FREQ".to_string())?;
        Ok(Rrule {
            freq,
            interval,
            by_hour,
            by_minute,
            by_day,
            by_month_day,
            week_start,
        })
    }

    /// Wall-clock times generated on `date` (all BYHOUR/BYMINUTE combinations,
    /// defaulting to the anchor time).
    fn times_on_date(&self, date: NaiveDate, anchor: NaiveDateTime) -> Vec<NaiveDateTime> {
        let hours: Vec<u32> = if self.by_hour.is_empty() {
            vec![anchor.hour()]
        } else {
            self.by_hour.clone()
        };
        let minutes: Vec<u32> = if self.by_minute.is_empty() {
            vec![anchor.minute()]
        } else {
            self.by_minute.clone()
        };
        let mut candidates = Vec::with_capacity(hours.len() * minutes.len());
        for hour in hours {
            for minute in &minutes {
                if let Some(candidate) = date.and_hms_opt(hour, *minute, 0) {
                    candidates.push(candidate);
                }
            }
        }
        candidates.sort_unstable();
        candidates.dedup();
        candidates
    }

    fn first_after_on_date(
        &self,
        date: NaiveDate,
        anchor: NaiveDateTime,
        after: NaiveDateTime,
    ) -> Option<NaiveDateTime> {
        self.times_on_date(date, anchor)
            .into_iter()
            .find(|candidate| *candidate > after)
    }

    /// Dates selected in one calendar month (BYMONTHDAY / BYDAY expansion).
    fn dates_in_month(&self, month_start: NaiveDate, anchor: NaiveDateTime) -> Vec<NaiveDate> {
        let year = month_start.year();
        let month = month_start.month();
        let total_days = days_in_month(year, month);
        let mut dates = Vec::new();

        if !self.by_month_day.is_empty() {
            for &spec in &self.by_month_day {
                let day = if spec > 0 {
                    spec
                } else {
                    total_days as i32 + spec + 1
                };
                if day < 1 || day > total_days as i32 {
                    continue;
                }
                if let Some(date) = NaiveDate::from_ymd_opt(year, month, day as u32) {
                    if self.by_day.is_empty() || self.by_day.contains(&date.weekday()) {
                        dates.push(date);
                    }
                }
            }
        } else if !self.by_day.is_empty() {
            for day in 1..=total_days {
                if let Some(date) = NaiveDate::from_ymd_opt(year, month, day) {
                    if self.by_day.contains(&date.weekday()) {
                        dates.push(date);
                    }
                }
            }
        } else if anchor.day() <= total_days {
            if let Some(date) = NaiveDate::from_ymd_opt(year, month, anchor.day()) {
                dates.push(date);
            }
        }

        dates.sort_unstable();
        dates.dedup();
        dates
    }
}

fn parse_u32_list(value: &str, name: &str) -> Result<Vec<u32>, String> {
    let mut parsed = Vec::new();
    for token in value.split(',').map(str::trim) {
        if token.is_empty() {
            return Err(format!("empty {name} value"));
        }
        parsed.push(
            token
                .parse::<u32>()
                .map_err(|_| format!("invalid {name} value `{token}`"))?,
        );
    }
    parsed.sort_unstable();
    parsed.dedup();
    Ok(parsed)
}

fn parse_weekday(value: &str) -> Result<Weekday, String> {
    match value.trim() {
        "MO" => Ok(Weekday::Mon),
        "TU" => Ok(Weekday::Tue),
        "WE" => Ok(Weekday::Wed),
        "TH" => Ok(Weekday::Thu),
        "FR" => Ok(Weekday::Fri),
        "SA" => Ok(Weekday::Sat),
        "SU" => Ok(Weekday::Sun),
        other => Err(format!("unsupported weekday `{other}`")),
    }
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    NaiveDate::from_ymd_opt(next_year, next_month, 1)
        .and_then(|date| date.pred_opt())
        .map(|date| date.day())
        .unwrap_or(28)
}

/* ------------------------------------------------------------------ */
/* Next-occurrence computation                                         */
/* ------------------------------------------------------------------ */

// Bounded forward searches; a well-formed rule always finds a candidate well
// before these caps. Exceeding a cap returns `None` (no run scheduled).
const MAX_HOURLY_STEPS: usize = 300_000;
const MAX_DAILY_STEPS: usize = 60_000;
const MAX_WEEKLY_STEPS: usize = 8_000;
const MAX_MONTHLY_STEPS: usize = 2_400;
const MAX_YEARLY_STEPS: usize = 600;

/// First occurrence strictly after `after`, anchored at `anchor`.
/// Pure wall-clock math (no timezone) so it is deterministic and unit-testable.
fn next_occurrence_naive(
    rule: &Rrule,
    anchor: NaiveDateTime,
    after: NaiveDateTime,
) -> Option<NaiveDateTime> {
    match rule.freq {
        Freq::Hourly => next_hourly(rule, anchor, after),
        Freq::Daily => next_daily(rule, anchor, after),
        Freq::Weekly => next_weekly(rule, anchor, after),
        Freq::Monthly => next_monthly(rule, anchor, after),
        Freq::Yearly => next_yearly(rule, anchor, after),
    }
}

fn next_hourly(
    rule: &Rrule,
    anchor: NaiveDateTime,
    after: NaiveDateTime,
) -> Option<NaiveDateTime> {
    let interval = rule.interval as i64;
    let base = NaiveDate::from_ymd_opt(anchor.year(), anchor.month(), anchor.day())?
        .and_hms_opt(anchor.hour(), 0, 0)?;
    let minutes: Vec<u32> = if rule.by_minute.is_empty() {
        vec![anchor.minute()]
    } else {
        rule.by_minute.clone()
    };

    let diff_hours = (after - base).num_hours();
    let mut step = if diff_hours <= 0 {
        0
    } else {
        diff_hours / interval - 2
    };
    if step < 0 {
        step = 0;
    }

    for _ in 0..MAX_HOURLY_STEPS {
        let hour_base = base.checked_add_signed(ChronoDuration::hours(step * interval))?;
        step += 1;
        if !rule.by_hour.is_empty() && !rule.by_hour.contains(&hour_base.hour()) {
            continue;
        }
        for &minute in &minutes {
            if let Some(candidate) =
                NaiveDate::from_ymd_opt(hour_base.year(), hour_base.month(), hour_base.day())
                    .and_then(|date| date.and_hms_opt(hour_base.hour(), minute, 0))
            {
                if candidate > after {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

fn next_daily(rule: &Rrule, anchor: NaiveDateTime, after: NaiveDateTime) -> Option<NaiveDateTime> {
    let interval = rule.interval as i64;
    let base_date = anchor.date();
    let diff_days = (after.date() - base_date).num_days();
    let mut step = if diff_days <= 0 {
        0
    } else {
        diff_days / interval - 2
    };
    if step < 0 {
        step = 0;
    }

    for _ in 0..MAX_DAILY_STEPS {
        let date = base_date.checked_add_signed(ChronoDuration::days(step * interval))?;
        step += 1;
        if !rule.by_day.is_empty() && !rule.by_day.contains(&date.weekday()) {
            continue;
        }
        if let Some(candidate) = rule.first_after_on_date(date, anchor, after) {
            return Some(candidate);
        }
    }
    None
}

fn week_start_date(date: NaiveDate, week_start: Weekday) -> NaiveDate {
    let offset = (date.weekday().num_days_from_monday() as i64
        - week_start.num_days_from_monday() as i64)
        .rem_euclid(7);
    date.checked_sub_signed(ChronoDuration::days(offset))
        .unwrap_or(date)
}

fn next_weekly(
    rule: &Rrule,
    anchor: NaiveDateTime,
    after: NaiveDateTime,
) -> Option<NaiveDateTime> {
    let interval = rule.interval as i64;
    let anchor_week_start = week_start_date(anchor.date(), rule.week_start);
    let weekdays: Vec<Weekday> = if rule.by_day.is_empty() {
        vec![anchor.date().weekday()]
    } else {
        rule.by_day.clone()
    };

    let week_span_days = 7 * interval;
    let diff_days = (after.date() - anchor_week_start).num_days();
    let mut step = if diff_days <= 0 {
        0
    } else {
        diff_days / week_span_days - 1
    };
    if step < 0 {
        step = 0;
    }

    for _ in 0..MAX_WEEKLY_STEPS {
        let week_start =
            anchor_week_start.checked_add_signed(ChronoDuration::days(step * week_span_days))?;
        step += 1;
        let start_number = week_start.weekday().num_days_from_monday() as i64;
        let mut dates: Vec<NaiveDate> = weekdays
            .iter()
            .filter_map(|weekday| {
                let offset = (weekday.num_days_from_monday() as i64 - start_number).rem_euclid(7);
                week_start.checked_add_signed(ChronoDuration::days(offset))
            })
            .collect();
        dates.sort_unstable();
        dates.dedup();
        for date in dates {
            if let Some(candidate) = rule.first_after_on_date(date, anchor, after) {
                return Some(candidate);
            }
        }
    }
    None
}

fn next_monthly(
    rule: &Rrule,
    anchor: NaiveDateTime,
    after: NaiveDateTime,
) -> Option<NaiveDateTime> {
    let interval = rule.interval.max(1);
    let anchor_month_start = NaiveDate::from_ymd_opt(anchor.year(), anchor.month(), 1)?;
    let months_diff =
        (after.year() - anchor.year()) * 12 + (after.month() as i32 - anchor.month() as i32);
    let mut step = if months_diff <= 0 {
        0
    } else {
        months_diff / interval as i32 - 1
    };
    if step < 0 {
        step = 0;
    }

    for _ in 0..MAX_MONTHLY_STEPS {
        let offset = u32::try_from(step).ok()?.checked_mul(interval)?;
        let month_start = anchor_month_start.checked_add_months(Months::new(offset))?;
        step += 1;
        for date in rule.dates_in_month(month_start, anchor) {
            if let Some(candidate) = rule.first_after_on_date(date, anchor, after) {
                return Some(candidate);
            }
        }
    }
    None
}

fn next_yearly(
    rule: &Rrule,
    anchor: NaiveDateTime,
    after: NaiveDateTime,
) -> Option<NaiveDateTime> {
    let interval = rule.interval as i32;
    let anchor_year = anchor.year();
    let year_diff = after.year() - anchor_year;
    let mut step = if year_diff <= 0 {
        0
    } else {
        year_diff / interval - 1
    };
    if step < 0 {
        step = 0;
    }

    for _ in 0..MAX_YEARLY_STEPS {
        let year = anchor_year.checked_add(step * interval)?;
        step += 1;
        let Some(month_start) = NaiveDate::from_ymd_opt(year, anchor.month(), 1) else {
            continue;
        };
        for date in rule.dates_in_month(month_start, anchor) {
            if let Some(candidate) = rule.first_after_on_date(date, anchor, after) {
                return Some(candidate);
            }
        }
    }
    None
}

/* ------------------------------------------------------------------ */
/* Stable per-automation jitter                                        */
/* ------------------------------------------------------------------ */

fn read_jitter_salt() -> Vec<u8> {
    let path = codex_home_dir()
        .join("automations")
        .join(".run-jitter-salt");
    match fs::read(&path) {
        Ok(bytes) if !bytes.is_empty() => bytes,
        _ => FALLBACK_JITTER_SALT.to_vec(),
    }
}

/// Stable FNV-1a based jitter in `0..=MAX_JITTER_SECS` seconds, derived from the
/// runtime salt and the automation id (same automation keeps the same offset).
fn jitter_ms(id: &str, salt: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in salt.iter().chain(id.as_bytes()) {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    (hash % (MAX_JITTER_SECS + 1)) * 1000
}

/* ------------------------------------------------------------------ */
/* Scheduler state file                                                */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct AutomationScheduleState {
    last_run_at: Option<u64>,
    next_run_at: Option<u64>,
    last_thread_id: Option<String>,
    last_status: Option<String>,
    last_error: Option<String>,
    run_count: u64,
    /// Internal: hash of the effective schedule config, used to detect edits.
    config_signature: Option<String>,
    /// Internal: interval anchor (created_at/updated_at baseline), unix ms.
    anchor_at: Option<u64>,
    /// Internal: why the scheduler cannot run this automation right now.
    schedule_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct SchedulerState {
    version: u32,
    updated_at: u64,
    automations: BTreeMap<String, AutomationScheduleState>,
}

impl Default for SchedulerState {
    fn default() -> Self {
        Self {
            version: STATE_VERSION,
            updated_at: 0,
            automations: BTreeMap::new(),
        }
    }
}

fn scheduler_state_path() -> PathBuf {
    codex_home_dir()
        .join(".codex-native")
        .join("scheduler-state.json")
}

fn load_state() -> SchedulerState {
    let path = scheduler_state_path();
    let Ok(raw) = fs::read_to_string(&path) else {
        return SchedulerState::default();
    };
    match serde_json::from_str::<SchedulerState>(&raw) {
        Ok(state) => {
            if state.version > STATE_VERSION {
                eprintln!(
                    "[automations] scheduler state version {} is newer than {}; ignoring unknown fields",
                    state.version, STATE_VERSION
                );
            }
            state
        }
        Err(err) => {
            eprintln!("[automations] failed to parse scheduler state: {err}");
            SchedulerState::default()
        }
    }
}

/// Write the state file atomically (tmp file + rename). Failures are logged and
/// never panic; scheduling simply continues with in-memory data.
fn persist_state(state: &mut SchedulerState) {
    state.version = STATE_VERSION;
    state.updated_at = now_ms();

    let path = scheduler_state_path();
    if let Some(parent) = path.parent() {
        if let Err(err) = fs::create_dir_all(parent) {
            eprintln!("[automations] failed to create scheduler state dir: {err}");
            return;
        }
    }
    let serialized = match serde_json::to_string_pretty(state) {
        Ok(text) => text,
        Err(err) => {
            eprintln!("[automations] failed to serialize scheduler state: {err}");
            return;
        }
    };
    let temp_path = path.with_extension("json.tmp");
    if let Err(err) = fs::write(&temp_path, serialized.as_bytes()) {
        eprintln!("[automations] failed to write scheduler state temp file: {err}");
        return;
    }
    if let Err(first_err) = fs::rename(&temp_path, &path) {
        // Windows can refuse to rename over an existing file on some volumes.
        let _ = fs::remove_file(&path);
        if let Err(second_err) = fs::rename(&temp_path, &path) {
            eprintln!(
                "[automations] failed to persist scheduler state: {first_err} / {second_err}"
            );
        }
    }
}

/// Guards read-modify-write cycles of the state file across the scheduler loop
/// and the Tauri commands.
static STATE_LOCK: Mutex<()> = Mutex::new(());

fn read_state() -> SchedulerState {
    let _guard = STATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    load_state()
}

fn with_state<T>(mutate: impl FnOnce(&mut SchedulerState) -> T) -> T {
    let _guard = STATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = load_state();
    let before = serde_json::to_string(&state).unwrap_or_default();
    let result = mutate(&mut state);
    let after = serde_json::to_string(&state).unwrap_or_default();
    if before != after {
        persist_state(&mut state);
    }
    result
}

fn baseline_ms(item: &AutomationItem) -> u64 {
    let baseline = item.created_at.max(item.updated_at);
    if baseline == 0 {
        now_ms()
    } else {
        baseline
    }
}

fn schedule_signature(item: &AutomationItem) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}",
        item.rrule.trim(),
        item.execution_environment.trim().to_ascii_lowercase(),
        item.cwds.join(";"),
        item.model.as_deref().unwrap_or("").trim(),
        item.reasoning_effort.as_deref().unwrap_or("").trim(),
        item.updated_at.max(item.created_at),
    )
}

/// Store (and log once) the reason an automation cannot be scheduled.
fn note_schedule_warning(
    entry: &mut AutomationScheduleState,
    item: &AutomationItem,
    warning: String,
) {
    if entry.schedule_warning.as_deref() != Some(warning.as_str()) {
        eprintln!(
            "[automations] skipping `{}` ({}): {}",
            item.name, item.id, warning
        );
    }
    entry.schedule_warning = Some(warning);
}

/// Bring one automation's state up to date and report whether it is due now.
///
/// Returns `true` when the caller should execute it; in that case the entry has
/// already been marked `running` and `next_run_at` advanced so a slow run cannot
/// be triggered twice.
fn prepare_item(
    state: &mut SchedulerState,
    item: &AutomationItem,
    now: u64,
    salt: &[u8],
    force_reschedule: bool,
) -> bool {
    let signature = schedule_signature(item);
    let entry = state.automations.entry(item.id.clone()).or_default();

    let signature_changed = entry.config_signature.as_deref() != Some(signature.as_str());
    if signature_changed || entry.anchor_at.is_none() {
        entry.config_signature = Some(signature);
        entry.anchor_at = Some(baseline_ms(item));
        entry.next_run_at = None;
    }
    if entry.anchor_at.is_none() {
        entry.anchor_at = Some(baseline_ms(item));
    }

    // Only ACTIVE automations execute; PAUSED/COMPLETED ones keep their history.
    if !item.status.eq_ignore_ascii_case("ACTIVE") {
        entry.next_run_at = None;
        entry.schedule_warning = None;
        return false;
    }

    if !item.execution_environment.eq_ignore_ascii_case("local") {
        entry.next_run_at = None;
        note_schedule_warning(
            entry,
            item,
            format!(
                "execution_environment `{}` is not local; the local scheduler skips it",
                item.execution_environment
            ),
        );
        return false;
    }

    if item.cwds.iter().all(|cwd| cwd.trim().is_empty()) {
        entry.next_run_at = None;
        note_schedule_warning(entry, item, "automation has no cwd; skipped".to_string());
        return false;
    }

    let rule = match Rrule::parse(&item.rrule) {
        Ok(rule) => rule,
        Err(err) => {
            entry.next_run_at = None;
            note_schedule_warning(entry, item, format!("unsupported RRULE: {err}"));
            return false;
        }
    };
    entry.schedule_warning = None;

    let anchor_ms = entry.anchor_at.unwrap_or_else(|| baseline_ms(item));
    if force_reschedule || signature_changed || entry.next_run_at.is_none() {
        // Always move forward from "now": a newly discovered automation should
        // not fire immediately for occurrences that were missed while the app
        // was not running.
        entry.next_run_at = compute_next_run_ms(&rule, anchor_ms, now);
        if entry.next_run_at.is_none() {
            note_schedule_warning(
                entry,
                item,
                "RRULE produced no upcoming occurrence".to_string(),
            );
        }
    }

    let Some(next_run_at) = entry.next_run_at else {
        return false;
    };
    if now < next_run_at.saturating_add(jitter_ms(&item.id, salt)) {
        return false;
    }

    // Mark the run before executing it.
    entry.last_run_at = Some(now);
    entry.last_status = Some("running".to_string());
    entry.last_error = None;
    entry.run_count = entry.run_count.saturating_add(1);
    entry.next_run_at = compute_next_run_ms(&rule, anchor_ms, now);
    true
}

/* ------------------------------------------------------------------ */
/* Execution against the app-server                                    */
/* ------------------------------------------------------------------ */

struct RunOutcome {
    thread_id: String,
    turn_id: Option<String>,
}

struct ExecutionError {
    message: String,
    thread_id: Option<String>,
}

impl ExecutionError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            thread_id: None,
        }
    }
}

fn emit_event(app: &AppHandle, event: &str, payload: Value) {
    if let Err(err) = app.emit(event, payload) {
        eprintln!("[automations] failed to emit `{event}`: {err}");
    }
}

/// Start a thread + turn for one automation. Never panics; all failures come
/// back as [`ExecutionError`].
async fn execute_automation(
    app: &AppHandle,
    item: &AutomationItem,
) -> Result<RunOutcome, ExecutionError> {
    let cwd = item
        .cwds
        .iter()
        .map(|cwd| cwd.trim())
        .find(|cwd| !cwd.is_empty())
        .map(str::to_string)
        .ok_or_else(|| ExecutionError::new("automation has no cwd"))?;

    if !item.execution_environment.eq_ignore_ascii_case("local") {
        return Err(ExecutionError::new(format!(
            "execution_environment `{}` is not local; run skipped",
            item.execution_environment
        )));
    }

    let manager = {
        let state = app.state::<AppState>();
        state.app_server.clone()
    };
    manager.ensure_connected(app).await.map_err(|err| {
        ExecutionError::new(format!("app-server connection failed: {err}"))
    })?;

    let mut thread_params = json!({
        "cwd": cwd,
        "approvalPolicy": "never",
        "sandbox": "workspace-write",
    });
    if let Some(model) = item
        .model
        .as_deref()
        .map(str::trim)
        .filter(|model| !model.is_empty())
    {
        thread_params["model"] = json!(model);
    }

    let thread_response = manager
        .call(app, "thread/start", Some(thread_params))
        .await
        .map_err(|err| ExecutionError::new(format!("thread/start failed: {err}")))?;
    let thread_id = thread_response
        .get("thread")
        .and_then(|thread| thread.get("id"))
        .and_then(Value::as_str)
        .or_else(|| thread_response.get("threadId").and_then(Value::as_str))
        .or_else(|| thread_response.get("conversationId").and_then(Value::as_str))
        .map(str::to_string)
        .ok_or_else(|| {
            ExecutionError::new("thread/start response did not contain a thread id")
        })?;

    {
        let state = app.state::<AppState>();
        state
            .desktop_state
            .record_thread_workspace(&thread_id, &cwd);
    }

    let mut turn_params = json!({
        "threadId": thread_id.clone(),
        "input": [{ "type": "text", "text": item.prompt }],
    });
    if let Some(model) = item
        .model
        .as_deref()
        .map(str::trim)
        .filter(|model| !model.is_empty())
    {
        turn_params["model"] = json!(model);
    }
    if let Some(effort) = item
        .reasoning_effort
        .as_deref()
        .map(str::trim)
        .filter(|effort| !effort.is_empty())
    {
        turn_params["effort"] = json!(effort);
    }

    let turn_response = manager
        .call(app, "turn/start", Some(turn_params))
        .await
        .map_err(|err| ExecutionError {
            message: format!("turn/start failed: {err}"),
            thread_id: Some(thread_id.clone()),
        })?;
    let turn_id = turn_response
        .get("turn")
        .and_then(|turn| turn.get("id"))
        .and_then(Value::as_str)
        .or_else(|| turn_response.get("turnId").and_then(Value::as_str))
        .map(str::to_string);

    Ok(RunOutcome { thread_id, turn_id })
}

/* ------------------------------------------------------------------ */
/* Background scheduler                                                */
/* ------------------------------------------------------------------ */

pub struct AutomationScheduler {
    app: AppHandle,
}

static SCHEDULER: OnceLock<AutomationScheduler> = OnceLock::new();
static STARTED: AtomicBool = AtomicBool::new(false);

/// Start the background scheduler. Idempotent: repeated calls only start one
/// loop. Called from the Tauri `setup` hook.
pub fn start(app: AppHandle) {
    let scheduler = SCHEDULER.get_or_init(|| AutomationScheduler { app });
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        scheduler.run_loop().await;
    });
}

impl AutomationScheduler {
    async fn run_loop(&self) {
        recover_interrupted_runs();
        tokio::time::sleep(INITIAL_SCAN_DELAY).await;
        loop {
            if let Err(err) = self.scan_and_run().await {
                eprintln!("[automations] scheduler scan failed: {err}");
            }
            tokio::time::sleep(SCAN_INTERVAL).await;
        }
    }

    async fn scan_and_run(&self) -> Result<(), String> {
        let items = config_skills::list_automations();
        if items.is_empty() {
            delete_orphaned_state(&items);
            return Ok(());
        }
        let now = now_ms();
        let salt = read_jitter_salt();
        let mut due_items: Vec<AutomationItem> = Vec::new();
        let known_ids: HashSet<String> = items.iter().map(|item| item.id.clone()).collect();

        with_state(|state| {
            state.automations.retain(|id, _| known_ids.contains(id));
            for item in &items {
                if prepare_item(state, item, now, &salt, false) {
                    due_items.push(item.clone());
                }
            }
        });

        for item in due_items {
            self.execute_due(item).await;
        }
        Ok(())
    }

    async fn execute_due(&self, item: AutomationItem) {
        let started_at = now_ms();
        emit_event(
            &self.app,
            "automation:run-started",
            json!({
                "id": &item.id,
                "name": &item.name,
                "at": started_at,
            }),
        );

        let result = execute_automation(&self.app, &item).await;
        let finished_at = now_ms();

        match result {
            Ok(outcome) => {
                let thread_id = outcome.thread_id.clone();
                with_state(|state| {
                    if let Some(entry) = state.automations.get_mut(&item.id) {
                        entry.last_status = Some("completed".to_string());
                        entry.last_thread_id = Some(thread_id.clone());
                        entry.last_error = None;
                    }
                });
                emit_event(
                    &self.app,
                    "automation:run-finished",
                    json!({
                        "id": &item.id,
                        "name": &item.name,
                        "status": "completed",
                        "threadId": outcome.thread_id,
                        "error": Value::Null,
                        "finishedAt": finished_at,
                    }),
                );
            }
            Err(err) => {
                let thread_id = err.thread_id.clone();
                with_state(|state| {
                    if let Some(entry) = state.automations.get_mut(&item.id) {
                        entry.last_status = Some("failed".to_string());
                        if let Some(thread_id) = thread_id.clone() {
                            entry.last_thread_id = Some(thread_id);
                        }
                        entry.last_error = Some(err.message.clone());
                    }
                });
                emit_event(
                    &self.app,
                    "automation:run-finished",
                    json!({
                        "id": &item.id,
                        "name": &item.name,
                        "status": "failed",
                        "threadId": err.thread_id,
                        "error": err.message,
                        "finishedAt": finished_at,
                    }),
                );
            }
        }
    }
}

fn recover_interrupted_runs() {
    with_state(|state| {
        for entry in state.automations.values_mut() {
            if entry.last_status.as_deref() == Some("running") {
                entry.last_status = Some("failed".to_string());
                entry.last_error =
                    Some("scheduler stopped while this run was in progress".to_string());
            }
        }
    });
}

fn delete_orphaned_state(items: &[AutomationItem]) {
    if items.is_empty() {
        with_state(|state| state.automations.clear());
    }
}

/* ------------------------------------------------------------------ */
/* Commands / public helpers used by lib.rs                            */
/* ------------------------------------------------------------------ */

/// JSON payload for `automations_scheduler_status`.
pub fn scheduler_status() -> Value {
    let now = now_ms();
    let state = read_state();
    let items = config_skills::list_automations();
    let entries: Vec<Value> = items
        .iter()
        .map(|item| {
            let entry = state.automations.get(&item.id);
            let last_error = entry.and_then(|entry| {
                entry
                    .last_error
                    .clone()
                    .or_else(|| entry.schedule_warning.clone())
            });
            json!({
                "id": &item.id,
                "name": &item.name,
                "status": &item.status,
                "rrule": &item.rrule,
                "executionEnvironment": &item.execution_environment,
                "lastRunAt": entry.and_then(|entry| entry.last_run_at),
                "nextRunAt": entry.and_then(|entry| entry.next_run_at),
                "lastStatus": entry.and_then(|entry| entry.last_status.clone()),
                "lastThreadId": entry.and_then(|entry| entry.last_thread_id.clone()),
                "lastError": last_error,
                "runCount": entry.map(|entry| entry.run_count).unwrap_or(0),
            })
        })
        .collect();

    json!({
        "running": STARTED.load(Ordering::SeqCst),
        "now": now,
        "stateUpdatedAt": state.updated_at,
        "entries": entries,
    })
}

/// Recompute `next_run_at` for every automation (called after an automation was
/// created/edited/deleted from the UI). Returns the fresh status payload.
pub fn refresh_schedule() -> Value {
    let items = config_skills::list_automations();
    let now = now_ms();
    let salt = read_jitter_salt();
    let known_ids: HashSet<String> = items.iter().map(|item| item.id.clone()).collect();

    with_state(|state| {
        state.automations.retain(|id, _| known_ids.contains(id));
        for item in &items {
            prepare_item(state, item, now, &salt, true);
        }
    });

    scheduler_status()
}

/// Execute an automation immediately (manual "Run now").
pub async fn run_now(app: AppHandle, id: String) -> Result<Value, String> {
    let item = config_skills::list_automations()
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| format!("automation `{id}` not found"))?;

    if !item.execution_environment.eq_ignore_ascii_case("local") {
        return Err(format!(
            "automation `{}` uses execution_environment `{}`; only local automations can run here",
            item.name, item.execution_environment
        ));
    }
    if item.cwds.iter().all(|cwd| cwd.trim().is_empty()) {
        return Err(format!("automation `{}` has no cwd", item.name));
    }

    let now = now_ms();
    // Persist "running" before the app-server round-trips so the UI sees the
    // state and the periodic scan does not run the same automation again.
    with_state(|state| {
        let entry = state.automations.entry(item.id.clone()).or_default();
        if entry.anchor_at.is_none() {
            entry.anchor_at = Some(baseline_ms(&item));
        }
        entry.config_signature = Some(schedule_signature(&item));
        entry.last_run_at = Some(now);
        entry.last_status = Some("running".to_string());
        entry.last_error = None;
        entry.run_count = entry.run_count.saturating_add(1);
        if let Ok(rule) = Rrule::parse(&item.rrule) {
            let anchor_ms = entry.anchor_at.unwrap_or_else(|| baseline_ms(&item));
            entry.next_run_at = compute_next_run_ms(&rule, anchor_ms, now);
        }
    });

    emit_event(
        &app,
        "automation:run-started",
        json!({ "id": &item.id, "name": &item.name, "at": now }),
    );

    let result = execute_automation(&app, &item).await;
    let finished_at = now_ms();

    match result {
        Ok(outcome) => {
            let thread_id = outcome.thread_id.clone();
            with_state(|state| {
                if let Some(entry) = state.automations.get_mut(&item.id) {
                    entry.last_status = Some("completed".to_string());
                    entry.last_thread_id = Some(thread_id.clone());
                    entry.last_error = None;
                }
            });
            emit_event(
                &app,
                "automation:run-finished",
                json!({
                    "id": &item.id,
                    "name": &item.name,
                    "status": "completed",
                    "threadId": outcome.thread_id,
                    "error": Value::Null,
                    "finishedAt": finished_at,
                }),
            );
            Ok(json!({
                "threadId": outcome.thread_id,
                "turnId": outcome.turn_id,
                "status": "completed",
            }))
        }
        Err(err) => {
            let thread_id = err.thread_id.clone();
            with_state(|state| {
                if let Some(entry) = state.automations.get_mut(&item.id) {
                    entry.last_status = Some("failed".to_string());
                    if let Some(thread_id) = thread_id {
                        entry.last_thread_id = Some(thread_id);
                    }
                    entry.last_error = Some(err.message.clone());
                }
            });
            emit_event(
                &app,
                "automation:run-finished",
                json!({
                    "id": &item.id,
                    "name": &item.name,
                    "status": "failed",
                    "threadId": err.thread_id,
                    "error": err.message,
                    "finishedAt": finished_at,
                }),
            );
            Err(err.message)
        }
    }
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;

    fn dt(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(year, month, day)
            .unwrap()
            .and_hms_opt(hour, minute, 0)
            .unwrap()
    }

    fn next(rrule: &str, anchor: NaiveDateTime, after: NaiveDateTime) -> NaiveDateTime {
        let rule = Rrule::parse(rrule).expect("RRULE should parse");
        next_occurrence_naive(&rule, anchor, after).expect("RRULE should have a next occurrence")
    }

    #[test]
    fn hourly_interval_keeps_anchor_minute() {
        let anchor = dt(2026, 1, 1, 9, 10);
        assert_eq!(
            next("RRULE:FREQ=HOURLY;INTERVAL=2", anchor, anchor),
            dt(2026, 1, 1, 11, 10)
        );
        assert_eq!(
            next("RRULE:FREQ=HOURLY;INTERVAL=2", anchor, dt(2026, 1, 1, 11, 10)),
            dt(2026, 1, 1, 13, 10)
        );
    }

    #[test]
    fn hourly_with_byhour_and_byminute() {
        let anchor = dt(2026, 1, 1, 8, 30);
        let rule = "RRULE:FREQ=HOURLY;BYHOUR=9;BYMINUTE=0";
        assert_eq!(
            next(rule, anchor, dt(2026, 1, 1, 10, 0)),
            dt(2026, 1, 2, 9, 0)
        );
        assert_eq!(
            next(rule, anchor, dt(2026, 1, 2, 9, 0)),
            dt(2026, 1, 3, 9, 0)
        );
    }

    #[test]
    fn daily_prefers_next_day_when_time_has_passed() {
        let anchor = dt(2026, 1, 1, 9, 0);
        let rule = "FREQ=DAILY;BYHOUR=9;BYMINUTE=0";
        assert_eq!(
            next(rule, anchor, dt(2026, 1, 1, 9, 0)),
            dt(2026, 1, 2, 9, 0)
        );
        assert_eq!(
            next(rule, anchor, dt(2026, 1, 2, 8, 0)),
            dt(2026, 1, 2, 9, 0)
        );
    }

    #[test]
    fn weekly_by_day_weekdays() {
        // 2026-01-07 is a Wednesday.
        let anchor = dt(2026, 1, 7, 9, 0);
        let rule = "FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=10;BYMINUTE=0";
        assert_eq!(
            next(rule, anchor, dt(2026, 1, 7, 11, 0)),
            dt(2026, 1, 9, 10, 0)
        );
        assert_eq!(
            next(rule, anchor, dt(2026, 1, 9, 10, 0)),
            dt(2026, 1, 12, 10, 0)
        );
    }

    #[test]
    fn weekly_interval_two_weeks() {
        // 2026-01-05 is a Monday.
        let anchor = dt(2026, 1, 5, 9, 0);
        let rule = "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=9;BYMINUTE=0";
        assert_eq!(
            next(rule, anchor, dt(2026, 1, 5, 10, 0)),
            dt(2026, 1, 19, 9, 0)
        );
        assert_eq!(
            next(rule, anchor, dt(2026, 1, 19, 8, 0)),
            dt(2026, 1, 19, 9, 0)
        );
    }

    #[test]
    fn monthly_by_month_day() {
        let anchor = dt(2026, 1, 15, 9, 0);
        let rule = "FREQ=MONTHLY;BYMONTHDAY=15;BYHOUR=9;BYMINUTE=0";
        assert_eq!(
            next(rule, anchor, dt(2026, 1, 20, 0, 0)),
            dt(2026, 2, 15, 9, 0)
        );
        assert_eq!(
            next(rule, anchor, dt(2026, 2, 15, 8, 0)),
            dt(2026, 2, 15, 9, 0)
        );
    }

    #[test]
    fn monthly_day_31_skips_short_months() {
        let anchor = dt(2026, 1, 31, 9, 0);
        let rule = "FREQ=MONTHLY;BYHOUR=9;BYMINUTE=0";
        assert_eq!(
            next(rule, anchor, dt(2026, 2, 1, 0, 0)),
            dt(2026, 3, 31, 9, 0)
        );
    }

    #[test]
    fn monthly_negative_month_day() {
        let anchor = dt(2026, 1, 31, 9, 0);
        let rule = "FREQ=MONTHLY;BYMONTHDAY=-1;BYHOUR=9;BYMINUTE=0";
        assert_eq!(
            next(rule, anchor, dt(2026, 1, 1, 0, 0)),
            dt(2026, 1, 31, 9, 0)
        );
        assert_eq!(
            next(rule, anchor, dt(2026, 1, 31, 9, 0)),
            dt(2026, 2, 28, 9, 0)
        );
    }

    #[test]
    fn yearly_keeps_anchor_month_and_day() {
        let anchor = dt(2026, 6, 1, 9, 0);
        let rule = "FREQ=YEARLY;BYHOUR=9;BYMINUTE=0";
        assert_eq!(
            next(rule, anchor, dt(2026, 7, 1, 0, 0)),
            dt(2027, 6, 1, 9, 0)
        );
    }

    #[test]
    fn parser_accepts_rrule_prefix_and_wkst() {
        let rule = Rrule::parse("RRULE:FREQ=WEEKLY;WKST=SU;BYDAY=MO,WE;BYHOUR=10;BYMINUTE=0")
            .expect("rule should parse");
        assert_eq!(rule.freq, Freq::Weekly);
        assert_eq!(rule.interval, 1);
        assert_eq!(rule.week_start, Weekday::Sun);
        assert_eq!(rule.by_day, vec![Weekday::Mon, Weekday::Wed]);
    }

    #[test]
    fn parser_rejects_unsupported_rules() {
        assert!(Rrule::parse("FREQ=SECONDLY").is_err());
        assert!(Rrule::parse("FREQ=DAILY;BYMONTH=1").is_err());
        assert!(Rrule::parse("FREQ=DAILY;INTERVAL=0").is_err());
        assert!(Rrule::parse("BYHOUR=9").is_err());
        assert!(Rrule::parse("").is_err());
    }

    #[test]
    fn jitter_is_stable_and_bounded() {
        let salt = b"some-salt-value";
        assert_eq!(jitter_ms("automation-a", salt), jitter_ms("automation-a", salt));
        assert!(jitter_ms("automation-a", salt) <= MAX_JITTER_SECS * 1000);
        assert!(jitter_ms("automation-a", salt) < 61_000);
    }

    #[test]
    fn next_occurrence_is_strictly_after() {
        let anchor = dt(2026, 1, 1, 9, 0);
        let rule = Rrule::parse("FREQ=DAILY;BYHOUR=9;BYMINUTE=0").unwrap();
        let after = dt(2026, 1, 3, 9, 0);
        let candidate = next_occurrence_naive(&rule, anchor, after).unwrap();
        assert!(candidate > after);
        assert_eq!(candidate, dt(2026, 1, 4, 9, 0));
    }

    #[test]
    fn compute_next_run_ms_round_trips_local_time() {
        let anchor = dt(2026, 1, 1, 9, 0);
        let anchor_ms = ms_from_datetime(anchor).expect("anchor local time exists");
        let after_ms = ms_from_datetime(dt(2026, 1, 1, 10, 0)).expect("after local time exists");
        let rule = Rrule::parse("FREQ=DAILY;BYHOUR=9;BYMINUTE=0").unwrap();
        let next_ms = compute_next_run_ms(&rule, anchor_ms, after_ms).expect("next run exists");
        assert!(next_ms > after_ms);
        let next_local = datetime_from_ms(next_ms);
        assert_eq!((next_local.hour(), next_local.minute()), (9, 0));
        assert_eq!(next_local.date(), NaiveDate::from_ymd_opt(2026, 1, 2).unwrap());
    }

    fn test_automation(
        id: &str,
        rrule: &str,
        status: &str,
        environment: &str,
        cwds: Vec<String>,
        updated_at: u64,
    ) -> AutomationItem {
        AutomationItem {
            id: id.to_string(),
            kind: "cron".to_string(),
            name: format!("automation {id}"),
            prompt: "do the thing".to_string(),
            status: status.to_string(),
            rrule: rrule.to_string(),
            cwds,
            execution_environment: environment.to_string(),
            model: None,
            reasoning_effort: None,
            target_thread_id: None,
            created_at: updated_at,
            updated_at,
        }
    }

    #[test]
    fn first_observation_schedules_into_the_future() {
        let now = now_ms();
        let item = test_automation(
            "auto-1",
            "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
            "ACTIVE",
            "local",
            vec!["D:\\work".to_string()],
            now.saturating_sub(86_400_000),
        );
        let mut state = SchedulerState::default();
        let due = prepare_item(&mut state, &item, now, b"salt", false);

        assert!(!due, "a never-seen automation must not run at startup");
        let entry = state.automations.get("auto-1").expect("state entry created");
        let next_run_at = entry.next_run_at.expect("next run scheduled");
        assert!(next_run_at > now);
        assert_eq!(entry.run_count, 0);
        assert!(entry.last_run_at.is_none());
        assert!(entry.last_status.is_none());
        assert!(entry.schedule_warning.is_none());
    }

    #[test]
    fn due_automation_is_marked_running_and_rescheduled() {
        let now = now_ms();
        let salt = b"salt";
        let item = test_automation(
            "auto-2",
            "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
            "ACTIVE",
            "local",
            vec!["D:\\work".to_string()],
            now.saturating_sub(3 * 86_400_000),
        );
        let mut state = SchedulerState::default();
        let mut entry = AutomationScheduleState::default();
        entry.config_signature = Some(schedule_signature(&item));
        entry.anchor_at = Some(item.updated_at);
        entry.next_run_at = Some(now.saturating_sub(jitter_ms(&item.id, salt) + 1));
        state.automations.insert(item.id.clone(), entry);

        let due = prepare_item(&mut state, &item, now, salt, false);

        assert!(due, "a past due automation must execute");
        let entry = state.automations.get("auto-2").expect("state entry");
        assert_eq!(entry.last_status.as_deref(), Some("running"));
        assert_eq!(entry.last_run_at, Some(now));
        assert_eq!(entry.run_count, 1);
        assert!(entry.next_run_at.expect("rescheduled") > now);
    }

    #[test]
    fn paused_and_non_local_automations_are_not_scheduled() {
        let now = now_ms();
        let mut state = SchedulerState::default();

        let paused = test_automation(
            "paused-1",
            "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
            "PAUSED",
            "local",
            vec!["D:\\work".to_string()],
            now.saturating_sub(86_400_000),
        );
        assert!(!prepare_item(&mut state, &paused, now, b"salt", false));
        let paused_entry = state.automations.get("paused-1").unwrap();
        assert!(paused_entry.next_run_at.is_none());

        let remote = test_automation(
            "remote-1",
            "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
            "ACTIVE",
            "worktree",
            vec!["D:\\work".to_string()],
            now.saturating_sub(86_400_000),
        );
        assert!(!prepare_item(&mut state, &remote, now, b"salt", false));
        let remote_entry = state.automations.get("remote-1").unwrap();
        assert!(remote_entry.next_run_at.is_none());
        assert!(remote_entry
            .schedule_warning
            .as_deref()
            .unwrap_or_default()
            .contains("not local"));

        let unsupported = test_automation(
            "bad-rule-1",
            "FREQ=SECONDLY",
            "ACTIVE",
            "local",
            vec!["D:\\work".to_string()],
            now.saturating_sub(86_400_000),
        );
        assert!(!prepare_item(&mut state, &unsupported, now, b"salt", false));
        let bad_rule_entry = state.automations.get("bad-rule-1").unwrap();
        assert!(bad_rule_entry.next_run_at.is_none());
        assert!(bad_rule_entry
            .schedule_warning
            .as_deref()
            .unwrap_or_default()
            .contains("unsupported RRULE"));
    }
}

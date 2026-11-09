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
//! * when due, starts a real app-server turn, in the linked thread for
//!   a heartbeat or in a new thread for a standalone task, and emits `automation:run-started` /
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
use tauri::{AppHandle, Emitter, Listener, Manager};
use tokio::sync::mpsc;

/// Delay before the very first scan, giving the app-server connection a head start.
const INITIAL_SCAN_DELAY: StdDuration = StdDuration::from_secs(5);
/// How often automations are re-evaluated.
const SCAN_INTERVAL: StdDuration = StdDuration::from_secs(30);
/// Maximum stable jitter (in seconds) added on top of a scheduled occurrence.
const MAX_JITTER_SECS: u64 = 60;
/// Version of the on-disk scheduler state file.
const STATE_VERSION: u32 = 2;
const ACTIVITY_RUN_LIMIT: usize = 200;
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
    if let Some(once_at) = rule.once_at {
        return (once_at > after_ms).then_some(once_at);
    }
    if rule.freq == Freq::Minutely {
        return after_ms.checked_add(u64::from(rule.interval) * 60_000);
    }
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
    Minutely,
    Hourly,
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

/// Supported subset of RFC 5545 RRULE:
/// `FREQ=HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY`, `INTERVAL`, `BYHOUR`,
/// `BYMINUTE`, `BYDAY`, `BYMONTHDAY` (positive and negative days) and `WKST`.
/// Linked heartbeats additionally support `MINUTELY` with only `INTERVAL`.
/// Cron tasks may use a UTC DTSTART and a single daily COUNT=1.
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
    once_at: Option<u64>,
}

impl Rrule {
    fn for_item(item: &AutomationItem) -> Result<Self, String> {
        let rule = Self::parse(&item.rrule)?;
        if rule.freq == Freq::Minutely && linked_heartbeat_target(item).is_none() {
            return Err("MINUTELY requires a linked heartbeat thread".into());
        }
        if rule.once_at.is_some() && !item.kind.eq_ignore_ascii_case("cron") {
            return Err("UTC COUNT=1 requires a cron task".into());
        }
        Ok(rule)
    }

    fn parse(raw: &str) -> Result<Self, String> {
        let normalized = raw.trim().to_ascii_uppercase();
        let (body, once_at) = if let Some(start) = normalized.strip_prefix("DTSTART:") {
            let (timestamp, rule) = start.split_once('\n').ok_or("DTSTART requires a separate RRULE")?;
            if !matches!(rule, "RRULE:FREQ=DAILY;COUNT=1" | "RRULE:COUNT=1;FREQ=DAILY") {
                return Err("only a single daily COUNT=1 rule can use UTC DTSTART".into());
            }
            let timestamp = timestamp.trim_end_matches('\r');
            if timestamp.len() != 16 {
                return Err("DTSTART must be a UTC timestamp".into());
            }
            let date = NaiveDateTime::parse_from_str(timestamp, "%Y%m%dT%H%M%SZ")
                .map_err(|_| "DTSTART must be a UTC timestamp")?;
            if date.nanosecond() != 0 || date.format("%Y%m%dT%H%M%SZ").to_string() != timestamp {
                return Err("DTSTART must use the exact UTC timestamp format without leap seconds".into());
            }
            let at = u64::try_from(date.and_utc().timestamp_millis()).map_err(|_| "DTSTART predates the Unix epoch")?;
            ("FREQ=DAILY", Some(at))
        } else {
            (normalized.strip_prefix("RRULE:").unwrap_or(&normalized), None)
        };
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
        let mut minute_fields = HashSet::new();
        let mut minute_rule_is_simple = true;

        for part in body.split(';').map(str::trim).filter(|part| !part.is_empty()) {
            let (key, value) = part
                .split_once('=')
                .ok_or_else(|| format!("malformed RRULE part `{part}`"))?;
            let key = key.trim();
            let value = value.trim();
            minute_rule_is_simple &= matches!(key, "FREQ" | "INTERVAL") && minute_fields.insert(key);
            match key {
                "FREQ" => {
                    freq = Some(match value {
                        "MINUTELY" => Freq::Minutely,
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
        if freq == Freq::Minutely && !minute_rule_is_simple {
            return Err("MINUTELY accepts only FREQ and INTERVAL".into());
        }
        Ok(Rrule {
            freq,
            interval,
            by_hour,
            by_minute,
            by_day,
            by_month_day,
            week_start,
            once_at,
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
        Freq::Minutely => None,
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
    (schedule_hash(salt.iter().chain(id.as_bytes())) % (MAX_JITTER_SECS + 1)) * 1000
}

fn schedule_hash<'a>(bytes: impl IntoIterator<Item = &'a u8>) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn next_scheduled_at(rule: &Rrule, item: &AutomationItem, anchor: u64, now: u64, salt: &[u8]) -> Option<u64> {
    let next = compute_next_run_ms(rule, anchor, now)?;
    if rule.freq != Freq::Minutely || rule.interval < 60 {
        return Some(next);
    }
    // Longer heartbeat intervals jitter around the nominal time. The persisted
    // next time already includes this offset, so the claim adds no second jitter.
    let nominal = next.to_le_bytes();
    let offset = (schedule_hash(salt.iter().chain(item.id.as_bytes()).chain(&nominal)) % 601) as i64 - 300;
    next.checked_add_signed(offset * 1000)
}

/* ------------------------------------------------------------------ */
/* Scheduler state file                                                */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct AutomationScheduleState {
    last_run_at: Option<u64>,
    last_finished_at: Option<u64>,
    next_run_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    consumed_once_at: Option<u64>,
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
    activity_runs: Vec<ActivityRunIdentity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivityRunIdentity {
    automation_id: String,
    started_at: u64,
    thread_id: String,
}

impl Default for SchedulerState {
    fn default() -> Self {
        Self {
            version: STATE_VERSION,
            updated_at: 0,
            automations: BTreeMap::new(),
            activity_runs: Vec::new(),
        }
    }
}

impl SchedulerState {
    fn record_activity_run(&mut self, automation_id: &str, started_at: u64, thread_id: &str) {
        if thread_id.trim().is_empty() {
            return;
        }
        if self.activity_runs.iter()
            .any(|run| run.automation_id == automation_id && run.started_at == started_at)
        {
            return;
        }
        self.activity_runs.push(ActivityRunIdentity {
            automation_id: automation_id.to_owned(),
            started_at,
            thread_id: thread_id.to_owned(),
        });
        self.activity_runs.sort_by(|a, b| b.started_at.cmp(&a.started_at).then_with(|| a.automation_id.cmp(&b.automation_id)));
        self.activity_runs.truncate(ACTIVITY_RUN_LIMIT);
    }

    fn import_legacy_activity_runs(&mut self) {
        if self.version >= 2 {
            return;
        }
        let known: Vec<_> = self.automations.iter().filter_map(|(id, entry)| {
            Some((id.clone(), entry.last_run_at?, entry.last_thread_id.clone()?))
        }).collect();
        for (id, started_at, thread_id) in known {
            self.record_activity_run(&id, started_at, &thread_id);
        }
    }

    fn activity_thread_ids(&self, automation_ids: &HashSet<&str>) -> Vec<&str> {
        let mut seen = HashSet::new();
        self.activity_runs.iter()
            .filter(|run| automation_ids.contains(run.automation_id.as_str()))
            .filter_map(|run| seen.insert(run.thread_id.as_str()).then_some(run.thread_id.as_str()))
            .collect()
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
        Ok(mut state) => {
            if state.version > STATE_VERSION {
                eprintln!(
                    "[automations] scheduler state version {} is newer than {}; ignoring unknown fields",
                    state.version, STATE_VERSION
                );
            }
            state.import_legacy_activity_runs();
            state
        }
        Err(err) => {
            eprintln!("[automations] failed to parse scheduler state: {err}");
            SchedulerState::default()
        }
    }
}

/// Persist state before acknowledging a run claim or terminal transition.
fn persist_state(state: &mut SchedulerState) -> Result<(), String> {
    persist_state_at(state, &scheduler_state_path())
}

fn persist_state_at(state: &mut SchedulerState, path: &std::path::Path) -> Result<(), String> {
    state.version = STATE_VERSION;
    state.updated_at = now_ms();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let serialized = serde_json::to_vec_pretty(state).map_err(|error| error.to_string())?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, serialized).map_err(|error| error.to_string())?;
    fs::rename(&temp_path, &path).map_err(|error| error.to_string())
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

fn mutate_state<T>(mutate: impl FnOnce(&mut SchedulerState) -> T) -> (T, Result<(), String>) {
    let _guard = STATE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = load_state();
    let before = serde_json::to_string(&state).unwrap_or_default();
    let result = mutate(&mut state);
    let after = serde_json::to_string(&state).unwrap_or_default();
    let persisted = if before != after { persist_state(&mut state) } else { Ok(()) };
    (result, persisted)
}

fn with_state<T>(mutate: impl FnOnce(&mut SchedulerState) -> T) -> T {
    let (result, persisted) = mutate_state(mutate);
    if let Err(error) = persisted { eprintln!("[automations] state persistence failed: {error}"); }
    result
}

fn try_with_state<T>(mutate: impl FnOnce(&mut SchedulerState) -> T) -> Result<T, String> {
    let (result, persisted) = mutate_state(mutate);
    persisted?;
    Ok(result)
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
    if item.kind.eq_ignore_ascii_case("cron") && item.rrule.contains('\n') {
        if let Ok(Rrule { once_at: Some(at), .. }) = Rrule::for_item(item) {
            return format!("once|{at}|{}", item.execution_environment.to_ascii_lowercase());
        }
    }
    if let Some(target) = linked_heartbeat_target(item) {
        if let Ok(Rrule { freq: Freq::Minutely, interval, .. }) = Rrule::parse(&item.rrule) {
            return format!("minute|{}|{}|{}", target, item.execution_environment, interval);
        }
    }
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

fn linked_heartbeat_target(item: &AutomationItem) -> Option<&str> {
    if !item.kind.eq_ignore_ascii_case("heartbeat") {
        return None;
    }
    item.target_thread_id.as_deref().map(str::trim).filter(|id| !id.is_empty())
}

pub(crate) fn validate_linked_schedule(item: &AutomationItem) -> Result<(), String> {
    Rrule::for_item(item).map(|_| ())
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

    if item.kind.eq_ignore_ascii_case("heartbeat") && linked_heartbeat_target(item).is_none() {
        entry.next_run_at = None;
        note_schedule_warning(entry, item, "heartbeat has no linked thread; skipped".into());
        return false;
    }

    if linked_heartbeat_target(item).is_none() && item.cwds.iter().all(|cwd| cwd.trim().is_empty()) {
        entry.next_run_at = None;
        note_schedule_warning(entry, item, "automation has no cwd; skipped".to_string());
        return false;
    }

    let rule = match Rrule::for_item(item) {
        Ok(rule) => rule,
        Err(err) => {
            entry.next_run_at = None;
            note_schedule_warning(entry, item, format!("unsupported RRULE: {err}"));
            return false;
        }
    };
    entry.schedule_warning = None;
    if matches!(entry.last_status.as_deref(), Some("running" | "unknown")) {
        return false;
    }

    let anchor_ms = entry.anchor_at.unwrap_or_else(|| baseline_ms(item));
    let minute_heartbeat = rule.freq == Freq::Minutely;
    let one_shot = rule.once_at.is_some();
    if one_shot && entry.consumed_once_at == rule.once_at {
        entry.next_run_at = None;
        return false;
    }
    if (force_reschedule && !minute_heartbeat && !one_shot) || signature_changed || entry.next_run_at.is_none() {
        // Always move forward from "now": a newly discovered automation should
        // not fire immediately for occurrences that were missed while the app
        // was not running.
        entry.next_run_at = next_scheduled_at(&rule, item, anchor_ms, now, salt);
        if entry.next_run_at.is_none() && !one_shot {
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
    let jitter = if minute_heartbeat || one_shot { 0 } else { jitter_ms(&item.id, salt) };
    if force_reschedule || now < next_run_at.saturating_add(jitter) {
        return false;
    }

    // Mark the run before executing it.
    entry.last_run_at = Some(now);
    entry.last_finished_at = None;
    entry.last_status = Some("running".to_string());
    entry.last_error = None;
    entry.run_count = entry.run_count.saturating_add(1);
    if one_shot {
        entry.consumed_once_at = rule.once_at;
    }
    entry.next_run_at = next_scheduled_at(&rule, item, anchor_ms, now, salt);
    true
}

/* ------------------------------------------------------------------ */
/* Execution against the app-server                                    */
/* ------------------------------------------------------------------ */

struct RunOutcome {
    thread_id: String,
    turn_id: String,
    watch: CompletionWatch,
}

struct CompletionWatch {
    app: AppHandle,
    listeners: [tauri::EventId; 2],
    receiver: mpsc::UnboundedReceiver<Value>,
}

impl CompletionWatch {
    fn new(app: &AppHandle, thread_id: &str) -> Self {
        let (sender, receiver) = mpsc::unbounded_channel();
        let thread_id = thread_id.to_string();
        let notifications = sender.clone();
        let notification = app.listen("app-server:notification", move |event| {
            if let Ok(value) = serde_json::from_str::<Value>(event.payload()) {
                if value["method"] == "turn/completed" &&
                    value["params"]["threadId"].as_str() == Some(thread_id.as_str()) {
                    let _ = notifications.send(value);
                }
            }
        });
        let status = app.listen("app-server:status", move |event| {
            if let Ok(value) = serde_json::from_str::<Value>(event.payload()) {
                if value["connected"] == false {
                    let _ = sender.send(json!({"method": "$connection/closed"}));
                }
            }
        });
        Self { app: app.clone(), listeners: [notification, status], receiver }
    }
}

impl Drop for CompletionWatch {
    fn drop(&mut self) {
        for id in self.listeners { self.app.unlisten(id); }
    }
}

#[derive(Debug, PartialEq)]
struct RunTerminal {
    status: &'static str,
    error: Option<String>,
}

async fn wait_turn_terminal(
    receiver: &mut mpsc::UnboundedReceiver<Value>,
    thread_id: &str,
    turn_id: &str,
) -> RunTerminal {
    while let Some(value) = receiver.recv().await {
        if value["method"] == "$connection/closed" { break; }
        if value["method"] != "turn/completed" ||
            value["params"]["threadId"].as_str() != Some(thread_id) ||
            value["params"]["turn"]["id"].as_str() != Some(turn_id) {
            continue;
        }
        let turn = &value["params"]["turn"];
        let status = match turn["status"].as_str() {
            Some("completed") => "completed",
            Some("failed") => "failed",
            Some("interrupted") => "interrupted",
            _ => continue,
        };
        return RunTerminal {
            status,
            error: turn["error"]["message"].as_str().map(str::to_string),
        };
    }
    RunTerminal {
        status: "unknown",
        error: Some("app-server连接中断，任务执行结果未知；请打开会话核对".into()),
    }
}

struct ExecutionError {
    message: String,
    thread_id: Option<String>,
    uncertain: bool,
}

impl ExecutionError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            thread_id: None,
            uncertain: false,
        }
    }
}

fn emit_event(app: &AppHandle, event: &str, payload: Value) {
    if let Err(err) = app.emit(event, payload) {
        eprintln!("[automations] failed to emit `{event}`: {err}");
    }
}

async fn prepare_heartbeat_thread<F, R>(thread_id: &str, mut call: F) -> Result<(), String>
where
    F: FnMut(&'static str, Value) -> R,
    R: std::future::Future<Output = Result<Value, String>>,
{
    let mut response = call("thread/read", json!({"threadId":thread_id,"includeTurns":false})).await?;
    if response["thread"]["id"].as_str() != Some(thread_id) {
        return Err("会话身份不匹配，未运行定时任务".into());
    }
    if response["thread"]["status"]["type"] == "notLoaded" {
        response = call("thread/resume", json!({"threadId":thread_id,"excludeTurns":true})).await?;
    }
    let thread = &response["thread"];
    if thread["id"].as_str() != Some(thread_id) || thread["status"]["type"] != "idle" {
        return Err("关联会话正在执行或不可用，未运行定时任务".into());
    }
    if !thread["environments"].as_array().is_some_and(|environments| {
        !environments.is_empty() && environments.iter().all(|env| env["environmentId"] == "local")
    }) {
        return Err("无法确认关联会话的本地执行环境，未运行定时任务".into());
    }
    Ok(())
}

async fn execute_automation(
    app: &AppHandle,
    item: &AutomationItem,
) -> Result<RunOutcome, ExecutionError> {
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

    let thread_id = if let Some(target) = linked_heartbeat_target(item) {
        prepare_heartbeat_thread(target, |method, params| manager.call(app, method, Some(params)))
            .await.map_err(ExecutionError::new)?;
        // Recheck the task after the RPCs so a pause or a reassignment during
        // cold resume does not send the original prompt into the old thread.
        if !config_skills::list_automations().iter().any(|current| {
            current.id == item.id && linked_heartbeat_target(current) == Some(target) &&
                current.status == item.status && current.rrule == item.rrule &&
                current.execution_environment == item.execution_environment &&
                current.prompt == item.prompt && current.model == item.model &&
                current.reasoning_effort == item.reasoning_effort
        }) {
            return Err(ExecutionError::new("任务在准备期间发生变化，未运行定时任务"));
        }
        target.to_owned()
    } else {
        if item.kind.eq_ignore_ascii_case("heartbeat") {
            return Err(ExecutionError::new("定时任务没有关联聊天"));
        }
        let cwd = item.cwds.iter().map(|cwd| cwd.trim()).find(|cwd| !cwd.is_empty())
            .ok_or_else(|| ExecutionError::new("automation has no cwd"))?;
        let mut thread_params = json!({
            "cwd": cwd,
            "approvalPolicy": "never",
            "sandbox": "workspace-write",
        });
        if let Some(model) = item.model.as_deref().map(str::trim).filter(|model| !model.is_empty()) {
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
            .ok_or_else(|| ExecutionError::new("thread/start response did not contain a thread id"))?;

        let state = app.state::<AppState>();
        state.desktop_state.record_thread_workspace(&thread_id, cwd);
        thread_id
    };

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

    // Subscribe before turn/start: completion can precede its RPC response.
    let watch = CompletionWatch::new(app, &thread_id);
    let turn_response = manager
        .call(app, "turn/start", Some(turn_params))
        .await
        .map_err(|err| ExecutionError {
            message: format!("turn/start failed: {err}"),
            thread_id: Some(thread_id.clone()),
            uncertain: true,
        })?;
    let turn_id = turn_response
        .get("turn")
        .and_then(|turn| turn.get("id"))
        .and_then(Value::as_str)
        .or_else(|| turn_response.get("turnId").and_then(Value::as_str))
        .map(str::to_string)
        .ok_or_else(|| ExecutionError {
            message: "turn/start response did not contain a turn id; execution outcome unknown".into(),
            thread_id: Some(thread_id.clone()),
            uncertain: true,
        })?;

    Ok(RunOutcome { thread_id, turn_id, watch })
}

async fn finish_run(
    app: &AppHandle, item: &AutomationItem, started_at: u64,
    thread_id: Option<String>, terminal: RunTerminal,
) {
    let finished_at = now_ms();
    let mut storage_error_reported = false;
    loop {
        let changed = try_with_state(|state| {
            let Some(entry) = state.automations.get_mut(&item.id) else { return false };
            if entry.last_run_at != Some(started_at) || entry.last_status.as_deref() != Some("running") {
                return false;
            }
            entry.last_status = Some(terminal.status.into());
            entry.last_finished_at = Some(finished_at);
            entry.last_thread_id = thread_id.clone();
            entry.last_error = terminal.error.clone();
            if let Some(thread_id) = thread_id.as_deref() {
                state.record_activity_run(&item.id, started_at, thread_id);
            }
            true
        });
        match changed {
            Ok(true) => {
                emit_event(app, "automation:run-finished", json!({
                    "id": item.id, "name": item.name, "status": terminal.status,
                    "threadId": thread_id, "error": terminal.error,
                    "startedAt": started_at, "finishedAt": finished_at,
                }));
                return;
            }
            Ok(false) => return,
            Err(error) => {
                if !storage_error_reported {
                    emit_event(app, "automation:storage-error", json!({
                        "id": item.id, "name": item.name,
                        "error": format!("运行结果尚未保存：{error}；正在重试，请勿重复启动任务"),
                    }));
                    storage_error_reported = true;
                }
                tokio::time::sleep(StdDuration::from_secs(5)).await;
            }
        }
    }
}

async fn monitor_run(app: AppHandle, item: AutomationItem, started_at: u64, mut outcome: RunOutcome) {
    with_state(|state| {
        if let Some(entry) = state.automations.get_mut(&item.id) {
            if entry.last_run_at == Some(started_at) {
                entry.last_thread_id = Some(outcome.thread_id.clone());
                state.record_activity_run(&item.id, started_at, &outcome.thread_id);
            }
        }
    });
    let terminal = wait_turn_terminal(
        &mut outcome.watch.receiver, &outcome.thread_id, &outcome.turn_id,
    ).await;
    drop(outcome.watch);
    finish_run(&app, &item, started_at, Some(outcome.thread_id), terminal).await;
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

        try_with_state(|state| {
            state.automations.retain(|id, _| known_ids.contains(id));
            for item in &items {
                if prepare_item(state, item, now, &salt, false) {
                    due_items.push(item.clone());
                }
            }
        })?;

        for item in due_items {
            self.execute_due(item).await;
        }
        Ok(())
    }

    async fn execute_due(&self, item: AutomationItem) {
        let started_at = read_state().automations.get(&item.id)
            .and_then(|entry| entry.last_run_at).unwrap_or_else(now_ms);
        emit_event(
            &self.app,
            "automation:run-started",
            json!({
                "id": &item.id,
                "name": &item.name,
                "at": started_at,
            }),
        );

        match execute_automation(&self.app, &item).await {
            Ok(outcome) => {
                let app = self.app.clone();
                tauri::async_runtime::spawn(monitor_run(app, item, started_at, outcome));
            }
            Err(error) => {
                let app = self.app.clone();
                tauri::async_runtime::spawn(async move {
                    finish_run(&app, &item, started_at, error.thread_id,
                        RunTerminal { status: if error.uncertain { "unknown" } else { "failed" }, error: Some(error.message) }).await;
                });
            }
        }
    }
}

fn recover_interrupted_runs() {
    let minute_ids: HashSet<_> = config_skills::list_automations().into_iter()
        .filter(|item| Rrule::for_item(item).is_ok_and(|rule| rule.freq == Freq::Minutely))
        .map(|item| item.id).collect();
    with_state(|state| recover_scheduler_state(state, &minute_ids));
}

fn recover_scheduler_state(state: &mut SchedulerState, minute_ids: &HashSet<String>) {
    for (id, entry) in &mut state.automations {
        if entry.last_status.as_deref() == Some("running") {
            entry.last_status = Some("unknown".to_string());
            entry.last_error =
                Some("scheduler stopped while this run was in progress; execution outcome unknown".to_string());
        }
        if minute_ids.contains(id) {
            entry.next_run_at = None;
        }
    }
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
    let activity_automation_ids = items.iter().filter(|item| !item.status.eq_ignore_ascii_case("deleted"))
        .map(|item| item.id.as_str()).collect();
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
                "lastFinishedAt": entry.and_then(|entry| entry.last_finished_at),
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
        "activityThreadIds": state.activity_thread_ids(&activity_automation_ids),
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

fn claim_manual_run(state: &mut SchedulerState, item: &AutomationItem, now: u64, salt: &[u8]) -> Result<(), String> {
    let entry = state.automations.entry(item.id.clone()).or_default();
    if entry.last_status.as_deref() == Some("running") {
        return Err("该任务仍在运行，请等待真实执行结束".into());
    }
    if entry.anchor_at.is_none() {
        entry.anchor_at = Some(baseline_ms(&item));
    }
    entry.config_signature = Some(schedule_signature(&item));
    entry.last_run_at = Some(now);
    entry.last_finished_at = None;
    entry.last_status = Some("running".to_string());
    entry.last_error = None;
    entry.run_count = entry.run_count.saturating_add(1);
    if let Ok(rule) = Rrule::for_item(item) {
        let anchor_ms = entry.anchor_at.unwrap_or_else(|| baseline_ms(&item));
        entry.next_run_at = if rule.once_at.is_some() && entry.consumed_once_at == rule.once_at {
            None
        } else {
            next_scheduled_at(&rule, item, anchor_ms, now, salt)
        };
    }
    Ok(())
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
    if item.kind.eq_ignore_ascii_case("heartbeat") && linked_heartbeat_target(&item).is_none() {
        return Err("定时任务没有关联聊天".into());
    }
    if linked_heartbeat_target(&item).is_none() && item.cwds.iter().all(|cwd| cwd.trim().is_empty()) {
        return Err(format!("automation `{}` has no cwd", item.name));
    }

    let now = now_ms();
    // Persist "running" before the app-server round-trips so the UI sees the
    // state and the periodic scan does not run the same automation again.
    let salt = read_jitter_salt();
    try_with_state(|state| claim_manual_run(state, &item, now, &salt))??;

    emit_event(
        &app,
        "automation:run-started",
        json!({ "id": &item.id, "name": &item.name, "at": now }),
    );

    match execute_automation(&app, &item).await {
        Ok(outcome) => {
            let response = json!({
                "threadId": outcome.thread_id, "turnId": outcome.turn_id,
                "status": "running", "startedAt": now,
            });
            tauri::async_runtime::spawn(monitor_run(app, item, now, outcome));
            Ok(response)
        }
        Err(error) => {
            let message = error.message.clone();
            tauri::async_runtime::spawn(async move {
                finish_run(&app, &item, now, error.thread_id,
                    RunTerminal { status: if error.uncertain { "unknown" } else { "failed" }, error: Some(error.message) }).await;
            });
            Err(message)
        }
    }
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;

    fn terminal_event(thread: &str, turn: &str, status: &str) -> Value {
        json!({"method": "turn/completed", "params": {
            "threadId": thread, "turn": {"id": turn, "status": status, "error": {"message": "detail"}}
        }})
    }

    #[test]
    fn activity_run_identities_survive_restart_and_keep_multiple_threads_per_task() {
        let mut state: SchedulerState = serde_json::from_value(json!({
            "version": 1,
            "automations": {
                "repeat": {"lastRunAt": 10, "lastThreadId": "legacy"},
                "never": {"lastRunAt": 12},
            }
        })).unwrap();
        state.import_legacy_activity_runs();
        state.record_activity_run("repeat", 20, "first");
        state.record_activity_run("repeat", 20, "first");
        state.record_activity_run("repeat", 30, "second");
        state.record_activity_run("repeat", 40, "second");
        state.record_activity_run("removed", 50, "removed-thread");
        state.record_activity_run("never", 60, "");
        assert_eq!(state.activity_runs.len(), 5);
        let root = std::env::temp_dir().join(format!("codex-activity-runs-{}", uuid::Uuid::new_v4()));
        let path = root.join("scheduler-state.json");
        persist_state_at(&mut state, &path).unwrap();
        let mut restored: SchedulerState = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        restored.import_legacy_activity_runs();
        assert_eq!(restored.version, STATE_VERSION);
        assert_eq!(restored.activity_thread_ids(&HashSet::from(["repeat", "never"])), ["second", "first", "legacy"]);
        fs::remove_file(path).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn activity_run_identities_keep_latest_two_hundred_even_with_late_receipts() {
        let mut state = SchedulerState::default();
        for time in 1..=201 {
            state.record_activity_run("task", time, &format!("thread-{time}"));
        }
        state.record_activity_run("late", 0, "old");
        let ids = state.activity_thread_ids(&HashSet::from(["task", "late"]));
        assert_eq!(ids.len(), 200);
        assert_eq!(ids[0], "thread-201");
        assert_eq!(ids[199], "thread-2");
    }

    #[test]
    fn automation_completion_state_roundtrip_and_write_failure_preserves_previous_file() {
        let root = std::env::temp_dir().join(format!("codex-run-state-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let path = root.join("scheduler-state.json");
        let mut state = SchedulerState::default();
        state.automations.insert("task".into(), AutomationScheduleState {
            last_status: Some("running".into()), last_run_at: Some(100),
            ..Default::default()
        });
        persist_state_at(&mut state, &path).unwrap();
        state.automations.get_mut("task").unwrap().last_status = Some("completed".into());
        state.automations.get_mut("task").unwrap().last_finished_at = Some(200);
        persist_state_at(&mut state, &path).unwrap();
        let previous = fs::read(&path).unwrap();
        let restored: SchedulerState = serde_json::from_slice(&previous).unwrap();
        assert_eq!(restored.automations["task"].last_status.as_deref(), Some("completed"));
        assert_eq!(restored.automations["task"].last_finished_at, Some(200));
        let blocked = path.with_extension("json.tmp");
        fs::create_dir(&blocked).unwrap();
        state.automations.get_mut("task").unwrap().last_status = Some("running".into());
        assert!(persist_state_at(&mut state, &path).is_err());
        assert_eq!(fs::read(&path).unwrap(), previous);
        fs::remove_dir(&blocked).unwrap();
        fs::remove_file(&path).unwrap();
        fs::remove_dir(&root).unwrap();
    }

    #[tokio::test]
    async fn automation_completion_requires_matching_terminal_not_start_response() {
        let (sender, mut receiver) = mpsc::unbounded_channel();
        let wait = wait_turn_terminal(&mut receiver, "thread", "turn");
        tokio::pin!(wait);
        sender.send(json!({"method": "turn/started", "params": {"threadId": "thread"}})).unwrap();
        sender.send(terminal_event("other", "turn", "completed")).unwrap();
        sender.send(terminal_event("thread", "old-turn", "completed")).unwrap();
        sender.send(terminal_event("thread", "turn", "inProgress")).unwrap();
        assert!(tokio::time::timeout(StdDuration::from_millis(10), &mut wait).await.is_err());
        sender.send(terminal_event("thread", "turn", "completed")).unwrap();
        assert_eq!(wait.await.status, "completed");
    }

    #[tokio::test]
    async fn automation_completion_early_terminal_failure_interruption_and_disconnect() {
        for status in ["completed", "failed", "interrupted"] {
            let (sender, mut receiver) = mpsc::unbounded_channel();
            // Already queued before the caller can examine turn/start's response.
            sender.send(terminal_event("thread", "turn", status)).unwrap();
            let result = wait_turn_terminal(&mut receiver, "thread", "turn").await;
            assert_eq!(result.status, status);
            assert_eq!(result.error.as_deref(), Some("detail"));
        }
        let (sender, mut receiver) = mpsc::unbounded_channel();
        sender.send(json!({"method": "$connection/closed"})).unwrap();
        assert_eq!(wait_turn_terminal(&mut receiver, "thread", "turn").await.status, "unknown");
        drop(sender);
        assert_eq!(wait_turn_terminal(&mut receiver, "thread", "turn").await.status, "unknown");
    }

    #[test]
    fn automation_completion_running_run_cannot_be_scheduled_again() {
        let now = now_ms();
        let item = test_automation(
            "still-running", "FREQ=HOURLY", "ACTIVE", "local",
            vec!["D:\\work".to_string()], now.saturating_sub(86_400_000),
        );
        let mut state = SchedulerState::default();
        state.automations.insert(item.id.clone(), AutomationScheduleState {
            last_status: Some("running".into()),
            next_run_at: Some(now.saturating_sub(61_000)),
            anchor_at: Some(item.updated_at),
            config_signature: Some(schedule_signature(&item)),
            run_count: 1,
            ..Default::default()
        });
        assert!(!prepare_item(&mut state, &item, now, b"salt", false));
        assert!(claim_manual_run(&mut state, &item, now + 1, b"salt").is_err());
        assert_eq!(state.automations[&item.id].run_count, 1);
        state.automations.get_mut(&item.id).unwrap().last_status = Some("unknown".into());
        assert!(!prepare_item(&mut state, &item, now + 2, b"salt", false));
        claim_manual_run(&mut state, &item, now + 3, b"salt").unwrap();
        assert!(claim_manual_run(&mut state, &item, now + 4, b"salt").is_err());
        assert!(!prepare_item(&mut state, &item, now + 5, b"salt", false));
        assert_eq!(state.automations[&item.id].run_count, 2);
    }

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
    fn utc_once_survives_restart_then_is_consumed_without_jitter() {
        let due = 1_893_553_445_000; // 2030-01-02T03:04:05Z
        let mut item = test_automation("once", "DTSTART:20300102T030405Z\nRRULE:FREQ=DAILY;COUNT=1",
            "ACTIVE", "local", vec!["fixture".into()], due - 1_000);
        let mut state = SchedulerState::default();
        assert!(!prepare_item(&mut state, &item, due - 1, b"salt", false));
        assert_eq!(state.automations[&item.id].next_run_at, Some(due));
        let mut restarted: SchedulerState = serde_json::from_slice(&serde_json::to_vec(&state).unwrap()).unwrap();
        recover_scheduler_state(&mut restarted, &HashSet::new());
        item.prompt = "edit unrelated to the schedule".into();
        item.updated_at = due + 1;
        assert!(!prepare_item(&mut restarted, &item, due + 1, b"salt", true));
        assert_eq!(restarted.automations[&item.id].next_run_at, Some(due));
        assert!(prepare_item(&mut restarted, &item, due + 1, b"salt", false));
        let entry = restarted.automations.get_mut(&item.id).unwrap();
        assert_eq!(entry.next_run_at, None);
        assert_eq!(entry.run_count, 1);
        entry.last_status = Some("failed".into());
        let mut consumed: SchedulerState = serde_json::from_slice(&serde_json::to_vec(&restarted).unwrap()).unwrap();
        for now in [due - 10, due, due + 60_000] {
            assert!(!prepare_item(&mut consumed, &item, now, b"salt", true));
            assert!(!prepare_item(&mut consumed, &item, now, b"salt", false));
            assert_eq!(consumed.automations[&item.id].next_run_at, None);
            assert!(consumed.automations[&item.id].schedule_warning.is_none());
        }
    }

    #[test]
    fn utc_once_handles_manual_pause_and_expired_import() {
        let due = 1_893_553_445_000;
        let mut item = test_automation("once", "DTSTART:20300102T030405Z\r\nRRULE:COUNT=1;FREQ=DAILY",
            "ACTIVE", "local", vec!["fixture".into()], due - 1_000);
        let mut expired = SchedulerState::default();
        assert!(!prepare_item(&mut expired, &item, due, b"salt", false));
        assert_eq!(expired.automations[&item.id].next_run_at, None);
        assert!(expired.automations[&item.id].schedule_warning.is_none());
        let mut state = SchedulerState::default();
        claim_manual_run(&mut state, &item, due - 500, b"salt").unwrap();
        assert_eq!(state.automations[&item.id].next_run_at, Some(due));
        state.automations.get_mut(&item.id).unwrap().last_status = Some("completed".into());
        item.status = "PAUSED".into();
        assert!(!prepare_item(&mut state, &item, due - 100, b"salt", true));
        assert_eq!(state.automations[&item.id].next_run_at, None);
        item.status = "ACTIVE".into();
        assert!(!prepare_item(&mut state, &item, due - 1, b"salt", true));
        assert_eq!(state.automations[&item.id].next_run_at, Some(due));
        assert!(prepare_item(&mut state, &item, due, b"salt", false));
        assert_eq!(state.automations[&item.id].run_count, 2);
    }

    #[test]
    fn utc_once_rejects_other_rule_shapes_and_linked_heartbeats() {
        for rule in [
            "FREQ=DAILY;COUNT=1",
            "BEGIN:VEVENT\nDTSTART:20300102T030405Z\nEND:VEVENT",
            "DTSTART;TZID=America/New_York:20300102T030405\nRRULE:FREQ=DAILY;COUNT=1",
            "DTSTART:20300102T030405Z\nRRULE:FREQ=DAILY;COUNT=2",
            "DTSTART:20300102T030405Z\nRRULE:FREQ=DAILY;COUNT=1\nEXDATE:20300102T030405Z",
            "DTSTART:20300230T030405Z\nRRULE:FREQ=DAILY;COUNT=1",
        ] {
            assert!(Rrule::parse(rule).is_err(), "unexpected support for {rule}");
        }
        let mut item = test_automation("once", "DTSTART:20300102T030405Z\nRRULE:FREQ=DAILY;COUNT=1",
            "ACTIVE", "local", vec![], 1);
        item.kind = "heartbeat".into();
        item.target_thread_id = Some("linked-thread".into());
        assert!(validate_linked_schedule(&item).is_err());
    }

    #[test]
    fn linked_minute_heartbeat_keeps_its_due_time_until_claimed() {
        let now = 1_793_000_001_123;
        let mut item = test_automation("heartbeat", "RRULE:INTERVAL=2;FREQ=MINUTELY", "ACTIVE", "local", vec![], now);
        item.kind = "heartbeat".into();
        item.target_thread_id = Some("linked-thread".into());
        let mut state = SchedulerState::default();
        let due = now + 120_000;
        assert!(!prepare_item(&mut state, &item, now, b"salt", false));
        assert_eq!(state.automations[&item.id].next_run_at, Some(due));
        item.prompt = "updated without changing the schedule".into();
        item.updated_at += 1;
        assert!(!prepare_item(&mut state, &item, due, b"salt", true));
        assert_eq!(state.automations[&item.id].next_run_at, Some(due));
        assert!(prepare_item(&mut state, &item, due, b"salt", false));
        let entry = &state.automations[&item.id];
        assert_eq!(entry.next_run_at, Some(due + 120_000));
        assert_eq!(entry.run_count, 1);
        assert!(!prepare_item(&mut state, &item, due + 240_000, b"salt", false));
        state.automations.get_mut(&item.id).unwrap().last_status = Some("completed".into());
        item.status = "PAUSED".into();
        assert!(!prepare_item(&mut state, &item, due + 240_000, b"salt", false));
        assert_eq!(state.automations[&item.id].next_run_at, None);
        item.status = "ACTIVE".into();
        assert!(!prepare_item(&mut state, &item, due + 240_001, b"salt", false));
        assert_eq!(state.automations[&item.id].next_run_at, Some(due + 360_001));
    }

    #[test]
    fn minute_heartbeat_restarts_without_backfill_and_manual_run_reanchors() {
        let now = 1_793_000_001_123;
        let mut item = test_automation("minute", "FREQ=MINUTELY;INTERVAL=30", "ACTIVE", "local", vec![], now);
        item.kind = "heartbeat".into();
        item.target_thread_id = Some("linked-thread".into());
        let mut state = SchedulerState::default();
        let ids = HashSet::from([item.id.clone()]);
        prepare_item(&mut state, &item, now, b"salt", false);
        let mut restarted: SchedulerState = serde_json::from_slice(&serde_json::to_vec(&state).unwrap()).unwrap();
        let after_restart = now + 3_600_000;
        recover_scheduler_state(&mut restarted, &ids);
        assert!(!prepare_item(&mut restarted, &item, after_restart, b"salt", false));
        assert_eq!(restarted.automations[&item.id].next_run_at, Some(after_restart + 1_800_000));
        let manual = after_restart + 100;
        claim_manual_run(&mut restarted, &item, manual, b"salt").unwrap();
        assert_eq!(restarted.automations[&item.id].next_run_at, Some(manual + 1_800_000));
        recover_scheduler_state(&mut restarted, &ids);
        assert!(!prepare_item(&mut restarted, &item, manual + 3_600_000, b"salt", false));
        assert_eq!(restarted.automations[&item.id].last_status.as_deref(), Some("unknown"));
        assert_eq!(restarted.automations[&item.id].run_count, 1);
    }

    #[test]
    fn minute_rules_reject_unlinked_tasks_and_calendar_filters() {
        let now = 1_793_000_001_123;
        let mut item = test_automation("minute", "FREQ=MINUTELY;INTERVAL=1", "ACTIVE", "local", vec!["fixture".into()], now);
        assert!(Rrule::for_item(&item).is_err());
        item.kind = "heartbeat".into();
        assert!(Rrule::for_item(&item).is_err());
        item.target_thread_id = Some("linked-thread".into());
        assert!(Rrule::for_item(&item).is_ok());
        for filter in ["BYDAY=MO", "WKST=MO", "INTERVAL=2", "BYMINUTE=0"] {
            assert!(Rrule::parse(&format!("FREQ=MINUTELY;INTERVAL=1;{filter}")).is_err());
        }
        let fast = Rrule::for_item(&item).unwrap();
        // This instant straddles the 2026 fall clock transition in North America.
        let boundary = 1_793_523_570_123;
        assert_eq!(next_scheduled_at(&fast, &item, 0, boundary, b"salt"), Some(boundary + 60_000));
        let slow = Rrule::parse("FREQ=MINUTELY;INTERVAL=60").unwrap();
        let due = next_scheduled_at(&slow, &item, 0, boundary, b"salt").unwrap();
        assert!(due.abs_diff(boundary + 3_600_000) <= 300_000);
        assert_eq!(next_scheduled_at(&slow, &item, 0, boundary, b"salt"), Some(due));
    }

    #[tokio::test]
    async fn heartbeat_checks_same_idle_local_thread_after_cold_resume() {
        let mut methods = Vec::new();
        prepare_heartbeat_thread("linked", |method, params| {
            methods.push(method);
            let thread = match method {
                "thread/read" => {
                    assert_eq!(params, json!({"threadId":"linked","includeTurns":false}));
                    json!({"id":"linked","status":{"type":"notLoaded"},"environments":null})
                }
                "thread/resume" => {
                    assert_eq!(params, json!({"threadId":"linked","excludeTurns":true}));
                    json!({"id":"linked","status":{"type":"idle"},"environments":[{"environmentId":"local"}]})
                }
                _ => panic!("Unexpected request {method}"),
            };
            std::future::ready(Ok(json!({"thread":thread})))
        }).await.unwrap();
        assert_eq!(methods, ["thread/read", "thread/resume"]);
        for (id, status, environment) in [("wrong", "idle", "local"), ("linked", "active", "local"), ("linked", "idle", "remote")] {
            let result = prepare_heartbeat_thread("linked", |method, _| {
                assert_eq!(method, "thread/read");
                std::future::ready(Ok(json!({"thread":{
                    "id":id, "status":{"type":status}, "environments":[{"environmentId":environment}]
                }})))
            }).await;
            assert!(result.is_err());
        }
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

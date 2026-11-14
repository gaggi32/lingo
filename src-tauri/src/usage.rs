//! What Lingo has spent this month.
//!
//! Google bills the Cloud Translation API by the character, with the first
//! 500,000 characters of each calendar month free and $20 per million after
//! that. There is no endpoint that reports the running total — the figure lives
//! in Cloud Billing, hours behind — so Lingo counts what it sends itself and
//! keeps the tally in a small file beside the settings.
//!
//! The same tally enforces the user's monthly limit (`monthlyLimit` in the
//! settings, Google's free tier by default): a translation is refused *before*
//! anything is sent when it would take the month past it. See [`Usage::reserve`].
//!
//! This is Lingo's own count, not Google's invoice. Anything else on the same
//! project spends the same free tier, Google resets on its own clock rather
//! than ours, and a request that fails after the characters were sent may still
//! be billed. The meter says as much: it is a guide to how much of the month is
//! left, not an audit.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const FILE: &str = "usage.json";

/// Characters a calendar month Google does not charge for.
pub const FREE_TIER: u64 = 500_000;

/// What a million characters cost once the free tier is gone, in US dollars.
pub const USD_PER_MILLION: f64 = 20.0;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Usage {
    /// Months since year 0, UTC — `year * 12 + (month - 1)`. Cheaper than a
    /// date, and all a month roll-over needs; the app never renders it.
    month: i64,
    characters: u64,
    /// Set when Google last refused for quota. Cleared by the next translation
    /// that works, and by the roll into a new month.
    quota_blocked: bool,
}

/// The shape the usage meter reads.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub characters: u64,
    /// The user's monthly limit; Lingo refuses past it.
    pub limit: u64,
    pub free_tier: u64,
    pub usd_per_million: f64,
    pub quota_blocked: bool,
}

/// Days since the Unix epoch, UTC.
fn today() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| (d.as_secs() / 86_400) as i64)
        .unwrap_or(0)
}

/// Civil year and month for a day number, by Howard Hinnant's `civil_from_days`.
///
/// A calendar month is the unit Google bills in, and reaching for a date crate
/// to learn which one it is would be the largest dependency in the project for
/// twenty lines of arithmetic.
fn year_month(days: i64) -> (i64, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as i64; // [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m as u32)
}

/// A single comparable number for "which month is it".
fn month_key(days: i64) -> i64 {
    let (y, m) = year_month(days);
    y * 12 + (m as i64 - 1)
}

impl Usage {
    /// Start a new month if one has begun. Called before every read and write,
    /// so a machine left running does not carry last month's total.
    pub fn roll(&mut self) {
        let now = month_key(today());
        if self.month != now {
            self.month = now;
            self.characters = 0;
            self.quota_blocked = false;
        }
    }

    /// Count `needed` characters against the month before they are sent, or
    /// refuse with a sentence saying why when they would pass `limit`.
    ///
    /// Reserved up front, under the lock, so two requests in flight at once
    /// cannot both squeeze under the limit. [`Usage::settle`] corrects the
    /// count once Google has answered.
    pub fn reserve(&mut self, needed: u64, limit: u64) -> Result<(), String> {
        self.roll();
        if self.characters.saturating_add(needed) > limit {
            return Err(refusal(self.characters, limit, needed));
        }
        self.characters = self.characters.saturating_add(needed);
        Ok(())
    }

    /// Swap a reservation for what was really sent: `actual` after a
    /// translation (0 if Google was never asked), or 0 after an error.
    pub fn settle(&mut self, reserved: u64, actual: u64) {
        self.roll();
        self.characters = self.characters.saturating_sub(reserved);
        if actual > 0 {
            self.spend(actual);
        }
    }

    /// Record a translation that has already happened.
    pub fn spend(&mut self, characters: u64) {
        self.roll();
        self.characters = self.characters.saturating_add(characters);
        // Something got through, so whatever Google was refusing before, it is
        // not refusing now.
        self.quota_blocked = false;
    }

    /// Note that Google refused for quota. No characters were translated, but
    /// the next attempt is going to fail the same way.
    pub fn blocked(&mut self) {
        self.roll();
        self.quota_blocked = true;
    }

    pub fn snapshot(&self, limit: u64) -> Snapshot {
        Snapshot {
            characters: self.characters,
            limit,
            free_tier: FREE_TIER,
            usd_per_million: USD_PER_MILLION,
            quota_blocked: self.quota_blocked,
        }
    }
}

/// 1234567 as "1,234,567".
fn grouped(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// What the user is told when the limit stops a translation.
pub fn refusal(used: u64, limit: u64, needed: u64) -> String {
    format!(
        "Not sent: this needs {} characters, and {} of your {} for this month are used. Nothing was billed. Raise the limit in Settings → Spending limit, or wait for next month.",
        grouped(needed),
        grouped(used),
        grouped(limit),
    )
}

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|d| d.join(FILE))
        .map_err(|e| format!("No config directory available: {e}"))
}

/// Read this month's tally. Anything unreadable starts the month at zero — a
/// lost count is not worth refusing to translate over.
pub fn load(app: &AppHandle) -> Usage {
    let mut usage = path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str::<Usage>(&raw).ok())
        .unwrap_or_default();
    usage.roll();
    usage
}

/// Write the tally back. Failures are swallowed: the count is a convenience,
/// and a full disk should not turn into a translation error.
pub fn save(app: &AppHandle, usage: &Usage) {
    let Ok(p) = path(app) else { return };
    if let Some(dir) = p.parent() {
        if std::fs::create_dir_all(dir).is_err() {
            return;
        }
    }
    if let Ok(json) = serde_json::to_string(usage) {
        let _ = std::fs::write(&p, json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_epoch_is_january_1970() {
        assert_eq!(year_month(0), (1970, 1));
    }

    #[test]
    fn month_boundaries_land_where_they_should() {
        // 2024 was a leap year, so 2024-02-29 exists and 2024-03-01 follows it.
        let feb29 = 19_782; // days from 1970-01-01 to 2024-02-29
        assert_eq!(year_month(feb29), (2024, 2));
        assert_eq!(year_month(feb29 + 1), (2024, 3));
        assert_eq!(month_key(feb29) + 1, month_key(feb29 + 1));
    }

    #[test]
    fn a_year_is_twelve_months_apart() {
        let day = 20_000;
        let (y, m) = year_month(day);
        assert_eq!(month_key(day), y * 12 + m as i64 - 1);
    }

    #[test]
    fn spending_accumulates_within_a_month() {
        let mut u = Usage::default();
        u.spend(120);
        u.spend(80);
        assert_eq!(u.snapshot(500_000).characters, 200);
    }

    #[test]
    fn a_new_month_clears_the_tally_and_the_quota_flag() {
        let mut u = Usage::default();
        u.spend(400_000);
        u.blocked();
        assert!(u.snapshot(500_000).quota_blocked);

        // Pretend the file was written last month.
        u.month -= 1;
        u.roll();

        let snap = u.snapshot(500_000);
        assert_eq!(snap.characters, 0);
        assert!(!snap.quota_blocked);
    }

    #[test]
    fn a_translation_that_works_clears_the_block() {
        // A rate limit passes in a minute, unlike a spent monthly allowance, so
        // one success is enough to say the meter is no longer red.
        let mut u = Usage::default();
        u.blocked();
        u.spend(10);
        assert!(!u.snapshot(500_000).quota_blocked);
    }

    #[test]
    fn the_snapshot_carries_googles_own_numbers() {
        let snap = Usage::default().snapshot(123);
        assert_eq!(snap.free_tier, 500_000);
        assert_eq!(snap.usd_per_million, 20.0);
        assert_eq!(snap.limit, 123);
    }

    #[test]
    fn the_limit_refuses_before_anything_is_counted() {
        let mut u = Usage::default();
        u.spend(499_000);
        let err = u.reserve(1_001, 500_000).unwrap_err();
        assert!(err.contains("1,001"), "{err}");
        assert!(err.contains("499,000"), "{err}");
        assert!(err.contains("500,000"), "{err}");
        assert!(err.contains("Settings"), "{err}");
        // The refusal spent nothing.
        assert_eq!(u.snapshot(500_000).characters, 499_000);
        // Exactly up to the limit is fine.
        assert!(u.reserve(1_000, 500_000).is_ok());
        assert_eq!(u.snapshot(500_000).characters, 500_000);
        assert!(u.reserve(1, 500_000).is_err());
    }

    #[test]
    fn a_reservation_settles_to_what_was_sent() {
        let mut u = Usage::default();
        u.spend(100);
        u.reserve(50, 1_000).unwrap();
        // A failed request is not billed: the reservation is given back.
        u.settle(50, 0);
        assert_eq!(u.snapshot(1_000).characters, 100);
        u.reserve(50, 1_000).unwrap();
        u.settle(50, 40);
        assert_eq!(u.snapshot(1_000).characters, 140);
    }

    #[test]
    fn two_requests_in_flight_cannot_both_slip_under() {
        let mut u = Usage::default();
        assert!(u.reserve(300, 500).is_ok());
        assert!(u.reserve(300, 500).is_err());
    }

    #[test]
    fn numbers_are_grouped_for_reading() {
        assert_eq!(grouped(0), "0");
        assert_eq!(grouped(999), "999");
        assert_eq!(grouped(1_000), "1,000");
        assert_eq!(grouped(50_000_000), "50,000,000");
    }
}

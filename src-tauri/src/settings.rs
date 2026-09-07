//! Persisted preferences, and the API key that sits beside them.
//!
//! Everything lives in one JSON file inside the per-user app config directory
//! (`%APPDATA%\com.lingo.translate` on Windows, `~/Library/Application
//! Support/...` on macOS, `~/.config/...` on Linux). Every field carries a
//! default, so a file written by an older build still loads once new fields
//! appear — and a file left behind by an earlier translation back end loads
//! too, with its dead fields ignored on the way in and dropped on the next
//! save.
//!
//! ## Why the key is not part of `Settings`
//!
//! A Google Cloud API key is billable. It is read here, kept in process memory
//! and handed to `google.rs`, and it is never serialised to a webview: the
//! [`Settings`] struct that crosses the IPC boundary has no field for it, and
//! [`Stored`] — the shape on disk — is the only thing that does. That also
//! means a stale settings object round-tripping through the UI can never blank
//! the key by accident, because it does not carry one to blank it with.
//!
//! The key is stored in plain text, readable by the account that owns it and by
//! nothing else on a normally configured machine. The Settings screen says so,
//! and points at Google's key restrictions as the real defence.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const FILE: &str = "settings.json";

/// Default hotkey: ⌘⇧L on macOS, Ctrl⇧L everywhere else.
pub const DEFAULT_HOTKEY: &str = "CommandOrControl+Shift+L";

/// Default target. Google spells plain languages as ISO-639-1, lower case.
pub const DEFAULT_TARGET: &str = "en";

/// Everything the webviews are allowed to see and send back.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// Where to translate to, e.g. "de" or "zh-CN".
    pub target_lang: String,
    /// Where to translate from. Empty means "let Google detect it".
    pub source_lang: String,
    /// Tauri accelerator that summons the pop-up.
    pub hotkey: String,
    /// Seed the pop-up with whatever is on the clipboard when it opens.
    pub prefill_clipboard: bool,
    /// Put the translation on the clipboard as soon as it arrives.
    pub auto_copy: bool,
    /// Record finished translations in the local history database.
    pub save_history: bool,
    /// Translate as the user types, instead of waiting for Enter.
    pub live_translate: bool,
    /// Open with the pair last used rather than with the defaults above.
    pub remember_last_lang: bool,
    /// The source last picked in a window. Empty is a real value here —
    /// "let Google detect it" — so it is [`last_target_lang`] that says
    /// whether anything has been recorded at all.
    ///
    /// [`last_target_lang`]: Settings::last_target_lang
    pub last_source_lang: String,
    /// The target last picked in a window, or empty for "nothing yet". A
    /// target is never legitimately empty, which is what makes it the field
    /// worth asking; the two are always written together.
    pub last_target_lang: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            target_lang: DEFAULT_TARGET.into(),
            source_lang: String::new(),
            hotkey: DEFAULT_HOTKEY.into(),
            prefill_clipboard: true,
            auto_copy: false,
            save_history: true,
            live_translate: true,
            remember_last_lang: true,
            last_source_lang: String::new(),
            last_target_lang: String::new(),
        }
    }
}

/// The whole file: the preferences above, plus the credential the webviews
/// never see.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Stored {
    /// Google Cloud API key with the Cloud Translation API enabled. Empty until
    /// the user pastes one in.
    pub api_key: String,
    #[serde(flatten)]
    pub prefs: Settings,
}

/// Regional codes Google keeps distinct. Everything else it wants as a bare
/// language, and answers `Invalid Value` to anything with a region on it.
const REGIONAL: [&str; 2] = ["zh-CN", "zh-TW"];

/// Put a language code into the spelling Google expects.
///
/// Codes from earlier builds carry regions Google does not recognise — DeepL
/// shouted them (`EN-GB`, `PT-BR`) and MyMemory wrote them RFC3066 (`en-GB`,
/// `pt-BR`) — while Google takes a bare `en` or `pt` and keeps a region only
/// for Chinese. A settings file carried over is nudged into shape rather than
/// left pointing at a language Google will refuse.
fn normalise_lang(code: &str) -> String {
    let code = code.trim();
    let mut parts = code.split('-');
    let Some(base) = parts.next().filter(|b| !b.is_empty()) else {
        return String::new();
    };
    let base = base.to_lowercase();

    let full = match parts.next().filter(|r| !r.is_empty()) {
        Some(region) => format!("{base}-{}", region.to_uppercase()),
        None => base.clone(),
    };

    if REGIONAL.iter().any(|r| r.eq_ignore_ascii_case(&full)) {
        // Match the exact casing of the list rather than our own guess.
        return REGIONAL
            .iter()
            .find(|r| r.eq_ignore_ascii_case(&full))
            .unwrap()
            .to_string();
    }

    // Norwegian has one code on Google's list; the old ones map onto it.
    match base.as_str() {
        "nb" | "nn" => "no".into(),
        _ => base,
    }
}

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|d| d.join(FILE))
        .map_err(|e| format!("No config directory available: {e}"))
}

/// Read the settings file, falling back to defaults for anything missing — a
/// corrupt or truncated file should not stop the app from starting.
pub fn load(app: &AppHandle) -> Stored {
    let Ok(p) = path(app) else {
        return Stored::default();
    };

    let mut stored: Stored = match std::fs::read_to_string(&p) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|e| {
            eprintln!("settings.json is not readable ({e}); starting from defaults");
            Stored::default()
        }),
        Err(_) => Stored::default(),
    };

    stored.api_key = stored.api_key.trim().to_owned();
    stored.prefs.source_lang = normalise_lang(&stored.prefs.source_lang);
    stored.prefs.target_lang = normalise_lang(&stored.prefs.target_lang);
    if stored.prefs.target_lang.is_empty() {
        stored.prefs.target_lang = DEFAULT_TARGET.into();
    }
    // The remembered pair gets the same treatment, minus the fallback: an
    // empty target here means "nothing recorded", and filling it in with the
    // default would claim a pair the user never picked.
    stored.prefs.last_source_lang = normalise_lang(&stored.prefs.last_source_lang);
    stored.prefs.last_target_lang = normalise_lang(&stored.prefs.last_target_lang);
    stored
}

pub fn save(app: &AppHandle, stored: &Stored) -> Result<(), String> {
    let p = path(app)?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    }
    let json =
        serde_json::to_string_pretty(stored).map_err(|e| format!("Couldn't encode settings: {e}"))?;
    std::fs::write(&p, json).map_err(|e| format!("Couldn't write {}: {e}", p.display()))
}

/// The tail of a key, for showing which one is saved without showing the key.
///
/// Google keys are 39 characters and all begin `AIza`, so the last few are the
/// only part that identifies one — and on their own they are not enough to use.
pub fn key_hint(api_key: &str) -> String {
    let key = api_key.trim();
    if key.is_empty() {
        return String::new();
    }
    let tail: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    format!("…{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn regions_google_does_not_know_are_dropped() {
        assert_eq!(normalise_lang("EN-GB"), "en");
        assert_eq!(normalise_lang("en-US"), "en");
        assert_eq!(normalise_lang("PT-BR"), "pt");
        assert_eq!(normalise_lang("fr-CA"), "fr");
        assert_eq!(normalise_lang("DE"), "de");
    }

    #[test]
    fn chinese_keeps_its_region() {
        assert_eq!(normalise_lang("zh-CN"), "zh-CN");
        assert_eq!(normalise_lang("ZH-tw"), "zh-TW");
    }

    #[test]
    fn norwegian_lands_on_the_one_code_google_has() {
        assert_eq!(normalise_lang("nb"), "no");
        assert_eq!(normalise_lang("nn"), "no");
    }

    #[test]
    fn detect_stays_detect() {
        assert_eq!(normalise_lang(""), "");
        assert_eq!(normalise_lang("   "), "");
        // A trailing separator is not a region.
        assert_eq!(normalise_lang("fr-"), "fr");
    }

    #[test]
    fn a_settings_file_from_the_previous_back_end_still_loads() {
        // What the MyMemory build wrote. `email`, `tmKey` and
        // `machineTranslation` are gone from the struct; serde has to ignore
        // them rather than fail the whole read.
        let raw = r#"{
            "email": "someone@example.com",
            "tmKey": "",
            "targetLang": "en-GB",
            "sourceLang": "",
            "machineTranslation": true,
            "hotkey": "Alt+Space",
            "prefillClipboard": false,
            "autoCopy": true,
            "saveHistory": true,
            "liveTranslate": false
        }"#;

        let stored: Stored = serde_json::from_str(raw).unwrap();
        assert_eq!(stored.prefs.hotkey, "Alt+Space");
        assert!(!stored.prefs.prefill_clipboard);
        assert!(stored.prefs.auto_copy);
        // Nothing carried a key, so there is none.
        assert_eq!(stored.api_key, "");
        // Fields added since take their defaults rather than failing the read.
        assert!(stored.prefs.remember_last_lang);
        assert_eq!(stored.prefs.last_target_lang, "");
    }

    #[test]
    fn no_pair_has_been_remembered_until_one_is_written() {
        // Empty source is a real choice, so "nothing recorded yet" has to be
        // readable off the target — which is never legitimately empty.
        let prefs = Settings::default();
        assert_eq!(prefs.last_source_lang, "");
        assert_eq!(prefs.last_target_lang, "");
    }

    #[test]
    fn the_file_round_trips_as_camel_case() {
        let json = serde_json::to_string(&Stored::default()).unwrap();
        assert!(json.contains("apiKey"), "{json}");
        assert!(json.contains("targetLang"), "{json}");
        assert!(json.contains("liveTranslate"), "{json}");
        assert!(json.contains("rememberLastLang"), "{json}");
        assert!(json.contains("lastTargetLang"), "{json}");
        // And nothing from either previous back end lingers.
        assert!(!json.contains("formality"), "{json}");
        assert!(!json.contains("machineTranslation"), "{json}");
        assert!(!json.contains("tmKey"), "{json}");
    }

    #[test]
    fn the_key_never_crosses_the_ipc_boundary() {
        // The struct the webviews receive has no field to put it in, so it
        // cannot leak by accident later.
        let json = serde_json::to_string(&Settings::default()).unwrap();
        assert!(!json.contains("apiKey"), "{json}");
        assert!(!json.to_lowercase().contains("key") || json.contains("hotkey"), "{json}");
    }

    #[test]
    fn a_hint_identifies_a_key_without_being_one() {
        assert_eq!(key_hint("AIzaSyD-EXAMPLE-KEY-abcd1234"), "…1234");
        assert_eq!(key_hint("  "), "");
        // Absurdly short input must not panic or over-reveal.
        assert_eq!(key_hint("ab"), "…ab");
    }
}

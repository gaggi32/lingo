//! Persisted preferences.
//!
//! Everything lives in one JSON file inside the per-user app config directory
//! (`%APPDATA%\com.lingo.translate` on Windows, `~/Library/Application
//! Support/...` on macOS, `~/.config/...` on Linux). The struct carries
//! `#[serde(default)]` so a file written by an older build still loads once new
//! fields appear.
//!
//! The DeepL key is stored in that file in plain text. It is readable by the
//! account that owns it and by nothing else on a normally configured machine,
//! which matches how the key is scoped in the first place — but it is not
//! encrypted, and the Settings screen says so.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const FILE: &str = "settings.json";

/// Default hotkey: ⌘⇧L on macOS, Ctrl⇧L everywhere else.
pub const DEFAULT_HOTKEY: &str = "CommandOrControl+Shift+L";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// DeepL auth key. Empty until the user pastes one in.
    pub api_key: String,
    /// Where to translate to, e.g. "DE" or "EN-GB".
    pub target_lang: String,
    /// Where to translate from. Empty means "let DeepL detect it".
    pub source_lang: String,
    /// "default" | "prefer_more" | "prefer_less".
    pub formality: String,
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
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            target_lang: "EN-GB".into(),
            source_lang: String::new(),
            formality: "default".into(),
            hotkey: DEFAULT_HOTKEY.into(),
            prefill_clipboard: true,
            auto_copy: false,
            save_history: true,
            live_translate: true,
        }
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
pub fn load(app: &AppHandle) -> Settings {
    let Ok(p) = path(app) else {
        return Settings::default();
    };
    match std::fs::read_to_string(&p) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|e| {
            eprintln!("settings.json is not readable ({e}); starting from defaults");
            Settings::default()
        }),
        Err(_) => Settings::default(),
    }
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let p = path(app)?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    }
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Couldn't encode settings: {e}"))?;
    std::fs::write(&p, json).map_err(|e| format!("Couldn't write {}: {e}", p.display()))
}

//! Lingo — a pop-up translator.
//!
//! Two windows share one process: `pop`, a borderless card summoned by a global
//! hotkey, and the desk window (labelled `main`) with history and settings.
//! Rust owns the hotkey, the tray, the settings file, the Google Cloud API key,
//! the monthly usage tally and every call to Google; the webviews own
//! presentation and the history queries.

mod google;
mod settings;
mod usage;

use std::str::FromStr;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};

use settings::{Settings, Stored};

const POP_LABEL: &str = "pop";
const MAIN_LABEL: &str = "main";

/// Passed to ourselves by the autostart entry so a login launch stays in the
/// tray instead of throwing the desk window at the user.
const AUTOSTART_FLAG: &str = "--hidden";

/// History database, resolved by tauri-plugin-sql inside the app data dir.
const DB_URL: &str = "sqlite:lingo.db";

/// Clipboard text longer than this does not seed the pop-up.
///
/// Deliberately well under what the desk window will translate. The pop-up
/// translates its seed without being asked, and Google bills by the character —
/// so a hotkey press nobody meant as a translation request should not turn a
/// copied document into a line on someone's invoice.
const MAX_SEED_CHARS: usize = 1000;

/// Told to the webviews after every translation, so the usage meter in the desk
/// window reflects what the pop-up just spent.
const USAGE_CHANGED: &str = "usage-changed";

/// Told to the webviews when a key is saved or removed, so the pop-up stops
/// asking for one the moment the desk window has been given it.
const KEY_CHANGED: &str = "key-changed";

struct AppState {
    /// One client for the process: connection reuse matters when live
    /// translation fires a request every few keystrokes.
    http: reqwest::Client,
    settings: Mutex<Settings>,
    /// Held apart from the settings, and never serialised to a webview. See the
    /// module docs in `settings.rs`.
    api_key: Mutex<String>,
    usage: Mutex<usage::Usage>,
}

impl AppState {
    fn snapshot(&self) -> Settings {
        // Cloned out rather than held: the guard must be gone before any await.
        self.settings
            .lock()
            .expect("settings mutex poisoned")
            .clone()
    }

    fn key(&self) -> String {
        self.api_key.lock().expect("key mutex poisoned").clone()
    }
}

/// Payload for the `pop-show` event: text to start from, if there is any.
#[derive(Clone, Serialize)]
struct PopShow {
    seed: Option<String>,
}

/// Whether a key is set, and just enough of it to tell one from another.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyStatus {
    present: bool,
    /// The last four characters, or "" when there is no key.
    hint: String,
}

impl KeyStatus {
    fn of(api_key: &str) -> Self {
        Self {
            present: !api_key.trim().is_empty(),
            hint: settings::key_hint(api_key),
        }
    }
}

/// The source language to send, or `None` to let Google detect it.
fn pinned_source(code: &str) -> Option<String> {
    let c = code.trim();
    if c.is_empty() || c.eq_ignore_ascii_case("auto") {
        None
    } else {
        Some(c.to_owned())
    }
}

// ---- Windows ----------------------------------------------------------------

/// Whatever is on the clipboard, if it is text worth seeding the pop-up with.
fn clipboard_seed(app: &AppHandle) -> Option<String> {
    let text = app.clipboard().read_text().ok()?;
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_SEED_CHARS {
        return None;
    }
    Some(trimmed.to_owned())
}

/// Show the pop-up and tell the webview to reset around `seed`.
///
/// Placement is left to the frontend, which can ask for the monitor's work area
/// and park the card near the top third the way a launcher does.
fn show_pop(app: &AppHandle, seed: Option<String>) {
    let Some(win) = app.get_webview_window(POP_LABEL) else {
        return;
    };
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
    let _ = win.emit("pop-show", PopShow { seed });
}

/// Hotkey / tray-click behaviour: summon the card, or dismiss it if it is
/// already up.
fn toggle_pop(app: &AppHandle) {
    let Some(win) = app.get_webview_window(POP_LABEL) else {
        return;
    };
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
        return;
    }
    let seed = if app.state::<AppState>().snapshot().prefill_clipboard {
        clipboard_seed(app)
    } else {
        None
    };
    show_pop(app, seed);
}

fn show_desk(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_LABEL) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

// ---- Commands ---------------------------------------------------------------

#[tauri::command]
fn get_settings(state: tauri::State<'_, AppState>) -> Settings {
    state.snapshot()
}

/// Persist the preferences and re-apply anything with a live effect.
///
/// The key is not part of what comes back from the webview, so it is read from
/// state and written out alongside — a settings object that has been sitting in
/// a stale React tree cannot take the key with it.
#[tauri::command]
fn save_settings(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    next: Settings,
) -> Result<Settings, String> {
    let previous = state.snapshot();
    settings::save(
        &app,
        &Stored {
            api_key: state.key(),
            prefs: next.clone(),
        },
    )?;

    if next.hotkey != previous.hotkey {
        // A rejected accelerator must not leave the app with no hotkey at all,
        // so put the old one back before reporting the failure.
        if let Err(e) = register_hotkey(&app, &next.hotkey) {
            let _ = register_hotkey(&app, &previous.hotkey);
            let _ = settings::save(
                &app,
                &Stored {
                    api_key: state.key(),
                    prefs: previous,
                },
            );
            return Err(e);
        }
    }

    *state.settings.lock().expect("settings mutex poisoned") = next.clone();
    Ok(next)
}

#[tauri::command]
fn key_status(state: tauri::State<'_, AppState>) -> KeyStatus {
    KeyStatus::of(&state.key())
}

/// Save an API key. Not checked here — [`verify_key`] does that, and a key
/// typed while offline should still be storable.
#[tauri::command]
fn set_api_key(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    key: String,
) -> Result<KeyStatus, String> {
    let key = key.trim().to_owned();
    if key.is_empty() {
        return Err("Paste your Google Cloud API key first.".into());
    }
    // Whitespace inside a key is always a copy-paste accident, and Google's
    // refusal for it is unhelpfully vague.
    if key.chars().any(char::is_whitespace) {
        return Err("That key has a space in it. Copy it again, whole.".into());
    }

    settings::save(
        &app,
        &Stored {
            api_key: key.clone(),
            prefs: state.snapshot(),
        },
    )?;
    *state.api_key.lock().expect("key mutex poisoned") = key.clone();
    let _ = app.emit(KEY_CHANGED, ());
    Ok(KeyStatus::of(&key))
}

#[tauri::command]
fn clear_api_key(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<KeyStatus, String> {
    settings::save(
        &app,
        &Stored {
            api_key: String::new(),
            prefs: state.snapshot(),
        },
    )?;
    state.api_key.lock().expect("key mutex poisoned").clear();
    let _ = app.emit(KEY_CHANGED, ());
    Ok(KeyStatus::of(""))
}

/// Prove the saved key works, without spending a character.
///
/// The languages endpoint is not billed, so this checks the key, that the Cloud
/// Translation API is enabled on its project, and that billing is in order —
/// for free. It answers with how many languages came back, which is the most
/// reassuring thing it could say.
#[tauri::command]
async fn verify_key(state: tauri::State<'_, AppState>) -> Result<usize, String> {
    let key = state.key();
    google::languages(&state.http, &key)
        .await
        .map(|list| list.len())
        .map_err(String::from)
}

/// Everything Google will translate, fetched with the saved key.
///
/// Google publishes this and it changes, so Lingo asks rather than guesses. The
/// frontend keeps a bundled list to fall back on when there is no key yet or no
/// connection, so the pickers are never empty.
#[tauri::command]
async fn list_languages(state: tauri::State<'_, AppState>) -> Result<Vec<google::Language>, String> {
    let key = state.key();
    google::languages(&state.http, &key)
        .await
        .map_err(String::from)
}

/// Add a finished translation to the month's tally and tell both windows.
fn bill(app: &AppHandle, state: &AppState, characters: u64) {
    {
        let mut tally = state.usage.lock().expect("usage mutex poisoned");
        tally.spend(characters);
        usage::save(app, &tally);
    }
    let _ = app.emit(USAGE_CHANGED, ());
}

/// Record that Google refused for quota, so the meter can say why the next
/// attempt is going to fail as well.
fn note_block(app: &AppHandle, state: &AppState) {
    {
        let mut tally = state.usage.lock().expect("usage mutex poisoned");
        tally.blocked();
        usage::save(app, &tally);
    }
    let _ = app.emit(USAGE_CHANGED, ());
}

#[tauri::command]
async fn translate_text(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    text: String,
    source_lang: String,
    target_lang: String,
) -> Result<google::Translation, String> {
    let key = state.key();
    let source = pinned_source(&source_lang);

    let result = google::translate(
        &state.http,
        google::Request {
            text: &text,
            source: source.as_deref(),
            target: target_lang.trim(),
            api_key: &key,
        },
    )
    .await;

    match result {
        Ok(t) => {
            if t.characters > 0 {
                bill(&app, &state, t.characters);
            }
            Ok(t)
        }
        Err(e) => {
            if e.kind == google::ErrorKind::Quota {
                note_block(&app, &state);
            }
            Err(e.message)
        }
    }
}

#[tauri::command]
fn usage_today(state: tauri::State<'_, AppState>) -> usage::Snapshot {
    let mut tally = state.usage.lock().expect("usage mutex poisoned");
    tally.roll();
    tally.snapshot()
}

/// Longest text the desk window will offer to translate, so the two sides agree
/// on the limit without hard-coding it twice.
#[tauri::command]
fn max_characters() -> usize {
    google::MAX_TOTAL_CHARS
}

#[tauri::command]
fn hide_pop(app: AppHandle) {
    if let Some(win) = app.get_webview_window(POP_LABEL) {
        let _ = win.hide();
    }
}

#[tauri::command]
fn open_desk(app: AppHandle) {
    show_desk(&app);
}

#[tauri::command]
fn db_url() -> &'static str {
    DB_URL
}

fn register_hotkey(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let shortcut = Shortcut::from_str(accelerator)
        .map_err(|_| format!("Lingo cannot register the shortcut {accelerator}."))?;
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    gs.register(shortcut)
        .map_err(|e| format!("The system refused {accelerator}: {e}"))
}

/// Drop every global shortcut so the webview can read raw keystrokes while the
/// user records a new binding — otherwise the OS swallows the current combo and
/// the recorder never sees it. `save_settings` or `resume_shortcut` restores it.
#[tauri::command]
fn suspend_shortcut(app: AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn resume_shortcut(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    register_hotkey(&app, &state.snapshot().hotkey)
}

// ---- Tray -------------------------------------------------------------------

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let translate_i = MenuItem::with_id(app, "pop", "Translate...", true, None::<&str>)?;
    let clip_i = MenuItem::with_id(app, "clip", "Translate clipboard", true, None::<&str>)?;
    let open_i = MenuItem::with_id(app, "open", "Open Lingo", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&translate_i, &clip_i, &open_i, &sep, &quit_i])?;

    TrayIconBuilder::with_id("lingo-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Lingo")
        .menu(&menu)
        // Menu on right-click only; left-click summons the card.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "pop" => toggle_pop(app),
            // An explicit request, so seed from the clipboard whatever the
            // prefill setting says.
            "clip" => show_pop(app, clipboard_seed(app)),
            "open" => show_desk(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_pop(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

// ---- Schema -----------------------------------------------------------------

fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create_history_table",
        sql: "CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_text TEXT NOT NULL,
                target_text TEXT NOT NULL,
                source_lang TEXT NOT NULL,
                target_lang TEXT NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS history_recent ON history(created_at DESC);",
        kind: MigrationKind::Up,
    }]
}

// ---- Entry ------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance MUST be registered first.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // A second launch surfaces the running one instead of starting over.
            show_desk(app);
        }))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_pop(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_FLAG]),
        ))
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            key_status,
            set_api_key,
            clear_api_key,
            verify_key,
            list_languages,
            translate_text,
            usage_today,
            max_characters,
            hide_pop,
            open_desk,
            db_url,
            suspend_shortcut,
            resume_shortcut,
        ])
        .on_window_event(|window, event| match event {
            // Clicking away dismisses the card, the way a launcher should.
            WindowEvent::Focused(false) if window.label() == POP_LABEL => {
                let _ = window.hide();
            }
            // Closing the desk window parks Lingo in the tray rather than
            // quitting — the hotkey has to keep working.
            WindowEvent::CloseRequested { api, .. } if window.label() == MAIN_LABEL => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .setup(|app| {
            // macOS: live in the menu bar, no Dock icon.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let loaded = settings::load(&handle);
            let tally = usage::load(&handle);

            let http = reqwest::Client::builder()
                .user_agent(concat!("Lingo/", env!("CARGO_PKG_VERSION")))
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .expect("could not build the HTTP client");

            let hotkey = loaded.prefs.hotkey.clone();
            app.manage(AppState {
                http,
                settings: Mutex::new(loaded.prefs),
                api_key: Mutex::new(loaded.api_key),
                usage: Mutex::new(tally),
            });

            // Both windows are declared in tauri.conf.json with `"create":
            // false` and built here instead.
            //
            // Tauri creates config-declared windows *before* it runs this hook,
            // which would let a webview finish loading and invoke a command
            // while the state above was still being read off disk — a race the
            // frontend sees as "state not managed for field `state`". Building
            // them by hand puts the two in the only order that is safe.
            for window in &app.config().app.windows {
                tauri::WebviewWindowBuilder::from_config(&handle, window)?.build()?;
            }

            // Registered here, before any webview has finished loading, so the
            // hotkey works from the moment the tray icon appears.
            if let Err(e) = register_hotkey(&handle, &hotkey) {
                eprintln!("{e} — falling back to {}", settings::DEFAULT_HOTKEY);
                let _ = register_hotkey(&handle, settings::DEFAULT_HOTKEY);
            }

            build_tray(&handle)?;

            // Re-point an existing login entry at THIS executable, healing a
            // stale path left behind by a dev build.
            let autostart = app.autolaunch();
            if autostart.is_enabled().unwrap_or(false) {
                let _ = autostart.enable();
            }

            // Launched at login → stay quiet in the tray. Launched by hand →
            // show the desk window so it is obvious Lingo started.
            if !std::env::args().any(|a| a == AUTOSTART_FLAG) {
                show_desk(&handle);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Lingo");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unpinned_source_is_left_for_google_to_work_out() {
        assert_eq!(pinned_source(""), None);
        assert_eq!(pinned_source("   "), None);
        assert_eq!(pinned_source("auto"), None);
        assert_eq!(pinned_source("AUTO"), None);
        assert_eq!(pinned_source(" de "), Some("de".into()));
    }

    #[test]
    fn key_status_shows_that_there_is_a_key_without_showing_it() {
        let full = "AIzaSyD-EXAMPLE-KEY-wxyz";
        let status = KeyStatus::of(full);
        assert!(status.present);
        assert_eq!(status.hint, "…wxyz");
        assert!(!status.hint.contains("AIza"));

        let empty = KeyStatus::of("  ");
        assert!(!empty.present);
        assert_eq!(empty.hint, "");
    }
}

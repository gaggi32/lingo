//! Lingo — a pop-up translator.
//!
//! Two windows share one process: `pop`, a borderless card summoned by a global
//! hotkey, and the desk window (labelled `main`) with history and settings.
//! Rust owns the hotkey, the tray, the settings file and every call to DeepL;
//! the webviews own presentation and the history queries.

mod deepl;
mod settings;

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

use settings::Settings;

const POP_LABEL: &str = "pop";
const MAIN_LABEL: &str = "main";

/// Passed to ourselves by the autostart entry so a login launch stays in the
/// tray instead of throwing the desk window at the user.
const AUTOSTART_FLAG: &str = "--hidden";

/// History database, resolved by tauri-plugin-sql inside the app data dir.
const DB_URL: &str = "sqlite:lingo.db";

/// Clipboard text longer than this is almost certainly not something anyone
/// meant to translate in a pop-up, and it would burn quota to find out.
const MAX_SEED_CHARS: usize = 4000;

struct AppState {
    /// One client for the process: connection reuse matters when live
    /// translation fires a request every few keystrokes.
    http: reqwest::Client,
    settings: Mutex<Settings>,
}

impl AppState {
    fn snapshot(&self) -> Settings {
        // Cloned out rather than held: the guard must be gone before any await.
        self.settings
            .lock()
            .expect("settings mutex poisoned")
            .clone()
    }
}

/// Payload for the `pop-show` event: text to start from, if there is any.
#[derive(Clone, Serialize)]
struct PopShow {
    seed: Option<String>,
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

/// Persist the whole settings object and re-apply anything with a live effect.
#[tauri::command]
fn save_settings(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    next: Settings,
) -> Result<Settings, String> {
    let previous = state.snapshot();
    settings::save(&app, &next)?;

    if next.hotkey != previous.hotkey {
        // A rejected accelerator must not leave the app with no hotkey at all,
        // so put the old one back before reporting the failure.
        if let Err(e) = register_hotkey(&app, &next.hotkey) {
            let _ = register_hotkey(&app, &previous.hotkey);
            let _ = settings::save(&app, &previous);
            return Err(e);
        }
    }

    *state.settings.lock().expect("settings mutex poisoned") = next.clone();
    Ok(next)
}

/// Whether a key has been configured at all. The UI uses this to choose between
/// the translator and the "add your key" prompt without ever reading the key.
#[tauri::command]
fn has_key(state: tauri::State<'_, AppState>) -> bool {
    !state.snapshot().api_key.trim().is_empty()
}

/// Free keys are metered against a monthly character allowance; Pro keys
/// usually are not. The usage meter labels itself differently for each.
#[tauri::command]
fn key_is_free(state: tauri::State<'_, AppState>) -> bool {
    deepl::is_free_key(&state.snapshot().api_key)
}

#[tauri::command]
async fn translate_text(
    state: tauri::State<'_, AppState>,
    text: String,
    source_lang: String,
    target_lang: String,
    formality: String,
) -> Result<deepl::Translation, String> {
    let key = state.snapshot().api_key;
    if key.trim().is_empty() {
        return Err("No DeepL API key yet — add one under Settings.".into());
    }

    let source = {
        let s = source_lang.trim();
        if s.is_empty() || s.eq_ignore_ascii_case("auto") {
            None
        } else {
            Some(s.to_owned())
        }
    };

    deepl::translate(
        &state.http,
        &key,
        &text,
        source.as_deref(),
        target_lang.trim(),
        Some(formality.trim()),
    )
    .await
}

/// Check a key the user has typed but not saved yet. Succeeding here is the
/// only confirmation Settings offers, so it doubles as the usage read.
#[tauri::command]
async fn verify_key(
    state: tauri::State<'_, AppState>,
    key: String,
) -> Result<deepl::Usage, String> {
    if key.trim().is_empty() {
        return Err("Paste a DeepL API key first.".into());
    }
    deepl::usage(&state.http, &key).await
}

#[tauri::command]
async fn deepl_usage(state: tauri::State<'_, AppState>) -> Result<deepl::Usage, String> {
    let key = state.snapshot().api_key;
    if key.trim().is_empty() {
        return Err("No DeepL API key yet.".into());
    }
    deepl::usage(&state.http, &key).await
}

#[tauri::command]
async fn deepl_languages(state: tauri::State<'_, AppState>) -> Result<deepl::Languages, String> {
    let key = state.snapshot().api_key;
    if key.trim().is_empty() {
        return Err("No DeepL API key yet.".into());
    }
    deepl::languages(&state.http, &key).await
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
            has_key,
            key_is_free,
            translate_text,
            verify_key,
            deepl_usage,
            deepl_languages,
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

            let http = reqwest::Client::builder()
                .user_agent(concat!("Lingo/", env!("CARGO_PKG_VERSION")))
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .expect("could not build the HTTP client");

            app.manage(AppState {
                http,
                settings: Mutex::new(loaded.clone()),
            });

            // Registered here, before any webview has finished loading, so the
            // hotkey works from the moment the tray icon appears.
            if let Err(e) = register_hotkey(&handle, &loaded.hotkey) {
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

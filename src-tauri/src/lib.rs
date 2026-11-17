//! Lingo — a pop-up translator.
//!
//! Two windows share one process: `pop`, a borderless card summoned by a global
//! hotkey, and the desk window (labelled `main`) with history and settings.
//! Rust owns the hotkey, the tray, the settings file, the Google Cloud API key,
//! the monthly usage tally and every call to Google; the webviews own
//! presentation and the history queries.

mod google;
mod secret;
mod settings;
mod usage;

use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Url, WindowEvent,
};
#[cfg(not(debug_assertions))]
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_sql::{Migration, MigrationKind};

use settings::{Settings, Stored};

const POP_LABEL: &str = "pop";
const MAIN_LABEL: &str = "main";

/// Shared flag for the fullscreen-topmost watchdog (see [`spawn_topmost_watch`]).
struct TopmostWatch(Arc<AtomicBool>);

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

/// Where a new version is downloaded, and where the update check asks.
const DOWNLOAD_PAGE: &str = "https://github.com/gaggi32/lingo/releases/latest";
const LATEST_RELEASE: &str = "https://api.github.com/repos/gaggi32/lingo/releases/latest";

/// Hosts a link in the UI may open in the default browser. Everything else is
/// refused, and the webviews themselves never navigate away from the app.
const LINK_HOSTS: &[&str] = &[
    "console.cloud.google.com",
    "cloud.google.com",
    "docs.cloud.google.com",
    "github.com",
];

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

/// The app's own pages only. In dev that is the Vite server; in a build it is
/// Tauri's asset protocol (tauri://localhost on macOS, http(s)://tauri.localhost
/// on Windows).
fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => match url.host_str() {
            Some("tauri.localhost") => true,
            Some("localhost") => cfg!(debug_assertions) && url.port() == Some(1430),
            _ => false,
        },
        _ => false,
    }
}

/// Whether the UI may open `url` in the browser: https, on an allowed host,
/// with no credentials in it.
fn allowed_link(url: &str) -> Option<Url> {
    let parsed = Url::parse(url).ok()?;
    let host_ok = parsed.host_str().is_some_and(|h| LINK_HOSTS.contains(&h));
    let clean = parsed.username().is_empty() && parsed.password().is_none();
    (parsed.scheme() == "https" && host_ok && clean).then_some(parsed)
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
    let mut next = next;
    next.monthly_limit = settings::clamp_limit(next.monthly_limit);
    let previous = state.snapshot();
    settings::save(
        &app,
        &Stored {
            api_key: secret::file_copy(&state.key()),
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
                    api_key: secret::file_copy(&state.key()),
                    prefs: previous,
                },
            );
            return Err(e);
        }
    }

    if next.stay_on_top_fullscreen != previous.stay_on_top_fullscreen {
        set_topmost_watch(&app, next.stay_on_top_fullscreen);
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

    if key.chars().count() > 300 || !key.chars().all(|c| c.is_ascii_graphic()) {
        return Err("That does not look like a Google Cloud API key.".into());
    }

    secret::save(&app, &key)?;
    if secret::IN_FILE {
        settings::save(
            &app,
            &Stored {
                api_key: key.clone(),
                prefs: state.snapshot(),
            },
        )?;
    }
    *state.api_key.lock().expect("key mutex poisoned") = key.clone();
    let _ = app.emit(KEY_CHANGED, ());
    Ok(KeyStatus::of(&key))
}

#[tauri::command]
fn clear_api_key(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<KeyStatus, String> {
    secret::delete(&app)?;
    // Also rewrites a settings.json that still carried a key from 0.1.x.
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

/// Swap a reservation for what Google really billed, and tell both windows.
fn settle(app: &AppHandle, state: &AppState, reserved: u64, actual: u64) {
    {
        let mut tally = state.usage.lock().expect("usage mutex poisoned");
        tally.settle(reserved, actual);
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

    // The monthly limit is checked, and the characters counted, before
    // anything is sent: a refused request never reaches Google.
    let reserved = google::billable_characters(&text);
    {
        let limit = state.snapshot().monthly_limit;
        let mut tally = state.usage.lock().expect("usage mutex poisoned");
        tally.reserve(reserved, limit)?;
    }

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
            settle(&app, &state, reserved, t.characters);
            Ok(t)
        }
        Err(e) => {
            settle(&app, &state, reserved, 0);
            if e.kind == google::ErrorKind::Quota {
                note_block(&app, &state);
            }
            Err(e.message)
        }
    }
}

#[tauri::command]
fn usage_today(state: tauri::State<'_, AppState>) -> usage::Snapshot {
    let limit = state.snapshot().monthly_limit;
    let mut tally = state.usage.lock().expect("usage mutex poisoned");
    tally.roll();
    tally.snapshot(limit)
}

/// Longest text the desk window will offer to translate, so the two sides agree
/// on the limit without hard-coding it twice.
#[tauri::command]
fn max_characters() -> usize {
    google::MAX_TOTAL_CHARS
}

/// Open an allowed https link in the default browser.
#[tauri::command]
fn open_link(app: AppHandle, url: String) -> Result<(), String> {
    let parsed =
        allowed_link(&url).ok_or_else(|| "That link is not on the allowed list.".to_string())?;
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_download_page(app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(DOWNLOAD_PAGE, None::<&str>)
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    current: String,
    latest: Option<String>,
    newer: bool,
}

fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let mut it = v
        .trim()
        .trim_start_matches('v')
        .split('.')
        .map(|p| p.parse::<u64>().ok());
    let version = (it.next()??, it.next()??, it.next()??);
    it.next().is_none().then_some(version)
}

/// The version in a GitHub release answer ("tag_name": "v1.2.3" gives "1.2.3").
fn release_version(body: &serde_json::Value) -> Option<String> {
    let tag = body.get("tag_name")?.as_str()?.trim();
    let v = tag.strip_prefix('v').unwrap_or(tag);
    (v.len() <= 20 && parse_version(v).is_some()).then(|| v.to_string())
}

fn is_newer(latest: Option<&str>, current: &str) -> bool {
    match (latest.and_then(parse_version), parse_version(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

/// Ask GitHub for the newest published release of Lingo. Only its version is
/// read, and no key or text goes with the request; installing is
/// [`install_update`], or the user's own download.
#[tauri::command]
async fn check_update(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let res = state
        .http
        .get(LATEST_RELEASE)
        .header("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|_| "Could not reach GitHub.".to_string())?;
    if res.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("GitHub shows no public release yet.".into());
    }
    if !res.status().is_success() {
        return Err(format!("GitHub answered {}.", res.status()));
    }
    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|_| "Unexpected answer from GitHub.".to_string())?;
    let latest = release_version(&body);
    let newer = is_newer(latest.as_deref(), &current);
    Ok(UpdateInfo {
        current,
        latest,
        newer,
    })
}

/// Download the newest release, check its signature against the key built
/// into this app (tauri.conf.json, plugins.updater.pubkey), install it and
/// restart. Anything not signed with the release key is refused. Progress goes
/// out as "update-progress" (0-100, or -1 while the size is unknown). Only the
/// main window may ask.
#[tauri::command]
async fn install_update(app: AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != MAIN_LABEL {
        return Err("Only the main window can install updates.".into());
    }
    use tauri_plugin_updater::UpdaterExt;
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| format!("Could not check for the update: {e}"))?
        .ok_or("There is no newer version to install.")?;
    let mut done: usize = 0;
    let progress = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                done += chunk;
                let pct = total.map_or(-1, |t| if t == 0 { -1 } else { (done as u64 * 100 / t) as i64 });
                let _ = progress.emit("update-progress", pct);
            },
            || {},
        )
        .await
        .map_err(|e| format!("Could not install the update: {e}"))?;
    app.restart();
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

/// Toggle the fullscreen-topmost watchdog. `alwaysOnTop` in tauri.conf.json
/// asserts HWND_TOPMOST once, but a fullscreen game or video regularly steals
/// it back when it (re)gains focus, and Windows treats a maximized borderless
/// app as fullscreen the same way. Re-asserting on an interval — the same
/// trick overlay apps like Discord's use — makes the pop-up come back on top
/// within a beat instead of staying buried until the other app loses focus.
///
/// Driven by `Settings::stay_on_top_fullscreen`: applied at startup and by
/// [`save_settings`], never by the webview directly.
fn set_topmost_watch(app: &AppHandle, enabled: bool) {
    app.state::<TopmostWatch>().0.store(enabled, Ordering::Relaxed);
    if enabled {
        if let Some(win) = app.get_webview_window(POP_LABEL) {
            let _ = win.set_always_on_top(true);
        }
    }
}

/// Background loop backing [`set_topmost_watch`]. Sleeps between checks so it
/// costs nothing while the setting is off.
fn spawn_topmost_watch(app: AppHandle, flag: Arc<AtomicBool>) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(750));
        if flag.load(Ordering::Relaxed) {
            if let Some(win) = app.get_webview_window(POP_LABEL) {
                let _ = win.set_always_on_top(true);
            }
        }
    });
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
    let builder = tauri::Builder::default()
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_pop(app);
                    }
                })
                .build(),
        );

    // Release builds only. The login entry is one per app name, not per
    // identifier, so a dev build that could touch it would point the real
    // install's entry at `target/debug` — a console-subsystem exe that opens
    // a terminal at every login. Without the plugin, Settings shows the
    // switch as unavailable in dev.
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        Some(vec![AUTOSTART_FLAG]),
    ));

    builder
        .manage(TopmostWatch(Arc::new(AtomicBool::new(false))))
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
            open_link,
            open_download_page,
            check_update,
            install_update,
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
            // From the credential store, moving a 0.1.x key out of the file.
            let api_key = secret::load(&handle, &loaded);
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
                api_key: Mutex::new(api_key),
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
            //
            // Each may only show the app's own pages: navigation anywhere else
            // is refused, and window.open / target=_blank open nothing.
            for window in &app.config().app.windows {
                tauri::WebviewWindowBuilder::from_config(&handle, window)?
                    .on_navigation(|url| is_app_url(url))
                    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                    .build()?;
            }

            // Registered here, before any webview has finished loading, so the
            // hotkey works from the moment the tray icon appears.
            if let Err(e) = register_hotkey(&handle, &hotkey) {
                eprintln!("{e} — falling back to {}", settings::DEFAULT_HOTKEY);
                let _ = register_hotkey(&handle, settings::DEFAULT_HOTKEY);
            }

            build_tray(&handle)?;

            let watch_flag = app.state::<TopmostWatch>().0.clone();
            spawn_topmost_watch(handle.clone(), watch_flag);
            let stay_on_top = app.state::<AppState>().snapshot().stay_on_top_fullscreen;
            set_topmost_watch(&handle, stay_on_top);

            // Re-point an existing login entry at THIS executable, so it
            // follows the install if it moves (and heals one left on a dev
            // build by an older version).
            #[cfg(not(debug_assertions))]
            {
                let autostart = app.autolaunch();
                if autostart.is_enabled().unwrap_or(false) {
                    let _ = autostart.enable();
                }
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

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn the_webviews_only_ever_show_the_app() {
        assert!(is_app_url(&url("tauri://localhost/index.html")));
        assert!(is_app_url(&url("http://tauri.localhost/pop.html")));
        assert!(is_app_url(&url("https://tauri.localhost/")));
        assert!(!is_app_url(&url("https://example.com/")));
        assert!(!is_app_url(&url("https://tauri.localhost.example.com/")));
        assert!(!is_app_url(&url("file:///C:/Windows/win.ini")));
        assert!(!is_app_url(&url("http://localhost:8080/")));
        // The Vite server, in a debug build only.
        assert_eq!(is_app_url(&url("http://localhost:1430/")), cfg!(debug_assertions));
    }

    #[test]
    fn links_open_only_for_the_allow_list() {
        assert!(allowed_link("https://console.cloud.google.com/apis/credentials").is_some());
        assert!(allowed_link("https://docs.cloud.google.com/translate/quotas").is_some());
        assert!(allowed_link("https://github.com/gaggi32/lingo/releases").is_some());
        assert!(allowed_link("http://console.cloud.google.com/").is_none());
        assert!(allowed_link("https://evil.example/").is_none());
        assert!(allowed_link("https://github.com.evil.example/").is_none());
        assert!(allowed_link("https://user:pw@github.com/").is_none());
        assert!(allowed_link("javascript:alert(1)").is_none());
        assert!(allowed_link("file:///etc/passwd").is_none());
        assert!(allowed_link("not a url").is_none());
    }

    #[test]
    fn versions_compare_as_numbers() {
        assert_eq!(parse_version("v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("0.10.0"), Some((0, 10, 0)));
        assert_eq!(parse_version("1.2"), None);
        assert_eq!(parse_version("1.2.3.4"), None);
        assert_eq!(parse_version("1.2.x"), None);
        assert!(is_newer(Some("0.10.0"), "0.9.9"));
        assert!(!is_newer(Some("0.2.0"), "0.2.0"));
        assert!(!is_newer(Some("0.1.9"), "0.2.0"));
        assert!(!is_newer(None, "0.2.0"));
    }

    #[test]
    fn a_release_answer_gives_its_version() {
        let body = serde_json::json!({ "tag_name": "v0.3.1", "name": "Lingo v0.3.1" });
        assert_eq!(release_version(&body), Some("0.3.1".into()));
        let odd = serde_json::json!({ "tag_name": "nightly" });
        assert_eq!(release_version(&odd), None);
        assert_eq!(release_version(&serde_json::json!({})), None);
    }
}

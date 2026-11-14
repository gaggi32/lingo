//! Where the Google Cloud API key is kept between runs.
//!
//! On Windows and macOS the key lives in the OS credential store (Credential
//! Manager, which encrypts it with the account's DPAPI key, and the Keychain).
//! It is read once at start-up and kept in memory for the rest of the run —
//! on macOS every read by an unsigned app can raise a Keychain prompt.
//!
//! Versions up to 0.1.x kept the key in plain text in `settings.json`. On the
//! first start of a newer build, a key found there is written to the credential
//! store, and only once that has worked is the file rewritten without it. If
//! the store cannot be reached, the key stays where it was and keeps working.
//!
//! Linux has no credential store every desktop provides, so there the key stays
//! in `settings.json` as before (readable by your user account only on a
//! normally configured machine). [`IN_FILE`] says which way this build works.
//!
//! Nothing here ever sends the key to a webview.

use tauri::AppHandle;

/// The credential's service name: the app identifier ("com.lingo.translate").
fn service(app: &AppHandle) -> String {
    app.config().identifier.clone()
}

use crate::settings::{self, Stored};

/// True where the key is kept in `settings.json` rather than a credential store.
pub const IN_FILE: bool = cfg!(not(any(windows, target_os = "macos")));

/// What to do at start-up, given what the credential store and the settings
/// file each hold. Pure, so the migration rules can be tested without a store.
#[derive(Debug, PartialEq, Eq)]
pub enum Plan {
    /// The store has the key. Any copy still in the file is stale: drop it.
    UseStore { scrub_file: bool },
    /// Only the file has one (an upgrade from 0.1.x): move it into the store.
    MoveFromFile,
    /// The store could not be read. Use the file's key and leave the file alone.
    FileOnly,
    /// No key anywhere yet.
    Nothing,
}

pub fn plan(store: Result<Option<&str>, ()>, file_key: &str) -> Plan {
    let file_has = !file_key.trim().is_empty();
    match store {
        Ok(Some(k)) if !k.trim().is_empty() => Plan::UseStore { scrub_file: file_has },
        Ok(_) if file_has => Plan::MoveFromFile,
        Ok(_) => Plan::Nothing,
        Err(()) => Plan::FileOnly,
    }
}

#[cfg(any(windows, target_os = "macos"))]
mod store {
    const ACCOUNT: &str = "google-cloud";

    /// `service` is the app identifier, so a dev build run under another
    /// identifier never sees, spends or overwrites the real key.
    fn entry(service: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(service, ACCOUNT).map_err(|e| e.to_string())
    }

    /// `Ok(None)` when nothing is stored; `Err` when the store itself failed.
    pub fn get(service: &str) -> Result<Option<String>, String> {
        match entry(service)?.get_password() {
            Ok(k) => Ok(Some(k).filter(|k| !k.is_empty())),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn set(service: &str, key: &str) -> Result<(), String> {
        entry(service)?
            .set_password(key)
            .map_err(|e| format!("Could not store the key in the system's credential store: {e}"))
    }

    pub fn delete(service: &str) -> Result<(), String> {
        match entry(service)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod store {
    // Linux: the key is part of settings.json, so there is no separate store.
    pub fn get(_service: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    pub fn set(_service: &str, _key: &str) -> Result<(), String> {
        Ok(())
    }
    pub fn delete(_service: &str) -> Result<(), String> {
        Ok(())
    }
}

/// The key for this run. `stored` is what `settings::load` read; a key found
/// in it is moved into the credential store, and the file rewritten without
/// it, only after the store has accepted it.
pub fn load(app: &AppHandle, stored: &Stored) -> String {
    let file_key = stored.api_key.trim().to_owned();
    if IN_FILE {
        return file_key;
    }

    let service = service(app);
    let from_store = store::get(&service);
    if let Err(e) = &from_store {
        eprintln!("credential store not readable ({e}); using settings.json for now");
    }
    let shown = from_store.as_ref().map(|o| o.as_deref()).map_err(|_| ());

    match plan(shown, &file_key) {
        Plan::UseStore { scrub_file } => {
            if scrub_file {
                scrub(app, stored);
            }
            from_store.ok().flatten().unwrap_or_default()
        }
        Plan::MoveFromFile => {
            let moved = store::set(&service, &file_key).is_ok()
                && store::get(&service).ok().flatten().as_deref() == Some(file_key.as_str());
            if moved {
                scrub(app, stored);
            }
            file_key
        }
        Plan::FileOnly => file_key,
        Plan::Nothing => String::new(),
    }
}

/// Rewrite settings.json without the key.
fn scrub(app: &AppHandle, stored: &Stored) {
    let clean = Stored {
        api_key: String::new(),
        prefs: stored.prefs.clone(),
    };
    if let Err(e) = settings::save(app, &clean) {
        eprintln!("could not remove the old key from settings.json: {e}");
    }
}

/// Save a new key where this build keeps it.
pub fn save(app: &AppHandle, key: &str) -> Result<(), String> {
    store::set(&service(app), key)
}

/// Forget the key.
pub fn delete(app: &AppHandle) -> Result<(), String> {
    store::delete(&service(app))
}

/// What `settings.json` should carry for `key`: the key itself on Linux,
/// nothing anywhere else.
pub fn file_copy(key: &str) -> String {
    if IN_FILE {
        key.to_owned()
    } else {
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_in_the_store_wins_and_the_file_copy_goes() {
        assert_eq!(plan(Ok(Some("AIzaStore")), "AIzaOld"), Plan::UseStore { scrub_file: true });
        assert_eq!(plan(Ok(Some("AIzaStore")), ""), Plan::UseStore { scrub_file: false });
    }

    #[test]
    fn an_upgrade_moves_the_file_key_into_the_store() {
        assert_eq!(plan(Ok(None), "AIzaOld"), Plan::MoveFromFile);
        // An empty item in the store counts as nothing stored.
        assert_eq!(plan(Ok(Some("  ")), "AIzaOld"), Plan::MoveFromFile);
    }

    #[test]
    fn a_broken_store_never_costs_the_key() {
        assert_eq!(plan(Err(()), "AIzaOld"), Plan::FileOnly);
        assert_eq!(plan(Err(()), ""), Plan::FileOnly);
    }

    #[test]
    fn nothing_anywhere_is_nothing() {
        assert_eq!(plan(Ok(None), ""), Plan::Nothing);
        assert_eq!(plan(Ok(None), "   "), Plan::Nothing);
    }

    #[test]
    fn the_file_only_carries_the_key_where_there_is_no_store() {
        if IN_FILE {
            assert_eq!(file_copy("AIzaX"), "AIzaX");
        } else {
            assert_eq!(file_copy("AIzaX"), "");
        }
    }
}

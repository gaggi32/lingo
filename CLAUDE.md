# Lingo

Tauri v2 pop-up translator for Windows and macOS: a hotkey card that translates
the clipboard through the Google Cloud Translation API with the user's own key.
No server: it talks only to Google (translation, with the user's key) and
GitHub (update check). Sibling apps with the same shape: `C:\dev\flashcards`
(the reference for hardening and release), `C:\dev\dash`.

## Commands
- `npm install` — once.
- `npm run tauri:dev` — run the app (Vite on :1430 + Rust debug build). On Windows use `run-dev.cmd` if linking fails with LNK1104.
- `npm test` — Vitest (pure TS logic in `src/lib/__tests__/`).
- `npm run typecheck` — tsc.
- `cargo test --manifest-path src-tauri/Cargo.toml` — Rust unit tests (needs `dist/` to exist; `mkdir dist` if missing).
- `npm run tauri:build` — local installer in `src-tauri/target/release/bundle/`.
- Icon: `node scripts/make-icon.mjs && npx tauri icon app-icon.png`, then delete everything in `src-tauri/icons/` except the five files `tauri.conf.json` lists.

## Layout
- `src-tauri/src/lib.rs` — windows (built from config in `setup` with a navigation guard), tray, hotkey, every command, link allow-list, update check.
- `src-tauri/src/google.rs` — the Cloud Translation v2 client; `billable_characters` is the count the limit uses.
- `src-tauri/src/secret.rs` — the key in the OS credential store (keyring), the 0.1.x migration out of `settings.json`.
- `src-tauri/src/settings.rs` — `settings.json`; `Settings` is what crosses IPC (no key field).
- `src-tauri/src/usage.rs` — monthly tally and the spending limit (`reserve` before sending, `settle` after).
- `src/pop/Pop.tsx` — the hotkey card. `src/full/` — desk window (Workbench, History, Settings, UsageMeter).
- `src/lib/api.ts` — every `invoke`. `src/lib/history.ts` — SQLite history via tauri-plugin-sql.

## Conventions
- The key never crosses IPC: no command returns it, `Settings` has no field for it. Only `secret.rs` and `google.rs` touch it.
- Every translation goes through `translate_text`, which reserves the characters against `monthlyLimit` before calling Google. Don't add another path to Google.
- The UI never names a URL for Rust to fetch. Links go through `open_link` (https + `LINK_HOSTS`); add a host there only if a link needs it.
- Both windows carry the same `additionalBrowserArgs` (they share one WebView2 environment, which refuses differing options). They keep wry's defaults and turn off WebView2's occlusion throttling: without that the pop-up, shown over the desk window, froze on the first frame of its unfurl (a thin strip). Hidden windows are still throttled.
- Keep the CSP in `tauri.conf.json` strict (`connect-src` is IPC only); Google and GitHub are called from Rust.
- Language codes: Google's spelling. Suffixed codes Google keeps (`zh-CN`, `zh-TW`, `mni-Mtei`) must be in `REGIONAL` in `settings.rs`, or `normalise_lang` rewrites them.
- Identifier `com.lingo.translate` and the default publisher: changing either moves the data folder, the keychain item or the NSIS install key. Don't, without a carry-over like Flashcards' `adopt_old_folders`.
- The update check reads `api.github.com/repos/gaggi32/lingo/releases/latest` (no token), so it needs the repo to be public.
- Version lives in three places: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`. The release job refuses a tag that does not match all three.

## Testing note
- Run dev builds under another identifier so they never touch the real settings, history or key:
  `npx tauri dev --config '{"identifier":"com.lingo.translate.dev"}'`. The keychain item is named after the identifier (`secret.rs`), so a dev identifier has its own, empty key and can't spend the real one.
- The real app holds the single-instance lock and the hotkey: a second copy with the same identifier exits at once. Change the dev hotkey in its Settings if both run.
- WebView2 debugging: set `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9335` and read the pages over CDP.
- Never drive the GUI while Michele may be working.

## Releasing
Bump the three versions, commit, tag `vX.Y.Z`, push the tag. `.github/workflows/release.yml` builds Windows x64 + macOS arm64/x64, uploads installers and `.sha256` files to a draft, and publishes it from the protected `release` environment. The app's update check reads that release.

## Only Michele can do
- Make the repo public, and keep it public (free Actions minutes, and the update check reads releases without a token).
- Create the `release` environment on GitHub (Settings → Environments → New environment `release`, deployment tags `v*`) before the first tag.
- Code signing certificates (Apple Developer ID, Windows signing) if wanted.

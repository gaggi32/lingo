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
- `CHANGELOG.md` — bundled with `?raw` (`src/lib/releases.ts`), parsed by `src/lib/changelog.ts` for the desk window's "What's new" card (`src/full/WhatsNew.tsx`), shown once after an update; `lastSeenVersion` in `settings.json` remembers what was seen.

## Conventions
- The key never crosses IPC: no command returns it, `Settings` has no field for it. Only `secret.rs` and `google.rs` touch it.
- Every translation goes through `translate_text`, which reserves the characters against `monthlyLimit` before calling Google. Don't add another path to Google.
- The UI never names a URL for Rust to fetch. Links go through `open_link` (https + `LINK_HOSTS`); add a host there only if a link needs it.
- Both windows carry the same `additionalBrowserArgs` (they share one WebView2 environment, which refuses differing options). They keep wry's defaults and turn off WebView2's occlusion throttling: without that the pop-up, shown over the desk window, froze on the first frame of its unfurl (a thin strip). Hidden windows are still throttled.
- Keep the CSP in `tauri.conf.json` strict (`connect-src` is IPC only); Google and GitHub are called from Rust.
- Language codes: Google's spelling. Suffixed codes Google keeps (`zh-CN`, `zh-TW`, `mni-Mtei`) must be in `REGIONAL` in `settings.rs`, or `normalise_lang` rewrites them.
- Identifier `com.lingo.translate` and the default publisher: changing either moves the data folder, the keychain item or the NSIS install key. Don't, without a carry-over like Flashcards' `adopt_old_folders`.
- The repo is public (since 2026-11-17; recreated that day so no pre-rewrite commits remain). The update check reads `api.github.com/repos/gaggi32/lingo/releases/latest` without a token, and the in-app updater (`install_update`, main window only) reads `releases/latest/download/latest.json`, so both need the repo public.
- Version lives in three places: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`. The release job refuses a tag that does not match all three.

## Testing note
- Run dev builds under another identifier so they never touch the real settings, history or key:
  `npx tauri dev --config '{"identifier":"com.lingo.translate.dev"}'`. The keychain item is named after the identifier (`secret.rs`), so a dev identifier has its own, empty key and can't spend the real one.
- The real app holds the single-instance lock and the hotkey: a second copy with the same identifier exits at once. Change the dev hotkey in its Settings if both run.
- WebView2 debugging: set `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9335` and read the pages over CDP.
- Never drive the GUI while Michele may be working.

## Releasing
Every release first adds its section to `CHANGELOG.md`: `## [X.Y.Z] — YYYY-MM-DD`, then `### Added / Changed / Fixed / Removed`, one line per change a user would notice (not internal names), checked against `git log --no-merges <last tag>..HEAD`. That section is the GitHub release notes and the in-app "What's new" card; the release job refuses a tag without one, and `npm test` fails when `package.json`'s version has none.
Then bump the three versions, commit, tag `vX.Y.Z`, push the tag. `.github/workflows/release.yml` builds Windows x64 + macOS arm64/x64, signs each build for the updater, uploads installers, `.sha256`, `.sig` and `latest.json` to a draft, and publishes it in the `release` environment (deployment tags `v*`).
Updater key: `C:\Users\miche\.tauri\lingo-updater.key` and `.password` (never in the repo or the vault), stored as repo secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the public key is `plugins.updater.pubkey` in `tauri.conf.json`. Without the secrets the build fails. Builds signed with another key are refused by installed apps, so losing it means everyone installs by hand once more.

After it is published, point the 404canvas download page (404canvas.ch/projects/lingo) at it: `C:\devĄcanvas\privateelease-lingo.json` (version, the three asset URLs, SHA-256 from the release's `.sha256` files), commit "release: Lingo vX.Y.Z", push.

## Only Michele can do
- Keep the repo public (the update check and the updater read its releases without a token).
- Keep a backup of the updater key and its password (a password manager), and set the two repo secrets from them.
- Code signing certificates (Apple Developer ID, Windows signing) if wanted.

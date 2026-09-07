# Lingo

A pop-up translator for Windows, macOS and Linux, powered by the
[Google Cloud Translation API](https://cloud.google.com/translate).

Press one shortcut and a small card unrolls near the top of the screen with
whatever you last copied — already translated. Read it, press <kbd>Enter</kbd>
to copy it back, and it disappears. Click anywhere else and it disappears too.
Lingo otherwise waits in the tray and stays out of the way.

You bring your own Google Cloud API key, which means the text goes to *your*
project: Google states that Cloud Translation does not use your content to train
its models, and the first 500,000 characters each month cost nothing. Built with
Tauri v2, React and TypeScript. Roughly 12 MB installed, and it does not ship a
browser engine — it uses the one your OS already has.

---

## What it does

- **One hotkey, from anywhere.** <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>
  (<kbd>⌘</kbd>+<kbd>⇧</kbd>+<kbd>L</kbd> on macOS), rebindable to anything the
  OS will give you.
- **Starts from your clipboard.** Copy a sentence, hit the hotkey, and the
  translation is already on screen. No paste step.
- **Translates as you type**, debounced so it is not one request per keystroke.
- **Detects the source language**, or pin it if you know better.
- **Keeps the shape of what you paste.** Google does not reliably preserve line
  breaks, so Lingo sends one line per string and puts the pieces back where they
  were — a three-paragraph email comes back as three paragraphs.
- **Knows every language Google does.** The picker is filled from Google's own
  list, fetched with your key, so a language added next year shows up without a
  new release. A bundled list stands in until that answer arrives.
- **Picks a language without the mouse.** Type to filter, arrows to walk the
  list, <kbd>Enter</kbd> to take the row you are on.
- **Opens where you left off.** Switch languages in the pop-up and it stays
  switched. Turn that off under **Settings → Translation** and every card comes
  back on the pair you set as the default.
- **Swaps and carries over.** The swap button flips the pair *and* moves the
  translation into the input — which is what you want when you are going back
  and forth with someone.
- **Grows to fit.** The window is sized to its content, so a two-word answer
  gets a two-word card.
- **Remembers what mattered.** Anything you copy is saved to a local history you
  can search and pin. Typing that you never used is not.
- **Counts what it spends,** so the free half-million characters do not run out
  without warning, and so an overrun shows up as a number rather than as a
  surprise on a bill.
- **Never hands your key to the UI.** It is written once and lives in Rust
  after that. No part of the app that draws the screen can read it back.

## Requirements

A Google Cloud API key with the Cloud Translation API enabled. It takes about
two minutes:

1. Create or pick a project in the
   [Google Cloud console](https://console.cloud.google.com).
2. Enable the
   [Cloud Translation API](https://console.cloud.google.com/apis/library/translate.googleapis.com)
   on it. Billing has to be set up on the project even while you are inside the
   free tier.
3. Make a key under
   [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
4. Paste it into **Settings → Google Cloud** and press **Save & check**.

The check costs nothing — it asks Google for its language list, which is not
billed — and it tells you which of the three usual problems you have if the key
does not work: rejected key, API not enabled, or billing not set up.

**Restrict the key.** In the console, limit it to the Cloud Translation API and
set a quota. Lingo stores it in plain text in its own config folder, the same as
your other preferences, and a restricted key that leaks cannot be spent on
anything else.

### What it costs

| | |
| --- | --- |
| First 500,000 characters a month | Free |
| After that | $20 per million characters |

Google counts the characters you send, including spaces, and counts them again
each time — a sentence translated into two languages is billed twice. Lingo's
sidebar meter tracks its own running total against the free tier. It is a guide,
not an audit: anything else on the same project spends the same allowance, and
Google's own figure lives in Cloud Billing.

**Upgrading from an earlier build?** Your settings and your history carry over.
Dead fields from the DeepL and MyMemory eras are ignored on the way in and
dropped on the next save, and language codes are rewritten into Google's
spelling — `EN-GB` and `en-GB` both become `en`, `pt-BR` becomes `pt`, while
`zh-CN` and `zh-TW` keep their regions because Google keeps them too.

## Install

Grab the installer for your platform from the
[releases page](https://github.com/gaggi32/lingo/releases), or build it
yourself — see below.

| Platform | Artifact |
| --- | --- |
| Windows | `Lingo_<version>_x64-setup.exe` (NSIS) or `Lingo_<version>_x64_en-US.msi` |
| macOS | `Lingo_<version>_universal.dmg` |
| Linux | `lingo_<version>_amd64.deb`, `lingo_<version>_amd64.AppImage` |

Windows and macOS builds are unsigned, so both will warn on first launch —
"More info → Run anyway" on Windows, right-click → Open on macOS.

## Using it

| Key | In the pop-up |
| --- | --- |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> | Summon or dismiss the card |
| <kbd>Enter</kbd> | Copy the translation and close (or translate, if there isn't one yet) |
| <kbd>Shift</kbd>+<kbd>Enter</kbd> | New line |
| <kbd>↑</kbd> <kbd>↓</kbd> | Walk the language picker while it is open |
| <kbd>Esc</kbd> | Close the open picker, then the card |

The tray icon holds the same actions: left-click summons the card, right-click
opens a menu with **Translate clipboard**, **Open Lingo** and **Quit**. Closing
the main window parks Lingo in the tray rather than quitting, so the hotkey
keeps working.

In the main window, <kbd>Ctrl</kbd>+<kbd>Enter</kbd> translates and records the
result to History.

**Watching the spend.** *Translate as you type* is the setting that costs money
fastest. Turn it off under **Settings → Pop-up** and nothing is sent — or
billed — until you press Enter.

## Where your data lives

| What | Where |
| --- | --- |
| Preferences and your API key | `settings.json` in the app config dir |
| This month's usage tally | `usage.json`, beside it |
| Translation history | `lingo.db` (SQLite) in the app data dir |

That is `%APPDATA%\com.lingo.translate` on Windows,
`~/Library/Application Support/com.lingo.translate` on macOS, and
`~/.config/com.lingo.translate` on Linux.

None of them is encrypted. They sit in your user profile, readable by anything
running as you — which is why restricting the key in the Cloud console is the
defence that actually matters.

Text you translate goes to Google and nowhere else. Lingo has no telemetry, no
accounts and no server of its own.

## Building from source

You will need [Node](https://nodejs.org) 20+, [Rust](https://rustup.rs), and
your platform's Tauri prerequisites
([the list is here](https://v2.tauri.app/start/prerequisites/)).

```bash
npm install
npm run tauri:dev      # run it
npm run tauri:build    # installers land in src-tauri/target/release/bundle/
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

**On Windows**, use `run-dev.cmd` and `run-build.cmd` instead. Rust links
through MSVC, and if the newest Visual Studio install is missing the "Desktop
development with C++" workload the build fails with a bare
`LNK1104: cannot open file "msvcrt.lib"`. Those two scripts ask `vswhere` for an
install that actually has the C++ x64 tools, load its environment, and then run
the same npm scripts.

The app icon is generated rather than checked in as a binary blob you cannot
edit:

```bash
node scripts/make-icon.mjs     # draws app-icon.png from signed distance fields
npx tauri icon app-icon.png    # fans it out into src-tauri/icons/
```

`tauri icon` also writes `icons/android/` and `icons/ios/`; Lingo is
desktop-only, so those two folders get deleted again.

## How it fits together

```
src/
  pop/Pop.tsx           the hotkey card: one file, the whole interaction
  full/                 the desk window — Workbench, History, Settings
  lib/api.ts            every call into Rust, in one place
  lib/languages.ts      the bundled language table and its helpers
  lib/useLanguages.ts   Google's live list, with the bundled one as fallback
  lib/useKeyStatus.ts   whether a key is saved — all the UI may know about it
  lib/history.ts        the SQLite log
src-tauri/src/
  lib.rs                windows, tray, global shortcut, IPC commands
  google.rs             the Cloud Translation client
  settings.rs           the persisted settings file, and the key beside it
  usage.rs              the monthly character tally
```

Two windows share one process and one bundle: `pop.html` for the card and
`index.html` for the desk window. They share no memory, so each broadcasts a
Tauri event after a write and re-reads on receipt.

**Every Google call happens in Rust**, and so does the key. `Settings` — the
struct that crosses into a webview — has no field for the key at all, which
means the UI cannot read it back and a stale settings object cannot blank it on
a round trip. The key is written once through `set_api_key`, and after that a
translation names a language pair and some text while Rust supplies the
credential.

`google.rs` also absorbs the two habits of the v2 API that would otherwise reach
the screen: replies come back HTML-escaped even when you ask for plain text
(`&#39;` where an apostrophe belongs), and line breaks are not reliably
preserved, so text is sent one line per string and reassembled on the way out.

## Licence

MIT.

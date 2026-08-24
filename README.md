# Lingo

A pop-up translator for Windows, macOS and Linux, powered by the DeepL API.

Press one shortcut and a small card unrolls near the top of the screen with
whatever you last copied — already translated. Read it, press <kbd>Enter</kbd>
to copy it back, and it disappears. Click anywhere else and it disappears too.
Lingo otherwise waits in the tray and stays out of the way.

Built with Tauri v2, React and TypeScript. Roughly 12 MB installed, and it does
not ship a browser engine — it uses the one your OS already has.

---

## What it does

- **One hotkey, from anywhere.** <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>
  (<kbd>⌘</kbd>+<kbd>⇧</kbd>+<kbd>L</kbd> on macOS), rebindable to anything the
  OS will give you.
- **Starts from your clipboard.** Copy a sentence, hit the hotkey, and the
  translation is already on screen. No paste step.
- **Translates as you type**, debounced so it is not one request per keystroke.
- **Detects the source language**, or pin it if you know better.
- **Swaps and carries over.** The swap button flips the pair *and* moves the
  translation into the input — which is what you want when you are going back
  and forth with someone.
- **Grows to fit.** The window is sized to its content, so a two-word answer
  gets a two-word card.
- **Remembers what mattered.** Anything you copy is saved to a local history you
  can search and pin. Typing that you never used is not.
- **Formality control** for the languages DeepL supports it on (German, French,
  Spanish, Italian, Dutch, Polish, Portuguese, Japanese, Russian).
- **Usage meter**, so a free key's 500,000 monthly characters do not run out
  without warning.

## Requirements

A DeepL API key — the free tier covers 500,000 characters a month and is enough
for everyday use. Get one at [deepl.com/pro-api](https://www.deepl.com/pro-api),
then paste it into Lingo's Settings. Free keys end in `:fx`; Lingo reads that
suffix to decide which DeepL host to talk to, so there is nothing else to
configure.

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
| <kbd>Esc</kbd> | Close the open picker, then the card |

The tray icon holds the same actions: left-click summons the card, right-click
opens a menu with **Translate clipboard**, **Open Lingo** and **Quit**. Closing
the main window parks Lingo in the tray rather than quitting, so the hotkey
keeps working.

In the main window, <kbd>Ctrl</kbd>+<kbd>Enter</kbd> translates and records the
result to History.

## Where your data lives

| What | Where |
| --- | --- |
| API key and preferences | `settings.json` in the app config dir |
| Translation history | `lingo.db` (SQLite) in the app data dir |

That is `%APPDATA%\com.lingo.translate` on Windows,
`~/Library/Application Support/com.lingo.translate` on macOS, and
`~/.config/com.lingo.translate` on Linux.

Neither file is encrypted. They sit in your user profile, readable by anything
running as you — the same exposure the key itself has. If that is not good
enough for your threat model, use a restricted key.

Text you translate goes to DeepL and nowhere else. Lingo has no telemetry, no
accounts and no server of its own.

## Building from source

You will need [Node](https://nodejs.org) 20+, [Rust](https://rustup.rs), and
your platform's Tauri prerequisites
([the list is here](https://v2.tauri.app/start/prerequisites/)).

```bash
npm install
npm run tauri:dev      # run it
npm run tauri:build    # installers land in src-tauri/target/release/bundle/
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

## How it fits together

```
src/
  pop/Pop.tsx        the hotkey card: one file, the whole interaction
  full/              the desk window — Workbench, History, Settings
  lib/api.ts         every call into Rust, in one place
  lib/history.ts     the SQLite log
src-tauri/src/
  lib.rs             windows, tray, global shortcut, IPC commands
  deepl.rs           the DeepL v2 client
  settings.rs        the persisted settings file
```

Two windows share one process and one bundle: `pop.html` for the card and
`index.html` for the desk window. They share no memory, so each broadcasts a
Tauri event after a write and re-reads on receipt.

**Every DeepL call happens in Rust**, for three reasons: the API key never has
to be handed to JavaScript, DeepL sends no CORS headers so a `fetch` from the
webview would be refused anyway, and HTTP status codes can be turned into
sentences worth reading before they reach the UI — DeepL's `456` means "quota
spent", which is not something a user should have to look up.

## Licence

MIT.

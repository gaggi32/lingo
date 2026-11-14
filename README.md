# Lingo

A pop-up translator for Windows and macOS. Copy some text, press
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> (<kbd>⌘</kbd>+<kbd>⇧</kbd>+<kbd>L</kbd>
on a Mac), and a small card appears with it already translated. Press
<kbd>Enter</kbd> to copy the translation and the card is gone. Click anywhere
else and it is gone too. The rest of the time Lingo waits in the tray.

Lingo translates with the [Google Cloud Translation API](https://cloud.google.com/translate)
using **your own Google Cloud key**, so your text goes to your own Google
project and nowhere else. The first 500,000 characters each month are free,
and Lingo is set up so that, out of the box, it cannot spend more than that.

## Download

Get the newest version from the
[releases page](https://github.com/gaggi32/lingo/releases/latest):

| Your computer | File |
| --- | --- |
| Windows 10 or 11 | `Lingo-<version>-x64-setup.exe` |
| Mac with Apple silicon (M1 and later) | `Lingo-<version>-arm64.dmg` |
| Mac with an Intel chip | `Lingo-<version>-x64.dmg` |

Each file has a `.sha256` next to it if you want to check your download
(`Get-FileHash .\Lingo-…-setup.exe` on Windows, `shasum -a 256 Lingo-….dmg`
on a Mac).

**The first time you open it.** Lingo is free and not signed with a paid
Microsoft or Apple certificate, so each system asks once:

- **Windows:** "Windows protected your PC" → **More info** → **Run anyway**.
- **macOS:** open Lingo once (it will be blocked), then go to
  **System Settings → Privacy & Security**, scroll down and click
  **Open Anyway**. macOS may also ask whether Lingo may use its item in your
  Keychain (that is where your key is stored): choose **Always Allow**. After an
  update it can ask once more.

Linux: there are no ready-made Linux builds. You can build it yourself (see
the end of this page); that is untested.

## Get a Google Cloud API key (about 5 minutes)

Lingo needs a key from a Google Cloud project with the Cloud Translation API
switched on. The same steps are in Lingo under **Settings → Google Cloud →
How to get a key**, with a link for each.

1. **Create a project**, or pick one you already have, in the
   [Google Cloud console](https://console.cloud.google.com/projectcreate).
2. **Set up billing** on it under [Billing](https://console.cloud.google.com/billing).
   Google asks for a card even if you only ever use the free tier. New
   accounts start with a free trial credit.
3. **Enable the Cloud Translation API** on that project:
   [Cloud Translation API](https://console.cloud.google.com/apis/library/translate.googleapis.com)
   → **Enable**.
4. **Create an API key**: [Credentials](https://console.cloud.google.com/apis/credentials)
   → **Create credentials** → **API key**.
5. **Restrict the key**: click the key you just made, under
   **API restrictions** choose **Restrict key**, tick only
   **Cloud Translation API**, and **Save**. A restricted key that leaks cannot
   be used for any other Google service.
6. **Cap it at Google** (see the next section): on the API's
   [Quotas page](https://console.cloud.google.com/apis/api/translate.googleapis.com/quotas),
   find **Characters sent to general model per project per day**, edit it and
   set it to **16,000**. That is roughly the free 500,000 a month.
7. Optional: add a [budget alert](https://console.cloud.google.com/billing/budgets)
   so Google emails you if anything is ever billed.
8. In Lingo, open **Settings → Google Cloud**, paste the key and press
   **Save & check**. The check is free: it asks Google for its language list,
   which is not billed. If something is wrong, it tells you which of the usual
   problems you have: key rejected, API not enabled, or billing not set up.

**Treat the key like a password.** Don't paste it into chats, screenshots,
emails or code. If it ever gets out, delete it under
[Credentials](https://console.cloud.google.com/apis/credentials) and create a
new one; the old one stops working at once.

## Keep your bill at zero

Google charges for the characters you send:

| | |
| --- | --- |
| First 500,000 characters a month | Free (a $10 monthly credit, shared between Translation Basic and Advanced) |
| After that | $20 per million characters |

Every character counts, spaces included, and text translated twice is counted
twice. Prices as of November 2026; Google's
[pricing page](https://cloud.google.com/translate/pricing) has the current
figures.

Four things stand between a mistake and a bill:

1. **The key is restricted** to the Cloud Translation API (step 5), so a
   leaked key cannot run up charges on other services.
2. **Google's daily quota** (step 6) is the real hard stop. It is unlimited
   until you set it. Once set, Google refuses everything past it, whatever uses
   the key, including a key that leaked. Changes can take up to a day to apply,
   and the daily count resets at midnight Pacific time.
3. **Lingo's monthly limit** (**Settings → Spending limit**, 500,000 characters
   by default) is a second guard. Lingo counts what it sends and refuses a
   translation *before* sending it if it would go past the limit, so a refused
   translation costs nothing. You can raise it; the screen shows what each step
   could cost. It only counts Lingo, not anything else on the same project,
   and it is Lingo's own count, not Google's invoice.
4. **A budget alert** (step 7) emails you. It does not stop anything.

Two more settings help: **Translate as you type** (Settings → Pop-up) sends a
request while you type; turn it off and nothing is sent until you press
<kbd>Enter</kbd>. And copied text longer than 1,000 characters never starts a
translation on its own.

## Using it

| Key | In the pop-up |
| --- | --- |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> | Open or close the card (change it in Settings) |
| <kbd>Enter</kbd> | Copy the translation and close (or translate, if there isn't one yet) |
| <kbd>Shift</kbd>+<kbd>Enter</kbd> | New line |
| <kbd>Tab</kbd> | Swap the two languages, and move the translation into the input |
| <kbd>Ctrl</kbd>+<kbd>1</kbd> / <kbd>Ctrl</kbd>+<kbd>2</kbd> | Open the "from" / "into" language list (<kbd>Control</kbd> on a Mac) |
| <kbd>↑</kbd> <kbd>↓</kbd>, typing | Move through and filter an open language list |
| <kbd>Esc</kbd> | Close the open list, then the card |

- **Tray icon:** left-click opens the card; right-click has **Translate
  clipboard**, **Open Lingo** and **Quit**. Closing the main window keeps Lingo
  in the tray so the hotkey keeps working.
- **Main window:** a larger translator (<kbd>Ctrl</kbd>+<kbd>Enter</kbd>
  translates), a searchable history you can pin entries in, this month's
  usage, and Settings.
- **Settings** also has: the default languages and whether the card opens on
  the pair you used last, keep the text when the card reopens, copy
  automatically, keep a history, stay on top of fullscreen apps, start with
  the computer, and update checks.

## Your data and privacy

- **The text you translate** goes to Google, through your own project, and
  nowhere else. Google states that Cloud Translation does not use your content
  to train its models. Lingo has no account, no server and no telemetry.
- **Your key** is kept in Windows Credential Manager or the macOS Keychain.
  The part of Lingo that draws the screen can never read it back; it only
  learns whether a key is saved and its last four characters. Lingo sends it
  to Google's translation endpoint and nowhere else. (Upgrading from 0.1.x,
  which kept it in `settings.json`: it is moved over on the first start.)
- **Update check:** once a day Lingo asks GitHub for the version number of its
  newest release. No text and no key go with it, and you can turn it off in
  Settings. Installing an update is always your own download.
- **Links** in the app open in your browser, and only for Google Cloud and
  GitHub pages. The app loads no web pages of its own.
- **On your computer:** `settings.json` (preferences) and `usage.json` (this
  month's count) in the config folder, and `lingo.db` (history) in the data
  folder. On Windows both are `%APPDATA%\com.lingo.translate`, on macOS
  `~/Library/Application Support/com.lingo.translate`. They are not encrypted;
  turn off **Keep a history** if you don't want translations stored.

## Uninstall

First remove your key: **Settings → Google Cloud → Remove it** (that deletes
it from Credential Manager / the Keychain). Then:

- **Windows:** Settings → Apps → Installed apps → Lingo → Uninstall.
- **macOS:** quit Lingo from the menu bar and move it from Applications to the
  Trash.

To remove your settings and history too, delete the `com.lingo.translate`
folder listed above.

## Building from source

You need [Node](https://nodejs.org) 20+, [Rust](https://rustup.rs) and your
platform's [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri:dev      # run it
npm test               # Vitest
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri:build    # installer in src-tauri/target/release/bundle/
```

On Windows, if the build stops with `LNK1104: cannot open file "msvcrt.lib"`,
use `run-dev.cmd` / `run-build.cmd`: they load a Visual Studio install that has
the C++ x64 tools. [CLAUDE.md](CLAUDE.md) has the layout, the conventions and
how a release is made.

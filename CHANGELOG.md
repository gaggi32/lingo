# Changelog

All notable changes to Lingo. Versions from 0.2.0 on match the GitHub releases.

## [1.1.0] — 2026-11-17
### Added
- Settings and the update notice show what is new in an update before you install it.

## [1.0.0] — 2026-11-17
### Changed
- Lingo is 1.0: its first stable version.

## [0.3.0] — 2026-11-17
### Added
- Install updates from inside Lingo: "Install" in the sidebar notice or in Settings downloads the new version, checks it is signed by Lingo, installs it and restarts. Your key, settings and history stay. (This version itself is the last one to install by hand.)
### Changed
- Lingo's code is public on GitHub, so the update check now finds new versions.

## [0.2.2] — 2026-11-16
### Added
- "What's new": after an update, the main window shows what changed since the version you had.
### Changed
- The release pages on GitHub list the changes from this changelog.

## [0.2.1] — 2026-11-16
### Fixed
- Windows: the pop-up no longer freezes as a thin strip when it opens over the main window.

## [0.2.0] — 2026-11-15
### Added
- Monthly spending limit in Settings (500,000 characters by default, Google's free tier): a translation that would go past it is refused before anything is sent to Google.
- Update check once a day, with a switch and "Check now" in Settings and a notice in the main window when a new version is out.
- Settings walks you through making a restricted, quota-capped API key.
- "Stay on top of fullscreen apps": keeps the pop-up above games and fullscreen video.
- "Keep text when reopening" for the pop-up.
- In the pop-up, Tab swaps the languages; Ctrl+1 and Ctrl+2 open the source and target lists.
- Lingo opens with the language pair you used last (switch in Settings → Translation); ↑ and ↓ walk the language list and Enter takes the highlighted one.
### Changed
- Your API key is kept in Windows Credential Manager or the macOS Keychain instead of the settings file; a key saved by 0.1.x moves there on the first start.
- The windows only ever show Lingo's own pages, and links open in your browser.
### Fixed
- Meiteilon (Meetei Mayek) translates again instead of being refused by Google.

## [0.1.1] — 2026-09-07
### Changed
- Translations come from Google Cloud Translation with your own API key instead of DeepL. Lingo counts the month's characters against Google's free 500,000.
- The language list comes from Google, so new languages appear without an update.
- New app icon.
### Fixed
- A second click on a language button closes its list.
- The pop-up keeps fitting its text after the first time it opens, and no longer moves the cursor while you type.
- The language list in Settings opens above the sections below it.

## [0.1.0] — 2026-08-24
### Added
- First release: press a hotkey and a card at the top of the screen translates what is on the clipboard (DeepL, with your own key). Enter copies the translation and closes the card.
- Main window with a two-pane translator, a searchable history you can pin entries in, and settings with a hotkey recorder and a usage meter.

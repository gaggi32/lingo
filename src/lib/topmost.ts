import { saveSettings } from "./api";
import type { Settings } from "./types";

/**
 * "Stay on top of fullscreen apps" used to live in localStorage. WebView2
 * writes that lazily, and a tray app is killed rather than closed at a PC
 * restart, so the switch kept coming back off. It is a field of
 * `settings.json` now, which Rust writes atomically and applies itself at
 * startup; this is the one-time move of the old value.
 */
const LEGACY_KEY = "lingo.stayOnTopFullscreen";

/**
 * Whether a value left in localStorage should switch the setting on. Only
 * ever on: the default is off, so an "off" there carries nothing over, and a
 * file that already says on is never overruled.
 */
export function carriesOver(legacy: string | null, current: boolean): boolean {
  return legacy === "1" && !current;
}

/** Move a leftover localStorage value into the settings file, then drop it. */
export async function carryOverStayOnTop(s: Settings): Promise<Settings> {
  let legacy: string | null;
  try {
    legacy = localStorage.getItem(LEGACY_KEY);
  } catch {
    return s;
  }
  if (legacy === null) return s;
  const next = carriesOver(legacy, s.stayOnTopFullscreen)
    ? await saveSettings({ ...s, stayOnTopFullscreen: true })
    : s;
  // Only once the file has it, so a failed save is retried next launch.
  localStorage.removeItem(LEGACY_KEY);
  return next;
}

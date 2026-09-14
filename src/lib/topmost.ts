import { invoke } from "@tauri-apps/api/core";

/**
 * "Stay on top of fullscreen apps" setting for the pop-up translator.
 *
 * The pop-up is already `alwaysOnTop` per tauri.conf.json, but a fullscreen
 * game or video regularly reclaims topmost status when it regains focus.
 * When this is on, Rust runs a background watchdog that re-asserts topmost a
 * few times a second so the card doesn't stay buried. Off by default since
 * it's a niche need and (very marginally) busier than the plain default.
 */
const STORAGE_KEY = "lingo.stayOnTopFullscreen";

export function getStayOnTopFullscreen(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export async function setStayOnTopFullscreen(enabled: boolean): Promise<void> {
  await invoke("set_topmost_watch", { enabled });
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
}

/** Re-apply the saved setting. Safe to call on every launch. */
export async function applySavedStayOnTopFullscreen(): Promise<void> {
  if (!getStayOnTopFullscreen()) return;
  try {
    await invoke("set_topmost_watch", { enabled: true });
  } catch (err) {
    console.error("Failed to re-apply stay-on-top-fullscreen:", err);
  }
}

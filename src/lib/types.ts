/**
 * Mirrors `Settings` in src-tauri/src/settings.rs (serialised camelCase).
 *
 * The Google Cloud API key is deliberately not here. Rust keeps it out of every
 * payload that crosses into a webview, so this object can be round-tripped
 * freely without a stale copy ever blanking the credential. See
 * {@link KeyStatus} for what the UI is allowed to know about it.
 */
export interface Settings {
  /** Target language code, e.g. "de" or "zh-CN". */
  targetLang: string;
  /** Source language code; "" means let Google detect it. */
  sourceLang: string;
  /** Tauri accelerator, e.g. "CommandOrControl+Shift+L". */
  hotkey: string;
  prefillClipboard: boolean;
  autoCopy: boolean;
  saveHistory: boolean;
  liveTranslate: boolean;
}

/** Everything the UI is told about the saved API key. */
export interface KeyStatus {
  present: boolean;
  /** The last four characters as "…wxyz", or "" when there is no key. */
  hint: string;
}

/** Mirrors `google::Translation`. */
export interface Translation {
  text: string;
  /** "" when the source language was pinned rather than detected. */
  detectedSourceLanguage: string;
  /** Characters Google will bill for. 0 when nothing was actually sent. */
  characters: number;
}

/** Mirrors `usage::Snapshot` — Lingo's own count of what this month has cost. */
export interface Usage {
  characters: number;
  /** Characters a calendar month Google does not charge for. */
  freeTier: number;
  /** Dollars per million characters past the free tier. */
  usdPerMillion: number;
  /** Google last refused for quota, and will again until something changes. */
  quotaBlocked: boolean;
}

/** One entry in the language table. */
export interface Language {
  /** The code Google wants, e.g. "de" or "zh-CN". */
  code: string;
  name: string;
}

/** One row of the local history table. */
export interface HistoryEntry {
  id: number;
  sourceText: string;
  targetText: string;
  sourceLang: string;
  targetLang: string;
  pinned: boolean;
  createdAt: string;
}

import { invoke } from "@tauri-apps/api/core";
import type {
  KeyStatus,
  Language,
  Settings,
  Translation,
  Usage,
} from "./types";

/**
 * Every call into Rust, in one place.
 *
 * Nothing here talks to Google directly, and nothing here ever holds the API
 * key. The key is written once with {@link setApiKey}, after which it lives
 * only in Rust: translations name a language pair and some text, and Rust
 * supplies the credential. A webview cannot read it back, which is the point.
 */

export const getSettings = (): Promise<Settings> => invoke("get_settings");

export const saveSettings = (next: Settings): Promise<Settings> =>
  invoke("save_settings", { next });

// ---- The key ----------------------------------------------------------------

/** Whether a key is saved, and the last four characters of it. Never the key. */
export const keyStatus = (): Promise<KeyStatus> => invoke("key_status");

/** Store a key. Not checked here — call {@link verifyKey} for that. */
export const setApiKey = (key: string): Promise<KeyStatus> =>
  invoke("set_api_key", { key });

export const clearApiKey = (): Promise<KeyStatus> => invoke("clear_api_key");

/**
 * Prove the saved key works, and resolve with how many languages Google offers
 * it. Costs nothing: the languages endpoint is not billed.
 */
export const verifyKey = (): Promise<number> => invoke("verify_key");

// ---- Translating ------------------------------------------------------------

/** Index signature so `invoke` accepts it directly as its argument record. */
export interface TranslateRequest extends Record<string, unknown> {
  text: string;
  sourceLang: string;
  targetLang: string;
}

export const translate = (req: TranslateRequest): Promise<Translation> =>
  invoke("translate_text", req);

/** Google's own list of what it will translate. Needs a working key. */
export const listLanguages = (): Promise<Language[]> => invoke("list_languages");

/** Lingo's own count of what this month has cost, and the free tier it eats. */
export const fetchUsage = (): Promise<Usage> => invoke("usage_today");

/** Longest text Lingo will translate in one go, as Rust defines it. */
export const maxCharacters = (): Promise<number> => invoke("max_characters");

// ---- Windows ----------------------------------------------------------------

export const hidePop = (): Promise<void> => invoke("hide_pop");

export const openDesk = (): Promise<void> => invoke("open_desk");

export const dbUrl = (): Promise<string> => invoke("db_url");

export const suspendShortcut = (): Promise<void> => invoke("suspend_shortcut");

export const resumeShortcut = (): Promise<void> => invoke("resume_shortcut");

/** Whatever a rejected `invoke` threw, as a sentence worth showing. */
export function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "Something went wrong talking to Google.";
}

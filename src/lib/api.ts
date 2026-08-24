import { invoke } from "@tauri-apps/api/core";
import type {
  Languages,
  Settings,
  Translation,
  Usage,
} from "./types";

/**
 * Every call into Rust, in one place.
 *
 * Nothing here talks to DeepL directly: the key stays on the Rust side, and
 * DeepL sends no CORS headers, so a fetch from the webview would be refused
 * even if we wanted to.
 */

export const getSettings = (): Promise<Settings> => invoke("get_settings");

export const saveSettings = (next: Settings): Promise<Settings> =>
  invoke("save_settings", { next });

export const hasKey = (): Promise<boolean> => invoke("has_key");

export const keyIsFree = (): Promise<boolean> => invoke("key_is_free");

/** Index signature so `invoke` accepts it directly as its argument record. */
export interface TranslateRequest extends Record<string, unknown> {
  text: string;
  sourceLang: string;
  targetLang: string;
  formality: string;
}

export const translate = (req: TranslateRequest): Promise<Translation> =>
  invoke("translate_text", req);

/** Test a key the user has typed but not saved. Resolves with its usage. */
export const verifyKey = (key: string): Promise<Usage> =>
  invoke("verify_key", { key });

export const fetchUsage = (): Promise<Usage> => invoke("deepl_usage");

export const fetchLanguages = (): Promise<Languages> =>
  invoke("deepl_languages");

export const hidePop = (): Promise<void> => invoke("hide_pop");

export const openDesk = (): Promise<void> => invoke("open_desk");

export const dbUrl = (): Promise<string> => invoke("db_url");

export const suspendShortcut = (): Promise<void> => invoke("suspend_shortcut");

export const resumeShortcut = (): Promise<void> => invoke("resume_shortcut");

/** Whatever a rejected `invoke` threw, as a sentence worth showing. */
export function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "Something went wrong talking to DeepL.";
}

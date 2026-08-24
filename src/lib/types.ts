/** Mirrors `Settings` in src-tauri/src/settings.rs (serialised camelCase). */
export interface Settings {
  apiKey: string;
  /** Target language code, e.g. "DE" or "EN-GB". */
  targetLang: string;
  /** Source language code; "" means let DeepL detect it. */
  sourceLang: string;
  formality: Formality;
  /** Tauri accelerator, e.g. "CommandOrControl+Shift+L". */
  hotkey: string;
  prefillClipboard: boolean;
  autoCopy: boolean;
  saveHistory: boolean;
  liveTranslate: boolean;
}

export type Formality = "default" | "prefer_more" | "prefer_less";

/** Mirrors `deepl::Translation`. */
export interface Translation {
  detectedSourceLanguage: string;
  text: string;
}

/** Mirrors `deepl::Usage`. */
export interface Usage {
  characterCount: number;
  characterLimit: number;
}

/** Mirrors `deepl::Language`. */
export interface Language {
  language: string;
  name: string;
  supportsFormality: boolean;
}

export interface Languages {
  source: Language[];
  target: Language[];
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

import type { Settings } from "./types";

/**
 * Which language pair a window opens with, and how a change to it is recorded.
 *
 * Two pairs live in the settings file. `sourceLang`/`targetLang` are the
 * *defaults* — what the Settings screen edits, and what Lingo falls back to.
 * `lastSourceLang`/`lastTargetLang` are the pair a window was *last used* with,
 * written as the user picks. `rememberLastLang` decides which of the two the
 * next window starts from.
 *
 * Keeping them apart is the point: switching to Japanese for one message should
 * not quietly redefine what "default" means, and switching back should not mean
 * retyping a default the user set months ago.
 */

export interface Pair {
  /** "" means "let Google detect it". */
  source: string;
  target: string;
}

/**
 * Whether a last-used pair has actually been recorded.
 *
 * The target is the field to ask, because a target is never empty while an
 * empty *source* is a real choice — "Detect language" — and the two are always
 * written together, so a target means both are trustworthy.
 */
function remembered(s: Settings): boolean {
  return Boolean(s.lastTargetLang);
}

/** The pair a freshly opened window should show. */
export function startPair(s: Settings): Pair {
  if (s.rememberLastLang && remembered(s)) {
    return { source: s.lastSourceLang, target: s.lastTargetLang };
  }
  return { source: s.sourceLang, target: s.targetLang };
}

/**
 * The settings to save so that `next` is what opens next time — or `null` when
 * there is nothing worth writing, either because Lingo is not remembering or
 * because that pair is already what is on disk.
 */
export function withLastPair(s: Settings, next: Pair): Settings | null {
  if (!s.rememberLastLang) return null;
  if (s.lastSourceLang === next.source && s.lastTargetLang === next.target) {
    return null;
  }
  return { ...s, lastSourceLang: next.source, lastTargetLang: next.target };
}

/**
 * The settings to save when a *default* is changed.
 *
 * The remembered pair is dropped along with it, so a default the user just set
 * by hand takes effect on the very next pop-up instead of losing to whatever
 * they happened to translate last week.
 */
export function withDefaultPair(s: Settings, next: Partial<Pair>): Settings {
  return {
    ...s,
    sourceLang: next.source ?? s.sourceLang,
    targetLang: next.target ?? s.targetLang,
    lastSourceLang: "",
    lastTargetLang: "",
  };
}

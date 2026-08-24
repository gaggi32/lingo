import type { Language, Languages } from "./types";

/**
 * A built-in copy of DeepL's language lists.
 *
 * The real lists are fetched from `/v2/languages` as soon as a key is
 * configured — DeepL adds languages, and hard-coding them would go stale. This
 * is what the pickers show before that: on first launch, offline, or while the
 * fetch is still in flight.
 */

const formal = (code: string) =>
  ["DE", "FR", "IT", "ES", "NL", "PL", "PT-BR", "PT-PT", "JA", "RU"].includes(
    code,
  );

function make(pairs: [string, string][]): Language[] {
  return pairs.map(([language, name]) => ({
    language,
    name,
    supportsFormality: formal(language),
  }));
}

export const FALLBACK_TARGETS = make([
  ["AR", "Arabic"],
  ["BG", "Bulgarian"],
  ["CS", "Czech"],
  ["DA", "Danish"],
  ["DE", "German"],
  ["EL", "Greek"],
  ["EN-GB", "English (British)"],
  ["EN-US", "English (American)"],
  ["ES", "Spanish"],
  ["ET", "Estonian"],
  ["FI", "Finnish"],
  ["FR", "French"],
  ["HE", "Hebrew"],
  ["HU", "Hungarian"],
  ["ID", "Indonesian"],
  ["IT", "Italian"],
  ["JA", "Japanese"],
  ["KO", "Korean"],
  ["LT", "Lithuanian"],
  ["LV", "Latvian"],
  ["NB", "Norwegian Bokmal"],
  ["NL", "Dutch"],
  ["PL", "Polish"],
  ["PT-BR", "Portuguese (Brazilian)"],
  ["PT-PT", "Portuguese (European)"],
  ["RO", "Romanian"],
  ["RU", "Russian"],
  ["SK", "Slovak"],
  ["SL", "Slovenian"],
  ["SV", "Swedish"],
  ["TH", "Thai"],
  ["TR", "Turkish"],
  ["UK", "Ukrainian"],
  ["VI", "Vietnamese"],
  ["ZH", "Chinese"],
]);

export const FALLBACK_SOURCES = make([
  ["AR", "Arabic"],
  ["BG", "Bulgarian"],
  ["CS", "Czech"],
  ["DA", "Danish"],
  ["DE", "German"],
  ["EL", "Greek"],
  ["EN", "English"],
  ["ES", "Spanish"],
  ["ET", "Estonian"],
  ["FI", "Finnish"],
  ["FR", "French"],
  ["HE", "Hebrew"],
  ["HU", "Hungarian"],
  ["ID", "Indonesian"],
  ["IT", "Italian"],
  ["JA", "Japanese"],
  ["KO", "Korean"],
  ["LT", "Lithuanian"],
  ["LV", "Latvian"],
  ["NB", "Norwegian Bokmal"],
  ["NL", "Dutch"],
  ["PL", "Polish"],
  ["PT", "Portuguese"],
  ["RO", "Romanian"],
  ["RU", "Russian"],
  ["SK", "Slovak"],
  ["SL", "Slovenian"],
  ["SV", "Swedish"],
  ["TH", "Thai"],
  ["TR", "Turkish"],
  ["UK", "Ukrainian"],
  ["VI", "Vietnamese"],
  ["ZH", "Chinese"],
]);

export const FALLBACK: Languages = {
  source: FALLBACK_SOURCES,
  target: FALLBACK_TARGETS,
};

/** The sentinel the pickers use for "let DeepL work it out". */
export const AUTO = "";

const CACHE_KEY = "lingo.languages";

/**
 * Language lists change perhaps twice a year, so the fetched copy is cached in
 * localStorage and used to seed the next launch — the pickers are populated
 * before the network call returns instead of flashing the fallback.
 */
export function cachedLanguages(): Languages {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return FALLBACK;
    const parsed = JSON.parse(raw) as Languages;
    if (!parsed.source?.length || !parsed.target?.length) return FALLBACK;
    return parsed;
  } catch {
    return FALLBACK;
  }
}

export function cacheLanguages(langs: Languages): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(langs));
  } catch {
    // A full or disabled localStorage costs us the cache, nothing more.
  }
}

/** Human-readable name for a code, falling back to the code itself. */
export function nameOf(list: Language[], code: string): string {
  if (!code) return "Detect";
  const hit = list.find((l) => l.language === code);
  if (hit) return hit.name;
  // A detected source ("EN") may not be in the target list ("EN-GB"/"EN-US"),
  // so try again on the base language before giving up.
  const base = code.split("-")[0];
  return list.find((l) => l.language.split("-")[0] === base)?.name ?? code;
}

/** Compact badge text: "EN-GB" stays, "Detect" becomes "auto". */
export function codeOf(code: string): string {
  return code || "auto";
}

/**
 * The source code to use after a swap. Target codes carry a region ("EN-GB")
 * that the source list does not accept, so it is dropped.
 */
export function toSourceCode(targetCode: string): string {
  return targetCode.split("-")[0];
}

/**
 * The target code to use after a swap. Some source codes are ambiguous as
 * targets — DeepL wants a variant of English and Portuguese — so pick one.
 */
export function toTargetCode(sourceCode: string, targets: Language[]): string {
  if (!sourceCode) return "";
  if (targets.some((t) => t.language === sourceCode)) return sourceCode;
  const variant = targets.find(
    (t) => t.language.split("-")[0] === sourceCode.split("-")[0],
  );
  return variant?.language ?? sourceCode;
}

export function supportsFormality(targets: Language[], code: string): boolean {
  return targets.find((t) => t.language === code)?.supportsFormality ?? false;
}

import { checkUpdate } from "./api";
import type { MissedRelease } from "./changelog";

/**
 * The once-a-day update check.
 *
 * Rust asks GitHub for the newest release (nothing else is sent); this module
 * decides when to ask and remembers the answer, so the desk window can show a
 * notice without asking again on every launch. Installing is either in the
 * app (installUpdate in api.ts) or the user's own download from the releases
 * page.
 */

const CHECKED_AT = "lingo.updateCheckedAt";
const LATEST = "lingo.updateLatest";
/**
 * `{ version, missed }` of the release last found, so the notes of every
 * release it brings can be shown. Before 1.2 it was `{ version, notes }`.
 */
const NOTES = "lingo.updateNotes";
const DAY = 24 * 60 * 60 * 1000;

/** Whether a day has passed since `last` (ms), or the clock went backwards. */
export function dueForCheck(last: number | null, now: number): boolean {
  if (last === null || !Number.isFinite(last)) return true;
  return now - last >= DAY || now < last;
}

function parse(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `latest` is a higher x.y.z than `current`. */
export function isNewer(latest: string | null, current: string): boolean {
  const l = latest ? parse(latest) : null;
  const c = parse(current);
  if (!l || !c) return false;
  for (let i = 0; i < 3; i++) {
    if (l[i] !== c[i]) return l[i] > c[i];
  }
  return false;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the check just runs again next launch */
  }
}

/** A newer release known from an earlier check: its version and what it brings. */
export interface KnownUpdate {
  version: string;
  /** Every release it brings, newest first, with its notes (see `check_update`). */
  missed: MissedRelease[];
}

function isMissedRelease(m: unknown): m is MissedRelease {
  if (typeof m !== "object" || m === null) return false;
  const { version, notes } = m as Record<string, unknown>;
  return typeof version === "string" && (typeof notes === "string" || notes === null);
}

/**
 * The releases stored for `version`, or none when the stored ones are for
 * another release or are not what {@link remember} writes. The shape written
 * before 1.2 (`{ version, notes }`, the newest release only) still reads, as
 * that one release.
 */
export function storedMissed(stored: string | null, version: string): MissedRelease[] {
  if (!stored) return [];
  try {
    const v: unknown = JSON.parse(stored);
    if (typeof v !== "object" || v === null) return [];
    const { version: of, missed, notes } = v as Record<string, unknown>;
    if (of !== version) return [];
    if (Array.isArray(missed)) return missed.filter(isMissedRelease);
    return typeof notes === "string" ? [{ version, notes }] : [];
  } catch {
    return [];
  }
}

/** A newer release already known from an earlier check, if there is one. */
export function knownUpdate(current: string): KnownUpdate | null {
  const latest = read(LATEST);
  if (!latest || !isNewer(latest, current)) return null;
  return { version: latest, missed: storedMissed(read(NOTES), latest) };
}

/** Remember what a check found (manual or automatic). */
export function remember(latest: string | null, missed: MissedRelease[]): void {
  write(CHECKED_AT, String(Date.now()));
  if (latest) {
    write(LATEST, latest);
    write(NOTES, JSON.stringify({ version: latest, missed }));
  }
}

/**
 * Check GitHub if a day has passed since the last check. Resolves with a newer
 * release, or null. Never throws: an offline machine or a repo with no public
 * release yet is not worth bothering anyone about.
 */
export async function dailyCheck(current: string): Promise<KnownUpdate | null> {
  const last = read(CHECKED_AT);
  if (dueForCheck(last === null ? null : Number(last), Date.now())) {
    try {
      const info = await checkUpdate();
      remember(info.latest, info.missed);
    } catch {
      write(CHECKED_AT, String(Date.now()));
    }
  }
  return knownUpdate(current);
}

/** The install button's text: null before it is pressed, then the progress. */
export function installLabel(version: string, progress: number | null): string {
  if (progress === null) return `Install ${version}`;
  if (progress < 0) return "Downloading…";
  if (progress >= 100) return "Installing…";
  return `Downloading ${Math.round(progress)}%`;
}

import { checkUpdate } from "./api";

/**
 * The once-a-day update check.
 *
 * Rust asks GitHub for the newest release (nothing else is sent); this module
 * decides when to ask and remembers the answer, so the desk window can show a
 * notice without asking again on every launch. Installing is always the
 * user's own download from the releases page.
 */

const CHECKED_AT = "lingo.updateCheckedAt";
const LATEST = "lingo.updateLatest";
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

/** A newer version already known from an earlier check, if there is one. */
export function knownNewer(current: string): string | null {
  const latest = read(LATEST);
  return isNewer(latest, current) ? latest : null;
}

/** Remember what a check found (manual or automatic). */
export function remember(latest: string | null): void {
  write(CHECKED_AT, String(Date.now()));
  if (latest) write(LATEST, latest);
}

/**
 * Check GitHub if a day has passed since the last check. Resolves with a newer
 * version, or null. Never throws: an offline machine or a repo with no public
 * release yet is not worth bothering anyone about.
 */
export async function dailyCheck(current: string): Promise<string | null> {
  const last = read(CHECKED_AT);
  if (dueForCheck(last === null ? null : Number(last), Date.now())) {
    try {
      const info = await checkUpdate();
      remember(info.latest);
    } catch {
      write(CHECKED_AT, String(Date.now()));
    }
  }
  return knownNewer(current);
}

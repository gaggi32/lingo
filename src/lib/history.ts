import Database from "@tauri-apps/plugin-sql";
import { dbUrl } from "./api";
import { notifyHistoryChanged } from "./events";
import type { HistoryEntry } from "./types";

/**
 * The local translation log.
 *
 * Only committed translations land here — pressing Enter, copying, or hitting
 * Translate in the desk window. Live-as-you-type results are deliberately not
 * recorded, or every keystroke would leave a row behind.
 */

/** Unpinned rows kept before the oldest are trimmed away. */
const KEEP_UNPINNED = 500;

let handle: Promise<Database> | null = null;

function db(): Promise<Database> {
  if (!handle) handle = dbUrl().then((url) => Database.load(url));
  return handle;
}

interface Row {
  id: number;
  source_text: string;
  target_text: string;
  source_lang: string;
  target_lang: string;
  pinned: number;
  created_at: string;
}

function toEntry(r: Row): HistoryEntry {
  return {
    id: r.id,
    sourceText: r.source_text,
    targetText: r.target_text,
    sourceLang: r.source_lang,
    targetLang: r.target_lang,
    pinned: r.pinned === 1,
    createdAt: r.created_at,
  };
}

export interface NewEntry {
  sourceText: string;
  targetText: string;
  sourceLang: string;
  targetLang: string;
}

export async function record(entry: NewEntry): Promise<void> {
  const d = await db();

  // Translating the same phrase again should move it back to the top rather
  // than stack up identical rows. Pinned copies are left alone.
  await d.execute(
    "DELETE FROM history WHERE pinned = 0 AND source_text = ?1 AND target_lang = ?2",
    [entry.sourceText, entry.targetLang],
  );
  await d.execute(
    `INSERT INTO history (source_text, target_text, source_lang, target_lang)
     VALUES (?1, ?2, ?3, ?4)`,
    [entry.sourceText, entry.targetText, entry.sourceLang, entry.targetLang],
  );
  await d.execute(
    `DELETE FROM history
      WHERE pinned = 0
        AND id NOT IN (
          SELECT id FROM history WHERE pinned = 0
           ORDER BY created_at DESC, id DESC LIMIT ${KEEP_UNPINNED}
        )`,
  );

  await notifyHistoryChanged();
}

/** Newest first, pinned entries floated to the top. `query` matches either side. */
export async function list(query = ""): Promise<HistoryEntry[]> {
  const d = await db();
  const q = query.trim();

  const rows = q
    ? await d.select<Row[]>(
        `SELECT * FROM history
          WHERE source_text LIKE ?1 OR target_text LIKE ?1
          ORDER BY pinned DESC, created_at DESC, id DESC`,
        [`%${q}%`],
      )
    : await d.select<Row[]>(
        "SELECT * FROM history ORDER BY pinned DESC, created_at DESC, id DESC",
      );

  return rows.map(toEntry);
}

export async function setPinned(id: number, pinned: boolean): Promise<void> {
  const d = await db();
  await d.execute("UPDATE history SET pinned = ?1 WHERE id = ?2", [
    pinned ? 1 : 0,
    id,
  ]);
  await notifyHistoryChanged();
}

export async function remove(id: number): Promise<void> {
  const d = await db();
  await d.execute("DELETE FROM history WHERE id = ?1", [id]);
  await notifyHistoryChanged();
}

/** Wipes everything that is not pinned. Pinned phrases are the user's shelf. */
export async function clearUnpinned(): Promise<void> {
  const d = await db();
  await d.execute("DELETE FROM history WHERE pinned = 0");
  await notifyHistoryChanged();
}

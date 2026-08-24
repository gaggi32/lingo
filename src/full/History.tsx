import { useCallback, useEffect, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  ClockIcon,
  CopyIcon,
  ExpandIcon,
  PinIcon,
  SearchIcon,
  TrashIcon,
  UnpinIcon,
} from "../components/icons";
import * as history from "../lib/history";
import { onHistoryChanged } from "../lib/events";
import type { HistoryEntry } from "../lib/types";

/**
 * SQLite writes `datetime('now')`, which is UTC without a marker. Parsed
 * naively that lands an hour or more off in most of the world.
 */
function parseStamp(raw: string): Date {
  return new Date(`${raw.replace(" ", "T")}Z`);
}

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});
const dateFmt = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});

function when(raw: string): string {
  const d = parseStamp(raw);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? timeFmt.format(d) : dateFmt.format(d);
}

export default function History({
  onOpen,
}: {
  onOpen: (entry: HistoryEntry) => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    history
      .list(query)
      .then((rows) => {
        setEntries(rows);
        setError("");
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, [query]);

  useEffect(refresh, [refresh]);

  // The pop-up writes to the same database from its own webview.
  useEffect(() => {
    const un = onHistoryChanged(refresh);
    return () => {
      un.then((f) => f());
    };
  }, [refresh]);

  const pinnedCount = entries.filter((e) => e.pinned).length;
  const clearable = entries.length - pinnedCount > 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200/80 px-5 py-3 dark:border-slate-800">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 focus-within:border-iris-400 focus-within:ring-4 focus-within:ring-iris-500/15 dark:border-slate-700 dark:bg-slate-900">
          <SearchIcon className="shrink-0 text-[14px] text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your translations"
            className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
        </div>

        <button
          type="button"
          onClick={() => void history.clearUnpinned()}
          disabled={!clearable}
          className="ghost shrink-0 disabled:opacity-40 disabled:hover:bg-transparent"
          title="Delete everything that isn't pinned"
        >
          <TrashIcon className="text-[14px]" />
          Clear
        </button>
      </header>

      <div className="tidy-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {error && (
          <p className="text-[13px] text-rose-600 dark:text-rose-400">
            Could not read the history database: {error}
          </p>
        )}

        {loaded && !error && entries.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <span className="accent-soft flex h-11 w-11 items-center justify-center rounded-xl">
              <ClockIcon className="text-[19px]" />
            </span>
            <p className="text-[14px] font-medium">
              {query ? "Nothing matches that." : "No translations yet."}
            </p>
            <p className="max-w-xs text-[12.5px] text-slate-500 dark:text-slate-400">
              {query
                ? "Try a shorter search."
                : "Translations you copy are saved here, so you can find that phrase again later."}
            </p>
          </div>
        )}

        <ul className="space-y-2">
          {entries.map((e) => (
            <li
              key={e.id}
              className="sheet group rounded-xl px-4 py-3 transition-shadow hover:shadow-md hover:shadow-slate-950/[0.06] dark:hover:shadow-black/30"
            >
              <div className="mb-1.5 flex items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
                <span className="font-mono uppercase tracking-wide">
                  {e.sourceLang || "auto"} → {e.targetLang}
                </span>
                <span>·</span>
                <span>{when(e.createdAt)}</span>

                <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => void history.setPinned(e.id, !e.pinned)}
                    className="ghost px-1.5 py-1"
                    title={e.pinned ? "Unpin" : "Pin to the top"}
                  >
                    {e.pinned ? (
                      <UnpinIcon className="text-[13px]" />
                    ) : (
                      <PinIcon className="text-[13px]" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void writeText(e.targetText)}
                    className="ghost px-1.5 py-1"
                    title="Copy the translation"
                  >
                    <CopyIcon className="text-[13px]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpen(e)}
                    className="ghost px-1.5 py-1"
                    title="Open in the translator"
                  >
                    <ExpandIcon className="text-[13px]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void history.remove(e.id)}
                    className="ghost px-1.5 py-1 hover:text-rose-600 dark:hover:text-rose-400"
                    title="Delete"
                  >
                    <TrashIcon className="text-[13px]" />
                  </button>
                </div>

                {e.pinned && (
                  <PinIcon className="text-[12px] text-iris-500 group-hover:hidden" />
                )}
              </div>

              <p className="line-clamp-2 text-[13px] text-slate-500 dark:text-slate-400">
                {e.sourceText}
              </p>
              <p className="mt-1 line-clamp-3 font-reading text-[14.5px] leading-relaxed">
                {e.targetText}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

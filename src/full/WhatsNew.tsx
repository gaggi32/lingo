import { useState } from "react";

import type { ChangelogEntry, ChangelogSection } from "../lib/changelog";
import { ChevronDownIcon } from "../components/icons";

interface Props {
  /** The running version, named in the title. */
  version: string;
  /** Newest first, from CHANGELOG.md (see `planWhatsNew`). */
  entries: ChangelogEntry[];
  /** Older versions were left off the card. */
  more: boolean;
  onDone: () => void;
}

/**
 * The card the desk window shows once after an update. Never in the pop-up:
 * that is for translating, and the desk window is where an update is noticed.
 * The newest version is open; older ones are a line each that opens on a click.
 */
export default function WhatsNew({ version, entries, more, onDone }: Props) {
  return (
    <section
      aria-labelledby="whats-new-title"
      className="sheet mx-5 mt-4 shrink-0 rounded-xl px-4 pb-4 pt-3.5"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="whats-new-title" className="text-[15px] font-semibold tracking-tight">
            What's new
          </h2>
          <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">
            Lingo {version}
            {entries.length > 1 && ` · ${entries.length} versions`}
          </p>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="accent accent-hover shrink-0 rounded-lg px-3 py-1 text-[12.5px] font-semibold transition"
        >
          Got it
        </button>
      </div>

      <div className="tidy-scroll mt-3 max-h-[45vh] overflow-y-auto pr-1">
        <ReleaseEntries entries={entries} />
        {more && (
          <p className="mt-2 text-[12px] text-slate-400 dark:text-slate-500">
            Earlier versions are in CHANGELOG.md on GitHub.
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Versions newest first: on the card, and for every release an update brings
 * before it is installed (Settings, and `compact` in the sidebar notice, where
 * it takes the notice's colour). With one version, just its changes (the title
 * around it names it); with several, the newest open and the rest folded.
 */
export function ReleaseEntries({
  entries,
  compact = false,
}: {
  entries: ChangelogEntry[];
  compact?: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(entries.slice(0, 1).map((e) => e.version)));
  if (entries.length === 1) return <ChangeSections sections={entries[0].sections} compact={compact} />;
  return (
    <div
      className={
        compact
          ? "divide-y divide-black/10 dark:divide-white/10"
          : "divide-y divide-slate-200/80 dark:divide-slate-700/60"
      }
    >
      {entries.map((entry) => {
        const isOpen = open.has(entry.version);
        const count = entry.sections.reduce((n, s) => n + s.items.length, 0);
        return (
          <div key={entry.version} className="py-1 first:pt-0 last:pb-0">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() =>
                setOpen((s) => {
                  const next = new Set(s);
                  if (isOpen) next.delete(entry.version);
                  else next.add(entry.version);
                  return next;
                })
              }
              className={
                compact
                  ? "flex w-full items-center gap-1.5 rounded-md py-1 text-left hover:bg-black/5 dark:hover:bg-white/5"
                  : "flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800/70"
              }
            >
              <ChevronDownIcon
                className={`shrink-0 opacity-50 transition-transform ${compact ? "text-[11px]" : "text-[13px]"} ${isOpen ? "" : "-rotate-90"}`}
              />
              <span className={`font-semibold tabular-nums ${compact ? "text-[11.5px]" : "text-[13px]"}`}>
                {entry.version}
              </span>
              {entry.date && !compact && (
                <span className="text-[12px] text-slate-400 dark:text-slate-500">{formatDate(entry.date)}</span>
              )}
              {!isOpen && (
                <span
                  className={`ml-auto ${compact ? "text-[11px] opacity-60" : "text-[12px] text-slate-400 dark:text-slate-500"}`}
                >
                  {count === 1 ? "1 change" : `${count} changes`}
                </span>
              )}
            </button>
            {isOpen && (
              <div className={compact ? "pb-1.5 pl-4 pt-1" : "pb-2 pl-6 pt-1.5"}>
                <ChangeSections sections={entry.sections} compact={compact} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const TAGS: Record<string, { label: string; cls: string }> = {
  added: { label: "New", cls: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300" },
  changed: { label: "Improved", cls: "bg-iris-500/10 text-iris-700 dark:bg-iris-400/15 dark:text-iris-200" },
  fixed: { label: "Fixed", cls: "bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300" },
  removed: { label: "Removed", cls: "bg-rose-500/10 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300" },
};
const OTHER = "bg-slate-500/10 text-slate-600 dark:bg-white/10 dark:text-slate-300";

/**
 * One version's changes: a coloured tag per kind ("New", "Improved",
 * "Fixed"…) and its items as a list. `compact` for the sidebar notice.
 */
export function ChangeSections({
  sections,
  compact = false,
}: {
  sections: ChangelogSection[];
  compact?: boolean;
}) {
  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {sections.map((section) => {
        const tag = TAGS[section.heading.toLowerCase()] ?? { label: section.heading, cls: OTHER };
        return (
          <div key={section.heading}>
            <span
              className={
                compact
                  ? "text-[10.5px] font-semibold uppercase tracking-wide opacity-75"
                  : `inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold tracking-wide ${tag.cls}`
              }
            >
              {tag.label}
            </span>
            <ul className={compact ? "mt-1 space-y-1" : "mt-1.5 space-y-1.5"}>
              {section.items.map((item, i) => (
                <li
                  key={i}
                  className={
                    compact
                      ? "relative pl-3 text-[11.5px] leading-snug before:absolute before:left-0.5 before:top-[0.55em] before:h-1 before:w-1 before:rounded-full before:bg-current before:opacity-40"
                      : "relative max-w-[70ch] pl-4 text-[13px] leading-relaxed text-slate-700 before:absolute before:left-1 before:top-[0.6em] before:h-1.5 before:w-1.5 before:rounded-full before:bg-slate-300 dark:text-slate-200 dark:before:bg-slate-600"
                  }
                >
                  {inline(item)}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** "2026-11-17" as "17 Nov 2026"; anything else as it is. */
function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** `code` spans as code; the rest as plain text, never as HTML. */
function inline(text: string) {
  return text.split("`").map((part, i) =>
    i % 2 === 1 ? (
      <code
        key={i}
        className="rounded bg-slate-900/[0.05] px-1 font-mono text-[11.5px] dark:bg-white/10"
      >
        {part}
      </code>
    ) : (
      part
    ),
  );
}

import type { ChangelogEntry } from "../lib/changelog";

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
 */
export default function WhatsNew({ version, entries, more, onDone }: Props) {
  // One version needs no sub-heading; the title already names it.
  const several = entries.length > 1;

  return (
    <section
      aria-labelledby="whats-new-title"
      className="sheet mx-5 mt-4 shrink-0 rounded-xl px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <h2
          id="whats-new-title"
          className="min-w-0 flex-1 truncate text-[13.5px] font-semibold tracking-tight"
        >
          What's new in {version}
        </h2>
        <button
          type="button"
          onClick={onDone}
          className="accent accent-hover shrink-0 rounded-lg px-3 py-1 text-[12.5px] font-semibold transition"
        >
          Got it
        </button>
      </div>

      <div className="tidy-scroll mt-2 max-h-44 space-y-2.5 overflow-y-auto pr-1">
        {entries.map((entry) => (
          <div key={entry.version}>
            {several && (
              <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                {entry.version}
                {entry.date && (
                  <span className="font-normal text-slate-400 dark:text-slate-500">
                    {" "}
                    · {entry.date}
                  </span>
                )}
              </p>
            )}
            {entry.sections.map((section) => (
              <div key={section.heading} className="mt-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {section.heading}
                </p>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[12.5px] leading-snug text-slate-600 marker:text-slate-300 dark:text-slate-300 dark:marker:text-slate-600">
                  {section.items.map((item, i) => (
                    <li key={i}>{inline(item)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
        {more && (
          <p className="text-[12px] text-slate-400 dark:text-slate-500">
            …and earlier changes.
          </p>
        )}
      </div>
    </section>
  );
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

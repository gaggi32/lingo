import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, SearchIcon } from "./icons";
import type { Language } from "../lib/types";

/**
 * Language selection, split into the trigger and the list so each window can
 * place them differently: the pop-up unrolls the list inline (the window grows
 * to fit it), while the desk window floats it as a popover.
 */

interface ListProps {
  languages: Language[];
  value: string;
  onPick: (code: string) => void;
  /** Adds a "Detect language" row at the top, selected as "". */
  allowAuto?: boolean;
  /** Rows to show before the list starts scrolling. */
  rows?: number;
}

export function LangList({
  languages,
  value,
  onPick,
  allowAuto = false,
  rows = 6,
}: ListProps) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return languages;
    return languages.filter(
      (l) =>
        l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q),
    );
  }, [languages, query]);

  const showAuto =
    allowAuto && (!query.trim() || "detect language".includes(query.trim().toLowerCase()));

  // Enter on a single match picks it — the fastest path for "de<Enter>".
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    if (matches.length > 0) onPick(matches[0].code);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-950/10 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/40">
      <div className="flex items-center gap-2 border-b border-slate-200/80 px-3 py-2 dark:border-slate-700/70">
        <SearchIcon className="shrink-0 text-[14px] text-slate-400" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search languages"
          className="w-full bg-transparent text-[13px] text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-50 dark:placeholder:text-slate-500"
        />
      </div>

      <div
        className="tidy-scroll overflow-y-auto p-1"
        style={{ maxHeight: `${rows * 34 + 8}px` }}
      >
        {showAuto && (
          <Row
            code="auto"
            name="Detect language"
            active={value === ""}
            onPick={() => onPick("")}
          />
        )}

        {matches.map((l) => (
          <Row
            key={l.code}
            code={l.code}
            name={l.name}
            active={value === l.code}
            onPick={() => onPick(l.code)}
          />
        ))}

        {matches.length === 0 && !showAuto && (
          <p className="px-2.5 py-3 text-center text-[13px] text-slate-400">
            No language matches that.
          </p>
        )}
      </div>
    </div>
  );
}

function Row({
  code,
  name,
  active,
  onPick,
}: {
  code: string;
  name: string;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={[
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] transition-colors",
        active
          ? "bg-iris-50 font-medium text-iris-700 dark:bg-iris-500/15 dark:text-iris-200"
          : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5",
      ].join(" ")}
    >
      <span className="w-12 shrink-0 font-mono text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {code}
      </span>
      <span className="truncate">{name}</span>
    </button>
  );
}

interface ButtonProps {
  label: string;
  code: string;
  open: boolean;
  onToggle: () => void;
  title?: string;
}

/** The pill that opens a picker. Shows the code, and the name when there's room. */
export function LangButton({ label, code, open, onToggle, title }: ButtonProps) {
  return (
    <button
      type="button"
      // The popover's outside-click listener is on `mousedown` (see
      // LangPopover) and this button sits outside the popover's own ref, so
      // a click here closes it a beat before `onClick` fires — without this,
      // that reopens it immediately, and a second click can never close it.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onToggle}
      title={title}
      className={[
        "inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
        open
          ? "bg-iris-50 text-iris-700 ring-1 ring-inset ring-iris-500/25 dark:bg-iris-500/15 dark:text-iris-200 dark:ring-iris-400/25"
          : "text-slate-600 hover:bg-slate-900/[0.06] dark:text-slate-300 dark:hover:bg-white/10",
      ].join(" ")}
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 font-mono text-[10px] uppercase opacity-50">
        {code}
      </span>
      <ChevronDownIcon
        className={`shrink-0 text-[13px] transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}

/** Floating variant for the desk window: the list, plus click-away to close. */
export function LangPopover({
  onClose,
  align = "left",
  children,
}: {
  onClose: () => void;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    // `mousedown` rather than `click`, so the list closes before a click
    // outside it lands on whatever is underneath.
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={`pop-in absolute top-[calc(100%+6px)] z-30 w-64 ${
        align === "right" ? "right-0" : "left-0"
      }`}
    >
      {children}
    </div>
  );
}

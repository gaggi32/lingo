import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, SearchIcon } from "./icons";
import { Kbd } from "./Kbd";
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

/** Row height in pixels — sizes the viewport, and sets how far a page jumps. */
const ROW_H = 34;

export function LangList({
  languages,
  value,
  onPick,
  allowAuto = false,
  rows = 6,
}: ListProps) {
  const [query, setQuery] = useState("");
  /** Which row the keyboard is on. Clamped where it is read — lists shrink. */
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

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

  /**
   * Everything the keyboard can land on, in the order it is drawn. "Detect
   * language" is a row like any other here, so Up from the first language
   * reaches it rather than stopping one short.
   */
  const options = useMemo<Language[]>(
    () =>
      showAuto ? [{ code: "", name: "Detect language" }, ...matches] : matches,
    [showAuto, matches],
  );

  // Opening with nothing typed puts the cursor on the language already in use,
  // so Down is a step from where you are. Typing puts it back on the best
  // match, so "de" then Enter still lands on German without an arrow key.
  useEffect(() => {
    if (query.trim()) {
      setCursor(0);
      return;
    }
    const at = options.findIndex((o) => o.code === value);
    setCursor(at < 0 ? 0 : at);
    // Re-seated when the list *changes shape* — a filter, or Google's live
    // language list arriving to replace the bundled one under an open picker —
    // but not on `options` itself, which is a new array every render and would
    // drag the cursor back onto the selected row mid-walk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, options.length]);

  const at = options.length === 0 ? -1 : Math.min(cursor, options.length - 1);

  // Keep the cursor row inside the scroll viewport. `nearest` scrolls by the
  // least amount that works, so walking down the list creeps a row at a time
  // instead of yanking each one into the middle.
  useEffect(() => {
    if (at < 0) return;
    listRef.current
      ?.querySelector(`[data-row="${at}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const move = (delta: number) => {
    if (options.length === 0) return;
    setCursor((c) => {
      const from = Math.min(c, options.length - 1);
      return Math.min(Math.max(from + delta, 0), options.length - 1);
    });
  };

  /**
   * The arrows walk the list; Enter takes whatever the cursor is on.
   *
   * Everything handled here is also stopped from propagating: both windows
   * listen for keys at the document level — Escape to dismiss, Enter to
   * translate — and a keystroke meant for the picker must not reach them.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const page = Math.max(1, rows - 1);
    switch (e.key) {
      case "ArrowDown":
        move(1);
        break;
      case "ArrowUp":
        move(-1);
        break;
      case "PageDown":
        move(page);
        break;
      case "PageUp":
        move(-page);
        break;
      case "Home":
        setCursor(0);
        break;
      case "End":
        setCursor(options.length - 1);
        break;
      case "Enter":
        if (at >= 0) onPick(options[at].code);
        break;
      default:
        return;
    }
    // Otherwise the arrows would walk the caret through the search box, and
    // Home and End would jump it to the ends of what was typed.
    e.preventDefault();
    e.stopPropagation();
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
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={at >= 0 ? `${listId}-${at}` : undefined}
          className="w-full bg-transparent text-[13px] text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-50 dark:placeholder:text-slate-500"
        />
      </div>

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        className="tidy-scroll overflow-y-auto p-1"
        style={{ maxHeight: `${rows * ROW_H + 8}px` }}
      >
        {options.map((o, i) => (
          <Row
            key={o.code || "auto"}
            id={`${listId}-${i}`}
            index={i}
            code={o.code || "auto"}
            name={o.name}
            active={value === o.code}
            cursor={i === at}
            onPick={() => onPick(o.code)}
          />
        ))}

        {options.length === 0 && (
          <p className="px-2.5 py-3 text-center text-[13px] text-slate-400">
            No language matches that.
          </p>
        )}
      </div>
    </div>
  );
}

function Row({
  id,
  index,
  code,
  name,
  active,
  cursor,
  onPick,
}: {
  id: string;
  index: number;
  code: string;
  name: string;
  /** The language currently in use. */
  active: boolean;
  /** Where the keyboard is. Independent of {@link active}. */
  cursor: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      data-row={index}
      role="option"
      aria-selected={active}
      // The search box keeps the focus so that typing keeps filtering, which
      // means the cursor row has to look focused without ever being it.
      tabIndex={-1}
      onClick={onPick}
      className={[
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] transition-colors",
        active
          ? "bg-iris-50 font-medium text-iris-700 dark:bg-iris-500/15 dark:text-iris-200"
          : cursor
            ? "bg-slate-100 text-slate-900 dark:bg-white/10 dark:text-slate-100"
            : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5",
        cursor ? "ring-1 ring-inset ring-iris-500/40 dark:ring-iris-400/40" : "",
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
  /** Key cap for the shortcut that also opens this picker, if there is one. */
  shortcut?: string;
}

/** The pill that opens a picker. Shows the code, and the name when there's room. */
export function LangButton({
  label,
  code,
  open,
  onToggle,
  title,
  shortcut,
}: ButtonProps) {
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
      {shortcut && <Kbd>{shortcut}</Kbd>}
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

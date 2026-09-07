import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
} from "@tauri-apps/api/window";
import { LangButton, LangList } from "../components/LangPicker";
import {
  AlertIcon,
  CheckIcon,
  CopyIcon,
  EnterIcon,
  ExpandIcon,
  KeyIcon,
  SwapIcon,
} from "../components/icons";
import {
  errorText,
  getSettings,
  hidePop,
  openDesk,
  translate,
} from "../lib/api";
import { onPopShow, onSettingsChanged } from "../lib/events";
import { nameOf, resolve } from "../lib/languages";
import { useKeyStatus } from "../lib/useKeyStatus";
import { useLanguages } from "../lib/useLanguages";
import { record } from "../lib/history";
import type { Settings, Translation } from "../lib/types";

/** Must match the `pop` window width in tauri.conf.json. */
const WIDTH = 560;
/** Breathing room around the card, so its shadow is not clipped. */
const PAD = 10;
/** Past this the card scrolls internally instead of growing further. */
const MAX_HEIGHT = 560;
/** How far down the screen the card is parked, as a share of the work area. */
const TOP_FRACTION = 0.2;

/** Idle time before a keystroke turns into a request. */
const DEBOUNCE_MS = 450;

type Picker = "source" | "target" | null;

export default function Pop() {
  // `getCurrentWindow()` mints a fresh handle on every call, so calling it
  // during render hands every dependency array below a new identity each time
  // — which turns the mount-only effects into every-render effects, and
  // `focusInput` into something that fights the user for the caret.
  const win = useMemo(() => getCurrentWindow(), []);
  const languages = useLanguages();
  const keyStatus = useKeyStatus();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("en");
  const [input, setInput] = useState("");
  const [result, setResult] = useState<Translation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState<Picker>(null);
  const [copied, setCopied] = useState(0);
  /** Bumped on every summon so the unfurl entrance replays. */
  const [appear, setAppear] = useState(0);

  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Height last pushed to the OS, so identical layouts don't re-resize. */
  const appliedHeight = useRef(0);
  /** Guards against a slow response overwriting a newer one. */
  const requestSeq = useRef(0);

  /** `null` means "not asked yet", which is not the same as "no key". */
  const needsKey = keyStatus !== null && !keyStatus.present;

  const focusInput = () =>
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });

  // ---- Settings ------------------------------------------------------------

  const loadSettings = useCallback(async () => {
    try {
      const s = await getSettings();
      setSettings(s);
      setSource(s.sourceLang);
      setTarget(s.targetLang);
      return s;
    } catch (err) {
      setError(errorText(err));
      return null;
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Settings saved in the desk window should take effect here without a restart.
  useEffect(() => {
    const un = onSettingsChanged(() => void loadSettings());
    return () => {
      un.then((f) => f());
    };
  }, [loadSettings]);

  // ---- Placement and sizing ------------------------------------------------

  /**
   * Park the card near the top of the work area, horizontally centred —
   * launcher placement rather than dead-centre, which would sit on top of
   * whatever the user is reading.
   *
   * Computed from the monitor alone, never from the window's current size, so
   * a summon that arrives mid-resize still lands in the same spot.
   */
  const place = useCallback(async () => {
    try {
      const mon = await currentMonitor();
      if (!mon) {
        await win.center();
        return;
      }
      const { position, size } = mon.workArea;
      const physicalWidth = Math.round((WIDTH + PAD * 2) * mon.scaleFactor);
      await win.setPosition(
        new PhysicalPosition(
          position.x + Math.round((size.width - physicalWidth) / 2),
          position.y + Math.round(size.height * TOP_FRACTION),
        ),
      );
    } catch {
      // A monitor query can fail while a display is being reconfigured;
      // centring is a perfectly good second choice.
      await win.center().catch(() => {});
    }
  }, [win]);

  /**
   * Grow and shrink the window to whatever the card currently needs. The card
   * is anchored at its top-left, so this unrolls downward — and if that would
   * run off the bottom of the screen, the window lifts just enough to fit.
   */
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const apply = (cardHeight: number) => {
      const height = Math.min(
        Math.ceil(cardHeight) + PAD * 2,
        MAX_HEIGHT + PAD * 2,
      );
      if (height === appliedHeight.current) return;
      appliedHeight.current = height;

      void (async () => {
        await win.setSize(new LogicalSize(WIDTH + PAD * 2, height));
        try {
          const mon = await currentMonitor();
          if (!mon) return;
          const pos = await win.outerPosition();
          const bottom = mon.workArea.position.y + mon.workArea.size.height;
          const overflow = pos.y + height * mon.scaleFactor - bottom;
          if (overflow > 0) {
            await win.setPosition(
              new PhysicalPosition(
                pos.x,
                Math.max(mon.workArea.position.y, pos.y - Math.ceil(overflow)),
              ),
            );
          }
        } catch {
          /* Placement is cosmetic; a failure here must not break translating. */
        }
      })();
    };

    const ro = new ResizeObserver((entries) => {
      apply(entries[0].contentRect.height);
    });
    ro.observe(card);
    apply(card.getBoundingClientRect().height);
    return () => ro.disconnect();
    // `appear` re-keys the card, so each summon hands us a brand new node —
    // without it here the observer would be left watching a detached one and
    // the window would stop sizing itself after the first summon.
  }, [win, appear]);

  // ---- Translating ---------------------------------------------------------

  const run = useCallback(
    async (text: string, from: string, to: string) => {
      const trimmed = text.trim();
      const seq = ++requestSeq.current;

      if (!trimmed) {
        setResult(null);
        setError("");
        setBusy(false);
        return;
      }

      setBusy(true);
      setError("");
      try {
        const t = await translate({
          text: trimmed,
          sourceLang: from,
          targetLang: to,
        });
        if (seq !== requestSeq.current) return; // superseded
        setResult(t);
        if (settings?.autoCopy) await writeText(t.text);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setError(errorText(err));
        setResult(null);
      } finally {
        if (seq === requestSeq.current) setBusy(false);
      }
    },
    [settings],
  );

  // Live translation: fire once the typing settles.
  useEffect(() => {
    if (!settings?.liveTranslate) return;
    if (needsKey) return;
    if (!input.trim()) {
      setResult(null);
      return;
    }
    const t = setTimeout(() => void run(input, source, target), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input, source, target, settings?.liveTranslate, needsKey, run]);

  // ---- Summoning -----------------------------------------------------------

  const reset = useCallback((seed: string) => {
    requestSeq.current++;
    setInput(seed);
    setResult(null);
    setError("");
    setBusy(false);
    setPicker(null);
    setCopied(0);
  }, []);

  useEffect(() => {
    const un = onPopShow(({ seed }) => {
      void (async () => {
        const s = await loadSettings();
        reset(seed ?? "");
        setAppear((n) => n + 1);
        await place();
        focusInput();
        // A seeded card should already be showing the answer by the time the
        // user has finished reading it, so skip the debounce.
        if (seed?.trim() && s && !needsKey) {
          void run(seed, s.sourceLang, s.targetLang);
        }
      })();
    });
    return () => {
      un.then((f) => f());
    };
  }, [loadSettings, needsKey, place, reset, run]);

  // First mount: position the (still hidden) window so the first summon does
  // not visibly jump into place. This runs once and must keep doing so — a
  // `place` that changes identity per render would re-steal the caret on every
  // keystroke, which is exactly what an unmemoised `win` used to cause.
  useEffect(() => {
    void place();
    focusInput();
  }, [place]);

  // ---- Actions -------------------------------------------------------------

  const detected = result?.detectedSourceLanguage ?? "";

  const dismiss = useCallback(async () => {
    setPicker(null);
    await hidePop();
  }, []);

  const commit = useCallback(async () => {
    if (!result) return;
    await writeText(result.text);
    setCopied((n) => n + 1);
    if (settings?.saveHistory) {
      try {
        await record({
          sourceText: input.trim(),
          targetText: result.text,
          sourceLang: detected || source || "auto",
          targetLang: target,
        });
      } catch (err) {
        // A history write must never cost the user their translation.
        console.error("Could not save to history:", err);
      }
    }
  }, [result, input, detected, source, target, settings?.saveHistory]);

  const commitAndClose = useCallback(async () => {
    await commit();
    await dismiss();
  }, [commit, dismiss]);

  /**
   * Swap the pair and carry the translation back into the input — the natural
   * next move when you are going back and forth with someone. On Detect there
   * is nothing to swap into until something has actually been detected.
   */
  const swappable = Boolean(source || detected);

  const swap = useCallback(() => {
    if (!swappable) return;
    setSource(target);
    setTarget(resolve(languages, source || detected));
    if (result) {
      setInput(result.text);
      setResult(null);
    }
    setPicker(null);
    focusInput();
  }, [languages, source, target, detected, result, swappable]);

  const expand = useCallback(async () => {
    await openDesk();
    await dismiss();
  }, [dismiss]);

  // Escape closes an open picker first, then the window. Never quits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (picker) setPicker(null);
      else void dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss, picker]);

  // Clear the copy confirmation a moment after it appears.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(0), 1300);
    return () => clearTimeout(t);
  }, [copied]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (needsKey) return;
    if (result) void commitAndClose();
    else void run(input, source, target);
  };

  // Auto-grow the textarea, up to a point; past that it scrolls. Driven by the
  // value rather than by onInput, so a clipboard seed or a swap sizes it too.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input, picker]);

  const sourceLabel = source ? nameOf(languages, source) : "Detect";
  const targetLabel = nameOf(languages, target);
  const detectedName = !source && detected ? nameOf(languages, detected) : "";

  return (
    <div className="h-screen w-screen p-2.5">
      <div
        key={appear}
        ref={cardRef}
        className="unfurl relative overflow-hidden rounded-[18px] border border-slate-200/80 bg-white/95 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)] backdrop-blur-xl dark:border-slate-700/60 dark:bg-slate-900/90"
      >
        {/* The accent spine: Lingo's one piece of colour, and the thing the
            entrance animation unrolls from. */}
        <div className="spine pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-iris-400 via-iris-500 to-iris-700" />

        <div className="settle pl-[3px]">
          {/* Header: the language pair, and a drag handle between the pills. */}
          <div className="flex items-center gap-1 px-2.5 pt-2.5">
            <LangButton
              label={sourceLabel}
              code={source || "auto"}
              open={picker === "source"}
              onToggle={() => setPicker((p) => (p === "source" ? null : "source"))}
              title="Translate from"
            />

            <button
              type="button"
              onClick={swap}
              disabled={!swappable}
              title={
                swappable
                  ? "Swap languages and reuse the translation"
                  : "Pick a source language, or translate once, before swapping"
              }
              className="ghost px-1.5 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <SwapIcon className="text-[14px]" />
            </button>

            <LangButton
              label={targetLabel}
              code={target}
              open={picker === "target"}
              onToggle={() => setPicker((p) => (p === "target" ? null : "target"))}
              title="Translate into"
            />

            {/* Empty stretch doubles as the window's drag region. */}
            <div className="h-7 flex-1" data-tauri-drag-region aria-hidden />

            {detectedName && (
              <span className="accent-soft hidden shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide sm:inline">
                {detectedName}
              </span>
            )}

            <button
              type="button"
              onClick={() => void expand()}
              title="Open the full window"
              className="ghost px-1.5"
            >
              <ExpandIcon className="text-[13px]" />
            </button>
          </div>

          {picker ? (
            <div className="pop-in p-2.5">
              <LangList
                languages={languages}
                value={picker === "source" ? source : target}
                allowAuto={picker === "source"}
                onPick={(code) => {
                  if (picker === "source") setSource(code);
                  else setTarget(code);
                  setPicker(null);
                  focusInput();
                }}
              />
            </div>
          ) : needsKey ? (
            <NoKey onOpenSettings={() => void expand()} />
          ) : (
            <>
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Type or paste something to translate"
                autoFocus
                className="tidy-scroll max-h-[140px] w-full bg-transparent px-4 pb-2.5 pt-2 text-[15px] leading-relaxed text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-50 dark:placeholder:text-slate-500"
              />

              {/* The divider doubles as the progress track while a request
                  is in flight — no spinner competing for attention. */}
              <div
                className={`relative mx-3.5 h-px overflow-hidden bg-slate-200 dark:bg-slate-700 ${
                  busy ? "scan" : ""
                }`}
              />

              {error ? (
                <p className="ink-in flex items-start gap-2 px-4 py-3 text-[13px] text-rose-600 dark:text-rose-400">
                  <AlertIcon className="mt-[3px] shrink-0 text-[14px]" />
                  <span data-selectable>{error}</span>
                </p>
              ) : result ? (
                <p
                  key={result.text}
                  data-selectable
                  className="ink-in tidy-scroll max-h-[220px] overflow-y-auto whitespace-pre-wrap px-4 py-3 font-reading text-[16px] leading-relaxed text-slate-900 dark:text-slate-100"
                >
                  {result.text}
                </p>
              ) : (
                <p className="px-4 py-3 text-[13px] text-slate-400 dark:text-slate-500">
                  {busy
                    ? "Translating…"
                    : input.trim()
                      ? "Press Enter to translate."
                      : "Nothing to translate yet."}
                </p>
              )}

              {/* Footer: what the keys do, and the explicit copy affordance. */}
              <div className="flex items-center gap-2 border-t border-slate-200/70 px-3 py-1.5 dark:border-slate-700/60">
                <span className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                  <EnterIcon className="text-[12px]" />
                  {result ? "copy & close" : "translate"}
                </span>
                <span className="text-[11px] text-slate-300 dark:text-slate-600">
                  ·
                </span>
                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                  Esc to dismiss
                </span>

                {copied > 0 && (
                  <span
                    key={copied}
                    className="confirm ml-1 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
                  >
                    <CheckIcon className="text-[12px]" strokeWidth={2.5} />
                    Copied
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => void commit()}
                  disabled={!result}
                  className="ghost ml-auto disabled:opacity-40 disabled:hover:bg-transparent"
                  title="Copy the translation"
                >
                  <CopyIcon className="text-[13px]" />
                  Copy
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The card before there is a key.
 *
 * The pop-up has nowhere to paste one — it is dismissed by its own blur, which
 * a paste dialog would trigger — so it says what is missing and hands over to
 * the desk window, which is where the field lives.
 */
function NoKey({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="px-4 pb-4 pt-2">
      <p className="flex items-center gap-2 text-[14px] font-medium text-slate-900 dark:text-slate-100">
        <KeyIcon className="text-[15px] text-iris-500" />
        Lingo needs a Google Cloud API key
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
        Add one in Settings and this card starts translating. Google&apos;s
        first 500,000 characters each month are free.
      </p>
      <button
        type="button"
        onClick={onOpenSettings}
        className="accent accent-hover mt-3 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition"
      >
        Open Settings
      </button>
    </div>
  );
}

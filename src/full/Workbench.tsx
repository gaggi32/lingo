import { useCallback, useEffect, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { LangButton, LangList, LangPopover } from "../components/LangPicker";
import {
  AlertIcon,
  CheckIcon,
  CopyIcon,
  CloseIcon,
  KeyIcon,
  SwapIcon,
} from "../components/icons";
import { errorText, maxCharacters, translate } from "../lib/api";
import { nameOf, resolve } from "../lib/languages";
import { useKeyStatus } from "../lib/useKeyStatus";
import { useLanguages } from "../lib/useLanguages";
import { record } from "../lib/history";
import type { HistoryEntry, Settings, Translation } from "../lib/types";

const DEBOUNCE_MS = 600;

/**
 * Fallback until Rust answers with the real figure, which lives in `google.rs`
 * so the cap is defined once rather than in two languages.
 */
const FALLBACK_MAX_CHARS = 5000;

interface Props {
  settings: Settings;
  save: (next: Settings) => Promise<Settings>;
  /** A history row the user asked to reopen here. */
  handoff: HistoryEntry | null;
  onHandoffUsed: () => void;
  /** Take the user to where the API key is entered. */
  onOpenSettings: () => void;
}

export default function Workbench({
  settings,
  save,
  handoff,
  onHandoffUsed,
  onOpenSettings,
}: Props) {
  const languages = useLanguages();
  const keyStatus = useKeyStatus();

  const [source, setSource] = useState(settings.sourceLang);
  const [target, setTarget] = useState(settings.targetLang);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<Translation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState<"source" | "target" | null>(null);
  const [copied, setCopied] = useState(0);
  const [maxChars, setMaxChars] = useState(FALLBACK_MAX_CHARS);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const requestSeq = useRef(0);

  /** `null` means "not asked yet", which is not the same as "no key". */
  const needsKey = keyStatus !== null && !keyStatus.present;

  useEffect(() => {
    maxCharacters()
      .then(setMaxChars)
      .catch(() => {
        /* The fallback is the same number; it just isn't authoritative. */
      });
  }, []);

  // Keep the pair in step when Settings (or the pop-up) changes the defaults.
  useEffect(() => {
    setSource(settings.sourceLang);
    setTarget(settings.targetLang);
  }, [settings.sourceLang, settings.targetLang]);

  // Reopening a history row loads its exact pair as well as its text, so
  // re-running it gives the same answer.
  useEffect(() => {
    if (!handoff) return;
    setInput(handoff.sourceText);
    // A stored row is a record of an answer, not the answer itself, so the
    // target pane stays empty until it is translated again.
    setResult(null);
    setTarget(handoff.targetLang);
    setError("");
    onHandoffUsed();
    inputRef.current?.focus();
  }, [handoff, onHandoffUsed]);

  const run = useCallback(
    async (text: string, from: string, to: string, remember: boolean) => {
      const trimmed = text.trim();
      const seq = ++requestSeq.current;

      if (!trimmed) {
        setResult(null);
        setError("");
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
        if (seq !== requestSeq.current) return; // a newer request won
        setResult(t);
        if (settings.autoCopy) await writeText(t.text);
        if (remember && settings.saveHistory) {
          await record({
            sourceText: trimmed,
            targetText: t.text,
            sourceLang: t.detectedSourceLanguage || from || "auto",
            targetLang: to,
          });
        }
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setError(errorText(err));
        setResult(null);
      } finally {
        if (seq === requestSeq.current) setBusy(false);
      }
    },
    [settings.autoCopy, settings.saveHistory],
  );

  const over = input.trim().length > maxChars;

  // Live translation. Deliberately does not write history — only a deliberate
  // Translate or a copy does, so the log stays a record of what mattered.
  useEffect(() => {
    if (!settings.liveTranslate) return;
    if (!input.trim()) {
      setResult(null);
      return;
    }
    // Past the cap every request would be refused; there is no sense spending
    // a round trip per keystroke to be told so.
    if (input.trim().length > maxChars) return;
    // Without a key every request fails the same way, and the pane already says
    // so in words worth more than a repeated error.
    if (needsKey) return;

    const t = setTimeout(
      () => void run(input, source, target, false),
      DEBOUNCE_MS,
    );
    return () => clearTimeout(t);
  }, [input, source, target, settings.liveTranslate, maxChars, needsKey, run]);

  const detected = result?.detectedSourceLanguage ?? "";

  const pickSource = (code: string) => {
    setSource(code);
    setPicker(null);
    void save({ ...settings, sourceLang: code });
  };

  const pickTarget = (code: string) => {
    setTarget(code);
    setPicker(null);
    void save({ ...settings, targetLang: code });
  };

  /**
   * Flip the pair and carry the translation back into the input. With the
   * source on Detect there is nothing to flip into until something has been
   * detected, which is why the button waits for a result.
   */
  const swappable = Boolean(source || detected);

  const swap = () => {
    if (!swappable) return;
    const nextSource = target;
    const nextTarget = resolve(languages, source || detected);
    setSource(nextSource);
    setTarget(nextTarget);
    if (result) {
      setInput(result.text);
      setResult(null);
    }
    void save({ ...settings, sourceLang: nextSource, targetLang: nextTarget });
  };

  const copy = async (text: string) => {
    await writeText(text);
    setCopied((n) => n + 1);
    if (settings.saveHistory) {
      try {
        await record({
          sourceText: input.trim(),
          targetText: text,
          sourceLang: detected || source || "auto",
          targetLang: target,
        });
      } catch (err) {
        console.error("Could not save to history:", err);
      }
    }
  };

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(0), 1300);
    return () => clearTimeout(t);
  }, [copied]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!over) void run(input, source, target, true);
    }
  };

  const detectedName = !source && detected ? nameOf(languages, detected) : "";

  return (
    <div className="flex h-full flex-col">
      {/* ---- Language bar -------------------------------------------------- */}
      <header className="flex flex-wrap items-center gap-1.5 border-b border-slate-200/80 px-5 py-3 dark:border-slate-800">
        <div className="relative">
          <LangButton
            label={source ? nameOf(languages, source) : "Detect language"}
            code={source || "auto"}
            open={picker === "source"}
            onToggle={() => setPicker((p) => (p === "source" ? null : "source"))}
          />
          {picker === "source" && (
            <LangPopover onClose={() => setPicker(null)}>
              <LangList
                languages={languages}
                value={source}
                allowAuto
                rows={8}
                onPick={pickSource}
              />
            </LangPopover>
          )}
        </div>

        <button
          type="button"
          onClick={swap}
          disabled={!swappable}
          title={
            swappable
              ? "Swap languages and reuse the translation"
              : "Pick a source language, or translate once, before swapping"
          }
          className="ghost px-2 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <SwapIcon className="text-[15px]" />
        </button>

        <div className="relative">
          <LangButton
            label={nameOf(languages, target)}
            code={target}
            open={picker === "target"}
            onToggle={() => setPicker((p) => (p === "target" ? null : "target"))}
          />
          {picker === "target" && (
            <LangPopover onClose={() => setPicker(null)}>
              <LangList
                languages={languages}
                value={target}
                rows={8}
                onPick={pickTarget}
              />
            </LangPopover>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {busy && (
            <span className="text-[12px] text-slate-400 dark:text-slate-500">
              Translating…
            </span>
          )}
          {!settings.liveTranslate && (
            <button
              type="button"
              onClick={() => void run(input, source, target, true)}
              disabled={!input.trim() || over || busy}
              className="accent accent-hover rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40"
            >
              Translate
            </button>
          )}
        </div>
      </header>

      {/* ---- Panes --------------------------------------------------------- */}
      <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-slate-200/80 md:grid-cols-2 md:divide-x md:divide-y-0 dark:divide-slate-800">
        {/* Source */}
        <section className="flex min-h-0 flex-col">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type or paste text here"
            autoFocus
            className="tidy-scroll min-h-0 flex-1 resize-none bg-transparent px-5 py-4 text-[15px] leading-relaxed outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
          <div className="flex items-center gap-3 px-5 pb-3 pt-1">
            <span
              className={[
                "text-[11.5px] tabular-nums",
                over
                  ? "font-medium text-rose-600 dark:text-rose-400"
                  : "text-slate-400 dark:text-slate-500",
              ].join(" ")}
            >
              {input.trim().length.toLocaleString()}
              {over && ` / ${maxChars.toLocaleString()} max`}
            </span>
            {input && (
              <button
                type="button"
                onClick={() => {
                  setInput("");
                  setResult(null);
                  setError("");
                  inputRef.current?.focus();
                }}
                className="ghost ml-auto"
              >
                <CloseIcon className="text-[13px]" />
                Clear
              </button>
            )}
          </div>
        </section>

        {/* Target */}
        <section className="flex min-h-0 flex-col bg-white/40 dark:bg-slate-950/30">
          <div className="tidy-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {needsKey ? (
              <NoKey onOpenSettings={onOpenSettings} />
            ) : error ? (
              <p className="ink-in flex items-start gap-2 text-[14px] text-rose-600 dark:text-rose-400">
                <AlertIcon className="mt-[3px] shrink-0 text-[15px]" />
                <span>{error}</span>
              </p>
            ) : result ? (
              <p
                key={result.text}
                className="ink-in whitespace-pre-wrap font-reading text-[16px] leading-relaxed"
              >
                {result.text}
              </p>
            ) : (
              <p className="text-[14px] text-slate-400 dark:text-slate-500">
                {over
                  ? `That is longer than the ${maxChars.toLocaleString()} characters Lingo translates in one go.`
                  : settings.liveTranslate
                    ? "The translation appears here as you type."
                    : "Press Translate, or Ctrl+Enter."}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 px-5 pb-3 pt-1">
            {detectedName && (
              <span className="accent-soft rounded-md px-2 py-0.5 text-[11px] font-medium">
                Detected {detectedName}
              </span>
            )}
            {copied > 0 && (
              <span
                key={copied}
                className="confirm inline-flex items-center gap-1 text-[12px] font-medium text-emerald-600 dark:text-emerald-400"
              >
                <CheckIcon className="text-[13px]" strokeWidth={2.5} />
                Copied
              </span>
            )}
            <button
              type="button"
              onClick={() => result && void copy(result.text)}
              disabled={!result}
              className="ghost ml-auto disabled:opacity-40 disabled:hover:bg-transparent"
              title="Copy the translation and save it to History"
            >
              <CopyIcon className="text-[13px]" />
              Copy
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * What the target pane says before there is a key.
 *
 * Deliberately not an error: nothing has gone wrong, there is simply a step
 * left, and the button goes straight to where that step happens.
 */
function NoKey({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="max-w-sm">
      <p className="flex items-center gap-2 text-[14px] font-medium">
        <KeyIcon className="text-[15px] text-iris-500" />
        Lingo needs a Google Cloud API key
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
        One key, pasted once, and the hotkey works everywhere. Google&apos;s
        first 500,000 characters each month are free.
      </p>
      <button
        type="button"
        onClick={onOpenSettings}
        className="accent accent-hover mt-3 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition"
      >
        Add a key
      </button>
    </div>
  );
}

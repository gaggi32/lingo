import { useCallback, useEffect, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { LangButton, LangList, LangPopover } from "../components/LangPicker";
import {
  AlertIcon,
  CheckIcon,
  CopyIcon,
  CloseIcon,
  SwapIcon,
} from "../components/icons";
import { errorText, translate } from "../lib/api";
import {
  nameOf,
  supportsFormality,
  toSourceCode,
  toTargetCode,
} from "../lib/languages";
import { record } from "../lib/history";
import { useLanguages } from "../lib/useLanguages";
import type { Formality, HistoryEntry, Settings } from "../lib/types";

const DEBOUNCE_MS = 600;

/** DeepL caps a single request; well short of it is a better place to stop. */
const MAX_CHARS = 5000;

const FORMALITY: { id: Formality; label: string }[] = [
  { id: "prefer_less", label: "Casual" },
  { id: "default", label: "Neutral" },
  { id: "prefer_more", label: "Formal" },
];

interface Props {
  settings: Settings;
  save: (next: Settings) => Promise<Settings>;
  /** A history row the user asked to reopen here. */
  handoff: HistoryEntry | null;
  onHandoffUsed: () => void;
}

export default function Workbench({
  settings,
  save,
  handoff,
  onHandoffUsed,
}: Props) {
  const languages = useLanguages();

  const [source, setSource] = useState(settings.sourceLang);
  const [target, setTarget] = useState(settings.targetLang);
  const [input, setInput] = useState("");
  const [result, setResult] = useState("");
  const [detected, setDetected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState<"source" | "target" | null>(null);
  const [copied, setCopied] = useState(0);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const requestSeq = useRef(0);

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
    setResult(handoff.targetText);
    setDetected(handoff.sourceLang);
    setTarget(handoff.targetLang);
    setError("");
    onHandoffUsed();
    inputRef.current?.focus();
  }, [handoff, onHandoffUsed]);

  const formality: Formality = supportsFormality(languages.target, target)
    ? settings.formality
    : "default";

  const run = useCallback(
    async (text: string, from: string, to: string, remember: boolean) => {
      const trimmed = text.trim();
      const seq = ++requestSeq.current;

      if (!trimmed) {
        setResult("");
        setDetected("");
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
          formality: supportsFormality(languages.target, to)
            ? settings.formality
            : "default",
        });
        if (seq !== requestSeq.current) return; // a newer request won
        setResult(t.text);
        setDetected(t.detectedSourceLanguage);
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
        setResult("");
      } finally {
        if (seq === requestSeq.current) setBusy(false);
      }
    },
    [languages.target, settings.formality, settings.autoCopy, settings.saveHistory],
  );

  // Live translation. Deliberately does not write history — only a deliberate
  // Translate or a copy does, so the log stays a record of what mattered.
  useEffect(() => {
    if (!settings.liveTranslate) return;
    if (!input.trim()) {
      setResult("");
      setDetected("");
      return;
    }
    const t = setTimeout(
      () => void run(input, source, target, false),
      DEBOUNCE_MS,
    );
    return () => clearTimeout(t);
  }, [input, source, target, settings.liveTranslate, run]);

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

  const swap = () => {
    const nextSource = toSourceCode(target);
    const nextTarget = toTargetCode(source || detected, languages.target);
    setSource(nextSource);
    if (nextTarget) setTarget(nextTarget);
    if (result) {
      setInput(result);
      setResult("");
      setDetected("");
    }
    void save({
      ...settings,
      sourceLang: nextSource,
      targetLang: nextTarget || settings.targetLang,
    });
  };

  const copy = async () => {
    if (!result) return;
    await writeText(result);
    setCopied((n) => n + 1);
    if (settings.saveHistory) {
      try {
        await record({
          sourceText: input.trim(),
          targetText: result,
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
      void run(input, source, target, true);
    }
  };

  const over = input.length > MAX_CHARS;
  const detectedName =
    !source && detected ? nameOf(languages.source, detected) : "";

  return (
    <div className="flex h-full flex-col">
      {/* ---- Language bar -------------------------------------------------- */}
      <header className="flex flex-wrap items-center gap-1.5 border-b border-slate-200/80 px-5 py-3 dark:border-slate-800">
        <div className="relative">
          <LangButton
            label={source ? nameOf(languages.source, source) : "Detect language"}
            code={source || "auto"}
            open={picker === "source"}
            onToggle={() => setPicker((p) => (p === "source" ? null : "source"))}
          />
          {picker === "source" && (
            <LangPopover onClose={() => setPicker(null)}>
              <LangList
                languages={languages.source}
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
          title="Swap languages and reuse the translation"
          className="ghost px-2"
        >
          <SwapIcon className="text-[15px]" />
        </button>

        <div className="relative">
          <LangButton
            label={nameOf(languages.target, target)}
            code={target}
            open={picker === "target"}
            onToggle={() => setPicker((p) => (p === "target" ? null : "target"))}
          />
          {picker === "target" && (
            <LangPopover onClose={() => setPicker(null)}>
              <LangList
                languages={languages.target}
                value={target}
                rows={8}
                onPick={pickTarget}
              />
            </LangPopover>
          )}
        </div>

        {supportsFormality(languages.target, target) && (
          <div className="ml-3 flex items-center gap-1 rounded-lg bg-slate-900/[0.05] p-0.5 dark:bg-white/5">
            {FORMALITY.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => void save({ ...settings, formality: id })}
                className={[
                  "rounded-[6px] px-2 py-1 text-[12px] font-medium transition-colors",
                  formality === id
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-50"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
        )}

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
              {input.length.toLocaleString()}
              {over && ` / ${MAX_CHARS.toLocaleString()} max`}
            </span>
            {input && (
              <button
                type="button"
                onClick={() => {
                  setInput("");
                  setResult("");
                  setDetected("");
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
            {error ? (
              <p className="ink-in flex items-start gap-2 text-[14px] text-rose-600 dark:text-rose-400">
                <AlertIcon className="mt-[3px] shrink-0 text-[15px]" />
                <span>{error}</span>
              </p>
            ) : result ? (
              <p
                key={result}
                className="ink-in whitespace-pre-wrap font-reading text-[16px] leading-relaxed"
              >
                {result}
              </p>
            ) : (
              <p className="text-[14px] text-slate-400 dark:text-slate-500">
                {settings.liveTranslate
                  ? "The translation appears here as you type."
                  : "Press Translate, or Ctrl+Enter."}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 px-5 pb-3 pt-1">
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
              onClick={() => void copy()}
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

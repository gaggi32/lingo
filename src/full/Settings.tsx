import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as autostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { LangButton, LangList, LangPopover } from "../components/LangPicker";
import {
  AlertIcon,
  CheckIcon,
  ExternalIcon,
  EyeIcon,
  EyeOffIcon,
  KeyIcon,
  KeyboardIcon,
  ResetIcon,
} from "../components/icons";
import {
  clearApiKey,
  errorText,
  resumeShortcut,
  setApiKey,
  suspendShortcut,
  verifyKey,
} from "../lib/api";
import { acceleratorToKeys, eventToChord } from "../lib/shortcut";
import { nameOf } from "../lib/languages";
import { useKeyStatus } from "../lib/useKeyStatus";
import { useLanguages } from "../lib/useLanguages";
import type { Settings } from "../lib/types";

/** Where a key is made. */
const CREDENTIALS = "https://console.cloud.google.com/apis/credentials";
/** The API that has to be switched on before a key will translate anything. */
const ENABLE_API =
  "https://console.cloud.google.com/apis/library/translate.googleapis.com";
/** What it costs once the free half-million characters are gone. */
const PRICING = "https://cloud.google.com/translate/pricing";

const DEFAULT_HOTKEY = "CommandOrControl+Shift+L";

interface Props {
  settings: Settings;
  save: (next: Settings) => Promise<Settings>;
}

export default function SettingsPanel({ settings, save }: Props) {
  return (
    <div className="tidy-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-8 px-6 py-6">
        <KeySection />
        <TranslationSection settings={settings} save={save} />
        <PopupSection settings={settings} save={save} />
        <SystemSection />
        <AboutSection />
      </div>
    </div>
  );
}

// ---- Layout helpers ---------------------------------------------------------

function Section({
  title,
  hint,
  raised,
  children,
}: {
  title: string;
  hint?: string;
  /**
   * Lifts this card (and everything it contains) above the other Sections.
   *
   * Every card is its own stacking context — `.sheet` sets `backdrop-blur`,
   * and `backdrop-filter` creates one — so a popover floated inside one card
   * can never out-rank a *later* card no matter its z-index: the comparison
   * happens one level up, between the cards themselves, and DOM order decides
   * ties there. A card that is currently floating a popover needs to win that
   * outer comparison too, which is what this does.
   */
  raised?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={raised ? "relative z-10" : undefined}>
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </h2>
      {hint && (
        <p className="mt-1 text-[12.5px] text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      )}
      <div className="sheet mt-3 divide-y divide-slate-200/70 rounded-xl dark:divide-slate-700/60">
        {children}
      </div>
    </section>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium">{label}</p>
        {description && (
          <p className="mt-0.5 text-[12.5px] leading-snug text-slate-500 dark:text-slate-400">
            {description}
          </p>
        )}
      </div>
      {children && <div className="shrink-0 pt-0.5">{children}</div>}
    </div>
  );
}

/**
 * A switch, drawn rather than borrowed from the platform.
 *
 * The knob is anchored with an explicit `left-0` and only ever moved by a
 * transform. Leaving `left` unset would place it at its static position, which
 * inside a `<button>` means the middle of the track — the browser's default
 * `text-align: center` applies to the abspos origin too — so it would sit off
 * its rail and slide the wrong distance.
 */
function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={[
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full",
        "ring-1 ring-inset transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-iris-500/40",
        on
          ? "bg-iris-500 ring-iris-600/20 hover:bg-iris-400 dark:bg-iris-500 dark:ring-black/20"
          : "bg-slate-300 ring-slate-900/10 hover:bg-slate-400 dark:bg-slate-700 dark:ring-white/10 dark:hover:bg-slate-600",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={[
          "pointer-events-none absolute left-0 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full",
          "bg-white shadow-md ring-1 ring-slate-900/10 transition-transform duration-200 ease-out",
          on ? "translate-x-[22px]" : "translate-x-[2px]",
        ].join(" ")}
      />
    </button>
  );
}

function Link({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => void openUrl(url)}
      className="inline-flex items-center gap-1 text-[12.5px] font-medium text-iris-600 transition-colors hover:text-iris-700 dark:text-iris-300 dark:hover:text-iris-200"
    >
      {children}
      <ExternalIcon className="text-[12px]" />
    </button>
  );
}

// ---- The API key ------------------------------------------------------------

/**
 * The one thing Lingo cannot work without, so it comes first and says what to
 * do rather than what is wrong.
 *
 * The key is write-only from here: Rust never sends it back, so a saved key is
 * shown as its last four characters and can be replaced or removed but not
 * read. That is deliberate — see the module docs in `settings.rs`.
 */
function KeySection() {
  const status = useKeyStatus();
  const [draft, setDraft] = useState("");
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<"idle" | "checking" | "ok" | "bad">("idle");
  const [message, setMessage] = useState("");

  const saved = status?.present ?? false;

  const submit = async () => {
    setState("checking");
    setMessage("");
    try {
      await setApiKey(draft);
      setDraft("");
      setVisible(false);
      const count = await verifyKey();
      setState("ok");
      setMessage(
        `Google accepted it — ${count.toLocaleString()} languages available.`,
      );
    } catch (err) {
      setState("bad");
      setMessage(errorText(err));
    }
  };

  const remove = async () => {
    setDraft("");
    setState("idle");
    setMessage("");
    try {
      await clearApiKey();
    } catch (err) {
      setState("bad");
      setMessage(errorText(err));
    }
  };

  /** Re-check the key already saved, without retyping it. */
  const recheck = async () => {
    setState("checking");
    setMessage("");
    try {
      const count = await verifyKey();
      setState("ok");
      setMessage(
        `That key still works — ${count.toLocaleString()} languages available.`,
      );
    } catch (err) {
      setState("bad");
      setMessage(errorText(err));
    }
  };

  return (
    <Section
      title="Google Cloud"
      hint="Lingo translates through the Google Cloud Translation API. It needs a key
            from a Google Cloud project with that API enabled and billing set up —
            the first 500,000 characters each month are free."
    >
      <div className="px-4 py-3">
        <label htmlFor="gc-key" className="mb-1.5 block text-[13.5px] font-medium">
          API key
        </label>

        {saved ? (
          <p className="mb-2 flex flex-wrap items-center gap-1.5 text-[12.5px] leading-snug text-slate-500 dark:text-slate-400">
            <CheckIcon
              className="text-[13px] text-emerald-600 dark:text-emerald-400"
              strokeWidth={2.5}
            />
            A key ending
            <code className="rounded bg-slate-100 px-1 py-px font-mono text-[11.5px] dark:bg-white/5">
              {status?.hint}
            </code>
            is saved. Paste a new one below to replace it.
          </p>
        ) : (
          <p className="mb-2 text-[12.5px] leading-snug text-slate-500 dark:text-slate-400">
            Create one under <em>APIs &amp; Services → Credentials</em>, then
            enable the Cloud Translation API on the same project.
          </p>
        )}

        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              id="gc-key"
              type={visible ? "text" : "password"}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setState("idle");
                setMessage("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim()) void submit();
              }}
              placeholder={saved ? "Paste a replacement key" : "AIza…"}
              spellCheck={false}
              autoComplete="off"
              className="field w-full pr-9 font-mono text-[12.5px]"
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              title={visible ? "Hide the key" : "Show what you pasted"}
              aria-label={visible ? "Hide the key" : "Show the key"}
              className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
            >
              {visible ? (
                <EyeOffIcon className="text-[15px]" />
              ) : (
                <EyeIcon className="text-[15px]" />
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={() => void (draft.trim() ? submit() : recheck())}
            disabled={state === "checking" || (!draft.trim() && !saved)}
            className="accent accent-hover shrink-0 rounded-lg px-3.5 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {state === "checking"
              ? "Checking…"
              : draft.trim()
                ? "Save & check"
                : "Check"}
          </button>
        </div>

        {message && (
          <p
            className={[
              "mt-2 flex items-start gap-1.5 text-[12.5px] leading-snug",
              state === "ok"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400",
            ].join(" ")}
          >
            {state === "ok" ? (
              <CheckIcon
                className="mt-[2px] shrink-0 text-[13px]"
                strokeWidth={2.5}
              />
            ) : (
              <AlertIcon className="mt-[2px] shrink-0 text-[13px]" />
            )}
            <span>{message}</span>
          </p>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Link url={CREDENTIALS}>Create a key</Link>
          <Link url={ENABLE_API}>Enable the API</Link>
          <Link url={PRICING}>What it costs</Link>

          {saved && (
            <button
              type="button"
              onClick={() => void remove()}
              className="text-[12.5px] font-medium text-slate-500 transition-colors hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Remove it
            </button>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2.5 px-4 py-3 text-[12.5px] leading-snug text-slate-500 dark:text-slate-400">
        <KeyIcon className="mt-[2px] shrink-0 text-[14px]" />
        <p>
          Lingo keeps the key in its own config folder in plain text, and never
          hands it to the part of the app that draws the screen. It is still a
          billable credential: restrict it to the Cloud Translation API in the
          Cloud console, and set a quota, so a key that does get out cannot be
          spent on anything else.
        </p>
      </div>
    </Section>
  );
}

// ---- Translation ------------------------------------------------------------

function TranslationSection({ settings, save }: Props) {
  const [picker, setPicker] = useState<"source" | "target" | null>(null);
  const languages = useLanguages();

  return (
    <Section
      title="Translation"
      hint="What the pop-up starts with each time it opens."
      raised={picker !== null}
    >
      <Row label="Translate from">
        <div className="relative">
          <LangButton
            label={
              settings.sourceLang
                ? nameOf(languages, settings.sourceLang)
                : "Detect language"
            }
            code={settings.sourceLang || "auto"}
            open={picker === "source"}
            onToggle={() => setPicker((p) => (p === "source" ? null : "source"))}
          />
          {picker === "source" && (
            <LangPopover align="right" onClose={() => setPicker(null)}>
              <LangList
                languages={languages}
                value={settings.sourceLang}
                allowAuto
                rows={7}
                onPick={(code) => {
                  setPicker(null);
                  void save({ ...settings, sourceLang: code });
                }}
              />
            </LangPopover>
          )}
        </div>
      </Row>

      <Row label="Translate into">
        <div className="relative">
          <LangButton
            label={nameOf(languages, settings.targetLang)}
            code={settings.targetLang}
            open={picker === "target"}
            onToggle={() => setPicker((p) => (p === "target" ? null : "target"))}
          />
          {picker === "target" && (
            <LangPopover align="right" onClose={() => setPicker(null)}>
              <LangList
                languages={languages}
                value={settings.targetLang}
                rows={7}
                onPick={(code) => {
                  setPicker(null);
                  void save({ ...settings, targetLang: code });
                }}
              />
            </LangPopover>
          )}
        </div>
      </Row>
    </Section>
  );
}

// ---- Pop-up behaviour -------------------------------------------------------

function PopupSection({ settings, save }: Props) {
  return (
    <Section title="Pop-up">
      <Row
        label="Shortcut"
        description="Summons the translator over whatever you are doing. Press it again to dismiss."
      >
        <HotkeyRecorder settings={settings} save={save} />
      </Row>

      <Row
        label="Start from the clipboard"
        description="Opens with whatever you last copied, already translated. Long clippings are ignored rather than being billed for uninvited."
      >
        <Toggle
          label="Start from the clipboard"
          on={settings.prefillClipboard}
          onChange={(v) => void save({ ...settings, prefillClipboard: v })}
        />
      </Row>

      <Row
        label="Translate as you type"
        description="Off means nothing is sent to Google — and nothing is billed — until you press Enter."
      >
        <Toggle
          label="Translate as you type"
          on={settings.liveTranslate}
          onChange={(v) => void save({ ...settings, liveTranslate: v })}
        />
      </Row>

      <Row
        label="Copy automatically"
        description="Puts each translation on the clipboard the moment it arrives."
      >
        <Toggle
          label="Copy automatically"
          on={settings.autoCopy}
          onChange={(v) => void save({ ...settings, autoCopy: v })}
        />
      </Row>

      <Row
        label="Keep a history"
        description="Translations you copy are saved locally so you can find them again."
      >
        <Toggle
          label="Keep a history"
          on={settings.saveHistory}
          onChange={(v) => void save({ ...settings, saveHistory: v })}
        />
      </Row>
    </Section>
  );
}

function HotkeyRecorder({ settings, save }: Props) {
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);

  const stop = useCallback(async (restore: boolean) => {
    setRecording(false);
    setDraft("");
    if (restore) await resumeShortcut().catch(() => {});
  }, []);

  useEffect(() => {
    if (!recording) return;

    // The OS swallows a registered combo before the webview ever sees it, so
    // every shortcut is released for the duration of the recording.
    void suspendShortcut();

    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        void stop(true);
        return;
      }

      const chord = eventToChord(e);
      setDraft(chord.accelerator);
      if (!chord.complete) return;

      if (!chord.hasModifier) {
        setError("A global shortcut needs at least one modifier key.");
        return;
      }

      setError("");
      setRecording(false);
      setDraft("");
      save({ ...settings, hotkey: chord.accelerator }).catch(async (err) => {
        setError(errorText(err));
        await resumeShortcut().catch(() => {});
      });
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, save, settings, stop]);

  const keys = acceleratorToKeys(draft || settings.hotkey);
  const isDefault = settings.hotkey === DEFAULT_HOTKEY;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        {!isDefault && !recording && (
          <button
            type="button"
            onClick={() => void save({ ...settings, hotkey: DEFAULT_HOTKEY })}
            className="ghost px-1.5 py-1"
            title="Back to the default shortcut"
          >
            <ResetIcon className="text-[13px]" />
          </button>
        )}

        <button
          ref={buttonRef}
          type="button"
          onClick={() => {
            setError("");
            setRecording(true);
          }}
          onBlur={() => recording && void stop(true)}
          className={[
            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] transition-colors",
            recording
              ? "border-iris-400 bg-iris-50 text-iris-700 ring-4 ring-iris-500/15 dark:bg-iris-500/15 dark:text-iris-200"
              : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600",
          ].join(" ")}
        >
          <KeyboardIcon className="text-[14px] opacity-60" />
          {recording && keys.length === 0 ? (
            <span className="text-slate-500">Press keys…</span>
          ) : (
            keys.map((k, i) => (
              <kbd
                key={`${k}-${i}`}
                className="rounded border border-slate-300 bg-slate-50 px-1.5 py-px font-sans text-[11px] dark:border-slate-600 dark:bg-slate-800"
              >
                {k}
              </kbd>
            ))
          )}
        </button>
      </div>

      {recording && (
        <span className="text-[11.5px] text-slate-400 dark:text-slate-500">
          Esc to cancel
        </span>
      )}
      {error && (
        <span className="max-w-[220px] text-right text-[11.5px] text-rose-600 dark:text-rose-400">
          {error}
        </span>
      )}
    </div>
  );
}

// ---- System -----------------------------------------------------------------

// Nothing here is a Lingo setting — autostart lives with the OS.
function SystemSection() {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    autostartEnabled()
      .then(setAutostart)
      .catch(() => setAutostart(null));
  }, []);

  const toggleAutostart = async (next: boolean) => {
    setError("");
    // Optimistic: the switch should not lag behind the click.
    setAutostart(next);
    try {
      if (next) await enableAutostart();
      else await disableAutostart();
    } catch (err) {
      setAutostart(!next);
      setError(errorText(err));
    }
  };

  return (
    <Section title="System">
      <Row
        label="Start with the computer"
        description="Lingo waits in the tray, so the shortcut works straight after login."
      >
        {autostart === null ? (
          <span className="text-[12px] text-slate-400">unavailable</span>
        ) : (
          <Toggle
            label="Start with the computer"
            on={autostart}
            onChange={(v) => void toggleAutostart(v)}
          />
        )}
      </Row>

      {error && (
        <p className="px-4 py-2 text-[12.5px] text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </Section>
  );
}

// ---- About ------------------------------------------------------------------

function AboutSection() {
  return (
    <section className="pb-2">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        About
      </h2>
      <div className="mt-3 space-y-2 text-[12.5px] leading-relaxed text-slate-500 dark:text-slate-400">
        <p>
          Lingo {__APP_VERSION__} — a pop-up translator built on the Google Cloud
          Translation API.
        </p>
        <p>
          Your preferences and your API key live in a plain{" "}
          <code>settings.json</code> in Lingo&apos;s own config folder, the
          month&apos;s usage tally sits beside it, and the history is a local
          SQLite file in the data folder. None of them is encrypted: anything
          running as your user account can read them.
        </p>
        <p>
          Nothing is sent anywhere except the text you translate, which goes to
          Google and nowhere else. Google states that Cloud Translation does not
          use your content to train its models — which is the main way it
          differs from the free consumer endpoint — but it is still someone
          else&apos;s server, so treat it accordingly.
        </p>
      </div>
    </section>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  checkUpdate,
  clearApiKey,
  errorText,
  installUpdate,
  openDownloadPage,
  openLink,
  resumeShortcut,
  setApiKey,
  suspendShortcut,
  verifyKey,
} from "../lib/api";
import { acceleratorToKeys, eventToChord, IS_MAC } from "../lib/shortcut";
import { installLabel, isNewer, knownUpdate, remember } from "../lib/updates";
import { parseReleaseNotes } from "../lib/changelog";
import { ChangeSections } from "./WhatsNew";
import { nameOf } from "../lib/languages";
import { startPair, withDefaultPair } from "../lib/pair";
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
const NEW_PROJECT = "https://console.cloud.google.com/projectcreate";
const BILLING = "https://console.cloud.google.com/billing";
/** Where the daily character cap is set — Google's own hard stop. */
const QUOTAS =
  "https://console.cloud.google.com/apis/api/translate.googleapis.com/quotas";
const BUDGETS = "https://console.cloud.google.com/billing/budgets";

const IS_WINDOWS =
  typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);

/** Where this build keeps the key, in words. */
const KEY_HOME = IS_WINDOWS
  ? "Windows Credential Manager"
  : IS_MAC
    ? "the macOS Keychain"
    : "Lingo's settings.json (Linux has no credential store Lingo uses)";

/** Monthly limits the Settings screen offers, in characters. */
const LIMITS = [
  100_000, 250_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000,
  50_000_000,
];
const FREE_TIER = 500_000;
const USD_PER_MILLION = 20;

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
        <SpendingSection settings={settings} save={save} />
        <TranslationSection settings={settings} save={save} />
        <PopupSection settings={settings} save={save} />
        <SystemSection />
        <AboutSection settings={settings} save={save} />
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
      onClick={() => void openLink(url).catch((e) => console.error(e))}
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
            No key yet. The steps below take about five minutes.
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

      <KeyGuide open={status !== null && !saved} />

      <div className="flex items-start gap-2.5 px-4 py-3 text-[12.5px] leading-snug text-slate-500 dark:text-slate-400">
        <KeyIcon className="mt-[2px] shrink-0 text-[14px]" />
        <p>
          Lingo keeps the key in {KEY_HOME} and never hands it to the part of
          the app that draws the screen. Treat it like a password: don&apos;t
          paste it into chats, screenshots or code. If it ever gets out, delete
          it under <em>Credentials</em> in the Cloud console and make a new
          one.
        </p>
      </div>
    </Section>
  );
}

/** The numbered steps to a working, capped key. Open until a key is saved. */
function KeyGuide({ open }: { open: boolean }) {
  const step = "text-[12.5px] leading-snug text-slate-600 dark:text-slate-300";
  const note = "mt-0.5 block text-[12px] text-slate-500 dark:text-slate-400";
  return (
    <details open={open} className="group px-4 py-3">
      <summary className="cursor-pointer select-none text-[13px] font-medium text-slate-700 dark:text-slate-200">
        How to get a key (about 5 minutes)
      </summary>
      <ol className="mt-2.5 list-decimal space-y-2 pl-5 marker:text-slate-400">
        <li className={step}>
          Create a project in the Google Cloud console, or pick one you have.{" "}
          <Link url={NEW_PROJECT}>New project</Link>
        </li>
        <li className={step}>
          Set up billing on it. Google asks for a card even inside the free
          tier; new accounts start with a free trial credit.{" "}
          <Link url={BILLING}>Billing</Link>
        </li>
        <li className={step}>
          Enable the <em>Cloud Translation API</em> on that project.{" "}
          <Link url={ENABLE_API}>Enable the API</Link>
        </li>
        <li className={step}>
          Create an API key: <em>Create credentials → API key</em>.{" "}
          <Link url={CREDENTIALS}>Credentials</Link>
        </li>
        <li className={step}>
          Restrict it: edit the key, under <em>API restrictions</em> choose{" "}
          <em>Restrict key</em>, tick only <em>Cloud Translation API</em>, and
          save.
          <span className={note}>
            A restricted key that leaks cannot be spent on anything else.
          </span>
        </li>
        <li className={step}>
          Cap it at Google: on the API&apos;s <em>Quotas</em> page, edit{" "}
          <em>Characters sent to general model per project per day</em> and
          set it to 16,000 — about the free 500,000 a month.{" "}
          <Link url={QUOTAS}>Quotas</Link>
          <span className={note}>
            It is unlimited until you change it. This is the hard stop that
            protects you whatever happens to the key; changes can take up to a
            day to apply, and the count resets at midnight Pacific time.
          </span>
        </li>
        <li className={step}>
          Optional: add a budget alert, so Google emails you if anything is
          ever billed. An alert does not stop spending — the quota does.{" "}
          <Link url={BUDGETS}>Budgets</Link>
        </li>
        <li className={step}>
          Paste the key above and press <em>Save &amp; check</em>. The check is
          free.
        </li>
      </ol>
    </details>
  );
}

// ---- Spending ---------------------------------------------------------------

const count = new Intl.NumberFormat();
const usd = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

/** What a month at `limit` characters could cost at Google's list price. */
function worstCase(limit: number): string {
  const over = Math.max(0, limit - FREE_TIER);
  return over === 0 ? "free" : `up to ${usd.format((over / 1_000_000) * USD_PER_MILLION)}`;
}

function SpendingSection({ settings, save }: Props) {
  const options = LIMITS.includes(settings.monthlyLimit)
    ? LIMITS
    : [...LIMITS, settings.monthlyLimit].sort((a, b) => a - b);

  return (
    <Section
      title="Spending limit"
      hint="Lingo counts the characters it sends and stops before a month goes past this. A refused translation is not sent, so it costs nothing."
    >
      <Row
        label="Characters a month"
        description={
          settings.monthlyLimit <= FREE_TIER
            ? "Inside Google's free 500,000 characters, so Lingo alone cannot cost you anything."
            : `Past the free 500,000 characters Google charges $${USD_PER_MILLION} per million: this limit is ${worstCase(settings.monthlyLimit)} a month from Lingo.`
        }
      >
        <select
          aria-label="Characters a month"
          value={settings.monthlyLimit}
          onChange={(e) =>
            void save({ ...settings, monthlyLimit: Number(e.target.value) })
          }
          className="field py-1.5 text-[12.5px] tabular-nums"
        >
          {options.map((n) => (
            <option key={n} value={n}>
              {count.format(n)} ({worstCase(n)})
            </option>
          ))}
        </select>
      </Row>
      <div className="px-4 py-3 text-[12px] leading-snug text-slate-500 dark:text-slate-400">
        This only counts Lingo. Anything else using the same Google project
        spends the same free tier, so the daily quota in the key steps above is
        the stop that covers everything.
      </div>
    </Section>
  );
}

// ---- Translation ------------------------------------------------------------

function TranslationSection({ settings, save }: Props) {
  const [picker, setPicker] = useState<"source" | "target" | null>(null);
  const languages = useLanguages();

  const opening = startPair(settings);

  return (
    <Section
      title="Translation"
      hint="The pair a window opens on. Changing either one here takes effect
            straight away, whichever way the switch below is set."
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
                  void save(withDefaultPair(settings, { source: code }));
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
                  void save(withDefaultPair(settings, { target: code }));
                }}
              />
            </LangPopover>
          )}
        </div>
      </Row>

      <Row
        label="Remember the last pair"
        description={
          settings.rememberLastLang
            ? `Switching languages in the pop-up sticks. Right now that means ${nameOf(
                languages,
                opening.source,
              )} → ${nameOf(languages, opening.target)}.`
            : "Off: every window opens on the two above, whatever you last translated."
        }
      >
        <Toggle
          label="Remember the last pair"
          on={settings.rememberLastLang}
          onChange={(v) =>
            void save({
              ...settings,
              rememberLastLang: v,
              // Turning it off means going back to the defaults, so the pair
              // that was being remembered goes with it rather than lying in
              // wait to reappear the day the switch is turned back on.
              ...(v ? {} : { lastSourceLang: "", lastTargetLang: "" }),
            })
          }
        />
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
        label="Keep text when reopening"
        description="Leaves whatever you were translating in the pop-up when you close it, so it is still there next time."
      >
        <Toggle
          label="Keep text when reopening"
          on={settings.preserveInput}
          onChange={(v) => void save({ ...settings, preserveInput: v })}
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

      <Row
        label="Stay on top of fullscreen apps"
        description="Keeps the pop-up visible above games and fullscreen video, even when they try to reclaim focus."
      >
        <Toggle
          label="Stay on top of fullscreen apps"
          on={settings.stayOnTopFullscreen}
          onChange={(v) => void save({ ...settings, stayOnTopFullscreen: v })}
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

function UpdateRow({ settings, save }: Props) {
  // A newer release the daily check already found shows here at once, as it
  // does in the sidebar.
  const [known] = useState(() =>
    settings.checkUpdates ? knownUpdate(__APP_VERSION__) : null,
  );
  const [state, setState] = useState<"idle" | "checking" | "done">("idle");
  const [message, setMessage] = useState(
    known ? `Lingo ${known.version} is out.` : "",
  );
  const [newer, setNewer] = useState<string | null>(known?.version ?? null);
  /** The newer release's notes (its CHANGELOG.md section), shown before installing. */
  const [notes, setNotes] = useState<string | null>(known?.notes ?? null);
  const sections = useMemo(() => (notes ? parseReleaseNotes(notes) : []), [notes]);
  /** While an update downloads: percent, or -1 while the size is unknown. */
  const [installing, setInstalling] = useState<number | null>(null);

  const install = async (version: string) => {
    setInstalling(-1);
    setMessage(`Installing Lingo ${version}…`);
    try {
      // Restarts the app when it is done, so this only returns on a failure.
      await installUpdate(setInstalling);
    } catch (err) {
      setMessage(`${errorText(err)} You can still get it from the download page.`);
      setInstalling(null);
    }
  };

  const check = async () => {
    setState("checking");
    setMessage("");
    try {
      const info = await checkUpdate();
      remember(info.latest, info.notes);
      const found = isNewer(info.latest, __APP_VERSION__);
      setNewer(found ? info.latest : null);
      setNotes(found ? info.notes : null);
      setMessage(
        found
          ? `Lingo ${info.latest} is out.`
          : `You have the newest version (${__APP_VERSION__}).`,
      );
    } catch (err) {
      setNewer(null);
      setNotes(null);
      setMessage(errorText(err));
    }
    setState("done");
  };

  return (
    <Section title="Updates">
      <Row
        label="Check for updates"
        description="Once a day, Lingo asks GitHub for the version number and notes of its newest release. Nothing else is sent, and nothing is downloaded until you press Install."
      >
        <Toggle
          label="Check for updates"
          on={settings.checkUpdates}
          onChange={(v) => void save({ ...settings, checkUpdates: v })}
        />
      </Row>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-[12.5px]">
        <span className="text-slate-500 dark:text-slate-400">
          Version {__APP_VERSION__}
        </span>
        <button
          type="button"
          onClick={() => void check()}
          disabled={state === "checking"}
          className="ghost px-2 py-1 text-[12.5px] font-medium disabled:opacity-40"
        >
          {state === "checking" ? "Checking…" : "Check now"}
        </button>
        {message && (
          <span className="text-slate-500 dark:text-slate-400">{message}</span>
        )}
        {newer && (
          <>
            <button
              type="button"
              onClick={() => void install(newer)}
              disabled={installing !== null}
              className="rounded-md bg-iris-600 px-2.5 py-1 font-medium text-white transition-colors hover:bg-iris-700 disabled:opacity-60 dark:bg-iris-500 dark:hover:bg-iris-400"
            >
              {installLabel(newer, installing)}
            </button>
            <button
              type="button"
              onClick={() => void openDownloadPage()}
              title="The release page on GitHub, to download the installer yourself"
              className="inline-flex items-center gap-1 font-medium text-iris-600 hover:text-iris-700 dark:text-iris-300"
            >
              Download page
              <ExternalIcon className="text-[12px]" />
            </button>
          </>
        )}
      </div>
      {newer && sections.length > 0 && (
        <div className="px-4 py-3">
          <p className="text-[13.5px] font-medium">What&apos;s new in {newer}</p>
          <div className="tidy-scroll mt-1.5 max-h-56 overflow-y-auto pr-1">
            <ChangeSections sections={sections} />
          </div>
          <p className="mt-2 text-[12px] leading-snug text-slate-500 dark:text-slate-400">
            Install downloads it from GitHub, checks it is signed by Lingo,
            installs it and restarts Lingo. Your key, settings and history stay.
          </p>
        </div>
      )}
    </Section>
  );
}

function AboutSection({ settings, save }: Props) {
  return (
    <>
    <UpdateRow settings={settings} save={save} />
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
          The API key is kept in {KEY_HOME}. Your preferences are a{" "}
          <code>settings.json</code> in Lingo&apos;s own config folder, the
          month&apos;s usage tally sits beside it, and the history is a local
          SQLite file in the data folder. Those three are not encrypted:
          anything running as your user account can read them.
        </p>
        <p>
          The text you translate goes to Google and nowhere else; the only
          other requests Lingo makes are the update check above, to GitHub, which
          carries no text and no key, and, when you press Install, the download
          of that release from GitHub. An update not signed with Lingo&apos;s
          release key is refused. Google states that Cloud Translation does not
          use your content to train its models — which is the main way it
          differs from the free consumer endpoint — but it is still someone
          else&apos;s server, so treat it accordingly.
        </p>
      </div>
    </section>
    </>
  );
}

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
import { errorText, resumeShortcut, suspendShortcut, verifyKey } from "../lib/api";
import { acceleratorToKeys, eventToChord } from "../lib/shortcut";
import { nameOf } from "../lib/languages";
import { useLanguages } from "../lib/useLanguages";
import type { Settings } from "../lib/types";

const DEEPL_SIGNUP = "https://www.deepl.com/pro-api";
const DEFAULT_HOTKEY = "CommandOrControl+Shift+L";

interface Props {
  settings: Settings;
  save: (next: Settings) => Promise<Settings>;
}

export default function SettingsPanel({ settings, save }: Props) {
  const languages = useLanguages();

  return (
    <div className="tidy-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-8 px-6 py-6">
        <ApiKeySection settings={settings} save={save} />
        <DefaultsSection settings={settings} save={save} languages={languages} />
        <PopupSection settings={settings} save={save} />
        <SystemSection settings={settings} save={save} />
        <AboutSection />
      </div>
    </div>
  );
}

// ---- Layout helpers ---------------------------------------------------------

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
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
        "relative h-[22px] w-[38px] rounded-full transition-colors",
        on
          ? "bg-iris-500"
          : "bg-slate-300 hover:bg-slate-400 dark:bg-slate-600 dark:hover:bg-slate-500",
      ].join(" ")}
    >
      <span
        className={[
          "absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
          on ? "translate-x-[19px]" : "translate-x-[3px]",
        ].join(" ")}
      />
    </button>
  );
}

// ---- API key ----------------------------------------------------------------

function ApiKeySection({ settings, save }: Props) {
  const [draft, setDraft] = useState(settings.apiKey);
  const [reveal, setReveal] = useState(false);
  const [state, setState] = useState<"idle" | "checking" | "ok" | "bad">("idle");
  const [message, setMessage] = useState("");

  // Adopt a key that arrived from somewhere else, but never clobber an edit
  // in progress.
  useEffect(() => {
    setDraft((d) => (d === "" ? settings.apiKey : d));
  }, [settings.apiKey]);

  const dirty = draft.trim() !== settings.apiKey.trim();

  const check = async () => {
    setState("checking");
    setMessage("");
    try {
      const usage = await verifyKey(draft);
      await save({ ...settings, apiKey: draft.trim() });
      setState("ok");
      const free = draft.trim().endsWith(":fx");
      setMessage(
        `Key works — ${free ? "Free" : "Pro"} plan, ${usage.characterCount.toLocaleString()} characters used.`,
      );
    } catch (err) {
      setState("bad");
      setMessage(errorText(err));
    }
  };

  return (
    <Section
      title="DeepL"
      hint="Lingo talks to DeepL with your own API key. A free key covers 500,000 characters a month."
    >
      <div className="px-4 py-3">
        <label
          htmlFor="deepl-key"
          className="mb-1.5 block text-[13.5px] font-medium"
        >
          API key
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <KeyIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-slate-400" />
            <input
              id="deepl-key"
              type={reveal ? "text" : "password"}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setState("idle");
                setMessage("");
              }}
              placeholder="00000000-0000-0000-0000-000000000000:fx"
              spellCheck={false}
              autoComplete="off"
              className="field pl-9 pr-9 font-mono text-[12.5px]"
            />
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              title={reveal ? "Hide the key" : "Show the key"}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
            >
              {reveal ? (
                <EyeOffIcon className="text-[14px]" />
              ) : (
                <EyeIcon className="text-[14px]" />
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={() => void check()}
            disabled={!draft.trim() || state === "checking"}
            className="accent accent-hover shrink-0 rounded-lg px-3.5 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {state === "checking" ? "Checking…" : dirty ? "Save & verify" : "Verify"}
          </button>
        </div>

        {message && (
          <p
            className={[
              "mt-2 flex items-start gap-1.5 text-[12.5px]",
              state === "ok"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400",
            ].join(" ")}
          >
            {state === "ok" ? (
              <CheckIcon className="mt-[2px] shrink-0 text-[13px]" strokeWidth={2.5} />
            ) : (
              <AlertIcon className="mt-[2px] shrink-0 text-[13px]" />
            )}
            {message}
          </p>
        )}

        <button
          type="button"
          onClick={() => void openUrl(DEEPL_SIGNUP)}
          className="mt-2.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-iris-600 transition-colors hover:text-iris-700 dark:text-iris-300 dark:hover:text-iris-200"
        >
          Get a key from DeepL
          <ExternalIcon className="text-[12px]" />
        </button>
      </div>
    </Section>
  );
}

// ---- Default language pair --------------------------------------------------

function DefaultsSection({
  settings,
  save,
  languages,
}: Props & { languages: ReturnType<typeof useLanguages> }) {
  const [picker, setPicker] = useState<"source" | "target" | null>(null);

  return (
    <Section
      title="Languages"
      hint="What the pop-up starts with each time it opens."
    >
      <Row label="Translate from">
        <div className="relative">
          <LangButton
            label={
              settings.sourceLang
                ? nameOf(languages.source, settings.sourceLang)
                : "Detect language"
            }
            code={settings.sourceLang || "auto"}
            open={picker === "source"}
            onToggle={() => setPicker((p) => (p === "source" ? null : "source"))}
          />
          {picker === "source" && (
            <LangPopover align="right" onClose={() => setPicker(null)}>
              <LangList
                languages={languages.source}
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
            label={nameOf(languages.target, settings.targetLang)}
            code={settings.targetLang}
            open={picker === "target"}
            onToggle={() => setPicker((p) => (p === "target" ? null : "target"))}
          />
          {picker === "target" && (
            <LangPopover align="right" onClose={() => setPicker(null)}>
              <LangList
                languages={languages.target}
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
        description="Opens with whatever you last copied, already translated."
      >
        <Toggle
          label="Start from the clipboard"
          on={settings.prefillClipboard}
          onChange={(v) => void save({ ...settings, prefillClipboard: v })}
        />
      </Row>

      <Row
        label="Translate as you type"
        description="Off means nothing is sent to DeepL until you press Enter."
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

function SystemSection({ settings, save }: Props) {
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

      <Row
        label="Formality"
        description="Applied to the languages DeepL supports it for — German, French, Spanish, Italian, Dutch, Polish, Portuguese, Japanese and Russian."
      >
        <select
          value={settings.formality}
          onChange={(e) =>
            void save({
              ...settings,
              formality: e.target.value as Settings["formality"],
            })
          }
          className="field w-auto py-1.5 text-[12.5px]"
        >
          <option value="prefer_less">Casual</option>
          <option value="default">Neutral</option>
          <option value="prefer_more">Formal</option>
        </select>
      </Row>
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
        <p>Lingo {__APP_VERSION__} — a pop-up translator built on DeepL.</p>
        <p>
          Your API key and preferences live in a plain <code>settings.json</code>{" "}
          in Lingo's own config folder, and the history is a local SQLite file
          beside it. Neither is encrypted: anything running as your user account
          can read them, the same as the key itself.
        </p>
        <p>
          Nothing is sent anywhere except the text you translate, which goes to
          DeepL and nowhere else.
        </p>
      </div>
    </section>
  );
}

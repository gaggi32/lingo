import { useCallback, useEffect, useMemo, useState } from "react";
import { CogIcon } from "../components/CogIcon";
import Workbench from "./Workbench";
import History from "./History";
import SettingsPanel from "./Settings";
import UsageMeter from "./UsageMeter";
import WhatsNew, { ReleaseEntries } from "./WhatsNew";
import {
  errorText,
  getSettings,
  installUpdate,
  openDownloadPage,
  saveSettings,
} from "../lib/api";
import {
  missedEntries,
  planWhatsNew,
  type ChangelogEntry,
} from "../lib/changelog";
import { notifySettingsChanged } from "../lib/events";
import { RELEASES } from "../lib/releases";
import { acceleratorToKeys } from "../lib/shortcut";
import { carryOverStayOnTop } from "../lib/topmost";
import { dailyCheck, installLabel, type KnownUpdate } from "../lib/updates";
import {
  ClockIcon,
  LanguagesIcon,
  SettingsIcon,
} from "../components/icons";
import type { HistoryEntry, Settings } from "../lib/types";

type View = "translate" | "history" | "settings";

const NAV: { id: View; label: string; Icon: typeof LanguagesIcon }[] = [
  { id: "translate", label: "Translate", Icon: LanguagesIcon },
  { id: "history", label: "History", Icon: ClockIcon },
  { id: "settings", label: "Settings", Icon: SettingsIcon },
];

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [view, setView] = useState<View>("translate");
  /** The settings cog's one-tooth turn on hover is running. */
  const [cogTurning, setCogTurning] = useState(false);
  const [loadError, setLoadError] = useState("");
  /** Set when History hands a row back to the translator to work on. */
  const [handoff, setHandoff] = useState<HistoryEntry | null>(null);
  /** A newer release on GitHub, from the once-a-day check. */
  const [newer, setNewer] = useState<KnownUpdate | null>(null);
  /** The notes of every release it brings, folded open under the sidebar notice. */
  const [notesOpen, setNotesOpen] = useState(false);
  const newerNotes = useMemo(() => missedEntries(newer?.missed), [newer]);
  /** CHANGELOG.md entries since the version last seen, until "Got it". */
  const [news, setNews] = useState<{ entries: ChangelogEntry[]; more: boolean } | null>(null);

  /**
   * Save and tell the other window. Rust is the single source of truth here —
   * it returns the settings it actually persisted, which is what we adopt.
   */
  const save = useCallback(async (next: Settings) => {
    const saved = await saveSettings(next);
    setSettings(saved);
    await notifySettingsChanged();
    return saved;
  }, []);

  /**
   * Record the running version as seen. In settings.json, never localStorage,
   * which WebView2 loses the latest writes of when the tray app is killed.
   */
  const markSeen = useCallback(
    async (current: Settings) => {
      try {
        await save({ ...current, lastSeenVersion: __APP_VERSION__ });
      } catch (e) {
        console.error("Couldn't remember the version seen:", e);
      }
    },
    [save],
  );

  useEffect(() => {
    getSettings()
      .then(carryOverStayOnTop)
      .then((s) => {
        setSettings(s);
        const plan = planWhatsNew(RELEASES, s.lastSeenVersion, __APP_VERSION__);
        if (plan.kind === "show") setNews(plan);
        // A fresh install, or an update from before the card: no history.
        if (plan.kind === "remember") void markSeen(s);
      })
      .catch((e) => setLoadError(errorText(e)));
  }, [markSeen]);

  /** While the update downloads: percent, or -1 while the size is unknown. */
  const [installing, setInstalling] = useState<number | null>(null);
  const [installError, setInstallError] = useState(false);

  const checkUpdates = settings?.checkUpdates ?? false;
  useEffect(() => {
    if (!checkUpdates) {
      setNewer(null);
      return;
    }
    let live = true;
    void dailyCheck(__APP_VERSION__).then((v) => live && setNewer(v));
    return () => {
      live = false;
    };
  }, [checkUpdates]);

  const openInTranslator = useCallback((entry: HistoryEntry) => {
    setHandoff(entry);
    setView("translate");
  }, []);

  if (loadError) {
    return (
      <div className="app-bg flex h-screen items-center justify-center p-8 text-center">
        <p className="max-w-sm text-[14px] text-rose-600 dark:text-rose-400">
          Lingo could not read its settings: {loadError}
        </p>
      </div>
    );
  }

  if (!settings) {
    return <div className="app-bg h-screen w-screen" />;
  }

  return (
    <div className="app-bg flex h-screen w-screen overflow-hidden text-slate-900 dark:text-slate-100">
      {/* ---- Rail ---------------------------------------------------------- */}
      <nav className="flex w-[212px] shrink-0 flex-col border-r border-slate-200/80 bg-white/50 px-3 py-4 dark:border-slate-800 dark:bg-slate-950/40">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          {/* The mark echoes the pop-up's accent spine. */}
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] accent">
            <LanguagesIcon className="text-[16px]" />
          </span>
          <div className="leading-tight">
            <p className="text-[14px] font-semibold tracking-tight">Lingo</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              via Google Cloud
            </p>
          </div>
        </div>

        <ul className="space-y-0.5">
          {NAV.map(({ id, label, Icon }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => setView(id)}
                onPointerEnter={id === "settings" ? () => setCogTurning(true) : undefined}
                className={[
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors",
                  view === id
                    ? "bg-iris-50 text-iris-700 dark:bg-iris-500/15 dark:text-iris-200"
                    : "text-slate-600 hover:bg-slate-900/[0.05] dark:text-slate-400 dark:hover:bg-white/5",
                ].join(" ")}
              >
                {id === "settings" ? (
                  // Turns one tooth on hover (index.css, .cog-turn).
                  <CogIcon
                    className={`text-[16px]${cogTurning ? " cog-turn" : ""}`}
                    onAnimationEnd={() => setCogTurning(false)}
                  />
                ) : (
                  <Icon className="text-[16px]" />
                )}
                {label}
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-auto space-y-3 px-1 pt-4">
          {newer && (
            <div className="w-full rounded-lg bg-iris-50 px-2.5 py-2 text-[12px] leading-snug text-iris-700 dark:bg-iris-500/15 dark:text-iris-200">
              <p className="font-semibold">
                {installError
                  ? "Could not install it here."
                  : `Lingo ${newer.version} is out.`}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <button
                  type="button"
                  disabled={installing !== null}
                  onClick={() => {
                    setInstalling(-1);
                    setInstallError(false);
                    // Restarts the app when done: only a failure comes back.
                    installUpdate(setInstalling).catch(() => {
                      setInstalling(null);
                      setInstallError(true);
                    });
                  }}
                  className="font-medium underline-offset-2 hover:underline disabled:opacity-60"
                >
                  {installLabel(newer.version, installing)}
                </button>
                <button
                  type="button"
                  onClick={() => void openDownloadPage()}
                  className="text-iris-600/80 underline-offset-2 hover:underline dark:text-iris-300/80"
                >
                  Download
                </button>
                {newerNotes.length > 0 && (
                  <button
                    type="button"
                    aria-expanded={notesOpen}
                    aria-controls="update-notes"
                    onClick={() => setNotesOpen((v) => !v)}
                    className="text-iris-600/80 underline-offset-2 hover:underline dark:text-iris-300/80"
                  >
                    {notesOpen ? "Hide what's new" : "What's new"}
                  </button>
                )}
              </div>
              {notesOpen && newerNotes.length > 0 && (
                <div
                  id="update-notes"
                  className="tidy-scroll mt-2 max-h-64 overflow-y-auto border-t border-iris-200/70 pt-1.5 pr-1 dark:border-iris-400/20"
                >
                  <ReleaseEntries entries={newerNotes} compact />
                </div>
              )}
            </div>
          )}

          <UsageMeter />

          <p className="flex flex-wrap items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
            <span>Pop-up</span>
            {acceleratorToKeys(settings.hotkey).map((k) => (
              <kbd
                key={k}
                className="rounded border border-slate-300 bg-white px-1 py-px font-sans text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                {k}
              </kbd>
            ))}
          </p>
        </div>
      </nav>

      {/* ---- Content ------------------------------------------------------- */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {news && (
          <WhatsNew
            version={__APP_VERSION__}
            entries={news.entries}
            more={news.more}
            onDone={() => {
              setNews(null);
              void markSeen(settings);
            }}
          />
        )}
        <div className="min-h-0 flex-1">
          {view === "translate" && (
            <Workbench
              settings={settings}
              save={save}
              handoff={handoff}
              onHandoffUsed={() => setHandoff(null)}
              onOpenSettings={() => setView("settings")}
            />
          )}
          {view === "history" && <History onOpen={openInTranslator} />}
          {view === "settings" && (
            <SettingsPanel settings={settings} save={save} />
          )}
        </div>
      </main>
    </div>
  );
}

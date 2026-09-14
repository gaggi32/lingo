import { useCallback, useEffect, useState } from "react";
import Workbench from "./Workbench";
import History from "./History";
import SettingsPanel from "./Settings";
import UsageMeter from "./UsageMeter";
import { errorText, getSettings, saveSettings } from "../lib/api";
import { notifySettingsChanged } from "../lib/events";
import { acceleratorToKeys } from "../lib/shortcut";
import { applySavedStayOnTopFullscreen } from "../lib/topmost";
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
  const [loadError, setLoadError] = useState("");
  /** Set when History hands a row back to the translator to work on. */
  const [handoff, setHandoff] = useState<HistoryEntry | null>(null);

  useEffect(() => {
    getSettings().then(setSettings).catch((e) => setLoadError(errorText(e)));
  }, []);

  // Re-apply the fullscreen-topmost watchdog, if enabled, once on launch.
  useEffect(() => {
    void applySavedStayOnTopFullscreen();
  }, []);

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
                className={[
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors",
                  view === id
                    ? "bg-iris-50 text-iris-700 dark:bg-iris-500/15 dark:text-iris-200"
                    : "text-slate-600 hover:bg-slate-900/[0.05] dark:text-slate-400 dark:hover:bg-white/5",
                ].join(" ")}
              >
                <Icon className="text-[16px]" />
                {label}
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-auto space-y-3 px-1 pt-4">
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
      <main className="min-w-0 flex-1 overflow-hidden">
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
      </main>
    </div>
  );
}

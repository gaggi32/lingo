import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Cross-window sync.
 *
 * The pop-up and the desk window are separate webviews over one process and
 * share no memory, so each one broadcasts after a write and re-reads on
 * receipt. Tauri delivers these to the sender too, which is harmless — a
 * re-query of the same data.
 */

const HISTORY = "history-changed";
const SETTINGS = "settings-changed";

export const notifyHistoryChanged = (): Promise<void> => emit(HISTORY);

export const onHistoryChanged = (cb: () => void): Promise<UnlistenFn> =>
  listen(HISTORY, () => cb());

/** Fired after Settings saves, so the pop-up picks up the new defaults. */
export const notifySettingsChanged = (): Promise<void> => emit(SETTINGS);

export const onSettingsChanged = (cb: () => void): Promise<UnlistenFn> =>
  listen(SETTINGS, () => cb());

/** Rust emits this when the hotkey or the tray summons the pop-up. */
export interface PopShow {
  seed: string | null;
}

export const onPopShow = (cb: (p: PopShow) => void): Promise<UnlistenFn> =>
  listen<PopShow>("pop-show", (e) => cb(e.payload));

/**
 * Rust emits this after every translation, and whenever Google refuses for
 * quota. The usage meter lives in the desk window but the pop-up is what
 * usually spends the allowance, so the meter cannot rely on its own window for
 * news.
 */
export const onUsageChanged = (cb: () => void): Promise<UnlistenFn> =>
  listen("usage-changed", () => cb());

/**
 * Rust emits this when the API key is saved or removed.
 *
 * Both windows care: the pop-up stops asking for a key the moment the desk
 * window has been given one, and the language list is re-fetched because the
 * first key is what makes fetching it possible at all.
 */
export const onKeyChanged = (cb: () => void): Promise<UnlistenFn> =>
  listen("key-changed", () => cb());

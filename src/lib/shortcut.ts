/**
 * Turning real keystrokes into Tauri accelerators, and back into something
 * printable.
 *
 * Accelerator format is Tauri's: "CommandOrControl+Shift+L", "Alt+T",
 * "Super+Space". `CommandOrControl` resolves to Command on macOS and Ctrl
 * everywhere else, which is what a portable default wants.
 */

export const IS_MAC =
  typeof navigator !== "undefined" &&
  /mac/i.test(navigator.platform || navigator.userAgent);

/** Maps a KeyboardEvent.code onto the key name Tauri's parser accepts. */
function codeToTauriKey(e: KeyboardEvent): string | null {
  const code = e.code;

  if (/^Key[A-Z]$/.test(code)) return code.slice(3); // KeyL -> L
  if (/^Digit[0-9]$/.test(code)) return code.slice(5); // Digit4 -> 4
  if (/^Numpad[0-9]$/.test(code)) return code; // Numpad accelerators keep their name
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code; // F1..F24

  const map: Record<string, string> = {
    Space: "Space",
    Enter: "Enter",
    NumpadEnter: "Enter",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backquote: "`",
  };
  return map[code] ?? null;
}

export interface Chord {
  /** Tauri accelerator string. Partial while only modifiers are held. */
  accelerator: string;
  /** True once a non-modifier key joins the chord, i.e. it is registrable. */
  complete: boolean;
  /** True when at least one modifier is down. A global hotkey needs one. */
  hasModifier: boolean;
}

export function eventToChord(e: KeyboardEvent): Chord {
  const mods: string[] = [];

  if (IS_MAC ? e.metaKey : e.ctrlKey) mods.push("CommandOrControl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  // The other platform-specific super key: literal Control on macOS, the
  // Windows/Super key elsewhere.
  if (IS_MAC ? e.ctrlKey : e.metaKey) mods.push(IS_MAC ? "Control" : "Super");

  const key = codeToTauriKey(e);
  const hasModifier = mods.length > 0;

  if (!key) return { accelerator: mods.join("+"), complete: false, hasModifier };
  return { accelerator: [...mods, key].join("+"), complete: true, hasModifier };
}

/** Split an accelerator into display tokens with platform-appropriate glyphs. */
export function acceleratorToKeys(accelerator: string): string[] {
  const symbols: Record<string, string> = {
    CommandOrControl: IS_MAC ? "⌘" : "Ctrl",
    CmdOrCtrl: IS_MAC ? "⌘" : "Ctrl",
    Command: "⌘",
    Cmd: "⌘",
    Control: IS_MAC ? "⌃" : "Ctrl",
    Ctrl: IS_MAC ? "⌃" : "Ctrl",
    Alt: IS_MAC ? "⌥" : "Alt",
    Option: "⌥",
    Shift: IS_MAC ? "⇧" : "Shift",
    Super: IS_MAC ? "⌘" : "Win",
    Up: "↑",
    Down: "↓",
    Left: "←",
    Right: "→",
  };
  return accelerator
    .split("+")
    .filter(Boolean)
    .map((tok) => symbols[tok] ?? tok);
}

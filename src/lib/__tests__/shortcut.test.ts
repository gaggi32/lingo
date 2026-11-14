import { describe, expect, it } from "vitest";
import { acceleratorToKeys, eventToChord, IS_MAC } from "../shortcut";

/** A keydown with the primary modifier (Ctrl, or ⌘ on a Mac) held. */
function key(code: string, extra: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    code,
    ctrlKey: !IS_MAC,
    metaKey: IS_MAC,
    altKey: false,
    shiftKey: false,
    ...extra,
  } as KeyboardEvent;
}

describe("eventToChord", () => {
  it("turns the default chord into Tauri's accelerator", () => {
    const c = eventToChord(key("KeyL", { shiftKey: true }));
    expect(c).toEqual({ accelerator: "CommandOrControl+Shift+L", complete: true, hasModifier: true });
  });

  it("is incomplete while only modifiers are down", () => {
    const c = eventToChord(key("ShiftLeft", { shiftKey: true }));
    expect(c.complete).toBe(false);
    expect(c.accelerator).toBe("CommandOrControl+Shift");
  });

  it("notices a key with no modifier", () => {
    const c = eventToChord({ code: "KeyA", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent);
    expect(c.hasModifier).toBe(false);
    expect(c.accelerator).toBe("A");
  });

  it("names digits, function keys and punctuation the way Tauri wants", () => {
    expect(eventToChord(key("Digit4")).accelerator).toBe("CommandOrControl+4");
    expect(eventToChord(key("F12")).accelerator).toBe("CommandOrControl+F12");
    expect(eventToChord(key("Space")).accelerator).toBe("CommandOrControl+Space");
    expect(eventToChord(key("ArrowUp")).accelerator).toBe("CommandOrControl+Up");
  });
});

describe("acceleratorToKeys", () => {
  it("prints platform glyphs", () => {
    expect(acceleratorToKeys("CommandOrControl+Shift+L")).toEqual(
      IS_MAC ? ["⌘", "⇧", "L"] : ["Ctrl", "Shift", "L"],
    );
    expect(acceleratorToKeys("Alt+Up")).toEqual([IS_MAC ? "⌥" : "Alt", "↑"]);
  });
});

import { describe, expect, it } from "vitest";
import { startPair, withDefaultPair, withLastPair } from "../pair";
import type { Settings } from "../types";

const base: Settings = {
  targetLang: "en",
  sourceLang: "",
  hotkey: "CommandOrControl+Shift+L",
  prefillClipboard: true,
  autoCopy: false,
  saveHistory: true,
  liveTranslate: true,
  preserveInput: false,
  rememberLastLang: true,
  lastSourceLang: "",
  lastTargetLang: "",
  monthlyLimit: 500_000,
  checkUpdates: true,
};

describe("startPair", () => {
  it("opens on the defaults until a pair has been remembered", () => {
    expect(startPair(base)).toEqual({ source: "", target: "en" });
  });

  it("opens on the remembered pair, Detect included", () => {
    const s = { ...base, lastSourceLang: "", lastTargetLang: "de" };
    expect(startPair(s)).toEqual({ source: "", target: "de" });
  });

  it("ignores the remembered pair when remembering is off", () => {
    const s = { ...base, rememberLastLang: false, lastSourceLang: "fr", lastTargetLang: "de" };
    expect(startPair(s)).toEqual({ source: "", target: "en" });
  });
});

describe("withLastPair", () => {
  it("writes nothing when the pair is already on disk", () => {
    const s = { ...base, lastSourceLang: "fr", lastTargetLang: "de" };
    expect(withLastPair(s, { source: "fr", target: "de" })).toBeNull();
  });

  it("writes nothing while not remembering", () => {
    expect(withLastPair({ ...base, rememberLastLang: false }, { source: "fr", target: "de" })).toBeNull();
  });

  it("records a new pair", () => {
    const next = withLastPair(base, { source: "fr", target: "de" });
    expect(next?.lastSourceLang).toBe("fr");
    expect(next?.lastTargetLang).toBe("de");
    // The defaults are left alone.
    expect(next?.targetLang).toBe("en");
  });
});

describe("withDefaultPair", () => {
  it("changes one default and forgets the remembered pair", () => {
    const s = { ...base, lastSourceLang: "fr", lastTargetLang: "de" };
    const next = withDefaultPair(s, { target: "it" });
    expect(next.targetLang).toBe("it");
    expect(next.sourceLang).toBe("");
    expect(next.lastTargetLang).toBe("");
    expect(startPair(next)).toEqual({ source: "", target: "it" });
  });
});

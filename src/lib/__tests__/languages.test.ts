import { describe, expect, it } from "vitest";
import { codeOf, FALLBACK_LANGUAGES, nameOf, resolve } from "../languages";

describe("the bundled language list", () => {
  it("has no duplicate codes", () => {
    const codes = FALLBACK_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("uses Google's spelling: bare codes, a suffix only where Google keeps one", () => {
    // Must match REGIONAL in src-tauri/src/settings.rs, or a saved default
    // would be rewritten into a code Google refuses.
    for (const { code } of FALLBACK_LANGUAGES) {
      if (code.includes("-")) expect(["zh-CN", "zh-TW", "mni-Mtei"]).toContain(code);
      else expect(code).toBe(code.toLowerCase());
    }
  });
});

describe("nameOf", () => {
  it("names a code, Detect for empty, the code itself when unknown", () => {
    expect(nameOf(FALLBACK_LANGUAGES, "de")).toBe("German");
    expect(nameOf(FALLBACK_LANGUAGES, "")).toBe("Detect");
    expect(nameOf(FALLBACK_LANGUAGES, "xx")).toBe("xx");
  });

  it("finds a bare zh through its regional rows", () => {
    expect(nameOf(FALLBACK_LANGUAGES, "zh")).toMatch(/^Chinese/);
  });
});

describe("resolve", () => {
  it("lands a detected bare code on a real row", () => {
    expect(resolve(FALLBACK_LANGUAGES, "zh")).toBe("zh-CN");
    expect(resolve(FALLBACK_LANGUAGES, "de")).toBe("de");
    expect(resolve(FALLBACK_LANGUAGES, "")).toBe("");
    expect(resolve(FALLBACK_LANGUAGES, "xx")).toBe("xx");
  });
});

describe("codeOf", () => {
  it("shows auto for Detect", () => {
    expect(codeOf("")).toBe("auto");
    expect(codeOf("fr")).toBe("fr");
  });
});

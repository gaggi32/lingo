import { describe, expect, it } from "vitest";
import { dueForCheck, installLabel, isNewer, storedMissed } from "../updates";

const DAY = 24 * 60 * 60 * 1000;

describe("dueForCheck", () => {
  it("checks the first time, and once a day after that", () => {
    const now = 1_800_000_000_000;
    expect(dueForCheck(null, now)).toBe(true);
    expect(dueForCheck(now - DAY + 1, now)).toBe(false);
    expect(dueForCheck(now - DAY, now)).toBe(true);
    expect(dueForCheck(Number.NaN, now)).toBe(true);
  });

  it("checks again when the clock went backwards", () => {
    expect(dueForCheck(2_000, 1_000)).toBe(true);
  });
});

describe("isNewer", () => {
  it("compares x.y.z as numbers", () => {
    expect(isNewer("0.10.0", "0.9.0")).toBe(true);
    expect(isNewer("v0.2.1", "0.2.0")).toBe(true);
    expect(isNewer("0.2.0", "0.2.0")).toBe(false);
    expect(isNewer("0.1.9", "0.2.0")).toBe(false);
  });

  it("is never fooled by something that is not a version", () => {
    expect(isNewer(null, "0.2.0")).toBe(false);
    expect(isNewer("nightly", "0.2.0")).toBe(false);
    expect(isNewer("1.0", "0.2.0")).toBe(false);
  });
});

describe("installLabel", () => {
  it("offers the version until pressed", () => {
    expect(installLabel("0.3.0", null)).toBe("Install 0.3.0");
  });

  it("shows the download, then the install", () => {
    expect(installLabel("0.3.0", -1)).toBe("Downloading…");
    expect(installLabel("0.3.0", 0)).toBe("Downloading 0%");
    expect(installLabel("0.3.0", 42.4)).toBe("Downloading 42%");
    expect(installLabel("0.3.0", 100)).toBe("Installing…");
  });
});

describe("storedMissed", () => {
  const missed = [
    { version: "1.2.0", notes: "### Added\n- Newer." },
    { version: "1.1.0", notes: null },
  ];
  const stored = JSON.stringify({ version: "1.2.0", missed });

  it("gives the releases stored for that release", () => {
    expect(storedMissed(stored, "1.2.0")).toEqual(missed);
  });

  it("reads what was stored before, the newest release's notes alone", () => {
    const old = JSON.stringify({ version: "1.1.0", notes: "### Added\n- New." });
    expect(storedMissed(old, "1.1.0")).toEqual([
      { version: "1.1.0", notes: "### Added\n- New." },
    ]);
    expect(storedMissed(JSON.stringify({ version: "1.1.0", notes: null }), "1.1.0")).toEqual([]);
    expect(storedMissed(JSON.stringify({ version: "1.1.0", notes: 3 }), "1.1.0")).toEqual([]);
  });

  it("drops entries of the wrong shape", () => {
    const odd = JSON.stringify({
      version: "1.2.0",
      missed: [{ version: "1.2.0", notes: "ok" }, { version: 5, notes: "x" }, { notes: "x" }, { version: "1.1.0", notes: 3 }, null],
    });
    expect(storedMissed(odd, "1.2.0")).toEqual([{ version: "1.2.0", notes: "ok" }]);
  });

  it("gives nothing for another release, none stored, or something else", () => {
    expect(storedMissed(stored, "1.3.0")).toEqual([]);
    expect(storedMissed(null, "1.1.0")).toEqual([]);
    expect(storedMissed("not json", "1.1.0")).toEqual([]);
    expect(storedMissed("null", "1.1.0")).toEqual([]);
    expect(storedMissed(JSON.stringify({ version: "1.2.0", missed: "x" }), "1.2.0")).toEqual([]);
  });
});

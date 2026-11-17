import { describe, expect, it } from "vitest";
import { dueForCheck, installLabel, isNewer } from "../updates";

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

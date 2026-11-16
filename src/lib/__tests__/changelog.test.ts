import { describe, expect, it } from "vitest";
import packageJson from "../../../package.json?raw";
import {
  compareVersions,
  entriesBetween,
  parseChangelog,
  planWhatsNew,
} from "../changelog";
import { RELEASES } from "../releases";

const SAMPLE = `# Changelog

All notable changes. Versions match the GitHub releases.

## [Unreleased]
### Added
- Not out yet.

## [0.10.0] — 2026-12-01
### Added
- Ten.
### Fixed
- A long line that
  carries on here.

## [0.9.0] — 2026-11-20
### Changed
- Nine.
### Removed

## [0.2.1] — 2026-11-16
### Fixed
- Two one.

## [0.2.0] — 2026-11-15
### Added
- Two.
`;

const ENTRIES = parseChangelog(SAMPLE);
const versions = (list: { version: string }[]) => list.map((e) => e.version);

describe("parseChangelog", () => {
  it("reads every released version, newest first, and skips Unreleased", () => {
    expect(versions(ENTRIES)).toEqual(["0.10.0", "0.9.0", "0.2.1", "0.2.0"]);
    expect(ENTRIES[0].date).toBe("2026-12-01");
  });

  it("keeps the items under their headings and joins wrapped lines", () => {
    expect(ENTRIES[0].sections).toEqual([
      { heading: "Added", items: ["Ten."] },
      { heading: "Fixed", items: ["A long line that carries on here."] },
    ]);
  });

  it("drops a heading with nothing under it", () => {
    expect(ENTRIES[1].sections).toEqual([{ heading: "Changed", items: ["Nine."] }]);
  });

  it("reads Windows line endings and an empty file", () => {
    expect(parseChangelog(SAMPLE.replace(/\n/g, "\r\n"))).toEqual(ENTRIES);
    expect(parseChangelog("")).toEqual([]);
  });
});

describe("compareVersions", () => {
  it("compares x.y.z as numbers", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0", "0.2.1")).toBeLessThan(0);
    expect(compareVersions("v0.2.1", "0.2.1")).toBe(0);
  });

  it("refuses what is not a version", () => {
    expect(compareVersions("", "0.2.1")).toBeNull();
    expect(compareVersions("0.2", "0.2.1")).toBeNull();
  });
});

describe("entriesBetween", () => {
  it("takes what came after the last seen version, up to the running one", () => {
    expect(versions(entriesBetween(ENTRIES, "0.2.0", "0.9.0"))).toEqual(["0.9.0", "0.2.1"]);
    expect(versions(entriesBetween(ENTRIES, "0.2.1", "0.2.1"))).toEqual([]);
  });

  it("sorts newest first whatever the file order", () => {
    const shuffled = [ENTRIES[3], ENTRIES[1], ENTRIES[0], ENTRIES[2]];
    expect(versions(entriesBetween(shuffled, "0.1.0", "1.0.0"))).toEqual([
      "0.10.0",
      "0.9.0",
      "0.2.1",
      "0.2.0",
    ]);
  });
});

describe("planWhatsNew", () => {
  it("shows what is new since the version last seen", () => {
    const plan = planWhatsNew(ENTRIES, "0.2.1", "0.10.0");
    expect(plan.kind).toBe("show");
    if (plan.kind !== "show") return;
    expect(versions(plan.entries)).toEqual(["0.10.0", "0.9.0"]);
    expect(plan.more).toBe(false);
  });

  it("caps the card at three versions and says there was more", () => {
    const plan = planWhatsNew(ENTRIES, "0.1.0", "0.10.0");
    expect(plan.kind === "show" && versions(plan.entries)).toEqual(["0.10.0", "0.9.0", "0.2.1"]);
    expect(plan.kind === "show" && plan.more).toBe(true);
  });

  it("quietly remembers the version on a fresh install or an update from before the card", () => {
    expect(planWhatsNew(ENTRIES, "", "0.10.0")).toEqual({ kind: "remember" });
    expect(planWhatsNew(ENTRIES, "garbage", "0.10.0")).toEqual({ kind: "remember" });
  });

  it("remembers without a card when nothing was written down for the update", () => {
    expect(planWhatsNew(ENTRIES, "0.10.0", "0.10.1")).toEqual({ kind: "remember" });
  });

  it("does nothing once seen, after a downgrade, or without a running version", () => {
    expect(planWhatsNew(ENTRIES, "0.10.0", "0.10.0")).toEqual({ kind: "nothing" });
    expect(planWhatsNew(ENTRIES, "0.10.0", "0.9.0")).toEqual({ kind: "nothing" });
    expect(planWhatsNew(ENTRIES, "0.2.0", "")).toEqual({ kind: "nothing" });
  });
});

describe("the bundled CHANGELOG.md", () => {
  it("has an entry, with items, for the version in package.json", () => {
    const { version } = JSON.parse(packageJson) as { version: string };
    const entry = RELEASES.find((e) => e.version === version);
    expect(entry, `CHANGELOG.md has no [${version}] section`).toBeDefined();
    expect(entry!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entry!.sections.flatMap((s) => s.items).length).toBeGreaterThan(0);
  });

  it("lists every version newest first, with a date and known headings", () => {
    const sorted = [...RELEASES].sort((a, b) => compareVersions(b.version, a.version) ?? 0);
    expect(versions(RELEASES)).toEqual(versions(sorted));
    for (const e of RELEASES) {
      expect(e.date, e.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const s of e.sections) {
        expect(["Added", "Changed", "Fixed", "Removed"], e.version).toContain(s.heading);
      }
    }
  });
});

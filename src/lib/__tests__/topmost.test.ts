import { describe, expect, it } from "vitest";
import { carriesOver } from "../topmost";

describe("carriesOver", () => {
  it("moves an old 'on' into a file that is still off", () => {
    expect(carriesOver("1", false)).toBe(true);
  });

  it("never overrules the file, and an old 'off' carries nothing", () => {
    expect(carriesOver("1", true)).toBe(false);
    expect(carriesOver("0", false)).toBe(false);
    expect(carriesOver("0", true)).toBe(false);
    expect(carriesOver(null, false)).toBe(false);
  });
});

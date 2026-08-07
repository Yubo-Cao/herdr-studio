import { describe, expect, test } from "bun:test";
import { normalizeAccentColor } from "./appearance";

describe("appearance preferences", () => {
  test("accepts supported accent colors", () => {
    expect(normalizeAccentColor("neutral")).toBe("neutral");
    expect(normalizeAccentColor("teal")).toBe("teal");
    expect(normalizeAccentColor("amber")).toBe("amber");
    expect(normalizeAccentColor("violet")).toBe("violet");
  });

  test("falls back to the original neutral theme for missing or unknown values", () => {
    expect(normalizeAccentColor(null)).toBe("neutral");
    expect(normalizeAccentColor("")).toBe("neutral");
    expect(normalizeAccentColor("orange")).toBe("neutral");
  });
});

import { describe, expect, test } from "bun:test";
import {
  normalizeAccentColor,
  normalizeThemePreference,
  resolveSystemTheme,
} from "./appearance";

const matches = (value: boolean) => ({ matches: value });

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

  test("accepts supported theme preferences, including system", () => {
    expect(normalizeThemePreference("session")).toBe("session");
    expect(normalizeThemePreference("dark")).toBe("dark");
    expect(normalizeThemePreference("light")).toBe("light");
    expect(normalizeThemePreference("system")).toBe("system");
  });

  test("falls back to the synchronized session theme for missing or unknown values", () => {
    expect(normalizeThemePreference(null)).toBe("session");
    expect(normalizeThemePreference("")).toBe("session");
    expect(normalizeThemePreference("auto")).toBe("session");
  });

  test("resolves the system theme from the color-scheme media query", () => {
    expect(resolveSystemTheme(matches(true))).toBe("light");
    expect(resolveSystemTheme(matches(false))).toBe("dark");
  });
});

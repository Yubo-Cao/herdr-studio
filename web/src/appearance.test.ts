import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  normalizeAccentColor,
  normalizeTerminalFontFamily,
  normalizeThemePreference,
  resolveTerminalFontFamily,
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

  test("normalizes a custom terminal font family", () => {
    expect(normalizeTerminalFontFamily('  "JetBrains Mono"  ')).toBe(
      '"JetBrains Mono"',
    );
    expect(normalizeTerminalFontFamily("Fira\nCode\u0000")).toBe("Fira Code");
    expect(normalizeTerminalFontFamily(null)).toBe("");
  });

  test("keeps the built-in terminal stack as the default and fallback", () => {
    expect(resolveTerminalFontFamily("")).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
    expect(resolveTerminalFontFamily('"Iosevka Term"')).toBe(
      `"Iosevka Term", ${DEFAULT_TERMINAL_FONT_FAMILY}`,
    );
  });
});

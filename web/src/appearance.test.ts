import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_OPTIONS,
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

  test("accepts supported terminal font preset values", () => {
    expect(normalizeTerminalFontFamily("jetbrains-mono")).toBe(
      "jetbrains-mono",
    );
    expect(normalizeTerminalFontFamily("fira-code")).toBe("fira-code");
    expect(normalizeTerminalFontFamily(null)).toBe("");
  });

  test("migrates matching legacy font names and stacks to presets", () => {
    expect(normalizeTerminalFontFamily('  "JetBrains Mono"  ')).toBe(
      "jetbrains-mono",
    );
    expect(normalizeTerminalFontFamily("Fira Code")).toBe("fira-code");
    expect(
      normalizeTerminalFontFamily(
        TERMINAL_FONT_OPTIONS.find((option) => option.value === "cascadia-mono")
          ?.fontFamily ?? null,
      ),
    ).toBe("cascadia-mono");
  });

  test("falls back safely for unsupported legacy custom values", () => {
    expect(normalizeTerminalFontFamily('"Custom Corporate Mono"')).toBe("");
    expect(normalizeTerminalFontFamily("Fira\nCode\u0000")).toBe("fira-code");
  });

  test("resolves presets with the built-in terminal stack as fallback", () => {
    expect(resolveTerminalFontFamily("")).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
    expect(resolveTerminalFontFamily("iosevka")).toBe(
      `"Iosevka Term", Iosevka, ${DEFAULT_TERMINAL_FONT_FAMILY}`,
    );
    expect(resolveTerminalFontFamily("not-a-preset")).toBe(
      DEFAULT_TERMINAL_FONT_FAMILY,
    );
  });
});

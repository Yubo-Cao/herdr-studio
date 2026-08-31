export const ACCENT_OPTIONS = [
  { value: "neutral", label: "Default" },
  { value: "blue", label: "Blue" },
  { value: "teal", label: "Teal" },
  { value: "green", label: "Green" },
  { value: "amber", label: "Amber" },
  { value: "rose", label: "Rose" },
  { value: "violet", label: "Violet" },
] as const;

export type AccentColor = (typeof ACCENT_OPTIONS)[number]["value"];

export const TERMINAL_FONT_STORAGE_KEY = "terminalFontFamily";
export const MAX_TERMINAL_FONT_FAMILY_LENGTH = 200;

export const DEFAULT_TERMINAL_FONT_FAMILY =
  'SFMono-Regular, Menlo, Monaco, "0xProto Nerd Font Mono", "JetBrainsMonoNL Nerd Font", "MesloLGS NF", "Hack Nerd Font", "FiraCode Nerd Font", Consolas, "Liberation Mono", "Courier New", "Noto Sans Mono CJK SC", "Source Han Mono SC", "Sarasa Mono SC", "Herdr Nerd Symbols", monospace';

export function normalizeTerminalFontFamily(value: string | null): string {
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TERMINAL_FONT_FAMILY_LENGTH);
}

export function resolveTerminalFontFamily(value: string | null): string {
  const custom = normalizeTerminalFontFamily(value);
  return custom
    ? `${custom}, ${DEFAULT_TERMINAL_FONT_FAMILY}`
    : DEFAULT_TERMINAL_FONT_FAMILY;
}

export function normalizeAccentColor(value: string | null): AccentColor {
  return ACCENT_OPTIONS.some((option) => option.value === value)
    ? (value as AccentColor)
    : "neutral";
}

export const THEME_OPTIONS = [
  { value: "session", label: "Session" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
] as const;

export type ThemePreference = (typeof THEME_OPTIONS)[number]["value"];
export type ResolvedTheme = "dark" | "light";

export function normalizeThemePreference(
  value: string | null,
): ThemePreference {
  return value === "session" ||
    value === "light" ||
    value === "dark" ||
    value === "system"
    ? value
    : "session";
}

export function resolveSystemTheme(
  media: Pick<MediaQueryList, "matches">,
): ResolvedTheme {
  return media.matches ? "light" : "dark";
}

export const SYSTEM_THEME_QUERY = "(prefers-color-scheme: light)";

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

export const DEFAULT_TERMINAL_FONT_FAMILY =
  'SFMono-Regular, Menlo, Monaco, "0xProto Nerd Font Mono", "JetBrainsMonoNL Nerd Font", "MesloLGS NF", "Hack Nerd Font", "FiraCode Nerd Font", Consolas, "Liberation Mono", "Courier New", "Noto Sans Mono CJK SC", "Source Han Mono SC", "Sarasa Mono SC", "Herdr Nerd Symbols", monospace';

export const TERMINAL_FONT_OPTIONS = [
  { value: "", label: "Default (system)", fontFamily: "" },
  {
    value: "jetbrains-mono",
    label: "JetBrains Mono",
    fontFamily:
      '"JetBrains Mono", "JetBrainsMono Nerd Font", "JetBrainsMonoNL Nerd Font"',
  },
  {
    value: "fira-code",
    label: "Fira Code",
    fontFamily: '"Fira Code", "FiraCode Nerd Font"',
  },
  {
    value: "cascadia-mono",
    label: "Cascadia Mono",
    fontFamily: '"Cascadia Mono", "CaskaydiaMono Nerd Font"',
  },
  {
    value: "iosevka",
    label: "Iosevka",
    fontFamily: '"Iosevka Term", Iosevka',
  },
  {
    value: "source-code-pro",
    label: "Source Code Pro",
    fontFamily: '"Source Code Pro", "SauceCodePro Nerd Font"',
  },
  {
    value: "ibm-plex-mono",
    label: "IBM Plex Mono",
    fontFamily: '"IBM Plex Mono"',
  },
  {
    value: "noto-sans-mono",
    label: "Noto Sans Mono",
    fontFamily: '"Noto Sans Mono", "Noto Sans Mono CJK SC"',
  },
] as const;

export type TerminalFontPreset =
  (typeof TERMINAL_FONT_OPTIONS)[number]["value"];

function sanitizeLegacyTerminalFontFamily(value: string | null): string {
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function normalizeTerminalFontFamily(
  value: string | null,
): TerminalFontPreset {
  const normalized = sanitizeLegacyTerminalFontFamily(value);
  const preset = TERMINAL_FONT_OPTIONS.find(
    (option) => option.value === normalized || option.fontFamily === normalized,
  );
  if (preset) return preset.value;

  // The previous free-form setting commonly stored just the primary family.
  // Preserve those choices when they exactly match one of the new presets.
  const lowerCased = normalized.replace(/^["']|["']$/g, "").toLowerCase();
  const legacyPreset = TERMINAL_FONT_OPTIONS.find((option) => {
    if (!option.fontFamily) return false;
    const primaryFamily = option.fontFamily.split(",", 1)[0];
    return primaryFamily.replace(/"/g, "").toLowerCase() === lowerCased;
  });
  return legacyPreset?.value ?? "";
}

export function resolveTerminalFontFamily(value: string | null): string {
  const preset = TERMINAL_FONT_OPTIONS.find(
    (option) => option.value === normalizeTerminalFontFamily(value),
  );
  return preset?.fontFamily
    ? `${preset.fontFamily}, ${DEFAULT_TERMINAL_FONT_FAMILY}`
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

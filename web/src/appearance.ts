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

const TERMINAL_FONT_PRESETS = [
  ["", "Default (system)", ""],
  ["jetbrains-mono", "JetBrains Mono", '"JetBrains Mono"'],
  ["fira-code", "Fira Code", '"Fira Code"'],
  ["cascadia-mono", "Cascadia Mono", '"Cascadia Mono"'],
  ["iosevka", "Iosevka", '"Iosevka Term"'],
  ["source-code-pro", "Source Code Pro", '"Source Code Pro"'],
  ["ibm-plex-mono", "IBM Plex Mono", '"IBM Plex Mono"'],
  ["noto-sans-mono", "Noto Sans Mono", '"Noto Sans Mono"'],
] as const;

export const TERMINAL_FONT_OPTIONS = TERMINAL_FONT_PRESETS.map(
  ([value, label, fontFamily]) => ({ value, label, fontFamily }),
);

export type TerminalFontPreset = (typeof TERMINAL_FONT_PRESETS)[number][0];

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
    ? `${preset.fontFamily}, ${TERMINAL_FONT_FAMILY}`
    : TERMINAL_FONT_FAMILY;
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

export const UI_SCALE_DEFAULT = 100;
export const UI_SCALE_MIN = 80;
export const UI_SCALE_MAX = 150;
export const UI_SCALE_STEP = 5;

export function clampUiScale(value: number): number {
  if (!Number.isFinite(value)) return UI_SCALE_DEFAULT;
  const stepped = Math.round(value / UI_SCALE_STEP) * UI_SCALE_STEP;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, stepped));
}

export function normalizeUiScale(value: string | null): number {
  return value === null ? UI_SCALE_DEFAULT : clampUiScale(Number(value));
}

// The terminal surface cancels page zoom so xterm's mouse coordinates, cell
// measurements, and IME overlay share CSS pixels. Scale its font explicitly.
// Every xterm surface shares this stack: the Nerd Font families carry the
// powerline and icon glyphs prompts draw with, and dropping any of them
// shows tofu boxes wherever the earlier fonts have no glyph.
export const TERMINAL_FONT_FAMILY =
  'SFMono-Regular, Menlo, Monaco, "0xProto Nerd Font Mono", "JetBrainsMonoNL Nerd Font", "MesloLGS NF", "Hack Nerd Font", "FiraCode Nerd Font", Consolas, "Liberation Mono", "Courier New", "Noto Sans Mono CJK SC", "Source Han Mono SC", "Sarasa Mono SC", "Herdr Nerd Symbols", monospace';

export function terminalFontOptions(compact: boolean, uiScale: number) {
  return {
    fontSize: ((compact ? 12 : 13) * uiScale) / 100,
    lineHeight: compact ? 1.12 : 1.18,
  };
}

// Zen mode hides the topbar, tab strip, and sidebar on desktop so only the
// terminal remains. Mobile keeps its own floating control collapse instead.
export function normalizeZenMode(value: string | null): boolean {
  return value === "1";
}

export function serializeZenMode(value: boolean): string {
  return value ? "1" : "0";
}

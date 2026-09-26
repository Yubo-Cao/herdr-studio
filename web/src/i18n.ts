import { roamgateLocalStorage } from "./browserStorage";

// Interface translation, gettext style: the English text is the message key,
// so English needs no catalog and untranslated text falls back to English.
// The Simplified Chinese catalog is a lazy chunk loaded before first render.
//
// Conventions (enforced by i18n.test.ts):
// - Wrap rendered text in t("…") with a plain string literal.
// - Mark text stored in module-level constants with msg("…") and translate it
//   with t(value) where it is rendered.
// - Interpolate with {name} placeholders: t("Copied {count} characters", {count}).
// - Pick between whole English sentences for plurals; never concatenate.

export const LOCALES = ["en", "zh-CN"] as const;
export type Locale = (typeof LOCALES)[number];
export type LocalePreference = "auto" | Locale;
export const LOCALE_STORAGE_KEY = "locale";

export const LOCALE_OPTIONS: { value: LocalePreference; label: string }[] = [
  { value: "auto", label: msg("Auto") },
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
];

let activeLocale: Locale = "en";
let catalog: Readonly<Record<string, string>> = {};

export function normalizeLocalePreference(
  value: string | null,
): LocalePreference {
  return value === "en" || value === "zh-CN" ? value : "auto";
}

/** Chinese browsers get the Chinese interface unless the user chose otherwise. */
export function resolveLocale(
  preference: LocalePreference,
  languages: readonly string[],
): Locale {
  if (preference !== "auto") return preference;
  return languages.some((language) => /^zh\b/i.test(language)) ? "zh-CN" : "en";
}

export function loadLocalePreference(): LocalePreference {
  return normalizeLocalePreference(
    roamgateLocalStorage.getItem(LOCALE_STORAGE_KEY),
  );
}

/** Switching reloads so module state and cached labels start over. */
export function saveLocalePreference(preference: LocalePreference): void {
  roamgateLocalStorage.setItem(LOCALE_STORAGE_KEY, preference);
  window.location.reload();
}

export function getLocale(): Locale {
  return activeLocale;
}

/** Load the catalog for the preferred locale; call once before rendering. */
export async function initLocale(): Promise<Locale> {
  const languages =
    typeof navigator === "undefined"
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language];
  const locale = resolveLocale(loadLocalePreference(), languages);
  if (locale === "zh-CN") {
    try {
      installCatalog("zh-CN", (await import("./locales/zh-CN")).default);
    } catch {
      installCatalog("en", {});
    }
  }
  if (typeof document !== "undefined")
    document.documentElement.lang = activeLocale === "zh-CN" ? "zh-CN" : "en";
  return activeLocale;
}

/** Install a catalog directly (tests and initLocale). */
export function installCatalog(
  locale: Locale,
  messages: Readonly<Record<string, string>>,
): void {
  activeLocale = locale;
  catalog = messages;
}

/** Translate English source text, filling {name} placeholders. */
export function t(
  source: string,
  values?: Record<string, string | number>,
): string {
  const text = catalog[source] ?? source;
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

/** Mark text for translation where it is defined; translate it with t(). */
export function msg<T extends string>(source: T): T {
  return source;
}

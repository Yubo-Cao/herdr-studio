import { getLocale } from "./i18n";

// Application-generated dates, times, and relative labels follow the interface
// language (English or Simplified Chinese), not the browser or operating system
// locale. UI_LOCALE is the English default.
export const UI_LOCALE = "en-US";

/** The Intl locale for the active interface language. */
export function uiIntlLocale(): string {
  return getLocale() === "zh-CN" ? "zh-CN" : UI_LOCALE;
}

export function formatUiDateTime(timestamp: string, now = new Date()) {
  const time = new Date(timestamp);
  if (Number.isNaN(time.getTime())) return timestamp;
  const pad = (value: number) => String(value).padStart(2, "0");
  const year =
    time.getFullYear() === now.getFullYear() ? "" : `${time.getFullYear()}-`;
  return `${year}${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`;
}

// Created on first use so it picks up the locale initialized before render.
const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();

export function formatUiRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
) {
  const locale = uiIntlLocale();
  let formatter = relativeTimeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeTimeFormatters.set(locale, formatter);
  }
  return formatter.format(value, unit);
}

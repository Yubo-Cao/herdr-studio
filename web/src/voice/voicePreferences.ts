import { useSyncExternalStore } from "react";
import { roamgateLocalStorage } from "../browserStorage";
import { msg } from "../i18n";

/** How a finished dictation is rewritten by the bridge's language model. */
export type VoiceCleanupMode =
  | "off"
  | "tidy"
  | "verbatim"
  | "typeset"
  | "polish";

export const VOICE_CLEANUP_OPTIONS: {
  value: VoiceCleanupMode;
  label: string;
}[] = [
  { value: "off", label: msg("Off") },
  { value: "tidy", label: msg("Tidy") },
  { value: "verbatim", label: msg("Clean") },
  { value: "typeset", label: msg("Typeset") },
  { value: "polish", label: msg("Polish") },
];

const STORAGE_KEY = "voiceCleanupMode";
const listeners = new Set<() => void>();

export function voiceCleanupMode(): VoiceCleanupMode {
  const stored = roamgateLocalStorage.getItem(STORAGE_KEY);
  return VOICE_CLEANUP_OPTIONS.some((option) => option.value === stored)
    ? (stored as VoiceCleanupMode)
    : "tidy";
}

export function setVoiceCleanupMode(mode: VoiceCleanupMode) {
  roamgateLocalStorage.setItem(STORAGE_KEY, mode);
  for (const listener of listeners) listener();
}

export function useVoiceCleanupMode(): VoiceCleanupMode {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, voiceCleanupMode);
}

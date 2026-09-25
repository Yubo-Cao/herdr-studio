import { useSyncExternalStore } from "react";
import { roamgateLocalStorage } from "../browserStorage";

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
  { value: "off", label: "Off" },
  { value: "tidy", label: "Tidy" },
  { value: "verbatim", label: "Clean" },
  { value: "typeset", label: "Typeset" },
  { value: "polish", label: "Polish" },
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

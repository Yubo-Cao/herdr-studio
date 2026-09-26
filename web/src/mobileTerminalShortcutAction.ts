import {
  mobileTerminalShortcutBytes,
  mobileTerminalShortcutModifier,
  mobileTerminalShortcutScroll,
  type MobileTerminalShortcutAction,
} from "./mobileTerminalShortcuts";

export type MobileTerminalShortcutExecution =
  | {
      type: "input";
      bytes: number[];
    }
  | {
      type: "scroll";
      direction: "up" | "down";
      amount: "full" | "half";
    }
  | {
      type: "modifier";
      modifier: "ctrl" | "alt" | "shift";
    };

export function mobileTerminalShortcutExecution(
  action: MobileTerminalShortcutAction,
): MobileTerminalShortcutExecution | null {
  const modifier = mobileTerminalShortcutModifier(action);
  if (modifier) return { type: "modifier", modifier };
  const scroll = mobileTerminalShortcutScroll(action);
  if (scroll) return { type: "scroll", ...scroll };
  const bytes = mobileTerminalShortcutBytes(action);
  return bytes.length > 0 ? { type: "input", bytes } : null;
}

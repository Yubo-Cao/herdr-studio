type TerminalKeyEvent = Pick<
  KeyboardEvent,
  | "type"
  | "key"
  | "code"
  | "keyCode"
  | "shiftKey"
  | "altKey"
  | "ctrlKey"
  | "metaKey"
  | "isComposing"
>;

const ENTER_CODES = new Set(["Enter", "NumpadEnter"]);

function isCompositionEvent(event: TerminalKeyEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

/**
 * Encodes the explicitly supported modified Enter keys without collapsing
 * Shift and Alt into xterm's legacy Enter sequences.
 */
export function modifiedEnterSequence(event: TerminalKeyEvent): string | null {
  if (
    isCompositionEvent(event) ||
    event.type !== "keydown" ||
    (!ENTER_CODES.has(event.key) && !ENTER_CODES.has(event.code)) ||
    event.ctrlKey ||
    event.metaKey
  ) {
    return null;
  }

  // CSI-u modifiers are 1 plus the modifier bitmask: Shift=2 and Alt=3.
  if (event.shiftKey && !event.altKey) return "\x1b[13;2u";
  if (event.altKey && !event.shiftKey) return "\x1b[13;3u";
  return null;
}

/**
 * Maps pure macOS Command editing shortcuts to their readline equivalents.
 * Additional modifiers are left untouched instead of being silently dropped.
 */
export function macCommandEditingSequence(
  event: TerminalKeyEvent,
  isMac: boolean,
): string | null {
  if (
    !isMac ||
    isCompositionEvent(event) ||
    event.type !== "keydown" ||
    !event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey
  ) {
    return null;
  }

  const key = event.key;
  const code = event.code;
  if (
    key === "ArrowLeft" ||
    code === "ArrowLeft" ||
    key === "ArrowUp" ||
    code === "ArrowUp"
  ) {
    return "\x01";
  }
  if (
    key === "ArrowRight" ||
    code === "ArrowRight" ||
    key === "ArrowDown" ||
    code === "ArrowDown"
  ) {
    return "\x05";
  }
  if (key === "Backspace" || code === "Backspace") return "\x15";
  return null;
}

// Latching Ctrl/Alt/Shift for touch keyboards, which have no modifier keys.
// A tap arms a modifier for the next key, a double tap locks it until tapped
// again. Armed modifiers apply to the next key typed on the device keyboard
// or sent from a shortcut button.

export type TerminalModifier = "ctrl" | "alt" | "shift";
export type TerminalModifierLatch = "off" | "once" | "locked";
export type TerminalModifierState = Record<
  TerminalModifier,
  TerminalModifierLatch
>;

export const NO_TERMINAL_MODIFIERS: TerminalModifierState = {
  ctrl: "off",
  alt: "off",
  shift: "off",
};

export const MODIFIER_DOUBLE_TAP_MS = 400;

/** Tap: off → once; once tapped again quickly → locked; otherwise → off. */
export function tapTerminalModifier(
  state: TerminalModifierState,
  modifier: TerminalModifier,
  sinceLastTapMs: number,
): TerminalModifierState {
  const current = state[modifier];
  const next: TerminalModifierLatch =
    current === "off"
      ? "once"
      : current === "once" && sinceLastTapMs <= MODIFIER_DOUBLE_TAP_MS
        ? "locked"
        : "off";
  return { ...state, [modifier]: next };
}

/** Release one-shot modifiers after they were applied to a key. */
export function consumeTerminalModifiers(
  state: TerminalModifierState,
): TerminalModifierState {
  const release = (latch: TerminalModifierLatch) =>
    latch === "once" ? "off" : latch;
  return {
    ctrl: release(state.ctrl),
    alt: release(state.alt),
    shift: release(state.shift),
  };
}

export function terminalModifiersActive(state: TerminalModifierState) {
  return state.ctrl !== "off" || state.alt !== "off" || state.shift !== "off";
}

// Control bytes for the non-letter keys xterm maps under Ctrl.
const CTRL_SYMBOLS: Record<string, number> = {
  " ": 0x00,
  "@": 0x00,
  "2": 0x00,
  "[": 0x1b,
  "3": 0x1b,
  "\\": 0x1c,
  "4": 0x1c,
  "]": 0x1d,
  "5": 0x1d,
  "^": 0x1e,
  "6": 0x1e,
  _: 0x1f,
  "-": 0x1f,
  "7": 0x1f,
  "/": 0x1f,
  "?": 0x7f,
  "8": 0x7f,
};

// CSI final bytes whose modified form is ESC [ 1 ; m <final>.
const CSI_LETTER = /^\x1b(?:\[|O)([ABCDHFPQRS])$/;
// CSI tilde keys (Insert/Delete/PageUp/PageDown/F5+): ESC [ n ; m ~.
const CSI_TILDE = /^\x1b\[(\d+)~$/;

/**
 * Applies armed modifiers to one key's input. Returns null when the input is
 * not a single key (e.g. an autocorrected word or IME text), which leaves the
 * modifiers armed for the next key.
 */
export function applyTerminalModifiers(
  data: string,
  modifiers: { ctrl: boolean; alt: boolean; shift: boolean },
): string | null {
  const { ctrl, alt, shift } = modifiers;
  if (!ctrl && !alt && !shift) return data;
  // xterm's modifier parameter: 1 + shift + 2*alt + 4*ctrl.
  const param = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0);
  const letter = CSI_LETTER.exec(data);
  if (letter) return `\x1b[1;${param}${letter[1]}`;
  const tilde = CSI_TILDE.exec(data);
  if (tilde) return `\x1b[${tilde[1]};${param}~`;
  if (data === "\t") {
    if (shift && !ctrl) return alt ? "\x1b\x1b[Z" : "\x1b[Z";
    return alt ? "\x1b\t" : "\t";
  }
  if (data === "\r") {
    // Kitty-style CSI u, as the fixed Shift+Enter and Alt+Enter keys send.
    return param === 1 ? "\r" : `\x1b[13;${param}u`;
  }
  if (data === "\x7f") {
    const erased = ctrl ? "\x08" : "\x7f";
    return alt ? `\x1b${erased}` : erased;
  }
  if (data === "\x1b") return data;
  const chars = Array.from(data);
  if (chars.length !== 1) return null;
  let key = chars[0];
  if (shift) key = key.toUpperCase();
  if (ctrl) {
    const lower = key.toLowerCase();
    if (lower >= "a" && lower <= "z") {
      key = String.fromCharCode(lower.charCodeAt(0) - 0x60);
    } else if (key in CTRL_SYMBOLS) {
      key = String.fromCharCode(CTRL_SYMBOLS[key]);
    }
  }
  return alt ? `\x1b${key}` : key;
}

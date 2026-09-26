// Endpoint terminal frames are positioned cell grids that the bridge encodes as
// full ANSI repaints. Both ends agree on this layout so the bridge can send only
// the rows that changed and the browser can rebuild the same repaint text, or
// write just the changed rows into xterm.

/** Resets style, homes, clears, and disables autowrap before the rows. */
export const TERMINAL_FRAME_HEAD = "\x1b[0m\x1b[H\x1b[2J\x1b[?7l";

/** Every frame tail starts by re-enabling autowrap, then cursor controls. */
export const TERMINAL_FRAME_TAIL_MARK = "\x1b[?7h";

export interface TerminalFrameParts {
  /** One self-contained styled line per screen row, without positioning. */
  rows: string[];
  /** Starts with TERMINAL_FRAME_TAIL_MARK. */
  tail: string;
}

/** The complete repaint text for a frame. */
export function terminalFrameText({ rows, tail }: TerminalFrameParts): string {
  let out = TERMINAL_FRAME_HEAD;
  for (let y = 0; y < rows.length; y++) {
    if (y > 0) out += `\x1b[${y + 1};1H`;
    out += rows[y];
  }
  return out + tail;
}

/**
 * Text that turns a displayed frame into the next one of the same size by
 * rewriting only the rows that differ. Returns null when the frames differ in
 * row count and need a full repaint.
 */
export function terminalFrameRowUpdate(
  previous: TerminalFrameParts,
  next: TerminalFrameParts,
): string | null {
  if (previous.rows.length !== next.rows.length) return null;
  let out = "";
  for (let y = 0; y < next.rows.length; y++) {
    if (next.rows[y] === previous.rows[y]) continue;
    // Reset before erasing so the cleared line takes the default background,
    // exactly as the full repaint's screen clear does.
    out += `\x1b[${y + 1};1H\x1b[0m\x1b[2K${next.rows[y]}`;
  }
  if (!out && next.tail === previous.tail) return "";
  return `\x1b[0m\x1b[?7l${out}${next.tail}`;
}

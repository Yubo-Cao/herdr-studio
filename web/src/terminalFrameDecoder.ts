import type { TerminalFrameParts } from "../../shared/terminalFrame";

/** Row-update fields of an endpoint frame sent to a `frame_delta` viewer. */
export interface TerminalFrameUpdate {
  frame_seq?: number;
  /** Full frame rows; absent on row updates. */
  rows?: string[];
  /** Row update against the frame with this sequence number. */
  base_seq?: number;
  changed?: [number, string][];
  /** Omitted from a row update when the cursor tail is unchanged. */
  tail?: string;
}

export type TerminalFrameDecodeResult =
  | { kind: "frame"; seq: number; parts: TerminalFrameParts }
  | { kind: "resync" }
  | { kind: "none" };

/**
 * Rebuilds complete endpoint frames from full frames and row updates. A row
 * update against any frame other than the last one applied cannot be trusted,
 * so the caller asks the bridge to resend the newest frame in full.
 */
export class TerminalFrameDecoder {
  private current: { seq: number; parts: TerminalFrameParts } | null = null;
  // Row updates already in flight behind a lost base are dropped quietly
  // until the requested full frame arrives, so one gap asks only once.
  private awaitingFull = false;

  decode(update: TerminalFrameUpdate): TerminalFrameDecodeResult {
    const seq = update.frame_seq;
    if (typeof seq !== "number") return { kind: "none" };
    if (Array.isArray(update.rows)) {
      if (typeof update.tail !== "string") return this.lost();
      this.current = { seq, parts: { rows: update.rows, tail: update.tail } };
      this.awaitingFull = false;
      return { kind: "frame", seq, parts: this.current.parts };
    }
    const base = this.current;
    if (this.awaitingFull) return { kind: "none" };
    if (
      !base ||
      update.base_seq !== base.seq ||
      !Array.isArray(update.changed)
    ) {
      return this.lost();
    }
    const rows = base.parts.rows.slice();
    for (const [index, row] of update.changed) {
      if (!Number.isInteger(index) || index < 0 || index >= rows.length)
        return this.lost();
      rows[index] = row;
    }
    const parts = { rows, tail: update.tail ?? base.parts.tail };
    this.current = { seq, parts };
    return { kind: "frame", seq, parts };
  }

  reset(): void {
    this.current = null;
    this.awaitingFull = false;
  }

  private lost(): TerminalFrameDecodeResult {
    this.current = null;
    this.awaitingFull = true;
    return { kind: "resync" };
  }
}

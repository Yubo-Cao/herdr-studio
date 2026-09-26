import type { TerminalFrameParts } from "../../../shared/terminalFrame";

// A browser that attaches with `frame_delta` receives endpoint frames through
// one of these streams instead of as base64 full repaints.
//
// - Only rows that differ from the last frame sent to this viewer go on the
//   wire, so echoing one keystroke costs one row rather than the whole screen.
// - Frames identical to the last one sent are not sent at all.
// - The viewer acknowledges each frame. At most a small window of frames is
//   unacknowledged at once; newer frames replace the pending one instead of
//   queueing behind it. On a slow link the screen therefore skips straight to
//   the newest state rather than replaying a backlog, and keystroke replies
//   never wait behind seconds of stale repaints.

export const FRAME_STREAM_MAX_INFLIGHT = 4;
export const FRAME_STREAM_MAX_INFLIGHT_BYTES = 16 * 1024;
// A lost acknowledgement must not freeze the viewer. Frames stay ordered on the
// socket, so releasing the window only risks sending ahead of a slow link.
export const FRAME_STREAM_ACK_TIMEOUT_MS = 10_000;

export type TerminalFrameMeta = Record<string, unknown>;

interface SentFrame {
  seq: number;
  parts: TerminalFrameParts;
  metaKey: string;
  width: unknown;
}

// Unique across streams so a delta from a replaced stream can never match the
// base of a new one in the browser.
let nextFrameSeq = 1;

export class TerminalFrameStream {
  private latest: {
    parts: TerminalFrameParts;
    meta: TerminalFrameMeta;
  } | null = null;
  private dirty = false;
  private sent: SentFrame | null = null;
  private inflight: { seq: number; bytes: number }[] = [];
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly send: (terminal: Record<string, unknown>) => number | null,
  ) {}

  /** Record the newest frame and send it if the window allows. */
  offer(parts: TerminalFrameParts, meta: TerminalFrameMeta): void {
    if (this.disposed) return;
    this.latest = { parts, meta };
    this.dirty = true;
    this.flush();
  }

  /** The viewer's screen is unknown (attach, resize): repaint it fully. */
  reset(): void {
    this.sent = null;
    if (this.latest) this.dirty = true;
  }

  ack(seq: number): void {
    const index = this.inflight.findIndex((frame) => frame.seq === seq);
    if (index < 0) return;
    this.inflight.splice(0, index + 1);
    this.restartAckTimer();
    this.flush();
  }

  /** The viewer could not apply a delta; resend the newest frame in full. */
  resync(): void {
    this.inflight = [];
    this.restartAckTimer();
    this.reset();
    this.flush();
  }

  dispose(): void {
    this.disposed = true;
    this.latest = null;
    this.inflight = [];
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.ackTimer = null;
  }

  private windowOpen(): boolean {
    if (this.inflight.length === 0) return true;
    if (this.inflight.length >= FRAME_STREAM_MAX_INFLIGHT) return false;
    let bytes = 0;
    for (const frame of this.inflight) bytes += frame.bytes;
    return bytes < FRAME_STREAM_MAX_INFLIGHT_BYTES;
  }

  private flush(): void {
    if (this.disposed || !this.dirty || !this.latest || !this.windowOpen())
      return;
    const { parts, meta } = this.latest;
    this.dirty = false;
    const metaKey = JSON.stringify(meta);
    const previous = this.sent;
    let terminal: Record<string, unknown>;
    const seq = nextFrameSeq++;
    if (
      previous &&
      previous.width === meta.width &&
      previous.parts.rows.length === parts.rows.length
    ) {
      const changed: [number, string][] = [];
      for (let y = 0; y < parts.rows.length; y++) {
        if (parts.rows[y] !== previous.parts.rows[y])
          changed.push([y, parts.rows[y]]);
      }
      if (
        changed.length === 0 &&
        parts.tail === previous.parts.tail &&
        metaKey === previous.metaKey
      ) {
        return;
      }
      terminal = {
        ...meta,
        frame_seq: seq,
        base_seq: previous.seq,
        changed,
        ...(parts.tail === previous.parts.tail ? {} : { tail: parts.tail }),
      };
    } else {
      terminal = {
        ...meta,
        frame_seq: seq,
        rows: parts.rows,
        tail: parts.tail,
      };
    }
    const bytes = this.send(terminal);
    // The socket is gone; its cleanup disposes this stream.
    if (bytes === null) return;
    this.sent = { seq, parts, metaKey, width: meta.width };
    this.inflight.push({ seq, bytes });
    if (!this.ackTimer) this.restartAckTimer();
  }

  private restartAckTimer(): void {
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.ackTimer = null;
    if (this.disposed || this.inflight.length === 0) return;
    this.ackTimer = setTimeout(() => {
      this.ackTimer = null;
      this.inflight = [];
      this.flush();
    }, FRAME_STREAM_ACK_TIMEOUT_MS);
  }
}

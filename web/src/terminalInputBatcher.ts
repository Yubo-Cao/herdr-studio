// Keystrokes typed while an earlier `terminal.input` call is still unanswered
// are merged into the next call. On a fast link every key still goes out on
// its own; on a slow one, a burst costs one request and one repaint instead of
// one per key, and order is preserved because only one call is in flight.

const MAX_BATCH_BYTES = 64 * 1024;

function isLoneEscape(group: Uint8Array[]): boolean {
  return group.length === 1 && group[0].length === 1 && group[0][0] === 0x1b;
}

function concat(group: Uint8Array[]): Uint8Array {
  if (group.length === 1) return group[0];
  let length = 0;
  for (const chunk of group) length += chunk.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of group) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export class TerminalInputBatcher {
  private inflight = false;
  private queue: Uint8Array[][] = [];
  private queuedBytes = 0;

  constructor(
    private readonly sendNow: (bytes: Uint8Array) => Promise<unknown>,
    private readonly idle: () => void = () => {},
  ) {}

  send(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    if (!this.inflight) {
      this.dispatch(bytes);
      return;
    }
    const last = this.queue[this.queue.length - 1];
    const escape = bytes.length === 1 && bytes[0] === 0x1b;
    // A lone Escape stays its own call so it cannot merge with the next key
    // into an Alt chord.
    if (
      last &&
      !escape &&
      !isLoneEscape(last) &&
      this.queuedBytes + bytes.length <= MAX_BATCH_BYTES
    ) {
      last.push(bytes);
      this.queuedBytes += bytes.length;
    } else {
      this.queue.push([bytes]);
      this.queuedBytes = bytes.length;
    }
  }

  private dispatch(bytes: Uint8Array): void {
    this.inflight = true;
    this.sendNow(bytes)
      .catch(() => {})
      .finally(() => {
        this.inflight = false;
        const next = this.queue.shift();
        if (!next) {
          this.queuedBytes = 0;
          this.idle();
          return;
        }
        if (this.queue.length === 0) this.queuedBytes = 0;
        this.dispatch(concat(next));
      });
  }
}

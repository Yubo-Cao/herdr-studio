/** Keep wheel intent separate from surfaces that can lag queued scroll RPCs. */
export class TerminalScrollIntent {
  private observed: { offset: number; max: number } | null = null;
  private pending: {
    id: number;
    offset: number;
    acknowledgedAt: number | null;
  } | null = null;
  private revision = 0;

  observe(offset: number, max: number, now = Date.now()) {
    this.observed = { offset, max };
    this.reconcile(now);
  }

  private reconcile(now: number) {
    if (!this.pending || !this.observed) return;
    this.pending.offset = Math.min(this.pending.offset, this.observed.max);
    if (
      this.pending.acknowledgedAt !== null &&
      (this.observed.offset === this.pending.offset ||
        now - this.pending.acknowledgedAt >= 500)
    )
      this.pending = null;
  }

  next(delta: number, now = Date.now()) {
    this.reconcile(now);
    if (!this.observed) return null;
    const base = this.pending?.offset ?? this.observed.offset;
    const offset = Math.max(0, Math.min(this.observed.max, base + delta));
    if (offset === base) return null;
    this.pending = { id: ++this.revision, offset, acknowledgedAt: null };
    return { id: this.pending.id, offset };
  }

  acknowledge(id: number, now = Date.now()) {
    if (this.pending?.id !== id) return;
    this.pending.acknowledgedAt = now;
    this.reconcile(now);
  }

  fail(id: number) {
    if (this.pending?.id === id) this.pending = null;
  }

  reset() {
    this.observed = null;
    this.pending = null;
    this.revision++;
  }
}

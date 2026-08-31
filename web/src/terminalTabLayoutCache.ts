import type { TerminalConnectionIdentity } from "./terminalConnection";
import { terminalConnectionKey } from "./terminalConnection";
import type { PaneLayout } from "./types";

/**
 * Keeps the last measured layout for each visited tab in one browser
 * connection. The store intentionally exposes only the latest fetched layout;
 * without this small cache, selecting a tab briefly renders the previous tab
 * until pane.layout completes over the network.
 */
export class TerminalTabLayoutCache {
  private scopeKey: string | null = null;
  private readonly layouts = new Map<string, PaneLayout>();

  resolve(
    identity: TerminalConnectionIdentity,
    activeTabId: string | null,
    fetchedLayout: PaneLayout | null,
  ): PaneLayout | null {
    const nextScopeKey = terminalConnectionKey(identity);
    if (this.scopeKey !== nextScopeKey) {
      this.scopeKey = nextScopeKey;
      this.layouts.clear();
    }

    if (fetchedLayout?.tab_id === activeTabId) {
      this.layouts.set(fetchedLayout.tab_id, fetchedLayout);
    }
    if (!activeTabId) return null;
    return this.layouts.get(activeTabId) ?? null;
  }
}

/**
 * A rendered xterm belongs to a visual slot, not permanently to one pane.
 * Keeping this key stable lets TerminalView use its existing re-attach path
 * when tabs change instead of reconstructing xterm and all of its addons.
 */
export function terminalSlotMountKey(
  identity: TerminalConnectionIdentity,
  slot: number,
): string {
  return JSON.stringify([
    identity.connectionId,
    identity.generation,
    "terminal-slot",
    slot,
  ]);
}

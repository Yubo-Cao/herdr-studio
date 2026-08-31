import { describe, expect, test } from "bun:test";
import type { TerminalConnectionIdentity } from "./terminalConnection";
import {
  TerminalTabLayoutCache,
  terminalSlotMountKey,
} from "./terminalTabLayoutCache";
import type { PaneLayout } from "./types";

function layout(tabId: string, paneId: string): PaneLayout {
  return {
    workspace_id: "workspace",
    tab_id: tabId,
    zoomed: false,
    area: { x: 0, y: 0, width: 100, height: 50 },
    focused_pane_id: paneId,
    panes: [
      {
        pane_id: paneId,
        focused: true,
        rect: { x: 0, y: 0, width: 100, height: 50 },
      },
    ],
    splits: [],
  };
}

describe("TerminalTabLayoutCache", () => {
  const identity: TerminalConnectionIdentity = {
    connectionId: "local",
    generation: 4,
  };

  test("returns a visited tab immediately while ignoring a stale fetched layout", () => {
    const cache = new TerminalTabLayoutCache();
    const first = layout("tab-1", "pane-1");
    const second = layout("tab-2", "pane-2");

    expect(cache.resolve(identity, "tab-1", first)).toBe(first);
    expect(cache.resolve(identity, "tab-2", second)).toBe(second);
    expect(cache.resolve(identity, "tab-1", second)).toBe(first);
  });

  test("does not reuse layouts after the connection generation changes", () => {
    const cache = new TerminalTabLayoutCache();
    cache.resolve(identity, "tab-1", layout("tab-1", "pane-1"));

    expect(
      cache.resolve({ ...identity, generation: 5 }, "tab-1", null),
    ).toBeNull();
  });
});

test("terminal slot keys survive pane and tab reassignment within a connection", () => {
  const identity = { connectionId: "local", generation: 4 };
  const slotKey = terminalSlotMountKey(identity, 0);

  expect(terminalSlotMountKey(identity, 0)).toBe(slotKey);
  expect(terminalSlotMountKey(identity, 1)).not.toBe(slotKey);
  expect(terminalSlotMountKey({ ...identity, generation: 5 }, 0)).not.toBe(
    slotKey,
  );
});

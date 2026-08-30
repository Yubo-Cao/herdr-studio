import { describe, expect, test } from "bun:test";
import { paneLayoutNeedsSwitcher } from "./paneLayoutSizing";
import type { PaneLayout } from "./types";

function layout(
  panes: PaneLayout["panes"],
  area: PaneLayout["area"] = { x: 0, y: 0, width: 200, height: 100 },
): PaneLayout {
  return {
    workspace_id: "w1",
    tab_id: "t1",
    zoomed: false,
    focused_pane_id: panes[0]?.pane_id ?? "",
    panes,
    splits: [],
    area,
  };
}

describe("responsive terminal pane layout", () => {
  test("keeps comfortably wide horizontal panes visible together", () => {
    const split = layout([
      {
        pane_id: "left",
        focused: true,
        rect: { x: 0, y: 0, width: 100, height: 100 },
      },
      {
        pane_id: "right",
        focused: false,
        rect: { x: 100, y: 0, width: 100, height: 100 },
      },
    ]);

    expect(paneLayoutNeedsSwitcher(split, 1600)).toBe(false);
  });

  test("uses one-pane navigation when any horizontal pane is too narrow", () => {
    const split = layout([
      {
        pane_id: "left",
        focused: true,
        rect: { x: 0, y: 0, width: 70, height: 100 },
      },
      {
        pane_id: "right",
        focused: false,
        rect: { x: 70, y: 0, width: 130, height: 100 },
      },
    ]);

    expect(paneLayoutNeedsSwitcher(split, 1400)).toBe(true);
  });

  test("does not collapse vertically stacked panes", () => {
    const stacked = layout([
      {
        pane_id: "top",
        focused: true,
        rect: { x: 0, y: 0, width: 200, height: 50 },
      },
      {
        pane_id: "bottom",
        focused: false,
        rect: { x: 0, y: 50, width: 200, height: 50 },
      },
    ]);

    expect(paneLayoutNeedsSwitcher(stacked, 900)).toBe(false);
  });
});

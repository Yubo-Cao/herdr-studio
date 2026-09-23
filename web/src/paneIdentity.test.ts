import { describe, expect, test } from "bun:test";
import {
  customTabLabel,
  groupPanesByTab,
  paneDisplayName,
  shouldShowTabGroups,
} from "./paneIdentity";

const pane = (overrides: Record<string, unknown> = {}) => ({
  pane_id: "w1:p2",
  tab_id: "w1:t1",
  agent: "claude",
  cwd: "/home/me/project",
  ...overrides,
});

describe("pane identity", () => {
  test("ignores Herdr's default numeric tab labels", () => {
    expect(customTabLabel("1")).toBe("");
    expect(customTabLabel("Tab 3")).toBe("");
    expect(customTabLabel(" docs ")).toBe("docs");
  });

  test("prefers the pane name over the agent name", () => {
    expect(paneDisplayName(pane({ label: "review merge" }))).toBe(
      "review merge",
    );
    expect(paneDisplayName(pane())).toBe("project");
    expect(paneDisplayName(pane({ cwd: undefined }))).toBe("claude");
    expect(paneDisplayName(pane({ cwd: undefined, agent: undefined }))).toBe(
      "p2",
    );
  });

  test("uses a custom tab name only for single-pane tabs", () => {
    expect(paneDisplayName(pane(), { tabLabel: "docs", tabPaneCount: 1 })).toBe(
      "docs",
    );
    expect(paneDisplayName(pane(), { tabLabel: "docs", tabPaneCount: 2 })).toBe(
      "project",
    );
  });

  test("groups panes by tab in tab order", () => {
    const groups = groupPanesByTab(
      [
        pane({ pane_id: "w1:p3", tab_id: "w1:t2" }),
        pane({ pane_id: "w1:p1" }),
        pane({ pane_id: "w1:p2" }),
      ],
      [
        { tab_id: "w1:t1", label: "1", number: 1, pane_count: 3 },
        { tab_id: "w1:t2", label: "docs", number: 2, pane_count: 1 },
      ],
    );
    expect(groups.map((group) => group.label)).toEqual(["Tab 1", "docs"]);
    expect(groups[0]?.panes.map((item) => item.pane_id)).toEqual([
      "w1:p1",
      "w1:p2",
    ]);
    expect(groups[0]?.paneCount).toBe(3);
    expect(shouldShowTabGroups(groups)).toBe(true);
    expect(shouldShowTabGroups([{ paneCount: 1 }])).toBe(false);
  });
});

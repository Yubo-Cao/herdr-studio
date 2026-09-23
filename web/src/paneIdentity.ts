import type { Pane, Tab } from "./types";
import { basename, shortId } from "./utils";

/** A tab label worth showing: Herdr's default numeric labels are not. */
export function customTabLabel(label?: string | null): string {
  const trimmed = label?.trim() ?? "";
  return trimmed && !/^(?:Tab )?\d+$/.test(trimmed) ? trimmed : "";
}

export function paneLocationName(
  pane: Pick<Pane, "cwd" | "foreground_cwd">,
): string {
  const location = pane.foreground_cwd ?? pane.cwd;
  return location ? basename(location.replace(/\\/g, "/")) : "";
}

/**
 * The name a pane is known by. The agent icon already identifies the agent,
 * so the agent name is only the last resort after the user's pane name, a
 * custom single-pane tab name, and the working directory.
 */
export function paneDisplayName(
  pane: Pick<Pane, "label" | "agent" | "cwd" | "foreground_cwd" | "pane_id">,
  options: { tabLabel?: string; tabPaneCount?: number } = {},
): string {
  const label = pane.label?.trim();
  if (label) return label;
  const tabLabel = customTabLabel(options.tabLabel);
  if (tabLabel && (options.tabPaneCount ?? 1) <= 1) return tabLabel;
  return paneLocationName(pane) || pane.agent?.trim() || shortId(pane.pane_id);
}

export type PaneTabGroup<T extends Pick<Pane, "tab_id">> = {
  tabId: string;
  label: string;
  number: number;
  paneCount: number;
  panes: T[];
};

/** Group a workspace's panes by tab, in tab order, keeping pane order. */
export function groupPanesByTab<T extends Pick<Pane, "tab_id">>(
  panes: readonly T[],
  tabs: readonly Pick<Tab, "tab_id" | "label" | "number" | "pane_count">[],
): PaneTabGroup<T>[] {
  const byId = new Map(tabs.map((tab) => [tab.tab_id, tab]));
  const groups = new Map<string, PaneTabGroup<T>>();
  for (const pane of panes) {
    let group = groups.get(pane.tab_id);
    if (!group) {
      const tab = byId.get(pane.tab_id);
      group = {
        tabId: pane.tab_id,
        label:
          customTabLabel(tab?.label) ||
          `Tab ${tab?.number ?? shortId(pane.tab_id)}`,
        number: tab?.number ?? Number.MAX_SAFE_INTEGER,
        paneCount: tab?.pane_count ?? 0,
        panes: [],
      };
      groups.set(pane.tab_id, group);
    }
    group.panes.push(pane);
  }
  for (const group of groups.values())
    group.paneCount = Math.max(group.paneCount, group.panes.length);
  return [...groups.values()].sort((a, b) => a.number - b.number);
}

/** Tab headings only help once panes span tabs or share a split tab. */
export function shouldShowTabGroups(
  groups: readonly Pick<PaneTabGroup<Pick<Pane, "tab_id">>, "paneCount">[],
): boolean {
  return groups.length > 1 || groups.some((group) => group.paneCount > 1);
}

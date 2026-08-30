import type { PaneLayout } from "./types";

export const MIN_SPLIT_PANE_WIDTH = 720;

/**
 * Switch to one-pane navigation before a horizontal split makes a terminal
 * too narrow to remain useful. Vertically stacked panes keep their full width.
 */
export function paneLayoutNeedsSwitcher(
  layout: PaneLayout,
  containerWidth: number,
  minimumPaneWidth = MIN_SPLIT_PANE_WIDTH,
) {
  if (
    layout.zoomed ||
    layout.panes.length <= 1 ||
    !Number.isFinite(containerWidth) ||
    containerWidth <= 0 ||
    layout.area.width <= 0
  ) {
    return false;
  }

  return layout.panes.some((pane) => {
    const paneWidth = (pane.rect.width / layout.area.width) * containerWidth;
    return paneWidth < minimumPaneWidth;
  });
}

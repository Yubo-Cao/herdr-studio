export interface FloatingMenuPosition {
  left: number;
  top: number;
}

/** Keep a rendered floating menu inside the viewport around its anchor point. */
export function clampContextMenuPosition(
  anchor: FloatingMenuPosition,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): FloatingMenuPosition {
  const maxLeft = Math.max(margin, viewport.width - menu.width - margin);
  const maxTop = Math.max(margin, viewport.height - menu.height - margin);
  return {
    left: Math.max(margin, Math.min(anchor.left, maxLeft)),
    top: Math.max(margin, Math.min(anchor.top, maxTop)),
  };
}

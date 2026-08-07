export type OverlayThumbGeometry = {
  start: number;
  size: number;
  trackLength: number;
  maxScroll: number;
};

export function calculateOverlayThumb({
  viewportStart,
  viewportSize,
  clientSize,
  scrollSize,
  scrollOffset,
  inset = 3,
  minSize = 28,
}: {
  viewportStart: number;
  viewportSize: number;
  clientSize: number;
  scrollSize: number;
  scrollOffset: number;
  inset?: number;
  minSize?: number;
}): OverlayThumbGeometry | null {
  if (viewportSize <= 0 || clientSize <= 0 || scrollSize <= clientSize + 1) {
    return null;
  }

  const trackLength = Math.max(0, viewportSize - inset * 2);
  const proportionalSize = trackLength * (clientSize / scrollSize);
  const size = Math.min(trackLength, Math.max(minSize, proportionalSize));
  const maxScroll = Math.max(0, scrollSize - clientSize);
  const scrollRatio = Math.min(1, Math.max(0, scrollOffset / maxScroll));
  const travel = Math.max(0, trackLength - size);

  return {
    start: viewportStart + inset + travel * scrollRatio,
    size,
    trackLength,
    maxScroll,
  };
}

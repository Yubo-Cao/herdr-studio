/**
 * Publish collaboration presence without serializing terminal attachment
 * behind that independent RPC. Attach latency is directly visible as the time
 * between selecting a tab and receiving its first terminal frame.
 */
export function startTerminalAttach<T>(
  updatePresence: () => Promise<unknown>,
  attach: () => Promise<T>,
): Promise<T> {
  try {
    void updatePresence().catch(() => null);
  } catch {
    // Presence is best-effort and must not suppress terminal attachment even
    // if an implementation throws before returning its promise.
  }
  return attach();
}

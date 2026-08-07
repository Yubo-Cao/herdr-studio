export const MINIMUM_HERDR_PROTOCOL = 14;
const MAXIMUM_HERDR_PROTOCOL = 0xffffffff;

// Herdr requires clients to echo the server's exact protocol in Hello. Versions
// 14-17 kept the terminal wire variants used by the GUI stable, so optimistically
// allow newer versions as well instead of rejecting them solely for a newer
// number. A future release that changes a used wire layout will require a GUI
// codec update.
export function isSupportedHerdrProtocol(protocol: number): boolean {
  return (
    Number.isSafeInteger(protocol) &&
    protocol >= MINIMUM_HERDR_PROTOCOL &&
    protocol <= MAXIMUM_HERDR_PROTOCOL
  );
}

export function assertSupportedHerdrProtocol(protocol: number): void {
  if (
    !Number.isSafeInteger(protocol) ||
    protocol < 0 ||
    protocol > MAXIMUM_HERDR_PROTOCOL
  ) {
    throw new Error(`Herdr returned an invalid protocol version: ${protocol}`);
  }
  if (!isSupportedHerdrProtocol(protocol)) {
    throw new Error(
      `Herdr protocol ${protocol} is not supported by this herdr-gui build ` +
        `(requires protocol ${MINIMUM_HERDR_PROTOCOL} or newer)`,
    );
  }
}

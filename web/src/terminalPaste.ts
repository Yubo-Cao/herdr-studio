export function prepareTerminalPasteText(text: string) {
  // Match xterm's paste normalization while letting Herdr apply bracketed
  // paste from the authoritative PTY mode instead of the browser's stale copy.
  return text.replace(/\r?\n/g, "\r");
}

export function terminalPasteRequest(paneId: string, text: string) {
  return {
    method: "pane.send_input" as const,
    params: {
      pane_id: paneId,
      text: prepareTerminalPasteText(text),
      keys: [] as string[],
    },
  };
}

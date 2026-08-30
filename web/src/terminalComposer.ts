import { prepareTerminalPasteText } from "./terminalPaste";

/**
 * Draft storage for the mobile terminal composer.
 *
 * Drafts live only in memory: terminal input can contain secrets, so they
 * must never reach localStorage. Keys are scoped by connection identity
 * (including the reconnect generation) and pane ID, so a reconnect or a pane
 * switch never mixes drafts or sends text to the wrong pane.
 */
const drafts = new Map<string, string>();

export function terminalComposerDraftKey(
  connectionId: string,
  connectionGeneration: number,
  paneId: string,
): string {
  // Structured key: plain concatenation would let a digit-ending connection
  // ID collide across generations ("srv1"+2 vs "srv"+12).
  return JSON.stringify([connectionId, connectionGeneration, paneId]);
}

export function readTerminalComposerDraft(key: string): string {
  return drafts.get(key) ?? "";
}

export function writeTerminalComposerDraft(key: string, text: string): void {
  if (text) {
    drafts.set(key, text);
  } else {
    drafts.delete(key);
  }
}

export function clearTerminalComposerDraft(key: string): void {
  drafts.delete(key);
}

/** Test hook: number of retained drafts. */
export function terminalComposerDraftCount(): number {
  return drafts.size;
}

/**
 * Returns the subset of paneIds that currently hold a non-empty draft. Close
 * flows use this to warn before the draft becomes unreachable.
 */
export function terminalComposerDraftPaneIds(
  connectionId: string,
  connectionGeneration: number,
  paneIds: readonly string[],
): string[] {
  return paneIds.filter(
    (paneId) =>
      readTerminalComposerDraft(
        terminalComposerDraftKey(connectionId, connectionGeneration, paneId),
      ) !== "",
  );
}

/** Discards drafts for panes the user explicitly confirmed closing. */
export function clearTerminalComposerDrafts(
  connectionId: string,
  connectionGeneration: number,
  paneIds: readonly string[],
): void {
  for (const paneId of paneIds) {
    clearTerminalComposerDraft(
      terminalComposerDraftKey(connectionId, connectionGeneration, paneId),
    );
  }
}

/**
 * Sentence appended to a close-confirmation message when the close would
 * discard composer drafts. Returns "" when there is nothing to warn about.
 */
export function terminalComposerCloseWarning(draftCount: number): string {
  if (draftCount <= 0) return "";
  return draftCount === 1
    ? " The unsent composer draft will be discarded."
    : ` ${draftCount} unsent composer drafts will be discarded.`;
}

/**
 * Builds the mode-aware pane input request for a composer submission. The
 * server wraps the text in bracketed-paste markers only when the PTY has
 * bracketed paste enabled, and encodes the Enter key for the active terminal
 * mode. `submit: false` inserts the draft without executing it.
 */
export function terminalComposerRequest(
  paneId: string,
  text: string,
  submit: boolean,
) {
  return {
    method: "pane.send_input" as const,
    params: {
      pane_id: paneId,
      text: prepareTerminalPasteText(text),
      keys: submit ? ["enter"] : ([] as string[]),
    },
  };
}

/**
 * Inserts an uploaded image path at the composer caret, replacing the current
 * selection. A single space is added before the path when it would otherwise
 * touch non-whitespace text, and always after it unless whitespace follows,
 * so the path stays a separate shell word and continued typing cannot merge
 * into it. Returns the next draft text and the caret position after it.
 */
export function terminalComposerInsertAtCaret(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  insertion: string,
): { text: string; caret: number } {
  const before = text.slice(0, selectionStart);
  const after = text.slice(selectionEnd);
  const needsLeadingSpace = before !== "" && !/\s$/.test(before);
  const needsTrailingSpace = !/^\s/.test(after);
  const inserted = `${needsLeadingSpace ? " " : ""}${insertion}${
    needsTrailingSpace ? " " : ""
  }`;
  return {
    text: `${before}${inserted}${after}`,
    caret: before.length + inserted.length,
  };
}

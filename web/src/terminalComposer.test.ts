import { describe, expect, test } from "bun:test";
import {
  clearTerminalComposerDraft,
  clearTerminalComposerDrafts,
  readTerminalComposerDraft,
  terminalComposerCloseWarning,
  terminalComposerDraftCount,
  terminalComposerDraftKey,
  terminalComposerDraftPaneIds,
  terminalComposerInsertAtCaret,
  terminalComposerRequest,
  writeTerminalComposerDraft,
} from "./terminalComposer";

describe("terminal composer drafts", () => {
  test("scopes drafts by connection, generation, and pane", () => {
    const first = terminalComposerDraftKey("conn-a", 1, "pane-1");
    const switchedPane = terminalComposerDraftKey("conn-a", 1, "pane-2");
    const reconnected = terminalComposerDraftKey("conn-a", 2, "pane-1");
    const otherConnection = terminalComposerDraftKey("conn-b", 1, "pane-1");
    const keys = [first, switchedPane, reconnected, otherConnection];
    expect(new Set(keys).size).toBe(keys.length);

    writeTerminalComposerDraft(first, "draft one");
    writeTerminalComposerDraft(switchedPane, "draft two");
    expect(readTerminalComposerDraft(first)).toBe("draft one");
    expect(readTerminalComposerDraft(switchedPane)).toBe("draft two");
    expect(readTerminalComposerDraft(reconnected)).toBe("");
    expect(readTerminalComposerDraft(otherConnection)).toBe("");

    clearTerminalComposerDraft(first);
    clearTerminalComposerDraft(switchedPane);
  });

  test("digit-ending connection ids cannot collide across generations", () => {
    const first = terminalComposerDraftKey("srv1", 2, "pane-1");
    const second = terminalComposerDraftKey("srv", 12, "pane-1");
    expect(first).not.toBe(second);

    writeTerminalComposerDraft(first, "draft one");
    writeTerminalComposerDraft(second, "draft two");
    expect(readTerminalComposerDraft(first)).toBe("draft one");
    expect(readTerminalComposerDraft(second)).toBe("draft two");

    clearTerminalComposerDraft(first);
    clearTerminalComposerDraft(second);
  });

  test("drops empty drafts instead of retaining them", () => {
    const key = terminalComposerDraftKey("conn-c", 1, "pane-9");
    const before = terminalComposerDraftCount();
    writeTerminalComposerDraft(key, "hello");
    expect(terminalComposerDraftCount()).toBe(before + 1);
    writeTerminalComposerDraft(key, "");
    expect(terminalComposerDraftCount()).toBe(before);
    expect(readTerminalComposerDraft(key)).toBe("");
  });

  test("finds and clears drafts only for the given panes", () => {
    writeTerminalComposerDraft(terminalComposerDraftKey("c", 1, "p1"), "a");
    writeTerminalComposerDraft(terminalComposerDraftKey("c", 1, "p2"), "");
    writeTerminalComposerDraft(terminalComposerDraftKey("c", 1, "p3"), "b");
    writeTerminalComposerDraft(terminalComposerDraftKey("c", 2, "p1"), "gen");

    expect(terminalComposerDraftPaneIds("c", 1, ["p1", "p2", "p3"])).toEqual([
      "p1",
      "p3",
    ]);

    clearTerminalComposerDrafts("c", 1, ["p1", "p3"]);
    expect(terminalComposerDraftPaneIds("c", 1, ["p1", "p2", "p3"])).toEqual(
      [],
    );
    // Other generations stay untouched.
    expect(
      readTerminalComposerDraft(terminalComposerDraftKey("c", 2, "p1")),
    ).toBe("gen");
    clearTerminalComposerDrafts("c", 2, ["p1"]);
  });

  test("close warning matches the draft count", () => {
    expect(terminalComposerCloseWarning(0)).toBe("");
    expect(terminalComposerCloseWarning(1)).toBe(
      " The unsent composer draft will be discarded.",
    );
    expect(terminalComposerCloseWarning(3)).toBe(
      " 3 unsent composer drafts will be discarded.",
    );
  });
});

describe("terminal composer request", () => {
  test("inserts text without any keys when not submitting", () => {
    const request = terminalComposerRequest("p3", "echo 你好", false);
    expect(request.method).toBe("pane.send_input");
    expect(request.params).toEqual({
      pane_id: "p3",
      text: "echo 你好",
      keys: [],
    });
  });

  test("sends exactly one enter key when submitting", () => {
    const request = terminalComposerRequest("p3", "ls", true);
    expect(request.params.keys).toEqual(["enter"]);
  });

  test("normalizes newlines like terminal paste", () => {
    const request = terminalComposerRequest("p3", "one\r\ntwo\nthree", true);
    expect(request.params.text).toBe("one\rtwo\rthree");
  });
});

describe("terminal composer caret insertion", () => {
  const insert = (
    text: string,
    selectionStart: number,
    selectionEnd: number,
    insertion: string,
  ) =>
    terminalComposerInsertAtCaret(
      text,
      selectionStart,
      selectionEnd,
      insertion,
    );

  test("inserts into empty text with a trailing space", () => {
    expect(insert("", 0, 0, "/tmp/a.png")).toEqual({
      text: "/tmp/a.png ",
      caret: 11,
    });
  });

  test("pads around non-whitespace neighbors", () => {
    expect(insert("cat", 3, 3, "/tmp/a.png")).toEqual({
      text: "cat /tmp/a.png ",
      caret: 15,
    });
    expect(insert("|base64", 0, 0, "/tmp/a.png")).toEqual({
      text: "/tmp/a.png |base64",
      caret: 11,
    });
    expect(insert("echo hi", 4, 4, "/tmp/a.png")).toEqual({
      text: "echo /tmp/a.png hi",
      caret: 15,
    });
  });

  test("continued typing after an end insertion stays a separate word", () => {
    const inserted = insert("cat", 3, 3, "/tmp/a.png");
    expect(`${inserted.text}hello`).toBe("cat /tmp/a.png hello");
  });

  test("does not double up existing whitespace", () => {
    expect(insert("cat ", 4, 4, "/tmp/a.png")).toEqual({
      text: "cat /tmp/a.png ",
      caret: 15,
    });
    expect(insert(" /tmp", 0, 0, "x.png")).toEqual({
      text: "x.png /tmp",
      caret: 5,
    });
  });

  test("replaces the current selection", () => {
    expect(insert("cat old.png now", 4, 11, "/tmp/new.png")).toEqual({
      text: "cat /tmp/new.png now",
      caret: 16,
    });
  });
});

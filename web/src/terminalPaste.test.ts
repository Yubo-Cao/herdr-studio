import { describe, expect, test } from "bun:test";
import {
  prepareTerminalPasteText,
  terminalPasteRequest,
} from "./terminalPaste";

describe("terminal paste", () => {
  test("normalizes browser line endings like xterm", () => {
    expect(prepareTerminalPasteText("one\ntwo\r\nthree\rfour")).toBe(
      "one\rtwo\rthree\rfour",
    );
  });

  test("routes text through Herdr's mode-aware pane input API", () => {
    expect(terminalPasteRequest("p7", "if true\n  echo ok")).toEqual({
      method: "pane.send_input",
      params: {
        pane_id: "p7",
        text: "if true\r  echo ok",
        keys: [],
      },
    });
  });
});

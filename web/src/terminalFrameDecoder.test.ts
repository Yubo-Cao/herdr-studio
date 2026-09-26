import { describe, expect, test } from "bun:test";
import {
  TERMINAL_FRAME_HEAD,
  terminalFrameRowUpdate,
  terminalFrameText,
} from "../../shared/terminalFrame";
import { TerminalFrameDecoder } from "./terminalFrameDecoder";

const tail = "\x1b[?7h\x1b[0m\x1b[1;2H\x1b[2 q\x1b[?25h";

describe("terminal frame text", () => {
  test("joins rows into the bridge's full repaint", () => {
    expect(terminalFrameText({ rows: ["ab", "", "cd"], tail })).toBe(
      `${TERMINAL_FRAME_HEAD}ab\x1b[2;1H\x1b[3;1Hcd${tail}`,
    );
  });

  test("rewrites only changed rows on a default background", () => {
    const previous = { rows: ["ab", "x", "cd"], tail };
    expect(terminalFrameRowUpdate(previous, previous)).toBe("");
    expect(
      terminalFrameRowUpdate(previous, { rows: ["ab", "y", "cd"], tail }),
    ).toBe(`\x1b[0m\x1b[?7l\x1b[2;1H\x1b[0m\x1b[2Ky${tail}`);
    expect(terminalFrameRowUpdate(previous, { rows: ["ab"], tail })).toBeNull();
  });
});

describe("TerminalFrameDecoder", () => {
  test("applies row updates to the last full frame", () => {
    const decoder = new TerminalFrameDecoder();
    expect(decoder.decode({ frame_seq: 1, rows: ["a", "b"], tail })).toEqual({
      kind: "frame",
      seq: 1,
      parts: { rows: ["a", "b"], tail },
    });
    expect(
      decoder.decode({ frame_seq: 2, base_seq: 1, changed: [[1, "B"]] }),
    ).toEqual({ kind: "frame", seq: 2, parts: { rows: ["a", "B"], tail } });
  });

  test("asks once for a full frame after a gap", () => {
    const decoder = new TerminalFrameDecoder();
    decoder.decode({ frame_seq: 1, rows: ["a"], tail });
    expect(
      decoder.decode({ frame_seq: 3, base_seq: 2, changed: [[0, "x"]] }),
    ).toEqual({ kind: "resync" });
    expect(
      decoder.decode({ frame_seq: 4, base_seq: 3, changed: [[0, "y"]] }),
    ).toEqual({ kind: "none" });
    expect(decoder.decode({ frame_seq: 5, rows: ["z"], tail }).kind).toBe(
      "frame",
    );
  });

  test("rejects rows outside the frame", () => {
    const decoder = new TerminalFrameDecoder();
    decoder.decode({ frame_seq: 1, rows: ["a"], tail });
    expect(
      decoder.decode({ frame_seq: 2, base_seq: 1, changed: [[5, "x"]] }),
    ).toEqual({ kind: "resync" });
  });
});

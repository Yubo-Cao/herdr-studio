import { describe, expect, test } from "bun:test";
import {
  terminalImeEventTime,
  terminalImeFallbackText,
  TerminalImeFallbackTracker,
} from "./terminalIme";

function inputEvent(
  data: string,
  overrides: Partial<Parameters<typeof terminalImeFallbackText>[0]> = {},
): Parameters<typeof terminalImeFallbackText>[0] {
  return {
    data,
    inputType: "insertText",
    isComposing: false,
    ...overrides,
  };
}

describe("terminal IME punctuation detection", () => {
  test("accepts common full-width punctuation", () => {
    for (const text of [
      "，",
      "。",
      "？",
      "！",
      "：",
      "；",
      "（）",
      "“”",
      "、",
      "～",
      "￥",
    ]) {
      expect(terminalImeFallbackText(inputEvent(text))).toBe(text);
    }
  });

  test("leaves text, ASCII keys, paste, and active composition to xterm", () => {
    expect(terminalImeFallbackText(inputEvent("中文"))).toBeNull();
    expect(terminalImeFallbackText(inputEvent(","))).toBeNull();
    expect(
      terminalImeFallbackText(inputEvent("，", { isComposing: true })),
    ).toBeNull();
    expect(
      terminalImeFallbackText(
        inputEvent("，", { inputType: "insertFromPaste" }),
      ),
    ).toBeNull();
  });

  test("uses comparable DOM timestamps and rejects legacy epoch timestamps", () => {
    expect(terminalImeEventTime({ timeStamp: 95 }, 100)).toBe(95);
    expect(terminalImeEventTime({ timeStamp: 1_800_000_000_000 }, 100)).toBe(
      100,
    );
  });
});

describe("terminal IME punctuation fallback tracking", () => {
  test("consumes xterm output emitted immediately before the input listener", () => {
    const tracker = new TerminalImeFallbackTracker();
    expect(tracker.recordXtermData("，", 105)).toBe(true);
    expect(tracker.recordInput("，", 100, 106)).toBe(false);
  });

  test("does not consume output from the preceding keyboard event", () => {
    const tracker = new TerminalImeFallbackTracker();
    tracker.recordXtermData("，", 100);
    expect(tracker.recordInput("，", 104, 106)).toBe(true);
  });

  test("suppresses delayed xterm output after an immediate fallback", () => {
    const tracker = new TerminalImeFallbackTracker();
    expect(tracker.recordInput("。", 100)).toBe(true);
    expect(tracker.recordXtermData("。", 102)).toBe(false);
  });

  test("keeps every rapid repeated input while suppressing delayed duplicates", () => {
    const tracker = new TerminalImeFallbackTracker();
    expect(tracker.recordInput("，", 100)).toBe(true);
    expect(tracker.recordInput("，", 104)).toBe(true);
    expect(tracker.recordXtermData("，", 106)).toBe(false);
    expect(tracker.recordXtermData("，", 108)).toBe(false);
  });

  test("does not let different rapid punctuation suppress each other", () => {
    const tracker = new TerminalImeFallbackTracker();
    expect(tracker.recordInput("，", 100)).toBe(true);
    expect(tracker.recordInput("。", 103)).toBe(true);
    expect(tracker.recordXtermData("。", 105)).toBe(false);
    expect(tracker.recordXtermData("，", 106)).toBe(false);
  });

  test("does not suppress unrelated xterm data after the duplicate window", () => {
    const tracker = new TerminalImeFallbackTracker();
    expect(tracker.recordInput("，", 100)).toBe(true);
    expect(tracker.recordXtermData("，", 130)).toBe(true);
  });

  test("preserves order when xterm drops or delays part of a rapid sequence", () => {
    const tracker = new TerminalImeFallbackTracker();
    const sent: string[] = [];
    const input = (text: string, eventAt: number, mode: "before" | "after" | "missing") => {
      if (mode === "before" && tracker.recordXtermData(text, eventAt + 1)) {
        sent.push(text);
      }
      if (tracker.recordInput(text, eventAt, eventAt + 2)) sent.push(text);
      if (mode === "after" && tracker.recordXtermData(text, eventAt + 3)) {
        sent.push(text);
      }
    };

    input("，", 100, "missing");
    input("。", 110, "before");
    input("？", 120, "after");
    input("！", 130, "missing");

    expect(sent.join("")).toBe("，。？！");
  });
});

import { describe, expect, test } from "bun:test";
import { terminalPageScroll, terminalWheelScroll } from "./terminalScroll";

describe("terminal wheel scrolling", () => {
  test("uses wheel routing instead of keyboard page navigation", () => {
    expect(terminalWheelScroll(-80, 0, 30)).toEqual({
      direction: "up",
      lines: 2,
      source: "wheel",
    });
    expect(terminalWheelScroll(80, 0, 30)).toEqual({
      direction: "down",
      lines: 2,
      source: "wheel",
    });
  });

  test("normalizes line and page deltas", () => {
    expect(terminalWheelScroll(-2.2, 1, 30)?.lines).toBe(3);
    expect(terminalWheelScroll(1, 2, 30)?.lines).toBe(30);
    expect(terminalWheelScroll(0, 0, 30)).toBeNull();
  });

  test("routes Page Up and Page Down through scrollback, not key input", () => {
    expect(terminalPageScroll("up", 30)).toEqual({
      direction: "up",
      lines: 28,
      source: "wheel",
    });
    expect(terminalPageScroll("down", 1)).toEqual({
      direction: "down",
      lines: 1,
      source: "wheel",
    });
  });

  test("supports half-page scrollback with a readable overlap", () => {
    expect(terminalPageScroll("up", 30, "half")).toEqual({
      direction: "up",
      lines: 14,
      source: "wheel",
    });
    expect(terminalPageScroll("down", 2, "half")).toEqual({
      direction: "down",
      lines: 1,
      source: "wheel",
    });
  });
});

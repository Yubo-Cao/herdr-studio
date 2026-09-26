import { expect, test } from "bun:test";
import { terminalLigatureRanges, unrequestedGlyphs } from "./terminalRenderer";

test("joins programming ligatures, longest match first", () => {
  expect(terminalLigatureRanges("a => b")).toEqual([[2, 4]]);
  expect(terminalLigatureRanges("x !== y")).toEqual([[2, 5]]);
  expect(terminalLigatureRanges("<!-- -->")).toEqual([
    [0, 4],
    [5, 8],
  ]);
  expect(terminalLigatureRanges("plain text")).toEqual([]);
});

test("requests each non-ASCII glyph's font chunk only once", () => {
  expect(unrequestedGlyphs(["plain ascii", "中文 \ue0b0"])).toBe("中文\ue0b0");
  expect(unrequestedGlyphs(["中文 again", "新"])).toBe("新");
});

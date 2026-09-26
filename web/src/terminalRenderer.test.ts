import { expect, test } from "bun:test";
import { terminalLigatureRanges } from "./terminalRenderer";

test("joins programming ligatures, longest match first", () => {
  expect(terminalLigatureRanges("a => b")).toEqual([[2, 4]]);
  expect(terminalLigatureRanges("x !== y")).toEqual([[2, 5]]);
  expect(terminalLigatureRanges("<!-- -->")).toEqual([
    [0, 4],
    [5, 8],
  ]);
  expect(terminalLigatureRanges("plain text")).toEqual([]);
});

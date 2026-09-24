import { describe, expect, test } from "bun:test";
import { dictationCleanupEdit, extendDictationSpan } from "./dictationSpan";

describe("dictation span", () => {
  test("grows while segments land contiguously", () => {
    let span = extendDictationSpan(null, 4, " hello");
    span = extendDictationSpan(span, 10, " world");
    expect(span).toEqual({ start: 4, text: " hello world", broken: false });
    expect(extendDictationSpan(span, 3, "x").broken).toBe(true);
  });

  test("replaces only an unedited span and keeps its outer spacing", () => {
    const span = { start: 4, text: " um hello world", broken: false };
    const draft = "ls -la um hello world tail";
    expect(dictationCleanupEdit(draft, span, "Hello world.\n")).toBeNull();
    const exact = "ls: um hello world";
    expect(
      dictationCleanupEdit(exact, { ...span, start: 3 }, " Hello world. "),
    ).toEqual({ start: 3, end: 18, text: " Hello world." });
    expect(
      dictationCleanupEdit(exact, { ...span, start: 3, broken: true }, "x"),
    ).toBeNull();
    expect(dictationCleanupEdit(exact, { ...span, start: 3 }, "  ")).toBeNull();
  });
});

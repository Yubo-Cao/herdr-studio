import { describe, expect, test } from "bun:test";
import {
  applyTerminalModifiers,
  consumeTerminalModifiers,
  NO_TERMINAL_MODIFIERS,
  tapTerminalModifier,
} from "./terminalModifiers";

const mods = (ctrl = false, alt = false, shift = false) => ({
  ctrl,
  alt,
  shift,
});

describe("latching terminal modifiers", () => {
  test("tap arms once, a quick second tap locks, a later tap releases", () => {
    const once = tapTerminalModifier(NO_TERMINAL_MODIFIERS, "ctrl", 10_000);
    expect(once.ctrl).toBe("once");
    expect(tapTerminalModifier(once, "ctrl", 200).ctrl).toBe("locked");
    expect(tapTerminalModifier(once, "ctrl", 900).ctrl).toBe("off");
    const locked = tapTerminalModifier(once, "ctrl", 200);
    expect(tapTerminalModifier(locked, "ctrl", 100).ctrl).toBe("off");
  });

  test("one-shot modifiers release after a key; locked ones stay", () => {
    expect(
      consumeTerminalModifiers({ ctrl: "once", alt: "locked", shift: "off" }),
    ).toEqual({ ctrl: "off", alt: "locked", shift: "off" });
  });
});

describe("applyTerminalModifiers", () => {
  test("control letters and symbols", () => {
    expect(applyTerminalModifiers("c", mods(true))).toBe("\x03");
    expect(applyTerminalModifiers("C", mods(true))).toBe("\x03");
    expect(applyTerminalModifiers("z", mods(true))).toBe("\x1a");
    expect(applyTerminalModifiers("[", mods(true))).toBe("\x1b");
    expect(applyTerminalModifiers(" ", mods(true))).toBe("\x00");
  });

  test("alt prefixes escape and shift uppercases", () => {
    expect(applyTerminalModifiers("b", mods(false, true))).toBe("\x1bb");
    expect(applyTerminalModifiers("a", mods(false, false, true))).toBe("A");
    expect(applyTerminalModifiers("x", mods(true, true))).toBe("\x1b\x18");
  });

  test("navigation keys gain xterm modifier parameters", () => {
    expect(applyTerminalModifiers("\x1b[A", mods(true))).toBe("\x1b[1;5A");
    expect(applyTerminalModifiers("\x1bOD", mods(false, true))).toBe(
      "\x1b[1;3D",
    );
    expect(applyTerminalModifiers("\x1b[5~", mods(false, false, true))).toBe(
      "\x1b[5;2~",
    );
    expect(applyTerminalModifiers("\t", mods(false, false, true))).toBe(
      "\x1b[Z",
    );
    expect(applyTerminalModifiers("\r", mods(false, false, true))).toBe(
      "\x1b[13;2u",
    );
    expect(applyTerminalModifiers("\x7f", mods(true))).toBe("\x08");
  });

  test("multi-character input leaves modifiers armed", () => {
    expect(applyTerminalModifiers("hello", mods(true))).toBeNull();
    expect(applyTerminalModifiers("hello", mods())).toBe("hello");
  });
});

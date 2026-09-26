import { expect, test } from "bun:test";
import { parseHostTheme } from "./terminal-bridge";

test("host themes need an appearance and hex default colors", () => {
  expect(
    parseHostTheme({
      appearance: "light",
      foreground: "#1f2328",
      background: "#FFFFFF",
      palette: ["#000000", null, "#abcdef"],
    }),
  ).toEqual({
    appearance: "light",
    foreground: { r: 0x1f, g: 0x23, b: 0x28 },
    background: { r: 255, g: 255, b: 255 },
    // Invalid entries are skipped without shifting later palette indexes.
    palette: [
      [0, { r: 0, g: 0, b: 0 }],
      [2, { r: 0xab, g: 0xcd, b: 0xef }],
    ],
  });
  expect(
    parseHostTheme({
      appearance: "dim",
      foreground: "#000",
      background: "#fff",
    }),
  ).toBeNull();
  expect(
    parseHostTheme({
      appearance: "dark",
      foreground: "red",
      background: "#000000",
    }),
  ).toBeNull();
});

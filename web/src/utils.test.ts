import { describe, expect, test } from "bun:test";
import { formatMemoryLimit } from "./utils";

describe("formatMemoryLimit", () => {
  test("words a limit the way the server words the same one", () => {
    expect(formatMemoryLimit(12 * 1024 * 1024 * 1024)).toBe("12.0 GiB");
    expect(formatMemoryLimit(1536 * 1024 * 1024)).toBe("1.5 GiB");
    expect(formatMemoryLimit(512 * 1024 * 1024)).toBe("512 MiB");
  });
});

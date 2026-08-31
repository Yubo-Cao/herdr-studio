import { expect, test } from "bun:test";
import { startTerminalAttach } from "./terminalAttach";

test("starts terminal attachment without waiting for presence publication", async () => {
  const order: string[] = [];
  let resolvePresence!: () => void;
  const presence = new Promise<void>((resolve) => {
    resolvePresence = resolve;
  });

  const attached = startTerminalAttach(
    () => {
      order.push("presence");
      return presence;
    },
    async () => {
      order.push("attach");
      return "attached";
    },
  );

  expect(order).toEqual(["presence", "attach"]);
  expect(await attached).toBe("attached");
  expect(order).toEqual(["presence", "attach"]);
  resolvePresence();
  await presence;
});

test("still attaches when presence throws synchronously", async () => {
  expect(
    await startTerminalAttach(
      () => {
        throw new Error("presence unavailable");
      },
      async () => "attached",
    ),
  ).toBe("attached");
});

import { expect, test } from "bun:test";
import { TerminalInputBatcher } from "./terminalInputBatcher";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test("merges keys typed while a call is in flight, in order", async () => {
  const sent: string[] = [];
  const replies: (() => void)[] = [];
  const batcher = new TerminalInputBatcher(
    (bytes) =>
      new Promise<void>((resolve) => {
        sent.push(text(bytes));
        replies.push(resolve);
      }),
  );
  const encode = (value: string) => new TextEncoder().encode(value);
  batcher.send(encode("a"));
  batcher.send(encode("b"));
  batcher.send(encode("c"));
  batcher.send(encode("\x1b"));
  batcher.send(encode("d"));
  expect(sent).toEqual(["a"]);
  replies.shift()!();
  await Bun.sleep(0);
  expect(sent).toEqual(["a", "bc"]);
  replies.shift()!();
  await Bun.sleep(0);
  expect(sent).toEqual(["a", "bc", "\x1b"]);
  replies.shift()!();
  await Bun.sleep(0);
  expect(sent).toEqual(["a", "bc", "\x1b", "d"]);
});

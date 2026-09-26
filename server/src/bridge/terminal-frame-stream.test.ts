import { afterEach, describe, expect, jest, test } from "bun:test";
import {
  FRAME_STREAM_ACK_TIMEOUT_MS,
  FRAME_STREAM_MAX_INFLIGHT,
  TerminalFrameStream,
} from "./terminal-frame-stream";

const meta = { width: 4, height: 3, full: true, mouse_reporting: false };
const parts = (rows: string[], tail = "\x1b[?7h\x1b[?25l") => ({ rows, tail });

function stream() {
  const sent: Record<string, unknown>[] = [];
  const frames = new TerminalFrameStream((terminal) => {
    sent.push(terminal);
    return JSON.stringify(terminal).length;
  });
  return { frames, sent };
}

afterEach(() => {
  jest.useRealTimers();
});

describe("TerminalFrameStream", () => {
  test("sends the first frame in full and later frames as changed rows", () => {
    const { frames, sent } = stream();
    frames.offer(parts(["a", "b", "c"]), meta);
    expect(sent[0]).toMatchObject({ rows: ["a", "b", "c"], width: 4 });
    frames.ack(sent[0].frame_seq as number);
    frames.offer(parts(["a", "B", "c"]), meta);
    expect(sent[1]).toMatchObject({
      base_seq: sent[0].frame_seq,
      changed: [[1, "B"]],
    });
    expect(sent[1]).not.toHaveProperty("rows");
    expect(sent[1]).not.toHaveProperty("tail");
  });

  test("skips frames identical to the last one sent", () => {
    const { frames, sent } = stream();
    frames.offer(parts(["a", "b", "c"]), meta);
    frames.ack(sent[0].frame_seq as number);
    frames.offer(parts(["a", "b", "c"]), meta);
    expect(sent).toHaveLength(1);
    frames.offer(parts(["a", "b", "c"]), { ...meta, link_frame: "next" });
    expect(sent[1]).toMatchObject({ changed: [], link_frame: "next" });
  });

  test("holds only the newest frame while the window is full", () => {
    const { frames, sent } = stream();
    for (let i = 0; i < FRAME_STREAM_MAX_INFLIGHT + 3; i++)
      frames.offer(parts([`${i}`, "b", "c"]), meta);
    expect(sent).toHaveLength(FRAME_STREAM_MAX_INFLIGHT);
    frames.ack(sent[FRAME_STREAM_MAX_INFLIGHT - 1].frame_seq as number);
    expect(sent).toHaveLength(FRAME_STREAM_MAX_INFLIGHT + 1);
    expect(sent.at(-1)).toMatchObject({
      base_seq: sent[FRAME_STREAM_MAX_INFLIGHT - 1].frame_seq,
      changed: [[0, `${FRAME_STREAM_MAX_INFLIGHT + 2}`]],
    });
  });

  test("resends in full after a reset, a resync, or a resize", () => {
    const { frames, sent } = stream();
    frames.offer(parts(["a", "b", "c"]), meta);
    frames.ack(sent[0].frame_seq as number);
    frames.resync();
    expect(sent[1]).toMatchObject({ rows: ["a", "b", "c"] });
    frames.ack(sent[1].frame_seq as number);
    frames.reset();
    frames.offer(parts(["a", "b", "c"]), meta);
    expect(sent[2]).toHaveProperty("rows");
    frames.ack(sent[2].frame_seq as number);
    frames.offer(parts(["a", "b"]), { ...meta, height: 2 });
    expect(sent[3]).toMatchObject({ rows: ["a", "b"] });
  });

  test("releases the window when acknowledgements stop", () => {
    jest.useFakeTimers();
    const { frames, sent } = stream();
    for (let i = 0; i <= FRAME_STREAM_MAX_INFLIGHT; i++)
      frames.offer(parts([`${i}`, "b", "c"]), meta);
    expect(sent).toHaveLength(FRAME_STREAM_MAX_INFLIGHT);
    jest.advanceTimersByTime(FRAME_STREAM_ACK_TIMEOUT_MS);
    expect(sent).toHaveLength(FRAME_STREAM_MAX_INFLIGHT + 1);
    frames.dispose();
  });
});

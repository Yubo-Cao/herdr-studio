import { expect, jest, test } from "bun:test";
import { createTrailingThrottle } from "./runtime";

test("presence snapshots forward immediately, then the newest once per interval", () => {
  jest.useFakeTimers();
  try {
    const delivered: number[] = [];
    const throttle = createTrailingThrottle(1000, (value: number) =>
      delivered.push(value),
    );
    throttle.push(1);
    throttle.push(2);
    throttle.push(3);
    expect(delivered).toEqual([1]);
    jest.advanceTimersByTime(1000);
    expect(delivered).toEqual([1, 3]);
    jest.advanceTimersByTime(1000);
    throttle.push(4);
    expect(delivered).toEqual([1, 3, 4]);
    throttle.push(5);
    throttle.cancel();
    jest.advanceTimersByTime(5000);
    expect(delivered).toEqual([1, 3, 4]);
  } finally {
    jest.useRealTimers();
  }
});

import { expect, test } from "bun:test";
import { TerminalScrollIntent } from "./terminal-scroll-intent";

test("delayed surfaces never reverse a continuous downward gesture", () => {
  const scroll = new TerminalScrollIntent();
  scroll.observe(100, 200, 0);
  const first = scroll.next(-10, 1)!;
  expect(first.offset).toBe(90);
  scroll.observe(100, 200, 2);
  const second = scroll.next(-10, 3)!;
  expect(second.offset).toBe(80);
  scroll.acknowledge(first.id, 4);
  scroll.observe(90, 200, 5);
  const third = scroll.next(-10, 6)!;
  expect(third.offset).toBe(70);
  scroll.acknowledge(second.id, 7);
  scroll.observe(80, 200, 8);
  expect(scroll.next(-10, 9)?.offset).toBe(60);
});
test("the final acknowledged surface restores authoritative scrolling", () => {
  const scroll = new TerminalScrollIntent();
  scroll.observe(20, 100, 0);
  const request = scroll.next(-10, 1)!;
  scroll.acknowledge(request.id, 2);
  scroll.observe(10, 100, 3);
  scroll.observe(15, 105, 4); // output arrives while the viewport stays anchored
  expect(scroll.next(-5, 5)?.offset).toBe(10);
});
test("direction changes use pending intent; limits, failure and reset recover", () => {
  const scroll = new TerminalScrollIntent();
  expect(scroll.next(10)).toBeNull();
  scroll.observe(10, 20, 0);
  expect(scroll.next(-30, 1)?.offset).toBe(0);
  expect(scroll.next(-1, 2)).toBeNull();
  const up = scroll.next(5, 3)!;
  expect(up.offset).toBe(5);
  scroll.fail(up.id);
  expect(scroll.next(5, 4)?.offset).toBe(15);
  scroll.reset();
  expect(scroll.next(10, 5)).toBeNull();
});
test("history truncation and missing confirmation cannot pin stale intent forever", () => {
  const scroll = new TerminalScrollIntent();
  scroll.observe(50, 100, 0);
  const request = scroll.next(10, 1)!;
  scroll.acknowledge(request.id, 2);
  scroll.observe(20, 20, 3);
  expect(scroll.next(-5, 4)?.offset).toBe(15);
  const second = scroll.next(-5, 5)!;
  scroll.acknowledge(second.id, 6);
  scroll.observe(18, 20, 507);
  expect(scroll.next(-1, 508)?.offset).toBe(17);
});

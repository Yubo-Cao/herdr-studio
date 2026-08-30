import { describe, expect, test } from "bun:test";
import { collaborationProfileForSession } from "./collaboration";

describe("collaboration client sessions", () => {
  test("shares presentation without conflating independent client sessions", () => {
    const stored = {
      // Legacy profiles included participantId. It must never be reused by a
      // second tab because pane claims are session-scoped.
      participantId: "web-legacy",
      displayName: "Yubo",
      color: "#0969da",
    };

    const first = collaborationProfileForSession(
      "web-session-a",
      stored,
      "Studio user",
    );
    const second = collaborationProfileForSession(
      "web-session-b",
      stored,
      "Studio user",
    );

    expect(first).toEqual({
      participantId: "web-session-a",
      displayName: "Yubo",
      color: "#0969da",
    });
    expect(second).toEqual({
      participantId: "web-session-b",
      displayName: "Yubo",
      color: "#0969da",
    });
  });

  test("normalizes a stored name and rejects an invalid stored color", () => {
    expect(
      collaborationProfileForSession(
        "web-session",
        { displayName: "  Alice  ", color: "#1A7F37" },
        "Studio user",
      ),
    ).toEqual({
      participantId: "web-session",
      displayName: "Alice",
      color: "#1A7F37",
    });

    const fallback = collaborationProfileForSession(
      "web-session",
      { displayName: "Alice", color: "blue" },
      "Studio user",
    );
    expect(fallback.displayName).toBe("Studio user");
    expect(fallback.color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

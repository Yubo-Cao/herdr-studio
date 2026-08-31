import { describe, expect, test } from "bun:test";
import {
  acceptCollaborationEvent,
  collaborationProfileForSession,
  participantIsTyping,
  shouldTakeOverPaneFromMouse,
  subscribeCollaborationSnapshot,
} from "./collaboration";
import type { ConnectionClient } from "./api";

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

describe("collaboration interaction signals", () => {
  test("takes over an observed pane only on Shift + primary click", () => {
    expect(shouldTakeOverPaneFromMouse({ button: 0, shiftKey: true })).toBe(
      true,
    );
    expect(shouldTakeOverPaneFromMouse({ button: 0, shiftKey: false })).toBe(
      false,
    );
    expect(shouldTakeOverPaneFromMouse({ button: 2, shiftKey: true })).toBe(
      false,
    );
  });

  test("typing status honors its short lease", () => {
    const participant = {
      participant_id: "alice",
      display_name: "Alice",
      color: "#0969da",
      role: "editor" as const,
      activity: "active" as const,
      surface: "web",
      typing: true,
      typing_expires_at_unix_ms: 2_000,
      updated_at_unix_ms: 1_000,
      expires_at_unix_ms: 46_000,
    };
    expect(participantIsTyping(participant, 1_999)).toBe(true);
    expect(participantIsTyping(participant, 2_000)).toBe(false);
  });

  test("publishes generation-scoped collaboration WebSocket events", () => {
    const client: ConnectionClient = {
      connectionId: "collaboration-test",
      generation: 4,
      serverRuntimeGeneration: 7,
      call: async () => null,
      isCurrent: () => true,
      acceptsServerGeneration: (value) => value === 7,
    };
    const seen: unknown[] = [];
    const unsubscribe = subscribeCollaborationSnapshot(client, (snapshot) =>
      seen.push(snapshot),
    );
    const accepted = acceptCollaborationEvent(client, {
      connection_id: "collaboration-test",
      connection_generation: 7,
      event: "collaboration_updated",
      data: {
        type: "collaboration_updated",
        snapshot: {
          participants: [],
          pane_claims: [],
          lease_ttl_ms: 45_000,
        },
      },
    });
    const rejected = acceptCollaborationEvent(client, {
      connection_id: "collaboration-test",
      connection_generation: 6,
      event: "collaboration_updated",
      data: {
        snapshot: { participants: [], pane_claims: [] },
      },
    });
    unsubscribe();

    expect(accepted).toBe(true);
    expect(rejected).toBe(false);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeNull();
  });
});

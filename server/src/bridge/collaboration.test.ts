import { describe, expect, test } from "bun:test";
import { createCollaborationService } from "./collaboration";

function participant(participantId: string) {
  return {
    participant_id: participantId,
    display_name: participantId,
    color: "#0969da",
    role: "editor",
    activity: "active",
    surface: "web",
  };
}

describe("collaboration compatibility service", () => {
  test("falls back for an older core and keeps pane control exclusive", async () => {
    const service = createCollaborationService({
      herdrCall: async () => {
        throw new Error("invalid response envelope from Herdr");
      },
    });

    await service.call("collaboration.update", participant("alice"));
    await service.call("collaboration.update", participant("bob"));

    const alice = await service.call("collaboration.claim", {
      participant_id: "alice",
      pane_id: "pane-1",
    });
    const denied = await service.call("collaboration.claim", {
      participant_id: "bob",
      pane_id: "pane-1",
    });
    const takeover = await service.call("collaboration.claim", {
      participant_id: "bob",
      pane_id: "pane-1",
      takeover: true,
    });

    expect(alice.granted).toBe(true);
    expect(denied).toMatchObject({
      granted: false,
      claim: { participant_id: "alice" },
    });
    expect(takeover).toMatchObject({
      granted: true,
      claim: { participant_id: "bob" },
    });
  });

  test("uses the core API when it is available", async () => {
    const calls: string[] = [];
    const service = createCollaborationService({
      herdrCall: async (method) => {
        calls.push(method);
        return {
          type: "collaboration_snapshot",
          snapshot: { participants: [] },
        };
      },
    });

    const result = await service.call("collaboration.list");
    expect(calls).toEqual(["collaboration.list"]);
    expect(result.type).toBe("collaboration_snapshot");
  });

  test("protects an explicit layout takeover for the requested interval", async () => {
    let now = 1_000;
    const service = createCollaborationService({
      herdrCall: async () => {
        throw new Error("unknown method");
      },
      now: () => now,
    });
    await service.call("collaboration.update", participant("alice"));
    await service.call("collaboration.update", participant("bob"));

    const alice = await service.call("collaboration.claim", {
      participant_id: "alice",
      pane_id: "pane-1",
      takeover: true,
      protect_ms: 15_000,
    });
    expect(alice.claim.protected_until_unix_ms).toBe(16_000);

    now = 15_999;
    const denied = await service.call("collaboration.claim", {
      participant_id: "bob",
      pane_id: "pane-1",
      takeover: true,
      protect_ms: 15_000,
    });
    expect(denied).toMatchObject({
      granted: false,
      claim: { participant_id: "alice" },
    });

    now = 16_000;
    const bob = await service.call("collaboration.claim", {
      participant_id: "bob",
      pane_id: "pane-1",
      takeover: true,
      protect_ms: 15_000,
    });
    expect(bob).toMatchObject({
      granted: true,
      claim: { participant_id: "bob" },
    });
  });

  test("tracks multiple pane claims per participant without merging sessions", async () => {
    const service = createCollaborationService({
      herdrCall: async () => {
        throw new Error("unknown method");
      },
    });

    await service.call("collaboration.update", participant("alice-session"));
    await service.call("collaboration.update", participant("bob-session"));
    await service.call("collaboration.claim", {
      participant_id: "alice-session",
      pane_id: "pane-1",
    });
    await service.call("collaboration.claim", {
      participant_id: "alice-session",
      pane_id: "pane-2",
    });
    const denied = await service.call("collaboration.claim", {
      participant_id: "bob-session",
      pane_id: "pane-2",
    });
    const bob = await service.call("collaboration.claim", {
      participant_id: "bob-session",
      pane_id: "pane-3",
    });
    const snapshot = await service.call("collaboration.list");

    expect(denied.granted).toBe(false);
    expect(bob.granted).toBe(true);
    expect(snapshot.snapshot.participants).toHaveLength(2);
    expect(snapshot.snapshot.pane_claims).toMatchObject([
      { pane_id: "pane-1", participant_id: "alice-session" },
      { pane_id: "pane-2", participant_id: "alice-session" },
      { pane_id: "pane-3", participant_id: "bob-session" },
    ]);
  });

  test("broadcasts fallback presence and expires typing independently", async () => {
    let now = 1_000;
    const snapshots: any[] = [];
    const service = createCollaborationService({
      herdrCall: async () => {
        throw new Error("unknown method");
      },
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      now: () => now,
    });

    await service.call("collaboration.update", {
      ...participant("alice"),
      pane_id: "pane-1",
      typing: true,
    });
    expect(snapshots.at(-1).participants[0].typing).toBe(true);

    now += 3_001;
    const snapshot = await service.call("collaboration.list");
    expect(snapshot.snapshot.participants[0].typing).toBe(false);
    expect(snapshot.snapshot.participants).toHaveLength(1);
  });
});

import { expect, test } from "bun:test";
import type { ConnectionClient } from "./api";
import type { CollaborationSnapshot } from "./collaboration";
import {
  type PaneControlState,
  paneControlClient,
  paneControlState,
} from "./paneControl";

const snapshot: CollaborationSnapshot = {
  participants: [
    {
      participant_id: "alice",
      display_name: "Alice",
      color: "#0969da",
      role: "editor",
      activity: "active",
      surface: "web",
      updated_at_unix_ms: 100,
      expires_at_unix_ms: 500,
    },
  ],
  pane_claims: [
    {
      participant_id: "alice",
      pane_id: "p1",
      acquired_at_unix_ms: 100,
      updated_at_unix_ms: 100,
      expires_at_unix_ms: 500,
      protected_until_unix_ms: 250,
    },
  ],
  lease_ttl_ms: 400,
};
test("layout ownership is pane-specific, expires, and does not grant input in view-only mode", () => {
  expect(paneControlState(snapshot, "p1", "bob", false, 200)).toMatchObject({
    ownsLayout: false,
    canResize: false,
    ownerName: "Alice",
    protectedUntil: 250,
  });
  expect(paneControlState(snapshot, "p2", "bob", false, 200).canResize).toBe(
    true,
  );
  expect(paneControlState(snapshot, "p1", "alice", true, 200)).toMatchObject({
    ownsLayout: true,
    canResize: false,
    viewOnly: true,
  });
  expect(paneControlState(snapshot, "p1", "bob", false, 501)).toMatchObject({
    ownerName: null,
    canResize: true,
  });
});
test("one live gate blocks keys, IME, paste/composer and resizing while preserving history", async () => {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const base: ConnectionClient = {
    connectionId: "local",
    generation: 1,
    serverRuntimeGeneration: 1,
    isCurrent: () => true,
    acceptsServerGeneration: () => true,
    call: async (method, params) => {
      calls.push([method, params]);
      return { ok: true };
    },
  };
  let access: PaneControlState = {
    viewOnly: true,
    ownsLayout: false,
    canResize: false,
    ownerName: "Alice",
    protectedUntil: 0,
  };
  const client = paneControlClient(base, () => access);
  for (const method of [
    "terminal.input",
    "pane.send_input",
    "pane.send_key",
    "pane.paste",
  ])
    await expect(client.call(method, { data: "eA==" })).rejects.toThrow(
      "view only",
    );
  await client.call("terminal.focus");
  await client.call("terminal.resize", { cols: 160, rows: 50 });
  await client.call("terminal.relay_resize", { cols: 160, rows: 50 });
  expect(calls).toEqual([]);
  await client.call("terminal.scroll", { direction: "up", source: "wheel" });
  expect(calls[calls.length - 1]).toEqual([
    "terminal.scroll",
    { direction: "up", source: "history" },
  ]);
  await client.call("terminal.attach", {
    terminal_id: "t1",
    cols: 80,
    rows: 24,
  });
  expect(calls[calls.length - 1]?.[1]?.preserve_size).toBe(true);
  access = { ...access, viewOnly: false, canResize: true, ownsLayout: true };
  await client.call("terminal.input", { data: "eA==" });
  expect(calls[calls.length - 1]?.[0]).toBe("terminal.input");
  access = { ...access, viewOnly: true, canResize: false };
  await expect(
    client.call("pane.send_input", { text: "late paste" }),
  ).rejects.toThrow("view only");
});

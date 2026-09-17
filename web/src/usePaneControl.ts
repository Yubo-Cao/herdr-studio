import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionClient } from "./api";
import {
  collaborationProfile,
  publishCollaborationSnapshot,
  subscribeCollaborationSnapshot,
  updateCollaborationPresence,
  type CollaborationSnapshot,
} from "./collaboration";
import { paneControlClient, paneControlState } from "./paneControl";
import { store } from "./store";

export function usePaneControl(
  client: ConnectionClient,
  paneId: string | undefined,
) {
  const [snapshot, setSnapshot] = useState<CollaborationSnapshot | null>(null);
  const [viewingScope, setViewingScope] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  const scope = `${client.connectionId}:${client.generation}:${client.serverRuntimeGeneration}:${paneId}`;
  useEffect(() => {
    setBusy(false);
    setError("");
  }, [scope]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const participantId = collaborationProfile().participantId;
  useEffect(
    () => subscribeCollaborationSnapshot(client, setSnapshot),
    [client],
  );
  useEffect(() => {
    const claim = snapshot?.pane_claims.find((item) => item.pane_id === paneId);
    if (!claim) return;
    const deadline = Math.min(
      ...[claim.expires_at_unix_ms, claim.protected_until_unix_ms].filter(
        (value): value is number =>
          typeof value === "number" && value > Date.now(),
      ),
    );
    if (!Number.isFinite(deadline)) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      deadline - Date.now() + 20,
    );
    return () => clearTimeout(timer);
  }, [snapshot, paneId, now]);
  const access = paneControlState(
    snapshot,
    paneId,
    participantId,
    viewingScope === scope,
    Date.now(),
  );
  const accessRef = useRef(access);
  accessRef.current = access;
  const guardedClient = useMemo(
    () => paneControlClient(client, () => accessRef.current),
    [client],
  );
  const assertInputAllowed = useCallback(() => {
    if (accessRef.current.viewOnly)
      throw new Error("This pane is view only. Take control to send input.");
  }, []);
  const change = useCallback(
    async (viewOnly: boolean) => {
      if (!paneId || busy || !client.isCurrent()) return;
      const expectedScope = scope;
      setBusy(true);
      setError("");
      // Disable local input immediately, before awaiting release.
      if (viewOnly) {
        accessRef.current = {
          ...accessRef.current,
          viewOnly: true,
          canResize: false,
        };
        setViewingScope(scope);
      }
      try {
        await updateCollaborationPresence(client, store.get());
        if (currentScope.current !== expectedScope || !client.isCurrent())
          return;
        const result = await client.call(
          viewOnly ? "collaboration.release" : "collaboration.claim",
          {
            pane_id: paneId,
            participant_id: participantId,
            ...(viewOnly ? {} : { takeover: true, protect_ms: 15_000 }),
          },
        );
        if (currentScope.current !== expectedScope || !client.isCurrent())
          return;
        if (!viewOnly && result?.granted !== true)
          throw new Error(
            "Layout control is temporarily held by another collaborator. Try again when its protection ends.",
          );
        if (!viewOnly) setViewingScope(null);
        const latest = await client.call("collaboration.list");
        if (
          currentScope.current === expectedScope &&
          client.isCurrent() &&
          latest?.snapshot
        )
          publishCollaborationSnapshot(client, latest.snapshot);
      } catch (failure) {
        if (currentScope.current === expectedScope)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      } finally {
        if (currentScope.current === expectedScope) setBusy(false);
      }
    },
    [client, paneId, participantId, scope, busy],
  );
  return {
    access,
    client: guardedClient,
    assertInputAllowed,
    busy,
    error,
    takeControl: () => change(false),
    watch: () => change(true),
  };
}

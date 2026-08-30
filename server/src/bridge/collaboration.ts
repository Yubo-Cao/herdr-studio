type Participant = {
  participant_id: string;
  display_name: string;
  color: string;
  role: "owner" | "editor" | "viewer";
  activity: "active" | "idle" | "away";
  surface: string;
  workspace_id?: string;
  tab_id?: string;
  pane_id?: string;
  typing: boolean;
  typing_expires_at_unix_ms?: number;
  updated_at_unix_ms: number;
  expires_at_unix_ms: number;
};

type Claim = {
  pane_id: string;
  participant_id: string;
  acquired_at_unix_ms: number;
  updated_at_unix_ms: number;
  expires_at_unix_ms: number;
  protected_until_unix_ms?: number;
};

const LEASE_TTL_MS = 45_000;
const TYPING_TTL_MS = 3_000;
const MAX_CONTROL_PROTECTION_MS = 60_000;

export function createCollaborationService(args: {
  herdrCall: (method: string, params?: Record<string, unknown>) => Promise<any>;
  onSnapshot?: (snapshot: {
    participants: Participant[];
    pane_claims: Claim[];
    lease_ttl_ms: number;
  }) => void;
  now?: () => number;
}) {
  const participants = new Map<string, Participant>();
  const claims = new Map<string, Claim>();
  let useFallback = false;

  const prune = () => {
    const now = args.now?.() ?? Date.now();
    for (const [id, participant] of participants) {
      if (participant.expires_at_unix_ms <= now) participants.delete(id);
      else if (
        participant.typing_expires_at_unix_ms !== undefined &&
        participant.typing_expires_at_unix_ms <= now
      ) {
        participant.typing = false;
        delete participant.typing_expires_at_unix_ms;
      }
    }
    for (const [paneId, claim] of claims) {
      if (
        claim.expires_at_unix_ms <= now ||
        !participants.has(claim.participant_id)
      ) {
        claims.delete(paneId);
      }
    }
  };
  const snapshot = () => {
    prune();
    return {
      type: "collaboration_snapshot",
      snapshot: {
        participants: Array.from(participants.values()).sort((a, b) =>
          a.participant_id.localeCompare(b.participant_id),
        ),
        pane_claims: Array.from(claims.values()).sort((a, b) =>
          a.pane_id.localeCompare(b.pane_id),
        ),
        lease_ttl_ms: LEASE_TTL_MS,
      },
      fallback: true,
    };
  };

  const fallbackCall = (
    method: string,
    params: Record<string, unknown> = {},
  ) => {
    const now = args.now?.() ?? Date.now();
    prune();
    if (method === "collaboration.update") {
      const participantId = String(params.participant_id ?? "");
      if (!participantId) throw new Error("participant_id required");
      const participant: Participant = {
        participant_id: participantId,
        display_name: String(params.display_name ?? "Collaborator").slice(
          0,
          80,
        ),
        color: String(params.color ?? "#0969da"),
        role:
          params.role === "viewer" || params.role === "owner"
            ? params.role
            : "editor",
        activity:
          params.activity === "idle" || params.activity === "away"
            ? params.activity
            : "active",
        surface: String(params.surface ?? "web").slice(0, 32),
        ...(typeof params.workspace_id === "string"
          ? { workspace_id: params.workspace_id }
          : {}),
        ...(typeof params.tab_id === "string" ? { tab_id: params.tab_id } : {}),
        ...(typeof params.pane_id === "string"
          ? { pane_id: params.pane_id }
          : {}),
        typing: params.typing === true,
        ...(params.typing === true
          ? { typing_expires_at_unix_ms: now + TYPING_TTL_MS }
          : {}),
        updated_at_unix_ms: now,
        expires_at_unix_ms: now + LEASE_TTL_MS,
      };
      participants.set(participantId, participant);
      for (const claim of claims.values()) {
        if (claim.participant_id === participantId) {
          claim.updated_at_unix_ms = now;
          claim.expires_at_unix_ms = now + LEASE_TTL_MS;
        }
      }
      const result = snapshot();
      args.onSnapshot?.(result.snapshot);
      return result;
    }
    if (method === "collaboration.list") return snapshot();
    if (method === "collaboration.leave") {
      const participantId = String(params.participant_id ?? "");
      const released = participants.delete(participantId);
      for (const [paneId, claim] of claims) {
        if (claim.participant_id === participantId) claims.delete(paneId);
      }
      if (released) args.onSnapshot?.(snapshot().snapshot);
      return { type: "collaboration_released", released };
    }
    if (method === "collaboration.claim") {
      const participantId = String(params.participant_id ?? "");
      const paneId = String(params.pane_id ?? "");
      if (!participantId) throw new Error("participant_id required");
      if (!paneId) throw new Error("pane_id required");
      const participant = participants.get(participantId);
      if (!participant) throw new Error("participant_not_registered");
      if (participant.role === "viewer") throw new Error("permission_denied");
      const existing = claims.get(paneId);
      const protectedByCurrentOwner =
        existing?.participant_id !== participantId &&
        existing?.protected_until_unix_ms !== undefined &&
        existing.protected_until_unix_ms > now;
      if (
        existing &&
        existing.participant_id !== participantId &&
        (protectedByCurrentOwner || params.takeover !== true)
      ) {
        return { type: "collaboration_claim", granted: false, claim: existing };
      }
      const requestedProtection = Math.min(
        MAX_CONTROL_PROTECTION_MS,
        Math.max(0, Math.trunc(Number(params.protect_ms ?? 0) || 0)),
      );
      const previousProtection =
        existing?.participant_id === participantId &&
        existing.protected_until_unix_ms !== undefined &&
        existing.protected_until_unix_ms > now
          ? existing.protected_until_unix_ms
          : 0;
      const claim: Claim = {
        pane_id: paneId,
        participant_id: participantId,
        acquired_at_unix_ms:
          existing?.participant_id === participantId
            ? existing.acquired_at_unix_ms
            : now,
        updated_at_unix_ms: now,
        expires_at_unix_ms: now + LEASE_TTL_MS,
        ...(requestedProtection > 0 || previousProtection > 0
          ? {
              protected_until_unix_ms: Math.max(
                previousProtection,
                now + requestedProtection,
              ),
            }
          : {}),
      };
      claims.set(paneId, claim);
      args.onSnapshot?.(snapshot().snapshot);
      return { type: "collaboration_claim", granted: true, claim };
    }
    if (method === "collaboration.release") {
      const participantId = String(params.participant_id ?? "");
      const paneId = String(params.pane_id ?? "");
      if (!participantId) throw new Error("participant_id required");
      if (!paneId) throw new Error("pane_id required");
      const released = claims.get(paneId)?.participant_id === participantId;
      if (released) claims.delete(paneId);
      if (released) args.onSnapshot?.(snapshot().snapshot);
      return { type: "collaboration_released", released };
    }
    throw new Error(`unknown collaboration method: ${method}`);
  };

  async function call(method: string, params: Record<string, unknown> = {}) {
    if (useFallback) return fallbackCall(method, params);
    try {
      return await args.herdrCall(method, params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const normalized = message.toLowerCase();
      // Older Herdr versions deserialize the tagged request before retaining
      // its id, so an unknown method is returned with id="". HerdrClient
      // correctly rejects that mismatched envelope; for collaboration methods
      // only, it is also the compatibility signal to use the bridge lease map.
      if (
        !normalized.includes("unknown") &&
        normalized !== "invalid response envelope from herdr"
      ) {
        throw error;
      }
      useFallback = true;
      console.warn(
        "[bridge] Herdr collaboration API unavailable; using bridge-local compatibility mode",
      );
      return fallbackCall(method, params);
    }
  }

  return { call };
}

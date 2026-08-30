import type { ConnectionClient, HerdrEventMsg } from "./api";
import type { State } from "./store";

export type CollaborationParticipant = {
  participant_id: string;
  display_name: string;
  color: string;
  role: "owner" | "editor" | "viewer";
  activity: "active" | "idle" | "away";
  surface: string;
  workspace_id?: string;
  tab_id?: string;
  pane_id?: string;
  typing?: boolean;
  typing_expires_at_unix_ms?: number;
  updated_at_unix_ms: number;
  expires_at_unix_ms: number;
};

export type CollaborationPaneClaim = {
  pane_id: string;
  participant_id: string;
  acquired_at_unix_ms: number;
  updated_at_unix_ms: number;
  expires_at_unix_ms: number;
  protected_until_unix_ms?: number;
};

export type CollaborationSnapshot = {
  participants: CollaborationParticipant[];
  pane_claims: CollaborationPaneClaim[];
  lease_ttl_ms: number;
};

export type CollaborationProfile = {
  participantId: string;
  displayName: string;
  color: string;
};

const PROFILE_KEY = "herdrCollaborationProfile";
const COLORS = [
  "#0969da",
  "#1a7f37",
  "#8250df",
  "#bf8700",
  "#cf222e",
  "#0a7c86",
];
let cachedProfile: CollaborationProfile | null = null;
let clientSessionId: string | null = null;
const snapshots = new Map<string, CollaborationSnapshot>();
const snapshotListeners = new Set<
  (scope: string, snapshot: CollaborationSnapshot) => void
>();
const TYPING_IDLE_MS = 1_600;
const TYPING_REFRESH_MS = 800;
let typingScope = "";
let typingDeadline = 0;
let typingLastSentAt = 0;
let typingTimer: ReturnType<typeof setTimeout> | null = null;

function randomId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

function defaultName() {
  const platform = navigator.platform?.trim();
  return platform ? `${platform} user` : "Studio user";
}

export function collaborationProfileForSession(
  participantId: string,
  stored: unknown,
  fallbackDisplayName: string,
): CollaborationProfile {
  if (
    stored &&
    typeof stored === "object" &&
    typeof (stored as { displayName?: unknown }).displayName === "string" &&
    /^#[0-9a-f]{6}$/i.test(String((stored as { color?: unknown }).color ?? ""))
  ) {
    return {
      participantId,
      displayName:
        (stored as { displayName: string }).displayName.trim().slice(0, 80) ||
        fallbackDisplayName,
      color: String((stored as { color: string }).color),
    };
  }
  return {
    participantId,
    displayName: fallbackDisplayName,
    color:
      COLORS[
        Array.from(participantId).reduce(
          (sum, character) => sum + character.charCodeAt(0),
          0,
        ) % COLORS.length
      ],
  };
}

export function collaborationProfile(): CollaborationProfile {
  if (cachedProfile) return cachedProfile;
  clientSessionId ??= `web-${randomId()}`;
  let stored: unknown = null;
  try {
    stored = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "null");
  } catch {
    // A restricted storage context still gets an in-memory identity.
  }
  // The display profile is shared by tabs, while participant_id deliberately
  // identifies this page lifetime. Persisting participant_id in localStorage
  // made every tab/window impersonate the same collaborator and bypass pane
  // ownership checks intended for independent client sessions.
  cachedProfile = collaborationProfileForSession(
    clientSessionId,
    stored,
    defaultName(),
  );
  saveCollaborationProfile(cachedProfile);
  return cachedProfile;
}

export function saveCollaborationProfile(profile: CollaborationProfile) {
  cachedProfile = {
    ...profile,
    displayName: profile.displayName.trim().slice(0, 80) || "Studio user",
  };
  try {
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({
        displayName: cachedProfile.displayName,
        color: cachedProfile.color,
      }),
    );
  } catch {
    // Keep the identity in memory when storage is unavailable.
  }
}

function parseSnapshot(result: unknown): CollaborationSnapshot | null {
  if (!result || typeof result !== "object") return null;
  const snapshot = (result as { snapshot?: unknown }).snapshot;
  if (!snapshot || typeof snapshot !== "object") return null;
  const value = snapshot as Partial<CollaborationSnapshot>;
  if (!Array.isArray(value.participants) || !Array.isArray(value.pane_claims)) {
    return null;
  }
  return {
    participants: value.participants,
    pane_claims: value.pane_claims,
    lease_ttl_ms: Number(value.lease_ttl_ms ?? 45_000),
  };
}

function collaborationScope(client: ConnectionClient): string {
  return `${client.connectionId}:${client.generation}:${client.serverRuntimeGeneration ?? "legacy"}`;
}

export function publishCollaborationSnapshot(
  client: ConnectionClient,
  snapshot: CollaborationSnapshot,
) {
  const scope = collaborationScope(client);
  snapshots.set(scope, snapshot);
  snapshotListeners.forEach((listener) => listener(scope, snapshot));
}

export function subscribeCollaborationSnapshot(
  client: ConnectionClient,
  listener: (snapshot: CollaborationSnapshot | null) => void,
) {
  const scope = collaborationScope(client);
  listener(snapshots.get(scope) ?? null);
  const scopedListener = (
    changedScope: string,
    snapshot: CollaborationSnapshot,
  ) => {
    if (changedScope === scope) listener(snapshot);
  };
  snapshotListeners.add(scopedListener);
  return () => {
    snapshotListeners.delete(scopedListener);
  };
}

export function acceptCollaborationEvent(
  client: ConnectionClient,
  event: HerdrEventMsg,
): boolean {
  if (
    (event.event !== "collaboration.updated" &&
      event.event !== "collaboration_updated") ||
    event.connection_id !== client.connectionId ||
    !client.isCurrent() ||
    !client.acceptsServerGeneration(event.connection_generation)
  ) {
    return false;
  }
  const parsed = parseSnapshot({ snapshot: event.data.snapshot });
  if (!parsed) return false;
  publishCollaborationSnapshot(client, parsed);
  return true;
}

export function participantIsTyping(
  participant: CollaborationParticipant,
  now = Date.now(),
): boolean {
  return (
    participant.typing === true &&
    (participant.typing_expires_at_unix_ms === undefined ||
      participant.typing_expires_at_unix_ms > now)
  );
}

export function shouldTakeOverPaneFromMouse(event: {
  button: number;
  shiftKey: boolean;
}): boolean {
  return event.button === 0 && event.shiftKey;
}

export function collaborationPresenceParams(
  snapshot: Pick<
    State,
    "workspaces" | "tabs" | "panes" | "selectedPaneId" | "layout"
  >,
  typing = false,
) {
  const profile = collaborationProfile();
  const workspace = snapshot.workspaces.find((entry) => entry.focused);
  const tab = snapshot.tabs.find(
    (entry) =>
      entry.tab_id === (workspace?.active_tab_id ?? snapshot.layout?.tab_id),
  );
  const paneId =
    snapshot.selectedPaneId ??
    snapshot.layout?.focused_pane_id ??
    snapshot.panes.find((entry) => entry.focused)?.pane_id;
  return {
    participant_id: profile.participantId,
    display_name: profile.displayName,
    color: profile.color,
    role: "editor",
    activity: document.visibilityState === "hidden" ? "away" : "active",
    surface: "web",
    typing,
    ...(workspace ? { workspace_id: workspace.workspace_id } : {}),
    ...(tab ? { tab_id: tab.tab_id } : {}),
    ...(paneId ? { pane_id: paneId } : {}),
  };
}

export async function updateCollaborationPresence(
  client: ConnectionClient,
  snapshot: Pick<
    State,
    "workspaces" | "tabs" | "panes" | "selectedPaneId" | "layout"
  >,
  options: { typing?: boolean } = {},
): Promise<CollaborationSnapshot> {
  const scope = collaborationScope(client);
  const typing =
    options.typing ?? (typingScope === scope && typingDeadline > Date.now());
  const result = await client.call(
    "collaboration.update",
    collaborationPresenceParams(snapshot, typing),
  );
  const parsed = parseSnapshot(result);
  if (!parsed) throw new Error("invalid collaboration snapshot");
  publishCollaborationSnapshot(client, parsed);
  return parsed;
}

export function markCollaborationTyping(
  client: ConnectionClient,
  readState: () => Pick<
    State,
    "workspaces" | "tabs" | "panes" | "selectedPaneId" | "layout"
  >,
) {
  if (!client.isCurrent()) return;
  const scope = collaborationScope(client);
  const now = Date.now();
  if (typingScope !== scope) {
    typingScope = scope;
    typingLastSentAt = 0;
  }
  typingDeadline = now + TYPING_IDLE_MS;
  if (now - typingLastSentAt >= TYPING_REFRESH_MS) {
    typingLastSentAt = now;
    void updateCollaborationPresence(client, readState(), {
      typing: true,
    }).catch(() => null);
  }
  if (typingTimer) clearTimeout(typingTimer);
  const expectedDeadline = typingDeadline;
  typingTimer = setTimeout(() => {
    if (typingScope !== scope || typingDeadline !== expectedDeadline) return;
    typingTimer = null;
    typingDeadline = 0;
    typingLastSentAt = 0;
    if (!client.isCurrent()) return;
    void updateCollaborationPresence(client, readState(), {
      typing: false,
    }).catch(() => null);
  }, TYPING_IDLE_MS);
}

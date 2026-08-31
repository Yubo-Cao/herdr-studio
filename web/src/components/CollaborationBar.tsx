import { Check, Pencil, Users, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  acceptCollaborationEvent,
  type CollaborationParticipant,
  type CollaborationSnapshot,
  collaborationProfile,
  participantIsTyping,
  saveCollaborationProfile,
  subscribeCollaborationSnapshot,
  updateCollaborationPresence,
} from "../collaboration";
import { bridge } from "../api";
import { shallowEqual, store, useStoreSelector } from "../store";
import { useConnectionClient } from "../useConnectionClient";

const HEARTBEAT_MS = 12_000;

export function CollaborationBar() {
  const session = useStoreSelector(
    (state) => ({
      status: state.status,
      workspaces: state.workspaces,
      tabs: state.tabs,
      panes: state.panes,
      selectedPaneId: state.selectedPaneId,
      layout: state.layout,
    }),
    shallowEqual,
  );
  const client = useConnectionClient();
  const [snapshot, setSnapshot] = useState<CollaborationSnapshot | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(() => collaborationProfile().displayName);
  const profile = collaborationProfile();
  const latestSession = useRef(session);
  latestSession.current = session;

  useEffect(
    () => subscribeCollaborationSnapshot(client, setSnapshot),
    [client],
  );

  useEffect(
    () =>
      bridge.onEvent((event) => void acceptCollaborationEvent(client, event)),
    [client],
  );

  useEffect(() => {
    if (session.status !== "connected" || !client.isCurrent()) return;
    let disposed = false;
    const refresh = () => {
      void updateCollaborationPresence(client, latestSession.current)
        .then((next) => {
          if (!disposed && client.isCurrent()) setSnapshot(next);
        })
        .catch(() => {
          // The compatibility bridge will normally absorb old-core errors.
        });
    };
    refresh();
    const timer = window.setInterval(refresh, HEARTBEAT_MS);
    const onVisibility = () => refresh();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    client,
    session.layout?.focused_pane_id,
    session.layout?.tab_id,
    session.selectedPaneId,
    session.status,
  ]);

  const participants: CollaborationParticipant[] = snapshot?.participants ?? [];
  const visibleParticipants: CollaborationParticipant[] = participants.length
    ? participants
    : [
        {
          participant_id: profile.participantId,
          display_name: profile.displayName,
          color: profile.color,
          role: "editor",
          activity: "active",
          surface: "web",
          updated_at_unix_ms: Date.now(),
          expires_at_unix_ms: Date.now() + HEARTBEAT_MS,
          typing: false,
        },
      ];
  const submitName = (event: FormEvent) => {
    event.preventDefault();
    saveCollaborationProfile({ ...profile, displayName: name });
    setName(collaborationProfile().displayName);
    setEditing(false);
    void updateCollaborationPresence(client, latestSession.current).then(
      setSnapshot,
      () => {},
    );
  };

  return (
    <div className="collaboration-bar">
      <div className="collaboration-roster" aria-label="Live collaborators">
        <Users size={14} aria-hidden="true" />
        <span className="collaboration-count">{participants.length || 1}</span>
        <div className="collaboration-avatars">
          {visibleParticipants.slice(0, 5).map((participant) => {
            const isSelf = participant.participant_id === profile.participantId;
            const isTyping = participantIsTyping(participant);
            return (
              <button
                type="button"
                className={`collaboration-avatar activity-${participant.activity} ${isSelf ? "is-self" : ""} ${isTyping ? "is-typing" : ""}`}
                style={
                  { "--participant-color": participant.color } as CSSProperties
                }
                title={`${participant.display_name}${isTyping ? " · typing" : participant.pane_id ? " · viewing a pane" : ""}`}
                aria-label={`${participant.display_name}${isSelf ? " (you)" : ""}`}
                onClick={() => {
                  if (isSelf) setEditing((value) => !value);
                  else if (participant.pane_id)
                    void store.focusPane(participant.pane_id);
                }}
              >
                {participant.display_name.slice(0, 1).toUpperCase()}
              </button>
            );
          })}
        </div>
        <span className="collaboration-live">Live</span>
      </div>
      {editing ? (
        <form className="collaboration-editor" onSubmit={submitName}>
          <Pencil size={13} />
          <input
            autoFocus
            value={name}
            maxLength={80}
            aria-label="Your collaboration display name"
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" aria-label="Save display name">
            <Check size={14} />
          </button>
          <button
            type="button"
            aria-label="Cancel"
            onClick={() => setEditing(false)}
          >
            <X size={14} />
          </button>
        </form>
      ) : null}
    </div>
  );
}

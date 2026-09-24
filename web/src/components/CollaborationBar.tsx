import "./CollaborationBar.css";
import * as Popover from "@radix-ui/react-popover";
import { Check, Pencil, Users, X } from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { bridge } from "../api";
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
import { shallowEqual, store, useStoreSelector } from "../store";
import { useConnectionClient } from "../useConnectionClient";
import { Avatar, AvatarFallback } from "./ui/Avatar";
import { Button } from "./ui/Button";

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
    <Popover.Root open={editing} onOpenChange={setEditing}>
      <div className="collaboration-bar">
        <div className="collaboration-roster" aria-label="Live collaborators">
          <Users size={14} aria-hidden="true" />
          <span className="collaboration-count">
            {participants.length || 1}
          </span>
          <div className="collaboration-avatars">
            {[...visibleParticipants]
              .sort(
                (a, b) =>
                  Number(b.participant_id === profile.participantId) -
                  Number(a.participant_id === profile.participantId),
              )
              .slice(0, 3)
              .map((participant) => {
                const isSelf =
                  participant.participant_id === profile.participantId;
                const isTyping = participantIsTyping(participant);
                const avatarButton = (
                  <button
                    type="button"
                    className={`collaboration-avatar activity-${participant.activity} ${isSelf ? "is-self" : ""} ${isTyping ? "is-typing" : ""}`}
                    style={
                      {
                        "--participant-color": participant.color,
                      } as CSSProperties
                    }
                    title={`${participant.display_name}${isTyping ? " · typing" : participant.pane_id ? " · viewing a pane" : ""}`}
                    aria-label={`${participant.display_name}${isSelf ? " (you)" : ""}`}
                    onClick={() => {
                      if (!isSelf && participant.pane_id)
                        void store.focusPane(participant.pane_id);
                    }}
                  >
                    <Avatar>
                      <AvatarFallback>
                        {participant.display_name
                          .split(/\s+/)
                          .filter(Boolean)
                          .map((part) => Array.from(part)[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                );
                return isSelf ? (
                  <Popover.Trigger asChild key={participant.participant_id}>
                    {avatarButton}
                  </Popover.Trigger>
                ) : (
                  <span
                    className="collaboration-peer"
                    key={participant.participant_id}
                  >
                    {avatarButton}
                  </span>
                );
              })}
            {visibleParticipants.length > 3 ? (
              <span
                className="collaboration-overflow"
                title={`${visibleParticipants.length} collaborators`}
              >
                +{visibleParticipants.length - 3}
              </span>
            ) : null}
          </div>
          <span className="collaboration-live">Live</span>
        </div>
        <Popover.Portal>
          <Popover.Content
            className="collaboration-popover"
            sideOffset={8}
            align="start"
            collisionPadding={8}
          >
            <form className="collaboration-editor" onSubmit={submitName}>
              <Pencil size={13} />
              <input
                autoFocus
                value={name}
                maxLength={80}
                aria-label="Your collaboration display name"
                onChange={(event) => setName(event.target.value)}
              />
              <Button type="submit" icon aria-label="Save display name">
                <Check size={14} />
              </Button>
              <Button
                icon
                aria-label="Cancel"
                onClick={() => setEditing(false)}
              >
                <X size={14} />
              </Button>
            </form>
          </Popover.Content>
        </Popover.Portal>
      </div>
    </Popover.Root>
  );
}

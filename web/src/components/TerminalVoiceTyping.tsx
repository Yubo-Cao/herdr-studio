import {
  CornerDownLeft,
  CornerDownRight,
  LoaderCircle,
  Mic,
  MicOff,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  shortcutLabel,
  shortcutMatches,
  shortcutTitle,
  useShortcutPreferences,
} from "../shortcutPreferences";
import { useVoiceDictation } from "../voice/useVoiceDictation";
import { voiceCleanupMode } from "../voice/voicePreferences";
import "./TerminalVoiceTyping.css";
import { Button } from "./ui/Button";

export type TerminalVoiceTyping = ReturnType<typeof useTerminalVoiceTyping>;

/** A press held at least this long is push-to-talk; shorter is a toggle. */
const PUSH_TO_TALK_HOLD_MS = 350;

/**
 * Voice typing straight into a terminal pane, without opening the composer.
 * Aoide's "speak, then commit" flow: recognized segments collect in a preview,
 * and stopping re-recognizes the whole dictation in one request, tidies it
 * once with the bridge's cleanup model, and types it into the pane. Insert
 * leaves it at the prompt; Send also presses Enter.
 *
 * With `keyboard`, the `voice.pushToTalk` shortcut drives it: hold to talk
 * and release to insert, or tap to start and tap again to insert. While
 * dictating, Enter sends and Escape discards.
 */
export function useTerminalVoiceTyping({
  onInsert,
  onError,
  keyboard,
}: {
  onInsert: (text: string, submit: boolean) => Promise<void>;
  onError: (message: string) => void;
  keyboard: boolean;
}) {
  const [transcript, setTranscript] = useState("");
  const [inserting, setInserting] = useState(false);
  const transcriptRef = useRef("");
  const submitRef = useRef(false);
  const abortedRef = useRef(false);
  const onInsertRef = useRef(onInsert);
  onInsertRef.current = onInsert;

  const setText = (text: string) => {
    transcriptRef.current = text;
    setTranscript(text);
  };

  const {
    state,
    active,
    stop,
    cancel: cancelDictation,
    toggle: toggleDictation,
  } = useVoiceDictation({
    onStart: () => {
      abortedRef.current = false;
      submitRef.current = false;
      setText("");
    },
    onText: (spoken, join) => {
      const insertion = join(transcriptRef.current, spoken);
      if (insertion) setText(transcriptRef.current + insertion);
    },
    onFinish: async (tidy, final) => {
      if (final && !abortedRef.current) setText(final);
      let text = transcriptRef.current.trim();
      const mode = voiceCleanupMode();
      if (text && tidy && mode !== "off" && !abortedRef.current) {
        try {
          text = (await tidy(text, mode)).trim();
        } catch (error) {
          onError(
            `Cleanup failed; typing the raw dictation. ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      if (abortedRef.current) return;
      setText("");
      if (!text) return;
      setInserting(true);
      try {
        await onInsertRef.current(text, submitRef.current);
      } finally {
        setInserting(false);
      }
    },
    onError,
  });

  const finish = useCallback(
    (submit: boolean) => {
      submitRef.current = submit;
      void stop();
    },
    [stop],
  );

  const cancel = useCallback(() => {
    abortedRef.current = true;
    cancelDictation();
    setText("");
  }, [cancelDictation]);

  const toggle = useCallback(() => {
    if (state.phase === "starting") cancel();
    else if (active) finish(false);
    else void toggleDictation();
  }, [active, cancel, finish, state.phase, toggleDictation]);

  const recording =
    active && state.phase !== "stopping" && state.phase !== "tidying";
  const latestRef = useRef({
    active,
    recording,
    toggleDictation,
    finish,
    cancel,
  });
  latestRef.current = { active, recording, toggleDictation, finish, cancel };
  const listening = keyboard || active;

  useEffect(() => {
    if (!listening) return;
    let held: {
      code: string;
      modifiers: string[];
      at: number;
      finished: boolean;
    } | null = null;
    const blocked = () =>
      document.querySelector(
        ".modal-backdrop, .command-popover, .context-menu",
      );
    const release = () => {
      const press = held;
      held = null;
      // A tap leaves dictation running until the next press.
      if (
        press &&
        !press.finished &&
        performance.now() - press.at >= PUSH_TO_TALK_HOLD_MS
      )
        latestRef.current.finish(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const voice = latestRef.current;
      if (shortcutMatches(event, "voice.pushToTalk")) {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat || held || blocked()) return;
        held = {
          code: event.code,
          modifiers: (["Control", "Alt", "Meta", "Shift"] as const).filter(
            (key) => event.getModifierState(key),
          ),
          at: performance.now(),
          finished: voice.recording,
        };
        // Starting here keeps the key press as the audio-unlocking gesture.
        if (!voice.active) voice.toggleDictation();
        else if (voice.recording) voice.finish(false);
        return;
      }
      if (!voice.recording) return;
      const plain =
        !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
      if (event.key === "Escape" && plain) {
        event.preventDefault();
        event.stopPropagation();
        voice.cancel();
      } else if (event.key === "Enter" && plain) {
        event.preventDefault();
        event.stopPropagation();
        voice.finish(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!held) return;
      if (event.code === held.code || held.modifiers.includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        release();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
      window.removeEventListener("blur", release);
    };
  }, [listening]);

  return {
    state,
    active: active || inserting,
    recording,
    inserting,
    transcript,
    toggle,
    finish,
    cancel,
  };
}

const keepTerminalFocus = (event: PointerEvent<HTMLButtonElement>) =>
  event.preventDefault();

function statusLabel(voice: TerminalVoiceTyping) {
  const { phase, pending } = voice.state;
  if (voice.inserting) return "Typing into the terminal…";
  if (phase === "starting") return "Starting microphone…";
  if (phase === "tidying") return "Tidying…";
  if (phase === "stopping" || pending > 0) return "Transcribing…";
  if (phase === "speaking") return "Listening: speech";
  return "Listening…";
}

/** Always-available microphone toggle for one terminal pane. */
export function TerminalVoiceButton({
  voice,
  className = "",
  iconSize = 15,
  disabledReason,
}: {
  voice: TerminalVoiceTyping;
  className?: string;
  iconSize?: number;
  disabledReason?: string | null;
}) {
  useShortcutPreferences();
  const busy = voice.active && !voice.recording;
  const label = voice.recording
    ? "Stop voice typing and type into the terminal"
    : "Voice typing";
  const title = voice.recording
    ? label
    : shortcutTitle(
        "Voice typing: hold to talk, tap to toggle",
        "voice.pushToTalk",
      );
  return (
    <Button
      icon
      className={`terminal-voice-button ${className} ${
        voice.recording ? "is-active" : ""
      } ${voice.state.phase === "speaking" ? "is-speaking" : ""}`}
      style={{ "--voice-level": voice.state.level } as CSSProperties}
      title={disabledReason && !voice.active ? disabledReason : title}
      aria-label={label}
      aria-pressed={voice.recording}
      disabled={busy || (!!disabledReason && !voice.active)}
      onPointerDown={keepTerminalFocus}
      onClick={voice.toggle}
    >
      {busy ? (
        <LoaderCircle size={iconSize} className="terminal-voice-spin" />
      ) : voice.recording ? (
        <MicOff size={iconSize} />
      ) : (
        <Mic size={iconSize} />
      )}
    </Button>
  );
}

/** Live transcript and commit controls, shown only while dictating. */
export function TerminalVoicePanel({ voice }: { voice: TerminalVoiceTyping }) {
  useShortcutPreferences();
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = transcriptRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [voice.transcript]);
  if (!voice.active) return null;
  const committing = !voice.recording;
  return (
    <div
      className="terminal-voice-panel"
      role="region"
      aria-label="Voice typing"
    >
      <div className="terminal-voice-panel-head">
        <span
          className={`terminal-voice-meter ${
            voice.state.phase === "speaking" ? "is-speaking" : ""
          }`}
          style={{ "--voice-level": voice.state.level } as CSSProperties}
          aria-hidden="true"
        />
        <span className="terminal-voice-status" aria-live="polite">
          {statusLabel(voice)}
        </span>
        <button
          type="button"
          className="terminal-voice-cancel"
          title="Discard this dictation"
          aria-label="Discard this dictation"
          disabled={voice.inserting}
          onPointerDown={keepTerminalFocus}
          onClick={voice.cancel}
        >
          <X size={15} />
        </button>
      </div>
      <div
        ref={transcriptRef}
        className={`terminal-voice-transcript ${
          voice.transcript ? "" : "is-empty"
        }`}
      >
        {voice.transcript ||
          "Speak, then tap Insert or Send. Recognized text appears here."}
      </div>
      <div className="terminal-voice-actions">
        <span className="terminal-voice-keys">
          {`${shortcutLabel("voice.pushToTalk")} inserts · Enter sends · Esc discards`}
        </span>
        <button
          type="button"
          title="Type into the terminal without pressing Enter"
          disabled={committing}
          onPointerDown={keepTerminalFocus}
          onClick={() => voice.finish(false)}
        >
          <CornerDownRight size={14} />
          Insert
        </button>
        <button
          type="button"
          className="is-primary"
          title="Type into the terminal and press Enter"
          disabled={committing}
          onPointerDown={keepTerminalFocus}
          onClick={() => voice.finish(true)}
        >
          <CornerDownLeft size={14} />
          Send
        </button>
      </div>
    </div>
  );
}

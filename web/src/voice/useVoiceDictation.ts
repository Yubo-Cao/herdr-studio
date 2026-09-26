import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DictationPhase,
  DictationSession,
  tidyDictation,
} from "./voiceDictation";

export type VoiceDictationState = {
  phase: DictationPhase | "off" | "stopping" | "tidying";
  pending: number;
  level: number;
};

/**
 * Create and unlock a capture context. Must run synchronously inside the tap
 * handler: iOS Safari starts audio only during a user gesture, and the lazy
 * module import below would end it.
 */
function unlockAudio(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  try {
    const context = new AudioContext({ latencyHint: "interactive" });
    void context.resume().catch(() => undefined);
    return context;
  } catch {
    return null;
  }
}

/**
 * Dictation state for one input surface. The capture, VAD, and transport code
 * load on first use so the microphone path adds nothing to the initial bundle.
 */
export function useVoiceDictation({
  onStart,
  onText,
  onFinish,
  onError,
}: {
  onStart?: () => void;
  onText: (
    text: string,
    join: (before: string, text: string) => string,
  ) => void;
  /**
   * After a clean stop. `tidy` is null when the bridge has no cleanup model;
   * `final` is the whole dictation re-recognized in one request, or null when
   * the segment transcripts already stand (one segment, or the pass failed).
   */
  onFinish?: (
    tidy: typeof tidyDictation | null,
    final: string | null,
  ) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<VoiceDictationState>({
    phase: "off",
    pending: 0,
    level: 0,
  });
  const sessionRef = useRef<DictationSession | null>(null);
  const startingRef = useRef(false);
  const cancelledRef = useRef(false);
  const stopWhenReadyRef = useRef(false);
  const onStartRef = useRef(onStart);
  const onTextRef = useRef(onText);
  const onFinishRef = useRef(onFinish);
  const onErrorRef = useRef(onError);
  onStartRef.current = onStart;
  onTextRef.current = onText;
  onFinishRef.current = onFinish;
  onErrorRef.current = onError;

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) {
      // Released while the microphone is still opening: stop once it is.
      if (startingRef.current) stopWhenReadyRef.current = true;
      return;
    }
    sessionRef.current = null;
    setState((current) => ({ ...current, phase: "stopping", level: 0 }));
    try {
      const final = await session.stop();
      const finish = onFinishRef.current;
      if (finish) {
        setState((current) => ({ ...current, phase: "tidying" }));
        const { tidyDictation } = await import("./voiceDictation");
        await finish(session.cleanup ? tidyDictation : null, final);
      }
    } catch (error) {
      onErrorRef.current(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setState((current) => ({ ...current, phase: "off", level: 0 }));
    }
  }, []);

  /** Release the microphone and drop untranscribed audio; no `onFinish`. */
  const cancel = useCallback(() => {
    cancelledRef.current = startingRef.current;
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.cancel();
    setState({ phase: "off", pending: 0, level: 0 });
  }, []);

  const start = useCallback(async () => {
    if (sessionRef.current || startingRef.current) return;
    startingRef.current = true;
    cancelledRef.current = false;
    stopWhenReadyRef.current = false;
    const unlocked = unlockAudio();
    setState({ phase: "starting", pending: 0, level: 0 });
    try {
      const voice = await import("./voiceDictation");
      const { dictationInsertion } = await import("./voiceSegmenter");
      onStartRef.current?.();
      const session = await voice.startDictation(
        {
          onPhase: (phase) =>
            setState((current) =>
              current.phase === "stopping" ? current : { ...current, phase },
            ),
          onPending: (pending) =>
            setState((current) => ({ ...current, pending })),
          onLevel: (level) => setState((current) => ({ ...current, level })),
          onText: (text) => onTextRef.current(text, dictationInsertion),
          onError: (message, fatal) => {
            onErrorRef.current(message);
            if (fatal) void stop();
          },
        },
        unlocked,
      );
      if (cancelledRef.current) {
        session.cancel();
        setState({ phase: "off", pending: 0, level: 0 });
      } else {
        sessionRef.current = session;
        if (stopWhenReadyRef.current) {
          startingRef.current = false;
          void stop();
        }
      }
    } catch (error) {
      if (unlocked?.state !== "closed")
        void unlocked?.close().catch(() => undefined);
      setState({ phase: "off", pending: 0, level: 0 });
      if (cancelledRef.current) return;
      const message =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : error instanceof Error
            ? error.message
            : String(error);
      onErrorRef.current(message);
    } finally {
      startingRef.current = false;
    }
  }, [stop]);

  const toggle = useCallback(() => {
    if (sessionRef.current) void stop();
    else void start();
  }, [start, stop]);

  // Unmounting (closing the composer or switching panes) releases the mic.
  useEffect(
    () => () => {
      cancelledRef.current = startingRef.current;
      sessionRef.current?.cancel();
      sessionRef.current = null;
    },
    [],
  );

  return { state, toggle, stop, cancel, active: state.phase !== "off" };
}

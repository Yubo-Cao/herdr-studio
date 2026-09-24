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
  /** After a clean stop; `tidy` is null when the bridge has no cleanup model. */
  onFinish?: (tidy: typeof tidyDictation | null) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<VoiceDictationState>({
    phase: "off",
    pending: 0,
    level: 0,
  });
  const sessionRef = useRef<DictationSession | null>(null);
  const startingRef = useRef(false);
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
    if (!session) return;
    sessionRef.current = null;
    setState((current) => ({ ...current, phase: "stopping", level: 0 }));
    try {
      await session.stop();
      const finish = onFinishRef.current;
      if (finish) {
        setState((current) => ({ ...current, phase: "tidying" }));
        const { tidyDictation } = await import("./voiceDictation");
        await finish(session.cleanup ? tidyDictation : null);
      }
    } catch (error) {
      onErrorRef.current(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setState((current) => ({ ...current, phase: "off", level: 0 }));
    }
  }, []);

  const start = useCallback(async () => {
    if (sessionRef.current || startingRef.current) return;
    startingRef.current = true;
    setState({ phase: "starting", pending: 0, level: 0 });
    try {
      const voice = await import("./voiceDictation");
      const { dictationInsertion } = await import("./voiceSegmenter");
      onStartRef.current?.();
      sessionRef.current = await voice.startDictation({
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
      });
    } catch (error) {
      setState({ phase: "off", pending: 0, level: 0 });
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
      sessionRef.current?.cancel();
      sessionRef.current = null;
    },
    [],
  );

  return { state, toggle, stop, active: state.phase !== "off" };
}
